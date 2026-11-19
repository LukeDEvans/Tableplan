-- Personal receipts folder (Luke, 2026-11-12; FINANCE_AUDIT.md §14).
--
-- A receipt marked Personal belongs in its owner's Personal › Receipts in Document, not
-- in the household's. The app copies the file into 'u-<uid>' first; this function then
-- removes the household row right away (not through Recently deleted, which the other
-- household members can see for 30 days). Only when:
--   - the caller can read the household file's scope;
--   - the file belongs to a receipt that is the caller's own Personal receipt
--     (fin_receipts.scope = 'u-' || auth.uid());
--   - the caller's Personal scope already holds the copy (source.movedFrom = this file).
-- With the row gone, doc_pblob_deletable lets the app delete the household blobs.
--
-- Additive only: one new function, nothing else changes.

create or replace function public.doc_pdrop_moved_receipt(p_id uuid)
returns boolean
language sql volatile security definer set search_path = ''
as $$
  with gone as (
    delete from public.doc_pfiles f
    where f.id = p_id
      and auth.uid() is not null
      and public.doc_can_access(f.scope)
      and f.scope <> 'u-' || auth.uid()::text
      and f.source ? 'receiptId'
      and exists (select 1 from public.fin_receipts r
                  where r.id = f.source->>'receiptId' and r.scope = 'u-' || auth.uid()::text and r.deleted_at is null)
      and exists (select 1 from public.doc_pfiles c
                  where c.scope = 'u-' || auth.uid()::text and c.source->>'movedFrom' = f.id::text and c.deleted_at is null)
    returning 1)
  select exists (select 1 from gone);
$$;

revoke all on function public.doc_pdrop_moved_receipt(uuid) from public, anon;
grant execute on function public.doc_pdrop_moved_receipt(uuid) to authenticated, service_role;
