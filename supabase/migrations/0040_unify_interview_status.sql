-- MIGRATION: 0040_unify_interview_status.sql
-- Unify interview status to two statuses: 'rejected' and 'approved'.
-- Default is 'rejected'.

-- 1. Drop existing check constraint first so rows can be updated to 'rejected'
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_interview_status_check;

-- 2. Migrate any existing pending or failed rows to rejected
UPDATE bookings
SET interview_status = 'rejected'
WHERE interview_status IS NULL OR interview_status IN ('pending', 'failed') OR interview_status <> 'approved';

-- 3. Update default value on bookings table
ALTER TABLE bookings
  ALTER COLUMN interview_status SET DEFAULT 'rejected';

-- 4. Add updated check constraint to only allow approved and rejected
ALTER TABLE bookings
  ADD CONSTRAINT bookings_interview_status_check
  CHECK (interview_status IN ('approved', 'rejected'));

-- 5. Update head_update_interview_status RPC function
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

  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  UPDATE bookings
  SET interview_status = p_status
  WHERE id = p_booking;
END $$;

REVOKE EXECUTE ON FUNCTION head_update_interview_status(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION head_update_interview_status(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
