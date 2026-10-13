-- Google Calendar sync, Phase 1 (GOOGLE_CALENDAR_SYNC_DESIGN.md §3).
-- Isolated from the IO-hot tableplan_states table (egress lesson). Service-role only:
-- only the gcal-* Netlify functions touch these; the browser never reads them.
--
-- gcal_accounts: one Google Calendar connection per app user (refresh token lives
--   here, never in synced state).
-- gcal_links: the authoritative mapping app calendar id ↔ Google calendar id. It is
--   kept server-side (not only on the state.calendars entry) because older deployed
--   clients strip unknown fields from state.calendars entries when they re-save the
--   plan row — the server copy lets new clients re-hydrate the link every time.
--   enabled=false records "user removed this calendar from the app", so automatic
--   discovery of new Google calendars never re-adds it.

create table if not exists public.gcal_accounts (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  google_email  text not null default '',
  refresh_token text not null,
  access_token  text,
  expires_at    timestamptz,
  scopes        text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.gcal_links (
  user_id            uuid not null references auth.users (id) on delete cascade,
  google_calendar_id text not null,
  app_calendar_id    text not null,
  enabled            boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (user_id, google_calendar_id)
);
create index if not exists gcal_links_app_calendar_idx on public.gcal_links (app_calendar_id);

alter table public.gcal_accounts enable row level security;
alter table public.gcal_links    enable row level security;

-- ── Data API grants ─────────────────────────────────────────────────────────
-- Service-role only (Netlify functions): no anon/authenticated grant, no policies.
grant select, insert, update, delete on public.gcal_accounts to service_role;
grant select, insert, update, delete on public.gcal_links    to service_role;

-- This project still auto-grants new public tables to anon/authenticated. RLS (no
-- policies) already blocks them, but these rows hold Google refresh tokens, so the
-- client roles get no table privileges at all.
revoke all on public.gcal_accounts from anon, authenticated;
revoke all on public.gcal_links    from anon, authenticated;
