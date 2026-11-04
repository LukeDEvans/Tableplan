-- Documents: end-to-end encrypted papers (DOCUMENTS_DESIGN.md §3, §6). Step 2.
--
-- SUPERSEDED the same day by 2026-11-03b-documents-v2.sql, which drops these (empty)
-- tables and creates them again with the second review's fixes. Kept as history.
--
-- The server holds only WRAPPED keys, ENCRYPTED names and metadata, signatures and
-- public keys. File contents live in object storage (R2) as ciphertext. Nothing
-- here touches tableplan_states.
--
-- Scopes: Personal = 'u-<uid>' (only that person), Household = the live_groups id
-- as text (its members). doc_can_access(scope) is the one rule for reading and
-- writing a scope's rows.
--
-- The server is NOT trusted for security decisions: removal, key versions and
-- recovery keys are proven on the devices by identity-signed statements
-- (documents/crypto/statements.js). These rules only keep strangers out and stop
-- obvious damage (rewriting history, moving rows between scopes).
--
-- Binary values are text, base64url without padding (32-byte key = 43 chars,
-- 64-byte signature = 86), so PostgREST hands them to the client as-is. (Postgres
-- regexes allow at most 255 repeats, so longer values check length separately.)
-- Additive only: new tables, functions, policies; no DROP.

-- ---- who may use a scope ----------------------------------------------------------

create or replace function public.doc_scope_allows(p_scope text, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_user is not null and (
    p_scope = 'u-' || p_user::text
    or exists (select 1 from public.live_group_members m where m.user_id = p_user and m.group_id::text = p_scope)
  );
$$;

create or replace function public.doc_can_access(p_scope text)
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.doc_scope_allows(p_scope, (select auth.uid())); $$;

-- ---- vaults ---------------------------------------------------------------------------

create table if not exists public.doc_vaults (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null unique check (scope ~ '^[A-Za-z0-9_-]{1,64}$'),
  key_version integer not null default 1 check (key_version >= 1),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- A vault's scope, only for someone who may use it (null otherwise), so a vault id
-- can't be used to learn whose it is.
create or replace function public.doc_vault_scope(p_vault uuid)
returns text
language sql stable security definer set search_path = ''
as $$ select scope from public.doc_vaults where id = p_vault and public.doc_can_access(scope); $$;

-- The version only moves up, one step at a time; the scope never changes.
create or replace function public.doc_vaults_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.id <> old.id or new.scope <> old.scope or new.created_at <> old.created_at then
    raise exception 'vault identity is fixed' using errcode = '42501';
  end if;
  if new.key_version not in (old.key_version, old.key_version + 1) then
    raise exception 'key version only moves up by one' using errcode = '42501';
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'doc_vaults_guard') then
    create trigger doc_vaults_guard before update on public.doc_vaults for each row execute function public.doc_vaults_guard();
  end if;
end $$;

-- ---- device box keys (receive vault keys; one per messaging device) -------------------

create table if not exists public.doc_device_boxes (
  device_id  uuid primary key references public.msg_devices (device_id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  box_pub    text not null unique check (box_pub ~ '^[A-Za-z0-9_-]{43}$'),
  box_sig    text not null check (box_sig ~ '^[A-Za-z0-9_-]{86}$'),
  created_at timestamptz not null default now()
);
create index if not exists doc_device_boxes_user on public.doc_device_boxes (user_id);

-- ---- grants: a vault key sealed to one device --------------------------------------

create table if not exists public.doc_vault_grants (
  vault_id          uuid not null references public.doc_vaults (id) on delete cascade,
  key_version       integer not null check (key_version >= 1),
  device_id         uuid not null references public.msg_devices (device_id) on delete cascade,
  sealed            text not null check (sealed ~ '^[A-Za-z0-9_-]+$' and char_length(sealed) between 60 and 1200),
  granter_user_id   uuid not null references auth.users (id) on delete cascade,
  granter_device_id uuid not null,
  granter_sig       text not null check (granter_sig ~ '^[A-Za-z0-9_-]{86}$'),
  created_at        timestamptz not null default now(),
  primary key (vault_id, key_version, device_id)
);
create index if not exists doc_vault_grants_device on public.doc_vault_grants (device_id);

-- A grant is written by a member, from one of their own live devices, to a live
-- device whose owner may hold the scope. (The recipient still verifies the
-- signature against the granter's pinned identity; this only keeps junk out.)
create or replace function public.doc_grant_ok(p_vault uuid, p_device uuid, p_granter_user uuid, p_granter_device uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_granter_user = (select auth.uid())
    and public.doc_can_access(public.doc_vault_scope(p_vault))
    and exists (select 1 from public.msg_devices d where d.device_id = p_granter_device and d.user_id = p_granter_user and d.revoked_at is null)
    and exists (select 1 from public.msg_devices d where d.device_id = p_device and d.revoked_at is null
                and public.doc_scope_allows(public.doc_vault_scope(p_vault), d.user_id));
$$;

-- ---- older vault keys (v wrapped under v+1) -----------------------------------------

create table if not exists public.doc_vault_keys_old (
  vault_id    uuid not null references public.doc_vaults (id) on delete cascade,
  key_version integer not null check (key_version >= 1),
  wrapped     text not null check (wrapped ~ '^[A-Za-z0-9_-]{90,120}$'),
  created_at  timestamptz not null default now(),
  primary key (vault_id, key_version)
);

-- ---- vault settled: identity-signed, with removed devices -----------------------------

create table if not exists public.doc_vault_settled (
  vault_id           uuid not null references public.doc_vaults (id) on delete cascade,
  key_version        integer not null check (key_version >= 1),
  signer_user_id     uuid not null references auth.users (id) on delete cascade,
  removed_device_ids uuid[] not null default '{}' check (cardinality(removed_device_ids) <= 500),
  sig                text not null check (sig ~ '^[A-Za-z0-9_-]{86}$'),
  created_at         timestamptz not null default now(),
  primary key (vault_id, key_version)
);

-- ---- recovery ---------------------------------------------------------------------------

create table if not exists public.doc_recovery_keys (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  generation   integer not null check (generation >= 1),
  recovery_pub text not null check (recovery_pub ~ '^[A-Za-z0-9_-]{43}$'),
  params       text not null check (params ~ '^[A-Za-z0-9_-]{34}$'),
  sig          text not null check (sig ~ '^[A-Za-z0-9_-]{86}$'),
  updated_at   timestamptz not null default now()
);

-- A new recovery key replaces the old one only with a higher generation.
create or replace function public.doc_recovery_keys_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.user_id <> old.user_id then raise exception 'recovery owner is fixed' using errcode = '42501'; end if;
  if new.generation <= old.generation then raise exception 'recovery generation only moves up' using errcode = '42501'; end if;
  new.updated_at := now();
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'doc_recovery_keys_guard') then
    create trigger doc_recovery_keys_guard before update on public.doc_recovery_keys for each row execute function public.doc_recovery_keys_guard();
  end if;
end $$;

create table if not exists public.doc_recovery_wraps (
  user_id     uuid not null references auth.users (id) on delete cascade,
  vault_id    uuid not null references public.doc_vaults (id) on delete cascade,
  key_version integer not null check (key_version >= 1),
  kind        text not null check (kind in ('anchor', 'sealed')),
  wrapped     text not null check (wrapped ~ '^[A-Za-z0-9_-]+$' and char_length(wrapped) between 90 and 1200),
  created_at  timestamptz not null default now(),
  primary key (user_id, vault_id, key_version, kind)
);

-- ---- folders and files -----------------------------------------------------------------

create table if not exists public.doc_folders (
  id          uuid primary key,
  scope       text not null references public.doc_vaults (scope) on delete cascade,
  enc_name    text not null check (enc_name ~ '^[A-Za-z0-9_-]+$' and char_length(enc_name) between 120 and 800),
  key_version integer not null check (key_version >= 1),
  kind        text not null default 'user' check (kind in ('user', 'receipts')),
  sort        integer not null default 0,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists doc_folders_scope_updated on public.doc_folders (scope, updated_at);
create unique index if not exists doc_folders_one_receipts on public.doc_folders (scope) where kind = 'receipts';

create table if not exists public.doc_files (
  id          uuid primary key,                            -- made on the device (offline capture)
  scope       text not null references public.doc_vaults (scope) on delete cascade,
  folder_id   uuid references public.doc_folders (id) on delete set null,
  wrapped_key text not null check (wrapped_key ~ '^[A-Za-z0-9_-]{90,120}$'),
  key_version integer not null check (key_version >= 1),
  enc_meta    text not null check (enc_meta ~ '^[A-Za-z0-9_-]+$' and char_length(enc_meta) between 100 and 24000),
  parts       text[] not null default '{content}' check (parts <@ array['content', 'thumb', 'text']::text[] and 'content' = any (parts)),
  size        bigint not null check (size >= 0 and size <= 80000000),  -- ciphertext bytes, all parts
  backend     text not null default 'r2' check (backend in ('r2', 'home')),
  added_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists doc_files_scope_updated on public.doc_files (scope, updated_at);
create index if not exists doc_files_folder on public.doc_files (folder_id);

-- Rows stay in their scope, keep their id, and get a fresh updated_at on every change
-- (devices fetch "changed since"). The Receipts folder can't be renamed away into a
-- plain folder or put in Recently deleted. A file's folder must be in its scope.
create or replace function public.doc_rows_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.scope <> old.scope then
      raise exception 'row id and scope are fixed' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  if tg_table_name = 'doc_folders' then
    if tg_op = 'UPDATE' and old.kind = 'receipts' and (new.kind <> 'receipts' or new.deleted_at is not null) then
      raise exception 'the Receipts folder stays' using errcode = '42501';
    end if;
  else
    if new.folder_id is not null and not exists (select 1 from public.doc_folders f where f.id = new.folder_id and f.scope = new.scope) then
      raise exception 'folder is in another scope' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'doc_folders_guard') then
    create trigger doc_folders_guard before insert or update on public.doc_folders for each row execute function public.doc_rows_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'doc_files_guard') then
    create trigger doc_files_guard before insert or update on public.doc_files for each row execute function public.doc_rows_guard();
  end if;
end $$;

create or replace function public.doc_folders_no_delete_receipts()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.kind = 'receipts' and current_setting('role', true) <> 'service_role' then
    raise exception 'the Receipts folder stays' using errcode = '42501';
  end if;
  return old;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'doc_folders_keep_receipts') then
    create trigger doc_folders_keep_receipts before delete on public.doc_folders for each row execute function public.doc_folders_no_delete_receipts();
  end if;
end $$;

-- Storage used by a scope (ciphertext bytes), for the 7 GB warning (§12).
create or replace function public.doc_usage(p_scope text)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select case when public.doc_can_access(p_scope)
    then coalesce((select sum(size) from public.doc_files where scope = p_scope), 0)::bigint
    else null end;
$$;

-- ---- row security -------------------------------------------------------------------------

alter table public.doc_vaults enable row level security;
alter table public.doc_device_boxes enable row level security;
alter table public.doc_vault_grants enable row level security;
alter table public.doc_vault_keys_old enable row level security;
alter table public.doc_vault_settled enable row level security;
alter table public.doc_recovery_keys enable row level security;
alter table public.doc_recovery_wraps enable row level security;
alter table public.doc_folders enable row level security;
alter table public.doc_files enable row level security;

do $$
declare p record;
begin
  for p in select * from (values
    ('doc_vaults', 'doc vaults: read mine', $q$for select to authenticated using ((select public.doc_can_access(scope)))$q$),
    ('doc_vaults', 'doc vaults: create mine', $q$for insert to authenticated with check ((select public.doc_can_access(scope)) and key_version = 1)$q$),
    ('doc_vaults', 'doc vaults: rotate mine', $q$for update to authenticated using ((select public.doc_can_access(scope))) with check ((select public.doc_can_access(scope)))$q$),

    ('doc_device_boxes', 'doc boxes: read contacts', $q$for select to authenticated using ((select public.msg_can_contact(user_id)))$q$),
    ('doc_device_boxes', 'doc boxes: add own', $q$for insert to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.msg_devices d where d.device_id = doc_device_boxes.device_id and d.user_id = (select auth.uid()) and d.revoked_at is null))$q$),
    ('doc_device_boxes', 'doc boxes: remove own', $q$for delete to authenticated using (user_id = (select auth.uid()))$q$),

    ('doc_vault_grants', 'doc grants: read in my vaults', $q$for select to authenticated using ((select public.doc_can_access(public.doc_vault_scope(vault_id))))$q$),
    ('doc_vault_grants', 'doc grants: give', $q$for insert to authenticated with check ((select public.doc_grant_ok(vault_id, device_id, granter_user_id, granter_device_id)))$q$),
    ('doc_vault_grants', 'doc grants: withdraw in my vaults', $q$for delete to authenticated using ((select public.doc_can_access(public.doc_vault_scope(vault_id))))$q$),

    ('doc_vault_keys_old', 'doc old keys: read mine', $q$for select to authenticated using ((select public.doc_can_access(public.doc_vault_scope(vault_id))))$q$),
    ('doc_vault_keys_old', 'doc old keys: add mine', $q$for insert to authenticated with check ((select public.doc_can_access(public.doc_vault_scope(vault_id))))$q$),

    ('doc_vault_settled', 'doc settled: read mine', $q$for select to authenticated using ((select public.doc_can_access(public.doc_vault_scope(vault_id))))$q$),
    ('doc_vault_settled', 'doc settled: add mine', $q$for insert to authenticated with check (signer_user_id = (select auth.uid()) and (select public.doc_can_access(public.doc_vault_scope(vault_id))))$q$),

    ('doc_recovery_keys', 'doc recovery keys: read own', $q$for select to authenticated using (user_id = (select auth.uid()))$q$),
    ('doc_recovery_keys', 'doc recovery keys: add own', $q$for insert to authenticated with check (user_id = (select auth.uid()))$q$),
    ('doc_recovery_keys', 'doc recovery keys: replace own', $q$for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$q$),

    ('doc_recovery_wraps', 'doc recovery wraps: read own', $q$for select to authenticated using (user_id = (select auth.uid()))$q$),
    ('doc_recovery_wraps', 'doc recovery wraps: add own', $q$for insert to authenticated with check (user_id = (select auth.uid()) and (select public.doc_can_access(public.doc_vault_scope(vault_id))))$q$),
    ('doc_recovery_wraps', 'doc recovery wraps: remove own', $q$for delete to authenticated using (user_id = (select auth.uid()))$q$),

    ('doc_folders', 'doc folders: read mine', $q$for select to authenticated using ((select public.doc_can_access(scope)))$q$),
    ('doc_folders', 'doc folders: add mine', $q$for insert to authenticated with check ((select public.doc_can_access(scope)))$q$),
    ('doc_folders', 'doc folders: change mine', $q$for update to authenticated using ((select public.doc_can_access(scope))) with check ((select public.doc_can_access(scope)))$q$),
    ('doc_folders', 'doc folders: remove mine', $q$for delete to authenticated using ((select public.doc_can_access(scope)))$q$),

    ('doc_files', 'doc files: read mine', $q$for select to authenticated using ((select public.doc_can_access(scope)))$q$),
    ('doc_files', 'doc files: add mine', $q$for insert to authenticated with check ((select public.doc_can_access(scope)))$q$),
    ('doc_files', 'doc files: change mine', $q$for update to authenticated using ((select public.doc_can_access(scope))) with check ((select public.doc_can_access(scope)))$q$),
    ('doc_files', 'doc files: remove mine', $q$for delete to authenticated using ((select public.doc_can_access(scope)))$q$)
  ) as t(tbl, name, body) loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p.tbl and policyname = p.name) then
      execute format('create policy %I on public.%I %s', p.name, p.tbl, p.body);
    end if;
  end loop;
end $$;

-- ---- privileges --------------------------------------------------------------------------
-- Supabase's default privileges grant new tables and functions to anon and
-- authenticated; take everything back and grant only what each needs.

revoke all on public.doc_vaults, public.doc_device_boxes, public.doc_vault_grants, public.doc_vault_keys_old,
  public.doc_vault_settled, public.doc_recovery_keys, public.doc_recovery_wraps, public.doc_folders, public.doc_files
  from anon, authenticated;

grant select, insert on public.doc_vaults to authenticated;
grant update (key_version) on public.doc_vaults to authenticated;
grant select, insert, delete on public.doc_device_boxes to authenticated;
grant select, insert, delete on public.doc_vault_grants to authenticated;
grant select, insert on public.doc_vault_keys_old to authenticated;
grant select, insert on public.doc_vault_settled to authenticated;
grant select, insert on public.doc_recovery_keys to authenticated;
grant update (generation, recovery_pub, params, sig) on public.doc_recovery_keys to authenticated;
grant select, insert, delete on public.doc_recovery_wraps to authenticated;
grant select, insert, delete on public.doc_folders to authenticated;
grant update (enc_name, key_version, sort, deleted_at) on public.doc_folders to authenticated;
grant select, insert, delete on public.doc_files to authenticated;
grant update (folder_id, wrapped_key, key_version, enc_meta, parts, size, backend, deleted_at) on public.doc_files to authenticated;

grant all on public.doc_vaults to service_role;
grant all on public.doc_device_boxes to service_role;
grant all on public.doc_vault_grants to service_role;
grant all on public.doc_vault_keys_old to service_role;
grant all on public.doc_vault_settled to service_role;
grant all on public.doc_recovery_keys to service_role;
grant all on public.doc_recovery_wraps to service_role;
grant all on public.doc_folders to service_role;
grant all on public.doc_files to service_role;

-- doc_scope_allows answers for any person, so only the definer functions use it.
revoke all on function public.doc_scope_allows(text, uuid) from public, anon, authenticated;
grant execute on function public.doc_scope_allows(text, uuid) to service_role;
revoke all on function public.doc_can_access(text), public.doc_vault_scope(uuid),
  public.doc_grant_ok(uuid, uuid, uuid, uuid), public.doc_usage(text) from public, anon;
grant execute on function public.doc_can_access(text), public.doc_vault_scope(uuid),
  public.doc_grant_ok(uuid, uuid, uuid, uuid), public.doc_usage(text) to authenticated, service_role;
revoke all on function public.doc_vaults_guard(), public.doc_recovery_keys_guard(), public.doc_rows_guard(),
  public.doc_folders_no_delete_receipts() from public, anon, authenticated;
