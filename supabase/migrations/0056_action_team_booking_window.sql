-- 0056_action_team_booking_window.sql
-- Action Team booking window, controlled by admins from the dashboard.
--
-- reserve_slot / confirm_reservation already refuse bookings outside
-- track_settings.window_open .. window_close, so the window is the single
-- switch for the public booking link. New rows start closed (window_close =
-- now()) so the link stays shut until an admin opens it.

insert into track_settings (track, orientation, orientation_year, window_open, window_close)
values
  ('action_team', 'february', 2026, null, now()),
  ('action_team', 'april', 2026, null, now()),
  ('action_team', 'december', 2026, null, now())
on conflict do nothing;

-- ---------- Public read of the window ----------
-- track_settings is only readable by signed-in users; the booking page is
-- public, so expose just the two timestamps it needs. No row means closed,
-- matching reserve_slot.
create or replace function booking_window(p_track track, p_orientation orientation, p_year int default 2026)
returns table (window_open timestamptz, window_close timestamptz)
language sql security definer stable set search_path = public as $$
  select t.window_open, t.window_close
  from track_settings t
  where t.track = p_track and t.orientation = p_orientation and t.orientation_year = p_year
$$;

grant execute on function booking_window(track, orientation, int) to anon, authenticated;

-- ---------- Admin write of the window ----------
-- Upsert so a new orientation year works without a seed row.
create or replace function admin_set_booking_window(
  p_track track,
  p_orientation orientation,
  p_year int,
  p_window_open timestamptz,
  p_window_close timestamptz
) returns track_settings
language plpgsql security definer set search_path = public as $$
declare
  t track_settings;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;

  insert into track_settings (track, orientation, orientation_year, window_open, window_close)
  values (p_track, p_orientation, p_year, p_window_open, p_window_close)
  on conflict (track, orientation, orientation_year)
  do update set window_open = excluded.window_open, window_close = excluded.window_close
  returning * into t;

  return t;
end $$;

revoke execute on function admin_set_booking_window(track, orientation, int, timestamptz, timestamptz) from public;
grant execute on function admin_set_booking_window(track, orientation, int, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
