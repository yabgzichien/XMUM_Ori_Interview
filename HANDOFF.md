# Handoff — Interview Slot Booking System

## What we're building

A web app for **XMUM Orientation** that lets students book interview slots for two
recruitment tracks — **Facilitator** and **Game Master** — run by the Head of
Facilitators and the Head of Game Masters. It's the first module of a larger
orientation platform, so its auth + database are meant to be reused later.

Two kinds of users:

- **Interviewees** — do **not** log in. They open the booking page, pick a track and an
  open time slot, enter name + student ID + email + experiences, and get a confirmation
  with a reference code.
- **Staff** — log in. Roles: `head_facilitator`, `head_gm`, `admin`. Heads manage slots,
  the booking window, and bookings for **their own track only**. Admin can do everything
  for both tracks and can invite/onboard other staff.

## Tech stack

- **Next.js 16 (App Router) + TypeScript**, **Tailwind CSS v4 + shadcn/ui**
- **Supabase**: Postgres (data), Auth (staff email+password), RLS for isolation
- Booking safety + privileged actions go through **Postgres functions (RPCs)**
- Tests: **Vitest** (pure logic + DB-dependent tests that skip without a live DB)
- Deploy target: **Vercel** (app) + **Supabase cloud** (data). Not yet deployed.

## How it works (the core logic)

### Data model (`supabase/migrations/`)
- `profiles` — one row per **staff** auth user: name, student_id, email, `role`.
  Interviewees have no profile/account.
- `slots` — an interview time slot: `track`, `starts_at`, `ends_at`, `capacity`,
  `status` (`open`/`closed`).
- `bookings` — a booking of a slot. Holds the interviewee's details directly
  (`applicant_name`, `applicant_email`, `student_id`, `experiences`); `applicant_id`
  is nullable (interviewees aren't users). `status` is `booked`/`cancelled`.
  Partial unique index = **one active booking per email per track**.
- `track_settings` — per-track booking **window** (`window_open`/`window_close`) and
  `reschedule_cutoff_hours`.
- `staff_invites` — admin-created invites: email, name, student_id, `role`, `code`
  (shared with the staffer), `claimed_at`.

### Row Level Security (`0002_rls.sql`)
RLS isolates data by role. To avoid policy recursion, the caller's role/track is read
through SECURITY DEFINER helpers: `is_admin()`, `auth_role()`, `auth_managed_track()`
(maps `head_facilitator`→facilitator, `head_gm`→game_master). A trigger
(`prevent_self_role_change`) blocks non-admins from changing roles, but allows
server-side/service-role actions (where `auth.uid()` is null).

### Key RPCs (why they exist: enforce rules + bypass RLS safely)
- `book_slot_public(slot, name, student_id, email, experiences)` — **anonymous**
  booking. Locks the slot row `FOR UPDATE`, checks status/window/capacity, enforces the
  one-per-email-per-track rule, inserts. This is what prevents overbooking under
  concurrency.
- `available_slots(track)` — open, future slots with seats-left (no identities leaked);
  granted to `anon`.
- `head_slots(track)` / `head_bookings(track)` — dashboard reads, gated to the managing
  Head or admin; `head_bookings` exposes applicant details + experiences.
- `head_cancel_booking(booking)` — Head/admin cancels a booking (frees the seat).
- `handle_new_user()` — trigger that creates a `profiles` row when a staff auth user is
  created.

### Auth & onboarding
- Interviewees: no auth. The `/book` page uses the Supabase anon client.
- Staff login: Supabase email+password (`/login`). Middleware
  (`lib/supabase/middleware.ts`) protects only `/head` and `/admin`.
- Staff onboarding: admin invites at `/admin` → invite gets a code → staffer activates
  at `/register` (email + code + password). The claim runs server-side at
  `app/api/staff/register/route.ts` using the **service-role key**
  (`lib/supabase/admin.ts`), which validates the invite and assigns the invited role.

## File map (where to look)

```
app/
  page.tsx              Landing (redirects logged-in staff → /head)
  Nav.tsx               Global header; role-aware links + log out
  book/                 Public interviewee flow: BookClient, SlotList, TrackTabs
  (auth)/login          Staff sign-in
  (auth)/register       Staff activation (email + code + password)
  head/                 Staff dashboard: HeadDashboard + WindowForm, BulkCreateForm,
                        SlotsTable, BookingsTable
  admin/                Admin-only: AdminStaff (invite staff, view codes/status)
  api/staff/register    Server claim endpoint (service-role)
  auth/signout          POST → sign out
lib/
  supabase/             client.ts (browser), server.ts (SSR), middleware.ts, admin.ts (service-role)
  auth.ts               getCurrentProfile()
  bookings.ts           interviewee data access (available_slots, book_slot_public)
  head.ts               Head dashboard data access (slots, bookings, window, cancel)
  admin.ts              staff invite data access
  booking-helpers.ts    pure helpers (date/time formatting, isBookable, isPastSlot) — tested
  slot-generation.ts    bulk-create slot time generation — tested
supabase/
  migrations/0001..0010 schema, RLS, RPCs, public booking, staff invites
  all_migrations.sql    all migrations concatenated (paste into SQL Editor)
scripts/
  seed.mjs              create admin + the two Head accounts (idempotent)
  apply-migrations.mjs  apply migrations via a direct DB connection
docs/superpowers/       design spec + implementation plan
```

## Running it locally

1. `npm install`
2. Create a Supabase project; put URL + anon (publishable) key + service-role (secret)
   key in `.env.local` (see `.env.local.example`). For applying migrations locally you
   can also add `SUPABASE_DB_URL`.
3. Apply migrations: paste `supabase/all_migrations.sql` into the Supabase **SQL Editor**,
   or `node --env-file=.env.local scripts/apply-migrations.mjs`, or `supabase db push`.
4. Seed staff: `npm run seed` (admin + 2 Heads; default password `ChangeMe!2026` — change it).
5. `npm run dev` → http://localhost:3000. Verify with `npm run build`, `npm run lint`, `npm test`.

Current cloud project ref: `mpcpvgsfesizbshrdgqs` (migrations + seed already applied there).

## Conventions & gotchas

- **Data layer is off-limits to UI work**: `lib/*` and all RPC names/contracts are stable.
- **No `Date.now()`/`new Date()` directly in component render** — the `react-hooks/purity`
  lint rule fails. Put time logic in helpers (see `booking-helpers.ts`).
- **Slots only show in `/book` if open AND in the future.** The bulk-create form blocks
  past times; the Head SlotsTable greys/tags past slots.
- **Booking window must be open** for a track (set on the Head dashboard) or
  `book_slot_public` rejects with "booking window is closed".
- The Supabase **MCP access token** is in `.mcp.json` (gitignored). Rotate it when done.
- Branch: `master`. Each feature was committed separately; build/lint/tests green at HEAD.

## What's next (not built yet)

- Email notifications (confirmation/reminder), CSV export, attendance/outcome tracking,
  live stats dashboard (these were scoped as Phase 2).
- Admin promote/demote of **existing** users (currently only new invites).
- A frontend UI/UX polish pass (a redesign prompt is prepared separately).
- Production deployment to Vercel.
```
