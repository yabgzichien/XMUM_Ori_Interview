-- 0028_committee_positions_table.sql
-- Turns the fixed list of committee "position" titles (Treasurer, HOF, PGVG,
-- etc.) into an admin-manageable table instead of a hardcoded CHECK list, so
-- an admin can add new position titles from the Committee Management screen
-- without a code change. Also lets a position be assigned at invite time —
-- previously positions could only be set later, per committee member, via
-- head_set_committee_position.

create table committee_positions (
  value text primary key,
  label text not null,
  created_at timestamptz not null default now()
);

alter table committee_positions enable row level security;

-- Anyone signed in can read the list (needed to render position labels and
-- populate pickers across the app); only an admin can add/remove options.
create policy "committee_positions_select_authenticated" on committee_positions
  for select to authenticated
  using (true);

create policy "committee_positions_admin_insert" on committee_positions
  for insert to authenticated
  with check (is_admin());

create policy "committee_positions_admin_delete" on committee_positions
  for delete to authenticated
  using (is_admin());

insert into committee_positions (value, label) values
  ('hof', 'Head of Facilitator (HOF)'),
  ('hog', 'Head of Game Master (HOGM)'),
  ('game_master', 'Game Master'),
  ('facilitator', 'Facilitator'),
  ('treasurer', 'Treasurer'),
  ('sponsorship', 'Sponsorship'),
  ('logistic', 'Logistic'),
  ('tech_team', 'Tech Team'),
  ('organising_chairperson', 'Organising Chair Person'),
  ('event_planner', 'Event Planner'),
  ('designer', 'Designer'),
  ('pgvg', 'PGVG'),
  ('public_relations', 'Public Relation'),
  ('secretary', 'Secretary'),
  ('general_affairs', 'General Affairs')
on conflict (value) do nothing;

-- profiles.position: swap the hardcoded CHECK for a foreign key against the
-- new table, so admin-added positions become valid immediately.
alter table profiles drop constraint if exists profiles_position_chk;
alter table profiles add constraint profiles_position_fk
  foreign key (position) references committee_positions(value);

-- staff_invites: carry an optional position/title chosen at invite time,
-- applied to the profile once the invite is claimed (see
-- app/api/staff/register/route.ts).
alter table staff_invites add column if not exists position text
  references committee_positions(value);
