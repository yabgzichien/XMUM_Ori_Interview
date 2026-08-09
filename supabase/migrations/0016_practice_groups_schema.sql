-- 0016_practice_groups_schema.sql
-- Performance practice groups: committee members join a group led by a
-- performance lead; the lead schedules practice sessions for the group.

-- ---------- Expand user_role (committee, performance_lead) ----------
-- Postgres forbids using a value added via `ALTER TYPE ... ADD VALUE` in the
-- same transaction it was added in, and this migration set is always applied
-- as one transaction (scripts/apply-migrations.mjs, or a single paste into
-- the Supabase SQL editor). So instead of ADD VALUE we create a new enum with
-- every value already listed, swap the columns onto it, then rename it back
-- to `user_role` — same technique 0014 used by introducing a whole new
-- `orientation` type rather than altering `track`.
create type user_role_new as enum (
  'applicant', 'head_facilitator', 'head_gm', 'admin', 'committee', 'performance_lead'
);

drop function if exists auth_role();

-- Postgres refuses to ALTER COLUMN ... TYPE on a column that an RLS policy
-- references directly (not through a helper function). Only one such policy
-- exists (profiles_insert_self_applicant checks `role = 'applicant'` inline)
-- — drop it, do the type swap, then recreate it identically.
drop policy if exists "profiles_insert_self_applicant" on profiles;

-- Same problem for staff_invites_role_chk: a CHECK constraint's compiled
-- expression is bound to the column's type at creation time, so re-validating
-- it against the new type mid-ALTER throws "operator does not exist:
-- user_role_new = user_role". Drop it now, re-add (with 'committee' allowed)
-- once the type swap is done.
alter table staff_invites drop constraint staff_invites_role_chk;

alter table profiles alter column role drop default;
alter table profiles alter column role type user_role_new using role::text::user_role_new;
alter table profiles alter column role set default 'applicant';

alter table staff_invites alter column role type user_role_new using role::text::user_role_new;

drop type user_role;
alter type user_role_new rename to user_role;

create or replace function auth_role() returns user_role
  language sql security definer stable set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create policy "profiles_insert_self_applicant" on profiles
  for insert to authenticated
  with check (id = auth.uid() and role = 'applicant');

-- ---------- profiles: track/orientation for committee-tier accounts ----------
alter table profiles add column track track;
alter table profiles add column orientation orientation;

-- ---------- staff_invites: carry track/orientation; allow 'committee' ----------
alter table staff_invites add column track track;
alter table staff_invites add column orientation orientation;

alter table staff_invites add constraint staff_invites_role_chk
  check (role in ('head_facilitator', 'head_gm', 'admin', 'committee'));

-- ---------- Let a head toggle their own committee members between ----------
-- 'committee' and 'performance_lead' (admin retains full role-change rights).
create or replace function prevent_self_role_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.role <> old.role and not is_admin() then
    if auth_role() in ('head_facilitator', 'head_gm')
       and old.role in ('committee', 'performance_lead')
       and new.role in ('committee', 'performance_lead') then
      return new;
    end if;
    raise exception 'only an admin may change a role';
  end if;
  return new;
end $$;

-- ---------- practice_groups ----------
create table practice_groups (
  id uuid primary key default gen_random_uuid(),
  track track not null,
  orientation orientation not null,
  name text not null,
  lead_id uuid not null unique references profiles(id),
  capacity int not null check (capacity > 0),
  status slot_status not null default 'open',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index practice_groups_track_orientation_idx on practice_groups (track, orientation);

-- ---------- practice_group_members ----------
create table practice_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references practice_groups(id) on delete cascade,
  member_id uuid not null references profiles(id),
  track track not null,
  orientation orientation not null,
  joined_at timestamptz not null default now(),
  unique (group_id, member_id)
);
-- One active group per person per orientation.
create unique index one_active_group_per_member_orientation
  on practice_group_members (member_id, orientation);

-- ---------- practice_sessions ----------
create table practice_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references practice_groups(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint practice_sessions_time_chk check (ends_at > starts_at)
);
create index practice_sessions_group_starts_at_idx on practice_sessions (group_id, starts_at);

-- ---------- RLS ----------
alter table practice_groups enable row level security;
alter table practice_group_members enable row level security;
alter table practice_sessions enable row level security;

-- Direct table reads are head/admin-only (dashboard drill-down convenience).
-- Committee members read via SECURITY DEFINER RPCs only (0017), same split
-- used for `bookings`. All writes go through RPCs regardless of role.
create policy "practice_groups_select_head_or_admin" on practice_groups
  for select to authenticated
  using (auth_managed_track() = track or is_admin());

create policy "practice_group_members_select_head_or_admin" on practice_group_members
  for select to authenticated
  using (auth_managed_track() = track or is_admin());

create policy "practice_sessions_select_head_or_admin" on practice_sessions
  for select to authenticated
  using (
    exists (
      select 1 from practice_groups g
      where g.id = practice_sessions.group_id
        and (auth_managed_track() = g.track or is_admin())
    )
  );
