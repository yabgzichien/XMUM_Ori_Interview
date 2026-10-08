-- 0052_roster_import_contact_number.sql
-- Roster import accepts an optional contact_number per row. A blank or missing
-- value never erases a number that was already saved for that member.

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
    position text NOT NULL,
    contact_number text
  ) ON COMMIT DROP;

  INSERT INTO roster_import_rows (name, student_id, position, contact_number)
  SELECT btrim(value ->> 'name'),
         normalize_practice_student_id(value ->> 'student_id'),
         btrim(value ->> 'position'),
         nullif(btrim(coalesce(value ->> 'contact_number', '')), '')
  FROM jsonb_array_elements(p_rows) item(value);

  IF EXISTS (
    SELECT 1 FROM roster_import_rows
    WHERE name = '' OR student_id IS NULL OR position = ''
       OR char_length(coalesce(contact_number, '')) > 30
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

  INSERT INTO committee_roster (name, student_id, position, contact_number, active)
  SELECT name, student_id, position, contact_number, true FROM roster_import_rows
  ON CONFLICT (lower(student_id)) DO UPDATE
  SET name = excluded.name,
      position = excluded.position,
      contact_number = coalesce(excluded.contact_number, committee_roster.contact_number),
      active = true;

  RETURN jsonb_build_object('total', total_count, 'inserted', new_count, 'updated', updated_count);
END $$;

REVOKE ALL ON FUNCTION admin_apply_practice_roster(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_apply_practice_roster(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
