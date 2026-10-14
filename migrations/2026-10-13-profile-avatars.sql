-- Profile photos (profile.js).
--
-- Egress (the hard constraint): photos never touch tableplan_states. The device
-- shrinks a photo to a 256px JPEG (~15–25 KB) before upload; it lives here at
-- `<user_id>/avatar.jpg`; its version is a tiny `avatar_v` stamp in the user's auth
-- metadata; and every device keeps its own copy, downloading again only when that
-- version changes. So about one small download per device per photo change, and
-- nothing on a timer.
--
-- Public read: the object name is the user's uuid (unguessable) and a profile
-- photo is not secret. Writes: each user only inside their own folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users read their own avatar" on storage.objects;
drop policy if exists "Users upload their own avatar" on storage.objects;
drop policy if exists "Users replace their own avatar" on storage.objects;
drop policy if exists "Users delete their own avatar" on storage.objects;

-- SELECT is needed for upsert (replace) through the Storage API.
create policy "Users read their own avatar" on storage.objects
for select to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users upload their own avatar" on storage.objects
for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users replace their own avatar" on storage.objects
for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users delete their own avatar" on storage.objects
for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
