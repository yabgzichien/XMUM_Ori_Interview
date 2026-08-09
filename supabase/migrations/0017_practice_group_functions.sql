-- 0017_practice_group_functions.sql
-- RPCs for the performance practice group feature. All SECURITY DEFINER,
-- mirroring book_slot_public/head_* conventions (row locks before capacity
-- checks, raise exception for auth failures). Login-only feature: nothing
-- here is granted to `anon`.

-- ---------- Small helper ----------
create or replace function auth_committee_scope()
returns table (track track, orientation orientation)
language sql security definer stable set search_path = public as $$
  select track, orientation from profiles where id = auth.uid()
$$;

-- ---------- Committee: browse, join, leave ----------
create or replace function available_practice_groups()
returns table (
  id uuid, name text, lead_id uuid, lead_name text, capacity int,
  member_count bigint, seats_left bigint, status slot_status, session_count bigint
)
language plpgsql security definer stable set search_path = public as $$
declare
  scope record;
begin
  if auth_role() not in ('committee', 'performance_lead') then
    raise exception 'not authorized';
  end if;
  select * into scope from auth_committee_scope();
  if scope.track is null or scope.orientation is null then
    raise exception 'no track/orientation on this profile';
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
    where g.track = scope.track and g.orientation = scope.orientation
    group by g.id, p.name
    order by g.name;
end $$;

create or replace function my_practice_group()
returns table (
  group_id uuid, name text, lead_id uuid, lead_name text, capacity int,
  member_count bigint, status slot_status, is_lead boolean
)
language plpgsql security definer stable set search_path = public as $$
begin
  return query
    select g.id, g.name, g.lead_id, p.name, g.capacity,
           (select count(*) from practice_group_members m2 where m2.group_id = g.id),
           g.status,
           (g.lead_id = auth.uid())
    from practice_groups g
    join profiles p on p.id = g.lead_id
    where g.lead_id = auth.uid()
       or exists (
         select 1 from practice_group_members m
         where m.group_id = g.id and m.member_id = auth.uid()
       )
    limit 1;
end $$;

create or replace function my_practice_group_sessions()
returns table (id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql security definer stable set search_path = public as $$
begin
  return query
    select s.id, s.starts_at, s.ends_at
    from practice_sessions s
    where s.group_id in (
      select g.id from practice_groups g
      where g.lead_id = auth.uid()
         or exists (
           select 1 from practice_group_members m
           where m.group_id = g.id and m.member_id = auth.uid()
         )
    )
    order by s.starts_at;
end $$;

create or replace function my_practice_group_members()
returns table (member_id uuid, member_name text, joined_at timestamptz)
language plpgsql security definer stable set search_path = public as $$
begin
  return query
    select m.member_id, p.name, m.joined_at
    from practice_group_members m
    join profiles p on p.id = m.member_id
    where m.group_id in (
      select g.id from practice_groups g
      where g.lead_id = auth.uid()
         or exists (
           select 1 from practice_group_members m2
           where m2.group_id = g.id and m2.member_id = auth.uid()
         )
    )
    order by m.joined_at;
end $$;

create or replace function join_practice_group(p_group uuid)
returns practice_group_members
language plpgsql security definer set search_path = public as $$
declare
  g practice_groups;
  taken int;
  scope record;
  row_out practice_group_members;
begin
  if auth_role() <> 'committee' then
    raise exception 'only committee members may join a group';
  end if;
  select * into scope from auth_committee_scope();

  select * into g from practice_groups where id = p_group for update;
  if g is null then
    raise exception 'group not found';
  end if;
  if g.track <> scope.track or g.orientation <> scope.orientation then
    raise exception 'group is not in your track/orientation';
  end if;
  if g.status <> 'open' then
    raise exception 'group is closed';
  end if;

  select count(*) into taken from practice_group_members where group_id = p_group;
  if taken >= g.capacity then
    raise exception 'group is full';
  end if;

  begin
    insert into practice_group_members (group_id, member_id, track, orientation)
    values (p_group, auth.uid(), g.track, g.orientation)
    returning * into row_out;
  exception when unique_violation then
    raise exception 'you have already joined a practice group for this orientation';
  end;

  return row_out;
end $$;

create or replace function leave_practice_group()
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from practice_group_members where member_id = auth.uid();
end $$;

-- ---------- Performance lead: manage own group's sessions ----------
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
  if not (g.lead_id = auth.uid() or auth_managed_track() = g.track or is_admin()) then
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
  if not (g.lead_id = auth.uid() or auth_managed_track() = g.track or is_admin()) then
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
  if not (g.lead_id = auth.uid() or auth_managed_track() = g.track or is_admin()) then
    raise exception 'not authorized for this group';
  end if;
  delete from practice_sessions where id = p_session;
end $$;

-- ---------- Head/admin: manage groups + leads ----------
create or replace function head_practice_groups(p_track track, p_orientation orientation)
returns table (
  id uuid, name text, lead_id uuid, lead_name text, lead_email text, capacity int,
  member_count bigint, status slot_status, session_count bigint, created_at timestamptz
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (auth_managed_track() = p_track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  return query
    select g.id, g.name, g.lead_id, p.name, p.email, g.capacity,
           count(distinct m.id), g.status, count(distinct s.id), g.created_at
    from practice_groups g
    join profiles p on p.id = g.lead_id
    left join practice_group_members m on m.group_id = g.id
    left join practice_sessions s on s.group_id = g.id
    where g.track = p_track and g.orientation = p_orientation
    group by g.id, p.name, p.email
    order by g.created_at;
end $$;

create or replace function head_committee_roster(p_track track, p_orientation orientation)
returns table (id uuid, name text, email text, role user_role, leading_group_id uuid)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (auth_managed_track() = p_track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  return query
    select pr.id, pr.name, pr.email, pr.role, g.id
    from profiles pr
    left join practice_groups g on g.lead_id = pr.id
    where pr.track = p_track and pr.orientation = p_orientation
      and pr.role in ('committee', 'performance_lead')
    order by pr.name;
end $$;

create or replace function head_create_practice_group(
  p_name text, p_track track, p_orientation orientation, p_capacity int, p_lead_profile_id uuid
) returns practice_groups
language plpgsql security definer set search_path = public as $$
declare
  lead_profile profiles;
  row_out practice_groups;
begin
  if not (auth_managed_track() = p_track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  select * into lead_profile from profiles where id = p_lead_profile_id for update;
  if lead_profile is null or lead_profile.role <> 'committee'
     or lead_profile.track <> p_track or lead_profile.orientation <> p_orientation then
    raise exception 'chosen lead must be a committee member in this track and orientation';
  end if;

  update profiles set role = 'performance_lead' where id = p_lead_profile_id;

  begin
    insert into practice_groups (name, track, orientation, capacity, lead_id, created_by)
    values (trim(p_name), p_track, p_orientation, p_capacity, p_lead_profile_id, auth.uid())
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
  select * into g from practice_groups where id = p_group;
  if g is null then
    raise exception 'group not found';
  end if;
  if not (auth_managed_track() = g.track or is_admin()) then
    raise exception 'not authorized for this track';
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
  select * into g from practice_groups where id = p_group for update;
  if g is null then
    raise exception 'group not found';
  end if;
  if not (auth_managed_track() = g.track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  select * into new_lead from profiles where id = p_new_lead_profile_id;
  if new_lead is null or new_lead.role <> 'committee'
     or new_lead.track <> g.track or new_lead.orientation <> g.orientation then
    raise exception 'chosen lead must be a committee member in this track and orientation';
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
  select * into g from practice_groups where id = p_group;
  if g is null then
    raise exception 'group not found';
  end if;
  if not (auth_managed_track() = g.track or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  update profiles set role = 'committee' where id = g.lead_id;
  delete from practice_groups where id = p_group;
end $$;

-- ---------- Grants ----------
grant execute on function available_practice_groups() to authenticated;
grant execute on function my_practice_group() to authenticated;
grant execute on function my_practice_group_sessions() to authenticated;
grant execute on function my_practice_group_members() to authenticated;
grant execute on function join_practice_group(uuid) to authenticated;
grant execute on function leave_practice_group() to authenticated;
grant execute on function lead_create_session(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function lead_update_session(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function lead_delete_session(uuid) to authenticated;
grant execute on function head_practice_groups(track, orientation) to authenticated;
grant execute on function head_committee_roster(track, orientation) to authenticated;
grant execute on function head_create_practice_group(text, track, orientation, int, uuid) to authenticated;
grant execute on function head_update_practice_group(uuid, text, int, slot_status) to authenticated;
grant execute on function head_reassign_practice_lead(uuid, uuid) to authenticated;
grant execute on function head_delete_practice_group(uuid) to authenticated;
