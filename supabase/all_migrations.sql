-- ============================================================
-- 0001_schema.sql
-- ============================================================
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


-- ============================================================
-- 0002_rls.sql
-- ============================================================
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


-- ============================================================
-- 0003_book_slot.sql
-- ============================================================
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


-- ============================================================
-- 0004_cancel_reschedule.sql
-- ============================================================
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


-- ============================================================
-- 0005_handle_new_user.sql
-- ============================================================
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


-- ============================================================
-- 0006_available_slots.sql
-- ============================================================
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


-- ============================================================
-- 0007_head_functions.sql
-- ============================================================
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


-- ============================================================
-- 0008_fix_role_change_trigger.sql
-- ============================================================
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


-- ============================================================
-- 0009_public_booking.sql
-- ============================================================
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
  booking_id uuid, slot_id uuid, starts_at timestamptz, ends_at timestamptz,
  applicant_name text, applicant_email text, student_id text, experiences text,
  created_at timestamptz
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (auth_managed_track() = p_track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  return query
    select b.id, b.slot_id, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id, b.experiences, b.created_at
    from bookings b
    join slots s on s.id = b.slot_id
    where b.track = p_track and b.status = 'booked'
    order by s.starts_at, b.applicant_name;
end $$;

-- ---------- Grants: anonymous visitors browse + book ----------
grant execute on function available_slots(track) to anon, authenticated;
grant execute on function book_slot_public(uuid, text, text, text, text) to anon, authenticated;


-- ============================================================
-- 0010_staff_invites.sql
-- ============================================================
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


-- ============================================================
-- 0011_interview_status.sql
-- ============================================================
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



