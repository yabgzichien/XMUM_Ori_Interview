# Account-Free Performance Practice Group Booking Design

**Date:** 2026-09-30  
**Status:** Draft for review

## Overview

Replace the account-based performance-practice flow with a public, roster-verified
booking flow. A December 2026 committee member enters a student ID and the matching
XMU university email, chooses one practice group, and receives an on-screen
confirmation. Committee members do not create accounts and cannot change or cancel
their own booking. Re-entering the same verified details shows the member's group and
practice-session schedule in read-only form.

Only authenticated admins manage the performance-practice roster, groups, sessions,
and member assignments. This restriction applies only to performance practice.
Existing HOF/HOG accounts and permissions for the separate interview-management
dashboard remain unchanged.

The existing practice roster, groups, sessions, and memberships do not need to be
migrated. The replacement performance-practice system starts empty.

## Scope

This design includes:

- An admin-managed committee roster for December 2026.
- Manual roster management and transactional XLSX, CSV, and JSON imports.
- Public student-ID and derived-email verification without accounts.
- One immutable self-service group booking per roster member.
- Read-only group and session lookup after booking.
- Admin management of groups, sessions, and member assignments.
- Database-enforced uniqueness, capacity, and authorization rules.
- Generic verification errors and persistent rate limiting.

This design does not include:

- Committee-member accounts, passwords, magic links, or one-time email codes.
- Member-initiated cancellation, movement, or group departure.
- Performance-lead ownership or management of a group.
- Email confirmation after booking.
- Orientations other than December 2026.
- Migration of existing practice data.
- Changes to interview booking or HOF/HOG interview-management access.

## Roles and permissions

### Committee member

A committee member has no application account. An active roster record plus a
matching XMU email allows the member to:

- View open December 2026 groups after verification.
- See only each group's name and remaining capacity.
- Book exactly one group.
- Re-verify later to view the booked group and its sessions.

A committee member cannot view other members, change groups, cancel a booking, or
perform management actions.

### Admin

An authenticated admin can:

- Add, edit, deactivate, and reactivate roster members.
- Validate and apply roster imports.
- Create, update, open, close, and delete practice groups.
- Create, update, and delete practice sessions.
- View group members.
- Assign an active, unbooked roster member to a group.
- Move a booked member to another group.
- Remove a member's booking.

HOF, HOG, and other authenticated staff roles have no performance-practice management
permissions. Their permissions elsewhere in the application are unaffected.

## Data model

The replacement schema is deliberately independent of `auth.users` and `profiles`
for committee-member identity.

### `committee_roster`

| Column | Purpose |
|---|---|
| `id uuid primary key` | Stable internal member identity. |
| `name text not null` | Display name for admins. |
| `student_id text not null` | XMU student ID, stored trimmed and compared case-insensitively. |
| `position text not null` | Must match a configured `committee_positions.value`. |
| `orientation orientation not null default 'december'` | Fixed to `december` in this version. |
| `orientation_year int not null default 2026` | Fixed to `2026` in this version. |
| `active boolean not null default true` | Controls public verification eligibility. |
| `created_at`, `updated_at` | Audit timestamps. |

A case-insensitive unique index on `student_id` prevents duplicate people. The table
does not store an email address. A valid university email is derived from the student
ID as `{student_id}@xmu.edu.my`.

Deactivation is the normal roster-removal operation. It prevents future verification
but does not delete an existing group booking. The admin must remove that booking
separately.

### `practice_groups`

| Column | Purpose |
|---|---|
| `id uuid primary key` | Group identity. |
| `name text not null` | Public group name. |
| `capacity int not null` | Positive maximum number of bookings. |
| `status slot_status not null default 'open'` | Whether public booking is allowed. |
| `orientation orientation not null default 'december'` | Fixed to `december`. |
| `orientation_year int not null default 2026` | Fixed to `2026`. |
| `created_by uuid not null` | Admin profile that created the group. |
| `created_at`, `updated_at` | Audit timestamps. |

There is no `lead_id`. A group is managed by admins rather than a performance lead.
Group names are unique within the December 2026 scope.

### `practice_group_bookings`

| Column | Purpose |
|---|---|
| `id uuid primary key` | Booking identity. |
| `group_id uuid not null` | Selected practice group. |
| `roster_member_id uuid not null unique` | Roster member; enforces one booking. |
| `source text not null` | `self_service` or `admin`. |
| `assigned_by uuid` | Admin profile for admin-created or moved assignments; null for self-service. |
| `created_at`, `updated_at` | Booking and last-change timestamps. |

Capacity is not enforced by a simple constraint because it depends on the number of
rows in a group. All booking, assignment, and movement operations therefore use
transactional database functions that lock the target group before counting members.

### `practice_sessions`

Sessions retain the current core fields: group, start time, end time, and location.
Only admins may create, update, or delete them. The database rejects an end time that
is not after its start time.

### Practice-data reset

The migration may drop and recreate the existing practice membership, session, and
group tables and replace their RPCs because the approved rollout starts empty. It
must not delete `profiles`, authentication users, interview slots, interview
bookings, or any other non-practice data.

## Identity verification

Input normalization is identical in both verification and booking operations:

1. Trim surrounding whitespace from the student ID and email.
2. Compare values case-insensitively.
3. Look up an active roster row by normalized student ID.
4. Construct the expected email as
   `lower(normalized_student_id) || '@xmu.edu.my'`.
5. Require the normalized submitted email to exactly equal the expected email.

For example, `DSC2344112` and `dsc2344112@xmu.edu.my` are a valid pair. Addresses on
other domains, aliases, added subdomains, and email local parts that do not exactly
match the student ID are rejected.

Unknown IDs, inactive IDs, and mismatched emails all return the same public message:

> Student ID or university email could not be verified.

The public API never indicates whether a particular student ID exists.

## Public booking flow

The `/practice` route becomes public and has four states.

### 1. Verification

The page initially shows fields for student ID and university email. No group data is
loaded or displayed before successful backend verification.

### 2. Selection or existing booking

If the verified member has no booking, the response contains open December 2026
groups with only:

- Group ID for selection.
- Group name.
- Remaining spaces.

Member names, positions, roster size, and session details are not returned during
selection.

If the verified member already has a booking, the response instead contains the
member's group name and that group's sessions. The view is read-only and has no move,
leave, or cancel action.

### 3. Confirmation

Selecting a group opens a confirmation step. Confirming sends the selected group plus
the student ID and email to the backend again. The backend never trusts the prior
verification response and repeats identity, status, uniqueness, group-status, and
capacity checks.

### 4. Success

The page shows an on-screen success message and the booked group. No email is sent.
Refreshing or revisiting the page returns to the verification form; credentials and
verification results are not persisted in browser storage or cookies.

If another member takes the final space before confirmation, the request returns a
specific group-full response and the page refreshes the available group list. A
closed or deleted group is handled similarly without creating a booking.

## Server and database boundaries

The browser never queries `committee_roster` or practice tables directly. The public
UI uses two Next.js server-controlled endpoints:

- `POST /api/practice/verify` accepts student ID and email and returns either the
  minimal available-group list or the caller's existing booking and sessions.
- `POST /api/practice/book` accepts student ID, email, and group ID and returns the
  new booking confirmation.

Both endpoints use server-only database access and set `Cache-Control: no-store`.
They do not include credentials in URLs and do not log request bodies.

The booking endpoint calls a database function that performs the following in one
transaction:

1. Normalize and verify the roster identity.
2. Reject an inactive member.
3. Lock the target group row.
4. Confirm the group exists, is open, and is in December 2026.
5. Confirm the member has no existing booking.
6. Count current bookings and reject a full group.
7. Insert the booking.

The unique roster-member constraint remains the final defense against simultaneous
duplicate submissions. The group lock serializes competing requests for the final
space and prevents overbooking.

Direct public table access is denied by RLS. Public callers also receive no direct
execution grant for administrative practice functions.

## Verification rate limiting

Failed verification is limited to 10 attempts per network address in a rolling
15-minute window. The implementation stores an HMAC-derived address fingerprint,
not the raw address, with the attempt time. The HMAC secret remains server-only.
Successful requests are not recorded as failures.

Once the limit is reached, verification and booking endpoints return HTTP 429 with:

> Too many verification attempts. Try again later.

Expired rate-limit rows may be removed lazily during later requests; no scheduled job
is required. Rate-limit responses reveal no roster information.

## Admin roster management

The authenticated admin area gains a performance-practice roster view. Manual entry
requires `name`, `student_id`, and `position`. Student IDs are normalized before
uniqueness checks. Positions are selected from the existing admin-configurable
committee-position list.

Admins may edit a member, deactivate or reactivate access, and see whether the member
has a group booking. Editing a student ID preserves the roster UUID and therefore
preserves any booking.

## Roster imports

The importer accepts:

- `.xlsx`: the first worksheet, with a header row.
- `.csv`: UTF-8 text with a header row.
- `.json`: a top-level array of objects.

Every format uses the exact required fields:

```text
name, student_id, position
```

JSON uses the equivalent shape:

```json
[
  {
    "name": "Example Member",
    "student_id": "DSC2344112",
    "position": "facilitator"
  }
]
```

The admin page provides a downloadable template. Uploads are limited to 5 MB and
5,000 data rows.

Validation checks the complete file before any write:

- Required columns and values are present.
- No unexpected object shape prevents parsing.
- Student IDs are unique within the file, case-insensitively.
- Each position exists in the configured committee-position table.
- The row count and file size are within limits.

The validation response shows all detected errors with row number and field. A valid
file shows counts of new and updated records and requires explicit admin confirmation.
On confirmation, the server reparses and revalidates the same retained browser `File`
object; client-side preview data is never trusted.

Applying an import is one database transaction. Existing records are matched by
case-insensitive student ID and have `name`, `position`, and `active = true` updated.
New records are inserted as active. Records absent from the file are unchanged. Any
validation or write failure rolls back the entire import.

## Admin group and booking management

Admins can create groups with a name and positive capacity, then open or close them.
Reducing capacity below the current booking count is rejected.

Admin assignment uses an active, currently unbooked roster member and an open or
closed target group; group status limits public booking only. Capacity still applies.
Admin movement locks the destination group and refuses a full destination. Removal
deletes only the group booking, leaving the roster member active.

Deleting a group that has bookings is blocked until the admin moves or removes its
members. A group with no bookings may be deleted; its sessions are deleted with it.

## Error handling

| Condition | Public/admin result |
|---|---|
| Unknown, inactive, or mismatched identity | Generic verification failure. |
| More than 10 failed attempts in 15 minutes | HTTP 429 and retry-later message. |
| Member already booked | Return existing booking and sessions; do not create another row. |
| Group filled during confirmation | Explain that the group is now full and refresh choices. |
| Group closed or removed during confirmation | Explain that it is unavailable and refresh choices. |
| Admin assignment for an inactive member | Reject and require reactivation first. |
| Admin movement to a full group | Reject without changing the original booking. |
| Capacity reduced below booking count | Reject without changing the group. |
| Group deletion while bookings exist | Reject and instruct the admin to move or remove members. |
| Invalid import row | Reject the entire import and show all row/field errors. |
| Import write failure | Roll back the entire import and show a general failure message. |

## Frontend changes

### Public practice page

Replace the authenticated `PracticePage`/`PracticeClient` assumptions with the
four-state public flow. Remove member-name lists and all committee-side group/session
management controls. The page remains responsive and accessible: labels are explicit,
errors are associated with inputs, confirmation can be completed by keyboard, and
loading states prevent duplicate submission.

### Admin area

Add admin-only views for:

- Roster list and manual member form.
- Import validation, error report, and confirmation.
- Group list and group editor.
- Session editor per group.
- Member assignment, movement, and removal.

Existing `/head/practice` functionality is replaced or redirected to the admin-only
practice area. Non-admin staff must not gain access through old routes or client-side
links.

### Navigation and middleware

`/practice` must be reachable while logged out. Navigation should label it as the
public performance-practice booking page. Middleware and server-page redirects must
not send public visitors to `/login`. Admin practice routes retain server-side admin
authorization.

## Testing

### Database and API tests

- Student ID lookup is case-insensitive and whitespace-normalized.
- Email matching is case-insensitive and requires exactly
  `{student_id}@xmu.edu.my`.
- Other domains, aliases, suffixes, and mismatched local parts are rejected.
- Unknown and inactive IDs produce the same public error as an email mismatch.
- No group data is returned before verification.
- Selection responses contain no roster or member details.
- A member can hold only one booking.
- Parallel attempts for the final space create only one booking.
- Parallel duplicate submissions for one member create only one booking.
- A repeat verification returns the existing group and sessions read-only.
- Closed, full, deleted, and wrong-scope groups cannot be self-booked.
- Rate limiting blocks the eleventh failed attempt within 15 minutes and expires
  correctly.
- Public users cannot select roster or practice tables directly.
- HOF/HOG cannot call admin practice operations.
- Existing HOF/HOG interview-management access remains intact.

### Import tests

- Valid XLSX, CSV, and JSON files produce the same canonical rows.
- New rows insert and existing case-insensitive student IDs update/reactivate.
- Missing members remain unchanged.
- Duplicate IDs, missing values, unknown positions, malformed files, oversized files,
  and excessive row counts reject the entire import.
- Multiple errors are reported with correct rows and fields.
- A database failure rolls back all changes.

### Admin and UI tests

- Admins can manually add, edit, deactivate, and reactivate roster members.
- Admins can create and manage groups and sessions.
- Admin assignment, movement, and removal enforce activity, uniqueness, and capacity.
- A public member can verify, select, confirm, and see success without an account.
- A returning member sees the booked group and schedule with no mutation controls.
- Full-group and concurrent-change errors refresh the available choices.
- Logged-out visitors can open `/practice` but cannot open admin practice routes.

## Rollout

1. Add the replacement practice schema, roster table, rate-limit storage, RLS, and
   transactional functions in a new migration. Reset only existing practice data.
2. Add server-only verification and booking endpoints.
3. Add roster import parsing and transactional apply logic.
4. Replace the public `/practice` UI.
5. Replace the admin practice management UI and retire old lead/head practice paths.
6. Update middleware and navigation.
7. Run unit, RPC/integration, authorization, concurrency, import, and UI tests.
8. Seed no roster members or groups; the admin creates/imports December 2026 data
   after deployment.

## Accepted trade-offs

- Student ID plus a predictable derived university email is weaker than possession
  verification by email code. This is accepted for the requested first version.
- The first release is intentionally fixed to December 2026. Schema columns remain
  explicit so a future design can add other cycles without conflating their data.
- Practice data restarts empty. This simplifies the incompatible shift away from
  auth-profile membership and performance-lead ownership, at the cost of discarding
  any existing practice-only records.
