-- GENERATED FILE — do not edit by hand.
-- Rebuild with: npm run build:migrations
--
-- Every migration in supabase/migrations, concatenated in order. Paste the
-- whole file into the Supabase SQL editor to build a database from scratch.
-- Applying it to an existing database is safe to re-run only if that database
-- is already at the same revision; use scripts/apply-migrations.mjs for
-- incremental upgrades instead.

-- ==========================================
-- MIGRATION: 0001_schema.sql
-- ==========================================

-- 0001_schema.sql
-- Core schema for the interview-slot booking system.
-- Two tracks (facilitator / game_master); applicants self-book slots that have a capacity.

-- ---------- Enums ----------
create type track as enum ('facilitator', 'game_master');
create type slot_status as enum ('open', 'closed');
create type booking_status as enum ('booked', 'cancelled');
create type user_role as enum ('applicant', 'head_facilitator', 'head_gm', 'admin');

-- ---------- profiles ----------
-- One row per auth user. Created on registration (role defaults to applicant).
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  student_id text,
  email text not null,
  role user_role not null default 'applicant'
);

-- ---------- slots ----------
-- An interview time slot for a track, with a capacity (default one-on-one = 1).
create table slots (
  id uuid primary key default gen_random_uuid(),
  track track not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int not null check (capacity > 0),
  status slot_status not null default 'open',
  created_by uuid references profiles(id)
);
create index slots_track_starts_at_idx on slots (track, starts_at);

-- ---------- bookings ----------
-- An applicant's booking of a slot. Capacity is enforced in the booking RPC.
create table bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references slots(id),
  applicant_id uuid not null references profiles(id),
  track track not null,
  status booking_status not null default 'booked',
  created_at timestamptz not null default now()
);
-- At most one ACTIVE (booked) booking per applicant per track.
create unique index one_active_booking_per_track
  on bookings (applicant_id, track) where status = 'booked';
-- Fast capacity counting per slot.
create index bookings_active_slot_idx on bookings (slot_id) where status = 'booked';

-- ---------- track_settings ----------
-- Per-track booking window + reschedule cutoff.
create table track_settings (
  track track primary key,
  window_open timestamptz,
  window_close timestamptz,
  reschedule_cutoff_hours int not null default 2
);
insert into track_settings (track) values ('facilitator'), ('game_master');

-- ==========================================
-- MIGRATION: 0002_rls.sql
-- ==========================================

-- 0002_rls.sql
-- Row Level Security. Track isolation: each Head can only touch their own track;
-- admin sees/does everything; applicants manage only their own data.
--
-- IMPORTANT: policies on `profiles` must not SELECT from `profiles` directly
-- (infinite recursion). We read the caller's role/track via SECURITY DEFINER
-- helper functions, which bypass RLS.

-- ---------- Helper functions ----------
create or replace function auth_role() returns user_role
  language sql security definer stable set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function is_admin() returns boolean
  language sql security definer stable set search_path = public as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false)
$$;

-- Maps a Head role to the single track they manage; null for everyone else.
create or replace function auth_managed_track() returns track
  language sql security definer stable set search_path = public as $$
  select case (select role from profiles where id = auth.uid())
    when 'head_facilitator' then 'facilitator'::track
    when 'head_gm' then 'game_master'::track
    else null end
$$;

-- ---------- Enable RLS ----------
alter table profiles enable row level security;
alter table slots enable row level security;
alter table bookings enable row level security;
alter table track_settings enable row level security;

-- ---------- profiles ----------
create policy "profiles_select_own_or_admin" on profiles
  for select to authenticated
  using (id = auth.uid() or is_admin());

-- Self-registration: a user may create only their own row, as an applicant.
create policy "profiles_insert_self_applicant" on profiles
  for insert to authenticated
  with check (id = auth.uid() and role = 'applicant');

create policy "profiles_insert_admin" on profiles
  for insert to authenticated
  with check (is_admin());

create policy "profiles_update_own_or_admin" on profiles
  for update to authenticated
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

-- Prevent privilege escalation: only an admin may change a profile's role.
create or replace function prevent_self_role_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.role <> old.role and not is_admin() then
    raise exception 'only an admin may change a role';
  end if;
  return new;
end $$;

create trigger profiles_prevent_role_change
  before update on profiles
  for each row execute function prevent_self_role_change();

-- ---------- slots ----------
-- Any authenticated user may browse slots (both tracks).
create policy "slots_select_authenticated" on slots
  for select to authenticated
  using (auth.uid() is not null);

-- Only the managing Head (or admin) may create/edit/remove a track's slots.
create policy "slots_insert_head_or_admin" on slots
  for insert to authenticated
  with check (auth_managed_track() = track or is_admin());

create policy "slots_update_head_or_admin" on slots
  for update to authenticated
  using (auth_managed_track() = track or is_admin())
  with check (auth_managed_track() = track or is_admin());

create policy "slots_delete_head_or_admin" on slots
  for delete to authenticated
  using (auth_managed_track() = track or is_admin());

-- ---------- bookings ----------
-- All mutations go through SECURITY DEFINER RPCs (book/cancel/reschedule),
-- which bypass RLS, so normal users get SELECT only here.
create policy "bookings_select_owner_head_admin" on bookings
  for select to authenticated
  using (
    applicant_id = auth.uid()
    or auth_managed_track() = track
    or is_admin()
  );

-- Admin-only direct writes (RPCs cover the normal paths).
create policy "bookings_insert_admin" on bookings
  for insert to authenticated
  with check (is_admin());

create policy "bookings_update_admin" on bookings
  for update to authenticated
  using (is_admin()) with check (is_admin());

create policy "bookings_delete_admin" on bookings
  for delete to authenticated
  using (is_admin());

-- ---------- track_settings ----------
create policy "track_settings_select_authenticated" on track_settings
  for select to authenticated
  using (auth.uid() is not null);

create policy "track_settings_update_head_or_admin" on track_settings
  for update to authenticated
  using (auth_managed_track() = track or is_admin())
  with check (auth_managed_track() = track or is_admin());

-- ==========================================
-- MIGRATION: 0003_book_slot.sql
-- ==========================================

-- 0003_book_slot.sql
-- The concurrency-safe booking entry point. SECURITY DEFINER so it can insert
-- into bookings regardless of RLS; it enforces all rules itself.
--
-- Guarantees:
--   * never exceeds a slot's capacity (locks the slot row FOR UPDATE)
--   * respects the track's booking window
--   * at most one active booking per applicant per track (partial unique index)

create or replace function book_slot(p_slot uuid)
returns bookings
language plpgsql security definer set search_path = public as $$
declare
  s slots;
  taken int;
  b bookings;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  -- Lock the slot row so concurrent bookings serialize on it.
  select * into s from slots where id = p_slot for update;
  if s is null then
    raise exception 'slot not found';
  end if;
  if s.status <> 'open' then
    raise exception 'slot is not open';
  end if;

  -- Booking window: null bounds mean "always open".
  if not exists (
    select 1 from track_settings t
    where t.track = s.track
      and now() >= coalesce(t.window_open, now())
      and now() <= coalesce(t.window_close, now())
  ) then
    raise exception 'booking window is closed for this track';
  end if;

  -- Capacity check (counts only active bookings).
  select count(*) into taken
  from bookings where slot_id = p_slot and status = 'booked';
  if taken >= s.capacity then
    raise exception 'slot is full';
  end if;

  -- Insert. The partial unique index enforces one active booking per track.
  begin
    insert into bookings (slot_id, applicant_id, track, status)
    values (p_slot, uid, s.track, 'booked')
    returning * into b;
  exception when unique_violation then
    raise exception 'you already have an active booking in this track';
  end;

  return b;
end $$;

-- ==========================================
-- MIGRATION: 0004_cancel_reschedule.sql
-- ==========================================

-- 0004_cancel_reschedule.sql
-- Applicant self-service: cancel and reschedule, both owner-checked and
-- gated by the track's reschedule cutoff. SECURITY DEFINER (bypass RLS,
-- enforce rules in code).

-- Returns true if the booking may still be changed (now is before the cutoff).
create or replace function within_cutoff(p_starts_at timestamptz, p_track track)
returns boolean
language sql stable set search_path = public as $$
  select now() < p_starts_at - (
    (select reschedule_cutoff_hours from track_settings where track = p_track) || ' hours'
  )::interval
$$;

create or replace function cancel_booking(p_booking uuid)
returns bookings
language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  s slots;
  uid uuid := auth.uid();
begin
  select * into b from bookings where id = p_booking for update;
  if b is null then
    raise exception 'booking not found';
  end if;
  if b.applicant_id <> uid and not is_admin() then
    raise exception 'not your booking';
  end if;
  if b.status <> 'booked' then
    raise exception 'booking is not active';
  end if;

  select * into s from slots where id = b.slot_id;
  if not is_admin() and not within_cutoff(s.starts_at, b.track) then
    raise exception 'too late to change this booking';
  end if;

  update bookings set status = 'cancelled' where id = p_booking returning * into b;
  return b;
end $$;

-- Move an active booking to a new slot in the SAME track, atomically.
create or replace function reschedule_booking(p_booking uuid, p_new_slot uuid)
returns bookings
language plpgsql security definer set search_path = public as $$
declare
  old_b bookings;
  s slots;
  new_s slots;
  taken int;
  new_b bookings;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  -- Validate ownership + cutoff on the existing booking.
  select * into old_b from bookings where id = p_booking for update;
  if old_b is null then
    raise exception 'booking not found';
  end if;
  if old_b.applicant_id <> uid and not is_admin() then
    raise exception 'not your booking';
  end if;
  if old_b.status <> 'booked' then
    raise exception 'booking is not active';
  end if;

  select * into s from slots where id = old_b.slot_id;
  if not is_admin() and not within_cutoff(s.starts_at, old_b.track) then
    raise exception 'too late to change this booking';
  end if;

  -- Lock + validate the new slot.
  select * into new_s from slots where id = p_new_slot for update;
  if new_s is null then
    raise exception 'new slot not found';
  end if;
  if new_s.track <> old_b.track then
    raise exception 'cannot reschedule across tracks';
  end if;
  if new_s.status <> 'open' then
    raise exception 'new slot is not open';
  end if;
  if not exists (
    select 1 from track_settings t
    where t.track = new_s.track
      and now() >= coalesce(t.window_open, now())
      and now() <= coalesce(t.window_close, now())
  ) then
    raise exception 'booking window is closed for this track';
  end if;
  select count(*) into taken
  from bookings where slot_id = p_new_slot and status = 'booked';
  if taken >= new_s.capacity then
    raise exception 'new slot is full';
  end if;

  -- Cancel old, then book new (old is no longer 'booked', so the
  -- one-active-booking-per-track index is satisfied).
  update bookings set status = 'cancelled' where id = p_booking;
  insert into bookings (slot_id, applicant_id, track, status)
  values (p_new_slot, old_b.applicant_id, new_s.track, 'booked')
  returning * into new_b;

  return new_b;
end $$;

-- ==========================================
-- MIGRATION: 0005_handle_new_user.sql
-- ==========================================

-- 0005_handle_new_user.sql
-- Auto-create a profiles row whenever a new auth.users row is inserted,
-- using the signup metadata passed via supabase.auth.signUp({ options: { data } }).

create or replace function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, student_id, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    nullif(new.raw_user_meta_data->>'student_id', ''),
    new.email,
    'applicant'
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ==========================================
-- MIGRATION: 0006_available_slots.sql
-- ==========================================

-- 0006_available_slots.sql
-- Applicant-facing slot browsing. Applicants can only SELECT their own rows in
-- `bookings` (see 0002_rls.sql), so they cannot count a slot's occupancy
-- directly. This SECURITY DEFINER function returns OPEN, FUTURE slots for a
-- track along with seat counts only (no applicant identities exposed).

create or replace function available_slots(p_track track)
returns table (
  id uuid,
  track track,
  starts_at timestamptz,
  ends_at timestamptz,
  capacity int,
  booked_count bigint,
  seats_left bigint
)
language sql security definer stable set search_path = public as $$
  select s.id, s.track, s.starts_at, s.ends_at, s.capacity,
         count(b.*) filter (where b.status = 'booked') as booked_count,
         s.capacity - count(b.*) filter (where b.status = 'booked') as seats_left
  from slots s
  left join bookings b on b.slot_id = s.id
  where s.track = p_track and s.status = 'open' and s.starts_at > now()
  group by s.id
  order by s.starts_at
$$;

-- ==========================================
-- MIGRATION: 0007_head_functions.sql
-- ==========================================

-- 0007_head_functions.sql
-- Read functions for the Head dashboard. SECURITY DEFINER so a Head can see
-- applicant identities for THEIR track (RLS otherwise hides other users'
-- profiles). Each function enforces that the caller manages the track (or is admin).

-- All slots for a track (any status, past or future) with current booked count.
create or replace function head_slots(p_track track)
returns table (
  id uuid, track track, starts_at timestamptz, ends_at timestamptz,
  capacity int, status slot_status, booked_count bigint
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (auth_managed_track() = p_track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  return query
    select s.id, s.track, s.starts_at, s.ends_at, s.capacity, s.status,
           count(b.*) filter (where b.status = 'booked') as booked_count
    from slots s
    left join bookings b on b.slot_id = s.id
    where s.track = p_track
    group by s.id
    order by s.starts_at;
end $$;

-- Active bookings for a track, with applicant identity and slot time.
create or replace function head_bookings(p_track track)
returns table (
  booking_id uuid, slot_id uuid, starts_at timestamptz, ends_at timestamptz,
  applicant_name text, applicant_email text, student_id text, created_at timestamptz
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (auth_managed_track() = p_track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  return query
    select b.id, b.slot_id, s.starts_at, s.ends_at,
           p.name, p.email, p.student_id, b.created_at
    from bookings b
    join slots s on s.id = b.slot_id
    join profiles p on p.id = b.applicant_id
    where b.track = p_track and b.status = 'booked'
    order by s.starts_at, p.name;
end $$;

-- ==========================================
-- MIGRATION: 0008_fix_role_change_trigger.sql
-- ==========================================

-- 0008_fix_role_change_trigger.sql
-- Fix: the role-change guard fired even for server-side/service-role operations
-- (e.g. the seed script), where auth.uid() is null and is_admin() is false.
-- Only enforce the guard for an actual authenticated end user; service-role
-- contexts (null auth.uid()) bypass RLS legitimately and may set roles.

create or replace function prevent_self_role_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.role <> old.role and auth.uid() is not null and not is_admin() then
    raise exception 'only an admin may change a role';
  end if;
  return new;
end $$;

-- ==========================================
-- MIGRATION: 0009_public_booking.sql
-- ==========================================

-- 0009_public_booking.sql
-- Interviewees no longer log in. They submit name + student id + email +
-- experiences and pick a slot. Bookings carry these details directly instead of
-- referencing a profile/auth user. Heads/admin can cancel a booking.

-- ---------- bookings: detach from accounts, add applicant details ----------
alter table bookings alter column applicant_id drop not null;
alter table bookings add column applicant_name text;
alter table bookings add column applicant_email text;
alter table bookings add column student_id text;
alter table bookings add column experiences text;

-- One active booking per email per track (was per applicant_id per track).
drop index if exists one_active_booking_per_track;
create unique index one_active_booking_per_email_track
  on bookings (lower(applicant_email), track) where status = 'booked';

-- ---------- public booking RPC (callable by anonymous visitors) ----------
create or replace function book_slot_public(
  p_slot uuid,
  p_name text,
  p_student_id text,
  p_email text,
  p_experiences text
) returns bookings
language plpgsql security definer set search_path = public as $$
declare
  s slots;
  taken int;
  b bookings;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'name is required';
  end if;
  if coalesce(trim(p_email), '') = '' then
    raise exception 'email is required';
  end if;

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
      and now() >= coalesce(t.window_open, now())
      and now() <= coalesce(t.window_close, now())
  ) then
    raise exception 'booking window is closed for this track';
  end if;

  select count(*) into taken
  from bookings where slot_id = p_slot and status = 'booked';
  if taken >= s.capacity then
    raise exception 'slot is full';
  end if;

  begin
    insert into bookings (
      slot_id, applicant_id, track, status,
      applicant_name, applicant_email, student_id, experiences
    )
    values (
      p_slot, null, s.track, 'booked',
      trim(p_name), lower(trim(p_email)), nullif(trim(p_student_id), ''), nullif(trim(p_experiences), '')
    )
    returning * into b;
  exception when unique_violation then
    raise exception 'this email already has an active booking in this track';
  end;

  return b;
end $$;

-- ---------- Head/admin cancel a booking ----------
create or replace function head_cancel_booking(p_booking uuid)
returns bookings
language plpgsql security definer set search_path = public as $$
declare
  b bookings;
begin
  select * into b from bookings where id = p_booking for update;
  if b is null then
    raise exception 'booking not found';
  end if;
  if not (auth_managed_track() = b.track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  if b.status <> 'booked' then
    raise exception 'booking is not active';
  end if;
  update bookings set status = 'cancelled' where id = p_booking returning * into b;
  return b;
end $$;

-- ---------- head_bookings: read details from booking columns + experiences ----------
-- Return columns change, so drop + recreate.
drop function if exists head_bookings(track);
create function head_bookings(p_track track)
returns table (
  booking_id uuid, slot_id uuid, track track, starts_at timestamptz, ends_at timestamptz,
  applicant_name text, applicant_email text, student_id text, experiences text,
  created_at timestamptz
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (auth_managed_track() = p_track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  return query
    select b.id, b.slot_id, b.track, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id, b.experiences, b.created_at
    from bookings b
    join slots s on s.id = b.slot_id
    where b.track = p_track and b.status = 'booked'
    order by s.starts_at, b.applicant_name;
end $$;

-- ---------- Grants: anonymous visitors browse + book ----------
grant execute on function available_slots(track) to anon, authenticated;
grant execute on function book_slot_public(uuid, text, text, text, text) to anon, authenticated;

-- ==========================================
-- MIGRATION: 0010_staff_invites.sql
-- ==========================================

-- 0010_staff_invites.sql
-- Admin pre-registers staff (Heads/Admin). Each invite carries the assigned role
-- and a short code. The staff member then activates the account by setting a
-- password (server-side claim with the service-role key — see app/api/staff/register).

create table staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  student_id text,
  role user_role not null,
  -- shared with the staff member out-of-band; required to claim the account.
  code text not null default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  claimed_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint staff_invites_role_chk check (role in ('head_facilitator', 'head_gm', 'admin'))
);

alter table staff_invites enable row level security;

-- Only admins manage invites from the app. The claim flow reads invites with the
-- service-role key on the server, which bypasses RLS.
create policy "staff_invites_admin_all" on staff_invites
  for all to authenticated
  using (is_admin()) with check (is_admin());

-- ==========================================
-- MIGRATION: 0011_interview_status.sql
-- ==========================================

-- 0011_interview_status.sql
-- Add interview status ('pending', 'failed', 'approved') to bookings.
-- Default is 'pending'.

-- ---------- bookings: add interview_status column ----------
alter table bookings add column if not exists interview_status text not null default 'pending' check (interview_status in ('pending', 'failed', 'approved'));

-- ---------- head_bookings: recreate to return interview_status ----------
drop function if exists head_bookings(track);
create function head_bookings(p_track track)
returns table (
  booking_id uuid, slot_id uuid, starts_at timestamptz, ends_at timestamptz,
  applicant_name text, applicant_email text, student_id text, experiences text,
  created_at timestamptz, interview_status text
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (auth_managed_track() = p_track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  return query
    select b.id, b.slot_id, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id, b.experiences, b.created_at,
           b.interview_status
    from bookings b
    join slots s on s.id = b.slot_id
    where b.track = p_track and b.status = 'booked'
    order by s.starts_at, b.applicant_name;
end $$;

-- ---------- head_update_interview_status: set applicant outcome ----------
create or replace function head_update_interview_status(
  p_booking uuid,
  p_status text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  b bookings;
begin
  select * into b from bookings where id = p_booking;
  if b is null then
    raise exception 'booking not found';
  end if;
  
  if not (auth_managed_track() = b.track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  
  if p_status not in ('pending', 'failed', 'approved') then
    raise exception 'invalid interview status';
  end if;
  
  update bookings set interview_status = p_status where id = p_booking;
end $$;

-- ---------- Grants: head facilitators/admin can invoke status updates ----------
grant execute on function head_update_interview_status(uuid, text) to authenticated;

-- ==========================================
-- MIGRATION: 0012_interview_notes.sql
-- ==========================================

-- 0012_interview_notes.sql
-- Add interview_notes column for Committee member evaluation notes.
-- Also add public lookup and cancel RPCs for the self-service /my-booking portal.

-- ---------- interview_notes column ----------
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS interview_notes text;

-- ---------- public lookup: requires matching email + booking UUID ----------
CREATE OR REPLACE FUNCTION lookup_booking_public(p_email text, p_booking_id uuid)
RETURNS TABLE (
  booking_id uuid,
  track track,
  starts_at timestamptz,
  ends_at timestamptz,
  applicant_name text,
  applicant_email text,
  student_id text,
  interview_status text,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
    SELECT b.id, b.track, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id,
           b.interview_status, b.status::text, b.created_at
    FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    WHERE b.id = p_booking_id
      AND lower(b.applicant_email) = lower(trim(p_email));
END $$;

GRANT EXECUTE ON FUNCTION lookup_booking_public(text, uuid) TO anon, authenticated;

-- ---------- public cancel: requires matching email + booking UUID ----------
CREATE OR REPLACE FUNCTION cancel_booking_public(p_email text, p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b bookings;
BEGIN
  SELECT * INTO b FROM bookings
    WHERE id = p_booking_id
      AND lower(applicant_email) = lower(trim(p_email))
    FOR UPDATE;

  IF b IS NULL THEN
    RAISE EXCEPTION 'booking not found or email does not match';
  END IF;

  IF b.status <> 'booked' THEN
    RAISE EXCEPTION 'this booking is not active';
  END IF;

  UPDATE bookings SET status = 'cancelled' WHERE id = p_booking_id;
END $$;

GRANT EXECUTE ON FUNCTION cancel_booking_public(text, uuid) TO anon, authenticated;

-- ==========================================
-- MIGRATION: 0013_student_id_lookup.sql
-- ==========================================

-- 0013_student_id_lookup.sql
-- Replace the old email+uuid lookup with a student_id-only lookup.
-- Case-insensitive matching (lower() on both sides).
-- Cancel is secured by student_id + booking_id to ensure the requester owns the booking.

-- Drop old signatures so they can be replaced.
DROP FUNCTION IF EXISTS lookup_booking_public(text, uuid);
DROP FUNCTION IF EXISTS cancel_booking_public(text, uuid);

-- ---------- lookup: student_id only (case-insensitive) ----------
CREATE OR REPLACE FUNCTION lookup_booking_public(p_student_id text)
RETURNS TABLE (
  booking_id   uuid,
  track        track,
  starts_at    timestamptz,
  ends_at      timestamptz,
  applicant_name  text,
  applicant_email text,
  student_id   text,
  interview_status text,
  status       text,
  created_at   timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
    SELECT b.id, b.track, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id,
           b.interview_status, b.status::text, b.created_at
    FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    WHERE lower(b.student_id) = lower(trim(p_student_id))
    ORDER BY b.created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION lookup_booking_public(text) TO anon, authenticated;

-- ---------- cancel: secured by student_id + booking_id ----------
CREATE OR REPLACE FUNCTION cancel_booking_public(p_student_id text, p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b bookings;
BEGIN
  SELECT * INTO b FROM bookings
    WHERE id = p_booking_id
      AND lower(student_id) = lower(trim(p_student_id))
    FOR UPDATE;

  IF b IS NULL THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  IF b.status <> 'booked' THEN
    RAISE EXCEPTION 'this booking is not active';
  END IF;

  UPDATE bookings SET status = 'cancelled' WHERE id = p_booking_id;
END $$;

GRANT EXECUTE ON FUNCTION cancel_booking_public(text, uuid) TO anon, authenticated;

-- ==========================================
-- MIGRATION: 0014_orientation.sql
-- ==========================================

-- 0014_orientation.sql
-- Add support for multiple orientations (February, April, December).
-- Each orientation has its own independent set of slots, bookings, and track settings.

-- ---------- New Enum ----------
DO $$ BEGIN
  CREATE TYPE orientation AS ENUM ('february', 'april', 'december');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ---------- Add orientation column to slots ----------
DO $$ BEGIN
  ALTER TABLE slots ADD COLUMN orientation orientation NOT NULL DEFAULT 'february';
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

drop index if exists slots_track_starts_at_idx;
create index slots_track_orientation_starts_at_idx on slots (track, orientation, starts_at);

-- ---------- Add orientation column to bookings ----------
DO $$ BEGIN
  ALTER TABLE bookings ADD COLUMN orientation orientation NOT NULL DEFAULT 'february';
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- Update unique constraint: one active booking per email per track per orientation
drop index if exists one_active_booking_per_email_track;
DO $$ BEGIN
  CREATE UNIQUE INDEX one_active_booking_per_email_track_orientation
    ON bookings (lower(applicant_email), track, orientation) WHERE status = 'booked';
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- ---------- Add orientation column to track_settings ----------
DO $$ BEGIN
  ALTER TABLE track_settings ADD COLUMN orientation orientation NOT NULL DEFAULT 'february';
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- Drop old primary key and create composite primary key
DO $$ BEGIN
  ALTER TABLE track_settings DROP CONSTRAINT track_settings_pkey;
EXCEPTION
  WHEN undefined_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE track_settings ADD PRIMARY KEY (track, orientation);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- Insert default rows for each track+orientation combination
insert into track_settings (track, orientation) values
  ('facilitator', 'february'),
  ('facilitator', 'april'),
  ('facilitator', 'december'),
  ('game_master', 'february'),
  ('game_master', 'april'),
  ('game_master', 'december')
on conflict do nothing;

-- ---------- Update RLS for track_settings ----------
drop policy if exists "track_settings_select_authenticated" on track_settings;
create policy "track_settings_select_authenticated" on track_settings
  for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "track_settings_update_head_or_admin" on track_settings;
create policy "track_settings_update_head_or_admin" on track_settings
  for update to authenticated
  using (auth_managed_track() = track or is_admin())
  with check (auth_managed_track() = track or is_admin());

-- ---------- Update available_slots function ----------
create or replace function available_slots(p_track track, p_orientation orientation)
returns table (
  id uuid,
  track track,
  orientation orientation,
  starts_at timestamptz,
  ends_at timestamptz,
  capacity int,
  booked_count bigint,
  seats_left bigint
)
language sql security definer stable set search_path = public as $$
  select s.id, s.track, s.orientation, s.starts_at, s.ends_at, s.capacity,
         count(b.*) filter (where b.status = 'booked') as booked_count,
         s.capacity - count(b.*) filter (where b.status = 'booked') as seats_left
  from slots s
  left join bookings b on b.slot_id = s.id
  where s.track = p_track and s.orientation = p_orientation and s.status = 'open' and s.starts_at > now()
  group by s.id
  order by s.starts_at
$$;

-- ---------- Update head_slots function ----------
create or replace function head_slots(p_track track, p_orientation orientation)
returns table (
  id uuid, track track, orientation orientation, starts_at timestamptz, ends_at timestamptz,
  capacity int, status slot_status, booked_count bigint
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (auth_managed_track() = p_track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  return query
    select s.id, s.track, s.orientation, s.starts_at, s.ends_at, s.capacity, s.status,
           count(b.*) filter (where b.status = 'booked') as booked_count
    from slots s
    left join bookings b on b.slot_id = s.id
    where s.track = p_track and s.orientation = p_orientation
    group by s.id
    order by s.starts_at;
end $$;

-- ---------- Update head_bookings function ----------
create or replace function head_bookings(p_track track, p_orientation orientation)
returns table (
  booking_id uuid, slot_id uuid, track track, orientation orientation, starts_at timestamptz, ends_at timestamptz,
  applicant_name text, applicant_email text, student_id text, experiences text,
  created_at timestamptz
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (auth_managed_track() = p_track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  return query
    select b.id, b.slot_id, b.track, b.orientation, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id, b.experiences, b.created_at
    from bookings b
    join slots s on s.id = b.slot_id
    where b.track = p_track and b.orientation = p_orientation and b.status = 'booked'
    order by s.starts_at, b.applicant_name;
end $$;

-- ---------- Update book_slot_public function ----------
-- Auto-detect orientation from the slot being booked
create or replace function book_slot_public(
  p_slot uuid,
  p_name text,
  p_student_id text,
  p_email text,
  p_experiences text
) returns bookings
language plpgsql security definer set search_path = public as $$
declare
  s slots;
  taken int;
  b bookings;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'name is required';
  end if;
  if coalesce(trim(p_email), '') = '' then
    raise exception 'email is required';
  end if;

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
      and now() >= coalesce(t.window_open, now())
      and now() <= coalesce(t.window_close, now())
  ) then
    raise exception 'booking window is closed for this track';
  end if;

  select count(*) into taken
  from bookings where slot_id = p_slot and status = 'booked';
  if taken >= s.capacity then
    raise exception 'slot is full';
  end if;

  begin
    insert into bookings (
      slot_id, applicant_id, track, orientation, status,
      applicant_name, applicant_email, student_id, experiences
    )
    values (
      p_slot, null, s.track, s.orientation, 'booked',
      trim(p_name), lower(trim(p_email)), nullif(trim(p_student_id), ''), nullif(trim(p_experiences), '')
    )
    returning * into b;
  exception when unique_violation then
    raise exception 'this email already has an active booking in this track for this orientation';
  end;

  return b;
end $$;

-- ---------- Update grants ----------
grant execute on function available_slots(track, orientation) to anon, authenticated;

-- ==========================================
-- MIGRATION: 0015_fix_head_bookings.sql
-- ==========================================

-- 0015_fix_head_bookings.sql
-- Fix the head_bookings function to return interview_status and interview_notes.

DROP FUNCTION IF EXISTS head_bookings(track, orientation);

CREATE OR REPLACE FUNCTION head_bookings(p_track track, p_orientation orientation)
RETURNS TABLE (
  booking_id uuid,
  slot_id uuid,
  track track,
  orientation orientation,
  starts_at timestamptz,
  ends_at timestamptz,
  applicant_name text,
  applicant_email text,
  student_id text,
  experiences text,
  created_at timestamptz,
  interview_status text,
  interview_notes text
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT (auth_managed_track() = p_track OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized for this track';
  END IF;
  RETURN QUERY
    SELECT b.id, b.slot_id, b.track, b.orientation, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id, b.experiences, b.created_at,
           b.interview_status, b.interview_notes
    FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    WHERE b.track = p_track AND b.orientation = p_orientation AND b.status = 'booked'
    ORDER BY s.starts_at, b.applicant_name;
END $$;

GRANT EXECUTE ON FUNCTION head_bookings(track, orientation) TO authenticated;

-- ==========================================
-- MIGRATION: 0016_practice_groups_schema.sql
-- ==========================================

-- 0016_practice_groups_schema.sql
-- Performance practice groups: committee members join a group led by a
-- performance lead; the lead schedules practice sessions for the group.

-- ---------- Expand user_role (committee, performance_lead) ----------
-- Postgres forbids using a value added via `ALTER TYPE ... ADD VALUE` in the
-- same transaction it was added in, and this migration set is always applied
-- as one transaction (scripts/apply-migrations.mjs, or a single paste into
-- the Supabase SQL editor). So instead of ADD VALUE we create a new enum with
-- every value already listed, swap the columns onto it, then rename it back
-- to `user_role` — same technique 0014 used by introducing a whole new
-- `orientation` type rather than altering `track`.
create type user_role_new as enum (
  'applicant', 'head_facilitator', 'head_gm', 'admin', 'committee', 'performance_lead'
);

drop function if exists auth_role();

-- Postgres refuses to ALTER COLUMN ... TYPE on a column that an RLS policy
-- references directly (not through a helper function). Only one such policy
-- exists (profiles_insert_self_applicant checks `role = 'applicant'` inline)
-- — drop it, do the type swap, then recreate it identically.
drop policy if exists "profiles_insert_self_applicant" on profiles;

-- Same problem for staff_invites_role_chk: a CHECK constraint's compiled
-- expression is bound to the column's type at creation time, so re-validating
-- it against the new type mid-ALTER throws "operator does not exist:
-- user_role_new = user_role". Drop it now, re-add (with 'committee' allowed)
-- once the type swap is done.
alter table staff_invites drop constraint staff_invites_role_chk;

alter table profiles alter column role drop default;
alter table profiles alter column role type user_role_new using role::text::user_role_new;
alter table profiles alter column role set default 'applicant';

alter table staff_invites alter column role type user_role_new using role::text::user_role_new;

drop type user_role;
alter type user_role_new rename to user_role;

create or replace function auth_role() returns user_role
  language sql security definer stable set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create policy "profiles_insert_self_applicant" on profiles
  for insert to authenticated
  with check (id = auth.uid() and role = 'applicant');

-- ---------- profiles: track/orientation for committee-tier accounts ----------
alter table profiles add column track track;
alter table profiles add column orientation orientation;

-- ---------- staff_invites: carry track/orientation; allow 'committee' ----------
alter table staff_invites add column track track;
alter table staff_invites add column orientation orientation;

alter table staff_invites add constraint staff_invites_role_chk
  check (role in ('head_facilitator', 'head_gm', 'admin', 'committee'));

-- ---------- Let a head toggle their own committee members between ----------
-- 'committee' and 'performance_lead' (admin retains full role-change rights).
create or replace function prevent_self_role_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.role <> old.role and not is_admin() then
    if auth_role() in ('head_facilitator', 'head_gm')
       and old.role in ('committee', 'performance_lead')
       and new.role in ('committee', 'performance_lead') then
      return new;
    end if;
    raise exception 'only an admin may change a role';
  end if;
  return new;
end $$;

-- ---------- practice_groups ----------
create table practice_groups (
  id uuid primary key default gen_random_uuid(),
  track track not null,
  orientation orientation not null,
  name text not null,
  lead_id uuid not null unique references profiles(id),
  capacity int not null check (capacity > 0),
  status slot_status not null default 'open',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index practice_groups_track_orientation_idx on practice_groups (track, orientation);

-- ---------- practice_group_members ----------
create table practice_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references practice_groups(id) on delete cascade,
  member_id uuid not null references profiles(id),
  track track not null,
  orientation orientation not null,
  joined_at timestamptz not null default now(),
  unique (group_id, member_id)
);
-- One active group per person per orientation.
create unique index one_active_group_per_member_orientation
  on practice_group_members (member_id, orientation);

-- ---------- practice_sessions ----------
create table practice_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references practice_groups(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint practice_sessions_time_chk check (ends_at > starts_at)
);
create index practice_sessions_group_starts_at_idx on practice_sessions (group_id, starts_at);

-- ---------- RLS ----------
alter table practice_groups enable row level security;
alter table practice_group_members enable row level security;
alter table practice_sessions enable row level security;

-- Direct table reads are head/admin-only (dashboard drill-down convenience).
-- Committee members read via SECURITY DEFINER RPCs only (0017), same split
-- used for `bookings`. All writes go through RPCs regardless of role.
create policy "practice_groups_select_head_or_admin" on practice_groups
  for select to authenticated
  using (auth_managed_track() = track or is_admin());

create policy "practice_group_members_select_head_or_admin" on practice_group_members
  for select to authenticated
  using (auth_managed_track() = track or is_admin());

create policy "practice_sessions_select_head_or_admin" on practice_sessions
  for select to authenticated
  using (
    exists (
      select 1 from practice_groups g
      where g.id = practice_sessions.group_id
        and (auth_managed_track() = g.track or is_admin())
    )
  );

-- ==========================================
-- MIGRATION: 0017_practice_group_functions.sql
-- ==========================================

-- 0017_practice_group_functions.sql
-- RPCs for the performance practice group feature. All SECURITY DEFINER,
-- mirroring book_slot_public/head_* conventions (row locks before capacity
-- checks, raise exception for auth failures). Login-only feature: nothing
-- here is granted to `anon`.

-- ---------- Small helper ----------
create or replace function auth_committee_scope()
returns table (track track, orientation orientation)
language sql security definer stable set search_path = public as $$
  select track, orientation from profiles where id = auth.uid()
$$;

-- ---------- Committee: browse, join, leave ----------
create or replace function available_practice_groups()
returns table (
  id uuid, name text, lead_id uuid, lead_name text, capacity int,
  member_count bigint, seats_left bigint, status slot_status, session_count bigint
)
language plpgsql security definer stable set search_path = public as $$
declare
  scope record;
begin
  if auth_role() not in ('committee', 'performance_lead') then
    raise exception 'not authorized';
  end if;
  select * into scope from auth_committee_scope();
  if scope.track is null or scope.orientation is null then
    raise exception 'no track/orientation on this profile';
  end if;
  return query
    select g.id, g.name, g.lead_id, p.name as lead_name, g.capacity,
           count(m.*) as member_count,
           g.capacity - count(m.*) as seats_left,
           g.status,
           count(distinct s.id) as session_count
    from practice_groups g
    join profiles p on p.id = g.lead_id
    left join practice_group_members m on m.group_id = g.id
    left join practice_sessions s on s.group_id = g.id
    where g.track = scope.track and g.orientation = scope.orientation
    group by g.id, p.name
    order by g.name;
end $$;

create or replace function my_practice_group()
returns table (
  group_id uuid, name text, lead_id uuid, lead_name text, capacity int,
  member_count bigint, status slot_status, is_lead boolean
)
language plpgsql security definer stable set search_path = public as $$
begin
  return query
    select g.id, g.name, g.lead_id, p.name, g.capacity,
           (select count(*) from practice_group_members m2 where m2.group_id = g.id),
           g.status,
           (g.lead_id = auth.uid())
    from practice_groups g
    join profiles p on p.id = g.lead_id
    where g.lead_id = auth.uid()
       or exists (
         select 1 from practice_group_members m
         where m.group_id = g.id and m.member_id = auth.uid()
       )
    limit 1;
end $$;

create or replace function my_practice_group_sessions()
returns table (id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer stable set search_path = public as $$
begin
  return query
    select s.id, s.starts_at, s.ends_at
    from practice_sessions s
    where s.group_id in (
      select g.id from practice_groups g
      where g.lead_id = auth.uid()
         or exists (
           select 1 from practice_group_members m
           where m.group_id = g.id and m.member_id = auth.uid()
         )
    )
    order by s.starts_at;
end $$;

create or replace function my_practice_group_members()
returns table (member_id uuid, member_name text, joined_at timestamptz)
language plpgsql security definer stable set search_path = public as $$
begin
  return query
    select m.member_id, p.name, m.joined_at
    from practice_group_members m
    join profiles p on p.id = m.member_id
    where m.group_id in (
      select g.id from practice_groups g
      where g.lead_id = auth.uid()
         or exists (
           select 1 from practice_group_members m2
           where m2.group_id = g.id and m2.member_id = auth.uid()
         )
    )
    order by m.joined_at;
end $$;

create or replace function join_practice_group(p_group uuid)
returns practice_group_members
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
  taken int;
  scope record;
  row_out practice_group_members;
begin
  if auth_role() <> 'committee' then
    raise exception 'only committee members may join a group';
  end if;
  select * into scope from auth_committee_scope();

  select * into g from practice_groups where id = p_group for update;
  if g is null then
    raise exception 'group not found';
  end if;
  if g.track <> scope.track or g.orientation <> scope.orientation then
    raise exception 'group is not in your track/orientation';
  end if;
  if g.status <> 'open' then
    raise exception 'group is closed';
  end if;

  select count(*) into taken from practice_group_members where group_id = p_group;
  if taken >= g.capacity then
    raise exception 'group is full';
  end if;

  begin
    insert into practice_group_members (group_id, member_id, track, orientation)
    values (p_group, auth.uid(), g.track, g.orientation)
    returning * into row_out;
  exception when unique_violation then
    raise exception 'you have already joined a practice group for this orientation';
  end;

  return row_out;
end $$;

create or replace function leave_practice_group()
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from practice_group_members where member_id = auth.uid();
end $$;

-- ---------- Performance lead: manage own group's sessions ----------
create or replace function lead_create_session(p_group uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns practice_sessions
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
  row_out practice_sessions;
begin
  select * into g from practice_groups where id = p_group;
  if g is null then
    raise exception 'group not found';
  end if;
  if not (g.lead_id = auth.uid() or auth_managed_track() = g.track or is_admin()) then
    raise exception 'not authorized for this group';
  end if;
  insert into practice_sessions (group_id, starts_at, ends_at, created_by)
  values (p_group, p_starts_at, p_ends_at, auth.uid())
  returning * into row_out;
  return row_out;
end $$;

create or replace function lead_update_session(p_session uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns practice_sessions
language plpgsql security definer set search_path = public as $$
declare
  s practice_sessions;
  g practice_groups;
  row_out practice_sessions;
begin
  select * into s from practice_sessions where id = p_session;
  if s is null then
    raise exception 'session not found';
  end if;
  select * into g from practice_groups where id = s.group_id;
  if not (g.lead_id = auth.uid() or auth_managed_track() = g.track or is_admin()) then
    raise exception 'not authorized for this group';
  end if;
  update practice_sessions set starts_at = p_starts_at, ends_at = p_ends_at
  where id = p_session returning * into row_out;
  return row_out;
end $$;

create or replace function lead_delete_session(p_session uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  s practice_sessions;
  g practice_groups;
begin
  select * into s from practice_sessions where id = p_session;
  if s is null then
    raise exception 'session not found';
  end if;
  select * into g from practice_groups where id = s.group_id;
  if not (g.lead_id = auth.uid() or auth_managed_track() = g.track or is_admin()) then
    raise exception 'not authorized for this group';
  end if;
  delete from practice_sessions where id = p_session;
end $$;

-- ---------- Head/admin: manage groups + leads ----------
create or replace function head_practice_groups(p_track track, p_orientation orientation)
returns table (
  id uuid, name text, lead_id uuid, lead_name text, lead_email text, capacity int,
  member_count bigint, status slot_status, session_count bigint, created_at timestamptz
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (auth_managed_track() = p_track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  return query
    select g.id, g.name, g.lead_id, p.name, p.email, g.capacity,
           count(distinct m.id), g.status, count(distinct s.id), g.created_at
    from practice_groups g
    join profiles p on p.id = g.lead_id
    left join practice_group_members m on m.group_id = g.id
    left join practice_sessions s on s.group_id = g.id
    where g.track = p_track and g.orientation = p_orientation
    group by g.id, p.name, p.email
    order by g.created_at;
end $$;

create or replace function head_committee_roster(p_track track, p_orientation orientation)
returns table (id uuid, name text, email text, role user_role, leading_group_id uuid)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (auth_managed_track() = p_track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  return query
    select pr.id, pr.name, pr.email, pr.role, g.id
    from profiles pr
    left join practice_groups g on g.lead_id = pr.id
    where pr.track = p_track and pr.orientation = p_orientation
      and pr.role in ('committee', 'performance_lead')
    order by pr.name;
end $$;

create or replace function head_create_practice_group(
  p_name text, p_track track, p_orientation orientation, p_capacity int, p_lead_profile_id uuid
) returns practice_groups
language plpgsql security definer set search_path = public as $$
declare
  lead_profile profiles;
  row_out practice_groups;
begin
  if not (auth_managed_track() = p_track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  select * into lead_profile from profiles where id = p_lead_profile_id for update;
  if lead_profile is null or lead_profile.role <> 'committee'
     or lead_profile.track <> p_track or lead_profile.orientation <> p_orientation then
    raise exception 'chosen lead must be a committee member in this track and orientation';
  end if;

  update profiles set role = 'performance_lead' where id = p_lead_profile_id;

  begin
    insert into practice_groups (name, track, orientation, capacity, lead_id, created_by)
    values (trim(p_name), p_track, p_orientation, p_capacity, p_lead_profile_id, auth.uid())
    returning * into row_out;
  exception when unique_violation then
    raise exception 'this person already leads a practice group';
  end;

  return row_out;
end $$;

create or replace function head_update_practice_group(
  p_group uuid, p_name text, p_capacity int, p_status slot_status
) returns practice_groups
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
  row_out practice_groups;
begin
  select * into g from practice_groups where id = p_group;
  if g is null then
    raise exception 'group not found';
  end if;
  if not (auth_managed_track() = g.track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  update practice_groups set name = trim(p_name), capacity = p_capacity, status = p_status
  where id = p_group returning * into row_out;
  return row_out;
end $$;

create or replace function head_reassign_practice_lead(p_group uuid, p_new_lead_profile_id uuid)
returns practice_groups
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
  new_lead profiles;
  row_out practice_groups;
begin
  select * into g from practice_groups where id = p_group for update;
  if g is null then
    raise exception 'group not found';
  end if;
  if not (auth_managed_track() = g.track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  select * into new_lead from profiles where id = p_new_lead_profile_id;
  if new_lead is null or new_lead.role <> 'committee'
     or new_lead.track <> g.track or new_lead.orientation <> g.orientation then
    raise exception 'chosen lead must be a committee member in this track and orientation';
  end if;

  update profiles set role = 'committee' where id = g.lead_id;
  update profiles set role = 'performance_lead' where id = p_new_lead_profile_id;

  update practice_groups set lead_id = p_new_lead_profile_id where id = p_group
  returning * into row_out;
  return row_out;
end $$;

create or replace function head_delete_practice_group(p_group uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
begin
  select * into g from practice_groups where id = p_group;
  if g is null then
    raise exception 'group not found';
  end if;
  if not (auth_managed_track() = g.track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  update profiles set role = 'committee' where id = g.lead_id;
  delete from practice_groups where id = p_group;
end $$;

-- ---------- Grants ----------
grant execute on function available_practice_groups() to authenticated;
grant execute on function my_practice_group() to authenticated;
grant execute on function my_practice_group_sessions() to authenticated;
grant execute on function my_practice_group_members() to authenticated;
grant execute on function join_practice_group(uuid) to authenticated;
grant execute on function leave_practice_group() to authenticated;
grant execute on function lead_create_session(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function lead_update_session(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function lead_delete_session(uuid) to authenticated;
grant execute on function head_practice_groups(track, orientation) to authenticated;
grant execute on function head_committee_roster(track, orientation) to authenticated;
grant execute on function head_create_practice_group(text, track, orientation, int, uuid) to authenticated;
grant execute on function head_update_practice_group(uuid, text, int, slot_status) to authenticated;
grant execute on function head_reassign_practice_lead(uuid, uuid) to authenticated;
grant execute on function head_delete_practice_group(uuid) to authenticated;

-- ==========================================
-- MIGRATION: 0018_fix_head_auth_null_safety.sql
-- ==========================================

-- 0018_fix_head_auth_null_safety.sql
-- Fixes an authorization bug found while verifying 0016/0017: checks written
-- as `if not (auth_managed_track() = p_track or is_admin()) then raise
-- exception ...` never raise for a caller whose auth_managed_track() is NULL
-- (anyone who isn't a head for ANY track — i.e. every committee/performance_lead
-- account, and previously every anonymous caller too, since these functions
-- were never explicitly revoked from PUBLIC). In three-valued SQL logic,
-- `NULL or false` is NULL, and `not NULL` is NULL, so `if NULL then raise`
-- never fires. Concretely: a logged-in 'committee' account could call
-- head_create_practice_group(...) directly and self-promote to
-- performance_lead. The same pattern already existed, pre-dating this
-- feature, in head_slots/head_bookings/head_cancel_booking/
-- head_update_interview_status.
--
-- Fix: wrap the possibly-NULL comparison in coalesce(..., false) so it
-- resolves to a real boolean, and explicitly revoke the default PUBLIC
-- execute grant every CREATE FUNCTION implicitly adds, re-granting only to
-- `authenticated` (anon already has no business calling any of these).

-- ---------- Pre-existing interview-booking RPCs ----------

create or replace function head_slots(p_track track, p_orientation orientation)
returns table (
  id uuid, track track, orientation orientation, starts_at timestamptz, ends_at timestamptz,
  capacity int, status slot_status, booked_count bigint
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (coalesce(auth_managed_track() = p_track, false) or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  return query
    select s.id, s.track, s.orientation, s.starts_at, s.ends_at, s.capacity, s.status,
           count(b.*) filter (where b.status = 'booked') as booked_count
    from slots s
    left join bookings b on b.slot_id = s.id
    where s.track = p_track and s.orientation = p_orientation
    group by s.id
    order by s.starts_at;
end $$;

create or replace function head_bookings(p_track track, p_orientation orientation)
returns table (
  booking_id uuid, slot_id uuid, track track, orientation orientation, starts_at timestamptz, ends_at timestamptz,
  applicant_name text, applicant_email text, student_id text, experiences text, created_at timestamptz,
  interview_status text, interview_notes text
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (coalesce(auth_managed_track() = p_track, false) or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  return query
    select b.id, b.slot_id, b.track, b.orientation, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id, b.experiences, b.created_at,
           b.interview_status, b.interview_notes
    from bookings b
    join slots s on s.id = b.slot_id
    where b.track = p_track and b.orientation = p_orientation and b.status = 'booked'
    order by s.starts_at, b.applicant_name;
end $$;

create or replace function head_cancel_booking(p_booking uuid)
returns bookings
language plpgsql security definer set search_path = public as $$
declare
  b bookings;
begin
  select * into b from bookings where id = p_booking for update;
  if b is null then
    raise exception 'booking not found';
  end if;
  if not (coalesce(auth_managed_track() = b.track, false) or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  if b.status <> 'booked' then
    raise exception 'booking is not active';
  end if;
  update bookings set status = 'cancelled' where id = p_booking returning * into b;
  return b;
end $$;

create or replace function head_update_interview_status(
  p_booking uuid,
  p_status text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  b bookings;
begin
  select * into b from bookings where id = p_booking;
  if b is null then
    raise exception 'booking not found';
  end if;

  if not (coalesce(auth_managed_track() = b.track, false) or is_admin()) then
    raise exception 'not authorized for this track';
  end if;

  if p_status not in ('pending', 'failed', 'approved') then
    raise exception 'invalid interview status';
  end if;

  update bookings set interview_status = p_status where id = p_booking;
end $$;

revoke execute on function head_slots(track, orientation) from public;
revoke execute on function head_bookings(track, orientation) from public;
revoke execute on function head_cancel_booking(uuid) from public;
revoke execute on function head_update_interview_status(uuid, text) from public;
grant execute on function head_slots(track, orientation) to authenticated;
grant execute on function head_bookings(track, orientation) to authenticated;
grant execute on function head_cancel_booking(uuid) to authenticated;
grant execute on function head_update_interview_status(uuid, text) to authenticated;

-- ---------- Practice-group RPCs (0017) ----------

create or replace function available_practice_groups()
returns table (
  id uuid, name text, lead_id uuid, lead_name text, capacity int,
  member_count bigint, seats_left bigint, status slot_status, session_count bigint
)
language plpgsql security definer stable set search_path = public as $$
declare
  scope record;
begin
  if coalesce(auth_role() not in ('committee', 'performance_lead'), true) then
    raise exception 'not authorized';
  end if;
  select * into scope from auth_committee_scope();
  if scope.track is null or scope.orientation is null then
    raise exception 'no track/orientation on this profile';
  end if;
  return query
    select g.id, g.name, g.lead_id, p.name as lead_name, g.capacity,
           count(m.*) as member_count,
           g.capacity - count(m.*) as seats_left,
           g.status,
           count(distinct s.id) as session_count
    from practice_groups g
    join profiles p on p.id = g.lead_id
    left join practice_group_members m on m.group_id = g.id
    left join practice_sessions s on s.group_id = g.id
    where g.track = scope.track and g.orientation = scope.orientation
    group by g.id, p.name
    order by g.name;
end $$;

create or replace function my_practice_group()
returns table (
  group_id uuid, name text, lead_id uuid, lead_name text, capacity int,
  member_count bigint, status slot_status, is_lead boolean
)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  return query
    select g.id, g.name, g.lead_id, p.name, g.capacity,
           (select count(*) from practice_group_members m2 where m2.group_id = g.id),
           g.status,
           (g.lead_id = auth.uid())
    from practice_groups g
    join profiles p on p.id = g.lead_id
    where g.lead_id = auth.uid()
       or exists (
         select 1 from practice_group_members m
         where m.group_id = g.id and m.member_id = auth.uid()
       )
    limit 1;
end $$;

create or replace function my_practice_group_sessions()
returns table (id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  return query
    select s.id, s.starts_at, s.ends_at
    from practice_sessions s
    where s.group_id in (
      select g.id from practice_groups g
      where g.lead_id = auth.uid()
         or exists (
           select 1 from practice_group_members m
           where m.group_id = g.id and m.member_id = auth.uid()
         )
    )
    order by s.starts_at;
end $$;

create or replace function my_practice_group_members()
returns table (member_id uuid, member_name text, joined_at timestamptz)
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  return query
    select m.member_id, p.name, m.joined_at
    from practice_group_members m
    join profiles p on p.id = m.member_id
    where m.group_id in (
      select g.id from practice_groups g
      where g.lead_id = auth.uid()
         or exists (
           select 1 from practice_group_members m2
           where m2.group_id = g.id and m2.member_id = auth.uid()
         )
    )
    order by m.joined_at;
end $$;

create or replace function join_practice_group(p_group uuid)
returns practice_group_members
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
  taken int;
  scope record;
  row_out practice_group_members;
begin
  if coalesce(auth_role() <> 'committee', true) then
    raise exception 'only committee members may join a group';
  end if;
  select * into scope from auth_committee_scope();
  if scope.track is null or scope.orientation is null then
    raise exception 'no track/orientation on this profile';
  end if;

  select * into g from practice_groups where id = p_group for update;
  if g is null then
    raise exception 'group not found';
  end if;
  if g.track <> scope.track or g.orientation <> scope.orientation then
    raise exception 'group is not in your track/orientation';
  end if;
  if g.status <> 'open' then
    raise exception 'group is closed';
  end if;

  select count(*) into taken from practice_group_members where group_id = p_group;
  if taken >= g.capacity then
    raise exception 'group is full';
  end if;

  begin
    insert into practice_group_members (group_id, member_id, track, orientation)
    values (p_group, auth.uid(), g.track, g.orientation)
    returning * into row_out;
  exception when unique_violation then
    raise exception 'you have already joined a practice group for this orientation';
  end;

  return row_out;
end $$;

create or replace function leave_practice_group()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from practice_group_members where member_id = auth.uid();
end $$;

create or replace function lead_create_session(p_group uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns practice_sessions
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
  row_out practice_sessions;
begin
  select * into g from practice_groups where id = p_group;
  if g is null then
    raise exception 'group not found';
  end if;
  if not (coalesce(g.lead_id = auth.uid(), false) or coalesce(auth_managed_track() = g.track, false) or is_admin()) then
    raise exception 'not authorized for this group';
  end if;
  insert into practice_sessions (group_id, starts_at, ends_at, created_by)
  values (p_group, p_starts_at, p_ends_at, auth.uid())
  returning * into row_out;
  return row_out;
end $$;

create or replace function lead_update_session(p_session uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns practice_sessions
language plpgsql security definer set search_path = public as $$
declare
  s practice_sessions;
  g practice_groups;
  row_out practice_sessions;
begin
  select * into s from practice_sessions where id = p_session;
  if s is null then
    raise exception 'session not found';
  end if;
  select * into g from practice_groups where id = s.group_id;
  if not (coalesce(g.lead_id = auth.uid(), false) or coalesce(auth_managed_track() = g.track, false) or is_admin()) then
    raise exception 'not authorized for this group';
  end if;
  update practice_sessions set starts_at = p_starts_at, ends_at = p_ends_at
  where id = p_session returning * into row_out;
  return row_out;
end $$;

create or replace function lead_delete_session(p_session uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  s practice_sessions;
  g practice_groups;
begin
  select * into s from practice_sessions where id = p_session;
  if s is null then
    raise exception 'session not found';
  end if;
  select * into g from practice_groups where id = s.group_id;
  if not (coalesce(g.lead_id = auth.uid(), false) or coalesce(auth_managed_track() = g.track, false) or is_admin()) then
    raise exception 'not authorized for this group';
  end if;
  delete from practice_sessions where id = p_session;
end $$;

create or replace function head_practice_groups(p_track track, p_orientation orientation)
returns table (
  id uuid, name text, lead_id uuid, lead_name text, lead_email text, capacity int,
  member_count bigint, status slot_status, session_count bigint, created_at timestamptz
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (coalesce(auth_managed_track() = p_track, false) or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  return query
    select g.id, g.name, g.lead_id, p.name, p.email, g.capacity,
           count(distinct m.id), g.status, count(distinct s.id), g.created_at
    from practice_groups g
    join profiles p on p.id = g.lead_id
    left join practice_group_members m on m.group_id = g.id
    left join practice_sessions s on s.group_id = g.id
    where g.track = p_track and g.orientation = p_orientation
    group by g.id, p.name, p.email
    order by g.created_at;
end $$;

create or replace function head_committee_roster(p_track track, p_orientation orientation)
returns table (id uuid, name text, email text, role user_role, leading_group_id uuid)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (coalesce(auth_managed_track() = p_track, false) or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  return query
    select pr.id, pr.name, pr.email, pr.role, g.id
    from profiles pr
    left join practice_groups g on g.lead_id = pr.id
    where pr.track = p_track and pr.orientation = p_orientation
      and pr.role in ('committee', 'performance_lead')
    order by pr.name;
end $$;

create or replace function head_create_practice_group(
  p_name text, p_track track, p_orientation orientation, p_capacity int, p_lead_profile_id uuid
) returns practice_groups
language plpgsql security definer set search_path = public as $$
declare
  lead_profile profiles;
  row_out practice_groups;
begin
  if not (coalesce(auth_managed_track() = p_track, false) or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  select * into lead_profile from profiles where id = p_lead_profile_id for update;
  if lead_profile is null or lead_profile.role <> 'committee'
     or lead_profile.track <> p_track or lead_profile.orientation <> p_orientation then
    raise exception 'chosen lead must be a committee member in this track and orientation';
  end if;

  update profiles set role = 'performance_lead' where id = p_lead_profile_id;

  begin
    insert into practice_groups (name, track, orientation, capacity, lead_id, created_by)
    values (trim(p_name), p_track, p_orientation, p_capacity, p_lead_profile_id, auth.uid())
    returning * into row_out;
  exception when unique_violation then
    raise exception 'this person already leads a practice group';
  end;

  return row_out;
end $$;

create or replace function head_update_practice_group(
  p_group uuid, p_name text, p_capacity int, p_status slot_status
) returns practice_groups
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
  row_out practice_groups;
begin
  select * into g from practice_groups where id = p_group;
  if g is null then
    raise exception 'group not found';
  end if;
  if not (coalesce(auth_managed_track() = g.track, false) or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  update practice_groups set name = trim(p_name), capacity = p_capacity, status = p_status
  where id = p_group returning * into row_out;
  return row_out;
end $$;

create or replace function head_reassign_practice_lead(p_group uuid, p_new_lead_profile_id uuid)
returns practice_groups
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
  new_lead profiles;
  row_out practice_groups;
begin
  select * into g from practice_groups where id = p_group for update;
  if g is null then
    raise exception 'group not found';
  end if;
  if not (coalesce(auth_managed_track() = g.track, false) or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  select * into new_lead from profiles where id = p_new_lead_profile_id;
  if new_lead is null or new_lead.role <> 'committee'
     or new_lead.track <> g.track or new_lead.orientation <> g.orientation then
    raise exception 'chosen lead must be a committee member in this track and orientation';
  end if;

  update profiles set role = 'committee' where id = g.lead_id;
  update profiles set role = 'performance_lead' where id = p_new_lead_profile_id;

  update practice_groups set lead_id = p_new_lead_profile_id where id = p_group
  returning * into row_out;
  return row_out;
end $$;

create or replace function head_delete_practice_group(p_group uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
begin
  select * into g from practice_groups where id = p_group;
  if g is null then
    raise exception 'group not found';
  end if;
  if not (coalesce(auth_managed_track() = g.track, false) or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  update profiles set role = 'committee' where id = g.lead_id;
  delete from practice_groups where id = p_group;
end $$;

revoke execute on function auth_committee_scope() from public;
revoke execute on function available_practice_groups() from public;
revoke execute on function my_practice_group() from public;
revoke execute on function my_practice_group_sessions() from public;
revoke execute on function my_practice_group_members() from public;
revoke execute on function join_practice_group(uuid) from public;
revoke execute on function leave_practice_group() from public;
revoke execute on function lead_create_session(uuid, timestamptz, timestamptz) from public;
revoke execute on function lead_update_session(uuid, timestamptz, timestamptz) from public;
revoke execute on function lead_delete_session(uuid) from public;
revoke execute on function head_practice_groups(track, orientation) from public;
revoke execute on function head_committee_roster(track, orientation) from public;
revoke execute on function head_create_practice_group(text, track, orientation, int, uuid) from public;
revoke execute on function head_update_practice_group(uuid, text, int, slot_status) from public;
revoke execute on function head_reassign_practice_lead(uuid, uuid) from public;
revoke execute on function head_delete_practice_group(uuid) from public;

-- ---------- Defense in depth: these should never actually be NULL ----------
update practice_groups set created_by = lead_id where created_by is null;
alter table practice_groups alter column created_by set not null;
alter table practice_sessions alter column created_by set not null;

-- ==========================================
-- MIGRATION: 0019_practice_groups_cross_track.sql
-- ==========================================

-- 0019_practice_groups_cross_track.sql
-- Two fixes:
--
-- 1. Practice groups no longer split by track — facilitators and game
--    masters practice together, so a group is scoped by orientation only.
--    Any head (facilitator or GM) or admin manages all practice groups for
--    an orientation, since a group is no longer owned by a single track.
--
-- 2. prevent_self_role_change() blocked ANY role change made through the
--    service-role key (scripts/seed.mjs, app/api/staff/register/route.ts),
--    because auth.uid() is NULL for those calls (confirmed empirically) and
--    the trigger's `not is_admin()` check reads that as "not an admin" and
--    raises. Concretely: a brand-new committee invite could never complete
--    registration. The trigger's actual purpose is stopping a logged-in,
--    non-admin end user from escalating their own role via a normal
--    authenticated client call — a NULL auth.uid() means there is no such
--    end-user session (service role / migrations / this trigger's own
--    SECURITY DEFINER context are already fully trusted), so it should pass.

create or replace function prevent_self_role_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.role <> old.role and auth.uid() is not null and not is_admin() then
    if auth_role() in ('head_facilitator', 'head_gm')
       and old.role in ('committee', 'performance_lead')
       and new.role in ('committee', 'performance_lead') then
      return new;
    end if;
    raise exception 'only an admin may change a role';
  end if;
  return new;
end $$;

-- ---------- Helper: any head or admin (practice groups are cross-track) ----------
create or replace function is_head_or_admin() returns boolean
  language sql security definer stable set search_path = public as $$
  select coalesce((select role in ('head_facilitator', 'head_gm', 'admin') from profiles where id = auth.uid()), false)
$$;

-- ---------- Drop policies that reference the track column before dropping it ----------
drop policy if exists "practice_groups_select_head_or_admin" on practice_groups;
drop policy if exists "practice_group_members_select_head_or_admin" on practice_group_members;
drop policy if exists "practice_sessions_select_head_or_admin" on practice_sessions;

-- ---------- Drop RPC overloads whose signature or return type changes ----------
drop function if exists auth_committee_scope();
drop function if exists head_practice_groups(track, orientation);
drop function if exists head_committee_roster(track, orientation);
drop function if exists head_create_practice_group(text, track, orientation, int, uuid);

drop index if exists practice_groups_track_orientation_idx;
alter table practice_groups drop column track;
alter table practice_group_members drop column track;

create index practice_groups_orientation_idx on practice_groups (orientation);

create policy "practice_groups_select_head_or_admin" on practice_groups
  for select to authenticated using (is_head_or_admin());

create policy "practice_group_members_select_head_or_admin" on practice_group_members
  for select to authenticated using (is_head_or_admin());

create policy "practice_sessions_select_head_or_admin" on practice_sessions
  for select to authenticated using (is_head_or_admin());

-- ---------- Recreate affected RPCs ----------

create or replace function auth_committee_scope()
returns table (orientation orientation)
language sql security definer stable set search_path = public as $$
  select orientation from profiles where id = auth.uid()
$$;

create or replace function available_practice_groups()
returns table (
  id uuid, name text, lead_id uuid, lead_name text, capacity int,
  member_count bigint, seats_left bigint, status slot_status, session_count bigint
)
language plpgsql security definer stable set search_path = public as $$
declare
  caller_orientation orientation;
begin
  if coalesce(auth_role() not in ('committee', 'performance_lead'), true) then
    raise exception 'not authorized';
  end if;
  select orientation into caller_orientation from auth_committee_scope();
  if caller_orientation is null then
    raise exception 'no orientation on this profile';
  end if;
  return query
    select g.id, g.name, g.lead_id, p.name as lead_name, g.capacity,
           count(m.*) as member_count,
           g.capacity - count(m.*) as seats_left,
           g.status,
           count(distinct s.id) as session_count
    from practice_groups g
    join profiles p on p.id = g.lead_id
    left join practice_group_members m on m.group_id = g.id
    left join practice_sessions s on s.group_id = g.id
    where g.orientation = caller_orientation
    group by g.id, p.name
    order by g.name;
end $$;

create or replace function join_practice_group(p_group uuid)
returns practice_group_members
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
  taken int;
  caller_orientation orientation;
  row_out practice_group_members;
begin
  if coalesce(auth_role() <> 'committee', true) then
    raise exception 'only committee members may join a group';
  end if;
  select orientation into caller_orientation from auth_committee_scope();
  if caller_orientation is null then
    raise exception 'no orientation on this profile';
  end if;

  select * into g from practice_groups where id = p_group for update;
  if g is null then
    raise exception 'group not found';
  end if;
  if g.orientation <> caller_orientation then
    raise exception 'group is not in your orientation';
  end if;
  if g.status <> 'open' then
    raise exception 'group is closed';
  end if;

  select count(*) into taken from practice_group_members where group_id = p_group;
  if taken >= g.capacity then
    raise exception 'group is full';
  end if;

  begin
    insert into practice_group_members (group_id, member_id, orientation)
    values (p_group, auth.uid(), g.orientation)
    returning * into row_out;
  exception when unique_violation then
    raise exception 'you have already joined a practice group for this orientation';
  end;

  return row_out;
end $$;

create function head_practice_groups(p_orientation orientation)
returns table (
  id uuid, name text, lead_id uuid, lead_name text, lead_email text, capacity int,
  member_count bigint, status slot_status, session_count bigint, created_at timestamptz
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_head_or_admin() then
    raise exception 'not authorized';
  end if;
  return query
    select g.id, g.name, g.lead_id, p.name, p.email, g.capacity,
           count(distinct m.id), g.status, count(distinct s.id), g.created_at
    from practice_groups g
    join profiles p on p.id = g.lead_id
    left join practice_group_members m on m.group_id = g.id
    left join practice_sessions s on s.group_id = g.id
    where g.orientation = p_orientation
    group by g.id, p.name, p.email
    order by g.created_at;
end $$;

create function head_committee_roster(p_orientation orientation)
returns table (id uuid, name text, email text, track track, role user_role, leading_group_id uuid)
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_head_or_admin() then
    raise exception 'not authorized';
  end if;
  return query
    select pr.id, pr.name, pr.email, pr.track, pr.role, g.id
    from profiles pr
    left join practice_groups g on g.lead_id = pr.id
    where pr.orientation = p_orientation
      and pr.role in ('committee', 'performance_lead')
    order by pr.name;
end $$;

create function head_create_practice_group(
  p_name text, p_orientation orientation, p_capacity int, p_lead_profile_id uuid
) returns practice_groups
language plpgsql security definer set search_path = public as $$
declare
  lead_profile profiles;
  row_out practice_groups;
begin
  if not is_head_or_admin() then
    raise exception 'not authorized';
  end if;
  select * into lead_profile from profiles where id = p_lead_profile_id for update;
  if lead_profile is null or lead_profile.role <> 'committee' or lead_profile.orientation <> p_orientation then
    raise exception 'chosen lead must be a committee member in this orientation';
  end if;

  update profiles set role = 'performance_lead' where id = p_lead_profile_id;

  begin
    insert into practice_groups (name, orientation, capacity, lead_id, created_by)
    values (trim(p_name), p_orientation, p_capacity, p_lead_profile_id, auth.uid())
    returning * into row_out;
  exception when unique_violation then
    raise exception 'this person already leads a practice group';
  end;

  return row_out;
end $$;

create or replace function head_update_practice_group(
  p_group uuid, p_name text, p_capacity int, p_status slot_status
) returns practice_groups
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
  row_out practice_groups;
begin
  if not is_head_or_admin() then
    raise exception 'not authorized';
  end if;
  select * into g from practice_groups where id = p_group;
  if g is null then
    raise exception 'group not found';
  end if;
  update practice_groups set name = trim(p_name), capacity = p_capacity, status = p_status
  where id = p_group returning * into row_out;
  return row_out;
end $$;

create or replace function head_reassign_practice_lead(p_group uuid, p_new_lead_profile_id uuid)
returns practice_groups
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
  new_lead profiles;
  row_out practice_groups;
begin
  if not is_head_or_admin() then
    raise exception 'not authorized';
  end if;
  select * into g from practice_groups where id = p_group for update;
  if g is null then
    raise exception 'group not found';
  end if;
  select * into new_lead from profiles where id = p_new_lead_profile_id;
  if new_lead is null or new_lead.role <> 'committee' or new_lead.orientation <> g.orientation then
    raise exception 'chosen lead must be a committee member in this orientation';
  end if;

  update profiles set role = 'committee' where id = g.lead_id;
  update profiles set role = 'performance_lead' where id = p_new_lead_profile_id;

  update practice_groups set lead_id = p_new_lead_profile_id where id = p_group
  returning * into row_out;
  return row_out;
end $$;

create or replace function head_delete_practice_group(p_group uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
begin
  if not is_head_or_admin() then
    raise exception 'not authorized';
  end if;
  select * into g from practice_groups where id = p_group;
  if g is null then
    raise exception 'group not found';
  end if;
  update profiles set role = 'committee' where id = g.lead_id;
  delete from practice_groups where id = p_group;
end $$;

create or replace function lead_create_session(p_group uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns practice_sessions
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
  row_out practice_sessions;
begin
  select * into g from practice_groups where id = p_group;
  if g is null then
    raise exception 'group not found';
  end if;
  if not (coalesce(g.lead_id = auth.uid(), false) or is_head_or_admin()) then
    raise exception 'not authorized for this group';
  end if;
  insert into practice_sessions (group_id, starts_at, ends_at, created_by)
  values (p_group, p_starts_at, p_ends_at, auth.uid())
  returning * into row_out;
  return row_out;
end $$;

create or replace function lead_update_session(p_session uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns practice_sessions
language plpgsql security definer set search_path = public as $$
declare
  s practice_sessions;
  g practice_groups;
  row_out practice_sessions;
begin
  select * into s from practice_sessions where id = p_session;
  if s is null then
    raise exception 'session not found';
  end if;
  select * into g from practice_groups where id = s.group_id;
  if not (coalesce(g.lead_id = auth.uid(), false) or is_head_or_admin()) then
    raise exception 'not authorized for this group';
  end if;
  update practice_sessions set starts_at = p_starts_at, ends_at = p_ends_at
  where id = p_session returning * into row_out;
  return row_out;
end $$;

create or replace function lead_delete_session(p_session uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  s practice_sessions;
  g practice_groups;
begin
  select * into s from practice_sessions where id = p_session;
  if s is null then
    raise exception 'session not found';
  end if;
  select * into g from practice_groups where id = s.group_id;
  if not (coalesce(g.lead_id = auth.uid(), false) or is_head_or_admin()) then
    raise exception 'not authorized for this group';
  end if;
  delete from practice_sessions where id = p_session;
end $$;

-- ---------- Grants ----------
grant execute on function is_head_or_admin() to authenticated;
grant execute on function auth_committee_scope() to authenticated;
grant execute on function available_practice_groups() to authenticated;
grant execute on function join_practice_group(uuid) to authenticated;
grant execute on function head_practice_groups(orientation) to authenticated;
grant execute on function head_committee_roster(orientation) to authenticated;
grant execute on function head_create_practice_group(text, orientation, int, uuid) to authenticated;
grant execute on function head_update_practice_group(uuid, text, int, slot_status) to authenticated;
grant execute on function head_reassign_practice_lead(uuid, uuid) to authenticated;
grant execute on function head_delete_practice_group(uuid) to authenticated;
grant execute on function lead_create_session(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function lead_update_session(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function lead_delete_session(uuid) to authenticated;

-- ==========================================
-- MIGRATION: 0020_orientation_year_and_committee_isolation.sql
-- ==========================================

-- 0020_orientation_year_and_committee_isolation.sql
-- Add orientation_year support to all orientation tables and isolate committee access.

-- ---------- Add orientation_year column to tables ----------
DO $$ BEGIN
  ALTER TABLE profiles ADD COLUMN orientation_year int NOT NULL DEFAULT 2026;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE staff_invites ADD COLUMN orientation_year int NOT NULL DEFAULT 2026;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE slots ADD COLUMN orientation_year int NOT NULL DEFAULT 2026;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE bookings ADD COLUMN orientation_year int NOT NULL DEFAULT 2026;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE track_settings ADD COLUMN orientation_year int NOT NULL DEFAULT 2026;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE practice_groups ADD COLUMN orientation_year int NOT NULL DEFAULT 2026;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE practice_group_members ADD COLUMN orientation_year int NOT NULL DEFAULT 2026;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- ---------- Constraints & Indexes ----------
DO $$ BEGIN
  ALTER TABLE track_settings DROP CONSTRAINT track_settings_pkey;
EXCEPTION WHEN undefined_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE track_settings ADD PRIMARY KEY (track, orientation, orientation_year);
EXCEPTION WHEN duplicate_table THEN null; END $$;

-- Insert default track_settings rows for 2026 if missing
INSERT INTO track_settings (track, orientation, orientation_year) VALUES
  ('facilitator', 'february', 2026),
  ('facilitator', 'april', 2026),
  ('facilitator', 'december', 2026),
  ('game_master', 'february', 2026),
  ('game_master', 'april', 2026),
  ('game_master', 'december', 2026)
ON CONFLICT DO NOTHING;

DROP INDEX IF EXISTS one_active_booking_per_email_track_orientation;
DO $$ BEGIN
  CREATE UNIQUE INDEX one_active_booking_per_email_track_orientation_year
    ON bookings (lower(applicant_email), track, orientation, orientation_year) WHERE status = 'booked';
EXCEPTION WHEN duplicate_table THEN null; END $$;

DROP INDEX IF EXISTS one_active_group_per_member_orientation;
DO $$ BEGIN
  CREATE UNIQUE INDEX one_active_group_per_member_orientation_year
    ON practice_group_members (member_id, orientation, orientation_year);
EXCEPTION WHEN duplicate_table THEN null; END $$;

DROP INDEX IF EXISTS slots_track_orientation_starts_at_idx;
CREATE INDEX IF NOT EXISTS slots_track_orientation_year_starts_at_idx ON slots (track, orientation, orientation_year, starts_at);

DROP INDEX IF EXISTS practice_groups_orientation_idx;
CREATE INDEX IF NOT EXISTS practice_groups_orientation_year_idx ON practice_groups (orientation, orientation_year);

-- ---------- Helper: auth_committee_scope ----------
DROP FUNCTION IF EXISTS auth_committee_scope();
CREATE OR REPLACE FUNCTION auth_committee_scope()
RETURNS TABLE (orientation orientation, orientation_year int)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT orientation, orientation_year FROM profiles WHERE id = auth.uid()
$$;

-- ---------- RPC Updates ----------
DROP FUNCTION IF EXISTS available_slots(track, orientation);
DROP FUNCTION IF EXISTS available_slots(track, orientation, int);
CREATE OR REPLACE FUNCTION available_slots(p_track track, p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  capacity int, booked_count bigint, seats_left bigint
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT s.id, s.track, s.orientation, s.orientation_year, s.starts_at, s.ends_at, s.capacity,
         count(b.*) FILTER (WHERE b.status = 'booked') AS booked_count,
         s.capacity - count(b.*) FILTER (WHERE b.status = 'booked') AS seats_left
  FROM slots s
  LEFT JOIN bookings b ON b.slot_id = s.id
  WHERE s.track = p_track AND s.orientation = p_orientation AND s.orientation_year = p_year
    AND s.status = 'open' AND s.starts_at > now()
  GROUP BY s.id
  ORDER BY s.starts_at
$$;

DROP FUNCTION IF EXISTS head_slots(track, orientation);
DROP FUNCTION IF EXISTS head_slots(track, orientation, int);
CREATE OR REPLACE FUNCTION head_slots(p_track track, p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  capacity int, status slot_status, booked_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT (auth_managed_track() = p_track OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized for this track';
  END IF;
  RETURN QUERY
    SELECT s.id, s.track, s.orientation, s.orientation_year, s.starts_at, s.ends_at, s.capacity, s.status,
           count(b.*) FILTER (WHERE b.status = 'booked') AS booked_count
    FROM slots s
    LEFT JOIN bookings b ON b.slot_id = s.id
    WHERE s.track = p_track AND s.orientation = p_orientation AND s.orientation_year = p_year
    GROUP BY s.id
    ORDER BY s.starts_at;
END $$;

DROP FUNCTION IF EXISTS head_bookings(track, orientation);
DROP FUNCTION IF EXISTS head_bookings(track, orientation, int);
CREATE OR REPLACE FUNCTION head_bookings(p_track track, p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  booking_id uuid, slot_id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  applicant_name text, applicant_email text, student_id text, experiences text,
  interview_notes text, created_at timestamptz, interview_status text
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT (auth_managed_track() = p_track OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized for this track';
  END IF;
  RETURN QUERY
    SELECT b.id, b.slot_id, b.track, b.orientation, b.orientation_year, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id, b.experiences,
           b.interview_notes, b.created_at, b.interview_status::text
    FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    WHERE b.track = p_track AND b.orientation = p_orientation AND b.orientation_year = p_year AND b.status = 'booked'
    ORDER BY s.starts_at, b.applicant_name;
END $$;

CREATE OR REPLACE FUNCTION book_slot_public(
  p_slot uuid,
  p_name text,
  p_student_id text,
  p_email text,
  p_experiences text
) RETURNS bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s slots;
  taken int;
  b bookings;
BEGIN
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  IF coalesce(trim(p_email), '') = '' THEN
    RAISE EXCEPTION 'email is required';
  END IF;

  SELECT * INTO s FROM slots WHERE id = p_slot FOR UPDATE;
  IF s IS NULL THEN
    RAISE EXCEPTION 'slot not found';
  END IF;
  IF s.status <> 'open' THEN
    RAISE EXCEPTION 'slot is not open';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM track_settings t
    WHERE t.track = s.track
      AND t.orientation = s.orientation
      AND t.orientation_year = s.orientation_year
      AND now() >= coalesce(t.window_open, now())
      AND now() <= coalesce(t.window_close, now())
  ) THEN
    RAISE EXCEPTION 'booking window is closed for this track';
  END IF;

  SELECT count(*) INTO taken
  FROM bookings WHERE slot_id = p_slot AND status = 'booked';
  IF taken >= s.capacity THEN
    RAISE EXCEPTION 'slot is full';
  END IF;

  BEGIN
    INSERT INTO bookings (
      slot_id, applicant_id, track, orientation, orientation_year, status,
      applicant_name, applicant_email, student_id, experiences
    )
    VALUES (
      p_slot, null, s.track, s.orientation, s.orientation_year, 'booked',
      trim(p_name), lower(trim(p_email)), nullif(trim(p_student_id), ''), nullif(trim(p_experiences), '')
    )
    RETURNING * INTO b;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'this email already has an active booking in this track for this orientation';
  END;

  RETURN b;
END $$;

CREATE OR REPLACE FUNCTION available_practice_groups()
RETURNS TABLE (
  id uuid, name text, lead_id uuid, lead_name text, capacity int,
  member_count bigint, seats_left bigint, status slot_status, session_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  caller_orientation orientation;
  caller_year int;
BEGIN
  IF coalesce(auth_role() NOT IN ('committee', 'performance_lead'), true) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT orientation, orientation_year INTO caller_orientation, caller_year FROM auth_committee_scope();
  IF caller_orientation IS NULL THEN
    RAISE EXCEPTION 'no orientation on this profile';
  END IF;
  RETURN QUERY
    SELECT g.id, g.name, g.lead_id, p.name AS lead_name, g.capacity,
           count(m.*) AS member_count,
           g.capacity - count(m.*) AS seats_left,
           g.status,
           count(distinct s.id) AS session_count
    FROM practice_groups g
    JOIN profiles p ON p.id = g.lead_id
    LEFT JOIN practice_group_members m ON m.group_id = g.id
    LEFT JOIN practice_sessions s ON s.group_id = g.id
    WHERE g.orientation = caller_orientation AND g.orientation_year = caller_year
    GROUP BY g.id, p.name
    ORDER BY g.name;
END $$;

CREATE OR REPLACE FUNCTION join_practice_group(p_group uuid)
RETURNS practice_group_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g practice_groups;
  taken int;
  caller_orientation orientation;
  caller_year int;
  row_out practice_group_members;
BEGIN
  IF coalesce(auth_role() <> 'committee', true) THEN
    RAISE EXCEPTION 'only committee members may join a group';
  END IF;
  SELECT orientation, orientation_year INTO caller_orientation, caller_year FROM auth_committee_scope();
  IF caller_orientation IS NULL THEN
    RAISE EXCEPTION 'no orientation on this profile';
  END IF;

  SELECT * INTO g FROM practice_groups WHERE id = p_group FOR UPDATE;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  IF g.orientation <> caller_orientation OR g.orientation_year <> caller_year THEN
    RAISE EXCEPTION 'group is not in your orientation';
  END IF;
  IF g.status <> 'open' THEN
    RAISE EXCEPTION 'group is closed';
  END IF;

  SELECT count(*) INTO taken FROM practice_group_members WHERE group_id = p_group;
  IF taken >= g.capacity THEN
    RAISE EXCEPTION 'group is full';
  END IF;

  BEGIN
    INSERT INTO practice_group_members (group_id, member_id, orientation, orientation_year)
    VALUES (p_group, auth.uid(), g.orientation, g.orientation_year)
    RETURNING * INTO row_out;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'you have already joined a practice group for this orientation';
  END;

  RETURN row_out;
END $$;

DROP FUNCTION IF EXISTS head_practice_groups(orientation);
DROP FUNCTION IF EXISTS head_practice_groups(orientation, int);
CREATE OR REPLACE FUNCTION head_practice_groups(p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  id uuid, name text, lead_id uuid, lead_name text, lead_email text, capacity int,
  member_count bigint, status slot_status, session_count bigint, created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT is_head_or_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
    SELECT g.id, g.name, g.lead_id, p.name, p.email, g.capacity,
           count(distinct m.id), g.status, count(distinct s.id), g.created_at
    FROM practice_groups g
    JOIN profiles p ON p.id = g.lead_id
    LEFT JOIN practice_group_members m ON m.group_id = g.id
    LEFT JOIN practice_sessions s ON s.group_id = g.id
    WHERE g.orientation = p_orientation AND g.orientation_year = p_year
    GROUP BY g.id, p.name, p.email
    ORDER BY g.created_at;
END $$;

DROP FUNCTION IF EXISTS head_committee_roster(orientation);
DROP FUNCTION IF EXISTS head_committee_roster(orientation, int);
CREATE OR REPLACE FUNCTION head_committee_roster(p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (id uuid, name text, email text, track track, role user_role, leading_group_id uuid)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT is_head_or_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
    SELECT pr.id, pr.name, pr.email, pr.track, pr.role, g.id
    FROM profiles pr
    LEFT JOIN practice_groups g ON g.lead_id = pr.id
    WHERE pr.orientation = p_orientation AND pr.orientation_year = p_year
      AND pr.role IN ('committee', 'performance_lead')
    ORDER BY pr.name;
END $$;

DROP FUNCTION IF EXISTS head_create_practice_group(text, orientation, int, uuid);
DROP FUNCTION IF EXISTS head_create_practice_group(text, orientation, int, uuid, int);
CREATE OR REPLACE FUNCTION head_create_practice_group(
  p_name text, p_orientation orientation, p_capacity int, p_lead_profile_id uuid, p_year int DEFAULT 2026
) RETURNS practice_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lead_profile profiles;
  row_out practice_groups;
BEGIN
  IF NOT is_head_or_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO lead_profile FROM profiles WHERE id = p_lead_profile_id FOR UPDATE;
  IF lead_profile IS NULL OR lead_profile.role <> 'committee' OR lead_profile.orientation <> p_orientation OR lead_profile.orientation_year <> p_year THEN
    RAISE EXCEPTION 'chosen lead must be a committee member in this orientation and year';
  END IF;

  UPDATE profiles SET role = 'performance_lead' WHERE id = p_lead_profile_id;

  BEGIN
    INSERT INTO practice_groups (name, orientation, orientation_year, capacity, lead_id, created_by)
    VALUES (trim(p_name), p_orientation, p_year, p_capacity, p_lead_profile_id, auth.uid())
    RETURNING * INTO row_out;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'this person already leads a practice group';
  END;

  RETURN row_out;
END $$;

-- ---------- Grants ----------
GRANT EXECUTE ON FUNCTION available_slots(track, orientation, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION head_slots(track, orientation, int) TO authenticated;
GRANT EXECUTE ON FUNCTION head_bookings(track, orientation, int) TO authenticated;
GRANT EXECUTE ON FUNCTION head_practice_groups(orientation, int) TO authenticated;
GRANT EXECUTE ON FUNCTION head_committee_roster(orientation, int) TO authenticated;
GRANT EXECUTE ON FUNCTION head_create_practice_group(text, orientation, int, uuid, int) TO authenticated;

-- ==========================================
-- MIGRATION: 0021_committee_positions.sql
-- ==========================================

-- 0021_committee_positions.sql
-- Adds an organizational committee "position" (e.g. Treasurer, Secretary,
-- HOF/HOG) to committee-tier profiles. Distinct from `track` (interview
-- track) and `role` (account access level) — this is purely a display label
-- a head/admin assigns, surfaced wherever a group's members are listed.

DO $$ BEGIN
  ALTER TABLE profiles ADD COLUMN position text;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE profiles ADD CONSTRAINT profiles_position_chk
    CHECK (position IS NULL OR position IN (
      'hof', 'hog', 'game_master', 'facilitator', 'treasurer', 'sponsorship',
      'logistic', 'tech_team', 'organising_chairperson', 'event_planner',
      'designer', 'pgvg', 'public_relations', 'secretary'
    ));
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------- head_committee_roster: surface position ----------
DROP FUNCTION IF EXISTS head_committee_roster(orientation, int);
CREATE OR REPLACE FUNCTION head_committee_roster(p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (id uuid, name text, email text, track track, role user_role, "position" text, leading_group_id uuid)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT is_head_or_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
    SELECT pr.id, pr.name, pr.email, pr.track, pr.role, pr.position, g.id
    FROM profiles pr
    LEFT JOIN practice_groups g ON g.lead_id = pr.id
    WHERE pr.orientation = p_orientation AND pr.orientation_year = p_year
      AND pr.role IN ('committee', 'performance_lead')
    ORDER BY pr.name;
END $$;

-- ---------- my_practice_group_members: surface position ----------
DROP FUNCTION IF EXISTS my_practice_group_members();
CREATE OR REPLACE FUNCTION my_practice_group_members()
RETURNS TABLE (member_id uuid, member_name text, "position" text, joined_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  RETURN QUERY
    SELECT m.member_id, p.name, p.position, m.joined_at
    FROM practice_group_members m
    JOIN profiles p ON p.id = m.member_id
    WHERE m.group_id IN (
      SELECT g.id FROM practice_groups g
      WHERE g.lead_id = auth.uid()
         OR EXISTS (
           SELECT 1 FROM practice_group_members m2
           WHERE m2.group_id = g.id AND m2.member_id = auth.uid()
         )
    )
    ORDER BY m.joined_at;
END $$;

-- ---------- head_set_committee_position: assign/change a position ----------
CREATE OR REPLACE FUNCTION head_set_committee_position(p_profile_id uuid, p_position text)
RETURNS profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target profiles;
  row_out profiles;
BEGIN
  IF NOT is_head_or_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO target FROM profiles WHERE id = p_profile_id FOR UPDATE;
  IF target IS NULL OR target.role NOT IN ('committee', 'performance_lead') THEN
    RAISE EXCEPTION 'target must be a committee member';
  END IF;
  UPDATE profiles SET position = p_position WHERE id = p_profile_id
  RETURNING * INTO row_out;
  RETURN row_out;
END $$;

-- ---------- Grants ----------
GRANT EXECUTE ON FUNCTION head_committee_roster(orientation, int) TO authenticated;
GRANT EXECUTE ON FUNCTION my_practice_group_members() TO authenticated;
GRANT EXECUTE ON FUNCTION head_set_committee_position(uuid, text) TO authenticated;

-- ==========================================
-- MIGRATION: 0022_position_grants_head_access.sql
-- ==========================================

-- 0022_position_grants_head_access.sql
-- Makes the "Head of Facilitator (HOF)" / "Head of Game Master (HOG)"
-- committee positions functionally grant the matching head_facilitator /
-- head_gm account role (real /head dashboard access to manage booking slots
-- and interview notes for that track) — not just a cosmetic label. Assigning
-- HOF/HOG to a committee member via head_set_committee_position now promotes
-- their role; moving them off HOF/HOG later reverts it. Every other position
-- (Treasurer, Secretary, etc.) stays purely cosmetic as before.
--
-- Only ever acts on profiles with orientation set (i.e. committee-tier
-- accounts that went through the committee roster), so the two originally
-- seeded head_facilitator/head_gm accounts (orientation is null — they were
-- never part of a committee roster) can never be touched by this function.

-- ---------- prevent_self_role_change: allow head<->committee transitions ----------
-- The existing trigger let a head flip someone between 'committee' and
-- 'performance_lead' without an admin. head_set_committee_position below now
-- also needs to flip into/out of 'head_facilitator'/'head_gm' when a head
-- (not just an admin) assigns/clears the HOF/HOG position.
create or replace function prevent_self_role_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.role <> old.role and auth.uid() is not null and not is_admin() then
    if auth_role() in ('head_facilitator', 'head_gm')
       and old.role in ('committee', 'performance_lead', 'head_facilitator', 'head_gm')
       and new.role in ('committee', 'performance_lead', 'head_facilitator', 'head_gm') then
      return new;
    end if;
    raise exception 'only an admin may change a role';
  end if;
  return new;
end $$;

-- ---------- head_committee_roster: keep HOF/HOG-promoted members visible ----------
DROP FUNCTION IF EXISTS head_committee_roster(orientation, int);
CREATE OR REPLACE FUNCTION head_committee_roster(p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (id uuid, name text, email text, track track, role user_role, "position" text, leading_group_id uuid)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT is_head_or_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
    SELECT pr.id, pr.name, pr.email, pr.track, pr.role, pr.position, g.id
    FROM profiles pr
    LEFT JOIN practice_groups g ON g.lead_id = pr.id
    WHERE pr.orientation = p_orientation AND pr.orientation_year = p_year
      AND pr.role IN ('committee', 'performance_lead', 'head_facilitator', 'head_gm')
    ORDER BY pr.name;
END $$;

-- ---------- head_set_committee_position: sync role for HOF/HOG ----------
CREATE OR REPLACE FUNCTION head_set_committee_position(p_profile_id uuid, p_position text)
RETURNS profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target profiles;
  new_role user_role;
  is_leading boolean;
  row_out profiles;
BEGIN
  IF NOT is_head_or_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO target FROM profiles WHERE id = p_profile_id FOR UPDATE;
  IF target IS NULL OR target.orientation IS NULL
     OR target.role NOT IN ('committee', 'performance_lead', 'head_facilitator', 'head_gm') THEN
    RAISE EXCEPTION 'target must be a committee member';
  END IF;

  new_role := target.role;

  IF p_position = 'hof' THEN
    new_role := 'head_facilitator';
  ELSIF p_position = 'hog' THEN
    new_role := 'head_gm';
  ELSIF target.position IN ('hof', 'hog') AND target.role IN ('head_facilitator', 'head_gm') THEN
    -- Moving off a HOF/HOG position they were previously auto-promoted into:
    -- fall back to performance_lead if they still lead a group, else committee.
    SELECT EXISTS (SELECT 1 FROM practice_groups WHERE lead_id = p_profile_id) INTO is_leading;
    new_role := CASE WHEN is_leading THEN 'performance_lead' ELSE 'committee' END;
  END IF;

  UPDATE profiles SET position = p_position, role = new_role WHERE id = p_profile_id
  RETURNING * INTO row_out;
  RETURN row_out;
END $$;

-- ---------- Grants ----------
GRANT EXECUTE ON FUNCTION head_committee_roster(orientation, int) TO authenticated;
GRANT EXECUTE ON FUNCTION head_set_committee_position(uuid, text) TO authenticated;

-- ==========================================
-- MIGRATION: 0023_admin_only_practice_governance.sql
-- ==========================================

-- 0023_admin_only_practice_governance.sql
-- Locks committee-position and performance-lead management down to admin
-- only. Previously any head (facilitator or GM) could grant another
-- committee member HOF/HOG (and therefore real head-dashboard access) via
-- head_set_committee_position, and could create/reassign/delete practice
-- groups and their leads. Group housekeeping (rename/capacity/status) is
-- also restricted to admin now — heads get view-only access to existing
-- groups. In exchange, the performance lead gets a new self-service RPC to
-- edit their own group's name/capacity, alongside the session management
-- they already had.

-- ---------- head_set_committee_position: admin only ----------
CREATE OR REPLACE FUNCTION head_set_committee_position(p_profile_id uuid, p_position text)
RETURNS profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target profiles;
  new_role user_role;
  is_leading boolean;
  row_out profiles;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO target FROM profiles WHERE id = p_profile_id FOR UPDATE;
  IF target IS NULL OR target.orientation IS NULL
     OR target.role NOT IN ('committee', 'performance_lead', 'head_facilitator', 'head_gm') THEN
    RAISE EXCEPTION 'target must be a committee member';
  END IF;

  new_role := target.role;

  IF p_position = 'hof' THEN
    new_role := 'head_facilitator';
  ELSIF p_position = 'hog' THEN
    new_role := 'head_gm';
  ELSIF target.position IN ('hof', 'hog') AND target.role IN ('head_facilitator', 'head_gm') THEN
    SELECT EXISTS (SELECT 1 FROM practice_groups WHERE lead_id = p_profile_id) INTO is_leading;
    new_role := CASE WHEN is_leading THEN 'performance_lead' ELSE 'committee' END;
  END IF;

  UPDATE profiles SET position = p_position, role = new_role WHERE id = p_profile_id
  RETURNING * INTO row_out;
  RETURN row_out;
END $$;

-- ---------- head_create_practice_group: admin only ----------
CREATE OR REPLACE FUNCTION head_create_practice_group(
  p_name text, p_orientation orientation, p_capacity int, p_lead_profile_id uuid, p_year int DEFAULT 2026
) RETURNS practice_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lead_profile profiles;
  row_out practice_groups;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO lead_profile FROM profiles WHERE id = p_lead_profile_id FOR UPDATE;
  IF lead_profile IS NULL OR lead_profile.role <> 'committee' OR lead_profile.orientation <> p_orientation OR lead_profile.orientation_year <> p_year THEN
    RAISE EXCEPTION 'chosen lead must be a committee member in this orientation and year';
  END IF;

  UPDATE profiles SET role = 'performance_lead' WHERE id = p_lead_profile_id;

  BEGIN
    INSERT INTO practice_groups (name, orientation, orientation_year, capacity, lead_id, created_by)
    VALUES (trim(p_name), p_orientation, p_year, p_capacity, p_lead_profile_id, auth.uid())
    RETURNING * INTO row_out;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'this person already leads a practice group';
  END;

  RETURN row_out;
END $$;

-- ---------- head_reassign_practice_lead: admin only ----------
CREATE OR REPLACE FUNCTION head_reassign_practice_lead(p_group uuid, p_new_lead_profile_id uuid)
RETURNS practice_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g practice_groups;
  new_lead profiles;
  row_out practice_groups;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO g FROM practice_groups WHERE id = p_group FOR UPDATE;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  SELECT * INTO new_lead FROM profiles WHERE id = p_new_lead_profile_id;
  IF new_lead IS NULL OR new_lead.role <> 'committee' OR new_lead.orientation <> g.orientation THEN
    RAISE EXCEPTION 'chosen lead must be a committee member in this orientation';
  END IF;

  UPDATE profiles SET role = 'committee' WHERE id = g.lead_id;
  UPDATE profiles SET role = 'performance_lead' WHERE id = p_new_lead_profile_id;

  UPDATE practice_groups SET lead_id = p_new_lead_profile_id WHERE id = p_group
  RETURNING * INTO row_out;
  RETURN row_out;
END $$;

-- ---------- head_update_practice_group: admin only ----------
CREATE OR REPLACE FUNCTION head_update_practice_group(
  p_group uuid, p_name text, p_capacity int, p_status slot_status
) RETURNS practice_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g practice_groups;
  row_out practice_groups;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO g FROM practice_groups WHERE id = p_group;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  UPDATE practice_groups SET name = trim(p_name), capacity = p_capacity, status = p_status
  WHERE id = p_group RETURNING * INTO row_out;
  RETURN row_out;
END $$;

-- ---------- head_delete_practice_group: admin only ----------
CREATE OR REPLACE FUNCTION head_delete_practice_group(p_group uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g practice_groups;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO g FROM practice_groups WHERE id = p_group;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  UPDATE profiles SET role = 'committee' WHERE id = g.lead_id;
  DELETE FROM practice_groups WHERE id = p_group;
END $$;

-- ---------- prevent_self_role_change: admin only, no head exception ----------
CREATE OR REPLACE FUNCTION prevent_self_role_change() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF new.role <> old.role AND auth.uid() IS NOT NULL AND NOT is_admin() THEN
    RAISE EXCEPTION 'only an admin may change a role';
  END IF;
  RETURN new;
END $$;

-- ---------- lead_update_practice_group: the lead's self-service edit ----------
CREATE OR REPLACE FUNCTION lead_update_practice_group(p_group uuid, p_name text, p_capacity int)
RETURNS practice_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g practice_groups;
  row_out practice_groups;
BEGIN
  SELECT * INTO g FROM practice_groups WHERE id = p_group;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  IF NOT (coalesce(g.lead_id = auth.uid(), false) OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized for this group';
  END IF;
  UPDATE practice_groups SET name = trim(p_name), capacity = p_capacity
  WHERE id = p_group RETURNING * INTO row_out;
  RETURN row_out;
END $$;

-- ---------- Grants ----------
GRANT EXECUTE ON FUNCTION head_set_committee_position(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION head_create_practice_group(text, orientation, int, uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION head_reassign_practice_lead(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION head_update_practice_group(uuid, text, int, slot_status) TO authenticated;
GRANT EXECUTE ON FUNCTION head_delete_practice_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION lead_update_practice_group(uuid, text, int) TO authenticated;

-- ==========================================
-- MIGRATION: 0024_available_group_members.sql
-- ==========================================

-- 0024_available_group_members.sql
-- Surfaces each open practice group's member names in the browse/join view
-- (available_practice_groups), so a committee member can see who's already
-- in a group before deciding to join it.

DROP FUNCTION IF EXISTS available_practice_groups();
CREATE OR REPLACE FUNCTION available_practice_groups()
RETURNS TABLE (
  id uuid, name text, lead_id uuid, lead_name text, capacity int,
  member_count bigint, seats_left bigint, status slot_status, session_count bigint,
  member_names text[]
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  caller_orientation orientation;
  caller_year int;
BEGIN
  IF coalesce(auth_role() NOT IN ('committee', 'performance_lead'), true) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT orientation, orientation_year INTO caller_orientation, caller_year FROM auth_committee_scope();
  IF caller_orientation IS NULL THEN
    RAISE EXCEPTION 'no orientation on this profile';
  END IF;
  RETURN QUERY
    SELECT g.id, g.name, g.lead_id, p.name AS lead_name, g.capacity,
           count(m.*) AS member_count,
           g.capacity - count(m.*) AS seats_left,
           g.status,
           count(distinct s.id) AS session_count,
           array_remove(array_agg(distinct mp.name), NULL) AS member_names
    FROM practice_groups g
    JOIN profiles p ON p.id = g.lead_id
    LEFT JOIN practice_group_members m ON m.group_id = g.id
    LEFT JOIN profiles mp ON mp.id = m.member_id
    LEFT JOIN practice_sessions s ON s.group_id = g.id
    WHERE g.orientation = caller_orientation AND g.orientation_year = caller_year
    GROUP BY g.id, p.name
    ORDER BY g.name;
END $$;

GRANT EXECUTE ON FUNCTION available_practice_groups() TO authenticated;

-- ==========================================
-- MIGRATION: 0025_performance_lead_group_self_service.sql
-- ==========================================

-- 0025_performance_lead_group_self_service.sql
-- Lets a performance lead (including one who is also a Head, e.g. via the
-- HOF/HOG position) manage their own group's members, and adds a free-text
-- location to practice sessions. Mirrors the existing lead_* authorization
-- pattern: `g.lead_id = auth.uid() OR is_head_or_admin()`.

-- ---------- practice_sessions.location ----------
ALTER TABLE practice_sessions ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '';

-- ---------- Session RPCs: carry location through ----------
DROP FUNCTION IF EXISTS lead_create_session(uuid, timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION lead_create_session(p_group uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_location text DEFAULT '')
RETURNS practice_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g practice_groups;
  row_out practice_sessions;
BEGIN
  SELECT * INTO g FROM practice_groups WHERE id = p_group;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  IF NOT (coalesce(g.lead_id = auth.uid(), false) OR is_head_or_admin()) THEN
    RAISE EXCEPTION 'not authorized for this group';
  END IF;
  INSERT INTO practice_sessions (group_id, starts_at, ends_at, location, created_by)
  VALUES (p_group, p_starts_at, p_ends_at, trim(p_location), auth.uid())
  RETURNING * INTO row_out;
  RETURN row_out;
END $$;

DROP FUNCTION IF EXISTS lead_update_session(uuid, timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION lead_update_session(p_session uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_location text DEFAULT '')
RETURNS practice_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s practice_sessions;
  g practice_groups;
  row_out practice_sessions;
BEGIN
  SELECT * INTO s FROM practice_sessions WHERE id = p_session;
  IF s IS NULL THEN
    RAISE EXCEPTION 'session not found';
  END IF;
  SELECT * INTO g FROM practice_groups WHERE id = s.group_id;
  IF NOT (coalesce(g.lead_id = auth.uid(), false) OR is_head_or_admin()) THEN
    RAISE EXCEPTION 'not authorized for this group';
  END IF;
  UPDATE practice_sessions SET starts_at = p_starts_at, ends_at = p_ends_at, location = trim(p_location)
  WHERE id = p_session RETURNING * INTO row_out;
  RETURN row_out;
END $$;

DROP FUNCTION IF EXISTS my_practice_group_sessions();
CREATE OR REPLACE FUNCTION my_practice_group_sessions()
RETURNS TABLE (id uuid, starts_at timestamptz, ends_at timestamptz, location text)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  RETURN QUERY
    SELECT s.id, s.starts_at, s.ends_at, s.location
    FROM practice_sessions s
    WHERE s.group_id IN (
      SELECT g.id FROM practice_groups g
      WHERE g.lead_id = auth.uid()
         OR EXISTS (
           SELECT 1 FROM practice_group_members m
           WHERE m.group_id = g.id AND m.member_id = auth.uid()
         )
    )
    ORDER BY s.starts_at;
END $$;

-- ---------- Member management: lead can add/remove members on their own group ----------
DROP FUNCTION IF EXISTS lead_eligible_members(uuid);
CREATE OR REPLACE FUNCTION lead_eligible_members(p_group uuid)
RETURNS TABLE (id uuid, name text, student_id text, email text)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  g practice_groups;
BEGIN
  SELECT * INTO g FROM practice_groups WHERE id = p_group;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  IF NOT (coalesce(g.lead_id = auth.uid(), false) OR is_head_or_admin()) THEN
    RAISE EXCEPTION 'not authorized for this group';
  END IF;
  RETURN QUERY
    SELECT pr.id, pr.name, pr.student_id, pr.email
    FROM profiles pr
    WHERE pr.role = 'committee'
      AND pr.orientation = g.orientation
      AND pr.orientation_year = g.orientation_year
      AND NOT EXISTS (
        SELECT 1 FROM practice_group_members m
        WHERE m.member_id = pr.id AND m.orientation = g.orientation AND m.orientation_year = g.orientation_year
      )
    ORDER BY pr.name;
END $$;

DROP FUNCTION IF EXISTS lead_add_member(uuid, uuid);
CREATE OR REPLACE FUNCTION lead_add_member(p_group uuid, p_member_id uuid)
RETURNS practice_group_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g practice_groups;
  target profiles;
  taken int;
  row_out practice_group_members;
BEGIN
  SELECT * INTO g FROM practice_groups WHERE id = p_group FOR UPDATE;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  IF NOT (coalesce(g.lead_id = auth.uid(), false) OR is_head_or_admin()) THEN
    RAISE EXCEPTION 'not authorized for this group';
  END IF;
  IF g.status <> 'open' THEN
    RAISE EXCEPTION 'group is closed';
  END IF;

  SELECT * INTO target FROM profiles WHERE id = p_member_id;
  IF target IS NULL OR target.role <> 'committee' OR target.orientation <> g.orientation OR target.orientation_year <> g.orientation_year THEN
    RAISE EXCEPTION 'chosen member must be a committee member in this group''s orientation and year';
  END IF;

  SELECT count(*) INTO taken FROM practice_group_members WHERE group_id = p_group;
  IF taken >= g.capacity THEN
    RAISE EXCEPTION 'group is full';
  END IF;

  BEGIN
    INSERT INTO practice_group_members (group_id, member_id, orientation, orientation_year)
    VALUES (p_group, p_member_id, g.orientation, g.orientation_year)
    RETURNING * INTO row_out;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'this member already belongs to a practice group for this orientation';
  END;

  RETURN row_out;
END $$;

DROP FUNCTION IF EXISTS lead_remove_member(uuid, uuid);
CREATE OR REPLACE FUNCTION lead_remove_member(p_group uuid, p_member_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g practice_groups;
BEGIN
  SELECT * INTO g FROM practice_groups WHERE id = p_group;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  IF NOT (coalesce(g.lead_id = auth.uid(), false) OR is_head_or_admin()) THEN
    RAISE EXCEPTION 'not authorized for this group';
  END IF;
  DELETE FROM practice_group_members WHERE group_id = p_group AND member_id = p_member_id;
END $$;

-- ---------- Grants ----------
GRANT EXECUTE ON FUNCTION lead_create_session(uuid, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION lead_update_session(uuid, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION my_practice_group_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION lead_eligible_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION lead_add_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION lead_remove_member(uuid, uuid) TO authenticated;

-- ==========================================
-- MIGRATION: 0026_add_venue_to_slots.sql
-- ==========================================

-- 0026_add_venue_to_slots.sql
-- Adds venue/location field to slots table and updates related RPCs.

-- ---------- slots.venue ----------
ALTER TABLE slots ADD COLUMN IF NOT EXISTS venue text NOT NULL DEFAULT '';

-- ---------- RPC Updates for slots venue ----------

DROP FUNCTION IF EXISTS available_slots(track, orientation);
DROP FUNCTION IF EXISTS available_slots(track, orientation, int);
CREATE OR REPLACE FUNCTION available_slots(p_track track, p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  capacity int, booked_count bigint, seats_left bigint, venue text
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT s.id, s.track, s.orientation, s.orientation_year, s.starts_at, s.ends_at, s.capacity,
         count(b.*) FILTER (WHERE b.status = 'booked') AS booked_count,
         s.capacity - count(b.*) FILTER (WHERE b.status = 'booked') AS seats_left,
         s.venue
  FROM slots s
  LEFT JOIN bookings b ON b.slot_id = s.id
  WHERE s.track = p_track AND s.orientation = p_orientation AND s.orientation_year = p_year
    AND s.status = 'open' AND s.starts_at > now()
  GROUP BY s.id
  ORDER BY s.starts_at
$$;
GRANT EXECUTE ON FUNCTION available_slots(track, orientation, int) TO anon, authenticated;

DROP FUNCTION IF EXISTS head_slots(track, orientation);
DROP FUNCTION IF EXISTS head_slots(track, orientation, int);
CREATE OR REPLACE FUNCTION head_slots(p_track track, p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  capacity int, status slot_status, booked_count bigint, venue text
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT (auth_managed_track() = p_track OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized for this track';
  END IF;
  RETURN QUERY
    SELECT s.id, s.track, s.orientation, s.orientation_year, s.starts_at, s.ends_at, s.capacity, s.status,
           count(b.*) FILTER (WHERE b.status = 'booked') AS booked_count, s.venue
    FROM slots s
    LEFT JOIN bookings b ON b.slot_id = s.id
    WHERE s.track = p_track AND s.orientation = p_orientation AND s.orientation_year = p_year
    GROUP BY s.id
    ORDER BY s.starts_at;
END $$;
GRANT EXECUTE ON FUNCTION head_slots(track, orientation, int) TO authenticated;

DROP FUNCTION IF EXISTS head_bookings(track, orientation);
DROP FUNCTION IF EXISTS head_bookings(track, orientation, int);
CREATE OR REPLACE FUNCTION head_bookings(p_track track, p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  booking_id uuid, slot_id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  applicant_name text, applicant_email text, student_id text, experiences text,
  interview_notes text, created_at timestamptz, interview_status text, venue text
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT (auth_managed_track() = p_track OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized for this track';
  END IF;
  RETURN QUERY
    SELECT b.id, b.slot_id, b.track, b.orientation, b.orientation_year, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id, b.experiences,
           b.interview_notes, b.created_at, b.interview_status::text, s.venue
    FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    WHERE b.track = p_track AND b.orientation = p_orientation AND b.orientation_year = p_year AND b.status = 'booked'
    ORDER BY s.starts_at, b.applicant_name;
END $$;
GRANT EXECUTE ON FUNCTION head_bookings(track, orientation, int) TO authenticated;

DROP FUNCTION IF EXISTS lookup_booking_public(text);
CREATE OR REPLACE FUNCTION lookup_booking_public(p_student_id text)
RETURNS TABLE (
  booking_id   uuid,
  track        track,
  starts_at    timestamptz,
  ends_at      timestamptz,
  applicant_name  text,
  applicant_email text,
  student_id   text,
  interview_status text,
  status       text,
  created_at   timestamptz,
  venue        text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
    SELECT b.id, b.track, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id,
           b.interview_status, b.status::text, b.created_at, s.venue
    FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    WHERE lower(b.student_id) = lower(trim(p_student_id))
    ORDER BY b.created_at DESC;
END $$;
GRANT EXECUTE ON FUNCTION lookup_booking_public(text) TO anon, authenticated;

-- ==========================================
-- MIGRATION: 0027_hof_hog_practice_committee_parity.sql
-- ==========================================

-- 0027_hof_hog_practice_committee_parity.sql
-- HOF/HOG (head_facilitator/head_gm) lose their elevated view into the
-- performance-practice feature: for practice purposes they now behave
-- exactly like a normal committee member — they browse/join/leave a group
-- via /practice like anyone else, with no visibility into other groups, the
-- committee roster, or any group's member list. That cross-group visibility
-- (head_practice_groups, head_committee_roster, the practice_* "select head
-- or admin" RLS policies, and the head-override branch on the lead_* RPCs)
-- is now admin-only.
--
-- is_head_or_admin() is redefined rather than renamed: every RLS policy and
-- RPC that already calls it (head_practice_groups, head_committee_roster,
-- lead_create_session/update/delete, lead_eligible_members/add/remove_member,
-- and the three practice_*_select_head_or_admin policies) picks up the
-- narrower admin-only check automatically, with no need to touch those
-- definitions individually.
--
-- This does NOT touch head_facilitator/head_gm's real /head dashboard
-- access (booking slots, interview notes) — that is unrelated and stays as
-- introduced in 0022.

-- ---------- is_head_or_admin: admin only for practice governance/visibility ----------
CREATE OR REPLACE FUNCTION is_head_or_admin() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT is_admin()
$$;

-- ---------- available_practice_groups: HOF/HOG browse like committee ----------
CREATE OR REPLACE FUNCTION available_practice_groups()
RETURNS TABLE (
  id uuid, name text, lead_id uuid, lead_name text, capacity int,
  member_count bigint, seats_left bigint, status slot_status, session_count bigint,
  member_names text[]
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  caller_orientation orientation;
  caller_year int;
BEGIN
  IF coalesce(auth_role() NOT IN ('committee', 'performance_lead', 'head_facilitator', 'head_gm'), true) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT orientation, orientation_year INTO caller_orientation, caller_year FROM auth_committee_scope();
  IF caller_orientation IS NULL THEN
    RAISE EXCEPTION 'no orientation on this profile';
  END IF;
  RETURN QUERY
    SELECT g.id, g.name, g.lead_id, p.name AS lead_name, g.capacity,
           count(m.*) AS member_count,
           g.capacity - count(m.*) AS seats_left,
           g.status,
           count(distinct s.id) AS session_count,
           array_remove(array_agg(distinct mp.name), NULL) AS member_names
    FROM practice_groups g
    JOIN profiles p ON p.id = g.lead_id
    LEFT JOIN practice_group_members m ON m.group_id = g.id
    LEFT JOIN profiles mp ON mp.id = m.member_id
    LEFT JOIN practice_sessions s ON s.group_id = g.id
    WHERE g.orientation = caller_orientation AND g.orientation_year = caller_year
    GROUP BY g.id, p.name
    ORDER BY g.name;
END $$;

-- ---------- join_practice_group: HOF/HOG join like committee ----------
CREATE OR REPLACE FUNCTION join_practice_group(p_group uuid)
RETURNS practice_group_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g practice_groups;
  taken int;
  caller_orientation orientation;
  caller_year int;
  row_out practice_group_members;
BEGIN
  IF coalesce(auth_role() NOT IN ('committee', 'head_facilitator', 'head_gm'), true) THEN
    RAISE EXCEPTION 'only committee members may join a group';
  END IF;
  SELECT orientation, orientation_year INTO caller_orientation, caller_year FROM auth_committee_scope();
  IF caller_orientation IS NULL THEN
    RAISE EXCEPTION 'no orientation on this profile';
  END IF;

  SELECT * INTO g FROM practice_groups WHERE id = p_group FOR UPDATE;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  IF g.orientation <> caller_orientation OR g.orientation_year <> caller_year THEN
    RAISE EXCEPTION 'group is not in your orientation';
  END IF;
  IF g.status <> 'open' THEN
    RAISE EXCEPTION 'group is closed';
  END IF;

  SELECT count(*) INTO taken FROM practice_group_members WHERE group_id = p_group;
  IF taken >= g.capacity THEN
    RAISE EXCEPTION 'group is full';
  END IF;

  BEGIN
    INSERT INTO practice_group_members (group_id, member_id, orientation, orientation_year)
    VALUES (p_group, auth.uid(), g.orientation, g.orientation_year)
    RETURNING * INTO row_out;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'you have already joined a practice group for this orientation';
  END;

  RETURN row_out;
END $$;

-- ==========================================
-- MIGRATION: 0028_committee_positions_table.sql
-- ==========================================

-- 0028_committee_positions_table.sql
-- Turns the fixed list of committee "position" titles (Treasurer, HOF, PGVG,
-- etc.) into an admin-manageable table instead of a hardcoded CHECK list, so
-- an admin can add new position titles from the Committee Management screen
-- without a code change. Also lets a position be assigned at invite time —
-- previously positions could only be set later, per committee member, via
-- head_set_committee_position.

create table committee_positions (
  value text primary key,
  label text not null,
  created_at timestamptz not null default now()
);

alter table committee_positions enable row level security;

-- Anyone signed in can read the list (needed to render position labels and
-- populate pickers across the app); only an admin can add/remove options.
create policy "committee_positions_select_authenticated" on committee_positions
  for select to authenticated
  using (true);

create policy "committee_positions_admin_insert" on committee_positions
  for insert to authenticated
  with check (is_admin());

create policy "committee_positions_admin_delete" on committee_positions
  for delete to authenticated
  using (is_admin());

insert into committee_positions (value, label) values
  ('hof', 'Head of Facilitator (HOF)'),
  ('hog', 'Head of Game Master (HOGM)'),
  ('game_master', 'Game Master'),
  ('facilitator', 'Facilitator'),
  ('treasurer', 'Treasurer'),
  ('sponsorship', 'Sponsorship'),
  ('logistic', 'Logistic'),
  ('tech_team', 'Tech Team'),
  ('organising_chairperson', 'Organising Chair Person'),
  ('event_planner', 'Event Planner'),
  ('designer', 'Designer'),
  ('pgvg', 'PGVG'),
  ('public_relations', 'Public Relation'),
  ('secretary', 'Secretary'),
  ('general_affairs', 'General Affairs')
on conflict (value) do nothing;

-- profiles.position: swap the hardcoded CHECK for a foreign key against the
-- new table, so admin-added positions become valid immediately.
alter table profiles drop constraint if exists profiles_position_chk;
alter table profiles add constraint profiles_position_fk
  foreign key (position) references committee_positions(value);

-- staff_invites: carry an optional position/title chosen at invite time,
-- applied to the profile once the invite is claimed (see
-- app/api/staff/register/route.ts).
alter table staff_invites add column if not exists position text
  references committee_positions(value);

-- ==========================================
-- MIGRATION: 0029_audit_log.sql
-- ==========================================

-- 0029_audit_log.sql
-- Append-only activity log. Every change to an app table is recorded with WHO
-- made it, WHAT they did (as a human-readable sentence), and WHEN.
--
-- Why triggers and not application code: mutations in this app arrive by four
-- different paths — the browser anon client under RLS, SECURITY DEFINER RPCs,
-- service-role writes from Next.js server code, and direct SQL in the Supabase
-- dashboard. Only a database trigger sees all four. Logging calls sprinkled
-- through server actions would silently miss most changes.
--
-- Immutability: RLS makes the table admin-read-only, the REVOKEs strip write
-- privileges from every app role (including service_role, which is BYPASSRLS
-- and therefore unaffected by RLS alone), and a raising trigger blocks UPDATE /
-- DELETE / TRUNCATE even for a role that still holds the privilege. Rows are
-- written by audit_row_change(), which is SECURITY DEFINER and so runs as the
-- table owner. See the note above the REVOKE block for what this does NOT
-- protect against.

-- ---------- Table ----------

create table audit_log (
  id             bigint generated always as identity primary key,
  -- clock_timestamp(), not now(): several RPCs write two audited tables in one
  -- transaction, and now() would give both the same timestamp. `id desc` is the
  -- real tiebreaker, but the timestamps should not lie.
  occurred_at    timestamptz not null default clock_timestamp(),

  -- WHO
  actor_type     text not null check (actor_type in ('user', 'public', 'service', 'system')),
  -- profiles.id when known. Deliberately NOT a foreign key: an audit row must
  -- outlive the profile it names.
  actor_id       uuid,
  actor_name     text not null,
  actor_email    text,
  actor_role     text,
  actor_position text,
  -- PostgREST JWT role: anon | authenticated | service_role. Null outside PostgREST.
  auth_role      text,

  -- WHAT
  action         text not null check (action in ('insert', 'update', 'delete')),
  table_name     text not null,
  -- text, not uuid: track_settings has a composite PK and committee_positions
  -- has a text PK.
  record_id      text,
  summary        text not null,
  changed_fields text[] not null default '{}',
  old_data       jsonb,
  new_data       jsonb,

  -- One column to search instead of an `.or()` across four. PostgREST's filter
  -- grammar is comma-separated, so a search string containing `,` `(` `)` would
  -- corrupt a multi-column .or() query; a single .ilike() has no such exposure.
  search_text    text generated always as (lower(
    coalesce(actor_name, '')     || ' ' || coalesce(actor_email, '')    || ' ' ||
    coalesce(actor_role, '')     || ' ' || coalesce(actor_position, '') || ' ' ||
    coalesce(summary, '')        || ' ' || table_name || ' ' || action  || ' ' ||
    coalesce(record_id, '')
  )) stored
);

create index audit_log_occurred_at_idx on audit_log (occurred_at desc, id desc);
create index audit_log_actor_idx       on audit_log (actor_id, id desc);
create index audit_log_table_idx       on audit_log (table_name, id desc);
create index audit_log_action_idx      on audit_log (action, id desc);

-- Trigram index so `ilike '%jane%'` doesn't sequential-scan. gin_trgm_ops
-- accelerates plain ILIKE directly, so no query needs the `%` similarity
-- operator (and therefore never needs `extensions` on its search_path).
-- Guarded: if the extension can't be created the migration must still succeed,
-- degrading to sequential ILIKE.
do $$
begin
  create extension if not exists pg_trgm with schema extensions;
  execute 'create index audit_log_search_trgm_idx on audit_log using gin (search_text extensions.gin_trgm_ops)';
exception when others then
  raise notice 'pg_trgm unavailable (%); audit_log search falls back to sequential ILIKE', sqlerrm;
end $$;

-- ---------- Label helpers ----------
-- These mirror the labels the UI already shows (app/NavClient.tsx roleLabels,
-- lib/orientation.ts) so a log entry reads the same way the screen does.

create or replace function audit_track_label(p_track text) returns text
  language sql immutable as $$
  select case p_track
    when 'facilitator' then 'Facilitator'
    when 'game_master' then 'Game Master'
    else coalesce(p_track, 'unknown track') end
$$;

create or replace function audit_role_label(p_role text) returns text
  language sql immutable as $$
  select case p_role
    when 'applicant' then 'Applicant'
    when 'head_facilitator' then 'Head of Facilitators'
    when 'head_gm' then 'Head of Game Masters'
    when 'admin' then 'Admin'
    when 'committee' then 'Committee Member'
    when 'performance_lead' then 'Performance Lead'
    else coalesce(p_role, 'none') end
$$;

create or replace function audit_position_label(p_value text) returns text
  language sql stable set search_path = public as $$
  select coalesce((select label from committee_positions where value = p_value), p_value, 'none')
$$;

create or replace function audit_orientation_label(p_orientation text, p_year int) returns text
  language sql immutable as $$
  select coalesce(initcap(p_orientation) || ' ', '') || coalesce(p_year::text, '')
$$;

-- Times are rendered in the orientation's local timezone so a log entry matches
-- what the admin saw on screen.
create or replace function audit_fmt_ts(p_ts timestamptz) returns text
  language sql stable as $$
  select case when p_ts is null then 'unset'
    else to_char(p_ts at time zone 'Asia/Kuala_Lumpur', 'DD Mon YYYY HH24:MI') end
$$;

create or replace function audit_fmt_time(p_ts timestamptz) returns text
  language sql stable as $$
  select case when p_ts is null then 'unset'
    else to_char(p_ts at time zone 'Asia/Kuala_Lumpur', 'HH24:MI') end
$$;

-- A parent row may already be gone by the time a cascade-deleted child's
-- trigger fires (deleting a practice group cascades to its members and
-- sessions), so every cross-table lookup has to degrade gracefully.
create or replace function audit_group_ref(p_group uuid) returns text
  language sql stable set search_path = public as $$
  select coalesce(
    (select 'practice group "' || g.name || '"' from practice_groups g where g.id = p_group),
    'a deleted practice group')
$$;

create or replace function audit_profile_name(p_id uuid) returns text
  language sql stable set search_path = public as $$
  select coalesce((select p.name from profiles p where p.id = p_id), 'a removed account')
$$;

create or replace function audit_slot_ref(p_slot uuid) returns text
  language sql stable set search_path = public as $$
  select coalesce(
    (select audit_track_label(s.track::text) || ', ' || audit_fmt_ts(s.starts_at)
            || case when coalesce(s.venue, '') <> '' then ', ' || s.venue else '' end
     from slots s where s.id = p_slot),
    'a deleted slot')
$$;

-- Just the time, for sentences that already name the track.
create or replace function audit_slot_when(p_slot uuid) returns text
  language sql stable set search_path = public as $$
  select coalesce((select audit_fmt_ts(s.starts_at) from slots s where s.id = p_slot),
                  'a deleted slot')
$$;

-- ---------- Actor resolution ----------
-- Returns { type, id, name, email, role, position, auth_role }.
--
-- Why GUCs and not current_user: current_user is always `postgres` inside a
-- SECURITY DEFINER function, and most mutations in this app flow through the
-- existing SECURITY DEFINER RPCs. request.jwt.claims and auth.uid() are
-- session-scoped and unaffected by SECURITY DEFINER — the same mechanism
-- is_admin() has always relied on.
--
-- Every current_setting() call uses the missing_ok form inside an exception
-- handler so the trigger is null-safe outside PostgREST. That is what keeps
-- `npm run migrate` and scripts/seed*.mjs working (see the null-auth.uid()
-- hazard documented at the top of 0019).
create or replace function audit_actor(p_row jsonb) returns jsonb
  language plpgsql security definer stable set search_path = public as $$
declare
  v_claims jsonb;
  v_jwt_role text;
  v_uid uuid;
  v_header_actor uuid;
  p profiles;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null;
  end;
  v_jwt_role := v_claims ->> 'role';

  begin
    v_uid := auth.uid();
  exception when others then
    v_uid := null;
  end;

  -- 1. A signed-in account.
  if v_uid is not null then
    select * into p from profiles where id = v_uid;
    if found then
      return jsonb_build_object(
        'type', 'user', 'id', p.id, 'name', p.name, 'email', p.email,
        'role', p.role::text, 'position', p.position, 'auth_role', v_jwt_role);
    end if;
    return jsonb_build_object(
      'type', 'user', 'id', v_uid, 'name', 'Unknown account',
      'email', v_claims ->> 'email', 'auth_role', v_jwt_role);
  end if;

  -- 2. Next.js server code holding the service-role key. x-actor-id is
  --    client-controllable, so it is honoured ONLY here — never for anon or
  --    authenticated requests.
  if v_jwt_role = 'service_role' then
    begin
      v_header_actor := (nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-actor-id')::uuid;
    exception when others then
      v_header_actor := null;
    end;
    if v_header_actor is not null then
      select * into p from profiles where id = v_header_actor;
      if found then
        return jsonb_build_object(
          'type', 'user', 'id', p.id, 'name', p.name, 'email', p.email,
          'role', p.role::text, 'position', p.position, 'auth_role', 'service_role');
      end if;
    end if;
    return jsonb_build_object(
      'type', 'service', 'name', 'Server task (service role)', 'auth_role', 'service_role');
  end if;

  -- 3. Anonymous public flows (book_slot_public, cancel_booking_by_email, ...).
  --    The applicant has no account, so identify them from the row itself.
  if v_jwt_role = 'anon' then
    return jsonb_build_object(
      'type', 'public',
      'name', coalesce(nullif(p_row ->> 'applicant_name', ''), 'Anonymous visitor'),
      'email', p_row ->> 'applicant_email',
      'auth_role', 'anon');
  end if;

  -- 4. No PostgREST context at all: migrations, psql, scripts/seed*.mjs.
  return jsonb_build_object(
    'type', 'system', 'name', 'System (migration or script)', 'auth_role', v_jwt_role);
end $$;

-- ---------- Record identity ----------

create or replace function audit_record_id(p_table text, p_row jsonb) returns text
  language sql immutable as $$
  select case p_table
    when 'track_settings' then
      concat_ws('|', p_row ->> 'track', p_row ->> 'orientation', p_row ->> 'orientation_year')
    when 'committee_positions' then p_row ->> 'value'
    else p_row ->> 'id' end
$$;

-- ---------- Redaction ----------
-- staff_invites.code is an activation credential — a leaked log export must not
-- let someone claim another person's committee account. changed_fields still
-- records that it changed, which is all an auditor needs.
--
-- bookings.interview_notes is deliberately kept in full: a head quietly
-- rewriting a candidate's assessment is exactly the abuse this log exists to
-- catch, and every reader of /admin/logs is an admin who can already read notes
-- through head_bookings.
create or replace function audit_redact(p_table text, p_data jsonb) returns jsonb
  language sql immutable as $$
  select case
    when p_data is null then null
    when p_table = 'staff_invites' then
      p_data || jsonb_build_object('code', '«redacted»')
    when p_table = 'bookings' then
      p_data || jsonb_build_object('experiences', left(coalesce(p_data ->> 'experiences', ''), 400))
    else p_data end
$$;

-- ---------- Human-readable summary ----------

create or replace function describe_audit_change(
  p_table text, p_op text, p_old jsonb, p_new jsonb, p_changed text[]
) returns text
  language plpgsql stable set search_path = public as $$
declare
  r jsonb := coalesce(p_new, p_old);
  suffix text := case when array_length(p_changed, 1) > 0
                      then ' (changed ' || array_to_string(p_changed, ', ') || ')'
                      else '' end;
  who text;
  intake text;
begin
  -- ----- slots -----
  if p_table = 'slots' then
    if p_op = 'INSERT' then
      return 'Created interview slot — ' || audit_track_label(r ->> 'track') || ', '
             || audit_fmt_ts((r ->> 'starts_at')::timestamptz) || '–'
             || audit_fmt_time((r ->> 'ends_at')::timestamptz)
             || case when coalesce(r ->> 'venue', '') <> '' then ', ' || (r ->> 'venue') else '' end
             || ' (capacity ' || coalesce(r ->> 'capacity', '?') || ')';
    elsif p_op = 'DELETE' then
      return 'Deleted interview slot — ' || audit_track_label(r ->> 'track') || ', '
             || audit_fmt_ts((r ->> 'starts_at')::timestamptz)
             || case when coalesce(r ->> 'venue', '') <> '' then ', ' || (r ->> 'venue') else '' end;
    elsif 'status' = any(p_changed) then
      return case when (p_new ->> 'status') = 'closed' then 'Closed' else 'Reopened' end
             || ' interview slot — ' || audit_track_label(p_new ->> 'track') || ', '
             || audit_fmt_ts((p_new ->> 'starts_at')::timestamptz);
    elsif 'starts_at' = any(p_changed) or 'ends_at' = any(p_changed) then
      return 'Moved interview slot from ' || audit_fmt_ts((p_old ->> 'starts_at')::timestamptz)
             || ' to ' || audit_fmt_ts((p_new ->> 'starts_at')::timestamptz)
             || ' — ' || audit_track_label(p_new ->> 'track');
    elsif 'capacity' = any(p_changed) then
      return 'Changed interview slot capacity from ' || (p_old ->> 'capacity') || ' to '
             || (p_new ->> 'capacity') || ' — ' || audit_track_label(p_new ->> 'track') || ', '
             || audit_fmt_ts((p_new ->> 'starts_at')::timestamptz);
    elsif 'venue' = any(p_changed) then
      return 'Moved interview slot to ' || coalesce(nullif(p_new ->> 'venue', ''), 'no venue')
             || ' (was ' || coalesce(nullif(p_old ->> 'venue', ''), 'no venue') || ') — '
             || audit_track_label(p_new ->> 'track') || ', '
             || audit_fmt_ts((p_new ->> 'starts_at')::timestamptz);
    else
      return 'Updated interview slot — ' || audit_track_label(p_new ->> 'track') || ', '
             || audit_fmt_ts((p_new ->> 'starts_at')::timestamptz) || suffix;
    end if;
  end if;

  -- ----- bookings -----
  if p_table = 'bookings' then
    who := coalesce(nullif(r ->> 'applicant_name', ''), 'an applicant');
    if p_op = 'INSERT' then
      return 'Added a new interview booking — ' || who
             || coalesce(' (' || nullif(r ->> 'applicant_email', '') || ')', '') || ', '
             || audit_slot_ref((r ->> 'slot_id')::uuid);
    elsif p_op = 'DELETE' then
      return 'Deleted booking for ' || who || ' — ' || audit_slot_ref((r ->> 'slot_id')::uuid);
    -- The welcome-email marker is appended to `experiences` by
    -- sendBulkWelcomeEmailsAction; without this branch a 100-applicant send
    -- produces 100 identical "Updated booking" lines.
    elsif p_changed = array['experiences']::text[]
          and (p_new ->> 'experiences') like '%[Welcome Email Sent]%'
          and coalesce(p_old ->> 'experiences', '') not like '%[Welcome Email Sent]%' then
      return 'Sent the welcome email to ' || who;
    elsif 'status' = any(p_changed) then
      return case when (p_new ->> 'status') = 'cancelled' then 'Cancelled' else 'Reinstated' end
             || ' booking for ' || who || ' — ' || audit_slot_ref((p_new ->> 'slot_id')::uuid);
    elsif 'slot_id' = any(p_changed) then
      return 'Rescheduled ' || who || ' from ' || audit_slot_when((p_old ->> 'slot_id')::uuid)
             || ' to ' || audit_slot_ref((p_new ->> 'slot_id')::uuid);
    elsif 'interview_status' = any(p_changed) then
      return 'Marked ' || who || '''s interview as ' || initcap(p_new ->> 'interview_status')
             || ' (was ' || initcap(coalesce(p_old ->> 'interview_status', 'pending')) || ')';
    elsif 'interview_notes' = any(p_changed) then
      return case when nullif(p_old ->> 'interview_notes', '') is null then 'Added' else 'Edited' end
             || ' interview notes for ' || who;
    else
      return 'Updated booking for ' || who || suffix;
    end if;
  end if;

  -- ----- profiles -----
  if p_table = 'profiles' then
    who := coalesce(nullif(r ->> 'name', ''), 'an account');
    if p_op = 'INSERT' then
      return 'Created account for ' || who
             || coalesce(' (' || nullif(r ->> 'email', '') || ')', '')
             || ' as ' || audit_role_label(r ->> 'role');
    elsif p_op = 'DELETE' then
      return 'Deleted account for ' || who
             || coalesce(' (' || nullif(r ->> 'email', '') || ')', '');
    elsif 'role' = any(p_changed) and (p_new ->> 'role') = 'applicant'
          and (p_new ->> 'position') is null then
      return 'Revoked committee access for ' || who;
    elsif 'role' = any(p_changed) then
      return 'Changed ' || who || '''s access level from ' || audit_role_label(p_old ->> 'role')
             || ' to ' || audit_role_label(p_new ->> 'role');
    elsif 'position' = any(p_changed) then
      return case when (p_new ->> 'position') is null
        then 'Cleared ' || who || '''s committee title (was '
             || audit_position_label(p_old ->> 'position') || ')'
        else 'Set ' || who || '''s committee title to '
             || audit_position_label(p_new ->> 'position') end;
    elsif 'name' = any(p_changed) then
      return 'Renamed ' || coalesce(nullif(p_old ->> 'name', ''), 'an account')
             || ' to ' || coalesce(nullif(p_new ->> 'name', ''), 'an account');
    elsif 'orientation' = any(p_changed) or 'orientation_year' = any(p_changed) then
      return 'Moved ' || who || ' to the '
             || audit_orientation_label(p_new ->> 'orientation', (p_new ->> 'orientation_year')::int)
             || ' orientation';
    else
      return 'Updated profile for ' || who || suffix;
    end if;
  end if;

  -- ----- staff_invites -----
  if p_table = 'staff_invites' then
    who := coalesce(nullif(r ->> 'name', ''), 'someone');
    if p_op = 'INSERT' then
      return 'Invited ' || who || coalesce(' (' || nullif(r ->> 'email', '') || ')', '')
             || ' as ' || audit_position_label(r ->> 'position')
             || ' — ' || audit_role_label(r ->> 'role') || ', '
             || audit_orientation_label(r ->> 'orientation', (r ->> 'orientation_year')::int);
    elsif p_op = 'DELETE' then
      return 'Revoked the invite for ' || who
             || coalesce(' (' || nullif(r ->> 'email', '') || ')', '');
    elsif 'claimed_at' = any(p_changed) and (p_old ->> 'claimed_at') is null
          and (p_new ->> 'claimed_at') is not null then
      return who || ' activated their invited account ('
             || audit_position_label(p_new ->> 'position') || ')';
    elsif 'role' = any(p_changed) then
      return 'Changed ' || who || '''s invited access level from '
             || audit_role_label(p_old ->> 'role') || ' to ' || audit_role_label(p_new ->> 'role');
    elsif 'position' = any(p_changed) then
      return 'Changed ' || who || '''s invited title to '
             || audit_position_label(p_new ->> 'position');
    else
      return 'Updated invite for ' || who || suffix;
    end if;
  end if;

  -- ----- track_settings -----
  if p_table = 'track_settings' then
    who := audit_track_label(r ->> 'track');
    intake := audit_orientation_label(r ->> 'orientation', (r ->> 'orientation_year')::int);
    if p_op = 'INSERT' then
      return 'Created booking settings for ' || who || ' — ' || intake;
    elsif p_op = 'DELETE' then
      return 'Deleted booking settings for ' || who || ' — ' || intake;
    elsif 'window_open' = any(p_changed) or 'window_close' = any(p_changed) then
      if (p_new ->> 'window_open') is null and (p_new ->> 'window_close') is null then
        return 'Closed the ' || who || ' booking window for ' || intake;
      end if;
      return 'Set the ' || who || ' booking window for ' || intake || ': '
             || audit_fmt_ts((p_new ->> 'window_open')::timestamptz) || ' to '
             || audit_fmt_ts((p_new ->> 'window_close')::timestamptz);
    elsif 'reschedule_cutoff_hours' = any(p_changed) then
      return 'Changed the ' || who || ' reschedule cutoff from '
             || (p_old ->> 'reschedule_cutoff_hours') || ' to '
             || (p_new ->> 'reschedule_cutoff_hours') || ' hours — ' || intake;
    else
      return 'Updated booking settings for ' || who || ' — ' || intake || suffix;
    end if;
  end if;

  -- ----- practice_groups -----
  if p_table = 'practice_groups' then
    who := 'practice group "' || coalesce(r ->> 'name', 'untitled') || '"';
    if p_op = 'INSERT' then
      return 'Created ' || who || ' led by ' || audit_profile_name((r ->> 'lead_id')::uuid)
             || ' — capacity ' || coalesce(r ->> 'capacity', '?') || ', '
             || audit_orientation_label(r ->> 'orientation', (r ->> 'orientation_year')::int);
    elsif p_op = 'DELETE' then
      return 'Deleted ' || who;
    elsif 'lead_id' = any(p_changed) then
      return 'Reassigned ' || who || ' lead from '
             || audit_profile_name((p_old ->> 'lead_id')::uuid) || ' to '
             || audit_profile_name((p_new ->> 'lead_id')::uuid);
    elsif 'name' = any(p_changed) then
      return 'Renamed practice group "' || coalesce(p_old ->> 'name', 'untitled')
             || '" to "' || coalesce(p_new ->> 'name', 'untitled') || '"';
    elsif 'capacity' = any(p_changed) then
      return 'Changed ' || who || ' capacity from ' || (p_old ->> 'capacity')
             || ' to ' || (p_new ->> 'capacity');
    elsif 'status' = any(p_changed) then
      return case when (p_new ->> 'status') = 'closed' then 'Closed ' else 'Reopened ' end || who;
    else
      return 'Updated ' || who || suffix;
    end if;
  end if;

  -- ----- practice_group_members -----
  if p_table = 'practice_group_members' then
    who := audit_profile_name((r ->> 'member_id')::uuid);
    if p_op = 'INSERT' then
      return 'Added ' || who || ' to ' || audit_group_ref((r ->> 'group_id')::uuid);
    elsif p_op = 'DELETE' then
      return 'Removed ' || who || ' from ' || audit_group_ref((r ->> 'group_id')::uuid);
    else
      return 'Updated ' || who || '''s membership in '
             || audit_group_ref((r ->> 'group_id')::uuid) || suffix;
    end if;
  end if;

  -- ----- practice_sessions -----
  if p_table = 'practice_sessions' then
    who := audit_group_ref((r ->> 'group_id')::uuid);
    if p_op = 'INSERT' then
      return 'Added a practice session for ' || who || ' — '
             || audit_fmt_ts((r ->> 'starts_at')::timestamptz) || '–'
             || audit_fmt_time((r ->> 'ends_at')::timestamptz)
             || case when coalesce(r ->> 'location', '') <> '' then ', ' || (r ->> 'location') else '' end;
    elsif p_op = 'DELETE' then
      return 'Deleted the practice session for ' || who || ' — '
             || audit_fmt_ts((r ->> 'starts_at')::timestamptz);
    elsif 'starts_at' = any(p_changed) or 'ends_at' = any(p_changed) then
      return 'Rescheduled the practice session for ' || who || ' from '
             || audit_fmt_ts((p_old ->> 'starts_at')::timestamptz) || ' to '
             || audit_fmt_ts((p_new ->> 'starts_at')::timestamptz);
    elsif 'location' = any(p_changed) then
      return 'Moved the practice session for ' || who || ' to '
             || coalesce(nullif(p_new ->> 'location', ''), 'no location')
             || ' (was ' || coalesce(nullif(p_old ->> 'location', ''), 'no location') || ')';
    else
      return 'Updated the practice session for ' || who || suffix;
    end if;
  end if;

  -- ----- committee_positions -----
  if p_table = 'committee_positions' then
    if p_op = 'INSERT' then
      return 'Added the committee title "' || (r ->> 'label') || '"';
    elsif p_op = 'DELETE' then
      return 'Removed the committee title "' || (r ->> 'label') || '"';
    else
      return 'Renamed the committee title "' || (p_old ->> 'label')
             || '" to "' || (p_new ->> 'label') || '"';
    end if;
  end if;

  -- Fallback for a table added later without a describe branch.
  return initcap(lower(p_op)) || ' on ' || p_table || suffix;
end $$;

-- ---------- The generic trigger ----------
-- Fail-closed: if the audit insert itself fails, the caller's transaction
-- aborts. No change may exist without a log entry. Only describe_audit_change()
-- is wrapped in a handler, so a bug in the prose degrades the sentence instead
-- of breaking the booking form.
--
-- There is deliberately no suppression flag for seeds or bulk jobs: a bypass
-- would be a tamper vector usable by exactly the party being audited.
create or replace function audit_row_change() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed text[] := '{}';
  v_actor jsonb;
  v_summary text;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    select coalesce(array_agg(e.key order by e.key), '{}'::text[]) into v_changed
      from jsonb_each(v_new) e
     where e.value is distinct from (v_old -> e.key);
    -- No-op UPDATE (a seed upsert that changed nothing): don't log noise.
    if v_changed = '{}'::text[] then
      return null;
    end if;
  else
    v_old := to_jsonb(old);
  end if;

  v_actor := audit_actor(coalesce(v_new, v_old));

  begin
    v_summary := describe_audit_change(tg_table_name, tg_op, v_old, v_new, v_changed);
  exception when others then
    v_summary := initcap(lower(tg_op)) || ' on ' || tg_table_name;
  end;

  insert into audit_log (
    actor_type, actor_id, actor_name, actor_email, actor_role, actor_position, auth_role,
    action, table_name, record_id, summary, changed_fields, old_data, new_data
  ) values (
    v_actor ->> 'type',
    nullif(v_actor ->> 'id', '')::uuid,
    coalesce(nullif(v_actor ->> 'name', ''), 'Unknown'),
    v_actor ->> 'email',
    v_actor ->> 'role',
    v_actor ->> 'position',
    v_actor ->> 'auth_role',
    lower(tg_op),
    tg_table_name,
    audit_record_id(tg_table_name, coalesce(v_new, v_old)),
    coalesce(v_summary, initcap(lower(tg_op)) || ' on ' || tg_table_name),
    v_changed,
    audit_redact(tg_table_name, v_old),
    audit_redact(tg_table_name, v_new)
  );

  return null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'staff_invites', 'committee_positions', 'slots', 'bookings',
    'track_settings', 'practice_groups', 'practice_group_members', 'practice_sessions'
  ] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger audit_%1$s after insert or update or delete on public.%1$I '
      'for each row execute function audit_row_change()', t);
  end loop;
end $$;

-- ---------- Immutability ----------

-- (a) RLS: admins read, nobody writes. There is deliberately no INSERT/UPDATE/
--     DELETE policy, so those are denied for every `authenticated` caller.
alter table audit_log enable row level security;

create policy "audit_log_select_admin" on audit_log
  for select to authenticated
  using (is_admin());

-- (b) Table privileges. THIS IS THE LOAD-BEARING LAYER. Supabase's default
--     privileges grant ALL on new public tables to anon/authenticated/
--     service_role, and service_role is BYPASSRLS — so RLS alone protects
--     nothing from the Next.js server. Only these revokes do. BYPASSRLS does
--     not bypass table-level GRANTs.
revoke all on table audit_log from anon;
revoke insert, update, delete, truncate, references, trigger on table audit_log
  from public, anon, authenticated, service_role;
grant select on table audit_log to authenticated;  -- still filtered by RLS
grant select on table audit_log to service_role;   -- read-only, for export/backup
revoke all on sequence audit_log_id_seq from public, anon, authenticated, service_role;

-- (c) A raising trigger, which catches anything that still holds the privilege
--     — including `postgres` in the Supabase SQL editor. Removing a row then
--     requires first dropping or disabling this trigger: a loud, deliberate
--     act rather than a stray DELETE.
--
--     What this does NOT protect against, stated honestly: anyone with database
--     owner or superuser access (the Supabase dashboard login, SUPABASE_DB_URL,
--     or the DB password) can DISABLE TRIGGER / DROP TRIGGER / re-GRANT /
--     DROP TABLE / restore an older backup. No design that stores the log in
--     the same Postgres database can prevent that. What is guaranteed is that
--     no path through the application — browser, anonymous visitor, Next.js
--     server with the service-role key, or a compromised admin session — can
--     alter or delete an entry.
create or replace function audit_log_immutable() returns trigger
  language plpgsql as $$
begin
  raise exception 'audit_log is append-only: % is not permitted', tg_op
    using errcode = 'insufficient_privilege';
end $$;

create trigger audit_log_no_update
  before update on audit_log for each row execute function audit_log_immutable();
create trigger audit_log_no_delete
  before delete on audit_log for each row execute function audit_log_immutable();
-- Row triggers do not fire on TRUNCATE, so this one has to be statement-level.
create trigger audit_log_no_truncate
  before truncate on audit_log for each statement execute function audit_log_immutable();

-- ---------- Attributable interview notes ----------
-- app/actions/saveNotesAction.ts wrote interview_notes through the service-role
-- client with no authorization check at all — any caller holding a booking id
-- could overwrite anyone's interview assessment. Routing it through an RPC
-- closes that hole and makes the actor attributable via auth.uid(), instead of
-- every note edit being logged as an anonymous "Server task".
--
-- The coalesce(..., false) is the NULL-logic bug 0018 was written to fix; do
-- not reintroduce it.
create or replace function head_update_interview_notes(
  p_booking uuid,
  p_notes text
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  b bookings;
begin
  select * into b from bookings where id = p_booking;
  if b is null then
    raise exception 'booking not found';
  end if;

  if not (coalesce(auth_managed_track() = b.track, false) or is_admin()) then
    raise exception 'not authorized for this track';
  end if;

  update bookings set interview_notes = nullif(p_notes, '') where id = p_booking;
end $$;

revoke execute on function head_update_interview_notes(uuid, text) from public;
grant execute on function head_update_interview_notes(uuid, text) to authenticated;

-- Make audit_log visible to PostgREST straight away.
notify pgrst, 'reload schema';

-- ==========================================
-- MIGRATION: 0030_one_booking_per_student_id.sql
-- ==========================================

-- 0030_one_booking_per_student_id.sql
-- Close the "different email, same person" loophole in public booking.
--
-- one_active_booking_per_email_track_orientation_year (0020) already stops the
-- same email from booking a track twice, but an applicant can type a second
-- email address and rebook. student_id is the actual identity signal here, so
-- give it the same uniqueness guarantee. Left nullable/optional at the column
-- level (unrelated legacy rows may lack it), so the index only applies once a
-- student_id is actually present.

DROP INDEX IF EXISTS one_active_booking_per_student_track_orientation_year;
DO $$ BEGIN
  CREATE UNIQUE INDEX one_active_booking_per_student_track_orientation_year
    ON bookings (student_id, track, orientation, orientation_year)
    WHERE status = 'booked' AND student_id IS NOT NULL;
EXCEPTION WHEN duplicate_table THEN null; END $$;

-- ---------- Update book_slot_public: require student_id, report which constraint tripped ----------
CREATE OR REPLACE FUNCTION book_slot_public(
  p_slot uuid,
  p_name text,
  p_student_id text,
  p_email text,
  p_experiences text
) RETURNS bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s slots;
  taken int;
  b bookings;
  v_constraint text;
BEGIN
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  IF coalesce(trim(p_email), '') = '' THEN
    RAISE EXCEPTION 'email is required';
  END IF;
  IF coalesce(trim(p_student_id), '') = '' THEN
    RAISE EXCEPTION 'student ID is required';
  END IF;

  SELECT * INTO s FROM slots WHERE id = p_slot FOR UPDATE;
  IF s IS NULL THEN
    RAISE EXCEPTION 'slot not found';
  END IF;
  IF s.status <> 'open' THEN
    RAISE EXCEPTION 'slot is not open';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM track_settings t
    WHERE t.track = s.track
      AND t.orientation = s.orientation
      AND t.orientation_year = s.orientation_year
      AND now() >= coalesce(t.window_open, now())
      AND now() <= coalesce(t.window_close, now())
  ) THEN
    RAISE EXCEPTION 'booking window is closed for this track';
  END IF;

  SELECT count(*) INTO taken
  FROM bookings WHERE slot_id = p_slot AND status = 'booked';
  IF taken >= s.capacity THEN
    RAISE EXCEPTION 'slot is full';
  END IF;

  BEGIN
    INSERT INTO bookings (
      slot_id, applicant_id, track, orientation, orientation_year, status,
      applicant_name, applicant_email, student_id, experiences
    )
    VALUES (
      p_slot, null, s.track, s.orientation, s.orientation_year, 'booked',
      trim(p_name), lower(trim(p_email)), nullif(trim(p_student_id), ''), nullif(trim(p_experiences), '')
    )
    RETURNING * INTO b;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'one_active_booking_per_student_track_orientation_year' THEN
      RAISE EXCEPTION 'this student ID already has an active booking in this track for this orientation';
    ELSE
      RAISE EXCEPTION 'this email already has an active booking in this track for this orientation';
    END IF;
  END;

  RETURN b;
END $$;

-- Make the new constraint visible to PostgREST immediately.
NOTIFY pgrst, 'reload schema';

-- ==========================================
-- MIGRATION: 0031_head_invite_status.sql
-- ==========================================

-- 0031_head_invite_status.sql
-- Surface committee-invite status on head_bookings so the head dashboard can
-- show whether an approved applicant has been invited yet and whether they've
-- registered (claimed their invite). staff_invites.email is globally unique
-- (0010), so a plain left join on applicant_email is enough to find the
-- invite tied to a booking — both sides are already lowercased/trimmed at
-- write time (book_slot_public, inviteApprovedBookingAction).

DROP FUNCTION IF EXISTS head_bookings(track, orientation, int);
CREATE OR REPLACE FUNCTION head_bookings(p_track track, p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  booking_id uuid, slot_id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  applicant_name text, applicant_email text, student_id text, experiences text,
  interview_notes text, created_at timestamptz, interview_status text, venue text,
  invited_at timestamptz, invite_claimed_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT (auth_managed_track() = p_track OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized for this track';
  END IF;
  RETURN QUERY
    SELECT b.id, b.slot_id, b.track, b.orientation, b.orientation_year, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id, b.experiences,
           b.interview_notes, b.created_at, b.interview_status::text, s.venue,
           si.created_at, si.claimed_at
    FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    LEFT JOIN staff_invites si ON si.email = b.applicant_email
    WHERE b.track = p_track AND b.orientation = p_orientation AND b.orientation_year = p_year AND b.status = 'booked'
    ORDER BY s.starts_at, b.applicant_name;
END $$;
GRANT EXECUTE ON FUNCTION head_bookings(track, orientation, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ==========================================
-- MIGRATION: 0032_profile_avatar.sql
-- ==========================================

-- 0032_profile_avatar.sql
-- Lets a user upload/change/remove their own profile picture. Stored in a
-- public "avatars" bucket at `{user_id}/avatar.<ext>` — the leading folder is
-- how the storage policies below scope writes to the owner, mirroring the
-- profiles RLS pattern in 0002. Public read means the URL works directly in
-- <img src>/nav without a signed-URL round trip.

alter table profiles add column avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatar_public_read" on storage.objects
  for select
  using (bucket_id = 'avatars');

create policy "avatar_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar_owner_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

NOTIFY pgrst, 'reload schema';
