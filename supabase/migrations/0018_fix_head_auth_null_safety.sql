-- 0018_fix_head_auth_null_safety.sql
-- Fixes an authorization bug found while verifying 0016/0017: checks written
-- as `if not (auth_managed_track() = p_track or is_admin()) then raise
-- exception ...` never raise for a caller whose auth_managed_track() is NULL
-- (anyone who isn't a head for ANY track — i.e. every committee/performance_lead
-- account, and previously every anonymous caller too, since these functions
-- were never explicitly revoked from PUBLIC). In three-valued SQL logic,
-- `NULL or false` is NULL, and `not NULL` is NULL, so `if NULL then raise`
-- never fires. Concretely: a logged-in 'committee' account could call
-- head_create_practice_group(...) directly and self-promote to
-- performance_lead. The same pattern already existed, pre-dating this
-- feature, in head_slots/head_bookings/head_cancel_booking/
-- head_update_interview_status.
--
-- Fix: wrap the possibly-NULL comparison in coalesce(..., false) so it
-- resolves to a real boolean, and explicitly revoke the default PUBLIC
-- execute grant every CREATE FUNCTION implicitly adds, re-granting only to
-- `authenticated` (anon already has no business calling any of these).

-- ---------- Pre-existing interview-booking RPCs ----------

create or replace function head_slots(p_track track, p_orientation orientation)
returns table (
  id uuid, track track, orientation orientation, starts_at timestamptz, ends_at timestamptz,
  capacity int, status slot_status, booked_count bigint
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (coalesce(auth_managed_track() = p_track, false) or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  return query
    select s.id, s.track, s.orientation, s.starts_at, s.ends_at, s.capacity, s.status,
           count(b.*) filter (where b.status = 'booked') as booked_count
    from slots s
    left join bookings b on b.slot_id = s.id
    where s.track = p_track and s.orientation = p_orientation
    group by s.id
    order by s.starts_at;
end $$;

create or replace function head_bookings(p_track track, p_orientation orientation)
returns table (
  booking_id uuid, slot_id uuid, track track, orientation orientation, starts_at timestamptz, ends_at timestamptz,
  applicant_name text, applicant_email text, student_id text, experiences text, created_at timestamptz,
  interview_status text, interview_notes text
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (coalesce(auth_managed_track() = p_track, false) or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  return query
    select b.id, b.slot_id, b.track, b.orientation, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id, b.experiences, b.created_at,
           b.interview_status, b.interview_notes
    from bookings b
    join slots s on s.id = b.slot_id
    where b.track = p_track and b.orientation = p_orientation and b.status = 'booked'
    order by s.starts_at, b.applicant_name;
end $$;

create or replace function head_cancel_booking(p_booking uuid)
returns bookings
language plpgsql security definer set search_path = public as $$
declare
  b bookings;
begin
  select * into b from bookings where id = p_booking for update;
  if b is null then
    raise exception 'booking not found';
  end if;
  if not (coalesce(auth_managed_track() = b.track, false) or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  if b.status <> 'booked' then
    raise exception 'booking is not active';
  end if;
  update bookings set status = 'cancelled' where id = p_booking returning * into b;
  return b;
end $$;

create or replace function head_update_interview_status(
  p_booking uuid,
  p_status text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  b bookings;
begin
  select * into b from bookings where id = p_booking;
  if b is null then
    raise exception 'booking not found';
  end if;

  if not (coalesce(auth_managed_track() = b.track, false) or is_admin()) then
    raise exception 'not authorized for this track';
  end if;

  if p_status not in ('pending', 'failed', 'approved') then
    raise exception 'invalid interview status';
  end if;

  update bookings set interview_status = p_status where id = p_booking;
end $$;

revoke execute on function head_slots(track, orientation) from public;
revoke execute on function head_bookings(track, orientation) from public;
revoke execute on function head_cancel_booking(uuid) from public;
revoke execute on function head_update_interview_status(uuid, text) from public;
grant execute on function head_slots(track, orientation) to authenticated;
grant execute on function head_bookings(track, orientation) to authenticated;
grant execute on function head_cancel_booking(uuid) to authenticated;
grant execute on function head_update_interview_status(uuid, text) to authenticated;

-- ---------- Practice-group RPCs (0017) ----------

create or replace function available_practice_groups()
returns table (
  id uuid, name text, lead_id uuid, lead_name text, capacity int,
  member_count bigint, seats_left bigint, status slot_status, session_count bigint
)
language plpgsql security definer stable set search_path = public as $$
declare
  scope record;
begin
  if coalesce(auth_role() not in ('committee', 'performance_lead'), true) then
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
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
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
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
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
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
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
  if coalesce(auth_role() <> 'committee', true) then
    raise exception 'only committee members may join a group';
  end if;
  select * into scope from auth_committee_scope();
  if scope.track is null or scope.orientation is null then
    raise exception 'no track/orientation on this profile';
  end if;

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
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from practice_group_members where member_id = auth.uid();
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
  if not (coalesce(g.lead_id = auth.uid(), false) or coalesce(auth_managed_track() = g.track, false) or is_admin()) then
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
  if not (coalesce(g.lead_id = auth.uid(), false) or coalesce(auth_managed_track() = g.track, false) or is_admin()) then
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
  if not (coalesce(g.lead_id = auth.uid(), false) or coalesce(auth_managed_track() = g.track, false) or is_admin()) then
    raise exception 'not authorized for this group';
  end if;
  delete from practice_sessions where id = p_session;
end $$;

create or replace function head_practice_groups(p_track track, p_orientation orientation)
returns table (
  id uuid, name text, lead_id uuid, lead_name text, lead_email text, capacity int,
  member_count bigint, status slot_status, session_count bigint, created_at timestamptz
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (coalesce(auth_managed_track() = p_track, false) or is_admin()) then
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
  if not (coalesce(auth_managed_track() = p_track, false) or is_admin()) then
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
  if not (coalesce(auth_managed_track() = p_track, false) or is_admin()) then
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
  if not (coalesce(auth_managed_track() = g.track, false) or is_admin()) then
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
  if not (coalesce(auth_managed_track() = g.track, false) or is_admin()) then
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
  if not (coalesce(auth_managed_track() = g.track, false) or is_admin()) then
    raise exception 'not authorized for this track';
  end if;
  update profiles set role = 'committee' where id = g.lead_id;
  delete from practice_groups where id = p_group;
end $$;

revoke execute on function auth_committee_scope() from public;
revoke execute on function available_practice_groups() from public;
revoke execute on function my_practice_group() from public;
revoke execute on function my_practice_group_sessions() from public;
revoke execute on function my_practice_group_members() from public;
revoke execute on function join_practice_group(uuid) from public;
revoke execute on function leave_practice_group() from public;
revoke execute on function lead_create_session(uuid, timestamptz, timestamptz) from public;
revoke execute on function lead_update_session(uuid, timestamptz, timestamptz) from public;
revoke execute on function lead_delete_session(uuid) from public;
revoke execute on function head_practice_groups(track, orientation) from public;
revoke execute on function head_committee_roster(track, orientation) from public;
revoke execute on function head_create_practice_group(text, track, orientation, int, uuid) from public;
revoke execute on function head_update_practice_group(uuid, text, int, slot_status) from public;
revoke execute on function head_reassign_practice_lead(uuid, uuid) from public;
revoke execute on function head_delete_practice_group(uuid) from public;

-- ---------- Defense in depth: these should never actually be NULL ----------
update practice_groups set created_by = lead_id where created_by is null;
alter table practice_groups alter column created_by set not null;
alter table practice_sessions alter column created_by set not null;
