-- Everyday documents (DOCUMENTS_DESIGN.md §25; Luke, 2026-11-04).
--
-- The Document page has two parts: everyday documents, kept like the rest of Live
-- (protected by sign-in and row security, readable by the server, no Face ID), and
-- the Safe (the end-to-end encrypted doc_ vaults, unchanged). These are the
-- everyday tables. Same scopes as the Safe: a household group id, or 'u-<user id>'.
--
-- Files live in the same R2 bucket under 'p/<scope>/<file id>/<part>', signed by
-- doc-storage after doc_can_access (and doc_pblob_deletable for deletes).
--
-- kind leaves room for the editors to come (a document, a spreadsheet, slides),
-- whose content will be a 'content' part like any file's.
--
-- Additive only: no DROP, nothing in the doc_ vault tables changes.

create table if not exists public.doc_pfolders (
  id          uuid primary key,
  scope       text not null check (scope ~ '^[A-Za-z0-9_-]{1,64}$'),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  kind        text not null default 'user' check (kind in ('user', 'receipts')),
  sort        integer not null default 0,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists doc_pfolders_scope on public.doc_pfolders (scope, updated_at);
create unique index if not exists doc_pfolders_one_receipts on public.doc_pfolders (scope) where kind = 'receipts';

create table if not exists public.doc_pfiles (
  id          uuid primary key,                            -- made on the device
  scope       text not null check (scope ~ '^[A-Za-z0-9_-]{1,64}$'),
  folder_id   uuid references public.doc_pfolders (id) on delete set null,
  kind        text not null default 'file' check (kind in ('file', 'doc', 'sheet', 'slides')),
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  mime        text not null default 'application/octet-stream' check (char_length(mime) <= 120),
  doc_date    date,
  tags        text[] not null default '{}' check (cardinality(tags) <= 20),
  page_count  integer check (page_count is null or page_count between 0 and 10000),
  body_text   text check (body_text is null or char_length(body_text) <= 100000), -- scanned / extracted text, for search
  parts       text[] not null default '{content}' check (parts <@ array['content', 'thumb']::text[] and 'content' = any (parts)),
  size        bigint not null check (size >= 0 and size <= 80000000),
  source      jsonb,                                       -- e.g. { "receiptId": … } for a filed receipt
  backend     text not null default 'r2' check (backend in ('r2', 'home')),
  added_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists doc_pfiles_scope on public.doc_pfiles (scope, updated_at);
create index if not exists doc_pfiles_folder on public.doc_pfiles (folder_id);

-- Rows keep their id and scope; authors are set by the database; the Receipts
-- folder stays; a file's folder is in its scope.
create or replace function public.doc_prows_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.scope <> old.scope then
      raise exception 'row id and scope are fixed' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.updated_at := now();
  if tg_table_name = 'doc_pfolders' then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      if new.kind = 'receipts' and new.deleted_at is not null then
        raise exception 'the Receipts folder stays' using errcode = '42501';
      end if;
    elsif old.kind = 'receipts' and (new.kind <> 'receipts' or new.deleted_at is not null) then
      raise exception 'the Receipts folder stays' using errcode = '42501';
    elsif new.created_by is distinct from old.created_by then
      raise exception 'author is fixed' using errcode = '42501';
    end if;
  else
    if tg_op = 'INSERT' then
      new.added_by := auth.uid();
    elsif new.added_by is distinct from old.added_by then
      raise exception 'author is fixed' using errcode = '42501';
    end if;
    if new.folder_id is not null and not exists (select 1 from public.doc_pfolders f where f.id = new.folder_id and f.scope = new.scope) then
      raise exception 'folder is in another scope' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'doc_pfolders_guard' and tgrelid = 'public.doc_pfolders'::regclass) then
    create trigger doc_pfolders_guard before insert or update on public.doc_pfolders for each row execute function public.doc_prows_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'doc_pfiles_guard' and tgrelid = 'public.doc_pfiles'::regclass) then
    create trigger doc_pfiles_guard before insert or update on public.doc_pfiles for each row execute function public.doc_prows_guard();
  end if;
end $$;

-- Recently deleted is the only way out, as in the Safe: 30 days, then these.
create or replace function public.doc_ppurge_file(p_id uuid)
returns boolean
language sql volatile security definer set search_path = ''
as $$
  with gone as (
    delete from public.doc_pfiles f
    where f.id = p_id and public.doc_can_access(f.scope)
      and f.deleted_at is not null and f.deleted_at < now() - interval '30 days'
    returning 1)
  select exists (select 1 from gone);
$$;

create or replace function public.doc_ppurge_folder(p_id uuid)
returns boolean
language sql volatile security definer set search_path = ''
as $$
  with gone as (
    delete from public.doc_pfolders f
    where f.id = p_id and f.kind <> 'receipts' and public.doc_can_access(f.scope)
      and f.deleted_at is not null and f.deleted_at < now() - interval '30 days'
    returning 1)
  select exists (select 1 from gone);
$$;

-- For doc-storage: may this caller delete an everyday file's blobs?
create or replace function public.doc_pblob_deletable(p_scope text, p_file uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.doc_can_access(p_scope) and (
    not exists (select 1 from public.doc_pfiles f where f.id = p_file)
    or exists (select 1 from public.doc_pfiles f where f.id = p_file and f.scope = p_scope
               and f.deleted_at is not null and f.deleted_at < now() - interval '30 days'));
$$;

-- Storage used by a scope, Safe and everyday together (the 7 GB warning, §12).
create or replace function public.doc_usage_all(p_scope text)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select case when public.doc_can_access(p_scope)
    then (coalesce((select sum(size) from public.doc_files where scope = p_scope), 0)
        + coalesce((select sum(size) from public.doc_pfiles where scope = p_scope), 0))::bigint
    else null end;
$$;

alter table public.doc_pfolders enable row level security;
alter table public.doc_pfiles enable row level security;

do $$
declare p record;
begin
  for p in select * from (values
    ('doc_pfolders', 'doc pfolders: read mine', $q$for select to authenticated using ((select public.doc_can_access(scope)))$q$),
    ('doc_pfolders', 'doc pfolders: add mine', $q$for insert to authenticated with check ((select public.doc_can_access(scope)))$q$),
    ('doc_pfolders', 'doc pfolders: change mine', $q$for update to authenticated using ((select public.doc_can_access(scope))) with check ((select public.doc_can_access(scope)))$q$),
    ('doc_pfiles', 'doc pfiles: read mine', $q$for select to authenticated using ((select public.doc_can_access(scope)))$q$),
    ('doc_pfiles', 'doc pfiles: add mine', $q$for insert to authenticated with check ((select public.doc_can_access(scope)))$q$),
    ('doc_pfiles', 'doc pfiles: change mine', $q$for update to authenticated using ((select public.doc_can_access(scope))) with check ((select public.doc_can_access(scope)))$q$)
  ) as t(tbl, name, body) loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p.tbl and policyname = p.name) then
      execute format('create policy %I on public.%I %s', p.name, p.tbl, p.body);
    end if;
  end loop;
end $$;

revoke all on public.doc_pfolders, public.doc_pfiles from anon, authenticated;
grant select, insert on public.doc_pfolders to authenticated;
grant update (name, sort, deleted_at) on public.doc_pfolders to authenticated;
grant select, insert on public.doc_pfiles to authenticated;
grant update (folder_id, name, mime, doc_date, tags, page_count, body_text, parts, size, source, deleted_at) on public.doc_pfiles to authenticated;
grant all on public.doc_pfolders to service_role;
grant all on public.doc_pfiles to service_role;

revoke all on function public.doc_prows_guard() from public, anon, authenticated;
revoke all on function public.doc_ppurge_file(uuid), public.doc_ppurge_folder(uuid), public.doc_pblob_deletable(text, uuid),
  public.doc_usage_all(text) from public, anon;
grant execute on function public.doc_ppurge_file(uuid), public.doc_ppurge_folder(uuid), public.doc_pblob_deletable(text, uuid),
  public.doc_usage_all(text) to authenticated, service_role;
