-- 0038_purge_past_slots_and_cascade_delete.sql
-- 1. Cascade delete bookings when a slot is deleted
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_slot_id_fkey,
  ADD CONSTRAINT bookings_slot_id_fkey
    FOREIGN KEY (slot_id) REFERENCES slots(id) ON DELETE CASCADE;

-- 2. Function to purge all past slots from the database (ended slots)
CREATE OR REPLACE FUNCTION purge_past_slots()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count int;
BEGIN
  WITH deleted AS (
    DELETE FROM slots
    WHERE ends_at <= now()
    RETURNING id
  )
  SELECT count(*) INTO deleted_count FROM deleted;
  RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION purge_past_slots() TO anon, authenticated;

-- 3. Update head_slots to purge past slots on invocation
DROP FUNCTION IF EXISTS head_slots(track, orientation);
DROP FUNCTION IF EXISTS head_slots(track, orientation, int);
CREATE OR REPLACE FUNCTION head_slots(p_track track, p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  capacity int, status slot_status, booked_count bigint, venue text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (auth_managed_track() = p_track OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized for this track';
  END IF;

  -- Automatically remove all past interview slots from the database
  PERFORM purge_past_slots();

  RETURN QUERY
    SELECT s.id, s.track, s.orientation, s.orientation_year, s.starts_at, s.ends_at, s.capacity, s.status,
           count(b.*) FILTER (WHERE b.status = 'booked') AS booked_count, s.venue
    FROM slots s
    LEFT JOIN bookings b ON b.slot_id = s.id
    WHERE s.track = p_track AND s.orientation = p_orientation AND s.orientation_year = p_year
    GROUP BY s.id
    ORDER BY s.starts_at;
END;
$$;

GRANT EXECUTE ON FUNCTION head_slots(track, orientation, int) TO authenticated;

-- 4. Update available_slots to purge past slots on invocation
DROP FUNCTION IF EXISTS available_slots(track, orientation);
DROP FUNCTION IF EXISTS available_slots(track, orientation, int);
CREATE OR REPLACE FUNCTION available_slots(p_track track, p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  capacity int, booked_count bigint, seats_left bigint, venue text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Automatically purge past slots
  PERFORM purge_past_slots();

  RETURN QUERY
    SELECT s.id, s.track, s.orientation, s.orientation_year, s.starts_at, s.ends_at, s.capacity,
           count(b.*) FILTER (WHERE b.status = 'booked') AS booked_count,
           s.capacity
             - count(b.*) FILTER (WHERE b.status = 'booked')
             - (SELECT count(*) FROM slot_holds h
                  WHERE h.slot_id = s.id AND NOT h.released AND h.held_at > now() - interval '10 minutes')
             AS seats_left,
           s.venue
    FROM slots s
    LEFT JOIN bookings b ON b.slot_id = s.id
    WHERE s.track = p_track AND s.orientation = p_orientation AND s.orientation_year = p_year
      AND s.status = 'open' AND s.starts_at > now()
    GROUP BY s.id
    ORDER BY s.starts_at;
END;
$$;

GRANT EXECUTE ON FUNCTION available_slots(track, orientation, int) TO anon, authenticated;

-- 5. Run initial purge of existing past slots
SELECT purge_past_slots();

NOTIFY pgrst, 'reload schema';
