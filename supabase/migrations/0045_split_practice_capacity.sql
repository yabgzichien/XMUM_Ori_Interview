-- 0045_split_practice_capacity.sql
-- Give each performance group independent Committee and Faci/GM quotas.
-- Only facilitator and game_master positions use the Faci/GM quota;
-- every other position, including HOF and HOG, uses Committee quota.

ALTER TABLE practice_groups
  ADD COLUMN committee_capacity int,
  ADD COLUMN faci_gm_capacity int;

UPDATE practice_groups
SET committee_capacity = capacity,
    faci_gm_capacity = capacity;

ALTER TABLE practice_groups
  ALTER COLUMN committee_capacity SET NOT NULL,
  ALTER COLUMN faci_gm_capacity SET NOT NULL,
  ADD CONSTRAINT practice_groups_committee_capacity_nonnegative CHECK (committee_capacity >= 0),
  ADD CONSTRAINT practice_groups_faci_gm_capacity_nonnegative CHECK (faci_gm_capacity >= 0),
  ADD CONSTRAINT practice_groups_split_capacity_nonempty CHECK (committee_capacity + faci_gm_capacity >= 1);

CREATE OR REPLACE FUNCTION practice_capacity_category(p_position text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_position IN ('facilitator', 'game_master') THEN 'faci_gm'
    ELSE 'committee'
  END
$$;

CREATE OR REPLACE FUNCTION public_practice_catalog()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  opens_at timestamptz;
  server_time timestamptz := statement_timestamp();
BEGIN
  SELECT booking_opens_at INTO opens_at
  FROM practice_settings
  WHERE orientation = 'december' AND orientation_year = 2026;

  RETURN jsonb_build_object(
    'server_now', server_time,
    'booking_opens_at', opens_at,
    'booking_open', opens_at IS NOT NULL AND server_time >= opens_at,
    'groups', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'status', g.status,
        'seats_left', greatest(g.committee_capacity - counts.committee_count, 0)
          + greatest(g.faci_gm_capacity - counts.faci_gm_count, 0),
        'committee_seats_left', greatest(g.committee_capacity - counts.committee_count, 0),
        'faci_gm_seats_left', greatest(g.faci_gm_capacity - counts.faci_gm_count, 0),
        'performance_type', g.performance_type,
        'description', g.description,
        'leader', CASE WHEN leader.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', leader.id,
          'name', leader.name,
          'position', coalesce(position.label, leader.position)
        ) END,
        'performance_video_url', g.performance_video_url,
        'song', CASE
          WHEN g.song_source_type = 'mp3' AND g.song_storage_path IS NOT NULL
            THEN jsonb_build_object('type', 'mp3', 'storage_path', g.song_storage_path)
          WHEN g.song_source_type IN ('youtube', 'external') AND g.song_url IS NOT NULL
            THEN jsonb_build_object('type', g.song_source_type, 'url', g.song_url)
          ELSE NULL
        END
      ) ORDER BY g.name)
      FROM practice_groups g
      LEFT JOIN committee_roster leader ON leader.id = g.leader_roster_member_id
      LEFT JOIN committee_positions position ON position.value = leader.position
      LEFT JOIN LATERAL (
        SELECT
          count(*) FILTER (WHERE practice_capacity_category(r.position) = 'committee')::int AS committee_count,
          count(*) FILTER (WHERE practice_capacity_category(r.position) = 'faci_gm')::int AS faci_gm_count
        FROM practice_group_bookings b
        JOIN committee_roster r ON r.id = b.roster_member_id
        WHERE b.group_id = g.id
      ) counts ON true
      WHERE g.orientation = 'december' AND g.orientation_year = 2026
    ), '[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public_practice_lookup(p_student_id text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  member committee_roster;
  existing practice_group_bookings;
  group_row practice_groups;
  opens_at timestamptz;
  member_category text;
BEGIN
  member := verified_practice_member(p_student_id, p_email);
  member_category := practice_capacity_category(member.position);
  SELECT * INTO existing FROM practice_group_bookings WHERE roster_member_id = member.id;

  IF existing.id IS NOT NULL THEN
    SELECT * INTO group_row FROM practice_groups WHERE id = existing.group_id;
    RETURN jsonb_build_object(
      'state', 'booked',
      'booking', jsonb_build_object(
        'id', existing.id,
        'group_id', group_row.id,
        'group_name', group_row.name,
        'sessions', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'location', s.location
          ) ORDER BY s.starts_at)
          FROM practice_sessions s WHERE s.group_id = group_row.id
        ), '[]'::jsonb)
      )
    );
  END IF;

  SELECT booking_opens_at INTO opens_at FROM practice_settings
  WHERE orientation = 'december' AND orientation_year = 2026;
  IF opens_at IS NULL OR statement_timestamp() < opens_at THEN
    RAISE EXCEPTION 'booking_not_open';
  END IF;

  RETURN jsonb_build_object(
    'state', 'available',
    'groups', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'status', g.status,
        'seats_left', CASE member_category
          WHEN 'faci_gm' THEN greatest(g.faci_gm_capacity - counts.faci_gm_count, 0)
          ELSE greatest(g.committee_capacity - counts.committee_count, 0)
        END,
        'committee_seats_left', greatest(g.committee_capacity - counts.committee_count, 0),
        'faci_gm_seats_left', greatest(g.faci_gm_capacity - counts.faci_gm_count, 0),
        'performance_type', g.performance_type,
        'description', g.description,
        'leader', CASE WHEN leader.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', leader.id,
          'name', leader.name,
          'position', coalesce(position.label, leader.position)
        ) END,
        'performance_video_url', g.performance_video_url,
        'song', CASE
          WHEN g.song_source_type = 'mp3' AND g.song_storage_path IS NOT NULL
            THEN jsonb_build_object('type', 'mp3', 'storage_path', g.song_storage_path)
          WHEN g.song_source_type IN ('youtube', 'external') AND g.song_url IS NOT NULL
            THEN jsonb_build_object('type', g.song_source_type, 'url', g.song_url)
          ELSE NULL
        END
      ) ORDER BY g.name)
      FROM practice_groups g
      LEFT JOIN committee_roster leader ON leader.id = g.leader_roster_member_id
      LEFT JOIN committee_positions position ON position.value = leader.position
      LEFT JOIN LATERAL (
        SELECT
          count(*) FILTER (WHERE practice_capacity_category(r.position) = 'committee')::int AS committee_count,
          count(*) FILTER (WHERE practice_capacity_category(r.position) = 'faci_gm')::int AS faci_gm_count
        FROM practice_group_bookings b
        JOIN committee_roster r ON r.id = b.roster_member_id
        WHERE b.group_id = g.id
      ) counts ON true
      WHERE g.orientation = 'december' AND g.orientation_year = 2026 AND g.status = 'open'
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

  member := verified_practice_member(p_student_id, p_email);
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
  SELECT * INTO member FROM committee_roster WHERE id = p_roster_member;
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
  SELECT * INTO member FROM committee_roster WHERE id = booking.roster_member_id;
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

DROP FUNCTION admin_update_practice_group(uuid, text, int, slot_status);

CREATE FUNCTION admin_update_practice_group(
  p_group uuid,
  p_name text,
  p_committee_capacity int,
  p_faci_gm_capacity int,
  p_status slot_status
) RETURNS practice_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  group_row practice_groups;
  committee_booked int;
  faci_gm_booked int;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO group_row FROM practice_groups WHERE id = p_group FOR UPDATE;
  IF group_row IS NULL THEN RAISE EXCEPTION 'group_unavailable'; END IF;
  IF btrim(coalesce(p_name, '')) = ''
     OR p_committee_capacity < 0
     OR p_faci_gm_capacity < 0
     OR p_committee_capacity + p_faci_gm_capacity < 1 THEN
    RAISE EXCEPTION 'invalid_group';
  END IF;

  SELECT
    count(*) FILTER (WHERE practice_capacity_category(r.position) = 'committee')::int,
    count(*) FILTER (WHERE practice_capacity_category(r.position) = 'faci_gm')::int
  INTO committee_booked, faci_gm_booked
  FROM practice_group_bookings b
  JOIN committee_roster r ON r.id = b.roster_member_id
  WHERE b.group_id = p_group;

  IF p_committee_capacity < committee_booked THEN
    RAISE EXCEPTION 'committee_capacity_below_booking_count';
  END IF;
  IF p_faci_gm_capacity < faci_gm_booked THEN
    RAISE EXCEPTION 'faci_gm_capacity_below_booking_count';
  END IF;

  UPDATE practice_groups
  SET name = btrim(p_name),
      capacity = p_committee_capacity + p_faci_gm_capacity,
      committee_capacity = p_committee_capacity,
      faci_gm_capacity = p_faci_gm_capacity,
      status = p_status
  WHERE id = p_group RETURNING * INTO group_row;
  RETURN group_row;
END $$;

REVOKE ALL ON FUNCTION practice_capacity_category(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION practice_capacity_category(text) TO service_role;
REVOKE ALL ON FUNCTION public_practice_catalog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public_practice_catalog() TO service_role;
REVOKE ALL ON FUNCTION admin_update_practice_group(uuid, text, int, int, slot_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_update_practice_group(uuid, text, int, int, slot_status) TO authenticated;

NOTIFY pgrst, 'reload schema';
