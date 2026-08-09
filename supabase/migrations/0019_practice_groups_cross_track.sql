-- 0019_practice_groups_cross_track.sql
-- Two fixes:
--
-- 1. Practice groups no longer split by track — facilitators and game
--    masters practice together, so a group is scoped by orientation only.
--    Any head (facilitator or GM) or admin manages all practice groups for
--    an orientation, since a group is no longer owned by a single track.
--
-- 2. prevent_self_role_change() blocked ANY role change made through the
--    service-role key (scripts/seed.mjs, app/api/staff/register/route.ts),
--    because auth.uid() is NULL for those calls (confirmed empirically) and
--    the trigger's `not is_admin()` check reads that as "not an admin" and
--    raises. Concretely: a brand-new committee invite could never complete
--    registration. The trigger's actual purpose is stopping a logged-in,
--    non-admin end user from escalating their own role via a normal
--    authenticated client call — a NULL auth.uid() means there is no such
--    end-user session (service role / migrations / this trigger's own
--    SECURITY DEFINER context are already fully trusted), so it should pass.

create or replace function prevent_self_role_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.role <> old.role and auth.uid() is not null and not is_admin() then
    if auth_role() in ('head_facilitator', 'head_gm')
       and old.role in ('committee', 'performance_lead')
       and new.role in ('committee', 'performance_lead') then
      return new;
    end if;
    raise exception 'only an admin may change a role';
  end if;
  return new;
end $$;

-- ---------- Helper: any head or admin (practice groups are cross-track) ----------
create or replace function is_head_or_admin() returns boolean
  language sql security definer stable set search_path = public as $$
  select coalesce((select role in ('head_facilitator', 'head_gm', 'admin') from profiles where id = auth.uid()), false)
$$;

-- ---------- Drop policies that reference the track column before dropping it ----------
drop policy if exists "practice_groups_select_head_or_admin" on practice_groups;
drop policy if exists "practice_group_members_select_head_or_admin" on practice_group_members;
drop policy if exists "practice_sessions_select_head_or_admin" on practice_sessions;

-- ---------- Drop RPC overloads whose signature or return type changes ----------
drop function if exists auth_committee_scope();
drop function if exists head_practice_groups(track, orientation);
drop function if exists head_committee_roster(track, orientation);
drop function if exists head_create_practice_group(text, track, orientation, int, uuid);

drop index if exists practice_groups_track_orientation_idx;
alter table practice_groups drop column track;
alter table practice_group_members drop column track;

create index practice_groups_orientation_idx on practice_groups (orientation);

create policy "practice_groups_select_head_or_admin" on practice_groups
  for select to authenticated using (is_head_or_admin());

create policy "practice_group_members_select_head_or_admin" on practice_group_members
  for select to authenticated using (is_head_or_admin());

create policy "practice_sessions_select_head_or_admin" on practice_sessions
  for select to authenticated using (is_head_or_admin());

-- ---------- Recreate affected RPCs ----------

create or replace function auth_committee_scope()
returns table (orientation orientation)
language sql security definer stable set search_path = public as $$
  select orientation from profiles where id = auth.uid()
$$;

create or replace function available_practice_groups()
returns table (
  id uuid, name text, lead_id uuid, lead_name text, capacity int,
  member_count bigint, seats_left bigint, status slot_status, session_count bigint
)
language plpgsql security definer stable set search_path = public as $$
declare
  caller_orientation orientation;
begin
  if coalesce(auth_role() not in ('committee', 'performance_lead'), true) then
    raise exception 'not authorized';
  end if;
  select orientation into caller_orientation from auth_committee_scope();
  if caller_orientation is null then
    raise exception 'no orientation on this profile';
  end if;
  return query
    select g.id, g.name, g.lead_id, p.name as lead_name, g.capacity,
           count(m.*) as member_count,
           g.capacity - count(m.*) as seats_left,
           g.status,
           count(distinct s.id) as session_count
    from practice_groups g
    join profiles p on p.id = g.lead_id
    left join practice_group_members m on m.group_id = g.id
    left join practice_sessions s on s.group_id = g.id
    where g.orientation = caller_orientation
    group by g.id, p.name
    order by g.name;
end $$;

create or replace function join_practice_group(p_group uuid)
returns practice_group_members
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
  taken int;
  caller_orientation orientation;
  row_out practice_group_members;
begin
  if coalesce(auth_role() <> 'committee', true) then
    raise exception 'only committee members may join a group';
  end if;
  select orientation into caller_orientation from auth_committee_scope();
  if caller_orientation is null then
    raise exception 'no orientation on this profile';
  end if;

  select * into g from practice_groups where id = p_group for update;
  if g is null then
    raise exception 'group not found';
  end if;
  if g.orientation <> caller_orientation then
    raise exception 'group is not in your orientation';
  end if;
  if g.status <> 'open' then
    raise exception 'group is closed';
  end if;

  select count(*) into taken from practice_group_members where group_id = p_group;
  if taken >= g.capacity then
    raise exception 'group is full';
  end if;

  begin
    insert into practice_group_members (group_id, member_id, orientation)
    values (p_group, auth.uid(), g.orientation)
    returning * into row_out;
  exception when unique_violation then
    raise exception 'you have already joined a practice group for this orientation';
  end;

  return row_out;
end $$;

create function head_practice_groups(p_orientation orientation)
returns table (
  id uuid, name text, lead_id uuid, lead_name text, lead_email text, capacity int,
  member_count bigint, status slot_status, session_count bigint, created_at timestamptz
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_head_or_admin() then
    raise exception 'not authorized';
  end if;
  return query
    select g.id, g.name, g.lead_id, p.name, p.email, g.capacity,
           count(distinct m.id), g.status, count(distinct s.id), g.created_at
    from practice_groups g
    join profiles p on p.id = g.lead_id
    left join practice_group_members m on m.group_id = g.id
    left join practice_sessions s on s.group_id = g.id
    where g.orientation = p_orientation
    group by g.id, p.name, p.email
    order by g.created_at;
end $$;

create function head_committee_roster(p_orientation orientation)
returns table (id uuid, name text, email text, track track, role user_role, leading_group_id uuid)
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_head_or_admin() then
    raise exception 'not authorized';
  end if;
  return query
    select pr.id, pr.name, pr.email, pr.track, pr.role, g.id
    from profiles pr
    left join practice_groups g on g.lead_id = pr.id
    where pr.orientation = p_orientation
      and pr.role in ('committee', 'performance_lead')
    order by pr.name;
end $$;

create function head_create_practice_group(
  p_name text, p_orientation orientation, p_capacity int, p_lead_profile_id uuid
) returns practice_groups
language plpgsql security definer set search_path = public as $$
declare
  lead_profile profiles;
  row_out practice_groups;
begin
  if not is_head_or_admin() then
    raise exception 'not authorized';
  end if;
  select * into lead_profile from profiles where id = p_lead_profile_id for update;
  if lead_profile is null or lead_profile.role <> 'committee' or lead_profile.orientation <> p_orientation then
    raise exception 'chosen lead must be a committee member in this orientation';
  end if;

  update profiles set role = 'performance_lead' where id = p_lead_profile_id;

  begin
    insert into practice_groups (name, orientation, capacity, lead_id, created_by)
    values (trim(p_name), p_orientation, p_capacity, p_lead_profile_id, auth.uid())
    returning * into row_out;
  exception when unique_violation then
    raise exception 'this person already leads a practice group';
  end;

  return row_out;
end $$;

create or replace function head_update_practice_group(
  p_group uuid, p_name text, p_capacity int, p_status slot_status
) returns practice_groups
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
  row_out practice_groups;
begin
  if not is_head_or_admin() then
    raise exception 'not authorized';
  end if;
  select * into g from practice_groups where id = p_group;
  if g is null then
    raise exception 'group not found';
  end if;
  update practice_groups set name = trim(p_name), capacity = p_capacity, status = p_status
  where id = p_group returning * into row_out;
  return row_out;
end $$;

create or replace function head_reassign_practice_lead(p_group uuid, p_new_lead_profile_id uuid)
returns practice_groups
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
  new_lead profiles;
  row_out practice_groups;
begin
  if not is_head_or_admin() then
    raise exception 'not authorized';
  end if;
  select * into g from practice_groups where id = p_group for update;
  if g is null then
    raise exception 'group not found';
  end if;
  select * into new_lead from profiles where id = p_new_lead_profile_id;
  if new_lead is null or new_lead.role <> 'committee' or new_lead.orientation <> g.orientation then
    raise exception 'chosen lead must be a committee member in this orientation';
  end if;

  update profiles set role = 'committee' where id = g.lead_id;
  update profiles set role = 'performance_lead' where id = p_new_lead_profile_id;

  update practice_groups set lead_id = p_new_lead_profile_id where id = p_group
  returning * into row_out;
  return row_out;
end $$;

create or replace function head_delete_practice_group(p_group uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
begin
  if not is_head_or_admin() then
    raise exception 'not authorized';
  end if;
  select * into g from practice_groups where id = p_group;
  if g is null then
    raise exception 'group not found';
  end if;
  update profiles set role = 'committee' where id = g.lead_id;
  delete from practice_groups where id = p_group;
end $$;

create or replace function lead_create_session(p_group uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns practice_sessions
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
  row_out practice_sessions;
begin
  select * into g from practice_groups where id = p_group;
  if g is null then
    raise exception 'group not found';
  end if;
  if not (coalesce(g.lead_id = auth.uid(), false) or is_head_or_admin()) then
    raise exception 'not authorized for this group';
  end if;
  insert into practice_sessions (group_id, starts_at, ends_at, created_by)
  values (p_group, p_starts_at, p_ends_at, auth.uid())
  returning * into row_out;
  return row_out;
end $$;

create or replace function lead_update_session(p_session uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns practice_sessions
language plpgsql security definer set search_path = public as $$
declare
  s practice_sessions;
  g practice_groups;
  row_out practice_sessions;
begin
  select * into s from practice_sessions where id = p_session;
  if s is null then
    raise exception 'session not found';
  end if;
  select * into g from practice_groups where id = s.group_id;
  if not (coalesce(g.lead_id = auth.uid(), false) or is_head_or_admin()) then
    raise exception 'not authorized for this group';
  end if;
  update practice_sessions set starts_at = p_starts_at, ends_at = p_ends_at
  where id = p_session returning * into row_out;
  return row_out;
end $$;

create or replace function lead_delete_session(p_session uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  s practice_sessions;
  g practice_groups;
begin
  select * into s from practice_sessions where id = p_session;
  if s is null then
    raise exception 'session not found';
  end if;
  select * into g from practice_groups where id = s.group_id;
  if not (coalesce(g.lead_id = auth.uid(), false) or is_head_or_admin()) then
    raise exception 'not authorized for this group';
  end if;
  delete from practice_sessions where id = p_session;
end $$;

-- ---------- Grants ----------
grant execute on function is_head_or_admin() to authenticated;
grant execute on function auth_committee_scope() to authenticated;
grant execute on function available_practice_groups() to authenticated;
grant execute on function join_practice_group(uuid) to authenticated;
grant execute on function head_practice_groups(orientation) to authenticated;
grant execute on function head_committee_roster(orientation) to authenticated;
grant execute on function head_create_practice_group(text, orientation, int, uuid) to authenticated;
grant execute on function head_update_practice_group(uuid, text, int, slot_status) to authenticated;
grant execute on function head_reassign_practice_lead(uuid, uuid) to authenticated;
grant execute on function head_delete_practice_group(uuid) to authenticated;
grant execute on function lead_create_session(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function lead_update_session(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function lead_delete_session(uuid) to authenticated;
