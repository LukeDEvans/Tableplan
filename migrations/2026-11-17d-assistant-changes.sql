-- 2026-11-17d — the change log for the assistant connector's write tools
-- (supabase/functions/liv-mcp/write-tools.js; DUET_CONNECTOR_DESIGN.md §7).
--
-- One row per change an assistant made through a connector key: what it did (in
-- words) and how to undo it. Written only by the liv-mcp Edge Function (service
-- role); the owner can read their own rows. Applied 2026-11-17 via execute_sql.

create table if not exists public.assistant_changes (
  id          uuid primary key default gen_random_uuid(),
  key_id      uuid not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  tool        text not null,
  summary     text not null default '',
  undo        jsonb,
  undone_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists assistant_changes_user_created on public.assistant_changes (user_id, created_at desc);

alter table public.assistant_changes enable row level security;
revoke all on public.assistant_changes from anon, authenticated;
grant select on public.assistant_changes to authenticated;
grant select, insert, update, delete on public.assistant_changes to service_role;

create policy assistant_changes_owner_read on public.assistant_changes
  for select to authenticated using (user_id = (select auth.uid()));
create policy require_mfa_when_enrolled on public.assistant_changes
  as restrictive for all to authenticated
  using ((select public.session_meets_mfa())) with check ((select public.session_meets_mfa()));

-- Luke's connector key gets write access (Luke, 2026-11-17: "All of the above").
-- update public.assistant_connector_keys set scopes = array['read','write'] where …  (run separately, by key)
