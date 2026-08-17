-- 0029_audit_log.sql
-- Append-only activity log. Every change to an app table is recorded with WHO
-- made it, WHAT they did (as a human-readable sentence), and WHEN.
--
-- Why triggers and not application code: mutations in this app arrive by four
-- different paths — the browser anon client under RLS, SECURITY DEFINER RPCs,
-- service-role writes from Next.js server code, and direct SQL in the Supabase
-- dashboard. Only a database trigger sees all four. Logging calls sprinkled
-- through server actions would silently miss most changes.
--
-- Immutability: RLS makes the table admin-read-only, the REVOKEs strip write
-- privileges from every app role (including service_role, which is BYPASSRLS
-- and therefore unaffected by RLS alone), and a raising trigger blocks UPDATE /
-- DELETE / TRUNCATE even for a role that still holds the privilege. Rows are
-- written by audit_row_change(), which is SECURITY DEFINER and so runs as the
-- table owner. See the note above the REVOKE block for what this does NOT
-- protect against.

-- ---------- Table ----------

create table audit_log (
  id             bigint generated always as identity primary key,
  -- clock_timestamp(), not now(): several RPCs write two audited tables in one
  -- transaction, and now() would give both the same timestamp. `id desc` is the
  -- real tiebreaker, but the timestamps should not lie.
  occurred_at    timestamptz not null default clock_timestamp(),

  -- WHO
  actor_type     text not null check (actor_type in ('user', 'public', 'service', 'system')),
  -- profiles.id when known. Deliberately NOT a foreign key: an audit row must
  -- outlive the profile it names.
  actor_id       uuid,
  actor_name     text not null,
  actor_email    text,
  actor_role     text,
  actor_position text,
  -- PostgREST JWT role: anon | authenticated | service_role. Null outside PostgREST.
  auth_role      text,

  -- WHAT
  action         text not null check (action in ('insert', 'update', 'delete')),
  table_name     text not null,
  -- text, not uuid: track_settings has a composite PK and committee_positions
  -- has a text PK.
  record_id      text,
  summary        text not null,
  changed_fields text[] not null default '{}',
  old_data       jsonb,
  new_data       jsonb,

  -- One column to search instead of an `.or()` across four. PostgREST's filter
  -- grammar is comma-separated, so a search string containing `,` `(` `)` would
  -- corrupt a multi-column .or() query; a single .ilike() has no such exposure.
  search_text    text generated always as (lower(
    coalesce(actor_name, '')     || ' ' || coalesce(actor_email, '')    || ' ' ||
    coalesce(actor_role, '')     || ' ' || coalesce(actor_position, '') || ' ' ||
    coalesce(summary, '')        || ' ' || table_name || ' ' || action  || ' ' ||
    coalesce(record_id, '')
  )) stored
);

create index audit_log_occurred_at_idx on audit_log (occurred_at desc, id desc);
create index audit_log_actor_idx       on audit_log (actor_id, id desc);
create index audit_log_table_idx       on audit_log (table_name, id desc);
create index audit_log_action_idx      on audit_log (action, id desc);

-- Trigram index so `ilike '%jane%'` doesn't sequential-scan. gin_trgm_ops
-- accelerates plain ILIKE directly, so no query needs the `%` similarity
-- operator (and therefore never needs `extensions` on its search_path).
-- Guarded: if the extension can't be created the migration must still succeed,
-- degrading to sequential ILIKE.
do $$
begin
  create extension if not exists pg_trgm with schema extensions;
  execute 'create index audit_log_search_trgm_idx on audit_log using gin (search_text extensions.gin_trgm_ops)';
exception when others then
  raise notice 'pg_trgm unavailable (%); audit_log search falls back to sequential ILIKE', sqlerrm;
end $$;

-- ---------- Label helpers ----------
-- These mirror the labels the UI already shows (app/NavClient.tsx roleLabels,
-- lib/orientation.ts) so a log entry reads the same way the screen does.

create or replace function audit_track_label(p_track text) returns text
  language sql immutable as $$
  select case p_track
    when 'facilitator' then 'Facilitator'
    when 'game_master' then 'Game Master'
    else coalesce(p_track, 'unknown track') end
$$;

create or replace function audit_role_label(p_role text) returns text
  language sql immutable as $$
  select case p_role
    when 'applicant' then 'Applicant'
    when 'head_facilitator' then 'Head of Facilitators'
    when 'head_gm' then 'Head of Game Masters'
    when 'admin' then 'Admin'
    when 'committee' then 'Committee Member'
    when 'performance_lead' then 'Performance Lead'
    else coalesce(p_role, 'none') end
$$;

create or replace function audit_position_label(p_value text) returns text
  language sql stable set search_path = public as $$
  select coalesce((select label from committee_positions where value = p_value), p_value, 'none')
$$;

create or replace function audit_orientation_label(p_orientation text, p_year int) returns text
  language sql immutable as $$
  select coalesce(initcap(p_orientation) || ' ', '') || coalesce(p_year::text, '')
$$;

-- Times are rendered in the orientation's local timezone so a log entry matches
-- what the admin saw on screen.
create or replace function audit_fmt_ts(p_ts timestamptz) returns text
  language sql stable as $$
  select case when p_ts is null then 'unset'
    else to_char(p_ts at time zone 'Asia/Kuala_Lumpur', 'DD Mon YYYY HH24:MI') end
$$;

create or replace function audit_fmt_time(p_ts timestamptz) returns text
  language sql stable as $$
  select case when p_ts is null then 'unset'
    else to_char(p_ts at time zone 'Asia/Kuala_Lumpur', 'HH24:MI') end
$$;

-- A parent row may already be gone by the time a cascade-deleted child's
-- trigger fires (deleting a practice group cascades to its members and
-- sessions), so every cross-table lookup has to degrade gracefully.
create or replace function audit_group_ref(p_group uuid) returns text
  language sql stable set search_path = public as $$
  select coalesce(
    (select 'practice group "' || g.name || '"' from practice_groups g where g.id = p_group),
    'a deleted practice group')
$$;

create or replace function audit_profile_name(p_id uuid) returns text
  language sql stable set search_path = public as $$
  select coalesce((select p.name from profiles p where p.id = p_id), 'a removed account')
$$;

create or replace function audit_slot_ref(p_slot uuid) returns text
  language sql stable set search_path = public as $$
  select coalesce(
    (select audit_track_label(s.track::text) || ', ' || audit_fmt_ts(s.starts_at)
            || case when coalesce(s.venue, '') <> '' then ', ' || s.venue else '' end
     from slots s where s.id = p_slot),
    'a deleted slot')
$$;

-- Just the time, for sentences that already name the track.
create or replace function audit_slot_when(p_slot uuid) returns text
  language sql stable set search_path = public as $$
  select coalesce((select audit_fmt_ts(s.starts_at) from slots s where s.id = p_slot),
                  'a deleted slot')
$$;

-- ---------- Actor resolution ----------
-- Returns { type, id, name, email, role, position, auth_role }.
--
-- Why GUCs and not current_user: current_user is always `postgres` inside a
-- SECURITY DEFINER function, and most mutations in this app flow through the
-- existing SECURITY DEFINER RPCs. request.jwt.claims and auth.uid() are
-- session-scoped and unaffected by SECURITY DEFINER — the same mechanism
-- is_admin() has always relied on.
--
-- Every current_setting() call uses the missing_ok form inside an exception
-- handler so the trigger is null-safe outside PostgREST. That is what keeps
-- `npm run migrate` and scripts/seed*.mjs working (see the null-auth.uid()
-- hazard documented at the top of 0019).
create or replace function audit_actor(p_row jsonb) returns jsonb
  language plpgsql security definer stable set search_path = public as $$
declare
  v_claims jsonb;
  v_jwt_role text;
  v_uid uuid;
  v_header_actor uuid;
  p profiles;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null;
  end;
  v_jwt_role := v_claims ->> 'role';

  begin
    v_uid := auth.uid();
  exception when others then
    v_uid := null;
  end;

  -- 1. A signed-in account.
  if v_uid is not null then
    select * into p from profiles where id = v_uid;
    if found then
      return jsonb_build_object(
        'type', 'user', 'id', p.id, 'name', p.name, 'email', p.email,
        'role', p.role::text, 'position', p.position, 'auth_role', v_jwt_role);
    end if;
    return jsonb_build_object(
      'type', 'user', 'id', v_uid, 'name', 'Unknown account',
      'email', v_claims ->> 'email', 'auth_role', v_jwt_role);
  end if;

  -- 2. Next.js server code holding the service-role key. x-actor-id is
  --    client-controllable, so it is honoured ONLY here — never for anon or
  --    authenticated requests.
  if v_jwt_role = 'service_role' then
    begin
      v_header_actor := (nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-actor-id')::uuid;
    exception when others then
      v_header_actor := null;
    end;
    if v_header_actor is not null then
      select * into p from profiles where id = v_header_actor;
      if found then
        return jsonb_build_object(
          'type', 'user', 'id', p.id, 'name', p.name, 'email', p.email,
          'role', p.role::text, 'position', p.position, 'auth_role', 'service_role');
      end if;
    end if;
    return jsonb_build_object(
      'type', 'service', 'name', 'Server task (service role)', 'auth_role', 'service_role');
  end if;

  -- 3. Anonymous public flows (book_slot_public, cancel_booking_by_email, ...).
  --    The applicant has no account, so identify them from the row itself.
  if v_jwt_role = 'anon' then
    return jsonb_build_object(
      'type', 'public',
      'name', coalesce(nullif(p_row ->> 'applicant_name', ''), 'Anonymous visitor'),
      'email', p_row ->> 'applicant_email',
      'auth_role', 'anon');
  end if;

  -- 4. No PostgREST context at all: migrations, psql, scripts/seed*.mjs.
  return jsonb_build_object(
    'type', 'system', 'name', 'System (migration or script)', 'auth_role', v_jwt_role);
end $$;

-- ---------- Record identity ----------

create or replace function audit_record_id(p_table text, p_row jsonb) returns text
  language sql immutable as $$
  select case p_table
    when 'track_settings' then
      concat_ws('|', p_row ->> 'track', p_row ->> 'orientation', p_row ->> 'orientation_year')
    when 'committee_positions' then p_row ->> 'value'
    else p_row ->> 'id' end
$$;

-- ---------- Redaction ----------
-- staff_invites.code is an activation credential — a leaked log export must not
-- let someone claim another person's committee account. changed_fields still
-- records that it changed, which is all an auditor needs.
--
-- bookings.interview_notes is deliberately kept in full: a head quietly
-- rewriting a candidate's assessment is exactly the abuse this log exists to
-- catch, and every reader of /admin/logs is an admin who can already read notes
-- through head_bookings.
create or replace function audit_redact(p_table text, p_data jsonb) returns jsonb
  language sql immutable as $$
  select case
    when p_data is null then null
    when p_table = 'staff_invites' then
      p_data || jsonb_build_object('code', '«redacted»')
    when p_table = 'bookings' then
      p_data || jsonb_build_object('experiences', left(coalesce(p_data ->> 'experiences', ''), 400))
    else p_data end
$$;

-- ---------- Human-readable summary ----------

create or replace function describe_audit_change(
  p_table text, p_op text, p_old jsonb, p_new jsonb, p_changed text[]
) returns text
  language plpgsql stable set search_path = public as $$
declare
  r jsonb := coalesce(p_new, p_old);
  suffix text := case when array_length(p_changed, 1) > 0
                      then ' (changed ' || array_to_string(p_changed, ', ') || ')'
                      else '' end;
  who text;
  intake text;
begin
  -- ----- slots -----
  if p_table = 'slots' then
    if p_op = 'INSERT' then
      return 'Created interview slot — ' || audit_track_label(r ->> 'track') || ', '
             || audit_fmt_ts((r ->> 'starts_at')::timestamptz) || '–'
             || audit_fmt_time((r ->> 'ends_at')::timestamptz)
             || case when coalesce(r ->> 'venue', '') <> '' then ', ' || (r ->> 'venue') else '' end
             || ' (capacity ' || coalesce(r ->> 'capacity', '?') || ')';
    elsif p_op = 'DELETE' then
      return 'Deleted interview slot — ' || audit_track_label(r ->> 'track') || ', '
             || audit_fmt_ts((r ->> 'starts_at')::timestamptz)
             || case when coalesce(r ->> 'venue', '') <> '' then ', ' || (r ->> 'venue') else '' end;
    elsif 'status' = any(p_changed) then
      return case when (p_new ->> 'status') = 'closed' then 'Closed' else 'Reopened' end
             || ' interview slot — ' || audit_track_label(p_new ->> 'track') || ', '
             || audit_fmt_ts((p_new ->> 'starts_at')::timestamptz);
    elsif 'starts_at' = any(p_changed) or 'ends_at' = any(p_changed) then
      return 'Moved interview slot from ' || audit_fmt_ts((p_old ->> 'starts_at')::timestamptz)
             || ' to ' || audit_fmt_ts((p_new ->> 'starts_at')::timestamptz)
             || ' — ' || audit_track_label(p_new ->> 'track');
    elsif 'capacity' = any(p_changed) then
      return 'Changed interview slot capacity from ' || (p_old ->> 'capacity') || ' to '
             || (p_new ->> 'capacity') || ' — ' || audit_track_label(p_new ->> 'track') || ', '
             || audit_fmt_ts((p_new ->> 'starts_at')::timestamptz);
    elsif 'venue' = any(p_changed) then
      return 'Moved interview slot to ' || coalesce(nullif(p_new ->> 'venue', ''), 'no venue')
             || ' (was ' || coalesce(nullif(p_old ->> 'venue', ''), 'no venue') || ') — '
             || audit_track_label(p_new ->> 'track') || ', '
             || audit_fmt_ts((p_new ->> 'starts_at')::timestamptz);
    else
      return 'Updated interview slot — ' || audit_track_label(p_new ->> 'track') || ', '
             || audit_fmt_ts((p_new ->> 'starts_at')::timestamptz) || suffix;
    end if;
  end if;

  -- ----- bookings -----
  if p_table = 'bookings' then
    who := coalesce(nullif(r ->> 'applicant_name', ''), 'an applicant');
    if p_op = 'INSERT' then
      return 'Added a new interview booking — ' || who
             || coalesce(' (' || nullif(r ->> 'applicant_email', '') || ')', '') || ', '
             || audit_slot_ref((r ->> 'slot_id')::uuid);
    elsif p_op = 'DELETE' then
      return 'Deleted booking for ' || who || ' — ' || audit_slot_ref((r ->> 'slot_id')::uuid);
    -- The welcome-email marker is appended to `experiences` by
    -- sendBulkWelcomeEmailsAction; without this branch a 100-applicant send
    -- produces 100 identical "Updated booking" lines.
    elsif p_changed = array['experiences']::text[]
          and (p_new ->> 'experiences') like '%[Welcome Email Sent]%'
          and coalesce(p_old ->> 'experiences', '') not like '%[Welcome Email Sent]%' then
      return 'Sent the welcome email to ' || who;
    elsif 'status' = any(p_changed) then
      return case when (p_new ->> 'status') = 'cancelled' then 'Cancelled' else 'Reinstated' end
             || ' booking for ' || who || ' — ' || audit_slot_ref((p_new ->> 'slot_id')::uuid);
    elsif 'slot_id' = any(p_changed) then
      return 'Rescheduled ' || who || ' from ' || audit_slot_when((p_old ->> 'slot_id')::uuid)
             || ' to ' || audit_slot_ref((p_new ->> 'slot_id')::uuid);
    elsif 'interview_status' = any(p_changed) then
      return 'Marked ' || who || '''s interview as ' || initcap(p_new ->> 'interview_status')
             || ' (was ' || initcap(coalesce(p_old ->> 'interview_status', 'pending')) || ')';
    elsif 'interview_notes' = any(p_changed) then
      return case when nullif(p_old ->> 'interview_notes', '') is null then 'Added' else 'Edited' end
             || ' interview notes for ' || who;
    else
      return 'Updated booking for ' || who || suffix;
    end if;
  end if;

  -- ----- profiles -----
  if p_table = 'profiles' then
    who := coalesce(nullif(r ->> 'name', ''), 'an account');
    if p_op = 'INSERT' then
      return 'Created account for ' || who
             || coalesce(' (' || nullif(r ->> 'email', '') || ')', '')
             || ' as ' || audit_role_label(r ->> 'role');
    elsif p_op = 'DELETE' then
      return 'Deleted account for ' || who
             || coalesce(' (' || nullif(r ->> 'email', '') || ')', '');
    elsif 'role' = any(p_changed) and (p_new ->> 'role') = 'applicant'
          and (p_new ->> 'position') is null then
      return 'Revoked committee access for ' || who;
    elsif 'role' = any(p_changed) then
      return 'Changed ' || who || '''s access level from ' || audit_role_label(p_old ->> 'role')
             || ' to ' || audit_role_label(p_new ->> 'role');
    elsif 'position' = any(p_changed) then
      return case when (p_new ->> 'position') is null
        then 'Cleared ' || who || '''s committee title (was '
             || audit_position_label(p_old ->> 'position') || ')'
        else 'Set ' || who || '''s committee title to '
             || audit_position_label(p_new ->> 'position') end;
    elsif 'name' = any(p_changed) then
      return 'Renamed ' || coalesce(nullif(p_old ->> 'name', ''), 'an account')
             || ' to ' || coalesce(nullif(p_new ->> 'name', ''), 'an account');
    elsif 'orientation' = any(p_changed) or 'orientation_year' = any(p_changed) then
      return 'Moved ' || who || ' to the '
             || audit_orientation_label(p_new ->> 'orientation', (p_new ->> 'orientation_year')::int)
             || ' orientation';
    else
      return 'Updated profile for ' || who || suffix;
    end if;
  end if;

  -- ----- staff_invites -----
  if p_table = 'staff_invites' then
    who := coalesce(nullif(r ->> 'name', ''), 'someone');
    if p_op = 'INSERT' then
      return 'Invited ' || who || coalesce(' (' || nullif(r ->> 'email', '') || ')', '')
             || ' as ' || audit_position_label(r ->> 'position')
             || ' — ' || audit_role_label(r ->> 'role') || ', '
             || audit_orientation_label(r ->> 'orientation', (r ->> 'orientation_year')::int);
    elsif p_op = 'DELETE' then
      return 'Revoked the invite for ' || who
             || coalesce(' (' || nullif(r ->> 'email', '') || ')', '');
    elsif 'claimed_at' = any(p_changed) and (p_old ->> 'claimed_at') is null
          and (p_new ->> 'claimed_at') is not null then
      return who || ' activated their invited account ('
             || audit_position_label(p_new ->> 'position') || ')';
    elsif 'role' = any(p_changed) then
      return 'Changed ' || who || '''s invited access level from '
             || audit_role_label(p_old ->> 'role') || ' to ' || audit_role_label(p_new ->> 'role');
    elsif 'position' = any(p_changed) then
      return 'Changed ' || who || '''s invited title to '
             || audit_position_label(p_new ->> 'position');
    else
      return 'Updated invite for ' || who || suffix;
    end if;
  end if;

  -- ----- track_settings -----
  if p_table = 'track_settings' then
    who := audit_track_label(r ->> 'track');
    intake := audit_orientation_label(r ->> 'orientation', (r ->> 'orientation_year')::int);
    if p_op = 'INSERT' then
      return 'Created booking settings for ' || who || ' — ' || intake;
    elsif p_op = 'DELETE' then
      return 'Deleted booking settings for ' || who || ' — ' || intake;
    elsif 'window_open' = any(p_changed) or 'window_close' = any(p_changed) then
      if (p_new ->> 'window_open') is null and (p_new ->> 'window_close') is null then
        return 'Closed the ' || who || ' booking window for ' || intake;
      end if;
      return 'Set the ' || who || ' booking window for ' || intake || ': '
             || audit_fmt_ts((p_new ->> 'window_open')::timestamptz) || ' to '
             || audit_fmt_ts((p_new ->> 'window_close')::timestamptz);
    elsif 'reschedule_cutoff_hours' = any(p_changed) then
      return 'Changed the ' || who || ' reschedule cutoff from '
             || (p_old ->> 'reschedule_cutoff_hours') || ' to '
             || (p_new ->> 'reschedule_cutoff_hours') || ' hours — ' || intake;
    else
      return 'Updated booking settings for ' || who || ' — ' || intake || suffix;
    end if;
  end if;

  -- ----- practice_groups -----
  if p_table = 'practice_groups' then
    who := 'practice group "' || coalesce(r ->> 'name', 'untitled') || '"';
    if p_op = 'INSERT' then
      return 'Created ' || who || ' led by ' || audit_profile_name((r ->> 'lead_id')::uuid)
             || ' — capacity ' || coalesce(r ->> 'capacity', '?') || ', '
             || audit_orientation_label(r ->> 'orientation', (r ->> 'orientation_year')::int);
    elsif p_op = 'DELETE' then
      return 'Deleted ' || who;
    elsif 'lead_id' = any(p_changed) then
      return 'Reassigned ' || who || ' lead from '
             || audit_profile_name((p_old ->> 'lead_id')::uuid) || ' to '
             || audit_profile_name((p_new ->> 'lead_id')::uuid);
    elsif 'name' = any(p_changed) then
      return 'Renamed practice group "' || coalesce(p_old ->> 'name', 'untitled')
             || '" to "' || coalesce(p_new ->> 'name', 'untitled') || '"';
    elsif 'capacity' = any(p_changed) then
      return 'Changed ' || who || ' capacity from ' || (p_old ->> 'capacity')
             || ' to ' || (p_new ->> 'capacity');
    elsif 'status' = any(p_changed) then
      return case when (p_new ->> 'status') = 'closed' then 'Closed ' else 'Reopened ' end || who;
    else
      return 'Updated ' || who || suffix;
    end if;
  end if;

  -- ----- practice_group_members -----
  if p_table = 'practice_group_members' then
    who := audit_profile_name((r ->> 'member_id')::uuid);
    if p_op = 'INSERT' then
      return 'Added ' || who || ' to ' || audit_group_ref((r ->> 'group_id')::uuid);
    elsif p_op = 'DELETE' then
      return 'Removed ' || who || ' from ' || audit_group_ref((r ->> 'group_id')::uuid);
    else
      return 'Updated ' || who || '''s membership in '
             || audit_group_ref((r ->> 'group_id')::uuid) || suffix;
    end if;
  end if;

  -- ----- practice_sessions -----
  if p_table = 'practice_sessions' then
    who := audit_group_ref((r ->> 'group_id')::uuid);
    if p_op = 'INSERT' then
      return 'Added a practice session for ' || who || ' — '
             || audit_fmt_ts((r ->> 'starts_at')::timestamptz) || '–'
             || audit_fmt_time((r ->> 'ends_at')::timestamptz)
             || case when coalesce(r ->> 'location', '') <> '' then ', ' || (r ->> 'location') else '' end;
    elsif p_op = 'DELETE' then
      return 'Deleted the practice session for ' || who || ' — '
             || audit_fmt_ts((r ->> 'starts_at')::timestamptz);
    elsif 'starts_at' = any(p_changed) or 'ends_at' = any(p_changed) then
      return 'Rescheduled the practice session for ' || who || ' from '
             || audit_fmt_ts((p_old ->> 'starts_at')::timestamptz) || ' to '
             || audit_fmt_ts((p_new ->> 'starts_at')::timestamptz);
    elsif 'location' = any(p_changed) then
      return 'Moved the practice session for ' || who || ' to '
             || coalesce(nullif(p_new ->> 'location', ''), 'no location')
             || ' (was ' || coalesce(nullif(p_old ->> 'location', ''), 'no location') || ')';
    else
      return 'Updated the practice session for ' || who || suffix;
    end if;
  end if;

  -- ----- committee_positions -----
  if p_table = 'committee_positions' then
    if p_op = 'INSERT' then
      return 'Added the committee title "' || (r ->> 'label') || '"';
    elsif p_op = 'DELETE' then
      return 'Removed the committee title "' || (r ->> 'label') || '"';
    else
      return 'Renamed the committee title "' || (p_old ->> 'label')
             || '" to "' || (p_new ->> 'label') || '"';
    end if;
  end if;

  -- Fallback for a table added later without a describe branch.
  return initcap(lower(p_op)) || ' on ' || p_table || suffix;
end $$;

-- ---------- The generic trigger ----------
-- Fail-closed: if the audit insert itself fails, the caller's transaction
-- aborts. No change may exist without a log entry. Only describe_audit_change()
-- is wrapped in a handler, so a bug in the prose degrades the sentence instead
-- of breaking the booking form.
--
-- There is deliberately no suppression flag for seeds or bulk jobs: a bypass
-- would be a tamper vector usable by exactly the party being audited.
create or replace function audit_row_change() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed text[] := '{}';
  v_actor jsonb;
  v_summary text;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    select coalesce(array_agg(e.key order by e.key), '{}'::text[]) into v_changed
      from jsonb_each(v_new) e
     where e.value is distinct from (v_old -> e.key);
    -- No-op UPDATE (a seed upsert that changed nothing): don't log noise.
    if v_changed = '{}'::text[] then
      return null;
    end if;
  else
    v_old := to_jsonb(old);
  end if;

  v_actor := audit_actor(coalesce(v_new, v_old));

  begin
    v_summary := describe_audit_change(tg_table_name, tg_op, v_old, v_new, v_changed);
  exception when others then
    v_summary := initcap(lower(tg_op)) || ' on ' || tg_table_name;
  end;

  insert into audit_log (
    actor_type, actor_id, actor_name, actor_email, actor_role, actor_position, auth_role,
    action, table_name, record_id, summary, changed_fields, old_data, new_data
  ) values (
    v_actor ->> 'type',
    nullif(v_actor ->> 'id', '')::uuid,
    coalesce(nullif(v_actor ->> 'name', ''), 'Unknown'),
    v_actor ->> 'email',
    v_actor ->> 'role',
    v_actor ->> 'position',
    v_actor ->> 'auth_role',
    lower(tg_op),
    tg_table_name,
    audit_record_id(tg_table_name, coalesce(v_new, v_old)),
    coalesce(v_summary, initcap(lower(tg_op)) || ' on ' || tg_table_name),
    v_changed,
    audit_redact(tg_table_name, v_old),
    audit_redact(tg_table_name, v_new)
  );

  return null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'staff_invites', 'committee_positions', 'slots', 'bookings',
    'track_settings', 'practice_groups', 'practice_group_members', 'practice_sessions'
  ] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger audit_%1$s after insert or update or delete on public.%1$I '
      'for each row execute function audit_row_change()', t);
  end loop;
end $$;

-- ---------- Immutability ----------

-- (a) RLS: admins read, nobody writes. There is deliberately no INSERT/UPDATE/
--     DELETE policy, so those are denied for every `authenticated` caller.
alter table audit_log enable row level security;

create policy "audit_log_select_admin" on audit_log
  for select to authenticated
  using (is_admin());

-- (b) Table privileges. THIS IS THE LOAD-BEARING LAYER. Supabase's default
--     privileges grant ALL on new public tables to anon/authenticated/
--     service_role, and service_role is BYPASSRLS — so RLS alone protects
--     nothing from the Next.js server. Only these revokes do. BYPASSRLS does
--     not bypass table-level GRANTs.
revoke all on table audit_log from anon;
revoke insert, update, delete, truncate, references, trigger on table audit_log
  from public, anon, authenticated, service_role;
grant select on table audit_log to authenticated;  -- still filtered by RLS
grant select on table audit_log to service_role;   -- read-only, for export/backup
revoke all on sequence audit_log_id_seq from public, anon, authenticated, service_role;

-- (c) A raising trigger, which catches anything that still holds the privilege
--     — including `postgres` in the Supabase SQL editor. Removing a row then
--     requires first dropping or disabling this trigger: a loud, deliberate
--     act rather than a stray DELETE.
--
--     What this does NOT protect against, stated honestly: anyone with database
--     owner or superuser access (the Supabase dashboard login, SUPABASE_DB_URL,
--     or the DB password) can DISABLE TRIGGER / DROP TRIGGER / re-GRANT /
--     DROP TABLE / restore an older backup. No design that stores the log in
--     the same Postgres database can prevent that. What is guaranteed is that
--     no path through the application — browser, anonymous visitor, Next.js
--     server with the service-role key, or a compromised admin session — can
--     alter or delete an entry.
create or replace function audit_log_immutable() returns trigger
  language plpgsql as $$
begin
  raise exception 'audit_log is append-only: % is not permitted', tg_op
    using errcode = 'insufficient_privilege';
end $$;

create trigger audit_log_no_update
  before update on audit_log for each row execute function audit_log_immutable();
create trigger audit_log_no_delete
  before delete on audit_log for each row execute function audit_log_immutable();
-- Row triggers do not fire on TRUNCATE, so this one has to be statement-level.
create trigger audit_log_no_truncate
  before truncate on audit_log for each statement execute function audit_log_immutable();

-- ---------- Attributable interview notes ----------
-- app/actions/saveNotesAction.ts wrote interview_notes through the service-role
-- client with no authorization check at all — any caller holding a booking id
-- could overwrite anyone's interview assessment. Routing it through an RPC
-- closes that hole and makes the actor attributable via auth.uid(), instead of
-- every note edit being logged as an anonymous "Server task".
--
-- The coalesce(..., false) is the NULL-logic bug 0018 was written to fix; do
-- not reintroduce it.
create or replace function head_update_interview_notes(
  p_booking uuid,
  p_notes text
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

  update bookings set interview_notes = nullif(p_notes, '') where id = p_booking;
end $$;

revoke execute on function head_update_interview_notes(uuid, text) from public;
grant execute on function head_update_interview_notes(uuid, text) to authenticated;

-- Make audit_log visible to PostgREST straight away.
notify pgrst, 'reload schema';
