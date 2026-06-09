alter table public.eat_recipes
  add column if not exists nutrition_estimate jsonb,
  add column if not exists ingredient_nutrition_matches jsonb not null default '[]'::jsonb;

grant select, insert, update, delete
  on public.eat_recipes
  to authenticated;

alter table public.eat_recipes enable row level security;
