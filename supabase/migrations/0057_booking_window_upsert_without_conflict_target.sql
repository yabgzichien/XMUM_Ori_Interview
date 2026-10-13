-- 0057_booking_window_upsert_without_conflict_target.sql
-- 0056's admin_set_booking_window used ON CONFLICT (track, orientation,
-- orientation_year), but some databases still have the older primary key
-- (track, orientation): 0020's PK swap is wrapped in exception handlers and
-- can silently not apply. Update first, insert only when no row exists, so
-- the function works with either key.

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

  update track_settings
    set window_open = p_window_open, window_close = p_window_close
    where track = p_track and orientation = p_orientation and orientation_year = p_year
    returning * into t;

  if t is null then
    insert into track_settings (track, orientation, orientation_year, window_open, window_close)
    values (p_track, p_orientation, p_year, p_window_open, p_window_close)
    returning * into t;
  end if;

  return t;
end $$;

notify pgrst, 'reload schema';
