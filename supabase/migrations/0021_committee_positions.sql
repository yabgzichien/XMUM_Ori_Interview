-- 0021_committee_positions.sql
-- Adds an organizational committee "position" (e.g. Treasurer, Secretary,
-- HOF/HOG) to committee-tier profiles. Distinct from `track` (interview
-- track) and `role` (account access level) — this is purely a display label
-- a head/admin assigns, surfaced wherever a group's members are listed.

DO $$ BEGIN
  ALTER TABLE profiles ADD COLUMN position text;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE profiles ADD CONSTRAINT profiles_position_chk
    CHECK (position IS NULL OR position IN (
      'hof', 'hog', 'game_master', 'facilitator', 'treasurer', 'sponsorship',
      'logistic', 'tech_team', 'organising_chairperson', 'event_planner',
      'designer', 'pgvg', 'public_relations', 'secretary'
    ));
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------- head_committee_roster: surface position ----------
DROP FUNCTION IF EXISTS head_committee_roster(orientation, int);
CREATE OR REPLACE FUNCTION head_committee_roster(p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (id uuid, name text, email text, track track, role user_role, "position" text, leading_group_id uuid)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT is_head_or_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
    SELECT pr.id, pr.name, pr.email, pr.track, pr.role, pr.position, g.id
    FROM profiles pr
    LEFT JOIN practice_groups g ON g.lead_id = pr.id
    WHERE pr.orientation = p_orientation AND pr.orientation_year = p_year
      AND pr.role IN ('committee', 'performance_lead')
    ORDER BY pr.name;
END $$;

-- ---------- my_practice_group_members: surface position ----------
DROP FUNCTION IF EXISTS my_practice_group_members();
CREATE OR REPLACE FUNCTION my_practice_group_members()
RETURNS TABLE (member_id uuid, member_name text, "position" text, joined_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  RETURN QUERY
    SELECT m.member_id, p.name, p.position, m.joined_at
    FROM practice_group_members m
    JOIN profiles p ON p.id = m.member_id
    WHERE m.group_id IN (
      SELECT g.id FROM practice_groups g
      WHERE g.lead_id = auth.uid()
         OR EXISTS (
           SELECT 1 FROM practice_group_members m2
           WHERE m2.group_id = g.id AND m2.member_id = auth.uid()
         )
    )
    ORDER BY m.joined_at;
END $$;

-- ---------- head_set_committee_position: assign/change a position ----------
CREATE OR REPLACE FUNCTION head_set_committee_position(p_profile_id uuid, p_position text)
RETURNS profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target profiles;
  row_out profiles;
BEGIN
  IF NOT is_head_or_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO target FROM profiles WHERE id = p_profile_id FOR UPDATE;
  IF target IS NULL OR target.role NOT IN ('committee', 'performance_lead') THEN
    RAISE EXCEPTION 'target must be a committee member';
  END IF;
  UPDATE profiles SET position = p_position WHERE id = p_profile_id
  RETURNING * INTO row_out;
  RETURN row_out;
END $$;

-- ---------- Grants ----------
GRANT EXECUTE ON FUNCTION head_committee_roster(orientation, int) TO authenticated;
GRANT EXECUTE ON FUNCTION my_practice_group_members() TO authenticated;
GRANT EXECUTE ON FUNCTION head_set_committee_position(uuid, text) TO authenticated;
