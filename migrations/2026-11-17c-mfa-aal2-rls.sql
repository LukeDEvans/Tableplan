-- 2026-11-17c — the database enforces the authenticator code (ISSUES P0, 2026-11-09).
--
-- The app keeps itself shut until a session reaches aal2, but table access used
-- to accept an aal1 token, so someone with only the email (or Google/Apple)
-- sign-in could skip the app and call PostgREST directly. Each user table now
-- carries a RESTRICTIVE policy for `authenticated`: the token must be aal2, or
-- the user has no verified MFA factor (people who haven't turned the code on
-- are unaffected). Restrictive policies AND with the existing permissive ones,
-- so nothing gains access; service_role bypasses RLS as before.
--
-- Not covered here (noted in ISSUES): security-definer RPCs (they skip RLS and
-- check auth.uid() themselves) and Storage. Tables with no permissive policy
-- already deny `authenticated` and are skipped.
--
-- Additive and idempotent; applied 2026-11-17 via execute_sql (no DROPs).

create or replace function public.session_meets_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status = 'verified'
      );
$$;
revoke all on function public.session_meets_mfa() from public, anon;
grant execute on function public.session_meets_mfa() to authenticated;

do $$
declare t text;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
      and exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.permissive = 'PERMISSIVE')
      and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'require_mfa_when_enrolled')
  loop
    execute format(
      'create policy require_mfa_when_enrolled on public.%I as restrictive for all to authenticated using ((select public.session_meets_mfa())) with check ((select public.session_meets_mfa()))',
      t);
  end loop;
end $$;
