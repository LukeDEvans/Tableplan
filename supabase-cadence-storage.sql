-- Cadence score-bytes storage — a PRIVATE, content-addressed bucket for the
-- piano-score subsystem (MusicXML, and later PDF/scan representations).
--
-- Differs deliberately from recipe-photos: this bucket is PRIVATE (public=false)
-- because a personal score library is private data — reads require an authed,
-- authorized session. Objects are addressed by their sha-256 content hash
-- (path = "<userId>/<sha256>"), so identical bytes dedupe and integrity is
-- verifiable. Bytes never ride the IO-hot tableplan_states JSONB rows.
--
-- Replace YOUR-EMAIL@example.com with the owner's email before running, exactly
-- as the other supabase-*.sql files in this repo do.
--
-- Run once in the Supabase SQL editor (or via a migration) to set up the bucket.

insert into storage.buckets (id, name, public, file_size_limit)
values (
  'cadence-blobs',
  'cadence-blobs',
  false,             -- PRIVATE: scores are personal data; reads require auth
  26214400           -- 25 MB per object (roomy for large MusicXML / future PDFs)
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

-- Reset policies so this script is idempotent.
drop policy if exists "Owner can read cadence blobs"   on storage.objects;
drop policy if exists "Owner can upload cadence blobs"  on storage.objects;
drop policy if exists "Owner can update cadence blobs"  on storage.objects;
drop policy if exists "Owner can delete cadence blobs"  on storage.objects;

create policy "Owner can read cadence blobs"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'cadence-blobs'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com'
);

create policy "Owner can upload cadence blobs"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'cadence-blobs'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com'
);

create policy "Owner can update cadence blobs"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'cadence-blobs'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com'
)
with check (
  bucket_id = 'cadence-blobs'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com'
);

create policy "Owner can delete cadence blobs"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'cadence-blobs'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com'
);
