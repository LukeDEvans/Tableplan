create table if not exists public.tableplan_states (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.tableplan_states enable row level security;

create policy "Allow anon read tableplan state"
on public.tableplan_states
for select
to anon
using (true);

create policy "Allow anon create tableplan state"
on public.tableplan_states
for insert
to anon
with check (true);

create policy "Allow anon update tableplan state"
on public.tableplan_states
for update
to anon
using (true)
with check (true);
