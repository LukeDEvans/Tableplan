-- Run this in your Supabase SQL editor (Dashboard > SQL Editor > New Query)

create table if not exists live_groups (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users not null,
  disabled_pages text[] not null default '{}',
  created_at timestamptz default now()
);

create table if not exists live_group_members (
  group_id uuid references live_groups not null,
  user_id uuid references auth.users not null,
  display_name text not null default '',
  role text not null default 'member',
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
);

create table if not exists live_group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references live_groups not null,
  email text not null,
  invited_by uuid references auth.users not null,
  created_at timestamptz default now(),
  accepted_at timestamptz
);

alter table live_groups enable row level security;
alter table live_group_members enable row level security;
alter table live_group_invites enable row level security;

-- live_groups policies
create policy "authenticated users can create groups"
  on live_groups for insert to authenticated
  with check (created_by = auth.uid());

create policy "members can read their group"
  on live_groups for select to authenticated
  using (id in (select group_id from live_group_members where user_id = auth.uid()));

create policy "admin can update their group"
  on live_groups for update to authenticated
  using (id in (select group_id from live_group_members where user_id = auth.uid() and role = 'admin'));

-- live_group_members policies
create policy "members can read their group members"
  on live_group_members for select to authenticated
  using (group_id in (select group_id from live_group_members m2 where m2.user_id = auth.uid()));

create policy "group creator can add themselves as admin"
  on live_group_members for insert to authenticated
  with check (user_id = auth.uid() and group_id in (select id from live_groups where created_by = auth.uid()));

-- live_group_invites policy (inserts/updates done server-side via service role key)
create policy "admin can read invites for their group"
  on live_group_invites for select to authenticated
  using (group_id in (select group_id from live_group_members where user_id = auth.uid() and role = 'admin'));
