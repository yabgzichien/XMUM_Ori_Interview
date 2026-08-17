-- 0032_profile_avatar.sql
-- Lets a user upload/change/remove their own profile picture. Stored in a
-- public "avatars" bucket at `{user_id}/avatar.<ext>` — the leading folder is
-- how the storage policies below scope writes to the owner, mirroring the
-- profiles RLS pattern in 0002. Public read means the URL works directly in
-- <img src>/nav without a signed-URL round trip.

alter table profiles add column avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatar_public_read" on storage.objects
  for select
  using (bucket_id = 'avatars');

create policy "avatar_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar_owner_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

NOTIFY pgrst, 'reload schema';
