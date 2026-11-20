-- Spreadsheets keep version history like documents (SPREADSHEET_DESIGN.md §7, §13;
-- OK'd by Luke 2026-11-09). The word processor's guard accepted everyday version rows
-- only for kind = 'doc'; it now accepts 'sheet' too. Nothing else changes.
--
-- Additive only: create or replace of one function; no DROP.

create or replace function public.doc_versions_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.file_id <> old.file_id or new.scope <> old.scope or new.slot <> old.slot) then
    raise exception 'version file, scope and slot are fixed' using errcode = '42501';
  end if;
  if tg_table_name = 'doc_pversions' then
    if not exists (select 1 from public.doc_pfiles f where f.id = new.file_id and f.scope = new.scope and f.kind in ('doc', 'sheet')) then
      raise exception 'version of another scope' using errcode = '42501';
    end if;
  elsif not exists (select 1 from public.doc_files f where f.id = new.file_id and f.scope = new.scope) then
    raise exception 'version of another scope' using errcode = '42501';
  end if;
  new.saved_by := auth.uid();
  new.saved_at := now();
  return new;
end $$;
