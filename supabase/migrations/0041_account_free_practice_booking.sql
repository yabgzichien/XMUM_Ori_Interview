-- 0041_account_free_practice_booking.sql
-- Replace auth-profile practice membership with a public, roster-verified
-- December 2026 booking flow. Existing practice-only data is intentionally
-- reset; interview/auth/profile data is untouched.

-- ---------- Retire old practice RPCs before changing table shapes ----------
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'available_practice_groups', 'join_practice_group', 'leave_practice_group',
        'my_practice_group', 'my_practice_group_sessions', 'my_practice_group_members',
        'lead_create_session', 'lead_update_session', 'lead_delete_session',
        'lead_eligible_members', 'lead_add_member', 'lead_remove_member',
        'lead_update_practice_group', 'head_practice_groups', 'head_committee_roster',
        'head_create_practice_group', 'head_update_practice_group',
        'head_delete_practice_group', 'head_reassign_practice_lead',
        'head_set_committee_position'
      ])
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE', fn.proname, fn.args);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS audit_practice_group_members ON practice_group_members;
DROP TRIGGER IF EXISTS audit_practice_groups ON practice_groups;
DROP TRIGGER IF EXISTS audit_practice_sessions ON practice_sessions;

TRUNCATE TABLE practice_group_members, practice_sessions, practice_groups CASCADE;

-- ---------- Transform the empty legacy practice tables ----------
DROP POLICY IF EXISTS "practice_groups_select_head_or_admin" ON practice_groups;
DROP POLICY IF EXISTS "practice_groups_select_admin" ON practice_groups;
DROP POLICY IF EXISTS "practice_groups_admin_all" ON practice_groups;
DROP POLICY IF EXISTS "practice_group_members_select_head_or_admin" ON practice_group_members;
DROP POLICY IF EXISTS "practice_sessions_select_head_or_admin" ON practice_sessions;

DROP INDEX IF EXISTS practice_groups_track_orientation_idx;
DROP INDEX IF EXISTS practice_groups_orientation_year_idx;
DROP INDEX IF EXISTS practice_group_members_group_id_idx;
DROP INDEX IF EXISTS practice_group_members_member_id_idx;
DROP INDEX IF EXISTS one_active_group_per_member_orientation_year;

ALTER TABLE practice_groups DROP CONSTRAINT IF EXISTS practice_groups_lead_id_key;
ALTER TABLE practice_groups DROP CONSTRAINT IF EXISTS practice_groups_lead_id_fkey;
ALTER TABLE practice_groups DROP COLUMN IF EXISTS lead_id;
ALTER TABLE practice_groups DROP COLUMN IF EXISTS track;
ALTER TABLE practice_groups ALTER COLUMN orientation SET DEFAULT 'december';
ALTER TABLE practice_groups ADD CONSTRAINT practice_groups_december_only CHECK (orientation = 'december');
ALTER TABLE practice_groups ADD CONSTRAINT practice_groups_2026_only CHECK (orientation_year = 2026);
ALTER TABLE practice_groups ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE practice_groups ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX practice_groups_name_scope_ci
  ON practice_groups (lower(name), orientation, orientation_year);
CREATE INDEX practice_groups_scope_idx ON practice_groups (orientation, orientation_year, name);

ALTER TABLE practice_group_members RENAME TO practice_group_bookings;
ALTER TABLE practice_group_bookings DROP CONSTRAINT IF EXISTS practice_group_members_group_id_fkey;
ALTER TABLE practice_group_bookings DROP CONSTRAINT IF EXISTS practice_group_members_member_id_fkey;
ALTER TABLE practice_group_bookings DROP CONSTRAINT IF EXISTS practice_group_members_group_id_member_id_key;
ALTER TABLE practice_group_bookings DROP COLUMN IF EXISTS member_id;
ALTER TABLE practice_group_bookings DROP COLUMN IF EXISTS track;
ALTER TABLE practice_group_bookings DROP COLUMN IF EXISTS orientation;
ALTER TABLE practice_group_bookings DROP COLUMN IF EXISTS orientation_year;
ALTER TABLE practice_group_bookings DROP COLUMN IF EXISTS joined_at;
ALTER TABLE practice_group_bookings
  ADD CONSTRAINT practice_group_bookings_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES practice_groups(id);

-- ---------- Committee roster and new booking columns ----------
CREATE TABLE committee_roster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  student_id text NOT NULL CHECK (
    student_id = btrim(student_id)
    AND student_id <> ''
    AND student_id ~ '^[A-Za-z0-9_-]+$'
  ),
  position text NOT NULL REFERENCES committee_positions(value),
  orientation orientation NOT NULL DEFAULT 'december' CHECK (orientation = 'december'),
  orientation_year int NOT NULL DEFAULT 2026 CHECK (orientation_year = 2026),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX committee_roster_student_id_ci ON committee_roster (lower(student_id));
CREATE INDEX committee_roster_active_name_idx ON committee_roster (active, name);

ALTER TABLE practice_group_bookings
  ADD COLUMN roster_member_id uuid NOT NULL REFERENCES committee_roster(id),
  ADD COLUMN source text NOT NULL CHECK (source IN ('self_service', 'admin')),
  ADD COLUMN assigned_by uuid REFERENCES profiles(id),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE practice_group_bookings
  ADD CONSTRAINT practice_group_bookings_roster_member_key UNIQUE (roster_member_id);
CREATE INDEX practice_group_bookings_group_idx ON practice_group_bookings (group_id);

ALTER TABLE practice_sessions ALTER COLUMN created_by SET NOT NULL;

CREATE TABLE practice_verification_failures (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  address_fingerprint text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX practice_verification_failures_window_idx
  ON practice_verification_failures (address_fingerprint, attempted_at DESC);

-- ---------- Shared helpers ----------
CREATE OR REPLACE FUNCTION set_practice_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;

CREATE TRIGGER committee_roster_updated_at
  BEFORE UPDATE ON committee_roster
  FOR EACH ROW EXECUTE FUNCTION set_practice_updated_at();
CREATE TRIGGER practice_groups_updated_at
  BEFORE UPDATE ON practice_groups
  FOR EACH ROW EXECUTE FUNCTION set_practice_updated_at();
CREATE TRIGGER practice_group_bookings_updated_at
  BEFORE UPDATE ON practice_group_bookings
  FOR EACH ROW EXECUTE FUNCTION set_practice_updated_at();

CREATE OR REPLACE FUNCTION normalize_practice_student_id(p_value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  normalized text := upper(btrim(coalesce(p_value, '')));
BEGIN
  IF normalized = '' OR normalized !~ '^[A-Z0-9_-]+$' THEN
    RETURN NULL;
  END IF;
  RETURN normalized;
END $$;

CREATE OR REPLACE FUNCTION verified_practice_member(p_student_id text, p_email text)
RETURNS committee_roster
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  normalized_id text := normalize_practice_student_id(p_student_id);
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  member committee_roster;
BEGIN
  IF normalized_id IS NULL
     OR normalized_email <> lower(normalized_id) || '@xmu.edu.my' THEN
    RAISE EXCEPTION 'identity_not_verified';
  END IF;

  SELECT * INTO member
  FROM committee_roster
  WHERE lower(student_id) = lower(normalized_id) AND active;

  IF member IS NULL THEN
    RAISE EXCEPTION 'identity_not_verified';
  END IF;
  RETURN member;
END $$;

-- ---------- Public server-only lookup and booking ----------
CREATE OR REPLACE FUNCTION public_practice_lookup(p_student_id text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  member committee_roster;
  existing practice_group_bookings;
  group_row practice_groups;
BEGIN
  member := verified_practice_member(p_student_id, p_email);

  SELECT * INTO existing
  FROM practice_group_bookings
  WHERE roster_member_id = member.id;

  IF existing IS NOT NULL THEN
    SELECT * INTO group_row FROM practice_groups WHERE id = existing.group_id;
    RETURN jsonb_build_object(
      'state', 'booked',
      'booking', jsonb_build_object(
        'id', existing.id,
        'group_id', group_row.id,
        'group_name', group_row.name,
        'sessions', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', s.id,
            'starts_at', s.starts_at,
            'ends_at', s.ends_at,
            'location', s.location
          ) ORDER BY s.starts_at)
          FROM practice_sessions s
          WHERE s.group_id = group_row.id
        ), '[]'::jsonb)
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'state', 'available',
    'groups', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'seats_left', greatest(g.capacity - (
          SELECT count(*) FROM practice_group_bookings b WHERE b.group_id = g.id
        ), 0)
      ) ORDER BY g.name)
      FROM practice_groups g
      WHERE g.orientation = 'december'
        AND g.orientation_year = 2026
        AND g.status = 'open'
    ), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public_book_practice_group(
  p_student_id text,
  p_email text,
  p_group uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  member committee_roster;
  group_row practice_groups;
  booking practice_group_bookings;
  taken int;
BEGIN
  member := verified_practice_member(p_student_id, p_email);

  IF EXISTS (SELECT 1 FROM practice_group_bookings WHERE roster_member_id = member.id) THEN
    RAISE EXCEPTION 'already_booked';
  END IF;

  SELECT * INTO group_row FROM practice_groups WHERE id = p_group FOR UPDATE;
  IF group_row IS NULL OR group_row.status <> 'open'
     OR group_row.orientation <> 'december' OR group_row.orientation_year <> 2026 THEN
    RAISE EXCEPTION 'group_unavailable';
  END IF;

  SELECT count(*) INTO taken FROM practice_group_bookings WHERE group_id = p_group;
  IF taken >= group_row.capacity THEN
    RAISE EXCEPTION 'group_full';
  END IF;

  BEGIN
    INSERT INTO practice_group_bookings (group_id, roster_member_id, source)
    VALUES (p_group, member.id, 'self_service')
    RETURNING * INTO booking;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_booked';
  END;

  RETURN jsonb_build_object(
    'id', booking.id,
    'group_id', group_row.id,
    'group_name', group_row.name,
    'sessions', '[]'::jsonb
  );
END $$;

-- ---------- Admin transactional operations ----------
CREATE OR REPLACE FUNCTION admin_assign_practice_member(p_roster_member uuid, p_group uuid)
RETURNS practice_group_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  member committee_roster;
  group_row practice_groups;
  booking practice_group_bookings;
  taken int;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO member FROM committee_roster WHERE id = p_roster_member;
  IF member IS NULL OR NOT member.active THEN RAISE EXCEPTION 'member_not_active'; END IF;
  IF EXISTS (SELECT 1 FROM practice_group_bookings WHERE roster_member_id = member.id) THEN
    RAISE EXCEPTION 'already_booked';
  END IF;
  SELECT * INTO group_row FROM practice_groups WHERE id = p_group FOR UPDATE;
  IF group_row IS NULL THEN RAISE EXCEPTION 'group_unavailable'; END IF;
  SELECT count(*) INTO taken FROM practice_group_bookings WHERE group_id = p_group;
  IF taken >= group_row.capacity THEN RAISE EXCEPTION 'group_full'; END IF;
  INSERT INTO practice_group_bookings (group_id, roster_member_id, source, assigned_by)
  VALUES (p_group, member.id, 'admin', auth.uid()) RETURNING * INTO booking;
  RETURN booking;
END $$;

CREATE OR REPLACE FUNCTION admin_move_practice_member(p_booking uuid, p_group uuid)
RETURNS practice_group_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  booking practice_group_bookings;
  group_row practice_groups;
  taken int;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO booking FROM practice_group_bookings WHERE id = p_booking FOR UPDATE;
  IF booking IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF booking.group_id = p_group THEN RETURN booking; END IF;
  SELECT * INTO group_row FROM practice_groups WHERE id = p_group FOR UPDATE;
  IF group_row IS NULL THEN RAISE EXCEPTION 'group_unavailable'; END IF;
  SELECT count(*) INTO taken FROM practice_group_bookings WHERE group_id = p_group;
  IF taken >= group_row.capacity THEN RAISE EXCEPTION 'group_full'; END IF;
  UPDATE practice_group_bookings
  SET group_id = p_group, source = 'admin', assigned_by = auth.uid()
  WHERE id = p_booking RETURNING * INTO booking;
  RETURN booking;
END $$;

CREATE OR REPLACE FUNCTION admin_remove_practice_booking(p_booking uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  DELETE FROM practice_group_bookings WHERE id = p_booking;
END $$;

CREATE OR REPLACE FUNCTION admin_update_practice_group(
  p_group uuid,
  p_name text,
  p_capacity int,
  p_status slot_status
) RETURNS practice_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  group_row practice_groups;
  booked_count int;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO group_row FROM practice_groups WHERE id = p_group FOR UPDATE;
  IF group_row IS NULL THEN RAISE EXCEPTION 'group_unavailable'; END IF;
  IF btrim(coalesce(p_name, '')) = '' OR p_capacity < 1 THEN RAISE EXCEPTION 'invalid_group'; END IF;
  SELECT count(*) INTO booked_count FROM practice_group_bookings WHERE group_id = p_group;
  IF p_capacity < booked_count THEN RAISE EXCEPTION 'capacity_below_booking_count'; END IF;
  UPDATE practice_groups
  SET name = btrim(p_name), capacity = p_capacity, status = p_status
  WHERE id = p_group RETURNING * INTO group_row;
  RETURN group_row;
END $$;

CREATE OR REPLACE FUNCTION admin_delete_practice_group(p_group uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF EXISTS (SELECT 1 FROM practice_group_bookings WHERE group_id = p_group) THEN
    RAISE EXCEPTION 'group_has_bookings';
  END IF;
  DELETE FROM practice_groups WHERE id = p_group;
END $$;

CREATE OR REPLACE FUNCTION admin_apply_practice_roster(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  total_count int;
  new_count int;
  updated_count int;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'invalid_roster'; END IF;
  total_count := jsonb_array_length(p_rows);
  IF total_count > 5000 THEN RAISE EXCEPTION 'roster_too_large'; END IF;

  CREATE TEMP TABLE roster_import_rows (
    name text NOT NULL,
    student_id text NOT NULL,
    position text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO roster_import_rows (name, student_id, position)
  SELECT btrim(value ->> 'name'), normalize_practice_student_id(value ->> 'student_id'), btrim(value ->> 'position')
  FROM jsonb_array_elements(p_rows) item(value);

  IF EXISTS (
    SELECT 1 FROM roster_import_rows
    WHERE name = '' OR student_id IS NULL OR position = ''
  ) THEN RAISE EXCEPTION 'invalid_roster'; END IF;
  IF EXISTS (
    SELECT 1 FROM roster_import_rows GROUP BY lower(student_id) HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'duplicate_student_id'; END IF;
  IF EXISTS (
    SELECT 1 FROM roster_import_rows r
    WHERE NOT EXISTS (SELECT 1 FROM committee_positions p WHERE p.value = r.position)
  ) THEN RAISE EXCEPTION 'invalid_position'; END IF;

  SELECT count(*) INTO new_count
  FROM roster_import_rows r
  WHERE NOT EXISTS (
    SELECT 1 FROM committee_roster c WHERE lower(c.student_id) = lower(r.student_id)
  );
  updated_count := total_count - new_count;

  INSERT INTO committee_roster (name, student_id, position, active)
  SELECT name, student_id, position, true FROM roster_import_rows
  ON CONFLICT (lower(student_id)) DO UPDATE
  SET name = excluded.name, position = excluded.position, active = true;

  RETURN jsonb_build_object('total', total_count, 'inserted', new_count, 'updated', updated_count);
END $$;

-- Existing account-position management remains for interview access, but no
-- longer derives roles from performance-practice leadership.
CREATE OR REPLACE FUNCTION head_set_committee_position(p_profile_id uuid, p_position text)
RETURNS profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target profiles;
  new_role user_role;
  row_out profiles;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
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
    new_role := 'committee';
  END IF;
  UPDATE profiles SET position = p_position, role = new_role WHERE id = p_profile_id
  RETURNING * INTO row_out;
  RETURN row_out;
END $$;

-- ---------- RLS and privileges ----------
ALTER TABLE committee_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_group_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_verification_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY committee_roster_admin_all ON committee_roster
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY practice_groups_admin_all ON practice_groups
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY practice_group_bookings_admin_all ON practice_group_bookings
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY practice_sessions_admin_all ON practice_sessions
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

REVOKE ALL ON committee_roster, practice_groups, practice_group_bookings,
  practice_sessions, practice_verification_failures FROM anon;
REVOKE ALL ON committee_roster, practice_groups, practice_group_bookings,
  practice_sessions, practice_verification_failures FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON committee_roster, practice_groups,
  practice_group_bookings, practice_sessions TO authenticated;

REVOKE ALL ON FUNCTION public_practice_lookup(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public_book_practice_group(text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION verified_practice_member(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public_practice_lookup(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public_book_practice_group(text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION verified_practice_member(text, text) TO service_role;
REVOKE ALL ON FUNCTION admin_assign_practice_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION admin_move_practice_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION admin_remove_practice_booking(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION admin_update_practice_group(uuid, text, int, slot_status) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION admin_delete_practice_group(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION admin_apply_practice_roster(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_assign_practice_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_move_practice_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_remove_practice_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_practice_group(uuid, text, int, slot_status) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_practice_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_apply_practice_roster(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION head_set_committee_position(uuid, text) TO authenticated;

-- ---------- Practice-specific audit trigger ----------
CREATE OR REPLACE FUNCTION audit_practice_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
  row_data jsonb;
  actor jsonb;
  changed text[] := '{}';
  summary text;
  member_name text;
BEGIN
  IF tg_op = 'INSERT' THEN new_row := to_jsonb(new);
  ELSIF tg_op = 'UPDATE' THEN
    old_row := to_jsonb(old); new_row := to_jsonb(new);
    SELECT coalesce(array_agg(e.key ORDER BY e.key), '{}'::text[]) INTO changed
    FROM jsonb_each(new_row) e WHERE e.value IS DISTINCT FROM (old_row -> e.key);
    IF changed = '{}'::text[] THEN RETURN NULL; END IF;
  ELSE old_row := to_jsonb(old);
  END IF;
  row_data := coalesce(new_row, old_row);

  IF tg_table_name = 'practice_group_bookings'
     AND row_data ->> 'source' = 'self_service'
     AND nullif(row_data ->> 'assigned_by', '') IS NULL THEN
    SELECT name INTO member_name FROM committee_roster
    WHERE id = (row_data ->> 'roster_member_id')::uuid;
    actor := jsonb_build_object(
      'type', 'public', 'name', coalesce(member_name, 'Verified committee member'),
      'auth_role', 'service_role'
    );
  ELSE
    actor := audit_actor(row_data);
  END IF;

  summary := CASE tg_table_name
    WHEN 'committee_roster' THEN initcap(lower(tg_op)) || ' committee roster member "' || coalesce(row_data ->> 'name', 'unknown') || '"'
    WHEN 'practice_groups' THEN initcap(lower(tg_op)) || ' practice group "' || coalesce(row_data ->> 'name', 'untitled') || '"'
    WHEN 'practice_group_bookings' THEN initcap(lower(tg_op)) || ' performance-practice group booking'
    WHEN 'practice_sessions' THEN initcap(lower(tg_op)) || ' performance-practice session'
    ELSE initcap(lower(tg_op)) || ' on ' || tg_table_name
  END;

  INSERT INTO audit_log (
    actor_type, actor_id, actor_name, actor_email, actor_role, actor_position, auth_role,
    action, table_name, record_id, summary, changed_fields, old_data, new_data
  ) VALUES (
    actor ->> 'type', nullif(actor ->> 'id', '')::uuid,
    coalesce(nullif(actor ->> 'name', ''), 'Unknown'), actor ->> 'email',
    actor ->> 'role', actor ->> 'position', actor ->> 'auth_role',
    lower(tg_op), tg_table_name, row_data ->> 'id', summary, changed,
    audit_redact(tg_table_name, old_row), audit_redact(tg_table_name, new_row)
  );
  RETURN NULL;
END $$;

CREATE TRIGGER audit_committee_roster
  AFTER INSERT OR UPDATE OR DELETE ON committee_roster
  FOR EACH ROW EXECUTE FUNCTION audit_practice_row_change();
CREATE TRIGGER audit_practice_groups
  AFTER INSERT OR UPDATE OR DELETE ON practice_groups
  FOR EACH ROW EXECUTE FUNCTION audit_practice_row_change();
CREATE TRIGGER audit_practice_group_bookings
  AFTER INSERT OR UPDATE OR DELETE ON practice_group_bookings
  FOR EACH ROW EXECUTE FUNCTION audit_practice_row_change();
CREATE TRIGGER audit_practice_sessions
  AFTER INSERT OR UPDATE OR DELETE ON practice_sessions
  FOR EACH ROW EXECUTE FUNCTION audit_practice_row_change();
