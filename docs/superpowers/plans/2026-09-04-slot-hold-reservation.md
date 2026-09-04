# Slot Hold / Reservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reserve a slot for 3 minutes the moment an applicant leaves the slot picker, instead of only locking it at final submit, so a slow-typing applicant can't lose the seat to someone else mid-form.

**Architecture:** A new `slot_holds` table + three new SECURITY DEFINER RPCs (`reserve_slot`, `confirm_reservation`, `release_hold`) mirror the existing `book_slot_public` row-locking pattern. Expiry is lazy (computed at read time via `held_at > now() - interval '3 minutes'`) — no cron/queue, matching the serverless deploy. `BookClient.tsx`'s step 1→2 transition becomes an async reserve call; step 2 shows a live countdown.

**Tech Stack:** Next.js App Router + TypeScript, Supabase Postgres (RPC + RLS), Vitest for integration tests against a real Supabase project (existing `tests/rpc/*.test.ts` convention).

**Spec:** [docs/superpowers/specs/2026-09-04-slot-hold-reservation-design.md](../specs/2026-09-04-slot-hold-reservation-design.md)

## Global Constraints

- No new infrastructure — no cron job, no queue, no Redis. Expiry is computed, never swept.
- Hold TTL is a hardcoded 3 minutes (`interval '3 minutes'`), not a configurable setting.
- All new RPCs are `language plpgsql security definer set search_path = public`, matching every existing booking RPC.
- `slot_holds` gets RLS enabled with **zero policies** — all access goes through the RPCs, never direct table access.
- Follow `BookClient.tsx`'s existing convention: inline `style={{...}}` objects, no CSS framework, no new component library.
- Integration tests for RPCs live in `tests/rpc/` and follow the `describe.skipIf(!hasEnv)` real-Supabase-project convention already used by `tests/rpc/booking.test.ts` — this repo's `.env.local` has real credentials configured. **Plain `npm test` does not load `.env.local`** (`vitest.config.ts` has no env-loading step) and will silently report these as skipped rather than passing. Always run RPC integration tests as `node --env-file=.env.local node_modules/.bin/vitest run <file>`, matching how `npm run migrate`/`npm run seed` already load env vars in this repo.

---

## Task 1: Hold reservation schema & RPCs

**Files:**
- Create: `supabase/migrations/0034_slot_holds.sql`
- Test: `tests/rpc/slot-holds.test.ts`

**Interfaces:**
- Produces (SQL, callable via `supabase.rpc(...)`):
  - `reserve_slot(p_slot uuid, p_prev_token uuid default null)` → single object `{hold_id: uuid, token: uuid, expires_at: timestamptz}`
  - `confirm_reservation(p_token uuid, p_name text, p_student_id text, p_email text, p_experiences text)` → single `bookings` row (same shape `book_slot_public` already returns)
  - `release_hold(p_token uuid)` → void
  - `available_slots(p_track track, p_orientation orientation, p_year int default 2026)` → same table shape as today; `seats_left` now also subtracts active (unexpired, unreleased) holds

This task's raw SQL can't be meaningfully red/green unit-tested before it exists (it's one migration file, same as every other migration in this repo) — the integration test is the verification step, applied against the real dev Supabase project already configured in `.env.local`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0034_slot_holds.sql`:

```sql
-- 0034_slot_holds.sql
-- Temporary seat holds: an applicant reserves a slot the moment they leave
-- the slot picker (step 1 -> step 2), holding it for 3 minutes while they
-- fill in their details. No login, no cron/queue infra (serverless deploy),
-- so expiry is computed lazily wherever it matters instead of swept by a
-- background job. See docs/superpowers/specs/2026-09-04-slot-hold-reservation-design.md.

create table slot_holds (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references slots(id),
  token uuid not null default gen_random_uuid() unique,
  held_at timestamptz not null default now(),
  released boolean not null default false
);
create index slot_holds_active_idx on slot_holds (slot_id) where not released;

-- No RLS policies: every access goes through the SECURITY DEFINER functions
-- below, which bypass RLS. Direct table access from anon/authenticated stays
-- blocked (RLS enabled, zero policies, no table-level grants).
alter table slot_holds enable row level security;

create type slot_hold_result as (
  hold_id uuid,
  token uuid,
  expires_at timestamptz
);

-- ---------- reserve_slot: claim a seat for 3 minutes ----------
create or replace function reserve_slot(p_slot uuid, p_prev_token uuid default null)
returns slot_hold_result
language plpgsql security definer set search_path = public as $$
declare
  s slots;
  booked_count int;
  held_count int;
  h slot_holds;
  result slot_hold_result;
begin
  select * into s from slots where id = p_slot for update;
  if s is null then
    raise exception 'slot not found';
  end if;
  if s.status <> 'open' then
    raise exception 'slot is not open';
  end if;

  if not exists (
    select 1 from track_settings t
    where t.track = s.track
      and t.orientation = s.orientation
      and t.orientation_year = s.orientation_year
      and now() >= coalesce(t.window_open, now())
      and now() <= coalesce(t.window_close, now())
  ) then
    raise exception 'booking window is closed for this track';
  end if;

  -- Release the caller's previous hold (if any) before counting, so a
  -- browser can never be blocked by its own still-active hold when swapping
  -- to a different slot (or re-clicking Continue on the same one).
  if p_prev_token is not null then
    update slot_holds set released = true
      where token = p_prev_token and not released;
  end if;

  select count(*) into booked_count from bookings where slot_id = p_slot and status = 'booked';
  select count(*) into held_count from slot_holds
    where slot_id = p_slot and not released and held_at > now() - interval '3 minutes';

  if booked_count + held_count >= s.capacity then
    raise exception 'slot is full';
  end if;

  insert into slot_holds (slot_id) values (p_slot) returning * into h;

  result.hold_id := h.id;
  result.token := h.token;
  result.expires_at := h.held_at + interval '3 minutes';
  return result;
end $$;

-- ---------- confirm_reservation: turn a live hold into a real booking ----------
create or replace function confirm_reservation(
  p_token uuid,
  p_name text,
  p_student_id text,
  p_email text,
  p_experiences text
) returns bookings
language plpgsql security definer set search_path = public as $$
declare
  h slot_holds;
  s slots;
  b bookings;
  v_constraint text;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'name is required';
  end if;
  if coalesce(trim(p_email), '') = '' then
    raise exception 'email is required';
  end if;
  if coalesce(trim(p_student_id), '') = '' then
    raise exception 'student ID is required';
  end if;

  select * into h from slot_holds where token = p_token for update;
  if h is null or h.released or h.held_at <= now() - interval '3 minutes' then
    raise exception 'hold expired';
  end if;

  select * into s from slots where id = h.slot_id;
  if s is null or s.status <> 'open' then
    raise exception 'slot is not open';
  end if;

  if not exists (
    select 1 from track_settings t
    where t.track = s.track
      and t.orientation = s.orientation
      and t.orientation_year = s.orientation_year
      and now() >= coalesce(t.window_open, now())
      and now() <= coalesce(t.window_close, now())
  ) then
    raise exception 'booking window is closed for this track';
  end if;

  begin
    insert into bookings (
      slot_id, applicant_id, track, orientation, orientation_year, status,
      applicant_name, applicant_email, student_id, experiences
    )
    values (
      h.slot_id, null, s.track, s.orientation, s.orientation_year, 'booked',
      trim(p_name), lower(trim(p_email)), nullif(trim(p_student_id), ''), nullif(trim(p_experiences), '')
    )
    returning * into b;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'one_active_booking_per_student_track_orientation_year' then
      raise exception 'this student ID already has an active booking in this track for this orientation';
    else
      raise exception 'this email already has an active booking in this track for this orientation';
    end if;
  end;

  update slot_holds set released = true where id = h.id;

  return b;
end $$;

-- ---------- release_hold: give up a hold early (Back button) ----------
create or replace function release_hold(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update slot_holds set released = true where token = p_token and not released;
end $$;

-- ---------- available_slots: seats_left now also accounts for active holds ----------
create or replace function available_slots(p_track track, p_orientation orientation, p_year int default 2026)
returns table (
  id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  capacity int, booked_count bigint, seats_left bigint, venue text
)
language sql security definer stable set search_path = public as $$
  select s.id, s.track, s.orientation, s.orientation_year, s.starts_at, s.ends_at, s.capacity,
         count(b.*) filter (where b.status = 'booked') as booked_count,
         s.capacity
           - count(b.*) filter (where b.status = 'booked')
           - (select count(*) from slot_holds h
                where h.slot_id = s.id and not h.released and h.held_at > now() - interval '3 minutes')
           as seats_left,
         s.venue
  from slots s
  left join bookings b on b.slot_id = s.id
  where s.track = p_track and s.orientation = p_orientation and s.orientation_year = p_year
    and s.status = 'open' and s.starts_at > now()
  group by s.id
  order by s.starts_at
$$;

grant execute on function reserve_slot(uuid, uuid) to anon, authenticated;
grant execute on function confirm_reservation(uuid, text, text, text, text) to anon, authenticated;
grant execute on function release_hold(uuid) to anon, authenticated;
grant execute on function available_slots(track, orientation, int) to anon, authenticated;

notify pgrst, 'reload schema';
```

Note on the `available_slots` fix: the naive approach — adding a second `left join slot_holds h on h.slot_id = s.id` alongside the existing `left join bookings b` — would multiply rows (every booking row paired with every hold row for that slot) and corrupt `count(b.*) filter (...)`. The correlated subquery avoids that.

- [ ] **Step 2: Apply the migration**

Run: `npm run migrate`
Expected: `• applying 0034_slot_holds.sql ... ok` followed by `All migrations applied successfully.`

- [ ] **Step 3: Write the integration test**

Create `tests/rpc/slot-holds.test.ts`:

```typescript
// Integration tests for the slot-hold reservation RPCs (reserve_slot /
// confirm_reservation / release_hold) plus the updated available_slots.
//
// Talks to a REAL Supabase project, same convention as tests/rpc/booking.test.ts.
// Skipped automatically unless NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
// and SUPABASE_SERVICE_ROLE_KEY are present (see that file for setup instructions).

import { afterAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasEnv = Boolean(url && anonKey && service)

const admin = hasEnv
  ? createClient(url!, service!, { auth: { persistSession: false } })
  : (null as unknown as SupabaseClient)

// Applicants never log in for this flow — every call uses a bare anon client.
function anon() {
  return createClient(url!, anonKey!, { auth: { persistSession: false } })
}

const createdSlotIds: string[] = []

async function makeSlot(opts: { capacity?: number; hoursFromNow?: number } = {}) {
  const start = new Date(Date.now() + (opts.hoursFromNow ?? 72) * 3600_000)
  const end = new Date(start.getTime() + 15 * 60_000)
  const { data, error } = await admin
    .from('slots')
    .insert({
      track: 'facilitator',
      orientation: 'december',
      orientation_year: 2026,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      capacity: opts.capacity ?? 1,
      status: 'open',
    })
    .select()
    .single()
  if (error) throw error
  createdSlotIds.push(data.id)
  return data
}

async function expireHold(token: string) {
  // Backdate held_at past the 3-minute TTL instead of waiting in real time.
  const staleTime = new Date(Date.now() - 4 * 60_000).toISOString()
  const { error } = await admin.from('slot_holds').update({ held_at: staleTime }).eq('token', token)
  if (error) throw error
}

afterAll(async () => {
  if (!hasEnv) return
  if (createdSlotIds.length) {
    await admin.from('slot_holds').delete().in('slot_id', createdSlotIds)
    await admin.from('bookings').delete().in('slot_id', createdSlotIds)
    await admin.from('slots').delete().in('id', createdSlotIds)
  }
})

describe.skipIf(!hasEnv)('slot hold RPCs', () => {
  it('reserve then confirm books the slot and releases the hold', async () => {
    const slot = await makeSlot({ capacity: 1 })
    const client = anon()

    const reserved = await client.rpc('reserve_slot', { p_slot: slot.id, p_prev_token: null })
    expect(reserved.error).toBeNull()
    expect(reserved.data?.token).toBeTruthy()

    const confirmed = await client.rpc('confirm_reservation', {
      p_token: reserved.data.token,
      p_name: 'Alice Applicant',
      p_student_id: 'AC220001',
      p_email: `alice_${Date.now()}@test.local`,
      p_experiences: 'Ran orientation games last year.',
    })
    expect(confirmed.error).toBeNull()
    expect(confirmed.data?.status).toBe('booked')

    const { data: hold } = await admin.from('slot_holds').select('released').eq('token', reserved.data.token).single()
    expect(hold?.released).toBe(true)
  })

  it('rejects a reserve once holds alone fill capacity', async () => {
    const slot = await makeSlot({ capacity: 1 })
    const first = await anon().rpc('reserve_slot', { p_slot: slot.id, p_prev_token: null })
    expect(first.error).toBeNull()

    const second = await anon().rpc('reserve_slot', { p_slot: slot.id, p_prev_token: null })
    expect(second.error).not.toBeNull()
    expect(second.error?.message).toMatch(/full/i)
  })

  it('rejects confirm once the hold has expired', async () => {
    const slot = await makeSlot({ capacity: 1 })
    const client = anon()
    const reserved = await client.rpc('reserve_slot', { p_slot: slot.id, p_prev_token: null })
    expect(reserved.error).toBeNull()

    await expireHold(reserved.data.token)

    const confirmed = await client.rpc('confirm_reservation', {
      p_token: reserved.data.token,
      p_name: 'Bob Applicant',
      p_student_id: 'AC220002',
      p_email: `bob_${Date.now()}@test.local`,
      p_experiences: 'N/A',
    })
    expect(confirmed.error).not.toBeNull()
    expect(confirmed.error?.message).toMatch(/hold expired/i)
  })

  it('release_hold frees the seat immediately for another caller', async () => {
    const slot = await makeSlot({ capacity: 1 })
    const first = await anon().rpc('reserve_slot', { p_slot: slot.id, p_prev_token: null })
    expect(first.error).toBeNull()

    const released = await anon().rpc('release_hold', { p_token: first.data.token })
    expect(released.error).toBeNull()

    const second = await anon().rpc('reserve_slot', { p_slot: slot.id, p_prev_token: null })
    expect(second.error).toBeNull()
  })

  it('reserving with a previous token swaps instead of stacking holds', async () => {
    const slotA = await makeSlot({ capacity: 1 })
    const slotB = await makeSlot({ capacity: 1 })
    const client = anon()

    const first = await client.rpc('reserve_slot', { p_slot: slotA.id, p_prev_token: null })
    expect(first.error).toBeNull()

    const second = await client.rpc('reserve_slot', { p_slot: slotB.id, p_prev_token: first.data.token })
    expect(second.error).toBeNull()

    const { data: oldHold } = await admin.from('slot_holds').select('released').eq('token', first.data.token).single()
    expect(oldHold?.released).toBe(true)

    // slotA's seat is free again since the old hold was released by the swap.
    const rebook = await anon().rpc('reserve_slot', { p_slot: slotA.id, p_prev_token: null })
    expect(rebook.error).toBeNull()
  })

  it('available_slots subtracts an active hold from seats_left', async () => {
    const slot = await makeSlot({ capacity: 1 })
    const before = await admin.rpc('available_slots', { p_track: 'facilitator', p_orientation: 'december', p_year: 2026 })
    const beforeRow = before.data?.find((s: { id: string }) => s.id === slot.id)
    expect(beforeRow?.seats_left).toBe(1)

    await anon().rpc('reserve_slot', { p_slot: slot.id, p_prev_token: null })

    const after = await admin.rpc('available_slots', { p_track: 'facilitator', p_orientation: 'december', p_year: 2026 })
    const afterRow = after.data?.find((s: { id: string }) => s.id === slot.id)
    expect(afterRow?.seats_left).toBe(0)
  })

  it('a duplicate-email rejection at confirm does not consume the hold, so a retry can succeed', async () => {
    const slotA = await makeSlot({ capacity: 1 })
    const slotB = await makeSlot({ capacity: 1 })
    const client = anon()
    const sharedEmail = `carol_${Date.now()}@test.local`

    // Book slotA outright so sharedEmail already has an active booking in this track/orientation/year.
    const firstHold = await client.rpc('reserve_slot', { p_slot: slotA.id, p_prev_token: null })
    expect(firstHold.error).toBeNull()
    const firstBooking = await client.rpc('confirm_reservation', {
      p_token: firstHold.data.token,
      p_name: 'Carol Applicant',
      p_student_id: 'AC220003',
      p_email: sharedEmail,
      p_experiences: 'N/A',
    })
    expect(firstBooking.error).toBeNull()

    // Hold slotB, then try to confirm it with the same email — should be
    // rejected for the duplicate, but the hold itself must survive.
    const secondHold = await client.rpc('reserve_slot', { p_slot: slotB.id, p_prev_token: null })
    expect(secondHold.error).toBeNull()

    const rejected = await client.rpc('confirm_reservation', {
      p_token: secondHold.data.token,
      p_name: 'Carol Applicant',
      p_student_id: 'AC220004',
      p_email: sharedEmail,
      p_experiences: 'N/A',
    })
    expect(rejected.error).not.toBeNull()
    expect(rejected.error?.message).toMatch(/already has an active booking/i)

    const { data: hold } = await admin.from('slot_holds').select('released').eq('token', secondHold.data.token).single()
    expect(hold?.released).toBe(false)

    // Retry with a different email on the SAME still-live hold — succeeds.
    const retried = await client.rpc('confirm_reservation', {
      p_token: secondHold.data.token,
      p_name: 'Carol Applicant',
      p_student_id: 'AC220004',
      p_email: `carol2_${Date.now()}@test.local`,
      p_experiences: 'N/A',
    })
    expect(retried.error).toBeNull()
    expect(retried.data?.status).toBe('booked')
  })
})
```

- [ ] **Step 4: Run the tests**

Plain `npm test` does NOT load `.env.local` (`vitest.config.ts` has no env-loading step — same reason the pre-existing `tests/rpc/booking.test.ts` and `tests/rpc/audit.test.ts` self-skip under plain `npm test`), so it would silently report these tests as skipped rather than passing. Run instead, matching how `npm run migrate`/`npm run seed` already load env vars in this repo:

Run: `node --env-file=.env.local node_modules/.bin/vitest run tests/rpc/slot-holds.test.ts`
Expected: all 7 tests PASS (real network call to the live Supabase project — confirm the output shows actual pass/fail counts, not "skipped").

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0034_slot_holds.sql tests/rpc/slot-holds.test.ts
git commit -m "feat: add slot hold reservation RPCs (reserve/confirm/release)"
```

---

## Task 2: Countdown formatting helper

**Files:**
- Modify: `lib/booking-helpers.ts`
- Test: `tests/booking-helpers.test.ts`

**Interfaces:**
- Produces: `formatCountdown(msRemaining: number): string` — formats as `"M:SS"`, clamped at `"0:00"` for zero/negative input.

- [ ] **Step 1: Write the failing test**

Add to `tests/booking-helpers.test.ts` (new `describe` block, alongside the existing ones):

```typescript
import { formatCountdown } from '@/lib/booking-helpers'

describe('formatCountdown', () => {
  it('formats whole minutes', () => {
    expect(formatCountdown(180_000)).toBe('3:00')
  })

  it('pads single-digit seconds', () => {
    expect(formatCountdown(65_000)).toBe('1:05')
  })

  it('floors partial seconds', () => {
    expect(formatCountdown(5_400)).toBe('0:05')
  })

  it('clamps zero and negative values to 0:00', () => {
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(-1000)).toBe('0:00')
  })
})
```

(Add `formatCountdown` to the existing `import { ... } from '@/lib/booking-helpers'` at the top of the file rather than a second import statement.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/booking-helpers.test.ts`
Expected: FAIL — `formatCountdown` is not exported from `@/lib/booking-helpers`.

- [ ] **Step 3: Implement**

Add to `lib/booking-helpers.ts` (after `formatDateHeading`, end of file):

```typescript
/** Formats milliseconds remaining as "M:SS", clamped at "0:00". */
export function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/booking-helpers.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add lib/booking-helpers.ts tests/booking-helpers.test.ts
git commit -m "feat: add formatCountdown helper for the hold timer"
```

---

## Task 3: Client-side reserve/release calls

**Files:**
- Modify: `lib/bookings.ts`

**Interfaces:**
- Consumes: Task 1's `reserve_slot`, `release_hold` RPCs.
- Produces:
  - `type SlotHold = { hold_id: string; token: string; expires_at: string }`
  - `reserveSlot(slotId: string, prevToken: string | null): Promise<{ data: SlotHold | null; error: { message: string } | null }>`
  - `releaseHold(token: string): Promise<{ error: { message: string } | null }>`

No dedicated unit test file exists for this module today (`getAvailableSlots` and the pre-existing `bookSlotPublic` are both untested thin RPC wrappers — the RPC behavior itself is what Task 1's integration tests cover). This task is verified by the type-check in its own step and by Task 5's browser walkthrough, which exercises these functions live.

- [ ] **Step 1: Add the new functions**

In `lib/bookings.ts`, add after `getAvailableSlots` (leave everything else, including the existing `bookSlotPublic`, untouched):

```typescript
export type SlotHold = {
  hold_id: string
  token: string
  expires_at: string
}

export async function reserveSlot(slotId: string, prevToken: string | null) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('reserve_slot', { p_slot: slotId, p_prev_token: prevToken })
  return { data: (data as SlotHold | null) ?? null, error }
}

export async function releaseHold(token: string) {
  const supabase = createClient()
  const { error } = await supabase.rpc('release_hold', { p_token: token })
  return { error }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/bookings.ts
git commit -m "feat: add reserveSlot/releaseHold client helpers"
```

---

## Task 4: Confirm-reservation server action

**Files:**
- Modify: `app/actions/bookingAction.ts:7-59` (the file's first function, `bookSlotAction` — left in place for now; removed in Task 5 once its last caller is gone)

**Interfaces:**
- Consumes: Task 1's `confirm_reservation` RPC; existing `PublicBookingInput`/`PublicBooking` types (`lib/bookings.ts`); existing `sendBookingConfirmation` (`lib/email.ts`).
- Produces: `confirmReservationAction(token: string, input: PublicBookingInput): Promise<{ data: PublicBooking | null; error: string | null }>`

- [ ] **Step 1: Add the action**

In `app/actions/bookingAction.ts`, add this function directly after `bookSlotAction` (after line 59, before `sendBulkWelcomeEmailsAction`):

```typescript
export async function confirmReservationAction(
  token: string,
  input: PublicBookingInput
): Promise<{ data: PublicBooking | null; error: string | null }> {
  const supabase = await createClient()

  const combinedExperiences = input.experiences.trim() + (input.links?.trim() ? `\n\nRelevant Links:\n${input.links.trim()}` : '')

  const { data, error } = await supabase.rpc('confirm_reservation', {
    p_token: token,
    p_name: input.name,
    p_student_id: input.studentId || null,
    p_email: input.email,
    p_experiences: combinedExperiences,
  })

  if (error || !data) {
    return { data: null, error: error?.message || 'Database booking failed.' }
  }

  const booking = data as PublicBooking

  const { data: slot } = await supabase
    .from('slots')
    .select('starts_at, ends_at, venue')
    .eq('id', booking.slot_id)
    .maybeSingle()

  const bookingDetails = {
    id: booking.id,
    applicant_name: booking.applicant_name,
    applicant_email: booking.applicant_email,
    track: booking.track,
    starts_at: slot?.starts_at || '',
    ends_at: slot?.ends_at || '',
    created_at: booking.created_at,
    venue: slot?.venue || '',
  }

  sendBookingConfirmation(bookingDetails).then((res) => {
    if (res.success) {
      console.log(`Booking confirmation email sent to ${bookingDetails.applicant_email}. MessageId: ${res.messageId}`)
    } else {
      console.warn(`Booking confirmation email failed: ${res.error}`)
    }
  })

  return { data: booking, error: null }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/actions/bookingAction.ts
git commit -m "feat: add confirmReservationAction"
```

---

## Task 5: Wire the hold flow into BookClient

**Files:**
- Modify: `app/book/BookClient.tsx`
- Modify: `app/actions/bookingAction.ts` (remove `bookSlotAction`, now dead)

**Interfaces:**
- Consumes: Task 2's `formatCountdown`; Task 3's `reserveSlot`, `releaseHold`, `SlotHold`; Task 4's `confirmReservationAction`.
- Produces: no new exports — same default `BookClient` component, new internal behavior.

No component-test convention exists in this repo (no React Testing Library test currently covers any part of `BookClient.tsx`, including the existing 3-step wizard) — verification here is a live browser walkthrough, consistent with how the rest of this file's behavior is checked.

- [ ] **Step 1: Imports and new state**

In `app/book/BookClient.tsx`, replace the import block (lines 1-13):

```typescript
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getAvailableSlots, reserveSlot, releaseHold, type Track } from '@/lib/bookings'
import { confirmReservationAction } from '@/app/actions/bookingAction'
import { formatCountdown, formatDateHeading, formatTimeRange, toLocalDateIso, type AvailableSlot } from '@/lib/booking-helpers'
import {
  DEFAULT_ORIENTATION,
  ORIENTATIONS,
  isOrientation,
  type Orientation,
} from '@/lib/orientation'

const HOLD_STORAGE_KEY = 'xmumori-book-hold'
```

(`bookSlotAction` is dropped from this import — replaced by `confirmReservationAction`. The sessionStorage payload's `orientation` field is typed with `Orientation` from `@/lib/orientation` — the same type the component's own `orientation` state already uses — not `lib/bookings.ts`'s separately-declared `Orientation` type, which stays unimported here.)

Then, in the state declarations block (currently lines 116-119), add after the existing `confirmation` state:

```typescript
  const [holdToken, setHoldToken] = useState<string | null>(null)
  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null)
  const [remainingMs, setRemainingMs] = useState<number | null>(null)
  const [reserving, setReserving] = useState(false)
  const [reserveError, setReserveError] = useState<string | null>(null)
  const [holdDead, setHoldDead] = useState(false)
```

- [ ] **Step 2: Restore a hold from sessionStorage on mount, and the countdown ticker**

Add after the existing `isInitialMount` ref declaration (currently line 126), as new standalone effects (do not touch the existing slot-loading `useEffect`):

```typescript
  useEffect(() => {
    const raw = sessionStorage.getItem(HOLD_STORAGE_KEY)
    if (!raw) return
    try {
      const saved = JSON.parse(raw) as {
        token: string
        expiresAt: number
        slotId: string
        track: Track
        orientation: Orientation
      }
      if (saved.expiresAt <= Date.now()) {
        sessionStorage.removeItem(HOLD_STORAGE_KEY)
        return
      }
      setHoldToken(saved.token)
      setHoldExpiresAt(saved.expiresAt)
      setTrack(saved.track)
      setOrientation(saved.orientation)
      setSelectedId(saved.slotId)
      setStep(2)
    } catch {
      sessionStorage.removeItem(HOLD_STORAGE_KEY)
    }
    // Runs once on mount only — restoring a hold shouldn't re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (step !== 2 || !holdExpiresAt) {
      setRemainingMs(null)
      return
    }
    const tick = () => setRemainingMs(Math.max(0, holdExpiresAt - Date.now()))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [step, holdExpiresAt])

  // If a restored hold's slot no longer exists in the freshly loaded list
  // (e.g. an admin deleted it while the hold was active), don't strand the
  // applicant on a blank step 2 — bounce back to the picker.
  useEffect(() => {
    if (step === 2 && !loading && !slots.find((s) => s.id === selectedId)) {
      setStep(1)
    }
  }, [step, loading, slots, selectedId])

  const holdExpired = remainingMs !== null && remainingMs <= 0
  const holdLocked = holdExpired || holdDead

  function clearHold() {
    setHoldToken(null)
    setHoldExpiresAt(null)
    setRemainingMs(null)
    setHoldDead(false)
    sessionStorage.removeItem(HOLD_STORAGE_KEY)
  }
```

- [ ] **Step 3: Replace `confirmBooking` with the hold-aware version**

Replace the existing `confirmBooking` function (currently lines 184-215):

```typescript
  async function confirmBooking() {
    if (!selectedSlot || !holdToken) return
    setShowErrors(true)
    setSubmitError(null)
    if (formInvalid) return

    setSubmitting(true)
    const { data, error } = await confirmReservationAction(holdToken, {
      name: name.trim(),
      studentId: studentId.trim(),
      email: email.trim(),
      experiences: experiences.trim(),
      links: links.trim(),
    })
    setSubmitting(false)

    if (data) {
      clearHold()
      setConfirmation({
        name: data.applicant_name,
        studentId: studentId.trim(),
        email: email.trim(),
        track,
        slot: selectedSlot,
      })
      setStep(3)
      return
    }

    // A duplicate email/student ID is user-fixable — the hold is still alive
    // (confirm_reservation only releases it on success), so let them retry.
    if (error?.includes('already has an active booking')) {
      setSubmitError(error)
      return
    }

    // Anything else means the hold itself is dead (expired, or the slot/
    // window changed under it) — retrying Confirm would just fail the same
    // way again, so lock the form instead of leaving a misleading retry path.
    setHoldDead(true)
    setSubmitError(error ?? 'Your hold expired. That seat may be gone.')
  }

  async function goBackToStep1() {
    if (holdToken) {
      await releaseHold(holdToken)
    }
    clearHold()
    setStep(1)
    setSubmitError(null)
    loadSlots()
  }

  async function reserveAndContinue() {
    if (!selectedSlot) return
    setReserving(true)
    setReserveError(null)
    const { data, error } = await reserveSlot(selectedSlot.id, holdToken)
    setReserving(false)

    if (!data) {
      setReserveError(error?.message ?? 'That slot was just taken — pick another.')
      loadSlots()
      return
    }

    const expiresAt = new Date(data.expires_at).getTime()
    setHoldToken(data.token)
    setHoldExpiresAt(expiresAt)
    sessionStorage.setItem(
      HOLD_STORAGE_KEY,
      JSON.stringify({ token: data.token, expiresAt, slotId: selectedSlot.id, track, orientation }),
    )
    setStep(2)
  }
```

(`reserveAndContinue` and `goBackToStep1` are new; `confirmBooking` replaces the old body in place.)

- [ ] **Step 4: Update `bookAnother` to clear hold state too**

Replace the existing `bookAnother` function (currently lines 217-229) — same body, with one added line:

```typescript
  function bookAnother() {
    setConfirmation(null)
    setName('')
    setStudentId('')
    setEmail('')
    setExperiences('')
    setLinks('')
    setFilterDate('')
    setShowErrors(false)
    setSubmitError(null)
    clearHold()
    setStep(1)
    loadSlots()
  }
```

- [ ] **Step 5: Wire the step-1 "Continue" button and its error banner**

Replace the step-1 bottom action bar (currently lines 418-433):

```tsx
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13.5px', color: selectedSlot ? '#334155' : '#94A3B8', fontWeight: selectedSlot ? 600 : 400 }}>
              {selectedSlot
                ? `${formatDateHeading(toLocalDateIso(selectedSlot.starts_at))} · ${formatTimeRange(selectedSlot.starts_at, selectedSlot.ends_at)}`
                : 'Select a slot to continue'}
            </span>
            <button
              type="button"
              disabled={!selectedSlot || reserving}
              onClick={reserveAndContinue}
              style={{ padding: '12px 22px', borderRadius: '11px', border: 'none', color: '#fff', fontWeight: 700, fontSize: '14.5px', background: selectedSlot && !reserving ? '#2563EB' : '#CBD5E1', cursor: selectedSlot && !reserving ? 'pointer' : 'not-allowed', boxShadow: selectedSlot && !reserving ? '0 8px 18px -7px rgba(37,99,235,.5)' : 'none' }}
            >
              {reserving ? 'Holding your seat…' : 'Continue →'}
            </button>
          </div>

          {reserveError && (
            <div style={{ marginTop: '12px', padding: '11px 14px', borderRadius: '10px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: '13.5px', fontWeight: 600 }}>
              {reserveError}
            </div>
          )}
```

- [ ] **Step 6: Add the countdown / locked banner and wire the Back button**

Replace the step-2 header line (currently line 440):

```tsx
            <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 14px', letterSpacing: '-.01em' }}>Your details</h2>
```

with:

```tsx
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 14px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0, letterSpacing: '-.01em' }}>Your details</h2>
              {!holdLocked && remainingMs !== null && (
                <span style={{ fontSize: '13px', fontWeight: 700, color: remainingMs < 30_000 ? '#B91C1C' : '#2563EB', background: remainingMs < 30_000 ? '#FEF2F2' : '#EFF4FF', padding: '5px 10px', borderRadius: '99px' }}>
                  Seat held · {formatCountdown(remainingMs)}
                </span>
              )}
            </div>

            {holdLocked && (
              <div style={{ marginBottom: '14px', padding: '11px 14px', borderRadius: '10px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: '13.5px', fontWeight: 600 }}>
                Your hold expired — that seat may be gone.
              </div>
            )}
```

Then replace the field inputs' `disabled` state — add `disabled={holdLocked}` to each of the four inputs/textarea (`bk-name`, `bk-student-id`, `bk-email`, `bk-experience`; the optional `bk-links` input too), e.g. the name input (currently line 444):

```tsx
                <input id="bk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aisha Rahman" style={fieldStyle} disabled={holdLocked} />
```

(repeat the same `disabled={holdLocked}` addition on the `bk-student-id`, `bk-email`, `bk-experience`, and `bk-links` elements at their current lines 450, 455, 462-468, and 475).

Finally, replace the step-2 bottom action bar (currently lines 485-497 — the inner action-bar `<div>...</div>`; line 498's closing `</div>` belongs to the outer card wrapper and must stay untouched):

```tsx
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', gap: '12px', flexWrap: 'wrap' }}>
              <button type="button" onClick={goBackToStep1} style={{ padding: '11px 18px', borderRadius: '10px', border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
                {holdLocked ? 'Choose another slot' : '← Back'}
              </button>
              {!holdLocked && (
                <button
                  type="button"
                  onClick={confirmBooking}
                  disabled={submitting}
                  style={{ padding: '12px 22px', borderRadius: '11px', border: 'none', color: '#fff', fontWeight: 700, fontSize: '14.5px', background: submitting ? '#CBD5E1' : '#16A34A', cursor: submitting ? 'not-allowed' : 'pointer', boxShadow: submitting ? 'none' : '0 8px 18px -7px rgba(22,163,74,.45)' }}
                >
                  {submitting ? 'Booking…' : 'Confirm booking'}
                </button>
              )}
            </div>
```

(`goBackToStep1` now handles both the deliberate Back click and the locked-state "Choose another slot" click — both release the hold and return to a fresh step 1.)

- [ ] **Step 7: Remove the now-dead `bookSlotAction`**

In `app/actions/bookingAction.ts`, delete only the `bookSlotAction` function body — everything from `export async function bookSlotAction(` (originally line 7) down through its matching closing `}` (originally line 59) — and nothing else. Leave the file's `'use server'` directive and imports (lines 1-5) alone: `confirmReservationAction` (added in Task 4) and `sendBulkWelcomeEmailsAction` both still need them.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (confirms no other file still imports `bookSlotAction`).

- [ ] **Step 9: Manual verification in the browser**

Start the dev server preview and walk through:
1. Open `/book`, pick a track and slot, click **Continue →** — confirm it shows "Holding your seat…" briefly, then step 2 loads with a **"Seat held · 2:59"**-style badge counting down.
2. Open the same page in a second tab, same track — confirm the seat you just held shows one fewer in "seats left" than before.
3. Click **← Back** in the first tab — confirm you land on step 1, and the second tab's seat count goes back up after it reloads.
4. Reserve again, fill in the form, click **Confirm booking** — confirm it succeeds and reaches step 3.
5. (Optional, if time allows) Reserve a slot, wait for the badge to reach **0:00** — confirm the form locks, the fields disable, and the "Your hold expired" banner + "Choose another slot" button appear.

- [ ] **Step 10: Commit**

```bash
git add app/book/BookClient.tsx app/actions/bookingAction.ts
git commit -m "feat: reserve a slot on Continue, add hold countdown to step 2"
```

---

## Task 6: Retire `book_slot_public`

**Files:**
- Create: `supabase/migrations/0035_drop_book_slot_public.sql`
- Modify: `lib/bookings.ts` (remove the dead `bookSlotPublic` export)

**Interfaces:** none — pure removal, nothing else references either.

This is the "separate, non-blocking cleanup step" called out in the spec's migration strategy. Safe only after Task 5 ships, since that's what removes `book_slot_public`'s last caller (`bookSlotAction`, deleted in Task 5 Step 7). `bookSlotPublic` in `lib/bookings.ts` was already dead code before this plan (nothing imported it — confirmed by search) — it existed only as a browser-callable twin of the RPC being dropped here.

- [ ] **Step 1: Write the drop migration**

Create `supabase/migrations/0035_drop_book_slot_public.sql`:

```sql
-- 0035_drop_book_slot_public.sql
-- book_slot_public is superseded by reserve_slot + confirm_reservation
-- (0034). Nothing calls it anymore — BookClient.tsx now goes through the
-- hold flow instead of one-shot booking.
drop function if exists book_slot_public(uuid, text, text, text, text);

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply it**

Run: `npm run migrate`
Expected: `• applying 0035_drop_book_slot_public.sql ... ok`

- [ ] **Step 3: Remove the dead TS export**

In `lib/bookings.ts`, delete the `bookSlotPublic` function (the block starting `export async function bookSlotPublic(slotId: string, input: PublicBookingInput) {` through its closing `}`).

- [ ] **Step 4: Confirm nothing broke**

Run: `npx tsc --noEmit && node --env-file=.env.local node_modules/.bin/vitest run`
(plain `npm test` does not load `.env.local` — see Task 1 Step 4's note — so use the `--env-file` form here too, to actually exercise the RPC integration tests against the live project rather than silently skipping them.)

Expected: typecheck clean. `tests/rpc/slot-holds.test.ts` (Task 1) passes in full — it doesn't touch `book_slot_public` at all. `tests/rpc/booking.test.ts` has 4 pre-existing failures unrelated to this change (`cancel_booking`/`reschedule_booking` erroring with "more than one row returned by a subquery used as an expression" — their `track_settings` lookup predates the `orientation_year` migration and was never updated; confirmed present on `main` before this plan's first commit). That file tests the legacy authenticated `book_slot` RPC, not `book_slot_public` — so it's unaffected by this task either way. Do not attempt to fix those 4 failures; they're out of scope for this plan. Every other test file should pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0035_drop_book_slot_public.sql lib/bookings.ts
git commit -m "chore: drop the superseded book_slot_public RPC"
```
