-- Append-only history for the account-wide Live state document.
-- Run once in the Supabase SQL editor.

create table if not exists public.tableplan_state_history (
  version_id bigint generated always as identity primary key,
  state_id text not null,
  state jsonb not null,
  original_updated_at timestamptz,
  archived_at timestamptz not null default now()
);

alter table public.tableplan_state_history enable row level security;

revoke all on public.tableplan_state_history from anon;
grant select on public.tableplan_state_history to authenticated;

drop policy if exists "Only Luke can read tableplan state history"
on public.tableplan_state_history;

create policy "Only Luke can read tableplan state history"
on public.tableplan_state_history
for select
to authenticated
using (
  state_id = 'personal'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'mrlukedevans@gmail.com'
);

create or replace function public.archive_tableplan_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.state is distinct from new.state then
    insert into public.tableplan_state_history (
      state_id,
      state,
      original_updated_at
    )
    values (
      old.id,
      old.state,
      old.updated_at
    );

    delete from public.tableplan_state_history
    where version_id in (
      select version_id
      from public.tableplan_state_history
      where state_id = old.id
      order by archived_at desc, version_id desc
      offset 100
    );
  end if;

  return new;
end;
$$;

drop trigger if exists archive_tableplan_state_before_update
on public.tableplan_states;

create trigger archive_tableplan_state_before_update
before update on public.tableplan_states
for each row
execute function public.archive_tableplan_state();
