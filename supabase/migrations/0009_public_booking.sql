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
