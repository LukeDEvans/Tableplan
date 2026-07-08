-- Eat privacy hardening for a single-user Supabase project.
-- Run this in the Supabase SQL editor before relying on the live app as private.

alter table public.tableplan_states enable row level security;
alter table public.eat_folders enable row level security;
alter table public.eat_recipes enable row level security;

revoke all on public.tableplan_states from anon;
revoke all on public.eat_folders from anon;
revoke all on public.eat_recipes from anon;

grant select, insert, update on public.tableplan_states to authenticated;
grant select, insert, update, delete on public.eat_folders to authenticated;
grant select, insert, update, delete on public.eat_recipes to authenticated;

drop policy if exists "Allow anon read tableplan state" on public.tableplan_states;
drop policy if exists "Allow anon create tableplan state" on public.tableplan_states;
drop policy if exists "Allow anon update tableplan state" on public.tableplan_states;
drop policy if exists "Signed-in users can read tableplan state" on public.tableplan_states;
drop policy if exists "Signed-in users can create tableplan state" on public.tableplan_states;
drop policy if exists "Signed-in users can update tableplan state" on public.tableplan_states;
drop policy if exists "Only Luke can read tableplan state" on public.tableplan_states;
drop policy if exists "Only Luke can create tableplan state" on public.tableplan_states;
drop policy if exists "Only Luke can update tableplan state" on public.tableplan_states;

drop policy if exists "Signed-in users can read folders" on public.eat_folders;
drop policy if exists "Signed-in users can create folders" on public.eat_folders;
drop policy if exists "Signed-in users can update folders" on public.eat_folders;
drop policy if exists "Signed-in users can delete folders" on public.eat_folders;
drop policy if exists "Only Luke can read folders" on public.eat_folders;
drop policy if exists "Only Luke can create folders" on public.eat_folders;
drop policy if exists "Only Luke can update folders" on public.eat_folders;
drop policy if exists "Only Luke can delete folders" on public.eat_folders;

drop policy if exists "Signed-in users can read recipes" on public.eat_recipes;
drop policy if exists "Signed-in users can create recipes" on public.eat_recipes;
drop policy if exists "Signed-in users can update recipes" on public.eat_recipes;
drop policy if exists "Signed-in users can delete recipes" on public.eat_recipes;
drop policy if exists "Only Luke can read recipes" on public.eat_recipes;
drop policy if exists "Only Luke can create recipes" on public.eat_recipes;
drop policy if exists "Only Luke can update recipes" on public.eat_recipes;
drop policy if exists "Only Luke can delete recipes" on public.eat_recipes;

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

create policy "Only Luke can read folders"
on public.eat_folders
for select
to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com');

create policy "Only Luke can create folders"
on public.eat_folders
for insert
to authenticated
with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com');

create policy "Only Luke can update folders"
on public.eat_folders
for update
to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com')
with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com');

create policy "Only Luke can delete folders"
on public.eat_folders
for delete
to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com');

create policy "Only Luke can read recipes"
on public.eat_recipes
for select
to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com');

create policy "Only Luke can create recipes"
on public.eat_recipes
for insert
to authenticated
with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com');

create policy "Only Luke can update recipes"
on public.eat_recipes
for update
to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com')
with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com');

create policy "Only Luke can delete recipes"
on public.eat_recipes
for delete
to authenticated
using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'YOUR-EMAIL@example.com');
