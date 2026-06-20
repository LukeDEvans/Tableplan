-- Push notification subscriptions for daily briefings.
-- Each row is one browser/device subscription for one user.

create table if not exists public.live_push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  endpoint    text not null unique,
  subscription jsonb not null,
  created_at  timestamptz not null default now()
);

alter table public.live_push_subscriptions enable row level security;

-- Authenticated users can manage their own subscriptions
create policy "Users can insert own push subscriptions"
  on public.live_push_subscriptions for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "Users can delete own push subscriptions"
  on public.live_push_subscriptions for delete
  to authenticated
  using (user_id = auth.uid());

create policy "Users can read own push subscriptions"
  on public.live_push_subscriptions for select
  to authenticated
  using (user_id = auth.uid());

-- Service role (used by scheduled function) can read all
-- No explicit policy needed — service role bypasses RLS
