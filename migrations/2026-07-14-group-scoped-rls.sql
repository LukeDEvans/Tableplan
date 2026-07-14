-- REQUIRED BEFORE ONBOARDING A SECOND USER.
-- tableplan_states is hardcoded to a single email in every RLS policy, so an
-- invited household member can neither read nor write app state: the app
-- looks empty and never syncs for them. Scope access by group membership
-- instead, via the existing live_get_my_group_ids() helper.
--
-- Row-id shapes covered by split_part(id, ':', 1):
--   "<groupId>:<section>"  -> groupId  (per-section state rows)
--   "<groupId>"            -> groupId  (legacy unified row, read by migration)
-- Rows with no group prefix (gmail_*, mailsugg_*, mailai_*, backups,
-- email_schedule_log, "personal") match no membership and stay inaccessible
-- to clients — only service-role functions touch them (they bypass RLS).
-- The legacy "Only Luke…personal" policies are left untouched.

drop policy if exists "Signed-in users can read tableplan state" on public.tableplan_states;
drop policy if exists "Signed-in users can create tableplan state" on public.tableplan_states;
drop policy if exists "Signed-in users can update tableplan state" on public.tableplan_states;

create policy "Group members can read their state"
on public.tableplan_states for select to authenticated
using (split_part(id, ':', 1) in (select g::text from public.live_get_my_group_ids() g));

create policy "Group members can create their state"
on public.tableplan_states for insert to authenticated
with check (split_part(id, ':', 1) in (select g::text from public.live_get_my_group_ids() g));

create policy "Group members can update their state"
on public.tableplan_states for update to authenticated
using (split_part(id, ':', 1) in (select g::text from public.live_get_my_group_ids() g))
with check (split_part(id, ':', 1) in (select g::text from public.live_get_my_group_ids() g));
