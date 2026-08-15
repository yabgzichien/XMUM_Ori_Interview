-- 0026_add_venue_to_slots.sql
-- Adds venue/location field to slots table and updates related RPCs.

-- ---------- slots.venue ----------
ALTER TABLE slots ADD COLUMN IF NOT EXISTS venue text NOT NULL DEFAULT '';

-- ---------- RPC Updates for slots venue ----------

DROP FUNCTION IF EXISTS available_slots(track, orientation);
DROP FUNCTION IF EXISTS available_slots(track, orientation, int);
CREATE OR REPLACE FUNCTION available_slots(p_track track, p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  capacity int, booked_count bigint, seats_left bigint, venue text
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT s.id, s.track, s.orientation, s.orientation_year, s.starts_at, s.ends_at, s.capacity,
         count(b.*) FILTER (WHERE b.status = 'booked') AS booked_count,
         s.capacity - count(b.*) FILTER (WHERE b.status = 'booked') AS seats_left,
         s.venue
  FROM slots s
  LEFT JOIN bookings b ON b.slot_id = s.id
  WHERE s.track = p_track AND s.orientation = p_orientation AND s.orientation_year = p_year
    AND s.status = 'open' AND s.starts_at > now()
  GROUP BY s.id
  ORDER BY s.starts_at
$$;
GRANT EXECUTE ON FUNCTION available_slots(track, orientation, int) TO anon, authenticated;

DROP FUNCTION IF EXISTS head_slots(track, orientation);
DROP FUNCTION IF EXISTS head_slots(track, orientation, int);
CREATE OR REPLACE FUNCTION head_slots(p_track track, p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  capacity int, status slot_status, booked_count bigint, venue text
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT (auth_managed_track() = p_track OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized for this track';
  END IF;
  RETURN QUERY
    SELECT s.id, s.track, s.orientation, s.orientation_year, s.starts_at, s.ends_at, s.capacity, s.status,
           count(b.*) FILTER (WHERE b.status = 'booked') AS booked_count, s.venue
    FROM slots s
    LEFT JOIN bookings b ON b.slot_id = s.id
    WHERE s.track = p_track AND s.orientation = p_orientation AND s.orientation_year = p_year
    GROUP BY s.id
    ORDER BY s.starts_at;
END $$;
GRANT EXECUTE ON FUNCTION head_slots(track, orientation, int) TO authenticated;

DROP FUNCTION IF EXISTS head_bookings(track, orientation);
DROP FUNCTION IF EXISTS head_bookings(track, orientation, int);
CREATE OR REPLACE FUNCTION head_bookings(p_track track, p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  booking_id uuid, slot_id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  applicant_name text, applicant_email text, student_id text, experiences text,
  interview_notes text, created_at timestamptz, interview_status text, venue text
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT (auth_managed_track() = p_track OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized for this track';
  END IF;
  RETURN QUERY
    SELECT b.id, b.slot_id, b.track, b.orientation, b.orientation_year, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id, b.experiences,
           b.interview_notes, b.created_at, b.interview_status::text, s.venue
    FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    WHERE b.track = p_track AND b.orientation = p_orientation AND b.orientation_year = p_year AND b.status = 'booked'
    ORDER BY s.starts_at, b.applicant_name;
END $$;
GRANT EXECUTE ON FUNCTION head_bookings(track, orientation, int) TO authenticated;

DROP FUNCTION IF EXISTS lookup_booking_public(text);
CREATE OR REPLACE FUNCTION lookup_booking_public(p_student_id text)
RETURNS TABLE (
  booking_id   uuid,
  track        track,
  starts_at    timestamptz,
  ends_at      timestamptz,
  applicant_name  text,
  applicant_email text,
  student_id   text,
  interview_status text,
  status       text,
  created_at   timestamptz,
  venue        text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
    SELECT b.id, b.track, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id,
           b.interview_status, b.status::text, b.created_at, s.venue
    FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    WHERE lower(b.student_id) = lower(trim(p_student_id))
    ORDER BY b.created_at DESC;
END $$;
GRANT EXECUTE ON FUNCTION lookup_booking_public(text) TO anon, authenticated;
