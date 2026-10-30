-- Messaging, second migration: server-side limits from the app-layer review
-- (MESSAGING_DESIGN.md §18, findings 9 and 14). Additive only — no DROP — so it can be
-- applied through execute_sql (CLAUDE.md "Applying DB changes") and re-run safely.
--
--   1. msg_send: each ciphertext ≤ 32768 characters (the largest real envelope — a
--      4000-character text or a 500-id receipt, padded and base64 — is ~27k); a
--      device's queue holds at most 2000 waiting rows (was 5000); and each person may
--      queue at most 3000 rows an hour (one row per recipient device).
--   2. msg_claim_prekey: at most 200 claims an hour per person, so nobody can drain a
--      contact's one-time prekeys.
--   3. last_seen_at is no longer readable by other people (column grants): it said
--      when each of your devices was last used. The app never reads it.

create table if not exists public.msg_rate (
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('send', 'claim')),
  window_start timestamptz not null default now(),
  n            integer not null default 0,
  primary key (user_id, kind)
);
alter table public.msg_rate enable row level security;
-- No policies: only the security-definer functions below touch it.
revoke all on public.msg_rate from anon, authenticated, public;
grant all on public.msg_rate to service_role;

-- Count `p_n` against the caller's hourly budget for `p_kind`; raise when over.
create or replace function public.msg_rate_take(p_kind text, p_n integer, p_limit integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_n integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  insert into public.msg_rate as r (user_id, kind, window_start, n) values (v_uid, p_kind, now(), p_n)
  on conflict (user_id, kind) do update set
    window_start = case when r.window_start < now() - interval '1 hour' then now() else r.window_start end,
    n = case when r.window_start < now() - interval '1 hour' then p_n else r.n + p_n end
  returning n into v_n;
  if v_n > p_limit then raise exception 'rate limited' using errcode = '54000'; end if;
end;
$$;
revoke all on function public.msg_rate_take(text, integer, integer) from public, anon, authenticated;

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
  perform public.msg_rate_take('claim', 1, 200);
  return query
    delete from public.msg_prekeys p
    where (p.device_id, p.prekey_id) = (
      select k.device_id, k.prekey_id from public.msg_prekeys k
      where k.device_id = p_device order by k.prekey_id limit 1 for update skip locked)
    returning p.prekey_id, p.pub;
end;
$$;

create or replace function public.msg_send(p_conv uuid, p_sender_device uuid, p_items jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_item jsonb;
  v_dev uuid;
  v_owner uuid;
  v_ct text;
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
  perform public.msg_rate_take('send', jsonb_array_length(p_items), 3000);
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_dev := (v_item ->> 'device')::uuid;
    v_ct := v_item ->> 'ct';
    if v_ct is null or length(v_ct) > 32768 then raise exception 'message too large' using errcode = '22023'; end if;
    select user_id into v_owner from public.msg_devices where device_id = v_dev and revoked_at is null;
    if v_owner is null then raise exception 'unknown or removed device %', v_dev using errcode = 'P0002'; end if;
    if v_owner <> v_uid and (p_conv is null or not exists (
         select 1 from public.msg_conversation_members where conversation_id = p_conv and user_id = v_owner)) then
      raise exception 'device % is not in this conversation', v_dev using errcode = '42501';
    end if;
    if (select count(*) from public.msg_inbox where recipient_device_id = v_dev) >= 2000 then
      raise exception 'inbox full for %', v_dev using errcode = '54000';
    end if;
    insert into public.msg_inbox (recipient_device_id, sender_device_id, sender_user_id, conversation_id, ciphertext)
      values (v_dev, p_sender_device, v_uid, p_conv, v_ct);
    v_n := v_n + 1;
  end loop;
  update public.msg_devices set last_seen_at = now() where device_id = p_sender_device;
  return v_n;
end;
$$;

-- Column grants: every column but last_seen_at (updates are unchanged).
revoke select on public.msg_devices from authenticated;
grant select (device_id, user_id, kind, label, sign_pub, dh_pub, created_at_ms, identity_sig, device_sig,
  spk_id, spk_pub, spk_sig, spk_created_at_ms, revoked_at) on public.msg_devices to authenticated;
