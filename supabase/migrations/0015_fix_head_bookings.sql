-- 0015_fix_head_bookings.sql
-- Fix the head_bookings function to return interview_status and interview_notes.

DROP FUNCTION IF EXISTS head_bookings(track, orientation);

CREATE OR REPLACE FUNCTION head_bookings(p_track track, p_orientation orientation)
RETURNS TABLE (
  booking_id uuid,
  slot_id uuid,
  track track,
  orientation orientation,
  starts_at timestamptz,
  ends_at timestamptz,
  applicant_name text,
  applicant_email text,
  student_id text,
  experiences text,
  created_at timestamptz,
  interview_status text,
  interview_notes text
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT (auth_managed_track() = p_track OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized for this track';
  END IF;
  RETURN QUERY
    SELECT b.id, b.slot_id, b.track, b.orientation, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id, b.experiences, b.created_at,
           b.interview_status, b.interview_notes
    FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    WHERE b.track = p_track AND b.orientation = p_orientation AND b.status = 'booked'
    ORDER BY s.starts_at, b.applicant_name;
END $$;

GRANT EXECUTE ON FUNCTION head_bookings(track, orientation) TO authenticated;
