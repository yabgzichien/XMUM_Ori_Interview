-- MIGRATION: 0039_head_bookings_allow_all_positions.sql
-- Allow head_bookings to return bookings for all tracks when p_track is null or specified,
-- and allow any head (facilitator or GM) and admins to manage bookings across positions.

DROP FUNCTION IF EXISTS head_bookings(track, orientation, int);

CREATE OR REPLACE FUNCTION head_bookings(
  p_track track DEFAULT NULL,
  p_orientation orientation DEFAULT 'december',
  p_year int DEFAULT 2026
)
RETURNS TABLE (
  booking_id uuid, slot_id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  applicant_name text, applicant_email text, student_id text, experiences text,
  interview_notes text, created_at timestamptz, interview_status text, venue text,
  invited_at timestamptz, invite_claimed_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT (auth_managed_track() IS NOT NULL OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized for bookings';
  END IF;

  RETURN QUERY
    SELECT b.id, b.slot_id, b.track, b.orientation, b.orientation_year, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id, b.experiences,
           b.interview_notes, b.created_at, b.interview_status::text, s.venue,
           si.created_at, si.claimed_at
    FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    LEFT JOIN staff_invites si ON si.email = b.applicant_email
    WHERE (p_track IS NULL OR b.track = p_track)
      AND b.orientation = p_orientation
      AND b.orientation_year = p_year
      AND b.status = 'booked'
    ORDER BY s.starts_at, b.applicant_name;
END $$;

REVOKE EXECUTE ON FUNCTION head_bookings(track, orientation, int) FROM public;
GRANT EXECUTE ON FUNCTION head_bookings(track, orientation, int) TO authenticated;

-- Allow heads and admins to cancel bookings across positions
CREATE OR REPLACE FUNCTION head_cancel_booking(p_booking uuid)
RETURNS bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b bookings;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking FOR UPDATE;
  IF b IS NULL THEN
    RAISE EXCEPTION 'booking not found';
  END IF;
  IF NOT (auth_managed_track() IS NOT NULL OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized to cancel this booking';
  END IF;
  IF b.status <> 'booked' THEN
    RAISE EXCEPTION 'booking is not active';
  END IF;
  UPDATE bookings SET status = 'cancelled' WHERE id = p_booking RETURNING * INTO b;
  RETURN b;
END $$;

REVOKE EXECUTE ON FUNCTION head_cancel_booking(uuid) FROM public;
GRANT EXECUTE ON FUNCTION head_cancel_booking(uuid) TO authenticated;

-- Allow heads and admins to update interview status across positions
CREATE OR REPLACE FUNCTION head_update_interview_status(
  p_booking uuid,
  p_status text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b bookings;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking;
  IF b IS NULL THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  IF NOT (auth_managed_track() IS NOT NULL OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized to update this booking';
  END IF;

  IF p_status NOT IN ('pending', 'failed', 'approved') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  UPDATE bookings
  SET interview_status = p_status
  WHERE id = p_booking;
END $$;

REVOKE EXECUTE ON FUNCTION head_update_interview_status(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION head_update_interview_status(uuid, text) TO authenticated;
