-- 0036_slot_holds_hardening.sql
-- Two follow-up hardening fixes for the slot-hold flow added in 0034:
--
-- 1. slot_holds.slot_id had no ON DELETE CASCADE. Hold rows persist forever
--    by design (lazy expiry, no sweep job), so any slot that was ever held
--    -- even briefly, even long after the hold expired -- became permanently
--    undeletable via the head dashboard's slot-delete path (FK violation).
--
-- 2. confirm_reservation had no capacity re-check before inserting the
--    booking. book_slot_public (the RPC this replaced) checked capacity
--    right before its insert; confirm_reservation validates the hold, the
--    slot status, and the booking window, but never re-checks capacity. If
--    an admin lowers a slot's capacity while a hold is live (SlotsTable's
--    guard only blocks lowering below booked_count, not below
--    booked_count + held_count), the held applicant can confirm afterwards
--    and the insert succeeds unchecked, producing a booking count that
--    exceeds capacity.

-- ---------- 1. slot_holds.slot_id: add ON DELETE CASCADE ----------
alter table slot_holds drop constraint slot_holds_slot_id_fkey;
alter table slot_holds
  add constraint slot_holds_slot_id_fkey
  foreign key (slot_id) references slots(id) on delete cascade;

-- ---------- 2. confirm_reservation: lock the slot row + re-check capacity ----------
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
  if h is null or h.released or h.held_at <= now() - interval '3 minutes' then
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

grant execute on function confirm_reservation(uuid, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
