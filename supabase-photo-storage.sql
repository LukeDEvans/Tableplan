insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recipe-photos',
  'recipe-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view recipe photos" on storage.objects;
drop policy if exists "Luke can upload recipe photos" on storage.objects;
drop policy if exists "Luke can update recipe photos" on storage.objects;
drop policy if exists "Luke can delete recipe photos" on storage.objects;

create policy "Anyone can view recipe photos"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'recipe-photos');

create policy "Luke can upload recipe photos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'recipe-photos'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'mrlukedevans@gmail.com'
);

create policy "Luke can update recipe photos"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'recipe-photos'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'mrlukedevans@gmail.com'
)
with check (
  bucket_id = 'recipe-photos'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'mrlukedevans@gmail.com'
);

create policy "Luke can delete recipe photos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'recipe-photos'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'mrlukedevans@gmail.com'
);
