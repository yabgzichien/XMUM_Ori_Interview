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
