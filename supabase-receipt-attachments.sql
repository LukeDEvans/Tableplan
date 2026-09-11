-- Private Storage bucket for finance receipt images.
--
-- Unlike recipe-photos / event-files (public, email-gated), receipts are
-- PRIVATE financial data: the bucket is not public and every object is scoped
-- to the uploading user by a `<auth.uid()>/…` path prefix, enforced by RLS.
-- The client reads them through short-lived signed URLs (createSignedUrl), so
-- no object is ever world-readable. Mirrors the trip-attachments bucket.
--
-- Apply once at deploy (Supabase SQL editor or migration runner).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipt-attachments',
  'receipt-attachments',
  false,
  5242880,  -- 5 MB per image (client downscales to <=1600px before upload)
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users read own receipt images"   on storage.objects;
drop policy if exists "Users upload own receipt images"  on storage.objects;
drop policy if exists "Users update own receipt images"  on storage.objects;
drop policy if exists "Users delete own receipt images"  on storage.objects;

-- Read/write only objects whose first path segment is the caller's uid.
create policy "Users read own receipt images"
on storage.objects for select to authenticated
using (
  bucket_id = 'receipt-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users upload own receipt images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'receipt-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users update own receipt images"
on storage.objects for update to authenticated
using (
  bucket_id = 'receipt-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'receipt-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users delete own receipt images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'receipt-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);
