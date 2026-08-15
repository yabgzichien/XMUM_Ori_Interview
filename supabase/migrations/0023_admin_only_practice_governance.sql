-- 0023_admin_only_practice_governance.sql
-- Locks committee-position and performance-lead management down to admin
-- only. Previously any head (facilitator or GM) could grant another
-- committee member HOF/HOG (and therefore real head-dashboard access) via
-- head_set_committee_position, and could create/reassign/delete practice
-- groups and their leads. Group housekeeping (rename/capacity/status) is
-- also restricted to admin now — heads get view-only access to existing
-- groups. In exchange, the performance lead gets a new self-service RPC to
-- edit their own group's name/capacity, alongside the session management
-- they already had.

-- ---------- head_set_committee_position: admin only ----------
CREATE OR REPLACE FUNCTION head_set_committee_position(p_profile_id uuid, p_position text)
RETURNS profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target profiles;
  new_role user_role;
  is_leading boolean;
  row_out profiles;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO target FROM profiles WHERE id = p_profile_id FOR UPDATE;
  IF target IS NULL OR target.orientation IS NULL
     OR target.role NOT IN ('committee', 'performance_lead', 'head_facilitator', 'head_gm') THEN
    RAISE EXCEPTION 'target must be a committee member';
  END IF;

  new_role := target.role;

  IF p_position = 'hof' THEN
    new_role := 'head_facilitator';
  ELSIF p_position = 'hog' THEN
    new_role := 'head_gm';
  ELSIF target.position IN ('hof', 'hog') AND target.role IN ('head_facilitator', 'head_gm') THEN
    SELECT EXISTS (SELECT 1 FROM practice_groups WHERE lead_id = p_profile_id) INTO is_leading;
    new_role := CASE WHEN is_leading THEN 'performance_lead' ELSE 'committee' END;
  END IF;

  UPDATE profiles SET position = p_position, role = new_role WHERE id = p_profile_id
  RETURNING * INTO row_out;
  RETURN row_out;
END $$;

-- ---------- head_create_practice_group: admin only ----------
CREATE OR REPLACE FUNCTION head_create_practice_group(
  p_name text, p_orientation orientation, p_capacity int, p_lead_profile_id uuid, p_year int DEFAULT 2026
) RETURNS practice_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lead_profile profiles;
  row_out practice_groups;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO lead_profile FROM profiles WHERE id = p_lead_profile_id FOR UPDATE;
  IF lead_profile IS NULL OR lead_profile.role <> 'committee' OR lead_profile.orientation <> p_orientation OR lead_profile.orientation_year <> p_year THEN
    RAISE EXCEPTION 'chosen lead must be a committee member in this orientation and year';
  END IF;

  UPDATE profiles SET role = 'performance_lead' WHERE id = p_lead_profile_id;

  BEGIN
    INSERT INTO practice_groups (name, orientation, orientation_year, capacity, lead_id, created_by)
    VALUES (trim(p_name), p_orientation, p_year, p_capacity, p_lead_profile_id, auth.uid())
    RETURNING * INTO row_out;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'this person already leads a practice group';
  END;

  RETURN row_out;
END $$;

-- ---------- head_reassign_practice_lead: admin only ----------
CREATE OR REPLACE FUNCTION head_reassign_practice_lead(p_group uuid, p_new_lead_profile_id uuid)
RETURNS practice_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g practice_groups;
  new_lead profiles;
  row_out practice_groups;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO g FROM practice_groups WHERE id = p_group FOR UPDATE;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  SELECT * INTO new_lead FROM profiles WHERE id = p_new_lead_profile_id;
  IF new_lead IS NULL OR new_lead.role <> 'committee' OR new_lead.orientation <> g.orientation THEN
    RAISE EXCEPTION 'chosen lead must be a committee member in this orientation';
  END IF;

  UPDATE profiles SET role = 'committee' WHERE id = g.lead_id;
  UPDATE profiles SET role = 'performance_lead' WHERE id = p_new_lead_profile_id;

  UPDATE practice_groups SET lead_id = p_new_lead_profile_id WHERE id = p_group
  RETURNING * INTO row_out;
  RETURN row_out;
END $$;

-- ---------- head_update_practice_group: admin only ----------
CREATE OR REPLACE FUNCTION head_update_practice_group(
  p_group uuid, p_name text, p_capacity int, p_status slot_status
) RETURNS practice_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g practice_groups;
  row_out practice_groups;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO g FROM practice_groups WHERE id = p_group;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  UPDATE practice_groups SET name = trim(p_name), capacity = p_capacity, status = p_status
  WHERE id = p_group RETURNING * INTO row_out;
  RETURN row_out;
END $$;

-- ---------- head_delete_practice_group: admin only ----------
CREATE OR REPLACE FUNCTION head_delete_practice_group(p_group uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g practice_groups;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO g FROM practice_groups WHERE id = p_group;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  UPDATE profiles SET role = 'committee' WHERE id = g.lead_id;
  DELETE FROM practice_groups WHERE id = p_group;
END $$;

-- ---------- prevent_self_role_change: admin only, no head exception ----------
CREATE OR REPLACE FUNCTION prevent_self_role_change() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF new.role <> old.role AND auth.uid() IS NOT NULL AND NOT is_admin() THEN
    RAISE EXCEPTION 'only an admin may change a role';
  END IF;
  RETURN new;
END $$;

-- ---------- lead_update_practice_group: the lead's self-service edit ----------
CREATE OR REPLACE FUNCTION lead_update_practice_group(p_group uuid, p_name text, p_capacity int)
RETURNS practice_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g practice_groups;
  row_out practice_groups;
BEGIN
  SELECT * INTO g FROM practice_groups WHERE id = p_group;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  IF NOT (coalesce(g.lead_id = auth.uid(), false) OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized for this group';
  END IF;
  UPDATE practice_groups SET name = trim(p_name), capacity = p_capacity
  WHERE id = p_group RETURNING * INTO row_out;
  RETURN row_out;
END $$;

-- ---------- Grants ----------
GRANT EXECUTE ON FUNCTION head_set_committee_position(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION head_create_practice_group(text, orientation, int, uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION head_reassign_practice_lead(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION head_update_practice_group(uuid, text, int, slot_status) TO authenticated;
GRANT EXECUTE ON FUNCTION head_delete_practice_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION lead_update_practice_group(uuid, text, int) TO authenticated;
