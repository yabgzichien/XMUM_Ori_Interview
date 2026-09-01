-- 0033_performance_indexes.sql
-- Performance indexes on foreign keys and frequently queried filter columns.

-- 1. bookings: foreign key and lookup indexes
CREATE INDEX IF NOT EXISTS bookings_slot_id_idx ON bookings (slot_id);
CREATE INDEX IF NOT EXISTS bookings_applicant_email_idx ON bookings (applicant_email);
CREATE INDEX IF NOT EXISTS bookings_student_id_idx ON bookings (student_id) WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bookings_track_orientation_status_idx ON bookings (track, orientation, orientation_year, status);

-- 2. practice group relations
CREATE INDEX IF NOT EXISTS practice_group_members_group_id_idx ON practice_group_members (group_id);
CREATE INDEX IF NOT EXISTS practice_group_members_member_id_idx ON practice_group_members (member_id);
CREATE INDEX IF NOT EXISTS practice_sessions_group_id_idx ON practice_sessions (group_id);

-- 3. profiles: role and orientation filters
CREATE INDEX IF NOT EXISTS profiles_role_idx ON profiles (role);
CREATE INDEX IF NOT EXISTS profiles_role_orientation_year_idx ON profiles (role, orientation, orientation_year);

-- 4. staff_invites: email and status lookup
CREATE INDEX IF NOT EXISTS staff_invites_email_claimed_idx ON staff_invites (email, claimed_at);
