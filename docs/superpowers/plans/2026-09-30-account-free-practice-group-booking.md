# Account-Free Performance Practice Group Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let December 2026 committee members verify with a rostered student ID and matching `{student_id}@xmu.edu.my` email, book one performance-practice group without an account, and let admins manage the roster, imports, groups, sessions, and assignments.

**Architecture:** Replace auth-profile-based practice membership with an independent `committee_roster` and transactional `practice_group_bookings` schema. Public Next.js route handlers call server-only services and database RPCs; admin mutations use authenticated server actions. Public and admin React clients are separated so no roster data or privileged database client reaches the browser.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase/PostgreSQL RLS and RPCs, ExcelJS, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-30-account-free-practice-group-booking-design.md`

## Global Constraints

- Performance-practice scope is fixed to orientation `december`, year `2026`.
- The roster stores `name`, `student_id`, `position`, and `active`; email is never stored and must equal `{student_id}@xmu.edu.my`, case-insensitively.
- Committee members never create accounts and cannot move or cancel their own booking.
- Only admins manage practice data; HOF/HOG keep their unrelated interview-dashboard access.
- `/practice` is public, but groups remain hidden until backend verification succeeds.
- Public selection results expose only group ID, group name, and remaining spaces.
- Existing practice-only data may be reset; profiles, auth users, interview slots, and interview bookings must remain untouched.
- Import formats are XLSX, CSV, and JSON with exact fields `name`, `student_id`, `position`; maximum 5 MB and 5,000 rows.
- Imports add/update/reactivate by case-insensitive student ID and never remove omitted members.
- Ten failed verification attempts from one address in 15 minutes produce HTTP 429.
- Do not overwrite the existing uncommitted edits in `.gitignore`, `app/NavClient.tsx`, `package.json`, load-test files, or their tests; merge only the changes required by this feature.

## Review Focus

- A student ID containing Unicode lookalikes or internal whitespace must not normalize into another member; Task 2 adds exact normalization tests.
- A spoofed forwarding header must not bypass rate limiting on production Vercel requests; Task 3 pins trusted-header precedence.
- An admin changing a roster member's student ID must not detach their booking; Task 6 tests UUID-based identity preservation.
- A valid import with two differently cased versions of one student ID must fail atomically; Task 5 tests cross-format duplicate detection.
- A destination group becoming full during an admin move must leave the original booking unchanged; Task 6 adds an RPC integration test.

---

### Task 1: Replace the practice database schema

**Files:**
- Create: `supabase/migrations/0041_account_free_practice_booking.sql`
- Modify: `supabase/all_migrations.sql` (regenerate with the existing script)
- Create: `tests/rpc/practice-booking.test.ts`

**Interfaces:**
- Consumes: existing `profiles`, `committee_positions`, `orientation`, `slot_status`, `is_admin()`, and audit infrastructure.
- Produces: tables `committee_roster`, `practice_groups`, `practice_group_bookings`, `practice_sessions`, `practice_verification_failures`; RPCs `public_practice_lookup(text,text)`, `public_book_practice_group(text,text,uuid)`, `admin_assign_practice_member(uuid,uuid)`, `admin_move_practice_member(uuid,uuid)`, `admin_remove_practice_booking(uuid)`, and `admin_apply_practice_roster(jsonb)`.

- [ ] **Step 1: Write failing RPC integration tests for verification and booking**

Create a real-Supabase suite using the skip-without-env pattern from `tests/rpc/booking.test.ts`. Seed roster rows and groups with the service-role client, then call the two public RPCs with the service-role client because direct anon execution will intentionally be revoked.

```ts
it('matches ID and derived email without case sensitivity', async () => {
  const result = await admin.rpc('public_practice_lookup', {
    p_student_id: ' dSc2344112 ',
    p_email: 'DSC2344112@XMU.EDU.MY',
  })
  expect(result.error).toBeNull()
  expect(result.data.state).toBe('available')
})

it('allows only one winner for the final group space', async () => {
  const [a, b] = await Promise.all([
    admin.rpc('public_book_practice_group', {
      p_student_id: first.student_id,
      p_email: `${first.student_id}@xmu.edu.my`,
      p_group: group.id,
    }),
    admin.rpc('public_book_practice_group', {
      p_student_id: second.student_id,
      p_email: `${second.student_id}@xmu.edu.my`,
      p_group: group.id,
    }),
  ])
  expect([a, b].filter((r) => !r.error)).toHaveLength(1)
})
```

Also cover inactive members, mismatched local parts/domains, generic `identity_not_verified`, repeat lookup returning `booked`, closed groups, duplicate booking, direct anon table denial, and HOF/HOG rejection from every admin RPC.

- [ ] **Step 2: Run the RPC test and verify it fails**

Run: `npm test -- tests/rpc/practice-booking.test.ts`

Expected: the suite skips without Supabase credentials; with credentials it fails because the tables and RPCs do not exist.

- [ ] **Step 3: Implement the replacement schema and public RPCs**

In migration `0041`, drop only the old practice RPCs/tables, then create the new tables. Preserve all non-practice tables.

```sql
create table committee_roster (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  student_id text not null check (student_id = btrim(student_id) and student_id !~ '\\s'),
  position text not null references committee_positions(value),
  orientation orientation not null default 'december' check (orientation = 'december'),
  orientation_year int not null default 2026 check (orientation_year = 2026),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index committee_roster_student_id_ci
  on committee_roster (lower(student_id));

create table practice_group_bookings (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references practice_groups(id),
  roster_member_id uuid not null unique references committee_roster(id),
  source text not null check (source in ('self_service', 'admin')),
  assigned_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Add `normalize_practice_student_id(text)` and `verified_practice_member(text,text)` helpers. Normalization must trim and uppercase ASCII letters but reject blank values, internal whitespace, and characters outside `[A-Za-z0-9_-]`; it must not transliterate Unicode.

Implement `public_practice_lookup` as JSONB with a stable discriminated shape:

```json
{"state":"available","groups":[{"id":"uuid","name":"Group A","seats_left":3}]}
```

or:

```json
{"state":"booked","booking":{"id":"uuid","group_name":"Group A","sessions":[]}}
```

Raise machine-readable errors `identity_not_verified`, `group_unavailable`, `group_full`, and `already_booked`. `public_book_practice_group` must `SELECT ... FOR UPDATE` the group before counting bookings and inserting.

Enable RLS on every new table. Give authenticated admins explicit table policies. Revoke all public table access and grant public RPC execution only to `service_role`, so browser clients cannot bypass the Next.js endpoints.

- [ ] **Step 4: Implement admin assignment RPCs and audit compatibility**

Each admin RPC must begin with an explicit database authorization check:

```sql
if not is_admin() then
  raise exception 'not_authorized';
end if;
```

`admin_move_practice_member` must lock both the existing booking and destination group, validate destination capacity, and update only after every check passes. `admin_apply_practice_roster(jsonb)` must validate the entire JSON array into a temporary/CTE result before its single upsert statement.

Update the audit helpers/triggers for `committee_roster` and `practice_group_bookings`. Public self-service bookings must resolve to `actor_type = 'public'` and use the roster member's name without writing a student ID or derived email into `audit_log`.

- [ ] **Step 5: Run RPC tests and regenerate the combined migration**

Run:

```bash
npm test -- tests/rpc/practice-booking.test.ts
npm run build:migrations
git diff --check
```

Expected: RPC tests pass when credentials are present and skip otherwise; `supabase/all_migrations.sql` ends with migration `0041`; diff check is clean.

- [ ] **Step 6: Commit the database slice**

```bash
git add supabase/migrations/0041_account_free_practice_booking.sql supabase/all_migrations.sql tests/rpc/practice-booking.test.ts
git commit -m "feat(practice): add account-free roster booking schema"
```

### Task 2: Add shared practice types and identity validation

**Files:**
- Create: `lib/practice-types.ts`
- Create: `lib/practice-identity.ts`
- Create: `tests/practice-identity.test.ts`

**Interfaces:**
- Consumes: no database or React dependency.
- Produces: `normalizeStudentId(value: unknown): string | null`, `normalizeUniversityEmail(value: unknown): string | null`, `matchesDerivedUniversityEmail(studentId,email): boolean`, `PracticeLookupResult`, `PracticeBookingResult`, and admin DTO types.

- [ ] **Step 1: Write failing normalization tests**

```ts
expect(normalizeStudentId(' dsc2344112 ')).toBe('DSC2344112')
expect(normalizeStudentId('DSC 2344112')).toBeNull()
expect(normalizeStudentId('ＤＳＣ2344112')).toBeNull()
expect(matchesDerivedUniversityEmail('DSC2344112', 'dsc2344112@XMU.EDU.MY')).toBe(true)
expect(matchesDerivedUniversityEmail('DSC2344112', 'dsc2344112+tag@xmu.edu.my')).toBe(false)
expect(matchesDerivedUniversityEmail('DSC2344112', 'dsc2344112@sub.xmu.edu.my')).toBe(false)
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- tests/practice-identity.test.ts`

Expected: FAIL because `lib/practice-identity.ts` does not exist.

- [ ] **Step 3: Implement the pure validation boundary**

```ts
const STUDENT_ID = /^[A-Z0-9_-]+$/

export function normalizeStudentId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return normalized && STUDENT_ID.test(normalized) ? normalized : null
}

export function matchesDerivedUniversityEmail(studentId: unknown, email: unknown): boolean {
  const id = normalizeStudentId(studentId)
  if (!id || typeof email !== 'string') return false
  return email.trim().toLowerCase() === `${id.toLowerCase()}@xmu.edu.my`
}
```

Define discriminated result types matching Task 1 exactly, including a `booked` result with session IDs, ISO timestamps, and locations.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- tests/practice-identity.test.ts`

Expected: PASS.

```bash
git add lib/practice-types.ts lib/practice-identity.ts tests/practice-identity.test.ts
git commit -m "feat(practice): add identity validation contract"
```

### Task 3: Build public verification and booking endpoints

**Files:**
- Create: `lib/practice-server.ts`
- Create: `lib/practice-rate-limit.ts`
- Create: `app/api/practice/verify/route.ts`
- Create: `app/api/practice/book/route.ts`
- Create: `tests/practice-routes.test.ts`
- Modify: `.env.example` if present; otherwise document the new variable in `README.md`.

**Interfaces:**
- Consumes: Task 1 RPCs; Task 2 identity helpers and result types; `createAdminClient()`.
- Produces: JSON endpoints with `200`, `400`, `409`, `429`, and `500` status mappings; `PRACTICE_RATE_LIMIT_SECRET` configuration.

- [ ] **Step 1: Write failing route tests**

Mock `practice-server` and test route handlers as plain functions:

```ts
const response = await verifyPOST(new Request('http://localhost/api/practice/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': '203.0.113.7' },
  body: JSON.stringify({ studentId: 'DSC2344112', email: 'dsc2344112@xmu.edu.my' }),
}))
expect(response.status).toBe(200)
expect(response.headers.get('cache-control')).toBe('no-store')
```

Cover malformed JSON, wrong types, generic identity failure, group full as `409`, missing rate-limit secret as a server configuration error, the eleventh failed attempt as `429`, and trusted `x-vercel-forwarded-for` taking precedence over client-supplied `x-forwarded-for`.

- [ ] **Step 2: Run the route test and verify it fails**

Run: `npm test -- tests/practice-routes.test.ts`

Expected: FAIL because the route modules do not exist.

- [ ] **Step 3: Implement the server service and persistent limiter**

`lib/practice-server.ts` owns all service-role RPC calls and translates database errors into a closed union:

```ts
export type PracticeServiceError =
  | 'identity_not_verified'
  | 'group_full'
  | 'group_unavailable'
  | 'already_booked'
  | 'server_error'

export async function lookupPractice(input: PracticeIdentityInput): Promise<ServiceResult<PracticeLookupResult>>
export async function createPracticeBooking(input: PracticeBookingInput): Promise<ServiceResult<PracticeBookingResult>>
```

`lib/practice-rate-limit.ts` must:

- Read `x-vercel-forwarded-for` in production; use the first address only.
- Fall back to `x-forwarded-for` only outside production/test fixtures.
- HMAC the address with SHA-256 and `PRACTICE_RATE_LIMIT_SECRET`.
- Query `practice_verification_failures` for the rolling 15-minute count.
- Record only failed identity attempts.
- Delete rows older than 24 hours opportunistically.

- [ ] **Step 4: Implement both route handlers**

Both routes parse JSON defensively, call the limiter before the service, record only `identity_not_verified`, and return generic public copy.

```ts
if (result.error === 'identity_not_verified') {
  await recordFailedVerification(fingerprint)
  return NextResponse.json(
    { error: 'Student ID or university email could not be verified.' },
    { status: 400, headers: NO_STORE },
  )
}
```

Do not log bodies or include credentials in thrown error strings. Map `group_full`, `group_unavailable`, and `already_booked` to `409`; unexpected database errors return a generic `500`.

- [ ] **Step 5: Run route, type, and lint checks**

Run:

```bash
npm test -- tests/practice-routes.test.ts tests/practice-identity.test.ts
npx tsc --noEmit
npm run lint -- app/api/practice lib/practice-server.ts lib/practice-rate-limit.ts
```

Expected: all commands pass.

- [ ] **Step 6: Commit the public server boundary**

```bash
git add app/api/practice lib/practice-server.ts lib/practice-rate-limit.ts tests/practice-routes.test.ts README.md .env.example
git commit -m "feat(practice): add public verification and booking API"
```

Only stage the environment-documentation file that actually exists and changed.

### Task 4: Build the public account-free booking page

**Files:**
- Modify: `app/practice/page.tsx`
- Replace: `app/practice/PracticeClient.tsx`
- Delete: `app/practice/MyGroupPanel.tsx`
- Create: `lib/practice-public.ts`
- Create: `tests/practice-client.test.tsx`

**Interfaces:**
- Consumes: Task 3 endpoints and Task 2 public DTOs.
- Produces: `verifyPracticeMember(input)` and `bookPracticeGroup(input)` browser fetch wrappers; four-state `PracticeClient`.

- [ ] **Step 1: Write failing public-flow component tests**

Mock `lib/practice-public.ts` and assert:

```ts
expect(screen.queryByText('Group A')).toBeNull()
fireEvent.change(screen.getByLabelText(/student id/i), { target: { value: 'DSC2344112' } })
fireEvent.change(screen.getByLabelText(/university email/i), { target: { value: 'dsc2344112@xmu.edu.my' } })
await user.click(screen.getByRole('button', { name: /verify/i }))
expect(await screen.findByText('Group A')).toBeVisible()
expect(screen.queryByText('Member One')).toBeNull()
```

Cover invalid identity copy, available groups showing only remaining spaces, confirmation before booking, group-full refresh, success state, repeat lookup showing sessions, absence of move/cancel controls, double-submit prevention, and credentials not written to `localStorage` or `sessionStorage`.

- [ ] **Step 2: Run the component test and verify it fails**

Run: `npm test -- tests/practice-client.test.tsx`

Expected: FAIL against the old authenticated group-management component.

- [ ] **Step 3: Implement the fetch wrapper**

```ts
export async function verifyPracticeMember(input: PracticeIdentityInput) {
  return postJson<PracticeLookupResult>('/api/practice/verify', input)
}

export async function bookPracticeGroup(input: PracticeBookingInput) {
  return postJson<PracticeBookingResult>('/api/practice/book', input)
}
```

Return structured `{data,error,status}` results; never put credentials in a query string.

- [ ] **Step 4: Replace the page with the four-state UI**

`page.tsx` must not call `getCurrentProfile()` or redirect. `PracticeClient` owns:

```ts
type Screen =
  | { kind: 'verify' }
  | { kind: 'available'; identity: PracticeIdentityInput; groups: PublicPracticeGroup[] }
  | { kind: 'confirm'; identity: PracticeIdentityInput; group: PublicPracticeGroup }
  | { kind: 'booked'; booking: PublicPracticeBooking }
```

Keep identity only in React memory until booking completes, then discard it. Render explicit labels, associated inline errors, keyboard-accessible confirmation, disabled pending buttons, empty-group copy, session times using existing booking helpers, and an HTTP 429 message.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
npm test -- tests/practice-client.test.tsx tests/practice-routes.test.ts
npx tsc --noEmit
npm run lint -- app/practice lib/practice-public.ts
```

Expected: PASS.

```bash
git add app/practice/page.tsx app/practice/PracticeClient.tsx app/practice/MyGroupPanel.tsx lib/practice-public.ts tests/practice-client.test.tsx
git commit -m "feat(practice): add account-free public booking flow"
```

### Task 5: Add transactional XLSX, CSV, and JSON roster imports

**Files:**
- Create: `lib/practice-import.ts`
- Create: `app/api/admin/practice/import/validate/route.ts`
- Create: `app/api/admin/practice/import/apply/route.ts`
- Create: `app/api/admin/practice/import/template/route.ts`
- Create: `tests/practice-import.test.ts`
- Create: `tests/practice-import-routes.test.ts`

**Interfaces:**
- Consumes: ExcelJS, Task 2 student-ID normalization, Task 1 `admin_apply_practice_roster(jsonb)`, and the authenticated cookie-backed Supabase server client.
- Produces: `parsePracticeRosterFile(file): Promise<ImportValidation>`, validation/apply endpoints, and downloadable XLSX template.

- [ ] **Step 1: Write failing parser tests for all formats**

Use in-memory `File` instances and an ExcelJS workbook buffer. Assert every format produces:

```ts
{
  rows: [{ rowNumber: 2, name: 'Example Member', student_id: 'DSC2344112', position: 'facilitator' }],
  errors: [],
}
```

Add tests for a case-insensitive duplicate (`DSC1` and `dsc1`), missing exact headers, unknown fields in JSON, malformed JSON/CSV/XLSX, blank values, unknown position supplied by the route's position set, 5,001 rows, and a file larger than 5 MB.

- [ ] **Step 2: Run parser tests and verify they fail**

Run: `npm test -- tests/practice-import.test.ts`

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement one canonical parser pipeline**

Expose format adapters that all feed a single validator:

```ts
type RawRosterRow = Record<string, unknown>
type CanonicalRosterRow = {
  rowNumber: number
  name: string
  student_id: string
  position: string
}

function validateRows(rawRows: RawRosterRow[], validPositions: Set<string>): ImportValidation
```

Use ExcelJS for the first XLSX worksheet. Implement a small RFC 4180-compatible CSV parser that supports quoted commas, quotes, CRLF/LF, and a UTF-8 BOM; do not split rows with `line.split(',')`. JSON must be a top-level array and each object must contain exactly the three required keys.

- [ ] **Step 4: Write failing admin import route tests**

Mock `getCurrentProfile`, the parser, and admin client. Verify `401` signed out, `403` non-admin, validation does not write, apply reparses/revalidates, one RPC call receives all canonical rows, RPC failure returns no success count, and the template has correct content type and headers.

- [ ] **Step 5: Implement the three admin routes**

Each route begins:

```ts
const profile = await getCurrentProfile()
if (!profile) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
if (profile.role !== 'admin') return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
```

Validation returns all row errors plus new/update counts from a read-only roster comparison. Apply reparses the submitted `File`, rejects any validation error, then calls `admin_apply_practice_roster` once using `await createClient()` from `lib/supabase/server.ts`. This preserves the signed-in admin JWT so the database-level `is_admin()` guard remains effective; a service-role client must not be used to bypass that guard. The browser retains the selected `File` between preview and confirmation; no client-supplied canonical rows are trusted.

- [ ] **Step 6: Run import tests and commit**

Run:

```bash
npm test -- tests/practice-import.test.ts tests/practice-import-routes.test.ts
npx tsc --noEmit
npm run lint -- lib/practice-import.ts app/api/admin/practice/import
```

Expected: PASS.

```bash
git add lib/practice-import.ts app/api/admin/practice/import tests/practice-import.test.ts tests/practice-import-routes.test.ts
git commit -m "feat(practice): add transactional roster imports"
```

### Task 6: Add admin roster, group, session, and assignment services

**Files:**
- Create: `app/actions/practiceAdminActions.ts`
- Create: `lib/practice-admin.ts`
- Create: `tests/practice-admin-actions.test.ts`
- Modify: `tests/rpc/practice-booking.test.ts`

**Interfaces:**
- Consumes: Task 1 tables/RPCs, Task 2 DTOs, `getCurrentProfile()`, and the authenticated cookie-backed `createClient()` from `lib/supabase/server.ts`.
- Produces: server actions `saveRosterMemberAction`, `setRosterMemberActiveAction`, `createPracticeGroupAction`, `updatePracticeGroupAction`, `deletePracticeGroupAction`, `savePracticeSessionAction`, `deletePracticeSessionAction`, `assignPracticeMemberAction`, `movePracticeMemberAction`, and `removePracticeBookingAction`; read service `getAdminPracticeSnapshot()`.

- [ ] **Step 1: Write failing action authorization and validation tests**

```ts
vi.mocked(getCurrentProfile).mockResolvedValue({ id: 'head-1', role: 'head_gm' } as never)
expect(await createPracticeGroupAction({ name: 'A', capacity: 5 })).toEqual({
  data: null,
  error: 'Not authorized.',
})
```

Cover signed-out, HOF/HOG, blank names, invalid IDs, unknown positions, capacity below one, end time before start, inactive assignment, duplicate assignment, full destination, and deletion of a populated group. Add a fixture with an existing booking, edit that roster row's student ID, and assert the unchanged roster UUID still owns the same booking.

- [ ] **Step 2: Run the action test and verify it fails**

Run: `npm test -- tests/practice-admin-actions.test.ts`

Expected: FAIL because the actions do not exist.

- [ ] **Step 3: Implement one reusable admin guard and the read model**

```ts
async function requirePracticeAdmin() {
  const profile = await getCurrentProfile()
  if (!profile) return { profile: null, error: 'Not signed in.' as const }
  if (profile.role !== 'admin') return { profile: null, error: 'Not authorized.' as const }
  return { profile, error: null }
}
```

Every action validates primitive input before creating the authenticated server client. The user's JWT must reach PostgreSQL so RLS and the RPC `is_admin()` check independently enforce authorization. `getAdminPracticeSnapshot()` returns roster entries, positions, groups with booking/session counts, sessions, and assignments in focused DTO arrays; do not return rate-limit rows.

- [ ] **Step 4: Implement mutations through transactional RPCs/direct writes**

Use Task 1 RPCs for assignment, movement, removal, import, group capacity changes, and populated-group deletion. Use authenticated table writes under admin-only RLS for simple CRUD that has no cross-row invariant; do not use the service-role key for normal admin actions. Revalidate `/admin/practice` after successful actions.

Editing a roster member updates the existing UUID row rather than delete/reinsert:

```ts
await admin.from('committee_roster').update({
  name: input.name.trim(),
  student_id: normalizedStudentId,
  position: input.position,
}).eq('id', input.id)
```

- [ ] **Step 5: Add atomic admin-move integration coverage**

Extend the RPC suite with two simultaneous moves into one remaining space. Assert one succeeds, one fails, and the failed member's original `group_id` remains unchanged.

- [ ] **Step 6: Run action/RPC tests and commit**

Run:

```bash
npm test -- tests/practice-admin-actions.test.ts tests/rpc/practice-booking.test.ts
npx tsc --noEmit
npm run lint -- app/actions/practiceAdminActions.ts lib/practice-admin.ts
```

Expected: PASS/skip as appropriate.

```bash
git add app/actions/practiceAdminActions.ts lib/practice-admin.ts tests/practice-admin-actions.test.ts tests/rpc/practice-booking.test.ts
git commit -m "feat(practice): add admin management services"
```

### Task 7: Build the admin practice interface

**Files:**
- Create: `app/admin/practice/page.tsx`
- Create: `app/admin/practice/AdminPracticeDashboard.tsx`
- Create: `app/admin/practice/RosterManager.tsx`
- Create: `app/admin/practice/RosterImportPanel.tsx`
- Create: `app/admin/practice/PracticeGroupManager.tsx`
- Create: `tests/admin-practice-client.test.tsx`
- Modify: `app/admin/page.tsx`
- Delete: `app/head/practice/page.tsx`
- Delete: `app/head/practice/HeadPracticeDashboard.tsx`

**Interfaces:**
- Consumes: Task 5 import endpoints; Task 6 snapshot and server actions.
- Produces: authenticated `/admin/practice` management UI; `/head/practice` no longer renders the obsolete lead/head dashboard.

- [ ] **Step 1: Write failing admin component tests**

Render focused components with fixture DTOs. Cover manual add/edit/deactivate/reactivate, import error rows and confirmation, group create/edit/open/close/delete, session create/edit/delete, assignment, movement, removal, and preservation of the original selection after a failed move.

```ts
await user.click(screen.getByRole('button', { name: /deactivate DSC2344112/i }))
expect(setRosterMemberActiveAction).toHaveBeenCalledWith('member-1', false)
```

- [ ] **Step 2: Run the UI test and verify it fails**

Run: `npm test -- tests/admin-practice-client.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the server page and dashboard composition**

`page.tsx` uses `getCurrentProfile()` and redirects signed-out users to `/login` and non-admin users to `/head`. Fetch `getAdminPracticeSnapshot()` on the server and pass serializable DTOs into `AdminPracticeDashboard`.

Keep responsibilities separated:

- `RosterManager`: manual fields, status, current group, edit/deactivate/reactivate.
- `RosterImportPanel`: file selection, validation report, confirmation, template link.
- `PracticeGroupManager`: group/session/member actions.
- `AdminPracticeDashboard`: tabs and refresh/revalidation boundaries only.

- [ ] **Step 4: Implement import preview/apply behavior**

Retain the selected `File` in component state. Send it as `FormData` to validate; on confirmation send the same `File` to apply. Display all errors with `Row N — field: message`. Disable Apply unless the latest validation result belongs to the currently selected file.

- [ ] **Step 5: Retire obsolete head/lead practice UI and link admin pages**

Delete the old `/head/practice` components. Add a “Performance Practice” link/card from `/admin`. Any compatibility route retained temporarily must perform a server redirect to `/admin/practice` only for admins and reject other roles; do not keep old management code.

- [ ] **Step 6: Run UI tests and commit**

Run:

```bash
npm test -- tests/admin-practice-client.test.tsx tests/practice-import-routes.test.ts
npx tsc --noEmit
npm run lint -- app/admin/practice app/admin/page.tsx
```

Expected: PASS.

```bash
git add app/admin/practice app/admin/page.tsx app/head/practice tests/admin-practice-client.test.tsx
git commit -m "feat(practice): add admin roster and group dashboard"
```

### Task 8: Update navigation, remove legacy data access, and protect boundaries

**Files:**
- Modify: `app/NavClient.tsx`
- Modify: `tests/nav-client.test.tsx`
- Modify: `lib/practice.ts`
- Modify: `lib/admin.ts`
- Modify: `middleware.ts` or `lib/supabase/middleware.ts` only if current matching blocks `/practice`
- Create: `tests/practice-access.test.tsx`
- Delete obsolete practice-only exports and tests discovered by `rg`.

**Interfaces:**
- Consumes: new public `/practice` and admin `/admin/practice` routes.
- Produces: visible logged-out practice navigation, admin-only management link, no calls to removed lead/member RPCs.

- [ ] **Step 1: Extend navigation/access tests and verify failure**

Add assertions that:

```ts
render(<NavClient profile={null} />)
expect(screen.getByRole('link', { name: /performance practice/i })).toHaveAttribute('href', '/practice')

render(<NavClient profile={adminProfile} />)
expect(screen.getByRole('link', { name: /performance practice management/i }))
  .toHaveAttribute('href', '/admin/practice')
```

Also assert HOF/HOG retain `/head` interview links but receive no admin-practice link.

Run: `npm test -- tests/nav-client.test.tsx tests/practice-access.test.tsx`

Expected: at least the logged-out practice/admin-management assertions fail.

- [ ] **Step 2: Merge navigation changes without overwriting the dirty file**

Inspect `git diff -- app/NavClient.tsx` first. Preserve the user's current styling and unrelated changes. Add a public “Performance Practice” link for logged-out navigation; send admins to `/admin/practice`; regular authenticated non-admin users may open public `/practice` but gain no management controls.

- [ ] **Step 3: Remove old practice APIs while preserving committee-position helpers**

Keep `positionLabel`, position types, and committee-position CRUD used by existing admin/profile navigation. Remove exports that call old RPCs such as `join_practice_group`, `leave_practice_group`, `lead_*`, and `head_practice_*`. Update `lib/admin.ts` so revoking committee interview access no longer queries the removed `practice_groups.lead_id`.

Use:

```bash
rg -n "joinPracticeGroup|leavePracticeGroup|lead(Create|Update|Delete|Add|Remove)|head/practice|lead_id" app lib tests
```

Expected: only migration history/spec documentation or intentionally retained compatibility text remains.

- [ ] **Step 4: Run navigation, access, type, and lint checks**

Run:

```bash
npm test -- tests/nav-client.test.tsx tests/practice-access.test.tsx
npx tsc --noEmit
npm run lint
```

Expected: PASS with no obsolete imports.

- [ ] **Step 5: Commit the integration cleanup**

```bash
git add tests/nav-client.test.tsx lib/practice.ts lib/admin.ts middleware.ts lib/supabase/middleware.ts tests/practice-access.test.tsx
git commit -m "refactor(practice): retire account-based practice access"
```

Stage only files that actually changed. Because `app/NavClient.tsx` was already dirty before this feature, do not include the whole file in this commit. Inspect its pre-existing diff, preserve it, and stage only the newly added practice-navigation hunk with an index-only patch; verify with `git diff --cached -- app/NavClient.tsx` that no pre-existing hunk was captured before committing. If the hunks overlap and cannot be separated safely, leave `NavClient.tsx` uncommitted and report that explicitly rather than absorbing the user's changes.

### Task 9: Full verification and deployment documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-30-account-free-practice-group-booking-design.md` only if implementation uncovered a material, approved deviation.

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: verified build, migration instructions, required environment variable documentation, import template guidance, and final review evidence.

- [ ] **Step 1: Document configuration and operation**

Add `PRACTICE_RATE_LIMIT_SECRET` to setup instructions with a generation example that does not print or commit a real secret. Document migration application, the empty practice-data reset, `/admin/practice`, template download, supported file formats, exact fields, and December 2026 limitation.

- [ ] **Step 2: Run the complete automated verification suite**

Run:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
npm run build:migrations
git diff --check
```

Expected: every command exits zero. RPC suites may report skipped tests only when Supabase test credentials are unavailable; record that limitation explicitly.

- [ ] **Step 3: Audit security and scope with targeted searches**

Run:

```bash
rg -n "studentId|student_id|universityEmail|email" app/api/practice lib/practice-server.ts lib/practice-rate-limit.ts
rg -n "localStorage|sessionStorage" app/practice lib/practice-public.ts
rg -n "join_practice_group|leave_practice_group|lead_id|performance_lead" app lib tests
git status --short
```

Expected: no credential logging/storage, no legacy practice calls, and only known pre-existing unrelated worktree changes remain outside this feature.

- [ ] **Step 4: Perform a manual smoke test against a migrated local/test database**

Verify this exact sequence:

1. Admin imports a valid roster file and creates two groups.
2. Unknown ID and mismatched email receive identical errors.
3. A valid member sees names and remaining spaces only.
4. The member books and sees on-screen confirmation.
5. Re-verification shows the group and sessions without mutation controls.
6. Admin moves the member; re-verification shows the new group.
7. Admin deactivates the member; verification stops working while the booking remains visible to the admin.
8. HOF/HOG can still use interview management but cannot open `/admin/practice`.

- [ ] **Step 5: Commit documentation and any verification-only fixes**

```bash
git add README.md docs/superpowers/specs/2026-09-30-account-free-practice-group-booking-design.md
git commit -m "docs: add account-free practice operations guide"
```

Skip the commit if neither file changed. Any code fix found during verification must repeat its owning task's focused test before being included in a separately named fix commit.
