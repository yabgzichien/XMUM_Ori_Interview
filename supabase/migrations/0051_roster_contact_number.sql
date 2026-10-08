-- 0051_roster_contact_number.sql
-- Optional contact number shown to admins next to each practice group member.

ALTER TABLE committee_roster
  ADD COLUMN IF NOT EXISTS contact_number text
  CHECK (contact_number IS NULL OR (btrim(contact_number) <> '' AND char_length(contact_number) <= 30));

NOTIFY pgrst, 'reload schema';
