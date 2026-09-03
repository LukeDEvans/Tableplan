-- Publications foundation — Publication / Feed / canonical Article (Phase 1).
--
-- ⚠️ DESIGN ONLY — NOT APPLIED. This migration is committed as the reviewed schema
-- for the Publications relational store; applying it is a production DB change that
-- is confirmation-gated (CLAUDE.md, ARCHITECTURE.md §16) and OUT OF SCOPE for the
-- Phase 0/1 local implementation. It follows ARCH §6 (id PK, created_at/updated_at,
-- RLS enabled, group-scoped like tableplan_states/eat_recipes, an index for every FK).
--
-- Rationale for relational (not the hot media JSONB): the article library grows
-- indefinitely and is list-queried/paginated/filtered — exactly the §6 promotion
-- criteria the recipes/mail tables already use. Article BODIES are NOT stored here
-- (content store, acquired on demand). Reading/listening progress, playlist
-- membership, notification state, and consumption are SEPARATE concerns and are not
-- columns here.

-- ── publications ──────────────────────────────────────────────────────────────
create table if not exists public.publications (
  id          uuid primary key default gen_random_uuid(),
  group_id    text not null,
  name        text not null,
  key         text not null,                 -- normalized identity (dedupe within a group)
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (group_id, key)
);
create index if not exists publications_group_id_idx on public.publications (group_id);
alter table public.publications enable row level security;
create policy "pub read"   on public.publications for select
  using (group_id in (select g::text from public.live_get_my_group_ids() g));
create policy "pub insert" on public.publications for insert
  with check (group_id in (select g::text from public.live_get_my_group_ids() g));
create policy "pub update" on public.publications for update
  using (group_id in (select g::text from public.live_get_my_group_ids() g))
  with check (group_id in (select g::text from public.live_get_my_group_ids() g));
create policy "pub delete" on public.publications for delete
  using (group_id in (select g::text from public.live_get_my_group_ids() g));

-- ── feeds (a publication has many feeds) ──────────────────────────────────────
create table if not exists public.feeds (
  id              uuid primary key default gen_random_uuid(),
  group_id        text not null,
  publication_id  uuid not null references public.publications(id) on delete cascade,
  url             text not null,
  title           text,
  enabled         boolean not null default true,
  etag            text,                       -- future conditional GET (not used in Phase 1)
  last_modified   text,
  last_fetched_at timestamptz,
  last_success_at timestamptz,
  next_fetch_at   timestamptz,
  error_count     integer not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (group_id, url)
);
create index if not exists feeds_group_id_idx on public.feeds (group_id);
create index if not exists feeds_publication_id_idx on public.feeds (publication_id); -- FK index (§6)
alter table public.feeds enable row level security;
create policy "feed read"   on public.feeds for select
  using (group_id in (select g::text from public.live_get_my_group_ids() g));
create policy "feed insert" on public.feeds for insert
  with check (group_id in (select g::text from public.live_get_my_group_ids() g));
create policy "feed update" on public.feeds for update
  using (group_id in (select g::text from public.live_get_my_group_ids() g))
  with check (group_id in (select g::text from public.live_get_my_group_ids() g));
create policy "feed delete" on public.feeds for delete
  using (group_id in (select g::text from public.live_get_my_group_ids() g));

-- ── articles (canonical; metadata only, no body) ──────────────────────────────
-- feed_ids is an array (many feeds can discover ONE article) — a text[] keeps the
-- model to three tables (§33: no unnecessary join table) and mirrors the client shape.
create table if not exists public.articles (
  id             uuid primary key default gen_random_uuid(),
  group_id       text not null,
  publication_id uuid references public.publications(id) on delete set null,
  feed_ids       text[] not null default '{}',
  guid           text,                        -- source identity (scoped to its feed)
  url            text,
  canonical_url  text,                        -- conservative dedup key (import-canonical)
  title          text not null default '',
  author         text,
  published_at   timestamptz,                 -- ORIGINAL publish date (preserved on update)
  updated_at     timestamptz,                 -- source last-updated (moves on real change)
  description    text,                        -- RSS excerpt (NOT the full body)
  image_url      text,
  category       text,
  discovered_at  timestamptz not null default now(),  -- first seen in Live (preserved)
  created_at     timestamptz not null default now(),
  unique (group_id, canonical_url)            -- one canonical article per group (when a URL exists)
);
create index if not exists articles_group_id_idx on public.articles (group_id);
create index if not exists articles_publication_id_idx on public.articles (publication_id); -- FK index (§6)
create index if not exists articles_group_published_idx on public.articles (group_id, published_at desc); -- paginated "newest first"
alter table public.articles enable row level security;
create policy "art read"   on public.articles for select
  using (group_id in (select g::text from public.live_get_my_group_ids() g));
create policy "art insert" on public.articles for insert
  with check (group_id in (select g::text from public.live_get_my_group_ids() g));
create policy "art update" on public.articles for update
  using (group_id in (select g::text from public.live_get_my_group_ids() g))
  with check (group_id in (select g::text from public.live_get_my_group_ids() g));
create policy "art delete" on public.articles for delete
  using (group_id in (select g::text from public.live_get_my_group_ids() g));
