-- Views: spaces for Business, and a locked-down admin role (VIEWS_DESIGN.md §2, build step 1).
--
-- DRAFT — not applied. Apply in the Supabase SQL editor after Luke's OK.
-- Idempotent: safe to re-run.
--
-- What each view maps to:
--   Personal  — the existing per-user rows "u-<uid>:<section>" (unchanged).
--   Household — the existing household group (live_groups / live_group_members)
--               and its rows "<groupId>:<section>" (unchanged).
--   Business  — NEW: a space in live_spaces, its members in live_space_members,
--               its state rows "<spaceId>:<section>" in tableplan_states.
--
-- Why Business doesn't reuse live_groups: about eight Netlify functions find "the
-- user's group" with live_group_members?user_id=eq.X&limit=1 and no ordering
-- (_state-sections, simplefin, _finance-categories, _gcal, _gmail-shared,
-- _news-articles, chat, admin-data, send-invite). A second membership there could
-- make any of them pick the business group, e.g. writing bank balances into
-- business rows. A separate pair of tables can't be picked up by any of them.
--
-- 1. live_spaces + live_space_members, read-only to members. Membership changes
--    only through the service role (SQL editor / a future function) until the
--    Business roles are decided (decision 24) — so nobody can add themselves to,
--    or promote themselves in, a business from the app.
-- 2. tableplan_states RLS gains one more OR clause: members of a space can read and
--    write that space's rows. The three existing conditions are copied verbatim
--    from 2026-08-20-db-hardening.sql, so nothing about Personal or Household
--    access changes.
-- 3. FIX (security): today any household member can PATCH their own
--    live_group_members row's `role` to 'admin' (policy "members can update own
--    row" + a table-wide UPDATE grant). The views are admin-only and the app reads
--    `role` to decide, so this closes that: clients may update only display_name
--    and personal_disabled_pages on their own row. The app only ever PATCHes
--    personal_disabled_pages there. (setGroupMemberRole — an admin changing
--    someone else's role — already fails under RLS today; unchanged.)
--    Also revokes anon's table privileges on all three group tables (RLS already
--    blocked anon; this is hygiene).
-- 4. Seed: Luke's business space, Luke as owner.

-- ── 1. Spaces ────────────────────────────────────────────────────────────────
create table if not exists public.live_spaces (
  id         uuid primary key default gen_random_uuid(),
  -- Household stays live_groups and Personal stays u-<uid>, so only business here.
  kind       text not null default 'business' check (kind in ('business')),
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.live_space_members (
  space_id     uuid not null references public.live_spaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- Kept from day one so adding employees later doesn't change the shape. What a
  -- manager vs an employee may do is decided before the first invite (decision 24).
  role         text not null check (role in ('owner', 'manager', 'employee')),
  display_name text not null default '',
  joined_at    timestamptz not null default now(),
  primary key (space_id, user_id)
);

create index if not exists idx_live_space_members_user_id on public.live_space_members (user_id);
create index if not exists idx_live_spaces_created_by     on public.live_spaces (created_by);

-- The caller's spaces. SECURITY DEFINER so the RLS policies below can call it
-- without recursing into live_space_members' own policy (same pattern as
-- live_get_my_group_ids).
create or replace function public.live_get_my_space_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select space_id from public.live_space_members where user_id = (select auth.uid())
$$;
revoke all on function public.live_get_my_space_ids() from public, anon;
grant execute on function public.live_get_my_space_ids() to authenticated, service_role;

alter table public.live_spaces        enable row level security;
alter table public.live_space_members enable row level security;

drop policy if exists "Members read their spaces" on public.live_spaces;
create policy "Members read their spaces"
  on public.live_spaces for select to authenticated
  using (id in (select public.live_get_my_space_ids()));

drop policy if exists "Members read their spaces' members" on public.live_space_members;
create policy "Members read their spaces' members"
  on public.live_space_members for select to authenticated
  using (space_id in (select public.live_get_my_space_ids()));

-- No insert / update / delete policies for clients: only the service role
-- changes spaces and membership for now.
revoke all on public.live_spaces        from anon, authenticated;
revoke all on public.live_space_members from anon, authenticated;
grant select on public.live_spaces        to authenticated;
grant select on public.live_space_members to authenticated;
grant all    on public.live_spaces        to service_role;
grant all    on public.live_space_members to service_role;

-- ── 2. tableplan_states: space members reach "<spaceId>:<section>" rows ───────
-- Conditions 1–3 are unchanged from 2026-08-20-db-hardening.sql; condition 4 is new.
drop policy if exists "state select (owner/user/group)" on public.tableplan_states;
drop policy if exists "state insert (owner/user/group)" on public.tableplan_states;
drop policy if exists "state update (owner/user/group)" on public.tableplan_states;
drop policy if exists "state select (owner/user/group/space)" on public.tableplan_states;
drop policy if exists "state insert (owner/user/group/space)" on public.tableplan_states;
drop policy if exists "state update (owner/user/group/space)" on public.tableplan_states;

create policy "state select (owner/user/group/space)" on public.tableplan_states
  for select to authenticated
  using (
    (id = 'personal' and lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'mrlukedevans@gmail.com')
    or (split_part(id, ':'::text, 1) = ('u-'::text || ((select auth.uid()))::text))
    or (split_part(id, ':'::text, 1) in (select (g.g)::text from public.live_get_my_group_ids() g(g)))
    or (split_part(id, ':'::text, 1) in (select (s.s)::text from public.live_get_my_space_ids() s(s)))
  );

create policy "state insert (owner/user/group/space)" on public.tableplan_states
  for insert to authenticated
  with check (
    (id = 'personal' and lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'mrlukedevans@gmail.com')
    or (split_part(id, ':'::text, 1) = ('u-'::text || ((select auth.uid()))::text))
    or (split_part(id, ':'::text, 1) in (select (g.g)::text from public.live_get_my_group_ids() g(g)))
    or (split_part(id, ':'::text, 1) in (select (s.s)::text from public.live_get_my_space_ids() s(s)))
  );

create policy "state update (owner/user/group/space)" on public.tableplan_states
  for update to authenticated
  using (
    (id = 'personal' and lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'mrlukedevans@gmail.com')
    or (split_part(id, ':'::text, 1) = ('u-'::text || ((select auth.uid()))::text))
    or (split_part(id, ':'::text, 1) in (select (g.g)::text from public.live_get_my_group_ids() g(g)))
    or (split_part(id, ':'::text, 1) in (select (s.s)::text from public.live_get_my_space_ids() s(s)))
  )
  with check (
    (id = 'personal' and lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'mrlukedevans@gmail.com')
    or (split_part(id, ':'::text, 1) = ('u-'::text || ((select auth.uid()))::text))
    or (split_part(id, ':'::text, 1) in (select (g.g)::text from public.live_get_my_group_ids() g(g)))
    or (split_part(id, ':'::text, 1) in (select (s.s)::text from public.live_get_my_space_ids() s(s)))
  );

-- ── 3. Nobody promotes themselves to admin ───────────────────────────────────
revoke update on public.live_group_members from authenticated;
grant update (display_name, personal_disabled_pages) on public.live_group_members to authenticated;
revoke all on public.live_groups        from anon;
revoke all on public.live_group_members from anon;
revoke all on public.live_group_invites from anon;

-- ── 4. Seed: Luke's business, Luke as owner ──────────────────────────────────
-- The name is a placeholder until Luke names it (Admin › Spaces, later).
do $$
declare
  luke  uuid;
  space uuid;
begin
  select id into luke from auth.users where lower(email) = 'mrlukedevans@gmail.com' limit 1;
  if luke is null then
    raise notice 'views-spaces: owner account not found; no business space created';
    return;
  end if;
  select s.id into space
    from public.live_spaces s
    join public.live_space_members m on m.space_id = s.id
   where s.kind = 'business' and m.user_id = luke and m.role = 'owner'
   limit 1;
  if space is null then
    insert into public.live_spaces (kind, name, created_by)
      values ('business', 'Business', luke)
      returning id into space;
    insert into public.live_space_members (space_id, user_id, role, display_name)
      values (space, luke, 'owner', 'Luke');
  end if;
end $$;
