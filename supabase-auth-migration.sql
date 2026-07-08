drop policy if exists "Allow anon read tableplan state" on public.tableplan_states;
drop policy if exists "Allow anon create tableplan state" on public.tableplan_states;
drop policy if exists "Allow anon update tableplan state" on public.tableplan_states;
drop policy if exists "Signed-in users can read tableplan state" on public.tableplan_states;
drop policy if exists "Signed-in users can create tableplan state" on public.tableplan_states;
drop policy if exists "Signed-in users can update tableplan state" on public.tableplan_states;

create policy "Signed-in users can read tableplan state"
on public.tableplan_states
for select
to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com');

create policy "Signed-in users can create tableplan state"
on public.tableplan_states
for insert
to authenticated
with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com');

create policy "Signed-in users can update tableplan state"
on public.tableplan_states
for update
to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com')
with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com');
