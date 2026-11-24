-- Messaging: device removals signed by the person's identity (ISSUES P1 2026-11-03,
-- "Messaging trusts the server for device removal"; Luke's go-ahead 2026-11-24).
--
-- A removed linked device's certificate still verifies against the pinned identity,
-- so until now "removed" was only msg_devices.revoked_at, which the server sets. A
-- server that cleared it would keep a removed device in everyone's fan-out.
--
-- Now the phone (the only holder of the identity key) signs the full list of its
-- owner's removed devices, with a generation number, and keeps it here. Senders
-- verify the list against the identity THEY pinned and skip every device on it,
-- whatever revoked_at says; each device also keeps the union of every list it has
-- verified, so a server serving an older list can't bring a device back. Same idea
-- as Documents' "vault settled" statements (documents/crypto/statements.js).
--
-- One row per person. Readable by people who can message them (msg_can_contact, as
-- msg_identities); written only by its owner. require_mfa_when_enrolled, like every
-- user table since 2026-11-17. Additive only: one table, policies, grants. No DROP.

create table if not exists public.msg_device_removals (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  generation         integer not null check (generation >= 1),
  removed_device_ids uuid[] not null check (cardinality(removed_device_ids) <= 500),
  sig                text not null check (sig ~ '^[A-Za-z0-9_-]{86}$'),
  updated_at         timestamptz not null default now()
);

alter table public.msg_device_removals enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'msg_device_removals' and policyname = 'msg removals: read contacts') then
    execute $p$create policy "msg removals: read contacts" on public.msg_device_removals
  for select to authenticated using ((select public.msg_can_contact(user_id)))$p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'msg_device_removals' and policyname = 'msg removals: write own') then
    execute $p$create policy "msg removals: write own" on public.msg_device_removals
  for insert to authenticated with check (user_id = (select auth.uid()))$p$;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'msg_device_removals' and policyname = 'msg removals: update own') then
    execute $p$create policy "msg removals: update own" on public.msg_device_removals
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$p$;
  end if;
  -- The MFA rule (migrations/2026-11-17c). Guarded so the test databases, which load
  -- only the messaging migrations, still apply this file.
  if exists (select 1 from pg_proc where proname = 'session_meets_mfa')
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'msg_device_removals' and policyname = 'require_mfa_when_enrolled') then
    execute $p$create policy require_mfa_when_enrolled on public.msg_device_removals as restrictive
  for all to authenticated using ((select public.session_meets_mfa())) with check ((select public.session_meets_mfa()))$p$;
  end if;
end $$;

revoke all on public.msg_device_removals from anon, authenticated, public;
grant select, insert, update on public.msg_device_removals to authenticated;
grant all on public.msg_device_removals to service_role;
