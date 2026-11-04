-- Optional cleanup: drops the first Documents tables, moved aside by
-- 2026-11-03c-documents-v1-aside.sql (v1_ prefix, all access revoked). Checked empty
-- on 2026-11-03 (0 rows in each). Not applied: this session can't run DROP, so Luke
-- runs it in the Supabase SQL editor whenever convenient. Harmless to leave.
-- Then record it: insert into supabase_migrations.schema_migrations (version, name,
-- statements, created_by) values ('20261104000000', 'documents_v1_drop',
-- array['drop v1_doc_* leftovers'], 'luke');

do $$
begin
  if (select count(*) from public.v1_doc_vaults) + (select count(*) from public.v1_doc_files)
     + (select count(*) from public.v1_doc_device_boxes) + (select count(*) from public.v1_doc_folders) > 0 then
    raise exception 'v1_doc_* tables are not empty; not dropping them';
  end if;
end $$;

drop table public.v1_doc_files, public.v1_doc_folders, public.v1_doc_recovery_wraps,
  public.v1_doc_recovery_keys, public.v1_doc_vault_settled, public.v1_doc_vault_keys_old,
  public.v1_doc_vault_grants, public.v1_doc_device_boxes, public.v1_doc_vaults cascade;

drop function public.v1_doc_can_access(text), public.v1_doc_folders_no_delete_receipts(),
  public.v1_doc_grant_ok(uuid, uuid, uuid, uuid), public.v1_doc_recovery_keys_guard(),
  public.v1_doc_rows_guard(), public.v1_doc_scope_allows(text, uuid), public.v1_doc_usage(text),
  public.v1_doc_vault_scope(uuid), public.v1_doc_vaults_guard();
