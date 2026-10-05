-- 0044_fix_practice_catalog_clock.sql
-- Avoid PostgreSQL resolving `current_time` as its built-in timetz value.

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
        'seats_left', greatest(g.capacity - (
          SELECT count(*) FROM practice_group_bookings b WHERE b.group_id = g.id
        ), 0),
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
      WHERE g.orientation = 'december' AND g.orientation_year = 2026
    ), '[]'::jsonb)
  );
END $$;

REVOKE ALL ON FUNCTION public_practice_catalog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public_practice_catalog() TO service_role;

NOTIFY pgrst, 'reload schema';
