-- The word processor (WORD_PROCESSOR_DESIGN.md; Luke, 2026-11-08; this migration OK'd
-- by Luke 2026-11-08 23:20).
--
-- 1. Version history rows. A document keeps a bounded set of snapshots in R2, one per
--    "slot" (§6): h00–h23 (the hour of the last day), d01–d31 (the day of the last
--    month), w00–w52 (the week of the last year), and named versions n<32 hex>. A slot
--    is overwritten when it comes round again, so neither R2 nor these tables grow
--    without bound. One row per (file, slot); the row says when that slot was last
--    written and by whom.
--      doc_pversions — everyday documents (doc_pfiles); name is plain text.
--      doc_sversions — Safe documents (doc_files); name is ciphertext (base64), the
--                      server never sees it.
--    Rows go with their file (on delete cascade, i.e. when the file is purged).
--
-- 2. Live co-editing (§4) uses Supabase Realtime *private* broadcast channels named
--    'livedoc:<scope>:<file id>'. These policies on realtime.messages let only people
--    who may open that scope (doc_can_access) join, send or receive on it. Safe
--    documents send only ciphertext on the same kind of channel.
--
-- Additive only: no DROP; nothing existing changes.

create table if not exists public.doc_pversions (
  file_id   uuid not null references public.doc_pfiles (id) on delete cascade,
  scope     text not null,
  slot      text not null check (slot ~ '^(h(0[0-9]|1[0-9]|2[0-3])|d(0[1-9]|[12][0-9]|3[01])|w([0-4][0-9]|5[0-2])|n[0-9a-f]{32})$'),
  saved_at  timestamptz not null default now(),
  saved_by  uuid,
  name      text check (name is null or char_length(name) <= 120),
  size      integer not null default 0 check (size >= 0),
  primary key (file_id, slot)
);
create index if not exists doc_pversions_scope on public.doc_pversions (scope);

create table if not exists public.doc_sversions (
  file_id   uuid not null references public.doc_files (id) on delete cascade,
  scope     text not null,
  slot      text not null check (slot ~ '^(h(0[0-9]|1[0-9]|2[0-3])|d(0[1-9]|[12][0-9]|3[01])|w([0-4][0-9]|5[0-2])|n[0-9a-f]{32})$'),
  saved_at  timestamptz not null default now(),
  saved_by  uuid,
  name      text check (name is null or char_length(name) <= 1024),
  size      integer not null default 0 check (size >= 0),
  primary key (file_id, slot)
);
create index if not exists doc_sversions_scope on public.doc_sversions (scope);

-- The version's scope must be its file's; the author and time are set here.
create or replace function public.doc_versions_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.file_id <> old.file_id or new.scope <> old.scope or new.slot <> old.slot) then
    raise exception 'version file, scope and slot are fixed' using errcode = '42501';
  end if;
  if tg_table_name = 'doc_pversions' then
    if not exists (select 1 from public.doc_pfiles f where f.id = new.file_id and f.scope = new.scope and f.kind = 'doc') then
      raise exception 'version of another scope' using errcode = '42501';
    end if;
  elsif not exists (select 1 from public.doc_files f where f.id = new.file_id and f.scope = new.scope) then
    raise exception 'version of another scope' using errcode = '42501';
  end if;
  new.saved_by := auth.uid();
  new.saved_at := now();
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'doc_pversions_guard' and tgrelid = 'public.doc_pversions'::regclass) then
    create trigger doc_pversions_guard before insert or update on public.doc_pversions for each row execute function public.doc_versions_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'doc_sversions_guard' and tgrelid = 'public.doc_sversions'::regclass) then
    create trigger doc_sversions_guard before insert or update on public.doc_sversions for each row execute function public.doc_versions_guard();
  end if;
end $$;

alter table public.doc_pversions enable row level security;
alter table public.doc_sversions enable row level security;

do $$
declare p record;
begin
  for p in select * from (values
    ('doc_pversions', 'doc pversions: read mine', $q$for select to authenticated using ((select public.doc_can_access(scope)))$q$),
    ('doc_pversions', 'doc pversions: add mine', $q$for insert to authenticated with check ((select public.doc_can_access(scope)))$q$),
    ('doc_pversions', 'doc pversions: change mine', $q$for update to authenticated using ((select public.doc_can_access(scope))) with check ((select public.doc_can_access(scope)))$q$),
    ('doc_sversions', 'doc sversions: read mine', $q$for select to authenticated using ((select public.doc_can_access(scope)))$q$),
    ('doc_sversions', 'doc sversions: add mine', $q$for insert to authenticated with check ((select public.doc_can_access(scope)))$q$),
    ('doc_sversions', 'doc sversions: change mine', $q$for update to authenticated using ((select public.doc_can_access(scope))) with check ((select public.doc_can_access(scope)))$q$)
  ) as t(tbl, name, body) loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p.tbl and policyname = p.name) then
      execute format('create policy %I on public.%I %s', p.name, p.tbl, p.body);
    end if;
  end loop;
end $$;

revoke all on public.doc_pversions, public.doc_sversions from anon, authenticated;
grant select, insert on public.doc_pversions to authenticated;
grant select, insert on public.doc_sversions to authenticated;
grant update (name, size, saved_at, saved_by) on public.doc_pversions to authenticated;
grant update (name, size, saved_at, saved_by) on public.doc_sversions to authenticated;
grant all on public.doc_pversions to service_role;
grant all on public.doc_sversions to service_role;
revoke all on function public.doc_versions_guard() from public, anon, authenticated;

-- Live co-editing channels (private broadcast + presence).
do $$
declare p record;
begin
  for p in select * from (values
    ('livedoc: members receive', $q$for select to authenticated using (realtime.topic() ~ '^livedoc:[A-Za-z0-9_-]{1,64}:[0-9a-f-]{36}$' and (select public.doc_can_access(split_part(realtime.topic(), ':', 2))))$q$),
    ('livedoc: members send', $q$for insert to authenticated with check (realtime.topic() ~ '^livedoc:[A-Za-z0-9_-]{1,64}:[0-9a-f-]{36}$' and (select public.doc_can_access(split_part(realtime.topic(), ':', 2))))$q$)
  ) as t(name, body) loop
    if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = p.name) then
      execute format('create policy %I on realtime.messages %s', p.name, p.body);
    end if;
  end loop;
end $$;
