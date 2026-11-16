-- Photo sync devices (PHOTOS_DESIGN.md §17; Luke, 2026-11-16).
--
-- Lets a phone keep adding photos to its owner's Personal Photos while Liv is closed
-- (iOS background tasks), without holding the person's sign-in. Each phone registers
-- once while Liv is open and signed in, and gets a random secret that only it keeps
-- (the iPhone's Keychain). The database stores a SHA-256 of it.
--
-- A device key can do exactly four things, all through the functions below, which
-- only the server (service_role, i.e. the photo-sync Edge Function) may call:
--   • say which of its photos already have a thumbnail,
--   • add photo records (always into its owner's Personal library) with this phone
--     as their source,
--   • learn which of its photos it may upload a thumbnail for,
--   • mark thumbnails uploaded.
-- It can't read anything else, change a photo it didn't add, or touch any other
-- table. The owner sees their devices and can revoke one (revoking is final).
--
-- Nothing here is Apple-specific: any client that can list photos and make JPEGs
-- (Android, a computer, the Google Takeout import) uses the same calls.
--
-- Additive, plus one change to photo_rows_guard(): an insert keeps the author the
-- caller sets only when there is no signed-in user (the server acting for a device);
-- a signed-in caller is still always the author.

create table if not exists public.photo_sync_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  device_key   text not null check (device_key ~ '^[A-Za-z0-9_-]{1,64}$'),
  name         text not null default '' check (char_length(name) <= 60),
  secret_hash  text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create unique index if not exists photo_sync_devices_one_live on public.photo_sync_devices (user_id, device_key) where revoked_at is null;
create index if not exists photo_sync_devices_user on public.photo_sync_devices (user_id);

-- Revoking is the only change an owner can make, and it can't be undone.
create or replace function public.photo_sync_devices_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.device_key <> old.device_key
     or new.secret_hash <> old.secret_hash or new.created_at <> old.created_at then
    raise exception 'a sync device is fixed' using errcode = '42501';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'a revoked device stays revoked' using errcode = '42501';
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'photo_sync_devices_guard' and tgrelid = 'public.photo_sync_devices'::regclass) then
    create trigger photo_sync_devices_guard before update on public.photo_sync_devices for each row execute function public.photo_sync_devices_guard();
  end if;
end $$;

-- The author: a signed-in caller is always the author; with no signed-in user (the
-- server acting for a device) the author it sets is kept.
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
      new.added_by := coalesce(auth.uid(), new.added_by);
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
      new.added_by := coalesce(auth.uid(), new.added_by);
      new.created_at := now();
    end if;
  end if;
  return new;
end $$;

-- Register a device for a person (the server calls this after checking their
-- sign-in). A device re-registering replaces its earlier key.
create or replace function public.photo_sync_register(p_user uuid, p_device_key text, p_name text, p_secret_hash text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if p_user is null then raise exception 'no user' using errcode = '42501'; end if;
  update public.photo_sync_devices set revoked_at = now()
    where user_id = p_user and device_key = p_device_key and revoked_at is null;
  insert into public.photo_sync_devices (user_id, device_key, name, secret_hash)
    values (p_user, p_device_key, left(coalesce(p_name, ''), 60), p_secret_hash)
    returning id into v_id;
  return v_id;
end $$;

-- The device behind a key, if it's live: its owner and device key.
create or replace function public.photo_sync_device(p_device uuid, p_secret_hash text)
returns table (user_id uuid, device_key text)
language sql volatile security definer set search_path = ''
as $$
  update public.photo_sync_devices d set last_used_at = now()
  where d.id = p_device and d.secret_hash = p_secret_hash and d.revoked_at is null
  returning d.user_id, d.device_key;
$$;

-- Photos this device added (it has a source row for them), among p_ids.
create or replace function public.photo_sync_mine(p_device uuid, p_secret_hash text, p_ids uuid[])
returns table (id uuid, has_thumb boolean)
language sql volatile security definer set search_path = ''
as $$
  with dev as (select * from public.photo_sync_device(p_device, p_secret_hash))
  select i.id, i.has_thumb
  from dev
  join public.photo_items i on i.id = any (p_ids[1:200]) and i.added_by = dev.user_id
  where exists (select 1 from public.photo_sources s where s.photo_id = i.id and s.kind = 'iphone' and s.device_key = dev.device_key);
$$;

-- Add records (always into the owner's Personal library) and this phone as their
-- source. Records that already exist are left alone; a source is added only to a
-- record its owner added. Returns the ids now linked to this device.
create or replace function public.photo_sync_add(p_device uuid, p_secret_hash text, p_items jsonb)
returns setof uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare d record;
begin
  select * into d from public.photo_sync_device(p_device, p_secret_hash);
  if d.user_id is null then raise exception 'unknown device' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then
    raise exception 'bad batch' using errcode = '22023';
  end if;
  insert into public.photo_items (id, scope, kind, is_screenshot, is_live, burst_id, taken_at, width, height, duration,
                                  bytes, lat, lng, favorite, thumb_bytes, added_by)
  select r.id, 'u-' || d.user_id::text, coalesce(r.kind, 'photo'), coalesce(r.is_screenshot, false), coalesce(r.is_live, false),
         r.burst_id, r.taken_at, r.width, r.height, r.duration, r.bytes, r.lat, r.lng, coalesce(r.favorite, false),
         coalesce(r.thumb_bytes, 0), d.user_id
  from jsonb_to_recordset(p_items) as r(id uuid, kind text, is_screenshot boolean, is_live boolean, burst_id text,
       taken_at timestamptz, width integer, height integer, duration real, bytes bigint, lat double precision,
       lng double precision, favorite boolean, thumb_bytes integer, local_id text)
  where r.id is not null
  on conflict (id) do nothing;

  insert into public.photo_sources (photo_id, kind, device_key, local_id, added_by)
  select r.id, 'iphone', d.device_key, r.local_id, d.user_id
  from jsonb_to_recordset(p_items) as r(id uuid, local_id text)
  join public.photo_items i on i.id = r.id and i.added_by = d.user_id
  where r.local_id is not null
  on conflict (kind, device_key, local_id) do nothing;

  return query
    select i.id from public.photo_items i
    join jsonb_to_recordset(p_items) as r(id uuid) on r.id = i.id
    where i.added_by = d.user_id
      and exists (select 1 from public.photo_sources s where s.photo_id = i.id and s.kind = 'iphone' and s.device_key = d.device_key);
end $$;

-- Mark thumbnails uploaded (with their sizes) for photos this device added.
create or replace function public.photo_sync_done(p_device uuid, p_secret_hash text, p_ids uuid[], p_bytes integer[])
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare d record; n integer;
begin
  select * into d from public.photo_sync_device(p_device, p_secret_hash);
  if d.user_id is null then raise exception 'unknown device' using errcode = '42501'; end if;
  if cardinality(p_ids) > 200 or cardinality(p_ids) <> cardinality(p_bytes) then
    raise exception 'bad batch' using errcode = '22023';
  end if;
  update public.photo_items i set has_thumb = true, thumb_bytes = least(greatest(x.b, 0), 2000000)
  from unnest(p_ids, p_bytes) as x(id, b)
  where i.id = x.id and i.added_by = d.user_id
    and exists (select 1 from public.photo_sources s where s.photo_id = i.id and s.kind = 'iphone' and s.device_key = d.device_key);
  get diagnostics n = row_count;
  return n;
end $$;

alter table public.photo_sync_devices enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'photo_sync_devices' and policyname = 'photo sync devices: read own') then
    create policy "photo sync devices: read own" on public.photo_sync_devices for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'photo_sync_devices' and policyname = 'photo sync devices: revoke own') then
    create policy "photo sync devices: revoke own" on public.photo_sync_devices for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;

revoke all on public.photo_sync_devices from anon, authenticated;
grant select (id, device_key, name, created_at, last_used_at, revoked_at) on public.photo_sync_devices to authenticated;
grant update (revoked_at) on public.photo_sync_devices to authenticated;
grant all on public.photo_sync_devices to service_role;

revoke all on function public.photo_sync_devices_guard() from public, anon, authenticated;
revoke all on function public.photo_sync_register(uuid, text, text, text), public.photo_sync_device(uuid, text),
  public.photo_sync_mine(uuid, text, uuid[]), public.photo_sync_add(uuid, text, jsonb),
  public.photo_sync_done(uuid, text, uuid[], integer[]) from public, anon, authenticated;
grant execute on function public.photo_sync_register(uuid, text, text, text), public.photo_sync_device(uuid, text),
  public.photo_sync_mine(uuid, text, uuid[]), public.photo_sync_add(uuid, text, jsonb),
  public.photo_sync_done(uuid, text, uuid[], integer[]) to service_role;
