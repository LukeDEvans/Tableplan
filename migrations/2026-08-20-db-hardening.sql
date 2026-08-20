-- 2026-08-20 — Database hardening (from the architecture audit).
-- Addresses low/medium Supabase advisor findings WITHOUT changing behavior or the
-- effective authorization model. Idempotent; safe to re-run.
--
-- 1) Covering indexes for foreign keys (perf; purely additive).
-- 2) Pin search_path on 6 SECURITY INVOKER functions. Their bodies already
--    schema-qualify every table (public.*) and use only built-ins (pg_catalog is
--    always searched), so `search_path = ''` is non-breaking + fully hardened.
-- 3) Consolidate tableplan_states RLS: 9 overlapping permissive policies (3 per
--    SELECT/INSERT/UPDATE) → 1 per action. Permissive policies combine with OR,
--    so ORing the SAME three conditions is authz-identical. auth.*() wrapped in
--    (select …) to fix the per-row re-evaluation (auth_rls_initplan). The three
--    conditions are DISTINCT (personal row / u-<uid> rows / group rows) and all
--    are preserved — none is redundant.
-- NOT changed here (intentional — see ARCHITECTURE.md §21 / audit): the 3 live_*
-- SECURITY DEFINER helpers (required by the group RLS policy; must stay EXECUTE-able
-- by authenticated; already search_path=public) and the low-value auth_rls_initplan
-- wraps on tiny (0–229 row) domain tables.

-- ── 1. Foreign-key covering indexes ──────────────────────────────────────────
create index if not exists idx_eat_recipes_folder_id        on public.eat_recipes(folder_id);
create index if not exists idx_live_groups_created_by       on public.live_groups(created_by);
create index if not exists idx_live_group_members_user_id   on public.live_group_members(user_id);
create index if not exists idx_live_group_invites_group_id  on public.live_group_invites(group_id);
create index if not exists idx_live_group_invites_invited_by on public.live_group_invites(invited_by);
create index if not exists idx_live_push_subscriptions_user_id on public.live_push_subscriptions(user_id);

-- ── 2. Function search_path hardening (bodies are public.*-qualified) ─────────
alter function public.mail_claim_sweep(uuid, integer, integer, integer) set search_path = '';
alter function public.mail_mark_done(text[])                             set search_path = '';
alter function public.mail_prune_processed(integer)                      set search_path = '';
alter function public.mail_release_sweep(uuid, text)                     set search_path = '';
alter function public.mail_take_messages(uuid, text[], integer, integer) set search_path = '';
alter function public.tp_protect_finance_merge()                         set search_path = '';

-- ── 3. tableplan_states RLS consolidation (authz-neutral) ─────────────────────
drop policy if exists "Only Luke can read tableplan state"    on public.tableplan_states;
drop policy if exists "Users can read their personal state"   on public.tableplan_states;
drop policy if exists "Group members can read their state"    on public.tableplan_states;
drop policy if exists "Only Luke can create tableplan state"  on public.tableplan_states;
drop policy if exists "Users can create their personal state" on public.tableplan_states;
drop policy if exists "Group members can create their state"  on public.tableplan_states;
drop policy if exists "Only Luke can update tableplan state"  on public.tableplan_states;
drop policy if exists "Users can update their personal state" on public.tableplan_states;
drop policy if exists "Group members can update their state"  on public.tableplan_states;

create policy "state select (owner/user/group)" on public.tableplan_states
  for select to authenticated
  using (
    (id = 'personal' and lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'mrlukedevans@gmail.com')
    or (split_part(id, ':'::text, 1) = ('u-'::text || ((select auth.uid()))::text))
    or (split_part(id, ':'::text, 1) in (select (g.g)::text from public.live_get_my_group_ids() g(g)))
  );

create policy "state insert (owner/user/group)" on public.tableplan_states
  for insert to authenticated
  with check (
    (id = 'personal' and lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'mrlukedevans@gmail.com')
    or (split_part(id, ':'::text, 1) = ('u-'::text || ((select auth.uid()))::text))
    or (split_part(id, ':'::text, 1) in (select (g.g)::text from public.live_get_my_group_ids() g(g)))
  );

create policy "state update (owner/user/group)" on public.tableplan_states
  for update to authenticated
  using (
    (id = 'personal' and lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'mrlukedevans@gmail.com')
    or (split_part(id, ':'::text, 1) = ('u-'::text || ((select auth.uid()))::text))
    or (split_part(id, ':'::text, 1) in (select (g.g)::text from public.live_get_my_group_ids() g(g)))
  )
  with check (
    (id = 'personal' and lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'mrlukedevans@gmail.com')
    or (split_part(id, ':'::text, 1) = ('u-'::text || ((select auth.uid()))::text))
    or (split_part(id, ':'::text, 1) in (select (g.g)::text from public.live_get_my_group_ids() g(g)))
  );
