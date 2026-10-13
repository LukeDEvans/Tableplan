-- Per-user notification preferences (IOS_NOTIFICATIONS_DESIGN.md §4, Phase 1).
--
-- Reminders are per person: a reminder goes only to the user who asked for it, so
-- they live here, keyed by user — NOT on the shared planEvents entries. That also
-- keeps them away from older deployed clients, whose calendar/model.js field
-- whitelist would strip an unknown per-user map when re-saving an event.
--
-- Egress (the hard constraint): the client reads its own row at most every 10
-- minutes and only when it changed (`updated_at=gt.<cached>` → [] otherwise), and
-- writes through merge_my_reminders(), which returns just a timestamp. Nothing here
-- reads or writes tableplan_states.
--
-- reminders: { "<planEventId>": {"min": 30} | {"off": true},
--              "gcal:<appCalendarId>:<googleSeriesId>": {"min": 10} | {"off": true} }
--   {"off": true} is a tombstone (the user turned it off), so a legacy shared
--   reminder can never be folded back in after the user removed it. A Google key
--   that is absent means "use Google's own reminder"; sending null for a key
--   removes it (only Google keys need that).
-- categories: per-category on/off for Phase 2 push ("reminders", "connections").
-- quiet: reserved for optional quiet hours (later).

create table if not exists public.live_notification_prefs (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  categories jsonb not null default '{"reminders": true, "connections": true}'::jsonb,
  reminders  jsonb not null default '{}'::jsonb,
  quiet      jsonb,
  updated_at timestamptz not null default now(),
  constraint live_notification_prefs_reminders_object check (jsonb_typeof(reminders) = 'object'),
  constraint live_notification_prefs_reminders_size   check (pg_column_size(reminders) < 262144)
);

alter table public.live_notification_prefs enable row level security;

drop policy if exists "Users read own notification prefs" on public.live_notification_prefs;
create policy "Users read own notification prefs"
  on public.live_notification_prefs for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users insert own notification prefs" on public.live_notification_prefs;
create policy "Users insert own notification prefs"
  on public.live_notification_prefs for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users update own notification prefs" on public.live_notification_prefs;
create policy "Users update own notification prefs"
  on public.live_notification_prefs for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Merge reminder entries into the caller's row (creating it if needed) and return
-- the new updated_at. Merging key-by-key means two devices editing different
-- reminders never overwrite each other. Values are validated: {"min": 0..40320},
-- {"off": true}, or null (remove the key); anything else is rejected. At most 200
-- keys per call.
create or replace function public.merge_my_reminders(p_entries jsonb)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_key text;
  v_val jsonb;
  v_at  timestamptz;
  v_set jsonb := '{}'::jsonb;
  v_del text[] := '{}';
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'object' then
    raise exception 'entries must be an object' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_entries)) > 200 then
    raise exception 'too many entries' using errcode = '22023';
  end if;
  for v_key, v_val in select key, value from jsonb_each(p_entries) loop
    if length(v_key) = 0 or length(v_key) > 300 then
      raise exception 'bad key' using errcode = '22023';
    end if;
    if v_val = 'null'::jsonb then
      v_del := array_append(v_del, v_key);
      continue;
    end if;
    -- coalesce: a missing "min" makes the comparisons NULL, and NOT NULL would
    -- silently let the value through.
    if not coalesce(
      (v_val = '{"off": true}'::jsonb)
      or (jsonb_typeof(v_val) = 'object'
          and (select count(*) from jsonb_object_keys(v_val)) = 1
          and jsonb_typeof(v_val -> 'min') = 'number'
          and (v_val ->> 'min')::numeric between 0 and 40320
          and (v_val ->> 'min')::numeric = floor((v_val ->> 'min')::numeric)),
      false
    ) then
      raise exception 'bad value for %', v_key using errcode = '22023';
    end if;
    v_set := v_set || jsonb_build_object(v_key, v_val);
  end loop;

  insert into public.live_notification_prefs as p (user_id, reminders, updated_at)
  values (v_uid, v_set, now())
  on conflict (user_id) do update
    set reminders = (p.reminders || excluded.reminders) - v_del,
        updated_at = now()
  returning p.updated_at into v_at;
  return v_at;
end;
$$;

-- ── Data API grants ─────────────────────────────────────────────────────────
-- Least privilege: signed-in users read/insert/update their own row (RLS above),
-- service_role for the Phase 2/3 senders. No anon, no delete (rows go with the user).
revoke all on public.live_notification_prefs from anon, public;
grant select, insert, update on public.live_notification_prefs to authenticated;
grant select, insert, update, delete on public.live_notification_prefs to service_role;

revoke all on function public.merge_my_reminders(jsonb) from public, anon;
grant execute on function public.merge_my_reminders(jsonb) to authenticated;
