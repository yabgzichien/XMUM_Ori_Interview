-- 0005_handle_new_user.sql
-- Auto-create a profiles row whenever a new auth.users row is inserted,
-- using the signup metadata passed via supabase.auth.signUp({ options: { data } }).

create or replace function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, student_id, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    nullif(new.raw_user_meta_data->>'student_id', ''),
    new.email,
    'applicant'
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
