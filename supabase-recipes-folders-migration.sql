create table if not exists public.eat_folders (
  id text primary key,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.eat_recipes (
  id text primary key,
  name text not null,
  time text not null default '',
  prep_time text not null default '',
  cook_time text not null default '',
  servings integer not null default 1,
  folder_id text references public.eat_folders(id) on delete set null,
  source_url text not null default '',
  photo_url text not null default '',
  ingredients jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  nutrition jsonb not null default '[]'::jsonb,
  cook_log jsonb not null default '[]'::jsonb,
  steps text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.eat_folders enable row level security;
alter table public.eat_recipes enable row level security;

alter table public.eat_recipes
add column if not exists tags jsonb not null default '[]'::jsonb;

alter table public.eat_recipes
add column if not exists nutrition jsonb not null default '[]'::jsonb;

alter table public.eat_recipes
add column if not exists cook_log jsonb not null default '[]'::jsonb;

alter table public.eat_recipes
add column if not exists prep_time text not null default '';

alter table public.eat_recipes
add column if not exists cook_time text not null default '';

drop policy if exists "Signed-in users can read folders" on public.eat_folders;
drop policy if exists "Signed-in users can create folders" on public.eat_folders;
drop policy if exists "Signed-in users can update folders" on public.eat_folders;
drop policy if exists "Signed-in users can delete folders" on public.eat_folders;

drop policy if exists "Signed-in users can read recipes" on public.eat_recipes;
drop policy if exists "Signed-in users can create recipes" on public.eat_recipes;
drop policy if exists "Signed-in users can update recipes" on public.eat_recipes;
drop policy if exists "Signed-in users can delete recipes" on public.eat_recipes;

create policy "Signed-in users can read folders"
on public.eat_folders
for select
to authenticated
using ((auth.jwt() ->> 'email') = 'YOUR-EMAIL@example.com');

create policy "Signed-in users can create folders"
on public.eat_folders
for insert
to authenticated
with check ((auth.jwt() ->> 'email') = 'YOUR-EMAIL@example.com');

create policy "Signed-in users can update folders"
on public.eat_folders
for update
to authenticated
using ((auth.jwt() ->> 'email') = 'YOUR-EMAIL@example.com')
with check ((auth.jwt() ->> 'email') = 'YOUR-EMAIL@example.com');

create policy "Signed-in users can delete folders"
on public.eat_folders
for delete
to authenticated
using ((auth.jwt() ->> 'email') = 'YOUR-EMAIL@example.com');

create policy "Signed-in users can read recipes"
on public.eat_recipes
for select
to authenticated
using ((auth.jwt() ->> 'email') = 'YOUR-EMAIL@example.com');

create policy "Signed-in users can create recipes"
on public.eat_recipes
for insert
to authenticated
with check ((auth.jwt() ->> 'email') = 'YOUR-EMAIL@example.com');

create policy "Signed-in users can update recipes"
on public.eat_recipes
for update
to authenticated
using ((auth.jwt() ->> 'email') = 'YOUR-EMAIL@example.com')
with check ((auth.jwt() ->> 'email') = 'YOUR-EMAIL@example.com');

create policy "Signed-in users can delete recipes"
on public.eat_recipes
for delete
to authenticated
using ((auth.jwt() ->> 'email') = 'YOUR-EMAIL@example.com');

insert into public.eat_folders (id, name, sort_order)
select
  folder->>'id',
  folder->>'name',
  row_number() over (order by folder->>'name') - 1
from public.tableplan_states state_row
cross join lateral jsonb_array_elements(state_row.state->'folders') folder
where state_row.id = 'personal'
on conflict (id) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.eat_recipes (
  id,
  name,
  time,
  prep_time,
  cook_time,
  servings,
  folder_id,
  source_url,
  photo_url,
  ingredients,
  tags,
  nutrition,
  cook_log,
  steps
)
select
  recipe->>'id',
  recipe->>'name',
  coalesce(recipe->>'time', ''),
  coalesce(recipe->>'prepTime', ''),
  coalesce(recipe->>'cookTime', ''),
  coalesce((recipe->>'servings')::integer, 1),
  nullif(recipe->>'folderId', ''),
  coalesce(recipe->>'sourceUrl', ''),
  coalesce(recipe->>'photoUrl', ''),
  coalesce(recipe->'ingredients', '[]'::jsonb),
  coalesce(recipe->'tags', '[]'::jsonb),
  coalesce(recipe->'nutrition', '[]'::jsonb),
  coalesce(recipe->'cookLog', '[]'::jsonb),
  coalesce(recipe->>'steps', '')
from public.tableplan_states state_row
cross join lateral jsonb_array_elements(state_row.state->'recipes') recipe
where state_row.id = 'personal'
on conflict (id) do update set
  name = excluded.name,
  time = excluded.time,
  prep_time = excluded.prep_time,
  cook_time = excluded.cook_time,
  servings = excluded.servings,
  folder_id = excluded.folder_id,
  source_url = excluded.source_url,
  photo_url = excluded.photo_url,
  ingredients = excluded.ingredients,
  tags = excluded.tags,
  nutrition = excluded.nutrition,
  cook_log = excluded.cook_log,
  steps = excluded.steps,
  updated_at = now();
