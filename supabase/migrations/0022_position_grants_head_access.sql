-- 0022_position_grants_head_access.sql
-- Makes the "Head of Facilitator (HOF)" / "Head of Game Master (HOG)"
-- committee positions functionally grant the matching head_facilitator /
-- head_gm account role (real /head dashboard access to manage booking slots
-- and interview notes for that track) — not just a cosmetic label. Assigning
-- HOF/HOG to a committee member via head_set_committee_position now promotes
-- their role; moving them off HOF/HOG later reverts it. Every other position
-- (Treasurer, Secretary, etc.) stays purely cosmetic as before.
--
-- Only ever acts on profiles with orientation set (i.e. committee-tier
-- accounts that went through the committee roster), so the two originally
-- seeded head_facilitator/head_gm accounts (orientation is null — they were
-- never part of a committee roster) can never be touched by this function.

-- ---------- prevent_self_role_change: allow head<->committee transitions ----------
-- The existing trigger let a head flip someone between 'committee' and
-- 'performance_lead' without an admin. head_set_committee_position below now
-- also needs to flip into/out of 'head_facilitator'/'head_gm' when a head
-- (not just an admin) assigns/clears the HOF/HOG position.
create or replace function prevent_self_role_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.role <> old.role and auth.uid() is not null and not is_admin() then
    if auth_role() in ('head_facilitator', 'head_gm')
       and old.role in ('committee', 'performance_lead', 'head_facilitator', 'head_gm')
       and new.role in ('committee', 'performance_lead', 'head_facilitator', 'head_gm') then
      return new;
    end if;
    raise exception 'only an admin may change a role';
  end if;
  return new;
end $$;

-- ---------- head_committee_roster: keep HOF/HOG-promoted members visible ----------
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
      AND pr.role IN ('committee', 'performance_lead', 'head_facilitator', 'head_gm')
    ORDER BY pr.name;
END $$;

-- ---------- head_set_committee_position: sync role for HOF/HOG ----------
CREATE OR REPLACE FUNCTION head_set_committee_position(p_profile_id uuid, p_position text)
RETURNS profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target profiles;
  new_role user_role;
  is_leading boolean;
  row_out profiles;
BEGIN
  IF NOT is_head_or_admin() THEN
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
    -- Moving off a HOF/HOG position they were previously auto-promoted into:
    -- fall back to performance_lead if they still lead a group, else committee.
    SELECT EXISTS (SELECT 1 FROM practice_groups WHERE lead_id = p_profile_id) INTO is_leading;
    new_role := CASE WHEN is_leading THEN 'performance_lead' ELSE 'committee' END;
  END IF;

  UPDATE profiles SET position = p_position, role = new_role WHERE id = p_profile_id
  RETURNING * INTO row_out;
  RETURN row_out;
END $$;

-- ---------- Grants ----------
GRANT EXECUTE ON FUNCTION head_committee_roster(orientation, int) TO authenticated;
GRANT EXECUTE ON FUNCTION head_set_committee_position(uuid, text) TO authenticated;
