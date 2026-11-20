-- Listen: upcoming podcast episodes (PODCAST_UPCOMING_DESIGN.md; Luke, 2026-11-19).
--
-- Once a day pg_cron calls the Edge Function `podcast-upcoming` through pg_net. It
-- reads every saved show's feed URL, asks the show's catalog source (Apple, the
-- only one today) which episodes are announced but not yet free, and writes them
-- to podcast_upcoming. The app reads that table to show "Coming …" rows in a
-- show's panel and to hold a multi-part series out of the queue until its last
-- part is out.
--
-- Rows hold public catalog data only (a feed URL, an episode title, a date) — no
-- user ids. Clients may read them (signed in, MFA met) and never write.
-- podcast_upcoming_sources is the server's cache of each feed's catalog id;
-- clients can't see it.
--
-- The key that lets the job call the function lives in Supabase Vault and never
-- leaves the database (same pattern as finance-nightly).
--
-- Additive only. To stop the job:  select cron.unschedule('podcast-upcoming');
-- or set the function secret PODCAST_UPCOMING_DISABLED=1.
-- To remove the feature: unschedule, then drop the two tables and three functions.
--
-- APPLIED to prod 2026-11-19 (Luke: "Start building now", incl. the table) through
-- execute_sql, recorded as 20261119160000 podcast_upcoming. The schema's default
-- grants had given `authenticated` write privileges; they were revoked right after
-- (the revoke line below covers it on a re-run).

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.podcast_upcoming (
  feed_url      text not null,
  title         text not null,
  expected_at   timestamptz,
  source        text not null,
  fetched_at    timestamptz not null default now(),
  first_seen_at timestamptz not null default now(),
  primary key (feed_url, title)
);

alter table public.podcast_upcoming enable row level security;
revoke all on public.podcast_upcoming from anon, authenticated;
grant select on public.podcast_upcoming to authenticated;
grant all on public.podcast_upcoming to service_role;

create policy podcast_upcoming_read on public.podcast_upcoming
  for select to authenticated using (true);
create policy require_mfa_when_enrolled on public.podcast_upcoming
  as restrictive for all to authenticated
  using ((select public.session_meets_mfa()))
  with check ((select public.session_meets_mfa()));

-- Server-only: each feed's id at the catalog source, and when it was last checked.
create table if not exists public.podcast_upcoming_sources (
  feed_url    text primary key,
  source      text not null,
  source_ref  text,            -- null = the source doesn't list this feed
  checked_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  last_error  text
);
alter table public.podcast_upcoming_sources enable row level security;
revoke all on public.podcast_upcoming_sources from anon, authenticated;
grant all on public.podcast_upcoming_sources to service_role;

-- Every distinct saved show (feed URL + title) across all media rows. Server only.
create or replace function public.podcast_upcoming_feeds()
returns table (feed_url text, title text)
language sql stable security definer set search_path = '' as $$
  select distinct on (p->>'url') p->>'url', coalesce(p->>'title', '')
    from public.tableplan_states t,
         jsonb_array_elements(case when jsonb_typeof(t.state->'podcasts') = 'array' then t.state->'podcasts' else '[]'::jsonb end) p
   where t.id like '%:media' and coalesce(p->>'url', '') like 'http%'
   order by p->>'url', t.updated_at desc;
$$;
revoke all on function public.podcast_upcoming_feeds() from public;
revoke all on function public.podcast_upcoming_feeds() from anon, authenticated;
grant execute on function public.podcast_upcoming_feeds() to service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'podcast_upcoming_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'podcast_upcoming_key',
      'Lets pg_cron call the podcast-upcoming Edge Function');
  end if;
end $$;

create or replace function public.podcast_upcoming_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(length(p_key), 0) >= 32 and exists (
    select 1 from vault.decrypted_secrets s
     where s.name = 'podcast_upcoming_key' and s.decrypted_secret = p_key);
$$;
revoke all on function public.podcast_upcoming_key_ok(text) from public;
revoke all on function public.podcast_upcoming_key_ok(text) from anon, authenticated;
grant execute on function public.podcast_upcoming_key_ok(text) to service_role;

create or replace function public.podcast_upcoming_fire() returns bigint
language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://noyocjcltrenwdovqrql.supabase.co/functions/v1/podcast-upcoming',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-job-key', (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'podcast_upcoming_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000);
$$;
revoke all on function public.podcast_upcoming_fire() from public;
revoke all on function public.podcast_upcoming_fire() from anon, authenticated;
grant execute on function public.podcast_upcoming_fire() to service_role;

-- 09:23 UTC every day (3:23 am Central in winter). Re-running replaces the job.
select cron.schedule('podcast-upcoming', '23 9 * * *', $cron$select public.podcast_upcoming_fire()$cron$);
