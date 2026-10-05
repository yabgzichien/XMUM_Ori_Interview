-- 0048_harden_split_practice_capacity.sql
-- Serialize roster classification with bookings and preserve legacy group writers.

ALTER TABLE practice_groups
  ALTER COLUMN committee_capacity DROP DEFAULT,
  ALTER COLUMN faci_gm_capacity DROP DEFAULT;

CREATE OR REPLACE FUNCTION fill_legacy_practice_group_capacities()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.committee_capacity := coalesce(NEW.committee_capacity, NEW.capacity);
  NEW.faci_gm_capacity := coalesce(NEW.faci_gm_capacity, NEW.capacity);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS practice_groups_fill_legacy_capacities ON practice_groups;
CREATE TRIGGER practice_groups_fill_legacy_capacities
  BEFORE INSERT ON practice_groups
  FOR EACH ROW EXECUTE FUNCTION fill_legacy_practice_group_capacities();

CREATE OR REPLACE FUNCTION public_book_practice_group(
  p_student_id text,
  p_email text,
  p_group uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  normalized_id text := normalize_practice_student_id(p_student_id);
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  member committee_roster;
  group_row practice_groups;
  booking practice_group_bookings;
  member_category text;
  taken int;
  category_capacity int;
  opens_at timestamptz;
BEGIN
  SELECT booking_opens_at INTO opens_at FROM practice_settings
  WHERE orientation = 'december' AND orientation_year = 2026;
  IF opens_at IS NULL OR statement_timestamp() < opens_at THEN
    RAISE EXCEPTION 'booking_not_open';
  END IF;

  IF normalized_id IS NULL
     OR normalized_email <> lower(normalized_id) || '@xmu.edu.my' THEN
    RAISE EXCEPTION 'identity_not_verified';
  END IF;

  SELECT * INTO member
  FROM committee_roster
  WHERE lower(student_id) = lower(normalized_id) AND active
  FOR UPDATE;
  IF member IS NULL THEN RAISE EXCEPTION 'identity_not_verified'; END IF;

  member_category := practice_capacity_category(member.position);
  IF EXISTS (SELECT 1 FROM practice_group_bookings WHERE roster_member_id = member.id) THEN
    RAISE EXCEPTION 'already_booked';
  END IF;

  SELECT * INTO group_row FROM practice_groups WHERE id = p_group FOR UPDATE;
  IF group_row IS NULL OR group_row.status <> 'open'
     OR group_row.orientation <> 'december' OR group_row.orientation_year <> 2026 THEN
    RAISE EXCEPTION 'group_unavailable';
  END IF;

  category_capacity := CASE member_category
    WHEN 'faci_gm' THEN group_row.faci_gm_capacity
    ELSE group_row.committee_capacity
  END;
  SELECT count(*) INTO taken
  FROM practice_group_bookings b
  JOIN committee_roster r ON r.id = b.roster_member_id
  WHERE b.group_id = p_group AND practice_capacity_category(r.position) = member_category;
  IF taken >= category_capacity THEN RAISE EXCEPTION 'group_full'; END IF;

  BEGIN
    INSERT INTO practice_group_bookings (group_id, roster_member_id, source)
    VALUES (p_group, member.id, 'self_service') RETURNING * INTO booking;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_booked';
  END;

  RETURN jsonb_build_object(
    'id', booking.id,
    'group_id', group_row.id,
    'group_name', group_row.name,
    'sessions', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'location', s.location
      ) ORDER BY s.starts_at)
      FROM practice_sessions s WHERE s.group_id = group_row.id
    ), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION admin_assign_practice_member(p_roster_member uuid, p_group uuid)
RETURNS practice_group_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  member committee_roster;
  group_row practice_groups;
  booking practice_group_bookings;
  member_category text;
  taken int;
  category_capacity int;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO member
  FROM committee_roster
  WHERE id = p_roster_member
  FOR UPDATE;
  IF member IS NULL OR NOT member.active THEN RAISE EXCEPTION 'member_not_active'; END IF;
  IF EXISTS (SELECT 1 FROM practice_group_bookings WHERE roster_member_id = member.id) THEN
    RAISE EXCEPTION 'already_booked';
  END IF;
  SELECT * INTO group_row FROM practice_groups WHERE id = p_group FOR UPDATE;
  IF group_row IS NULL THEN RAISE EXCEPTION 'group_unavailable'; END IF;
  member_category := practice_capacity_category(member.position);
  category_capacity := CASE member_category
    WHEN 'faci_gm' THEN group_row.faci_gm_capacity
    ELSE group_row.committee_capacity
  END;
  SELECT count(*) INTO taken
  FROM practice_group_bookings b
  JOIN committee_roster r ON r.id = b.roster_member_id
  WHERE b.group_id = p_group AND practice_capacity_category(r.position) = member_category;
  IF taken >= category_capacity THEN RAISE EXCEPTION 'group_full'; END IF;
  INSERT INTO practice_group_bookings (group_id, roster_member_id, source, assigned_by)
  VALUES (p_group, member.id, 'admin', auth.uid()) RETURNING * INTO booking;
  RETURN booking;
END $$;

CREATE OR REPLACE FUNCTION admin_move_practice_member(p_booking uuid, p_group uuid)
RETURNS practice_group_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  booking practice_group_bookings;
  member committee_roster;
  group_row practice_groups;
  member_category text;
  taken int;
  category_capacity int;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO booking FROM practice_group_bookings WHERE id = p_booking FOR UPDATE;
  IF booking IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF booking.group_id = p_group THEN RETURN booking; END IF;
  SELECT * INTO member
  FROM committee_roster
  WHERE id = booking.roster_member_id
  FOR UPDATE;
  SELECT * INTO group_row FROM practice_groups WHERE id = p_group FOR UPDATE;
  IF group_row IS NULL THEN RAISE EXCEPTION 'group_unavailable'; END IF;
  member_category := practice_capacity_category(member.position);
  category_capacity := CASE member_category
    WHEN 'faci_gm' THEN group_row.faci_gm_capacity
    ELSE group_row.committee_capacity
  END;
  SELECT count(*) INTO taken
  FROM practice_group_bookings b
  JOIN committee_roster r ON r.id = b.roster_member_id
  WHERE b.group_id = p_group AND practice_capacity_category(r.position) = member_category;
  IF taken >= category_capacity THEN RAISE EXCEPTION 'group_full'; END IF;
  UPDATE practice_group_bookings
  SET group_id = p_group, source = 'admin', assigned_by = auth.uid()
  WHERE id = p_booking RETURNING * INTO booking;
  RETURN booking;
END $$;

-- Keep the pre-split signature available during rolling deployments. Its
-- single capacity becomes the limit for each category, matching the backfill
-- applied to groups that existed before split quotas were introduced.
CREATE OR REPLACE FUNCTION admin_update_practice_group(
  p_group uuid,
  p_name text,
  p_capacity int,
  p_status slot_status
) RETURNS practice_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN admin_update_practice_group(
    p_group,
    p_name,
    p_capacity,
    p_capacity,
    p_status
  );
END $$;

REVOKE ALL ON FUNCTION admin_update_practice_group(uuid, text, int, slot_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_update_practice_group(uuid, text, int, slot_status) TO authenticated;

NOTIFY pgrst, 'reload schema';
