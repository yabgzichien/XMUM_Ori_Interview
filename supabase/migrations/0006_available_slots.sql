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
