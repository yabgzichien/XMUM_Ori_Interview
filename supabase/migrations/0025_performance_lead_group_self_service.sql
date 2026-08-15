-- 0025_performance_lead_group_self_service.sql
-- Lets a performance lead (including one who is also a Head, e.g. via the
-- HOF/HOG position) manage their own group's members, and adds a free-text
-- location to practice sessions. Mirrors the existing lead_* authorization
-- pattern: `g.lead_id = auth.uid() OR is_head_or_admin()`.

-- ---------- practice_sessions.location ----------
ALTER TABLE practice_sessions ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '';

-- ---------- Session RPCs: carry location through ----------
DROP FUNCTION IF EXISTS lead_create_session(uuid, timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION lead_create_session(p_group uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_location text DEFAULT '')
RETURNS practice_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g practice_groups;
  row_out practice_sessions;
BEGIN
  SELECT * INTO g FROM practice_groups WHERE id = p_group;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  IF NOT (coalesce(g.lead_id = auth.uid(), false) OR is_head_or_admin()) THEN
    RAISE EXCEPTION 'not authorized for this group';
  END IF;
  INSERT INTO practice_sessions (group_id, starts_at, ends_at, location, created_by)
  VALUES (p_group, p_starts_at, p_ends_at, trim(p_location), auth.uid())
  RETURNING * INTO row_out;
  RETURN row_out;
END $$;

DROP FUNCTION IF EXISTS lead_update_session(uuid, timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION lead_update_session(p_session uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_location text DEFAULT '')
RETURNS practice_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s practice_sessions;
  g practice_groups;
  row_out practice_sessions;
BEGIN
  SELECT * INTO s FROM practice_sessions WHERE id = p_session;
  IF s IS NULL THEN
    RAISE EXCEPTION 'session not found';
  END IF;
  SELECT * INTO g FROM practice_groups WHERE id = s.group_id;
  IF NOT (coalesce(g.lead_id = auth.uid(), false) OR is_head_or_admin()) THEN
    RAISE EXCEPTION 'not authorized for this group';
  END IF;
  UPDATE practice_sessions SET starts_at = p_starts_at, ends_at = p_ends_at, location = trim(p_location)
  WHERE id = p_session RETURNING * INTO row_out;
  RETURN row_out;
END $$;

DROP FUNCTION IF EXISTS my_practice_group_sessions();
CREATE OR REPLACE FUNCTION my_practice_group_sessions()
RETURNS TABLE (id uuid, starts_at timestamptz, ends_at timestamptz, location text)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  RETURN QUERY
    SELECT s.id, s.starts_at, s.ends_at, s.location
    FROM practice_sessions s
    WHERE s.group_id IN (
      SELECT g.id FROM practice_groups g
      WHERE g.lead_id = auth.uid()
         OR EXISTS (
           SELECT 1 FROM practice_group_members m
           WHERE m.group_id = g.id AND m.member_id = auth.uid()
         )
    )
    ORDER BY s.starts_at;
END $$;

-- ---------- Member management: lead can add/remove members on their own group ----------
DROP FUNCTION IF EXISTS lead_eligible_members(uuid);
CREATE OR REPLACE FUNCTION lead_eligible_members(p_group uuid)
RETURNS TABLE (id uuid, name text, student_id text, email text)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  g practice_groups;
BEGIN
  SELECT * INTO g FROM practice_groups WHERE id = p_group;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  IF NOT (coalesce(g.lead_id = auth.uid(), false) OR is_head_or_admin()) THEN
    RAISE EXCEPTION 'not authorized for this group';
  END IF;
  RETURN QUERY
    SELECT pr.id, pr.name, pr.student_id, pr.email
    FROM profiles pr
    WHERE pr.role = 'committee'
      AND pr.orientation = g.orientation
      AND pr.orientation_year = g.orientation_year
      AND NOT EXISTS (
        SELECT 1 FROM practice_group_members m
        WHERE m.member_id = pr.id AND m.orientation = g.orientation AND m.orientation_year = g.orientation_year
      )
    ORDER BY pr.name;
END $$;

DROP FUNCTION IF EXISTS lead_add_member(uuid, uuid);
CREATE OR REPLACE FUNCTION lead_add_member(p_group uuid, p_member_id uuid)
RETURNS practice_group_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g practice_groups;
  target profiles;
  taken int;
  row_out practice_group_members;
BEGIN
  SELECT * INTO g FROM practice_groups WHERE id = p_group FOR UPDATE;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  IF NOT (coalesce(g.lead_id = auth.uid(), false) OR is_head_or_admin()) THEN
    RAISE EXCEPTION 'not authorized for this group';
  END IF;
  IF g.status <> 'open' THEN
    RAISE EXCEPTION 'group is closed';
  END IF;

  SELECT * INTO target FROM profiles WHERE id = p_member_id;
  IF target IS NULL OR target.role <> 'committee' OR target.orientation <> g.orientation OR target.orientation_year <> g.orientation_year THEN
    RAISE EXCEPTION 'chosen member must be a committee member in this group''s orientation and year';
  END IF;

  SELECT count(*) INTO taken FROM practice_group_members WHERE group_id = p_group;
  IF taken >= g.capacity THEN
    RAISE EXCEPTION 'group is full';
  END IF;

  BEGIN
    INSERT INTO practice_group_members (group_id, member_id, orientation, orientation_year)
    VALUES (p_group, p_member_id, g.orientation, g.orientation_year)
    RETURNING * INTO row_out;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'this member already belongs to a practice group for this orientation';
  END;

  RETURN row_out;
END $$;

DROP FUNCTION IF EXISTS lead_remove_member(uuid, uuid);
CREATE OR REPLACE FUNCTION lead_remove_member(p_group uuid, p_member_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g practice_groups;
BEGIN
  SELECT * INTO g FROM practice_groups WHERE id = p_group;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  IF NOT (coalesce(g.lead_id = auth.uid(), false) OR is_head_or_admin()) THEN
    RAISE EXCEPTION 'not authorized for this group';
  END IF;
  DELETE FROM practice_group_members WHERE group_id = p_group AND member_id = p_member_id;
END $$;

-- ---------- Grants ----------
GRANT EXECUTE ON FUNCTION lead_create_session(uuid, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION lead_update_session(uuid, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION my_practice_group_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION lead_eligible_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION lead_add_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION lead_remove_member(uuid, uuid) TO authenticated;
