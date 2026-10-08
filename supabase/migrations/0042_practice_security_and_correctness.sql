-- 0042_practice_security_and_correctness.sql
-- Atomically reserve verification attempts, return authoritative session data,
-- recognize self-service bookings with nullable audit fields, and attribute
-- admin booking removals to the authenticated admin.

CREATE OR REPLACE FUNCTION reserve_practice_verification_attempt(p_address_fingerprint text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  recent_count int;
  reservation_id bigint;
BEGIN
  IF p_address_fingerprint IS NULL OR p_address_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_fingerprint';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_address_fingerprint, 0));
  DELETE FROM practice_verification_failures
  WHERE attempted_at < clock_timestamp() - interval '24 hours';

  SELECT count(*) INTO recent_count
  FROM practice_verification_failures
  WHERE address_fingerprint = p_address_fingerprint
    AND attempted_at >= clock_timestamp() - interval '15 minutes';

  IF recent_count >= 10 THEN RETURN NULL; END IF;

  INSERT INTO practice_verification_failures (address_fingerprint)
  VALUES (p_address_fingerprint)
  RETURNING id INTO reservation_id;
  RETURN reservation_id;
END $$;

CREATE OR REPLACE FUNCTION release_practice_verification_attempt(p_attempt bigint)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM practice_verification_failures WHERE id = p_attempt;
$$;

REVOKE ALL ON FUNCTION reserve_practice_verification_attempt(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_practice_verification_attempt(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_practice_verification_attempt(text) TO service_role;
GRANT EXECUTE ON FUNCTION release_practice_verification_attempt(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public_practice_lookup(p_student_id text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  member committee_roster;
  existing practice_group_bookings;
  group_row practice_groups;
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

  IF tg_op = 'INSERT'
     AND tg_table_name = 'practice_group_bookings'
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
