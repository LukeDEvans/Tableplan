-- Personal finance accounts: which bank accounts belong to one member only
-- (FINANCE_SPLIT_DESIGN.md §2.2, build step 1).
--
-- Applied to prod 2026-10-20 by Claude via the Supabase MCP execute_sql, after Luke's OK
-- (statements containing DROP were left out: the table was new, so nothing to drop).
-- Idempotent: safe to re-run.
--
-- A row = that SimpleFIN account is Personal to `owner_id`; no row = Household
-- (today's behaviour for every account). The server (simplefin.js, the daily
-- snapshot) reads this before saving or serving any bank data, and sends a
-- personal account only to its owner's cache, transaction store and history.
--
-- Written only by the server (the account move, step 3), so no app can mark an
-- account — or un-mark one — on its own. A member can read their own rows (the
-- Accounts screen shows which of theirs are personal); nobody reads anyone
-- else's. Nothing here reads or changes tableplan_states.

create table if not exists public.live_finance_account_views (
  group_id   uuid not null references public.live_groups (id) on delete cascade,
  linked_id  text not null check (char_length(linked_id) between 1 and 200), -- the SimpleFIN account id
  owner_id   uuid not null references auth.users (id) on delete cascade,
  view       text not null default 'personal' check (view in ('personal')),
  updated_at timestamptz not null default now(),
  primary key (group_id, linked_id)
);

create index if not exists idx_live_finance_account_views_owner on public.live_finance_account_views (owner_id);

alter table public.live_finance_account_views enable row level security;

drop policy if exists "Owners read their personal accounts" on public.live_finance_account_views;
create policy "Owners read their personal accounts"
  on public.live_finance_account_views for select to authenticated
  using (owner_id = (select auth.uid()));

-- No insert / update / delete policies: only the service role writes.
revoke all on public.live_finance_account_views from anon, authenticated;
grant select on public.live_finance_account_views to authenticated;
grant all    on public.live_finance_account_views to service_role;
