create table if not exists public.tableplan_states (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.tableplan_states enable row level security;

create policy "Only Luke can read tableplan state"
on public.tableplan_states
for select
to authenticated
using (
  id = 'personal'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com'
);

create policy "Only Luke can create tableplan state"
on public.tableplan_states
for insert
to authenticated
with check (
  id = 'personal'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com'
);

create policy "Only Luke can update tableplan state"
on public.tableplan_states
for update
to authenticated
using (
  id = 'personal'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com'
)
with check (
  id = 'personal'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com'
);

-- ── Data API grants ─────────────────────────────────────────────────────────
-- Explicit grants (from 2026-10-30 Supabase no longer auto-grants new public tables to the Data
-- API on 2026-10-30). Least-privilege: matches the RLS policies above; RLS still
-- decides which rows. No anon grant — the app never reads these signed-out.
grant select, insert, update on public.tableplan_states to authenticated;
grant select, insert, update, delete on public.tableplan_states to service_role;
