-- 0047_guard_booked_member_category_change.sql
-- Roster edits and JSON/CSV imports may change positions. Prevent a booked
-- member from being moved into a category whose quota is already full.

CREATE OR REPLACE FUNCTION guard_booked_practice_member_category_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  booked_group uuid;
  group_row practice_groups;
  next_category text;
  next_count int;
  next_capacity int;
BEGIN
  IF practice_capacity_category(new.position) = practice_capacity_category(old.position) THEN
    RETURN new;
  END IF;

  SELECT b.group_id INTO booked_group
  FROM practice_group_bookings b
  WHERE b.roster_member_id = old.id;
  IF booked_group IS NULL THEN RETURN new; END IF;

  SELECT * INTO group_row FROM practice_groups WHERE id = booked_group FOR UPDATE;
  next_category := practice_capacity_category(new.position);
  next_capacity := CASE next_category
    WHEN 'faci_gm' THEN group_row.faci_gm_capacity
    ELSE group_row.committee_capacity
  END;

  SELECT count(*) INTO next_count
  FROM practice_group_bookings b
  JOIN committee_roster r ON r.id = b.roster_member_id
  WHERE b.group_id = booked_group
    AND b.roster_member_id <> old.id
    AND practice_capacity_category(r.position) = next_category;

  IF next_count >= next_capacity THEN
    RAISE EXCEPTION 'member_category_capacity_full';
  END IF;
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS guard_booked_practice_member_category_change ON committee_roster;
CREATE TRIGGER guard_booked_practice_member_category_change
  BEFORE UPDATE OF position ON committee_roster
  FOR EACH ROW EXECUTE FUNCTION guard_booked_practice_member_category_change();

NOTIFY pgrst, 'reload schema';
