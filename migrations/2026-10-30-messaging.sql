-- End-to-end encrypted messaging (MESSAGING_DESIGN.md §8). Step 2.
--
-- The server only ever holds PUBLIC keys and CIPHERTEXT. Plaintext, private keys
-- and session state live on each device. Nothing here touches tableplan_states.
--
-- Who can message whom: people who share a household group (live_group_members)
-- or a business space (live_space_members). msg_can_contact() is the one rule.
--
-- Keys are text (base64url, no padding) so PostgREST hands them to the client
-- as-is; lengths are checked: 32-byte key = 43 chars, 64-byte signature = 86.
--
-- Egress: messages are fetched by an indexed cursor and DELETED on delivery
-- (msg_inbox stays near-empty); key/device reads happen only when a session starts.
-- Additive only: new tables, functions and policies; no DROP.

-- ---- who may contact whom -----------------------------------------------------

create or replace function public.msg_can_contact(p_other uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_other = (select auth.uid())
    or exists (
      select 1 from public.live_group_members a
      join public.live_group_members b on b.group_id = a.group_id
      where a.user_id = (select auth.uid()) and b.user_id = p_other)
    or exists (
      select 1 from public.live_space_members a
      join public.live_space_members b on b.space_id = a.space_id
      where a.user_id = (select auth.uid()) and b.user_id = p_other);
$$;

-- People I can message, with the name their household/space shows for them.
create or replace function public.msg_contacts()
returns table (user_id uuid, display_name text)
language sql stable security definer set search_path = ''
as $$
  select distinct on (u) u, n from (
    select b.user_id as u, nullif(b.display_name, '') as n
      from public.live_group_members a
      join public.live_group_members b on b.group_id = a.group_id
      where a.user_id = (select auth.uid())
    union all
    select b.user_id, nullif(b.display_name, '')
      from public.live_space_members a
      join public.live_space_members b on b.space_id = a.space_id
      where a.user_id = (select auth.uid())
  ) x
  order by u, n nulls last;
$$;

-- ---- identities and devices -------------------------------------------------------

create table if not exists public.msg_identities (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  sign_pub   text not null check (sign_pub ~ '^[A-Za-z0-9_-]{43}$'),
  updated_at timestamptz not null default now()
);

create table if not exists public.msg_devices (
  device_id          uuid primary key,
  user_id            uuid not null references auth.users (id) on delete cascade,
  kind               text not null check (kind in ('phone', 'linked')),
  label              text check (char_length(label) <= 60),
  sign_pub           text not null unique check (sign_pub ~ '^[A-Za-z0-9_-]{43}$'),
  dh_pub             text not null unique check (dh_pub ~ '^[A-Za-z0-9_-]{43}$'),
  created_at_ms      bigint not null check (created_at_ms > 0),
  identity_sig       text not null check (identity_sig ~ '^[A-Za-z0-9_-]{86}$'),
  device_sig         text not null check (device_sig ~ '^[A-Za-z0-9_-]{86}$'),
  spk_id             integer not null check (spk_id >= 0),
  spk_pub            text not null check (spk_pub ~ '^[A-Za-z0-9_-]{43}$'),
  spk_sig            text not null check (spk_sig ~ '^[A-Za-z0-9_-]{86}$'),
  spk_created_at_ms  bigint not null check (spk_created_at_ms > 0),
  last_seen_at       timestamptz not null default now(),
  revoked_at         timestamptz
);
create index if not exists msg_devices_user on public.msg_devices (user_id);

create table if not exists public.msg_prekeys (
  device_id uuid not null references public.msg_devices (device_id) on delete cascade,
  prekey_id integer not null check (prekey_id >= 0),
  pub       text not null check (pub ~ '^[A-Za-z0-9_-]{43}$'),
  primary key (device_id, prekey_id)
);

alter table public.msg_identities enable row level security;
alter table public.msg_devices enable row level security;
alter table public.msg_prekeys enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'msg_identities' and policyname = 'msg identities: read contacts') then
    execute $p$create policy "msg identities: read contacts" on public.msg_identities
  for select to authenticated using ((select public.msg_can_contact(user_id)))$p$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'msg_identities' and policyname = 'msg identities: create own') then
    execute $p$create policy "msg identities: create own" on public.msg_identities
  for insert to authenticated with check (user_id = (select auth.uid()))$p$;
  end if;
end $$;
-- (No update policy: an identity is only replaced through msg_reset_identity, which
-- also revokes every device certified by the old one.)

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'msg_devices' and policyname = 'msg devices: read contacts') then
    execute $p$create policy "msg devices: read contacts" on public.msg_devices
  for select to authenticated using ((select public.msg_can_contact(user_id)))$p$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'msg_devices' and policyname = 'msg devices: add own') then
    execute $p$create policy "msg devices: add own" on public.msg_devices
  for insert to authenticated with check (user_id = (select auth.uid()) and revoked_at is null)$p$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'msg_devices' and policyname = 'msg devices: update own') then
    execute $p$create policy "msg devices: update own" on public.msg_devices
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$p$;
  end if;
end $$;

-- A device's certified keys never change after registration (only its label, signed
-- prekey, last-seen and removal do), and a removed device can't be brought back.
create or replace function public.msg_devices_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.device_id <> old.device_id or new.user_id <> old.user_id or new.kind <> old.kind
     or new.sign_pub <> old.sign_pub or new.dh_pub <> old.dh_pub or new.created_at_ms <> old.created_at_ms
     or new.identity_sig <> old.identity_sig or new.device_sig <> old.device_sig then
    raise exception 'device keys are fixed' using errcode = '42501';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'device was removed' using errcode = '42501';
  end if;
  return new;
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'msg_devices_guard') then
    create trigger msg_devices_guard before update on public.msg_devices
      for each row execute function public.msg_devices_guard();
  end if;
end $$;

-- One-time prekeys: only the owner writes or deletes them; nobody reads them
-- directly — others take one at a time through msg_claim_prekey.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'msg_prekeys' and policyname = 'msg prekeys: add own') then
    execute $p$create policy "msg prekeys: add own" on public.msg_prekeys
  for insert to authenticated with check (
    exists (select 1 from public.msg_devices d where d.device_id = msg_prekeys.device_id and d.user_id = (select auth.uid())))$p$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'msg_prekeys' and policyname = 'msg prekeys: delete own') then
    execute $p$create policy "msg prekeys: delete own" on public.msg_prekeys
  for delete to authenticated using (
    exists (select 1 from public.msg_devices d where d.device_id = msg_prekeys.device_id and d.user_id = (select auth.uid())))$p$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'msg_prekeys' and policyname = 'msg prekeys: count own') then
    execute $p$create policy "msg prekeys: count own" on public.msg_prekeys
  for select to authenticated using (
    exists (select 1 from public.msg_devices d where d.device_id = msg_prekeys.device_id and d.user_id = (select auth.uid())))$p$;
  end if;
end $$;

-- Take (and delete) one one-time prekey of a device I'm allowed to contact. Null when
-- none are left — X3DH then runs without one (MESSAGING_DESIGN.md §4).
create or replace function public.msg_claim_prekey(p_device uuid)
returns table (prekey_id integer, pub text)
language plpgsql security definer set search_path = ''
as $$
declare v_owner uuid;
begin
  select d.user_id into v_owner from public.msg_devices d where d.device_id = p_device and d.revoked_at is null;
  if v_owner is null or not public.msg_can_contact(v_owner) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    delete from public.msg_prekeys p
    where (p.device_id, p.prekey_id) = (
      select k.device_id, k.prekey_id from public.msg_prekeys k
      where k.device_id = p_device order by k.prekey_id limit 1 for update skip locked)
    returning p.prekey_id, p.pub;
end;
$$;

-- Reset (new phone, or "Reset messaging"): replace my identity and revoke every one
-- of my devices; their prekeys and undelivered messages go with them.
create or replace function public.msg_reset_identity(p_sign_pub text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_sign_pub !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'bad key' using errcode = '22023'; end if;
  update public.msg_devices set revoked_at = now() where user_id = v_uid and revoked_at is null;
  delete from public.msg_prekeys p using public.msg_devices d where d.device_id = p.device_id and d.user_id = v_uid;
  delete from public.msg_inbox i using public.msg_devices d where d.device_id = i.recipient_device_id and d.user_id = v_uid;
  insert into public.msg_identities (user_id, sign_pub) values (v_uid, p_sign_pub)
    on conflict (user_id) do update set sign_pub = excluded.sign_pub, updated_at = now();
end;
$$;

-- ---- conversations ---------------------------------------------------------------
-- Routing and access only: the CLIENTS are the authority on membership (§6). Every
-- change goes through these functions, which check the caller is a member and that
-- each person added is someone the caller may contact.

create table if not exists public.msg_conversation_members (
  conversation_id uuid not null,
  user_id         uuid not null references auth.users (id) on delete cascade,
  added_by        uuid references auth.users (id) on delete set null,
  added_at        timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists msg_members_user on public.msg_conversation_members (user_id);
alter table public.msg_conversation_members enable row level security;

create or replace function public.msg_is_member(p_conv uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.msg_conversation_members m
                 where m.conversation_id = p_conv and m.user_id = (select auth.uid()));
$$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'msg_conversation_members' and policyname = 'msg members: read my conversations') then
    execute $p$create policy "msg members: read my conversations" on public.msg_conversation_members
  for select to authenticated using ((select public.msg_is_member(conversation_id)))$p$;
  end if;
end $$;

create or replace function public.msg_create_conversation(p_conv uuid, p_members uuid[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_m uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if exists (select 1 from public.msg_conversation_members where conversation_id = p_conv) then
    raise exception 'conversation exists' using errcode = '23505';
  end if;
  if coalesce(array_length(p_members, 1), 0) > 32 then raise exception 'too many members' using errcode = '22023'; end if;
  insert into public.msg_conversation_members (conversation_id, user_id, added_by) values (p_conv, v_uid, v_uid);
  foreach v_m in array coalesce(p_members, '{}') loop
    if v_m <> v_uid then
      if not public.msg_can_contact(v_m) then raise exception 'not allowed' using errcode = '42501'; end if;
      insert into public.msg_conversation_members (conversation_id, user_id, added_by) values (p_conv, v_m, v_uid)
        on conflict do nothing;
    end if;
  end loop;
end;
$$;

create or replace function public.msg_add_members(p_conv uuid, p_members uuid[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_m uuid;
begin
  if not public.msg_is_member(p_conv) then raise exception 'not a member' using errcode = '42501'; end if;
  if (select count(*) from public.msg_conversation_members where conversation_id = p_conv)
     + coalesce(array_length(p_members, 1), 0) > 33 then raise exception 'too many members' using errcode = '22023'; end if;
  foreach v_m in array coalesce(p_members, '{}') loop
    if not public.msg_can_contact(v_m) then raise exception 'not allowed' using errcode = '42501'; end if;
    insert into public.msg_conversation_members (conversation_id, user_id, added_by) values (p_conv, v_m, v_uid)
      on conflict do nothing;
  end loop;
end;
$$;

-- Any member can remove anyone, or leave (decision 7).
create or replace function public.msg_remove_member(p_conv uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.msg_is_member(p_conv) then raise exception 'not a member' using errcode = '42501'; end if;
  delete from public.msg_conversation_members where conversation_id = p_conv and user_id = p_user;
end;
$$;

-- ---- the inbox --------------------------------------------------------------------

create table if not exists public.msg_inbox (
  id                  bigint generated always as identity primary key,
  recipient_device_id uuid not null references public.msg_devices (device_id) on delete cascade,
  sender_device_id    uuid not null,
  sender_user_id      uuid not null,
  conversation_id     uuid,
  ciphertext          text not null check (char_length(ciphertext) <= 90000),
  created_at          timestamptz not null default now()
);
create index if not exists msg_inbox_recipient on public.msg_inbox (recipient_device_id, id);
create index if not exists msg_inbox_created on public.msg_inbox (created_at);
alter table public.msg_inbox enable row level security;

-- A device reads and acknowledges (deletes) only its own rows. No direct inserts.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'msg_inbox' and policyname = 'msg inbox: read mine') then
    execute $p$create policy "msg inbox: read mine" on public.msg_inbox
  for select to authenticated using (
    exists (select 1 from public.msg_devices d where d.device_id = msg_inbox.recipient_device_id and d.user_id = (select auth.uid())))$p$;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'msg_inbox' and policyname = 'msg inbox: ack mine') then
    execute $p$create policy "msg inbox: ack mine" on public.msg_inbox
  for delete to authenticated using (
    exists (select 1 from public.msg_devices d where d.device_id = msg_inbox.recipient_device_id and d.user_id = (select auth.uid())))$p$;
  end if;
end $$;

-- Send one encrypted message: one row per recipient device, in one call.
-- p_items: [{"device": "<uuid>", "ct": "<base64url>"}, …] (≤ 128 rows).
-- p_conv may be null only when every recipient is one of my own devices (sync).
-- Checks: the sending device is mine and live; I'm a member; each recipient device
-- is live and belongs to a member (or to me); each device's queue stays bounded.
create or replace function public.msg_send(p_conv uuid, p_sender_device uuid, p_items jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item jsonb;
  v_dev uuid;
  v_owner uuid;
  v_n integer := 0;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from public.msg_devices where device_id = p_sender_device and user_id = v_uid and revoked_at is null) then
    raise exception 'not your device' using errcode = '42501';
  end if;
  if p_conv is not null and not public.msg_is_member(p_conv) then raise exception 'not a member' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 128 then
    raise exception 'bad items' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_dev := (v_item ->> 'device')::uuid;
    select user_id into v_owner from public.msg_devices where device_id = v_dev and revoked_at is null;
    if v_owner is null then raise exception 'unknown or removed device %', v_dev using errcode = 'P0002'; end if;
    if v_owner <> v_uid and (p_conv is null or not exists (
         select 1 from public.msg_conversation_members where conversation_id = p_conv and user_id = v_owner)) then
      raise exception 'device % is not in this conversation', v_dev using errcode = '42501';
    end if;
    if (select count(*) from public.msg_inbox where recipient_device_id = v_dev) >= 5000 then
      raise exception 'inbox full for %', v_dev using errcode = '54000';
    end if;
    insert into public.msg_inbox (recipient_device_id, sender_device_id, sender_user_id, conversation_id, ciphertext)
      values (v_dev, p_sender_device, v_uid, p_conv, v_item ->> 'ct');
    v_n := v_n + 1;
  end loop;
  update public.msg_devices set last_seen_at = now() where device_id = p_sender_device;
  return v_n;
end;
$$;

-- Daily cleanup (called by the maintenance function with the service role): rows a
-- device hasn't fetched in 30 days, and prekeys of removed devices.
create or replace function public.msg_prune()
returns void
language sql security definer set search_path = ''
as $$
  delete from public.msg_inbox where created_at < now() - interval '30 days';
  delete from public.msg_prekeys p using public.msg_devices d where d.device_id = p.device_id and d.revoked_at is not null;
$$;

-- ---- grants: authenticated only; never anon ------------------------------------

-- Supabase's default privileges grant every new table to anon AND authenticated with
-- ALL privileges, including TRUNCATE (which ignores row security). Start from
-- nothing and grant back only what each table needs.
revoke all on public.msg_identities, public.msg_devices, public.msg_prekeys,
  public.msg_conversation_members, public.msg_inbox from anon, authenticated, public;
grant select, insert on public.msg_identities to authenticated;
grant select, insert, update on public.msg_devices to authenticated;
grant select, insert, delete on public.msg_prekeys to authenticated;
grant select on public.msg_conversation_members to authenticated;
grant select, delete on public.msg_inbox to authenticated;
grant all on public.msg_identities to service_role;
grant all on public.msg_devices to service_role;
grant all on public.msg_prekeys to service_role;
grant all on public.msg_conversation_members to service_role;
grant all on public.msg_inbox to service_role;

revoke all on function public.msg_can_contact(uuid), public.msg_contacts(), public.msg_claim_prekey(uuid),
  public.msg_reset_identity(text), public.msg_is_member(uuid), public.msg_create_conversation(uuid, uuid[]),
  public.msg_add_members(uuid, uuid[]), public.msg_remove_member(uuid, uuid), public.msg_send(uuid, uuid, jsonb),
  public.msg_prune(), public.msg_devices_guard() from anon, authenticated, public;
grant execute on function public.msg_can_contact(uuid), public.msg_contacts(), public.msg_claim_prekey(uuid),
  public.msg_reset_identity(text), public.msg_is_member(uuid), public.msg_create_conversation(uuid, uuid[]),
  public.msg_add_members(uuid, uuid[]), public.msg_remove_member(uuid, uuid), public.msg_send(uuid, uuid, jsonb)
  to authenticated;
grant execute on function public.msg_prune() to service_role;
