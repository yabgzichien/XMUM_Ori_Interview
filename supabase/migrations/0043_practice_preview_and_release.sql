-- 0043_practice_preview_and_release.sql
-- Public performance previews, a shared December 2026 booking release time,
-- roster-selected leaders, and optional YouTube/MP3/external song media.

CREATE TABLE practice_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orientation orientation NOT NULL DEFAULT 'december' CHECK (orientation = 'december'),
  orientation_year int NOT NULL DEFAULT 2026 CHECK (orientation_year = 2026),
  booking_opens_at timestamptz,
  updated_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (orientation, orientation_year)
);

INSERT INTO practice_settings (orientation, orientation_year, booking_opens_at)
VALUES ('december', 2026, NULL)
ON CONFLICT (orientation, orientation_year) DO NOTHING;

CREATE TRIGGER practice_settings_updated_at
  BEFORE UPDATE ON practice_settings
  FOR EACH ROW EXECUTE FUNCTION set_practice_updated_at();

ALTER TABLE practice_groups
  ADD COLUMN performance_type text CHECK (performance_type IS NULL OR char_length(performance_type) <= 80),
  ADD COLUMN description text CHECK (description IS NULL OR char_length(description) <= 2000),
  ADD COLUMN leader_roster_member_id uuid REFERENCES committee_roster(id) ON DELETE SET NULL,
  ADD COLUMN performance_video_url text,
  ADD COLUMN song_source_type text CHECK (song_source_type IS NULL OR song_source_type IN ('youtube', 'mp3', 'external')),
  ADD COLUMN song_url text,
  ADD COLUMN song_storage_path text,
  ADD CONSTRAINT practice_groups_song_source_shape CHECK (
    (song_source_type IS NULL AND song_url IS NULL AND song_storage_path IS NULL)
    OR (song_source_type IN ('youtube', 'external') AND song_url IS NOT NULL AND song_storage_path IS NULL)
    OR (song_source_type = 'mp3' AND song_url IS NULL AND song_storage_path IS NOT NULL)
  );

CREATE INDEX practice_groups_leader_idx ON practice_groups (leader_roster_member_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('practice-audio', 'practice-audio', true)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY practice_audio_public_read ON storage.objects
  FOR SELECT USING (bucket_id = 'practice-audio');
CREATE POLICY practice_audio_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'practice-audio' AND (SELECT public.is_admin()));
CREATE POLICY practice_audio_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'practice-audio' AND (SELECT public.is_admin()))
  WITH CHECK (bucket_id = 'practice-audio' AND (SELECT public.is_admin()));
CREATE POLICY practice_audio_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'practice-audio' AND (SELECT public.is_admin()));

ALTER TABLE practice_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY practice_settings_admin_all ON practice_settings
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
REVOKE ALL ON practice_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON practice_settings TO authenticated;

CREATE OR REPLACE FUNCTION public_practice_catalog()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  opens_at timestamptz;
  current_time timestamptz := statement_timestamp();
BEGIN
  SELECT booking_opens_at INTO opens_at
  FROM practice_settings
  WHERE orientation = 'december' AND orientation_year = 2026;

  RETURN jsonb_build_object(
    'server_now', current_time,
    'booking_opens_at', opens_at,
    'booking_open', opens_at IS NOT NULL AND current_time >= opens_at,
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

CREATE OR REPLACE FUNCTION public_practice_lookup(p_student_id text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  member committee_roster;
  existing practice_group_bookings;
  group_row practice_groups;
  opens_at timestamptz;
BEGIN
  member := verified_practice_member(p_student_id, p_email);
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
  taken int;
  opens_at timestamptz;
BEGIN
  SELECT booking_opens_at INTO opens_at FROM practice_settings
  WHERE orientation = 'december' AND orientation_year = 2026;
  IF opens_at IS NULL OR statement_timestamp() < opens_at THEN
    RAISE EXCEPTION 'booking_not_open';
  END IF;

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
  IF taken >= group_row.capacity THEN RAISE EXCEPTION 'group_full'; END IF;

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

REVOKE ALL ON FUNCTION public_practice_catalog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public_practice_catalog() TO service_role;

DROP TRIGGER IF EXISTS audit_practice_settings ON practice_settings;
CREATE TRIGGER audit_practice_settings
  AFTER INSERT OR UPDATE OR DELETE ON practice_settings
  FOR EACH ROW EXECUTE FUNCTION audit_practice_row_change();

NOTIFY pgrst, 'reload schema';
