-- Apple Health in Liv (HEALTH_DESIGN.md; Luke, 2026-11-24).
--
-- Workout summaries and daily activity rings, copied from the phone's Apple Health
-- into the owner's Liv account so Exercise can fill its logs and the history stays in
-- Liv. Only summaries: no second-by-second heart rate, no routes. Never read by
-- anything that reads tableplan_states, and never in Household: rows belong to one
-- person and only that person sees them.
--
-- The phone writes through a health-only device key, the same pattern as Photos
-- (2026-11-16b-photo-sync-devices.sql): registered once from the open, signed-in app,
-- the secret kept in the phone's Keychain, its SHA-256 here. A key can only add,
-- update and delete its owner's health rows, through the functions below, which only
-- the server (the health-sync Edge Function, service_role) may call. Nothing here is
-- Apple-specific: `activity` is Liv's own word for the sport.
--
-- The owner can: read their rows, set `matched` (how Exercise filed a workout), delete
-- their rows (Settings › Delete all Health data from Liv), see their devices and
-- revoke one. Additive only.

create table if not exists public.health_sync_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  device_key   text not null check (device_key ~ '^[A-Za-z0-9_-]{1,64}$'),
  name         text not null default '' check (char_length(name) <= 60),
  secret_hash  text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create unique index if not exists health_sync_devices_one_live on public.health_sync_devices (user_id, device_key) where revoked_at is null;
create index if not exists health_sync_devices_user on public.health_sync_devices (user_id);

create table if not exists public.live_health_workouts (
  user_id      uuid not null references auth.users (id) on delete cascade,
  id           text not null check (id ~ '^[0-9a-f]{32}$'),   -- sha256(device key + Health's workout id), first 32
  started_at   timestamptz not null,
  ended_at     timestamptz not null,
  activity     text not null check (activity ~ '^[a-z_]{1,32}$'),
  indoor       boolean,
  duration_s   integer not null check (duration_s between 0 and 604800),
  distance_m   numeric check (distance_m is null or distance_m between 0 and 10000000),
  energy_kcal  numeric check (energy_kcal is null or energy_kcal between 0 and 100000),
  hr_avg       smallint check (hr_avg is null or hr_avg between 20 and 260),
  hr_max       smallint check (hr_max is null or hr_max between 20 and 260),
  source       text check (source is null or char_length(source) <= 60),
  matched      jsonb,                                         -- { filed: true } | { dismissed: true }; null = not filed yet
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists live_health_workouts_recent on public.live_health_workouts (user_id, started_at desc);

create table if not exists public.live_health_days (
  user_id       uuid not null references auth.users (id) on delete cascade,
  day           date not null,
  move_kcal     numeric, move_goal numeric,
  exercise_min  smallint, exercise_goal smallint,
  stand_h       smallint, stand_goal smallint,
  updated_at    timestamptz not null default now(),
  primary key (user_id, day)
);

-- A device is fixed once made; revoking is the only change and is final.
create or replace function public.health_sync_devices_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.device_key <> old.device_key
     or new.secret_hash <> old.secret_hash or new.created_at <> old.created_at then
    raise exception 'a sync device is fixed' using errcode = '42501';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'a revoked device stays revoked' using errcode = '42501';
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'health_sync_devices_guard' and tgrelid = 'public.health_sync_devices'::regclass) then
    create trigger health_sync_devices_guard before update on public.health_sync_devices for each row execute function public.health_sync_devices_guard();
  end if;
end $$;

-- The owner may only change `matched` (column grant below); this keeps the rest and
-- the stamp honest whoever writes.
create or replace function public.live_health_workouts_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.user_id <> old.user_id or new.id <> old.id then
    raise exception 'a health workout is fixed' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'live_health_workouts_guard' and tgrelid = 'public.live_health_workouts'::regclass) then
    create trigger live_health_workouts_guard before update on public.live_health_workouts for each row execute function public.live_health_workouts_guard();
  end if;
end $$;

create or replace function public.health_sync_register(p_user uuid, p_device_key text, p_name text, p_secret_hash text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if p_user is null then raise exception 'no user' using errcode = '42501'; end if;
  update public.health_sync_devices set revoked_at = now()
    where user_id = p_user and device_key = p_device_key and revoked_at is null;
  insert into public.health_sync_devices (user_id, device_key, name, secret_hash)
    values (p_user, p_device_key, left(coalesce(p_name, ''), 60), p_secret_hash)
    returning id into v_id;
  return v_id;
end $$;

create or replace function public.health_sync_device(p_device uuid, p_secret_hash text)
returns table (user_id uuid, device_key text)
language sql volatile security definer set search_path = ''
as $$
  update public.health_sync_devices d set last_used_at = now()
  where d.id = p_device and d.secret_hash = p_secret_hash and d.revoked_at is null
  returning d.user_id, d.device_key;
$$;

-- One batch from the phone: workouts to add or update (≤200), workouts deleted in
-- Health (≤200 ids), ring days (≤400). An updated workout keeps how it was filed.
create or replace function public.health_sync_put(p_device uuid, p_secret_hash text, p_workouts jsonb, p_deleted text[], p_days jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare d record; n_w integer := 0; n_x integer := 0; n_d integer := 0;
begin
  select * into d from public.health_sync_device(p_device, p_secret_hash);
  if d.user_id is null then raise exception 'unknown device' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_workouts, '[]')) <> 'array' or jsonb_array_length(coalesce(p_workouts, '[]')) > 200
     or coalesce(cardinality(p_deleted), 0) > 200
     or jsonb_typeof(coalesce(p_days, '[]')) <> 'array' or jsonb_array_length(coalesce(p_days, '[]')) > 400 then
    raise exception 'bad batch' using errcode = '22023';
  end if;

  insert into public.live_health_workouts (user_id, id, started_at, ended_at, activity, indoor, duration_s,
                                           distance_m, energy_kcal, hr_avg, hr_max, source)
  select d.user_id, r.id, r.started_at, r.ended_at, r.activity, r.indoor, r.duration_s,
         r.distance_m, r.energy_kcal, r.hr_avg, r.hr_max, r.source
  from jsonb_to_recordset(coalesce(p_workouts, '[]')) as r(id text, started_at timestamptz, ended_at timestamptz, activity text,
       indoor boolean, duration_s integer, distance_m numeric, energy_kcal numeric, hr_avg smallint, hr_max smallint, source text)
  where r.id is not null
  on conflict (user_id, id) do update set
    started_at = excluded.started_at, ended_at = excluded.ended_at, activity = excluded.activity, indoor = excluded.indoor,
    duration_s = excluded.duration_s, distance_m = excluded.distance_m, energy_kcal = excluded.energy_kcal,
    hr_avg = excluded.hr_avg, hr_max = excluded.hr_max, source = excluded.source;
  get diagnostics n_w = row_count;

  if coalesce(cardinality(p_deleted), 0) > 0 then
    delete from public.live_health_workouts w where w.user_id = d.user_id and w.id = any (p_deleted);
    get diagnostics n_x = row_count;
  end if;

  insert into public.live_health_days (user_id, day, move_kcal, move_goal, exercise_min, exercise_goal, stand_h, stand_goal)
  select d.user_id, r.day, r.move_kcal, r.move_goal, r.exercise_min, r.exercise_goal, r.stand_h, r.stand_goal
  from jsonb_to_recordset(coalesce(p_days, '[]')) as r(day date, move_kcal numeric, move_goal numeric, exercise_min smallint,
       exercise_goal smallint, stand_h smallint, stand_goal smallint)
  where r.day is not null
  on conflict (user_id, day) do update set
    move_kcal = excluded.move_kcal, move_goal = excluded.move_goal, exercise_min = excluded.exercise_min,
    exercise_goal = excluded.exercise_goal, stand_h = excluded.stand_h, stand_goal = excluded.stand_goal, updated_at = now();
  get diagnostics n_d = row_count;

  return jsonb_build_object('workouts', n_w, 'deleted', n_x, 'days', n_d);
end $$;

alter table public.health_sync_devices enable row level security;
alter table public.live_health_workouts enable row level security;
alter table public.live_health_days enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'health_sync_devices' and policyname = 'health sync devices: read own') then
    create policy "health sync devices: read own" on public.health_sync_devices for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'health_sync_devices' and policyname = 'health sync devices: revoke own') then
    create policy "health sync devices: revoke own" on public.health_sync_devices for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'live_health_workouts' and policyname = 'health workouts: own') then
    create policy "health workouts: own" on public.live_health_workouts for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'live_health_days' and policyname = 'health days: own') then
    create policy "health days: own" on public.live_health_days for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'health_sync_devices' and policyname = 'require_mfa_when_enrolled') then
    create policy require_mfa_when_enrolled on public.health_sync_devices as restrictive for all to authenticated using ((select public.session_meets_mfa())) with check ((select public.session_meets_mfa()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'live_health_workouts' and policyname = 'require_mfa_when_enrolled') then
    create policy require_mfa_when_enrolled on public.live_health_workouts as restrictive for all to authenticated using ((select public.session_meets_mfa())) with check ((select public.session_meets_mfa()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'live_health_days' and policyname = 'require_mfa_when_enrolled') then
    create policy require_mfa_when_enrolled on public.live_health_days as restrictive for all to authenticated using ((select public.session_meets_mfa())) with check ((select public.session_meets_mfa()));
  end if;
end $$;

revoke all on public.health_sync_devices, public.live_health_workouts, public.live_health_days from anon, authenticated;
grant select (id, device_key, name, created_at, last_used_at, revoked_at) on public.health_sync_devices to authenticated;
grant update (revoked_at) on public.health_sync_devices to authenticated;
grant select, delete on public.live_health_workouts to authenticated;
grant select, delete on public.live_health_days to authenticated;
grant update (matched) on public.live_health_workouts to authenticated;
grant all on public.health_sync_devices to service_role;
grant all on public.live_health_workouts to service_role;
grant all on public.live_health_days to service_role;

revoke all on function public.health_sync_devices_guard(), public.live_health_workouts_guard() from public, anon, authenticated;
revoke all on function public.health_sync_register(uuid, text, text, text), public.health_sync_device(uuid, text),
  public.health_sync_put(uuid, text, jsonb, text[], jsonb) from public, anon, authenticated;
grant execute on function public.health_sync_register(uuid, text, text, text), public.health_sync_device(uuid, text),
  public.health_sync_put(uuid, text, jsonb, text[], jsonb) to service_role;
