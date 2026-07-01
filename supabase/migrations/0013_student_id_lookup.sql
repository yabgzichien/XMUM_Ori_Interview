-- 0013_student_id_lookup.sql
-- Replace the old email+uuid lookup with a student_id-only lookup.
-- Case-insensitive matching (lower() on both sides).
-- Cancel is secured by student_id + booking_id to ensure the requester owns the booking.

-- Drop old signatures so they can be replaced.
DROP FUNCTION IF EXISTS lookup_booking_public(text, uuid);
DROP FUNCTION IF EXISTS cancel_booking_public(text, uuid);

-- ---------- lookup: student_id only (case-insensitive) ----------
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
  created_at   timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
    SELECT b.id, b.track, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id,
           b.interview_status, b.status::text, b.created_at
    FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    WHERE lower(b.student_id) = lower(trim(p_student_id))
    ORDER BY b.created_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION lookup_booking_public(text) TO anon, authenticated;

-- ---------- cancel: secured by student_id + booking_id ----------
CREATE OR REPLACE FUNCTION cancel_booking_public(p_student_id text, p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b bookings;
BEGIN
  SELECT * INTO b FROM bookings
    WHERE id = p_booking_id
      AND lower(student_id) = lower(trim(p_student_id))
    FOR UPDATE;

  IF b IS NULL THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  IF b.status <> 'booked' THEN
    RAISE EXCEPTION 'this booking is not active';
  END IF;

  UPDATE bookings SET status = 'cancelled' WHERE id = p_booking_id;
END $$;

GRANT EXECUTE ON FUNCTION cancel_booking_public(text, uuid) TO anon, authenticated;
