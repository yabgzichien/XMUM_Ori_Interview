-- The committee page is the account-free roster. Logins exist only for the
-- three seed accounts. Head of Facilitator and Head of Game Master are not
-- roster titles, and this app no longer creates accounts from invites.

-- Drop roster rows that used the retired titles, including any practice booking.
UPDATE practice_groups
SET leader_roster_member_id = NULL
WHERE leader_roster_member_id IN (
  SELECT id FROM committee_roster WHERE position IN ('hof', 'hog')
);

DELETE FROM practice_group_bookings
WHERE roster_member_id IN (
  SELECT id FROM committee_roster WHERE position IN ('hof', 'hog')
);

DELETE FROM committee_roster WHERE position IN ('hof', 'hog');

DELETE FROM staff_invites;

UPDATE profiles SET position = NULL WHERE position IN ('hof', 'hog');
DELETE FROM committee_positions WHERE value IN ('hof', 'hog');

-- Keep a profile row when interview or practice history still points at it,
-- but remove every auth user except the three seed accounts. profiles.id
-- cascades from auth.users, so the link is dropped first and restored
-- afterwards without rechecking the history rows that no longer have a login.
CREATE TEMP TABLE kept_staff_accounts AS
SELECT id FROM auth.users
WHERE lower(email) IN (
  'admin@xmum.local',
  'head.facilitator@xmum.local',
  'head.gm@xmum.local'
);

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

DELETE FROM auth.users
WHERE id NOT IN (SELECT id FROM kept_staff_accounts);

DELETE FROM profiles p
WHERE p.id NOT IN (SELECT id FROM kept_staff_accounts)
  AND NOT EXISTS (SELECT 1 FROM slots s WHERE s.created_by = p.id)
  AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.applicant_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM practice_groups g WHERE g.created_by = p.id)
  AND NOT EXISTS (SELECT 1 FROM practice_sessions sess WHERE sess.created_by = p.id)
  AND NOT EXISTS (SELECT 1 FROM practice_group_bookings gb WHERE gb.assigned_by = p.id)
  AND NOT EXISTS (SELECT 1 FROM practice_settings ps WHERE ps.updated_by = p.id);

UPDATE profiles
SET role = 'applicant', position = NULL
WHERE id NOT IN (SELECT id FROM kept_staff_accounts);

ALTER TABLE profiles
  ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
  NOT VALID;

CREATE OR REPLACE FUNCTION head_set_committee_position(p_profile_id uuid, p_position text)
RETURNS profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'committee logins are not created in the app';
END $$;

NOTIFY pgrst, 'reload schema';
