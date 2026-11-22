-- Passwords in the Safe (PASSWORDS_DESIGN.md §4, Luke 2026-11-21).
--
-- One row per login, end-to-end encrypted on the device: the server holds only the
-- ciphertext (`enc`), which vault key version made it, and when it changed. Never a
-- site, a username or a password. Same scopes and access rule as the Safe's
-- documents (doc_can_access): Household logins for the household's members, Personal
-- logins for their owner.
--
--   - the id is made on the device and, like the scope, never changes;
--   - updated_at is set here on every change (devices fetch "changed since");
--   - members can't hard-delete: a login goes to Recently deleted (deleted_at) and
--     safe_purge_login removes it only after 30 days, as doc_purge_file does;
--   - require_mfa_when_enrolled, like every user table since 2026-11-17.
--
-- Additive only: one table, two functions, policies and grants. No DROP.

create table if not exists public.safe_logins (
  id          uuid primary key,
  scope       text not null references public.doc_vaults (scope) on delete cascade,
  key_version integer not null check (key_version >= 1),
  enc         text not null check (enc ~ '^[A-Za-z0-9_-]+$' and char_length(enc) between 100 and 24000),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists safe_logins_scope_updated on public.safe_logins (scope, updated_at);

create or replace function public.safe_logins_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.scope <> old.scope then
      raise exception 'row id and scope are fixed' using errcode = '42501';
    end if;
    if new.created_by is distinct from old.created_by then
      raise exception 'author is fixed' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  else
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'safe_logins_guard' and tgrelid = 'public.safe_logins'::regclass) then
    create trigger safe_logins_guard before insert or update on public.safe_logins for each row execute function public.safe_logins_guard();
  end if;
end $$;

create or replace function public.safe_purge_login(p_id uuid)
returns boolean
language sql volatile security definer set search_path = ''
as $$
  with gone as (
    delete from public.safe_logins l
    where l.id = p_id and public.doc_can_access(l.scope)
      and l.deleted_at is not null and l.deleted_at < now() - interval '30 days'
    returning 1)
  select exists (select 1 from gone);
$$;

alter table public.safe_logins enable row level security;

do $$
declare p record;
begin
  for p in select * from (values
    ('safe logins: read mine', $q$for select to authenticated using ((select public.doc_can_access(scope)))$q$),
    ('safe logins: add mine', $q$for insert to authenticated with check ((select public.doc_can_access(scope)))$q$),
    ('safe logins: change mine', $q$for update to authenticated using ((select public.doc_can_access(scope))) with check ((select public.doc_can_access(scope)))$q$)
  ) as t(name, body) loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'safe_logins' and policyname = p.name) then
      execute format('create policy %I on public.safe_logins %s', p.name, p.body);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'safe_logins' and policyname = 'require_mfa_when_enrolled') then
    create policy require_mfa_when_enrolled on public.safe_logins as restrictive for all to authenticated
      using ((select public.session_meets_mfa())) with check ((select public.session_meets_mfa()));
  end if;
end $$;

-- Supabase's default privileges grant new tables and functions to anon and
-- authenticated; take everything back and grant only what's needed.
revoke all on public.safe_logins from public, anon, authenticated;
grant select, insert on public.safe_logins to authenticated;
grant update (key_version, enc, deleted_at) on public.safe_logins to authenticated;
grant all on public.safe_logins to service_role;

revoke all on function public.safe_logins_guard() from public, anon, authenticated;
revoke all on function public.safe_purge_login(uuid) from public, anon;
grant execute on function public.safe_purge_login(uuid) to authenticated, service_role;
