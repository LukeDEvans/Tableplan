-- News articles (NEWS_PAGE_DESIGN.md §10 — the expanded intake).
--
-- ⚠️ NOT YET APPLIED. Apply in the Supabase SQL editor (or via the MCP at Luke's
-- request) BEFORE deploying the code that reads it — the News page and the mail
-- sweep both use this table once deployed. Idempotent: safe to re-run.
--
-- Why a table (ARCH §6 "promote to relational when large / list-queried"): News now
-- takes every section of four papers' RSS feeds (~300 stories/day, ~1,000 live at the
-- 3-day window) on top of email. Kept in the single mailnews_<user> JSONB row, every
-- page open would download the whole list and every tap would rewrite it (~1 GB/month
-- of egress). As rows: the hourly feed job only inserts new ids, the page reads one
-- page of columns, and read / send / hide touch single rows.
--
-- Security model: service-role only, like the mailnews_* rows it replaces. The client
-- never reads it directly; gmail.js (session-verified) reads/writes on the user's
-- behalf, and the scheduled news-feeds function + mail sweep insert. RLS is on with
-- NO policies, so anon/authenticated get nothing even if a grant slipped in.

create table if not exists public.news_articles (
  user_id       uuid not null,
  id            text not null check (length(id) <= 64),          -- seenId(canonical url)
  url           text not null check (length(url) <= 1000),
  title         text not null check (length(title) <= 300),
  subtitle      text check (subtitle is null or length(subtitle) <= 500),
  image         text check (image is null or length(image) <= 1000),
  paper         text not null check (paper in ('nyt','economist','startribune','athletic')),
  source        text check (source is null or length(source) <= 100),
  section       text not null default 'more' check (length(section) <= 20),
  origin        text not null default 'email' check (origin in ('email','rss')),
  published_at  timestamptz not null,
  discovered_at timestamptz not null default now(),
  lead_at       timestamptz,   -- first article of a paper's main newsletter (Front page lead)
  read_at       timestamptz,
  sent_at       timestamptz,   -- sent to Media → Publications
  hidden_at     timestamptz,   -- hidden: kept as a tombstone until pruned so it never returns
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, id)
);

-- The page's access paths: newest first, optionally by section or paper.
create index if not exists news_articles_user_time_idx
  on public.news_articles (user_id, published_at desc, id) where hidden_at is null;
create index if not exists news_articles_user_section_idx
  on public.news_articles (user_id, section, published_at desc) where hidden_at is null;
create index if not exists news_articles_user_paper_idx
  on public.news_articles (user_id, paper, published_at desc) where hidden_at is null;
-- The hourly prune (all users).
create index if not exists news_articles_published_idx on public.news_articles (published_at);

alter table public.news_articles enable row level security;
grant select, insert, update, delete on public.news_articles to service_role;
revoke all on public.news_articles from anon, authenticated;

-- Sidebar counts in one small call: per (section, paper) unread / total / sent for
-- the live window. Service-role only.
create or replace function public.news_counts(p_user uuid, p_since timestamptz)
returns table (section text, paper text, unread bigint, total bigint, sent bigint)
language sql stable
set search_path = public
as $$
  select a.section, a.paper,
         count(*) filter (where a.read_at is null),
         count(*),
         count(*) filter (where a.sent_at is not null)
  from public.news_articles a
  where a.user_id = p_user and a.hidden_at is null and a.published_at >= p_since
  group by a.section, a.paper
$$;
revoke execute on function public.news_counts(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.news_counts(uuid, timestamptz) to service_role;

-- One-time import of the cards already collected into the old mailnews_<user> rows
-- (the Media bell era). Skips anything already present; malformed cards are ignored.
insert into public.news_articles (user_id, id, url, title, subtitle, image, paper, source, section, origin,
                                  published_at, discovered_at, lead_at, read_at, sent_at)
select substring(s.id from 10)::uuid,
       c->>'id', c->>'url', left(c->>'title', 300), nullif(left(c->>'subtitle', 500), ''),
       -- Old cards' values were never length-capped: a too-long image is dropped (a
       -- cut-off URL is useless), source/section are trimmed, a too-long url skips the
       -- card (below) — so one oversized card can't fail the whole import.
       case when length(c->>'image') between 1 and 1000 then c->>'image' end,
       c->>'paper', left(c->>'source', 100), left(coalesce(nullif(c->>'section', ''), 'more'), 20), 'email',
       coalesce((c->>'publishedAt')::timestamptz, (c->>'discoveredAt')::timestamptz, now()),
       coalesce((c->>'discoveredAt')::timestamptz, now()),
       (c->>'lead')::timestamptz, (c->>'readAt')::timestamptz, (c->>'sentAt')::timestamptz
from public.tableplan_states s
cross join lateral jsonb_array_elements(coalesce(s.state->'newsPending', '[]'::jsonb)) c
where s.id ~ '^mailnews_[0-9a-f-]{36}$'
  and c->>'id' is not null and length(c->>'id') <= 64
  and c->>'url' is not null and length(c->>'url') <= 1000 and c->>'title' is not null
  and c->>'paper' in ('nyt','economist','startribune','athletic')
on conflict (user_id, id) do nothing;

-- Hidden-before-the-move tombstones. In the old rows, dismissing a card removed it
-- from newsPending, so the import above can't know it was hidden — and the RSS intake
-- would bring it back. Every id in the email seen record (mailnewsseen_<user>, the last
-- 30 days) that isn't already a row becomes a hidden placeholder, dated the day it was
-- first seen, so it's pruned with the rest once no intake could call it fresh.
-- Placeholders are never shown: hidden rows are excluded from pages and counts.
insert into public.news_articles (user_id, id, url, title, paper, section, origin, published_at, discovered_at, hidden_at)
select substring(s.id from 14)::uuid, e.key, '', '', 'nyt', 'more', 'email',
       to_timestamp((e.value)::bigint * 86400), to_timestamp((e.value)::bigint * 86400), now()
from public.tableplan_states s
cross join lateral jsonb_each_text(coalesce(s.state->'newsSeen', '{}'::jsonb)) e
where s.id ~ '^mailnewsseen_[0-9a-f-]{36}$'
  and length(e.key) <= 64 and e.value ~ '^[0-9]{1,6}$'
on conflict (user_id, id) do nothing;

-- Verify after applying:
--   select relrowsecurity from pg_class where relname = 'news_articles';        -- t
--   select count(*), min(published_at), max(published_at) from public.news_articles;
--   select * from public.news_counts('<your user id>', now() - interval '4 days');
