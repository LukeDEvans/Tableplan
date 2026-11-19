-- Receipts get their own table (FINANCE_AUDIT D7, D5; Luke 2026-11-12).
--
-- Until now every receipt rode inside the household's `grocery` state row, so the
-- whole row (113 kB and growing with "keep every receipt") was re-sent on each
-- change, and a receipt could only ever be household-wide. Here each receipt is a
-- row, scoped like Document's tables:
--   scope = the household's group id  → both of you
--   scope = 'u-' || auth.uid()        → only you (a Personal purchase)
-- `data` is the receipt record exactly as the app keeps it (receipt-domain.js
-- normalizeReceipt), so nothing about receipts has to be rewritten to move here.
--
-- Additive: nothing is removed from the grocery row. The app reads both and writes
-- here (and, until every device has the new build, still to the grocery row for
-- household receipts). Access is doc_can_access(scope), the same rule as Document.
-- No deletes: a removed receipt keeps its row with deleted_at set, so other
-- devices learn it's gone.

create table if not exists public.fin_receipts (
  id         text primary key check (length(id) between 1 and 200),
  scope      text not null check (length(scope) between 1 and 80),
  data       jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 65536),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists fin_receipts_scope_updated on public.fin_receipts (scope, updated_at);

-- The database sets the author and the times, so "changes since" can be trusted
-- and nobody can backdate a row out of another device's next read.
create or replace function public.fin_receipts_stamp()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := clock_timestamp();
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists fin_receipts_stamp on public.fin_receipts;
create trigger fin_receipts_stamp before insert or update on public.fin_receipts
  for each row execute function public.fin_receipts_stamp();

alter table public.fin_receipts enable row level security;
do $$
declare p record;
begin
  for p in select * from (values
    ('fin receipts: read mine', $q$for select to authenticated using ((select public.doc_can_access(scope)))$q$),
    ('fin receipts: add mine', $q$for insert to authenticated with check ((select public.doc_can_access(scope)))$q$),
    -- Moving a receipt between Household and Personal needs access to both.
    ('fin receipts: change mine', $q$for update to authenticated using ((select public.doc_can_access(scope))) with check ((select public.doc_can_access(scope)))$q$)
  ) as t(name, body) loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fin_receipts' and policyname = p.name) then
      execute format('create policy %I on public.fin_receipts %s', p.name, p.body);
    end if;
  end loop;
end $$;

revoke all on public.fin_receipts from anon, authenticated;
grant select, insert on public.fin_receipts to authenticated;
grant update (scope, data, deleted_at) on public.fin_receipts to authenticated;
grant all on public.fin_receipts to service_role;
revoke all on function public.fin_receipts_stamp() from public, anon, authenticated;

-- One-time copy of the receipts already in each household's grocery row. Their
-- ids are kept, so the app's union-by-id sees one receipt, not two. Re-running
-- inserts nothing new.
insert into public.fin_receipts (id, scope, data)
select r->>'id', split_part(t.id, ':', 1), r
from public.tableplan_states t
cross join lateral jsonb_array_elements(coalesce(t.state->'receipts', '[]'::jsonb)) r
where t.id like '%:grocery'
  and split_part(t.id, ':', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists (select 1 from public.live_groups g where g.id::text = split_part(t.id, ':', 1))
  and coalesce(r->>'id', '') <> ''
  and pg_column_size(r) < 65536
on conflict (id) do nothing;
