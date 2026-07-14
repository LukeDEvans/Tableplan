-- Stale-writer protection for tableplan_states, in two stages.
-- Root cause of the repeated data wipes (Jul 10, Jul 14): a device running an
-- old cached bundle (e.g. a suspended phone PWA waking with week-old code)
-- syncs mergeless/stale state over good data. Client-side fixes cannot reach
-- a client that never loads them — only the database can refuse the write.

-- ── Stage 1: immediate tripwire (safe to apply before any deploy) ────────────
-- Blocks the one signature every stale client carries: the legacy hardcoded
-- "MJ" default household member, which current code can never produce.
create or replace function public.block_stale_client_signature()
returns trigger language plpgsql as $$
begin
  if new.id like '%:eat'
     and new.state->'mealPlanConfig'->'members' @> '[{"label":"MJ"}]'::jsonb then
    raise exception 'stale client write rejected (legacy default household)';
  end if;
  return new;
end $$;

drop trigger if exists block_stale_client_signature on public.tableplan_states;
create trigger block_stale_client_signature
before insert or update on public.tableplan_states
for each row execute function public.block_stale_client_signature();

-- ── Stage 2: writer-version gate (apply ONLY AFTER the x-live-writer deploy
--    is live and Luke's devices have reloaded — otherwise current clients
--    would be locked out of writing) ─────────────────────────────────────────
-- Current app + server functions stamp every PostgREST write with the header
-- x-live-writer: 2. Any PostgREST write to a per-user section row without the
-- header is a stale bundle and gets rejected. Direct SQL sessions (repair /
-- admin work) carry no request.headers and are exempt.
--
-- create or replace function public.enforce_live_writer()
-- returns trigger language plpgsql as $$
-- declare
--   hdrs text := nullif(current_setting('request.headers', true), '');
-- begin
--   if new.id !~ ':(eat|grocery|do|play|watch|media|plan|health|inventory|recreate|travel|config)$' then
--     return new;                      -- only gate app-state section rows
--   end if;
--   if hdrs is null then return new;  -- direct DB session (admin/repair)
--   end if;
--   if coalesce(hdrs::json->>'x-live-writer', '') = '' then
--     raise exception 'stale client write rejected (app update required)';
--   end if;
--   return new;
-- end $$;
--
-- drop trigger if exists enforce_live_writer on public.tableplan_states;
-- create trigger enforce_live_writer
-- before insert or update on public.tableplan_states
-- for each row execute function public.enforce_live_writer();
