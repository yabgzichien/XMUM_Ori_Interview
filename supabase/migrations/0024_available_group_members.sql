-- 0024_available_group_members.sql
-- Surfaces each open practice group's member names in the browse/join view
-- (available_practice_groups), so a committee member can see who's already
-- in a group before deciding to join it.

DROP FUNCTION IF EXISTS available_practice_groups();
CREATE OR REPLACE FUNCTION available_practice_groups()
RETURNS TABLE (
  id uuid, name text, lead_id uuid, lead_name text, capacity int,
  member_count bigint, seats_left bigint, status slot_status, session_count bigint,
  member_names text[]
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  caller_orientation orientation;
  caller_year int;
BEGIN
  IF coalesce(auth_role() NOT IN ('committee', 'performance_lead'), true) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT orientation, orientation_year INTO caller_orientation, caller_year FROM auth_committee_scope();
  IF caller_orientation IS NULL THEN
    RAISE EXCEPTION 'no orientation on this profile';
  END IF;
  RETURN QUERY
    SELECT g.id, g.name, g.lead_id, p.name AS lead_name, g.capacity,
           count(m.*) AS member_count,
           g.capacity - count(m.*) AS seats_left,
           g.status,
           count(distinct s.id) AS session_count,
           array_remove(array_agg(distinct mp.name), NULL) AS member_names
    FROM practice_groups g
    JOIN profiles p ON p.id = g.lead_id
    LEFT JOIN practice_group_members m ON m.group_id = g.id
    LEFT JOIN profiles mp ON mp.id = m.member_id
    LEFT JOIN practice_sessions s ON s.group_id = g.id
    WHERE g.orientation = caller_orientation AND g.orientation_year = caller_year
    GROUP BY g.id, p.name
    ORDER BY g.name;
END $$;

GRANT EXECUTE ON FUNCTION available_practice_groups() TO authenticated;
