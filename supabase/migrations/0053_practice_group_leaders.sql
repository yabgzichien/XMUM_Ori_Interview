-- 0053_practice_group_leaders.sql
-- A performance group can have several leaders. The single
-- practice_groups.leader_roster_member_id column is superseded by this join
-- table (the old column is left in place but is no longer read or written).

CREATE TABLE practice_group_leaders (
  group_id uuid NOT NULL REFERENCES practice_groups(id) ON DELETE CASCADE,
  roster_member_id uuid NOT NULL REFERENCES committee_roster(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, roster_member_id)
);
CREATE INDEX practice_group_leaders_member_idx ON practice_group_leaders (roster_member_id);

INSERT INTO practice_group_leaders (group_id, roster_member_id)
SELECT id, leader_roster_member_id FROM practice_groups
WHERE leader_roster_member_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE practice_group_leaders ENABLE ROW LEVEL SECURITY;
CREATE POLICY practice_group_leaders_admin_all ON practice_group_leaders
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
REVOKE ALL ON practice_group_leaders FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON practice_group_leaders TO authenticated;

-- ---------- catalog: groups expose a list of leaders ----------
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
        'leaders', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', lr.id,
            'name', lr.name,
            'position', coalesce(lp.label, lr.position)
          ) ORDER BY lr.name)
          FROM practice_group_leaders gl
          JOIN committee_roster lr ON lr.id = gl.roster_member_id
          LEFT JOIN committee_positions lp ON lp.value = lr.position
          WHERE gl.group_id = g.id
        ), '[]'::jsonb),
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

-- ---------- lookup: same, held seats exclude the caller's own ----------
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
        'leaders', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', lr.id,
            'name', lr.name,
            'position', coalesce(lp.label, lr.position)
          ) ORDER BY lr.name)
          FROM practice_group_leaders gl
          JOIN committee_roster lr ON lr.id = gl.roster_member_id
          LEFT JOIN committee_positions lp ON lp.value = lr.position
          WHERE gl.group_id = g.id
        ), '[]'::jsonb),
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

REVOKE ALL ON FUNCTION public_practice_catalog() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public_practice_lookup(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public_practice_catalog() TO service_role;
GRANT EXECUTE ON FUNCTION public_practice_lookup(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
