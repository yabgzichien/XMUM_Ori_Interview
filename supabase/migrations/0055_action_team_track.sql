-- 0055_action_team_track.sql
-- Add the Action Team interview track. Facilitator and Game Master stay in the
-- enum: existing bookings, practice groups, and head roles still reference them.
--
-- Postgres cannot use an enum value in the same transaction that added it, so
-- the rows and functions that need 'action_team' live in 0056. When pasting
-- all_migrations.sql into the SQL editor, run up to this file first, then the rest.

alter type track add value if not exists 'action_team';
