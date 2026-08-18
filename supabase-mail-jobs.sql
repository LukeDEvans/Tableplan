-- Durable mail-processing state, isolated from the IO-hot tableplan_states table.
-- Makes the Gmail sweep bounded, idempotent, atomically-claimed and circuit-broken
-- (see the 2026-08 Disk-IO incident: a per-notification read storm on
-- tableplan_states exhausted the connection pool). Service-role only.
--
-- Three tiny tables + a handful of atomic functions. The per-notification cost
-- becomes ONE cheap conditional claim on an isolated table; everything downstream
-- runs only if that claim wins.

-- ── Tables ───────────────────────────────────────────────────────────────────

-- email → user, the isolated per-notification lookup target (replaces gmailidx_*).
create table if not exists public.mail_accounts (
  email      text primary key,
  user_id    uuid not null,
  created_at timestamptz not null default now()
);

-- Per-user sweep control: the atomic claim lock + debounce + circuit-breaker
-- window + Gmail history checkpoint (replaces the lock/debounce/lastHistoryId
-- fields formerly living in the churny mailsugg_ JSONB row).
create table if not exists public.mail_sweep_state (
  user_id        uuid primary key,
  last_history_id text,
  locked_at      timestamptz,               -- in-progress lock (null = free)
  last_sweep_at  timestamptz,               -- when the last sweep finished (debounce)
  window_start   timestamptz not null default now(),
  window_count   int not null default 0,    -- sweeps in the current rolling hour (rate cap)
  enabled        boolean not null default true, -- zero-deploy kill switch (see mail_claim_sweep)
  updated_at     timestamptz not null default now()
);
alter table public.mail_sweep_state add column if not exists enabled boolean not null default true;

-- EMERGENCY STOP (no deploy, no Netlify credit): halt all sweeping instantly with
--   update public.mail_sweep_state set enabled = false;   -- (all users)
-- Re-enable with  set enabled = true;  Checked inside the atomic claim below, which
-- already runs on every notification, so it costs nothing extra.

-- Per-message idempotency + bounded retries + quarantine (replaces the
-- processedIds[]/attempts{}/retryIds[] arrays). A message is worked at most
-- MAX_ATTEMPTS times, then 'gave_up' (quarantined), and never re-extracted once 'done'.
create table if not exists public.mail_processed (
  message_id text primary key,
  user_id    uuid not null,
  status     text not null default 'processing',  -- processing | done | failed | gave_up
  attempts   int  not null default 1,
  first_seen timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  error      text
);
create index if not exists idx_mail_processed_user_status on public.mail_processed (user_id, status, first_seen);

-- RLS on; no public policies. The service role (used by the Netlify functions)
-- bypasses RLS, so only server-side code can touch these tables.
alter table public.mail_accounts    enable row level security;
alter table public.mail_sweep_state enable row level security;
alter table public.mail_processed   enable row level security;

-- ── Atomic functions ─────────────────────────────────────────────────────────

-- Atomically claim the right to sweep for a user. Returns true only to the ONE
-- caller that wins the row lock and passes debounce + in-progress + rate-cap
-- checks. Everything expensive runs only when this returns true, so a
-- notification burst becomes a stream of cheap no-op claims on this tiny table.
create or replace function public.mail_claim_sweep(
  p_user uuid, p_cap int, p_min_interval_s int, p_stale_s int
) returns boolean
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_row public.mail_sweep_state;
  v_wstart timestamptz;
  v_wcount int;
begin
  insert into public.mail_sweep_state (user_id) values (p_user)
    on conflict (user_id) do nothing;

  -- Serialize concurrent claims for this user on the row lock.
  select * into v_row from public.mail_sweep_state where user_id = p_user for update;

  -- Emergency kill switch (no deploy needed): halt all sweeping for this user.
  if v_row.enabled is not true then
    return false;
  end if;

  -- Rolling 1-hour window for the circuit breaker.
  if v_row.window_start is null or v_now - v_row.window_start > interval '1 hour' then
    v_wstart := v_now; v_wcount := 0;
  else
    v_wstart := v_row.window_start; v_wcount := v_row.window_count;
  end if;

  if v_row.last_sweep_at is not null and v_now - v_row.last_sweep_at < make_interval(secs => p_min_interval_s) then
    return false; -- debounced
  end if;
  if v_row.locked_at is not null and v_now - v_row.locked_at < make_interval(secs => p_stale_s) then
    return false; -- another sweep in progress
  end if;
  if v_wcount >= p_cap then
    return false; -- circuit breaker tripped for this window
  end if;

  update public.mail_sweep_state
     set locked_at = v_now, window_start = v_wstart, window_count = v_wcount + 1, updated_at = v_now
   where user_id = p_user;
  return true;
end;
$$;

-- Release the lock and record the finished-sweep time + new history checkpoint.
create or replace function public.mail_release_sweep(p_user uuid, p_history_id text)
returns void language sql as $$
  update public.mail_sweep_state
     set locked_at = null,
         last_sweep_at = now(),
         last_history_id = coalesce(nullif(p_history_id, ''), last_history_id),
         updated_at = now()
   where user_id = p_user;
$$;

-- Record/bump each candidate message and return the batch to actually process
-- (new + carried-over still-pending, oldest first, capped). Terminal messages
-- ('done'/'gave_up') are skipped; anything past the attempt cap is quarantined.
-- One call gives a sweep its exact, bounded work list with attempts recorded.
create or replace function public.mail_take_messages(
  p_user uuid, p_ids text[], p_max int, p_limit int
) returns setof text
language plpgsql
as $$
begin
  -- Quarantine anything that already used up its attempts.
  update public.mail_processed set status = 'gave_up', updated_at = now()
   where user_id = p_user and status in ('processing', 'failed') and attempts >= p_max;

  -- Register new candidates (idempotent; attempts start at 0, bumped when picked).
  if array_length(p_ids, 1) is not null then
    insert into public.mail_processed (message_id, user_id, status, attempts)
      select x, p_user, 'processing', 0 from unnest(p_ids) as x
    on conflict (message_id) do nothing;
  end if;

  -- Pick the bounded batch to attempt now (new + carried-over pending, oldest
  -- first, under the cap); bump THEIR attempts and return them so a persistently
  -- failing message reliably reaches the cap. `skip locked` guards concurrency.
  return query
  with batch as (
    select message_id from public.mail_processed
     where user_id = p_user and status in ('processing', 'failed') and attempts < p_max
     order by first_seen asc
     limit p_limit
     for update skip locked
  )
  update public.mail_processed m
     set attempts = m.attempts + 1, updated_at = now()
    from batch
   where m.message_id = batch.message_id
   returning m.message_id;
end;
$$;

-- Mark the successfully-processed messages done (idempotent).
create or replace function public.mail_mark_done(p_ids text[])
returns void language sql as $$
  update public.mail_processed set status = 'done', updated_at = now()
   where message_id = any(p_ids);
$$;

-- Retention: drop old terminal rows so the table stays tiny (called opportunistically).
create or replace function public.mail_prune_processed(p_days int)
returns void language sql as $$
  delete from public.mail_processed
   where status in ('done', 'gave_up') and updated_at < now() - make_interval(days => p_days);
$$;

-- ── One-time backfill (already applied 2026-08-18) ───────────────────────────
-- Populates the new tables from the legacy tableplan_states rows so nothing
-- reprocesses on cutover. Idempotent (on conflict do nothing); safe to re-run.
insert into public.mail_accounts (email, user_id)
  select lower(state->>'email'), substr(id, 7)::uuid from public.tableplan_states
   where id ~ '^gmail_[0-9a-f-]{36}$' and state->>'email' is not null
on conflict (email) do nothing;
insert into public.mail_sweep_state (user_id, last_history_id, last_sweep_at)
  select substr(id, 10)::uuid, nullif(state->>'lastHistoryId',''),
         case when state->>'lastSweepAt' ~ '^\d{4}-' then (state->>'lastSweepAt')::timestamptz else null end
    from public.tableplan_states where id like 'mailsugg\_%'
on conflict (user_id) do nothing;
insert into public.mail_processed (message_id, user_id, status, attempts)
  select jsonb_array_elements_text(state->'processedIds'), substr(id, 10)::uuid, 'done', 1
    from public.tableplan_states where id like 'mailsugg\_%' and jsonb_typeof(state->'processedIds') = 'array'
on conflict (message_id) do nothing;
