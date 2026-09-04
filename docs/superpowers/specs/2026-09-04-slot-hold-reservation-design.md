# Slot Hold / Reservation Design

**Date:** 2026-09-04
**Status:** Draft for review
**Builds on:** [2026-06-22-interview-booking-design.md](./2026-06-22-interview-booking-design.md)

## Overview

Today, picking a slot (step 1) is pure client state — nothing is reserved until the
applicant finishes filling in their details and hits Confirm (step 2), which calls
`book_slot_public`. That RPC is transaction-safe (row lock + capacity check), so it
can't overbook — but an applicant can spend several minutes on the form only to have
the slot vanish under them, because nothing held it while they typed.

This adds a temporary **hold**, modeled on movie-ticket seat selection: reserving a
slot at the start of step 2 gives the applicant a 3-minute window to finish and submit
before the seat is released back to the pool.

## State model

A seat is one of three states, tracked across two tables:

- **open** — nothing claims it
- **held** — an applicant is on step 2, clock running (`slot_holds`, new table)
- **booked** — confirmed (`bookings`, unchanged)

A hold is disposable: it either graduates into a booking or goes stale and is ignored.
There is no background job that cleans it up — expiry is computed at read time, not
enforced by a process. This app has no cron/queue infrastructure (Vercel + Supabase,
no Redis), so anything that needed a live timer to fire wouldn't survive a serverless
deploy. Lazy expiry needs none: `active = not released and held_at > now() - interval
'3 minutes'`, checked wherever it matters. Expired hold rows are simply never counted
again; the table grows unbounded but at this app's scale (a seasonal interview tool,
not a consumer product) that's accepted debt, not a real cost.

## Database changes

### New table: `slot_holds`

```sql
create table slot_holds (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references slots(id),
  token uuid not null default gen_random_uuid() unique,
  held_at timestamptz not null default now(),
  released boolean not null default false
);
create index slot_holds_active_idx on slot_holds (slot_id) where not released;
```

No changes to `booking_status` or `slot_status` — a hold is not a booking state, it's
a separate, short-lived claim that never becomes a `bookings` row unless it's confirmed.

## RPC changes

### New: `reserve_slot(p_slot uuid, p_prev_token uuid default null)`

Returns `{hold_id, token, expires_at}`. In one transaction:

1. `select ... for update` on the slot (same pattern as `book_slot_public`).
2. Validate slot exists, `status = 'open'`, booking window is open.
3. `seats_left = capacity - booked_count - active_held_count`; reject if `<= 0`
   (`'slot is full'`).
4. If `p_prev_token` matches a still-active hold, mark it `released = true` — this is
   the **swap**: a caller can only ever hold one active slot at a time. Reserving a
   new one implicitly releases whatever they held before, so there's no dead-end
   state where a stale token blocks a legitimate re-reserve.
5. Insert the new hold row, return its token and computed `expires_at` (`held_at +
   3 minutes`).

### New: `confirm_reservation(p_token uuid, p_name, p_student_id, p_email, p_experiences)`

Returns a `bookings` row, same shape as `book_slot_public` returns today.

1. Look up the hold by token, `for update`.
2. Reject if missing, `released`, or expired — message `'hold expired'`, distinct
   from `'slot is full'` so the frontend can show the right explanation.
3. Re-validate the booking window (defensive; mirrors `book_slot_public`).
4. Insert into `bookings` exactly as `book_slot_public` does today, including the
   existing `unique_violation` handling — email and student ID each have their own
   partial unique index (per track/orientation/year), reported as `'this email
   already has an active booking in this track for this orientation'` or the
   student-ID equivalent depending on which constraint fired.
5. Mark the hold `released = true` in the same transaction.

### New: `release_hold(p_token uuid)`

Marks a hold released. Idempotent — no-op if already released or nonexistent. Called
when an applicant deliberately abandons a hold (Back button).

### Changed: `available_slots`

`seats_left` now also subtracts active held count:

```sql
capacity - booked_count - held_count as seats_left
```

so the step-1 grid reflects reality for everyone browsing, not just confirmed
bookings. Without this, two applicants can both see "1 left," both reserve, and one
gets rejected — the same problem this feature exists to fix, just moved one step
earlier.

### Unchanged: `book_slot_public`

Nothing else calls it (checked — only the flow being replaced here does). It becomes
dead code once `BookClient.tsx` moves to `reserve_slot` + `confirm_reservation`.
Removing it is a cleanup item for the implementation plan, not part of this design.

## Frontend changes (`app/book/BookClient.tsx`)

New state: `holdToken`, `holdExpiresAt`. Persisted to `sessionStorage` so a refresh
mid-step-2 doesn't strand the applicant with an orphaned hold they can't recover.

- **Continue → (step 1 → 2):** becomes async. Calls `reserve_slot(selectedSlot.id,
  holdToken)`. On success, stores the returned token/`expires_at` and advances to
  step 2. On failure (slot filled or held by someone else in the interim), shows an
  inline "that slot was just taken — pick another" message, calls `loadSlots()`, and
  stays on step 1.
- **Step 2:** a visible countdown, ticking from `holdExpiresAt`. `holdExpiresAt` is
  anchored on the *client's own clock* at reserve time (`Date.now() + 3 minutes`),
  not the server's `expires_at` timestamp — a device clock running fast would
  otherwise read a fresh hold as already expired. At zero: the form locks (inputs
  and Confirm disabled), shows "Your hold expired — that seat may be gone," with a
  button back to step 1 that reloads the live list.
- **Back (step 2 → 1):** calls `release_hold(holdToken)`, clears hold state, calls
  `loadSlots()`. This is what keeps the "swap" mechanism from mattering in the common
  case — an applicant who browses, picks, then changes their mind frees the seat
  immediately instead of leaving it artificially unavailable for up to 3 minutes.
- **Confirm:** calls `confirm_reservation(holdToken, ...)` instead of
  `bookSlotAction`/`book_slot_public`. Success/failure handling otherwise unchanged
  from today (step 3, or inline `submitError` + `loadSlots()`).
- **Tab close / crash / dead network:** no explicit release fires. Caught by lazy
  expiry, same as any other abandoned hold — this is the accepted gap, not a bug.

## Error handling

| Condition | Where caught | Message |
|---|---|---|
| Slot full/window closed at reserve time | `reserve_slot` | `'slot is full'` / `'booking window is closed for this track'` |
| Hold expired before confirm | `confirm_reservation` | `'hold expired'` (new, distinct from slot-full) |
| Duplicate email/student ID in track at confirm | `confirm_reservation` | `'this email already has an active booking in this track for this orientation'` or the student-ID equivalent (unchanged from `book_slot_public`) |
| Slot full at confirm time (capacity lowered after the hold was taken) | `confirm_reservation` | `'slot is full'` |
| Release on an already-gone hold | `release_hold` | no-op, no error (idempotent) |

## Known trade-offs (accepted, not deferred)

- **No defense against scripted or multi-session hold-spam.** `reserve_slot` is
  anon-callable with no rate limiting, and the swap mechanism only caps one active
  hold *per browser session*, not per person — several tabs, or a short script
  re-reserving under 3 minutes, could hold every open seat in a track indefinitely.
  Accepted for this audience (a link shared with orientation applicants, not the
  open internet); revisit only if it's actually abused.
- **`slot_holds` grows unbounded.** No sweep/cleanup job. Fine at this app's volume;
  would need revisiting if this pattern were reused somewhere with much higher
  booking-attempt volume.
- **Lazy expiry means a truly abandoned hold (closed tab) still blocks the seat for
  up to 3 minutes**, not instantly. Only a deliberate Back click releases early.

## Testing

Following the existing pattern in `tests/rpc/booking.test.ts` (integration tests
against a real Supabase project, auto-skipped without env vars, testing RPC-level
guarantees directly rather than mocking):

- Reserve → confirm happy path produces a `booked` row and releases the hold.
- Reserve rejects once capacity is exhausted by holds alone (no bookings needed).
- Confirm rejects a token past the 3-minute TTL with `'hold expired'`.
- `release_hold` frees the seat immediately for a second caller's `reserve_slot`.
- Reserving a second slot with a still-active `p_prev_token` releases the first hold
  (swap) and both never show as simultaneously active.
- `available_slots.seats_left` reflects an active hold, not just bookings.

## Migration strategy

1. New migration file (next sequential number after `0033`): creates `slot_holds`,
   adds `reserve_slot`, `confirm_reservation`, `release_hold`, updates
   `available_slots`, grants `execute` on the three new functions to `anon,
   authenticated` (matching the existing grant pattern for public booking RPCs).
2. Update `lib/bookings.ts` / `app/actions/bookingAction.ts` with the new calls.
3. Update `BookClient.tsx` for the two-call flow, countdown UI, and `sessionStorage`
   persistence.
4. Remove `book_slot_public` and its caller once the new flow is verified end-to-end
   (separate cleanup step, not blocking).

## Amendment (2026-09-04) — hardening found by the final review

Two gaps surfaced only once the whole branch was reviewed together (neither was
visible from any single task's diff):

- **`confirm_reservation` had no capacity re-check before inserting.**
  `book_slot_public` had one; the omission here meant an admin lowering a slot's
  capacity while a hold was live (the head dashboard's capacity-lowering guard only
  blocks going below `booked_count`, not `booked_count + held_count`) could let a
  confirm exceed capacity. Fixed by adding `select ... for update` on the slot row
  and a `booked_count >= capacity` check, mirroring `book_slot_public`'s own
  pattern — should have been there from the start. Covered by a new test.
- **`slot_holds.slot_id` had no `on delete cascade`.** Since hold rows persist
  forever (the lazy-expiry, no-sweep design above), any slot that was ever held —
  even after the hold expired or released — became permanently undeletable via the
  head dashboard. Fixed in the same follow-up migration.

Both landed in `supabase/migrations/0036_slot_holds_hardening.sql`.

Also: `BookClient.tsx`'s step-1 seat counts (`openCount`, the date-filter checks,
the per-card "N left" badge) initially kept computing `capacity - booked_count`
instead of reading the RPC's `seats_left` — silently defeating the whole point of
this feature, since a held slot still displayed and behaved as available. Fixed by
switching all five call sites to `seats_left`.
