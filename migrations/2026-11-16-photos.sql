-- Photos, stage 1 (PHOTOS_DESIGN.md §3, build step 2; Luke, 2026-11-16).
--
-- A record of every photo and video, and where its original is; the thumbnail lives
-- in R2 at 'ph/<photo id>/thumb'. No photo bytes ever go into a table, and nothing
-- here touches tableplan_states.
--
-- Scopes are the same as Document's: a household group id (Household Photos) or
-- 'u-<user id>' (Personal Photos), checked by the existing doc_can_access(). Unlike a
-- document, a photo can MOVE between them (decision 5: a camera roll lands in
-- Personal and is then shared into Household): the update policy needs access to the
-- old scope and the new one. The thumbnail's path has no scope in it, so a move
-- copies nothing.
--
-- Deleting is "Recently deleted" for 30 days (decision 11 mirrors Apple's), then
-- photo_purge(). Clients can't hard-delete.
--
-- Additive only: two new tables and their functions. No DROP; nothing existing changes.

create table if not exists public.photo_items (
  id            uuid primary key,                           -- made on the device
  scope         text not null check (scope ~ '^[A-Za-z0-9_-]{1,64}$'),
  kind          text not null default 'photo' check (kind in ('photo', 'video')),
  is_screenshot boolean not null default false,
  is_live       boolean not null default false,             -- a Live Photo (a still plus a short video)
  burst_id      text check (burst_id is null or char_length(burst_id) <= 100),
  taken_at      timestamptz,
  width         integer check (width is null or width between 0 and 100000),
  height        integer check (height is null or height between 0 and 100000),
  duration      real check (duration is null or duration between 0 and 86400), -- seconds, videos
  bytes         bigint check (bytes is null or bytes between 0 and 50000000000), -- size of the original
  lat           double precision check (lat is null or lat between -90 and 90),
  lng           double precision check (lng is null or lng between -180 and 180),
  place_name    text check (place_name is null or char_length(place_name) <= 200),
  content_hash  text check (content_hash is null or content_hash ~ '^[0-9a-f]{16,128}$'), -- later: duplicate matching (§3)
  favorite      boolean not null default false,
  labels        text[] not null default '{}' check (cardinality(labels) <= 50),   -- later: read on the phone (§6)
  body_text     text check (body_text is null or char_length(body_text) <= 20000), -- later: text in the picture
  has_thumb     boolean not null default false,
  thumb_bytes   integer not null default 0 check (thumb_bytes between 0 and 2000000),
  added_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists photo_items_scope_updated on public.photo_items (scope, updated_at);
create index if not exists photo_items_scope_taken on public.photo_items (scope, taken_at desc);

-- Where a photo's original is: an iPhone library (a per-install device key + Apple's
-- local id), a Google Takeout file, an upload, or (stage 2) the home server. One photo
-- can have several; the unique index makes a re-sync safe to repeat.
create table if not exists public.photo_sources (
  id          uuid primary key default gen_random_uuid(),
  photo_id    uuid not null references public.photo_items (id) on delete cascade,
  kind        text not null check (kind in ('iphone', 'google', 'upload', 'home')),
  device_key  text not null check (device_key ~ '^[A-Za-z0-9_-]{1,64}$'),
  local_id    text not null check (char_length(local_id) between 1 and 300),
  added_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  missing_at  timestamptz                                   -- the source no longer has it
);
create unique index if not exists photo_sources_one on public.photo_sources (kind, device_key, local_id);
create index if not exists photo_sources_photo on public.photo_sources (photo_id);

-- May I see this photo? (Its sources and its thumbnail follow it.)
create or replace function public.photo_can_access(p_photo uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.photo_items i where i.id = p_photo and public.doc_can_access(i.scope));
$$;

-- Ids, authors and dates are the database's; a source stays on its photo.
create or replace function public.photo_rows_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_table_name = 'photo_items' then
    if tg_op = 'UPDATE' then
      if new.id <> old.id then raise exception 'photo id is fixed' using errcode = '42501'; end if;
      if new.added_by is distinct from old.added_by then raise exception 'author is fixed' using errcode = '42501'; end if;
      new.created_at := old.created_at;
    else
      new.added_by := auth.uid();
      new.created_at := now();
    end if;
    new.updated_at := now();
  else
    if tg_op = 'UPDATE' then
      if new.id <> old.id or new.photo_id <> old.photo_id or new.kind <> old.kind
         or new.device_key <> old.device_key or new.local_id <> old.local_id
         or new.added_by is distinct from old.added_by then
        raise exception 'a source is fixed' using errcode = '42501';
      end if;
      new.created_at := old.created_at;
    else
      new.added_by := auth.uid();
      new.created_at := now();
    end if;
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'photo_items_guard' and tgrelid = 'public.photo_items'::regclass) then
    create trigger photo_items_guard before insert or update on public.photo_items for each row execute function public.photo_rows_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'photo_sources_guard' and tgrelid = 'public.photo_sources'::regclass) then
    create trigger photo_sources_guard before insert or update on public.photo_sources for each row execute function public.photo_rows_guard();
  end if;
end $$;

-- Recently deleted is the only way out: 30 days, then this (sources go with it).
create or replace function public.photo_purge(p_id uuid)
returns boolean
language sql volatile security definer set search_path = ''
as $$
  with gone as (
    delete from public.photo_items i
    where i.id = p_id and public.doc_can_access(i.scope)
      and i.deleted_at is not null and i.deleted_at < now() - interval '30 days'
    returning 1)
  select exists (select 1 from gone);
$$;

-- For the storage function: may this caller write or read a photo's thumbnail
-- (p_write = false: read; true: upload), or delete it (p_delete)? A thumbnail may be
-- deleted once its photo is purged, or 30 days in Recently deleted. Without a row
-- nobody may upload, so a thumbnail always belongs to a photo someone can see.
create or replace function public.photo_blob_allowed(p_photo uuid, p_delete boolean default false)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case when not p_delete then public.photo_can_access(p_photo)
    else (
      public.photo_can_access(p_photo)
      and exists (select 1 from public.photo_items i where i.id = p_photo
                  and i.deleted_at is not null and i.deleted_at < now() - interval '30 days'))
    end;
$$;

-- Thumbnail storage used in a scope (added to Document's figure for the 7 GB warning).
create or replace function public.photo_usage(p_scope text)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select case when public.doc_can_access(p_scope)
    then coalesce((select sum(thumb_bytes) from public.photo_items where scope = p_scope), 0)::bigint
    else null end;
$$;

alter table public.photo_items enable row level security;
alter table public.photo_sources enable row level security;

do $$
declare p record;
begin
  for p in select * from (values
    ('photo_items', 'photo items: read mine', $q$for select to authenticated using ((select public.doc_can_access(scope)))$q$),
    ('photo_items', 'photo items: add mine', $q$for insert to authenticated with check ((select public.doc_can_access(scope)))$q$),
    ('photo_items', 'photo items: change mine', $q$for update to authenticated using ((select public.doc_can_access(scope))) with check ((select public.doc_can_access(scope)))$q$),
    ('photo_sources', 'photo sources: read mine', $q$for select to authenticated using ((select public.photo_can_access(photo_id)))$q$),
    ('photo_sources', 'photo sources: add mine', $q$for insert to authenticated with check ((select public.photo_can_access(photo_id)))$q$),
    ('photo_sources', 'photo sources: change mine', $q$for update to authenticated using ((select public.photo_can_access(photo_id))) with check ((select public.photo_can_access(photo_id)))$q$)
  ) as t(tbl, name, body) loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p.tbl and policyname = p.name) then
      execute format('create policy %I on public.%I %s', p.name, p.tbl, p.body);
    end if;
  end loop;
end $$;

revoke all on public.photo_items, public.photo_sources from anon, authenticated;
grant select, insert on public.photo_items to authenticated;
grant update (scope, kind, is_screenshot, is_live, burst_id, taken_at, width, height, duration, bytes, lat, lng, place_name,
  content_hash, favorite, labels, body_text, has_thumb, thumb_bytes, deleted_at) on public.photo_items to authenticated;
grant select, insert on public.photo_sources to authenticated;
grant update (missing_at) on public.photo_sources to authenticated;
grant all on public.photo_items, public.photo_sources to service_role;

revoke all on function public.photo_rows_guard() from public, anon, authenticated;
revoke all on function public.photo_can_access(uuid), public.photo_purge(uuid), public.photo_blob_allowed(uuid, boolean),
  public.photo_usage(text) from public, anon;
grant execute on function public.photo_can_access(uuid), public.photo_purge(uuid), public.photo_blob_allowed(uuid, boolean),
  public.photo_usage(text) to authenticated, service_role;
