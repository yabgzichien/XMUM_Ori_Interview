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
