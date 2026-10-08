-- 0046_default_split_practice_capacity.sql
-- Preserve compatibility for trusted scripts that insert practice groups
-- without explicitly supplying the new category quotas.

ALTER TABLE practice_groups
  ALTER COLUMN committee_capacity SET DEFAULT 1,
  ALTER COLUMN faci_gm_capacity SET DEFAULT 1;

NOTIFY pgrst, 'reload schema';
