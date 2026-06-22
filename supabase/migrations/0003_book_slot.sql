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
