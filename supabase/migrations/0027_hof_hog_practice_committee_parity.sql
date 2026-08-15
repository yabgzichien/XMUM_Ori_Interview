-- 0027_hof_hog_practice_committee_parity.sql
-- HOF/HOG (head_facilitator/head_gm) lose their elevated view into the
-- performance-practice feature: for practice purposes they now behave
-- exactly like a normal committee member — they browse/join/leave a group
-- via /practice like anyone else, with no visibility into other groups, the
-- committee roster, or any group's member list. That cross-group visibility
-- (head_practice_groups, head_committee_roster, the practice_* "select head
-- or admin" RLS policies, and the head-override branch on the lead_* RPCs)
-- is now admin-only.
--
-- is_head_or_admin() is redefined rather than renamed: every RLS policy and
-- RPC that already calls it (head_practice_groups, head_committee_roster,
-- lead_create_session/update/delete, lead_eligible_members/add/remove_member,
-- and the three practice_*_select_head_or_admin policies) picks up the
-- narrower admin-only check automatically, with no need to touch those
-- definitions individually.
--
-- This does NOT touch head_facilitator/head_gm's real /head dashboard
-- access (booking slots, interview notes) — that is unrelated and stays as
-- introduced in 0022.

-- ---------- is_head_or_admin: admin only for practice governance/visibility ----------
CREATE OR REPLACE FUNCTION is_head_or_admin() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT is_admin()
$$;

-- ---------- available_practice_groups: HOF/HOG browse like committee ----------
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
  IF coalesce(auth_role() NOT IN ('committee', 'performance_lead', 'head_facilitator', 'head_gm'), true) THEN
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

-- ---------- join_practice_group: HOF/HOG join like committee ----------
CREATE OR REPLACE FUNCTION join_practice_group(p_group uuid)
RETURNS practice_group_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g practice_groups;
  taken int;
  caller_orientation orientation;
  caller_year int;
  row_out practice_group_members;
BEGIN
  IF coalesce(auth_role() NOT IN ('committee', 'head_facilitator', 'head_gm'), true) THEN
    RAISE EXCEPTION 'only committee members may join a group';
  END IF;
  SELECT orientation, orientation_year INTO caller_orientation, caller_year FROM auth_committee_scope();
  IF caller_orientation IS NULL THEN
    RAISE EXCEPTION 'no orientation on this profile';
  END IF;

  SELECT * INTO g FROM practice_groups WHERE id = p_group FOR UPDATE;
  IF g IS NULL THEN
    RAISE EXCEPTION 'group not found';
  END IF;
  IF g.orientation <> caller_orientation OR g.orientation_year <> caller_year THEN
    RAISE EXCEPTION 'group is not in your orientation';
  END IF;
  IF g.status <> 'open' THEN
    RAISE EXCEPTION 'group is closed';
  END IF;

  SELECT count(*) INTO taken FROM practice_group_members WHERE group_id = p_group;
  IF taken >= g.capacity THEN
    RAISE EXCEPTION 'group is full';
  END IF;

  BEGIN
    INSERT INTO practice_group_members (group_id, member_id, orientation, orientation_year)
    VALUES (p_group, auth.uid(), g.orientation, g.orientation_year)
    RETURNING * INTO row_out;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'you have already joined a practice group for this orientation';
  END;

  RETURN row_out;
END $$;
