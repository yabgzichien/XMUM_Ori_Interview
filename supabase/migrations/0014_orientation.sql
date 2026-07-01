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
