-- 0050_practice_group_holds.sql
-- Temporary seat holds for performance-practice booking. A verified member
-- reserves one seat in their own pool (committee or faci_gm) for 60 seconds
-- while they sit on the confirm step. Expiry is computed lazily, like the
-- interview slot holds, so no background job is needed.

CREATE TABLE practice_group_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES practice_groups(id) ON DELETE CASCADE,
  roster_member_id uuid NOT NULL REFERENCES committee_roster(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('committee', 'faci_gm')),
  token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  held_at timestamptz NOT NULL DEFAULT now(),
  released boolean NOT NULL DEFAULT false
);
CREATE INDEX practice_group_holds_active_idx
  ON practice_group_holds (group_id, category) WHERE NOT released;
CREATE INDEX practice_group_holds_member_idx
  ON practice_group_holds (roster_member_id) WHERE NOT released;

-- No policies: only the SECURITY DEFINER functions below touch this table.
ALTER TABLE practice_group_holds ENABLE ROW LEVEL SECURITY;

-- Live holds in a pool, optionally ignoring one member's own hold.
CREATE OR REPLACE FUNCTION practice_held_count(p_group uuid, p_category text, p_exclude_member uuid DEFAULT NULL)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int
  FROM practice_group_holds h
  WHERE h.group_id = p_group
    AND h.category = p_category
    AND NOT h.released
    AND h.held_at > now() - interval '60 seconds'
    AND (p_exclude_member IS NULL OR h.roster_member_id <> p_exclude_member)
$$;

-- ---------- catalog: held seats count as taken ----------
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
        'seats_left', greatest(g.committee_capacity - counts.committee_count - practice_held_count(g.id, 'committee'), 0)
          + greatest(g.faci_gm_capacity - counts.faci_gm_count - practice_held_count(g.id, 'faci_gm'), 0),
        'committee_seats_left', greatest(g.committee_capacity - counts.committee_count - practice_held_count(g.id, 'committee'), 0),
        'faci_gm_seats_left', greatest(g.faci_gm_capacity - counts.faci_gm_count - practice_held_count(g.id, 'faci_gm'), 0),
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

-- ---------- lookup: held seats count as taken (except the caller's own) ----------
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
          WHEN 'faci_gm' THEN greatest(g.faci_gm_capacity - counts.faci_gm_count - practice_held_count(g.id, 'faci_gm', member.id), 0)
          ELSE greatest(g.committee_capacity - counts.committee_count - practice_held_count(g.id, 'committee', member.id), 0)
        END,
        'committee_seats_left', greatest(g.committee_capacity - counts.committee_count - practice_held_count(g.id, 'committee', member.id), 0),
        'faci_gm_seats_left', greatest(g.faci_gm_capacity - counts.faci_gm_count - practice_held_count(g.id, 'faci_gm', member.id), 0),
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

-- ---------- reserve: hold one seat in the member's own pool for 60 seconds ----------
CREATE OR REPLACE FUNCTION public_reserve_practice_group(
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
  hold practice_group_holds;
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

  -- A member only ever holds one seat; drop any earlier hold before counting
  -- so they are never blocked by themselves.
  UPDATE practice_group_holds SET released = true
  WHERE roster_member_id = member.id AND NOT released;

  category_capacity := CASE member_category
    WHEN 'faci_gm' THEN group_row.faci_gm_capacity
    ELSE group_row.committee_capacity
  END;
  SELECT count(*) INTO taken
  FROM practice_group_bookings b
  JOIN committee_roster r ON r.id = b.roster_member_id
  WHERE b.group_id = p_group AND practice_capacity_category(r.position) = member_category;
  IF taken + practice_held_count(p_group, member_category) >= category_capacity THEN
    RAISE EXCEPTION 'group_full';
  END IF;

  INSERT INTO practice_group_holds (group_id, roster_member_id, category)
  VALUES (p_group, member.id, member_category) RETURNING * INTO hold;

  RETURN jsonb_build_object(
    'token', hold.token,
    'expires_at', hold.held_at + interval '60 seconds'
  );
END $$;

CREATE OR REPLACE FUNCTION public_release_practice_hold(p_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE practice_group_holds SET released = true WHERE token = p_token AND NOT released;
END $$;

-- ---------- book: consume the hold (token optional for rolling deploys) ----------
DROP FUNCTION IF EXISTS public_book_practice_group(text, text, uuid);

CREATE OR REPLACE FUNCTION public_book_practice_group(
  p_student_id text,
  p_email text,
  p_group uuid,
  p_token uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  normalized_id text := normalize_practice_student_id(p_student_id);
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  member committee_roster;
  group_row practice_groups;
  booking practice_group_bookings;
  hold practice_group_holds;
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

  IF p_token IS NOT NULL THEN
    -- 5s grace covers network latency on a click at the last second.
    SELECT * INTO hold FROM practice_group_holds
    WHERE token = p_token AND roster_member_id = member.id AND group_id = p_group
    FOR UPDATE;
    IF hold IS NULL OR hold.released OR hold.held_at <= now() - interval '65 seconds' THEN
      RAISE EXCEPTION 'hold_expired';
    END IF;
  END IF;

  category_capacity := CASE member_category
    WHEN 'faci_gm' THEN group_row.faci_gm_capacity
    ELSE group_row.committee_capacity
  END;
  SELECT count(*) INTO taken
  FROM practice_group_bookings b
  JOIN committee_roster r ON r.id = b.roster_member_id
  WHERE b.group_id = p_group AND practice_capacity_category(r.position) = member_category;
  -- Other members' live holds keep their seats; this member's own hold is ours.
  IF taken + practice_held_count(p_group, member_category, member.id) >= category_capacity THEN
    RAISE EXCEPTION 'group_full';
  END IF;

  BEGIN
    INSERT INTO practice_group_bookings (group_id, roster_member_id, source)
    VALUES (p_group, member.id, 'self_service') RETURNING * INTO booking;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_booked';
  END;

  UPDATE practice_group_holds SET released = true
  WHERE roster_member_id = member.id AND NOT released;

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

REVOKE ALL ON FUNCTION practice_held_count(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public_reserve_practice_group(text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public_release_practice_hold(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public_book_practice_group(text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public_practice_catalog() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public_practice_lookup(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION practice_held_count(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public_reserve_practice_group(text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public_release_practice_hold(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public_book_practice_group(text, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public_practice_catalog() TO service_role;
GRANT EXECUTE ON FUNCTION public_practice_lookup(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
