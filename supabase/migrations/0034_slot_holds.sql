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
