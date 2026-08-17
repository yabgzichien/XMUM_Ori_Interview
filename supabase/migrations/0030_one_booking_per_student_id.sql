-- 0030_one_booking_per_student_id.sql
-- Close the "different email, same person" loophole in public booking.
--
-- one_active_booking_per_email_track_orientation_year (0020) already stops the
-- same email from booking a track twice, but an applicant can type a second
-- email address and rebook. student_id is the actual identity signal here, so
-- give it the same uniqueness guarantee. Left nullable/optional at the column
-- level (unrelated legacy rows may lack it), so the index only applies once a
-- student_id is actually present.

DROP INDEX IF EXISTS one_active_booking_per_student_track_orientation_year;
DO $$ BEGIN
  CREATE UNIQUE INDEX one_active_booking_per_student_track_orientation_year
    ON bookings (student_id, track, orientation, orientation_year)
    WHERE status = 'booked' AND student_id IS NOT NULL;
EXCEPTION WHEN duplicate_table THEN null; END $$;

-- ---------- Update book_slot_public: require student_id, report which constraint tripped ----------
CREATE OR REPLACE FUNCTION book_slot_public(
  p_slot uuid,
  p_name text,
  p_student_id text,
  p_email text,
  p_experiences text
) RETURNS bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s slots;
  taken int;
  b bookings;
  v_constraint text;
BEGIN
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  IF coalesce(trim(p_email), '') = '' THEN
    RAISE EXCEPTION 'email is required';
  END IF;
  IF coalesce(trim(p_student_id), '') = '' THEN
    RAISE EXCEPTION 'student ID is required';
  END IF;

  SELECT * INTO s FROM slots WHERE id = p_slot FOR UPDATE;
  IF s IS NULL THEN
    RAISE EXCEPTION 'slot not found';
  END IF;
  IF s.status <> 'open' THEN
    RAISE EXCEPTION 'slot is not open';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM track_settings t
    WHERE t.track = s.track
      AND t.orientation = s.orientation
      AND t.orientation_year = s.orientation_year
      AND now() >= coalesce(t.window_open, now())
      AND now() <= coalesce(t.window_close, now())
  ) THEN
    RAISE EXCEPTION 'booking window is closed for this track';
  END IF;

  SELECT count(*) INTO taken
  FROM bookings WHERE slot_id = p_slot AND status = 'booked';
  IF taken >= s.capacity THEN
    RAISE EXCEPTION 'slot is full';
  END IF;

  BEGIN
    INSERT INTO bookings (
      slot_id, applicant_id, track, orientation, orientation_year, status,
      applicant_name, applicant_email, student_id, experiences
    )
    VALUES (
      p_slot, null, s.track, s.orientation, s.orientation_year, 'booked',
      trim(p_name), lower(trim(p_email)), nullif(trim(p_student_id), ''), nullif(trim(p_experiences), '')
    )
    RETURNING * INTO b;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'one_active_booking_per_student_track_orientation_year' THEN
      RAISE EXCEPTION 'this student ID already has an active booking in this track for this orientation';
    ELSE
      RAISE EXCEPTION 'this email already has an active booking in this track for this orientation';
    END IF;
  END;

  RETURN b;
END $$;

-- Make the new constraint visible to PostgREST immediately.
NOTIFY pgrst, 'reload schema';
