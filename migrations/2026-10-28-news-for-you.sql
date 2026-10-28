-- News "For you" (NEWS_RANKING_DESIGN.md): story topics + a stored rank on
-- news_articles, and one small per-person interest row.
--
-- ✅ APPLIED to production 2026-10-28 (project noyocjcltrenwdovqrql) via the Supabase
-- MCP execute_sql, with Luke's OK; the revoke ran separately; history row
-- 20261028120000 "news_for_you". Verified afterwards: the three columns exist, the
-- rank index exists, news_interest has RLS on and 0 policies, anon/authenticated
-- have no select or update, service_role can insert; 1,612 existing stories
-- untouched (topics null, skips 0). Additive only (no DROP), safe to re-run. The code works before this is applied
-- (it probes for news_interest and falls back to today's behaviour), so the
-- deploy and this migration can go in either order.
--
-- Security model: same as news_articles — service-role only. gmail.js (session-
-- verified) and the hourly news-feeds job read and write on the user's behalf.
-- RLS on with NO policies, so anon/authenticated get nothing even if a grant slips in.

-- Story features, written once at insert (AI tags, teams, a few keywords) and the
-- rank they gave with the person's interests at that time. topics is capped in code
-- at 16 entries; it is selected only by the For you query, never by other views.
alter table public.news_articles add column if not exists topics text[];
alter table public.news_articles add column if not exists rank_score real;
-- Times the story was shown in For you and scrolled past without being opened
-- (one per visit). At 3 it counts once as "not for me" and leaves For you.
alter table public.news_articles add column if not exists skips smallint not null default 0;

-- For you: the person's unread, unhidden stories by rank.
create index if not exists news_articles_user_rank_idx
  on public.news_articles (user_id, rank_score desc nulls last)
  where hidden_at is null and read_at is null;

-- One row per person: favourite teams (sent by the app when they change, so the
-- feed job never reads tableplan_states), learned weights, mutes.
--   teams     [{ key, scope, name, short, league }]   (≤ 20)
--   teams_sig text the app compares to know whether to re-send its favourites
--   weights   { "<feature>": [weight, updatedAtMs] }  (≤ 400 features, decayed lazily)
--   muted     { "<feature>": mutedAtMs }              (≤ 100)
create table if not exists public.news_interest (
  user_id    uuid primary key references auth.users on delete cascade,
  teams      jsonb not null default '[]'::jsonb,
  teams_sig  text not null default '',
  weights    jsonb not null default '{}'::jsonb,
  muted      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.news_interest enable row level security;
grant select, insert, update, delete on public.news_interest to service_role;
revoke all on public.news_interest from anon, authenticated;
