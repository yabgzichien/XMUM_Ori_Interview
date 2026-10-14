-- 0058_practice_single_round_trip.sql
-- One database round trip per public practice request, and a rate limit that
-- counts only failed student-ID checks.
--
-- Before: every verify/reserve/book request reserved a rate-limit row, ran the
-- work, fetched leader names and the member summary separately, then released
-- the row (4-5 round trips). In-flight requests counted toward the limit of 10,
-- so students sharing campus Wi-Fi (one public IP) were refused at booking
-- open. These wrappers check the limit, run the existing function, attach the
-- extra fields, and record a failure only when the student ID does not verify.
--
-- Numbered 0058 because 0055-0057 are taken on the Action Team branch, which
-- shares this database. The existing functions are untouched, so code that
-- still calls them keeps working.

-- Failed checks allowed per address in 15 minutes. Higher than the old 10
-- because a whole campus can share one address and a few typos must not lock
-- everyone out; still far too few to enumerate student IDs.
CREATE OR REPLACE FUNCTION practice_failure_limit() RETURNS int
LANGUAGE sql IMMUTABLE AS $$ SELECT 30 $$;

-- Takes a per-address transaction lock, so concurrent guesses from one address
-- are counted one at a time and cannot slip past the limit together. The lock
-- is held only for the few milliseconds the calling transaction runs.
CREATE OR REPLACE FUNCTION practice_address_blocked(p_address_fingerprint text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  recent_count int;
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
  RETURN recent_count >= practice_failure_limit();
END $$;

-- Maps an exception raised by the practice functions to a result. Identity
-- failures are recorded against the address; unknown errors are re-raised.
CREATE OR REPLACE FUNCTION practice_error_result(p_address_fingerprint text, p_message text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  code text;
BEGIN
  code := substring(p_message FROM '(identity_not_verified|group_full|group_unavailable|already_booked|booking_not_open|hold_expired)');
  IF code IS NULL THEN
    RAISE EXCEPTION '%', p_message;
  END IF;
  IF code = 'identity_not_verified' THEN
    INSERT INTO practice_verification_failures (address_fingerprint) VALUES (p_address_fingerprint);
  END IF;
  RETURN jsonb_build_object('error', code);
END $$;

CREATE OR REPLACE FUNCTION practice_member_summary(p_student_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'name', r.name,
    'student_id', r.student_id,
    'position_label', coalesce(p.label, r.position)
  )
  FROM committee_roster r
  LEFT JOIN committee_positions p ON p.value = r.position
  WHERE lower(r.student_id) = lower(normalize_practice_student_id(p_student_id)) AND r.active
$$;

CREATE OR REPLACE FUNCTION practice_leader_names(p_group uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(r.name ORDER BY r.name), '[]'::jsonb)
  FROM practice_group_leaders gl
  JOIN committee_roster r ON r.id = gl.roster_member_id
  WHERE gl.group_id = p_group
$$;

-- ---------- verify: lookup + member summary ----------
CREATE OR REPLACE FUNCTION practice_verify_limited(
  p_address_fingerprint text,
  p_student_id text,
  p_email text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lookup jsonb;
BEGIN
  IF practice_address_blocked(p_address_fingerprint) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  BEGIN
    lookup := public_practice_lookup(p_student_id, p_email);
  EXCEPTION WHEN raise_exception THEN
    RETURN practice_error_result(p_address_fingerprint, SQLERRM);
  END;
  RETURN jsonb_build_object('data', lookup || jsonb_build_object('member', practice_member_summary(p_student_id)));
END $$;

-- ---------- reserve: 60-second seat hold ----------
CREATE OR REPLACE FUNCTION practice_reserve_limited(
  p_address_fingerprint text,
  p_student_id text,
  p_email text,
  p_group uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  hold jsonb;
BEGIN
  IF practice_address_blocked(p_address_fingerprint) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  BEGIN
    hold := public_reserve_practice_group(p_student_id, p_email, p_group);
  EXCEPTION WHEN raise_exception THEN
    RETURN practice_error_result(p_address_fingerprint, SQLERRM);
  END;
  RETURN jsonb_build_object('data', hold);
END $$;

-- ---------- book: consume the hold + leader names ----------
CREATE OR REPLACE FUNCTION practice_book_limited(
  p_address_fingerprint text,
  p_student_id text,
  p_email text,
  p_group uuid,
  p_token uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  booking jsonb;
BEGIN
  IF practice_address_blocked(p_address_fingerprint) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  BEGIN
    booking := public_book_practice_group(p_student_id, p_email, p_group, p_token);
  EXCEPTION WHEN raise_exception THEN
    RETURN practice_error_result(p_address_fingerprint, SQLERRM);
  END;
  RETURN jsonb_build_object('data', booking || jsonb_build_object('leader_names', practice_leader_names((booking ->> 'group_id')::uuid)));
END $$;

REVOKE ALL ON FUNCTION practice_failure_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION practice_address_blocked(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION practice_error_result(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION practice_member_summary(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION practice_leader_names(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION practice_verify_limited(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION practice_reserve_limited(text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION practice_book_limited(text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION practice_verify_limited(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION practice_reserve_limited(text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION practice_book_limited(text, text, text, uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
