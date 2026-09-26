-- Durable finance transaction store (FINANCE_TRANSACTIONS_DESIGN.md).
--
-- ✅ APPLIED to production 2026-09-26 (project noyocjcltrenwdovqrql) via the Supabase
-- MCP apply_migration ("finance_transactions"), at Luke's request. Verified after
-- applying: RLS on, 3 policies (read/insert/update, authenticated), 6 indexes incl. PK,
-- 1 touch trigger, 0 rows; security advisor shows no new findings. Idempotent: safe
-- to re-run.
--
-- Every transaction the app ever sees — SimpleFIN pulls (server ingest), CSV imports,
-- manual entries — stored once, permanently. `id` is the SAME id the app already keys
-- its JSONB annotations by (financeTxnLabels etc.), so nothing keyed by txn id moves.
--
-- Security model:
--   * Group members READ every row in their group (live_get_my_group_ids(), same as
--     tableplan_states / publications), plus the group-less 'u-<uid>' owner.
--   * Members may INSERT/UPDATE only origin 'csv' / 'manual' rows. 'simplefin' rows are
--     written only by the service-role ingest (bypasses RLS) — a client can never forge
--     or edit a bank transaction, and an upsert can't overwrite one (UPDATE's USING
--     checks the EXISTING row's origin).
--   * No client DELETE policy (fail closed): clients soft-delete via status='deleted',
--     which incremental updated_at sync can see; a hard delete would be invisible to it.
-- ARCH §6: RLS on, (select auth.uid()), created_at/updated_at, indexed access paths
-- (no FKs on this table). Trigger function pins search_path.

create table if not exists public.finance_transactions (
  id            text not null,
  group_id      text not null,
  origin        text not null check (origin in ('simplefin','csv','manual')),
  account_id    text not null,
  posted        timestamptz,
  amount        numeric(12,2) not null,
  description   text not null default '' check (length(description) <= 200),
  pending       boolean not null default false,
  status        text not null default 'active'
                check (status in ('active','superseded','vanished','deleted')),
  superseded_by text,
  import_label  text,
  import_batch  text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (group_id, id)
);

create index if not exists fin_txn_posted_idx  on public.finance_transactions (group_id, posted desc);
create index if not exists fin_txn_updated_idx on public.finance_transactions (group_id, updated_at);
create index if not exists fin_txn_account_idx on public.finance_transactions (group_id, account_id, posted);
create index if not exists fin_txn_status_idx  on public.finance_transactions (group_id, status);
create index if not exists fin_txn_batch_idx   on public.finance_transactions (group_id, import_batch)
  where import_batch is not null;

create or replace function public.finance_transactions_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists finance_transactions_touch on public.finance_transactions;
create trigger finance_transactions_touch before update on public.finance_transactions
for each row execute function public.finance_transactions_touch();

alter table public.finance_transactions enable row level security;

drop policy if exists "fin txn read"   on public.finance_transactions;
drop policy if exists "fin txn insert" on public.finance_transactions;
drop policy if exists "fin txn update" on public.finance_transactions;
drop policy if exists "fin txn delete" on public.finance_transactions;

create policy "fin txn read" on public.finance_transactions for select to authenticated
using (
  group_id in (select g::text from public.live_get_my_group_ids() g)
  or group_id = 'u-' || (select auth.uid())::text
);

create policy "fin txn insert" on public.finance_transactions for insert to authenticated
with check (
  origin in ('csv','manual')
  and (group_id in (select g::text from public.live_get_my_group_ids() g)
       or group_id = 'u-' || (select auth.uid())::text)
);

create policy "fin txn update" on public.finance_transactions for update to authenticated
using (
  origin in ('csv','manual')
  and (group_id in (select g::text from public.live_get_my_group_ids() g)
       or group_id = 'u-' || (select auth.uid())::text)
)
with check (
  origin in ('csv','manual')
  and (group_id in (select g::text from public.live_get_my_group_ids() g)
       or group_id = 'u-' || (select auth.uid())::text)
);

-- Verify after applying:
--   select count(*) from public.finance_transactions;              -- 0 until the ingest runs
--   select polname, cmd from pg_policies where tablename = 'finance_transactions';
