-- 0020_orientation_year_and_committee_isolation.sql
-- Add orientation_year support to all orientation tables and isolate committee access.

-- ---------- Add orientation_year column to tables ----------
DO $$ BEGIN
  ALTER TABLE profiles ADD COLUMN orientation_year int NOT NULL DEFAULT 2026;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE staff_invites ADD COLUMN orientation_year int NOT NULL DEFAULT 2026;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE slots ADD COLUMN orientation_year int NOT NULL DEFAULT 2026;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE bookings ADD COLUMN orientation_year int NOT NULL DEFAULT 2026;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE track_settings ADD COLUMN orientation_year int NOT NULL DEFAULT 2026;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE practice_groups ADD COLUMN orientation_year int NOT NULL DEFAULT 2026;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE practice_group_members ADD COLUMN orientation_year int NOT NULL DEFAULT 2026;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- ---------- Constraints & Indexes ----------
DO $$ BEGIN
  ALTER TABLE track_settings DROP CONSTRAINT track_settings_pkey;
EXCEPTION WHEN undefined_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE track_settings ADD PRIMARY KEY (track, orientation, orientation_year);
EXCEPTION WHEN duplicate_table THEN null; END $$;

-- Insert default track_settings rows for 2026 if missing
INSERT INTO track_settings (track, orientation, orientation_year) VALUES
  ('facilitator', 'february', 2026),
  ('facilitator', 'april', 2026),
  ('facilitator', 'december', 2026),
  ('game_master', 'february', 2026),
  ('game_master', 'april', 2026),
  ('game_master', 'december', 2026)
ON CONFLICT DO NOTHING;

DROP INDEX IF EXISTS one_active_booking_per_email_track_orientation;
DO $$ BEGIN
  CREATE UNIQUE INDEX one_active_booking_per_email_track_orientation_year
    ON bookings (lower(applicant_email), track, orientation, orientation_year) WHERE status = 'booked';
EXCEPTION WHEN duplicate_table THEN null; END $$;

DROP INDEX IF EXISTS one_active_group_per_member_orientation;
DO $$ BEGIN
  CREATE UNIQUE INDEX one_active_group_per_member_orientation_year
    ON practice_group_members (member_id, orientation, orientation_year);
EXCEPTION WHEN duplicate_table THEN null; END $$;

DROP INDEX IF EXISTS slots_track_orientation_starts_at_idx;
CREATE INDEX IF NOT EXISTS slots_track_orientation_year_starts_at_idx ON slots (track, orientation, orientation_year, starts_at);

DROP INDEX IF EXISTS practice_groups_orientation_idx;
CREATE INDEX IF NOT EXISTS practice_groups_orientation_year_idx ON practice_groups (orientation, orientation_year);

-- ---------- Helper: auth_committee_scope ----------
DROP FUNCTION IF EXISTS auth_committee_scope();
CREATE OR REPLACE FUNCTION auth_committee_scope()
RETURNS TABLE (orientation orientation, orientation_year int)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT orientation, orientation_year FROM profiles WHERE id = auth.uid()
$$;

-- ---------- RPC Updates ----------
DROP FUNCTION IF EXISTS available_slots(track, orientation);
DROP FUNCTION IF EXISTS available_slots(track, orientation, int);
CREATE OR REPLACE FUNCTION available_slots(p_track track, p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  capacity int, booked_count bigint, seats_left bigint
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT s.id, s.track, s.orientation, s.orientation_year, s.starts_at, s.ends_at, s.capacity,
         count(b.*) FILTER (WHERE b.status = 'booked') AS booked_count,
         s.capacity - count(b.*) FILTER (WHERE b.status = 'booked') AS seats_left
  FROM slots s
  LEFT JOIN bookings b ON b.slot_id = s.id
  WHERE s.track = p_track AND s.orientation = p_orientation AND s.orientation_year = p_year
    AND s.status = 'open' AND s.starts_at > now()
  GROUP BY s.id
  ORDER BY s.starts_at
$$;

DROP FUNCTION IF EXISTS head_slots(track, orientation);
DROP FUNCTION IF EXISTS head_slots(track, orientation, int);
CREATE OR REPLACE FUNCTION head_slots(p_track track, p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  capacity int, status slot_status, booked_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT (auth_managed_track() = p_track OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized for this track';
  END IF;
  RETURN QUERY
    SELECT s.id, s.track, s.orientation, s.orientation_year, s.starts_at, s.ends_at, s.capacity, s.status,
           count(b.*) FILTER (WHERE b.status = 'booked') AS booked_count
    FROM slots s
    LEFT JOIN bookings b ON b.slot_id = s.id
    WHERE s.track = p_track AND s.orientation = p_orientation AND s.orientation_year = p_year
    GROUP BY s.id
    ORDER BY s.starts_at;
END $$;

DROP FUNCTION IF EXISTS head_bookings(track, orientation);
DROP FUNCTION IF EXISTS head_bookings(track, orientation, int);
CREATE OR REPLACE FUNCTION head_bookings(p_track track, p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  booking_id uuid, slot_id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  applicant_name text, applicant_email text, student_id text, experiences text,
  interview_notes text, created_at timestamptz, interview_status text
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT (auth_managed_track() = p_track OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized for this track';
  END IF;
  RETURN QUERY
    SELECT b.id, b.slot_id, b.track, b.orientation, b.orientation_year, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id, b.experiences,
           b.interview_notes, b.created_at, b.interview_status::text
    FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    WHERE b.track = p_track AND b.orientation = p_orientation AND b.orientation_year = p_year AND b.status = 'booked'
    ORDER BY s.starts_at, b.applicant_name;
END $$;

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
BEGIN
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  IF coalesce(trim(p_email), '') = '' THEN
    RAISE EXCEPTION 'email is required';
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
    RAISE EXCEPTION 'this email already has an active booking in this track for this orientation';
  END;

  RETURN b;
END $$;

CREATE OR REPLACE FUNCTION available_practice_groups()
RETURNS TABLE (
  id uuid, name text, lead_id uuid, lead_name text, capacity int,
  member_count bigint, seats_left bigint, status slot_status, session_count bigint
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
           count(distinct s.id) AS session_count
    FROM practice_groups g
    JOIN profiles p ON p.id = g.lead_id
    LEFT JOIN practice_group_members m ON m.group_id = g.id
    LEFT JOIN practice_sessions s ON s.group_id = g.id
    WHERE g.orientation = caller_orientation AND g.orientation_year = caller_year
    GROUP BY g.id, p.name
    ORDER BY g.name;
END $$;

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
  IF coalesce(auth_role() <> 'committee', true) THEN
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

DROP FUNCTION IF EXISTS head_practice_groups(orientation);
DROP FUNCTION IF EXISTS head_practice_groups(orientation, int);
CREATE OR REPLACE FUNCTION head_practice_groups(p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  id uuid, name text, lead_id uuid, lead_name text, lead_email text, capacity int,
  member_count bigint, status slot_status, session_count bigint, created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT is_head_or_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
    SELECT g.id, g.name, g.lead_id, p.name, p.email, g.capacity,
           count(distinct m.id), g.status, count(distinct s.id), g.created_at
    FROM practice_groups g
    JOIN profiles p ON p.id = g.lead_id
    LEFT JOIN practice_group_members m ON m.group_id = g.id
    LEFT JOIN practice_sessions s ON s.group_id = g.id
    WHERE g.orientation = p_orientation AND g.orientation_year = p_year
    GROUP BY g.id, p.name, p.email
    ORDER BY g.created_at;
END $$;

DROP FUNCTION IF EXISTS head_committee_roster(orientation);
DROP FUNCTION IF EXISTS head_committee_roster(orientation, int);
CREATE OR REPLACE FUNCTION head_committee_roster(p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (id uuid, name text, email text, track track, role user_role, leading_group_id uuid)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT is_head_or_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
    SELECT pr.id, pr.name, pr.email, pr.track, pr.role, g.id
    FROM profiles pr
    LEFT JOIN practice_groups g ON g.lead_id = pr.id
    WHERE pr.orientation = p_orientation AND pr.orientation_year = p_year
      AND pr.role IN ('committee', 'performance_lead')
    ORDER BY pr.name;
END $$;

DROP FUNCTION IF EXISTS head_create_practice_group(text, orientation, int, uuid);
DROP FUNCTION IF EXISTS head_create_practice_group(text, orientation, int, uuid, int);
CREATE OR REPLACE FUNCTION head_create_practice_group(
  p_name text, p_orientation orientation, p_capacity int, p_lead_profile_id uuid, p_year int DEFAULT 2026
) RETURNS practice_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lead_profile profiles;
  row_out practice_groups;
BEGIN
  IF NOT is_head_or_admin() THEN
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

-- ---------- Grants ----------
GRANT EXECUTE ON FUNCTION available_slots(track, orientation, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION head_slots(track, orientation, int) TO authenticated;
GRANT EXECUTE ON FUNCTION head_bookings(track, orientation, int) TO authenticated;
GRANT EXECUTE ON FUNCTION head_practice_groups(orientation, int) TO authenticated;
GRANT EXECUTE ON FUNCTION head_committee_roster(orientation, int) TO authenticated;
GRANT EXECUTE ON FUNCTION head_create_practice_group(text, orientation, int, uuid, int) TO authenticated;
