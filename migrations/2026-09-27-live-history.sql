-- Permanent personal history log (DATA_EXPORT.md §3).
--
-- ⏳ NOT YET APPLIED. Run in the Supabase SQL editor (project noyocjcltrenwdovqrql).
-- Idempotent: safe to re-run. Until it is applied the app keeps working exactly as
-- before — history-log.js detects the missing table, stops sending for the session,
-- and keeps its (bounded) local queue so nothing recorded meanwhile is lost.
--
-- Why a table: the in-state history lists are CAPPED so the synced JSONB sections
-- stay small (media plays 60, article reads 2000, practice events 1000, AI chat 20
-- in localStorage only). Raising those caps would grow every section write (the
-- egress lesson in CLAUDE.md). Instead every entry is ALSO appended here once, and
-- the caps stay as the UI's "recent" window. Append-only, written only on the user's
-- own actions (never polled); read only by "Export my data".
--
-- Security model: strictly per-user (history is personal even inside a household).
--   * SELECT / INSERT / DELETE own rows only (user_id = auth.uid()).
--   * No UPDATE policy (append-only). Re-sending a row is a no-op: the client posts
--     with on_conflict=(user_id,id) + resolution=ignore-duplicates.
-- ARCH §6: RLS on, (select auth.uid()), created_at/updated_at, indexed access path,
-- explicit Data API grants.

create table if not exists public.live_history (
  user_id     uuid not null default auth.uid(),
  id          text not null check (length(id) <= 200),
  kind        text not null check (kind in ('media_play','article_read','practice_event','ai_chat')),
  occurred_at timestamptz not null,
  ref_id      text check (length(ref_id) <= 300),
  title       text check (length(title) <= 500),
  payload     jsonb check (payload is null or pg_column_size(payload) <= 32768),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists live_history_user_time_idx on public.live_history (user_id, occurred_at desc, id);
create index if not exists live_history_user_kind_idx on public.live_history (user_id, kind, occurred_at desc);

alter table public.live_history enable row level security;
grant select, insert, delete on public.live_history to authenticated;
grant select, insert, update, delete on public.live_history to service_role;

drop policy if exists "history read own"   on public.live_history;
drop policy if exists "history insert own" on public.live_history;
drop policy if exists "history delete own" on public.live_history;

create policy "history read own" on public.live_history for select to authenticated
using (user_id = (select auth.uid()));

create policy "history insert own" on public.live_history for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "history delete own" on public.live_history for delete to authenticated
using (user_id = (select auth.uid()));

-- Verify after applying:
--   select polname, cmd from pg_policies where tablename = 'live_history';   -- 3 rows
--   select kind, count(*) from public.live_history group by kind;            -- fills as you use the app
