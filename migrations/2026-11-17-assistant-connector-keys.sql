-- Assistant connector keys (DUET_CONNECTOR_DESIGN.md; Luke, 2026-11-17).
--
-- Lets an outside AI assistant (Claude Duet first; any MCP client later) read Liv
-- through the liv-mcp Edge Function, without holding the person's sign-in. Same
-- shape as photo-sync devices: each key is a random secret that only the assistant
-- keeps; the database stores its SHA-256. The key is "<id>.<secret>".
--
-- A key can do only what its scopes say, and only through liv-mcp, which only the
-- server (service_role) may call these functions for:
--   • 'read'  — the read tools (calendar, meal plan, tasks, shopping list, recipes,
--               watchlist, trips). This is the only scope in the first version.
--   • 'write' — reserved for the second phase (bounded write tools); nothing honours
--               it yet, and the check below refuses any scope it doesn't know.
-- A key acts as its owner and sees only its owner's views (Personal rows, their
-- household's rows, their business space). Never another person's Personal rows.
-- The owner sees their keys and can revoke one (revoking is final).
--
-- A key is also rate-limited in the database: at most 120 calls in any 10-minute
-- window (Duet checks every few hours; a runaway loop is cut off, not billed).
--
-- Additive only: one new table, its guard, four functions (guard, mint, check, state read).

create table if not exists public.assistant_connector_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null default '' check (char_length(name) <= 60),
  secret_hash  text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  scopes       text[] not null default array['read']::text[]
               check (scopes <@ array['read', 'write']::text[] and cardinality(scopes) >= 1),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  window_start timestamptz,
  window_count integer not null default 0,
  revoked_at   timestamptz
);
create index if not exists assistant_connector_keys_user on public.assistant_connector_keys (user_id);
alter table public.assistant_connector_keys enable row level security;

-- Revoking is the only change an owner can make, and it can't be undone. The usage
-- columns are the server's (the check function below).
create or replace function public.assistant_connector_keys_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.secret_hash <> old.secret_hash
     or new.scopes <> old.scopes or new.created_at <> old.created_at or new.name <> old.name then
    raise exception 'a connector key is fixed' using errcode = '42501';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'a revoked connector key stays revoked' using errcode = '42501';
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'assistant_connector_keys_guard' and tgrelid = 'public.assistant_connector_keys'::regclass) then
    create trigger assistant_connector_keys_guard before update on public.assistant_connector_keys
      for each row execute function public.assistant_connector_keys_guard();
  end if;
end $$;

-- Mint a key for a person. Called by the server after checking their sign-in
-- (the Settings screen, phase 2) — or once from the SQL editor for the first test,
-- with a hash computed elsewhere (the secret itself never reaches the database).
create or replace function public.assistant_connector_mint(p_user uuid, p_name text, p_secret_hash text, p_scopes text[] default array['read']::text[])
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare v_id uuid;
begin
  -- Defense in depth beside the grants below: only the server (or the SQL editor,
  -- which carries no JWT) may call this, even before the revokes have run.
  if coalesce((select auth.role()), 'service_role') <> 'service_role' then
    raise exception 'server only' using errcode = '42501';
  end if;
  if p_user is null then raise exception 'no user' using errcode = '42501'; end if;
  insert into public.assistant_connector_keys (user_id, name, secret_hash, scopes)
    values (p_user, left(coalesce(p_name, ''), 60), p_secret_hash, coalesce(p_scopes, array['read']::text[]))
    returning id into v_id;
  return v_id;
end $$;

-- The owner and scopes behind a key, if it's live and under its rate limit. Counts
-- the call. Returns no row for an unknown, wrong, revoked or over-limit key; the
-- caller can't tell which (the function says 'limited' only via the flag column).
create or replace function public.assistant_connector_check(p_key uuid, p_secret_hash text)
returns table (user_id uuid, scopes text[], limited boolean)
language plpgsql volatile security definer set search_path = ''
as $$
declare r public.assistant_connector_keys;
begin
  -- Defense in depth beside the grants below: only the server (or the SQL editor,
  -- which carries no JWT) may call this, even before the revokes have run.
  if coalesce((select auth.role()), 'service_role') <> 'service_role' then
    raise exception 'server only' using errcode = '42501';
  end if;
  select * into r from public.assistant_connector_keys k
    where k.id = p_key and k.secret_hash = p_secret_hash and k.revoked_at is null
    for update;
  if not found then return; end if;
  if r.window_start is null or r.window_start < now() - interval '10 minutes' then
    update public.assistant_connector_keys set window_start = now(), window_count = 1, last_used_at = now() where id = r.id;
  elsif r.window_count >= 120 then
    return query select r.user_id, r.scopes, true;
    return;
  else
    update public.assistant_connector_keys set window_count = r.window_count + 1, last_used_at = now() where id = r.id;
  end if;
  return query select r.user_id, r.scopes, false;
end $$;

-- Read just some paths of one state row (e.g. 'plans.2026-11-13', 'doBacklog'), so
-- a tool moves a few KB instead of a whole section. Service role only; liv-mcp
-- decides which rows a key may read (views.js rules) before calling it. At most
-- 12 paths of up to 4 parts each.
create or replace function public.assistant_state_read(p_row text, p_paths text[])
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_state jsonb; v_out jsonb := '{}'::jsonb; p text; parts text[];
begin
  -- Defense in depth beside the grants below: only the server (or the SQL editor,
  -- which carries no JWT) may call this, even before the revokes have run.
  if coalesce((select auth.role()), 'service_role') <> 'service_role' then
    raise exception 'server only' using errcode = '42501';
  end if;
  if cardinality(p_paths) > 12 then raise exception 'too many paths' using errcode = '22023'; end if;
  select s.state into v_state from public.tableplan_states s where s.id = p_row;
  if v_state is null then return null; end if;
  foreach p in array p_paths loop
    parts := string_to_array(p, '.');
    if cardinality(parts) between 1 and 4 then
      v_out := v_out || jsonb_build_object(p, v_state #> parts);
    end if;
  end loop;
  return v_out;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assistant_connector_keys' and policyname = 'assistant keys: read own') then
    create policy "assistant keys: read own" on public.assistant_connector_keys for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assistant_connector_keys' and policyname = 'assistant keys: revoke own') then
    create policy "assistant keys: revoke own" on public.assistant_connector_keys for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;

revoke all on public.assistant_connector_keys from anon, authenticated;
grant select (id, name, scopes, created_at, last_used_at, revoked_at) on public.assistant_connector_keys to authenticated;
grant update (revoked_at) on public.assistant_connector_keys to authenticated;
grant all on public.assistant_connector_keys to service_role;

revoke all on function public.assistant_connector_keys_guard() from public, anon, authenticated;
revoke all on function public.assistant_connector_mint(uuid, text, text, text[]), public.assistant_connector_check(uuid, text),
  public.assistant_state_read(text, text[]) from public, anon, authenticated;
grant execute on function public.assistant_connector_mint(uuid, text, text, text[]), public.assistant_connector_check(uuid, text),
  public.assistant_state_read(text, text[]) to service_role;
