-- Presentations keep version history like documents (SLIDES_DESIGN.md §7, §12;
-- needs Luke's OK before it's applied). The guard accepted everyday version rows
-- only for kind 'doc' and 'sheet'; it now accepts 'slides' too. Nothing else changes.
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
    if not exists (select 1 from public.doc_pfiles f where f.id = new.file_id and f.scope = new.scope and f.kind in ('doc', 'sheet', 'slides')) then
      raise exception 'version of another scope' using errcode = '42501';
    end if;
  elsif not exists (select 1 from public.doc_files f where f.id = new.file_id and f.scope = new.scope) then
    raise exception 'version of another scope' using errcode = '42501';
  end if;
  new.saved_by := auth.uid();
  new.saved_at := now();
  return new;
end $$;
