-- Finance: the nightly bank job runs from Supabase (FINANCE_AUDIT.md A1).
--
-- pg_cron calls the Edge Function `finance-nightly` once a day through pg_net. The
-- function does the bank pull, the bank cache, the transaction store, the balance
-- history and the finance backup (netlify/functions/_finance-nightly.js).
--
-- Why: Netlify's scheduled daily-briefing was being cut off before the bank bridge
-- answered. History and the backup had not been written since 2026-10-07.
--
-- The key that lets the job call the function is made here, inside the database
-- (Supabase Vault), and never leaves it: the function asks finance_nightly_key_ok()
-- whether the key it was sent is the right one.
--
-- Additive only. To stop the job:  select cron.unschedule('finance-nightly');
-- or set the function secret FINANCE_NIGHTLY_DISABLED=1.
--
-- APPLIED to prod 2026-11-12 (Luke: "go ahead with nightly job fix"), through
-- execute_sql, and recorded in supabase_migrations.schema_migrations
-- (20261112180000 finance_nightly).

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'finance_nightly_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'finance_nightly_key',
      'Lets pg_cron call the finance-nightly Edge Function');
  end if;
end $$;

-- Is this the job's key? Only the service role may ask (the Edge Function does).
create or replace function public.finance_nightly_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(length(p_key), 0) >= 32 and exists (
    select 1 from vault.decrypted_secrets s
     where s.name = 'finance_nightly_key' and s.decrypted_secret = p_key);
$$;
revoke all on function public.finance_nightly_key_ok(text) from public;
revoke all on function public.finance_nightly_key_ok(text) from anon, authenticated;
grant execute on function public.finance_nightly_key_ok(text) to service_role;

-- Calls the function with the key. Returns pg_net's request id. Not callable
-- from the app.
create or replace function public.finance_nightly_fire() returns bigint
language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://noyocjcltrenwdovqrql.supabase.co/functions/v1/finance-nightly',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-nightly-key', (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'finance_nightly_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000);
$$;
revoke all on function public.finance_nightly_fire() from public;
revoke all on function public.finance_nightly_fire() from anon, authenticated;
grant execute on function public.finance_nightly_fire() to service_role;

-- 11:40 UTC every day (5:40 am Central in winter, 6:40 am in summer). cron.schedule
-- replaces a job of the same name, so re-running this file is safe.
select cron.schedule('finance-nightly', '40 11 * * *', $cron$select public.finance_nightly_fire()$cron$);
