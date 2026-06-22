# Interview Slot Booking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Two-sided interview booking — Heads open slots, applicants self-book, two tracks (Facilitator / Game Master).

**Architecture:** Next.js (App Router) full-stack on Supabase. Postgres holds data; booking goes through a locking RPC so a slot never overbooks. RLS isolates each Head to their own track.

**Tech Stack:** Next.js + TypeScript, Tailwind + shadcn/ui, Supabase (Postgres + Auth), Vercel.

Spec: [2026-06-22-interview-booking-design.md](../specs/2026-06-22-interview-booking-design.md)

---

## File map

- `app/` — routes: `(auth)/login`, `(auth)/register`, `book/`, `my-bookings/`, `head/` (dashboard)
- `lib/supabase/` — client + server Supabase helpers
- `lib/bookings.ts` — booking actions (call RPCs)
- `supabase/migrations/*.sql` — schema, RLS, RPCs
- `tests/` — unit (booking rules) + integration (RPC against local Supabase)

---

### Task 0: Project setup

- [ ] Scaffold: `npx create-next-app@latest` (TS, Tailwind, App Router); add shadcn/ui.
- [ ] `npm i @supabase/supabase-js @supabase/ssr`; add Vitest.
- [ ] `npx supabase init`; start local stack (`npx supabase start`).
- [ ] `.env.local` with Supabase URL + anon key. Deploy hello-world to Vercel.
- [ ] Commit: `chore: scaffold next.js + supabase`.

### Task 1: Database schema

**Files:** Create `supabase/migrations/0001_schema.sql`

- [ ] Write schema + the one-per-track guard:

```sql
create type track as enum ('facilitator','game_master');
create type slot_status as enum ('open','closed');
create type booking_status as enum ('booked','cancelled');
create type user_role as enum ('applicant','head_facilitator','head_gm','admin');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null, student_id text, email text not null,
  role user_role not null default 'applicant'
);

create table slots (
  id uuid primary key default gen_random_uuid(),
  track track not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int not null check (capacity > 0),
  status slot_status not null default 'open',
  created_by uuid references profiles(id)
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references slots(id),
  applicant_id uuid not null references profiles(id),
  track track not null,
  status booking_status not null default 'booked',
  created_at timestamptz not null default now()
);
-- max one ACTIVE booking per applicant per track
create unique index one_active_booking_per_track
  on bookings (applicant_id, track) where status = 'booked';

create table track_settings (
  track track primary key,
  window_open timestamptz, window_close timestamptz,
  reschedule_cutoff_hours int not null default 2
);
insert into track_settings(track) values ('facilitator'),('game_master');
```

- [ ] Apply: `npx supabase db reset`. Commit.

### Task 2: RLS policies

**Files:** Create `supabase/migrations/0002_rls.sql`

- [ ] Enable RLS on all tables. Policies:
  - `profiles`: user reads/updates own row; admin all.
  - `slots`: anyone authenticated reads `status='open'`; a Head writes only rows where `track` matches their role; admin all.
  - `bookings`: applicant reads/writes own rows; Head reads rows whose slot track matches their role; admin all.
- [ ] Apply + commit.

### Task 3: Booking RPC (the core — no overbooking)

**Files:** Create `supabase/migrations/0003_book_slot.sql`, `tests/book_slot.test.ts`

- [ ] Write the function:

```sql
create or replace function book_slot(p_slot uuid)
returns bookings language plpgsql security definer as $$
declare s slots; taken int; b bookings; uid uuid := auth.uid();
begin
  select * into s from slots where id = p_slot for update;          -- lock row
  if s is null or s.status <> 'open' then raise exception 'slot unavailable'; end if;
  if not exists (select 1 from track_settings t where t.track = s.track
       and now() between coalesce(t.window_open, now()) and coalesce(t.window_close, now()))
     then raise exception 'booking window closed'; end if;
  select count(*) into taken from bookings where slot_id = p_slot and status='booked';
  if taken >= s.capacity then raise exception 'slot full'; end if;
  insert into bookings(slot_id, applicant_id, track, status)
    values (p_slot, uid, s.track, 'booked') returning * into b;     -- unique index enforces 1/track
  return b;
end $$;
```

- [ ] Tests (run against local Supabase): booking succeeds; concurrent over-capacity fails; second booking same track fails; closed window fails. Verify red→green. Commit.

### Task 4: Cancel / reschedule RPC

**Files:** Create `supabase/migrations/0004_cancel_reschedule.sql`, tests

- [ ] `cancel_booking(p_booking)`: owner-only; allowed only if `now() < starts_at - cutoff`; set status `cancelled`.
- [ ] `reschedule_booking(p_booking, p_new_slot)`: cancel + `book_slot` in one tx, same cutoff rule.
- [ ] Tests: cancel frees a seat; cancel after cutoff fails. Red→green. Commit.

### Task 5: Auth + roles

**Files:** `lib/supabase/{client,server}.ts`, `app/(auth)/register`, `app/(auth)/login`, middleware

- [ ] Supabase browser + server helpers (`@supabase/ssr`).
- [ ] Register form (email, password, name, student_id) → creates `auth.user` + `profiles` row (role `applicant`).
- [ ] Login form; `middleware.ts` protects `/book`, `/my-bookings`, `/head`.
- [ ] Manual test: register, login, session persists. Commit.

### Task 6: Applicant booking UI

**Files:** `app/book/page.tsx`, `app/my-bookings/page.tsx`, `lib/bookings.ts`

- [ ] `/book`: track tabs (Facilitator/GM) → list open slots grouped by date with seats-left → Book button calls `book_slot`.
- [ ] `/my-bookings`: show active bookings; cancel + reschedule buttons (call RPCs); hide actions past cutoff.
- [ ] Show friendly errors (slot full / window closed / one-per-track). Commit.

### Task 7: Head dashboard

**Files:** `app/head/page.tsx`, `app/head/slots/*`, `lib/slots.ts`

- [ ] Role-gated to `head_facilitator` / `head_gm` (or admin); scoped to their track.
- [ ] Bulk-create slots: date + start/end + interval + capacity → insert generated rows.
- [ ] Slot list: edit / delete / close; view bookings per slot; search applicant by name/email.
- [ ] Open/close booking window (edit `track_settings`). Commit.

### Task 8: Seed + deploy

- [ ] Seed script: create admin + the two Head accounts; set roles.
- [ ] Push migrations to hosted Supabase; set Vercel env vars; deploy.
- [ ] Smoke test in prod: register applicant, Head creates slots, applicant books, cancels. Commit + tag `v1.0-mvp`.

---

## Self-review notes

- **Spec coverage:** roles (T1/T5/T7), open self-registration (T5), browse+book one-per-track safe (T1/T3/T6), cancel/reschedule cutoff (T4/T6), Head bulk-create/manage + window (T7), track isolation (T2), deploy/budget (T8). Phase-2 features intentionally excluded.
- **Placeholders:** none — core SQL shown inline; UI tasks describe concrete screens.
- **Type consistency:** enum/table/column names match across T1, T3, T4, T6, T7.
