-- live_app_config — single-row admin config (admin_disabled_pages).
--
-- ✅ Already exists in production (project noyocjcltrenwdovqrql); it was created
-- by hand and never checked in. RECONSTRUCTED 2026-09-24 from the live catalog
-- (columns, RLS policies) so a fresh project / preview branch / `db reset` can
-- recreate it. Idempotent; running it against prod is a no-op.
--
-- Includes explicit Data API grants: from 2026-10-30 Supabase no longer
-- auto-grants new public tables, so without them this table would be
-- unreachable ("permission denied") on any newly created database.

create table if not exists public.live_app_config (
  id                   integer primary key default 1,
  admin_disabled_pages text[] not null default '{}'::text[],
  constraint single_row check (id = 1)
);

alter table public.live_app_config enable row level security;

drop policy if exists "anyone can read app config" on public.live_app_config;
create policy "anyone can read app config"
  on public.live_app_config for select
  using (true);

drop policy if exists "admins can update app config" on public.live_app_config;
create policy "admins can update app config"
  on public.live_app_config for update
  using (exists (
    select 1 from public.live_group_members
     where live_group_members.user_id = auth.uid()
       and live_group_members.role = 'admin'
  ));

insert into public.live_app_config (id) values (1) on conflict (id) do nothing;

-- ── Data API grants ─────────────────────────────────────────────────────────
-- Read is public by policy (the admin-disabled-pages list gates nav); only
-- signed-in admins update (enforced by the policy above).
grant select on public.live_app_config to anon;
grant select, update on public.live_app_config to authenticated;
grant select, insert, update, delete on public.live_app_config to service_role;
