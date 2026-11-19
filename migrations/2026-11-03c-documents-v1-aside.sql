-- Moves the first (empty, never used) Documents tables aside, for when
-- 2026-11-03b-documents-v2.sql can't run its DROPs (this session's Supabase access
-- can't run DROP). Renames only: tables, their indexes and the old functions get a
-- v1_ prefix, then v2 is applied without its DROP lines. The v1_ leftovers are empty
-- and can be dropped later in the SQL editor:
--   drop table public.v1_doc_files, public.v1_doc_folders, public.v1_doc_recovery_wraps,
--     public.v1_doc_recovery_keys, public.v1_doc_vault_settled, public.v1_doc_vault_keys_old,
--     public.v1_doc_vault_grants, public.v1_doc_device_boxes, public.v1_doc_vaults cascade;
-- Applied 2026-11-03 (Luke's OK).
do $$
declare r record;
begin
  if (select count(*) from public.doc_vaults) + (select count(*) from public.doc_files) + (select count(*) from public.doc_device_boxes) > 0 then
    raise exception 'Documents tables are not empty; not moving them aside';
  end if;
  for r in select i.indexname from pg_indexes i where i.schemaname = 'public' and i.tablename like 'doc\_%' loop
    execute format('alter index public.%I rename to %I', r.indexname, 'v1_' || r.indexname);
  end loop;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'doc\_%' loop
    execute format('alter table public.%I rename to %I', r.relname, 'v1_' || r.relname);
  end loop;
  for r in select p.oid::regprocedure::text sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'doc\_%' loop
    execute format('alter function %s rename to %I', r.sig, 'v1_' || r.proname);
  end loop;
end $$;
