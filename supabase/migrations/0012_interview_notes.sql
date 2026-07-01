-- 0012_interview_notes.sql
-- Add interview_notes column for Committee member evaluation notes.
-- Also add public lookup and cancel RPCs for the self-service /my-booking portal.

-- ---------- interview_notes column ----------
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS interview_notes text;

-- ---------- public lookup: requires matching email + booking UUID ----------
CREATE OR REPLACE FUNCTION lookup_booking_public(p_email text, p_booking_id uuid)
RETURNS TABLE (
  booking_id uuid,
  track track,
  starts_at timestamptz,
  ends_at timestamptz,
  applicant_name text,
  applicant_email text,
  student_id text,
  interview_status text,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
    SELECT b.id, b.track, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id,
           b.interview_status, b.status::text, b.created_at
    FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    WHERE b.id = p_booking_id
      AND lower(b.applicant_email) = lower(trim(p_email));
END $$;

GRANT EXECUTE ON FUNCTION lookup_booking_public(text, uuid) TO anon, authenticated;

-- ---------- public cancel: requires matching email + booking UUID ----------
CREATE OR REPLACE FUNCTION cancel_booking_public(p_email text, p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b bookings;
BEGIN
  SELECT * INTO b FROM bookings
    WHERE id = p_booking_id
      AND lower(applicant_email) = lower(trim(p_email))
    FOR UPDATE;

  IF b IS NULL THEN
    RAISE EXCEPTION 'booking not found or email does not match';
  END IF;

  IF b.status <> 'booked' THEN
    RAISE EXCEPTION 'this booking is not active';
  END IF;

  UPDATE bookings SET status = 'cancelled' WHERE id = p_booking_id;
END $$;

GRANT EXECUTE ON FUNCTION cancel_booking_public(text, uuid) TO anon, authenticated;
