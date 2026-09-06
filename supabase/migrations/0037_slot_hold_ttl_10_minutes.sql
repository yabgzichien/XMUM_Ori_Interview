-- 0037_slot_hold_ttl_10_minutes.sql
-- Increase slot hold reservation TTL from 3 minutes to 10 minutes.
-- Updates reserve_slot, confirm_reservation, and available_slots.

-- ---------- 1. reserve_slot: claim a seat for 10 minutes ----------
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
    where slot_id = p_slot and not released and held_at > now() - interval '10 minutes';

  if booked_count + held_count >= s.capacity then
    raise exception 'slot is full';
  end if;

  insert into slot_holds (slot_id) values (p_slot) returning * into h;

  result.hold_id := h.id;
  result.token := h.token;
  result.expires_at := h.held_at + interval '10 minutes';
  return result;
end $$;

-- ---------- 2. confirm_reservation: validate 10-minute hold TTL ----------
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
  booked_count int;
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
  if h is null or h.released or h.held_at <= now() - interval '10 minutes' then
    raise exception 'hold expired';
  end if;

  select * into s from slots where id = h.slot_id for update;
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

  select count(*) into booked_count from bookings where slot_id = h.slot_id and status = 'booked';
  if booked_count >= s.capacity then
    raise exception 'slot is full';
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

-- ---------- 3. available_slots: compute seats_left with 10-minute hold TTL ----------
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
                where h.slot_id = s.id and not h.released and h.held_at > now() - interval '10 minutes')
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
grant execute on function available_slots(track, orientation, int) to anon, authenticated;

notify pgrst, 'reload schema';
