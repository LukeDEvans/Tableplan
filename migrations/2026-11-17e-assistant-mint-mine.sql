-- Settings › Connected assistants: a signed-in person makes a connector key for
-- themselves (DUET_CONNECTOR_DESIGN.md §5). The secret is made on the device;
-- only its SHA-256 comes here, so no one else ever sees it.
--
-- Additive: one new function. Reading and revoking already work through the
-- table's own policies ("assistant keys: read own" / "revoke own").

create or replace function public.assistant_connector_mint_mine(p_name text, p_secret_hash text, p_write boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null then raise exception 'sign in' using errcode = '42501'; end if;
  -- Security definer skips the tables' require_mfa_when_enrolled policy, so check it here.
  if not public.session_meets_mfa() then raise exception 'authenticator code' using errcode = '42501'; end if;
  if coalesce(p_secret_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'bad secret hash' using errcode = '22023'; end if;
  if (select count(*) from public.assistant_connector_keys k where k.user_id = v_uid and k.revoked_at is null) >= 5 then
    raise exception 'at most 5 keys at a time; revoke one first' using errcode = '22023';
  end if;
  insert into public.assistant_connector_keys (user_id, name, secret_hash, scopes)
    values (v_uid, left(coalesce(nullif(btrim(p_name), ''), 'Assistant'), 60), p_secret_hash,
            case when p_write then array['read', 'write']::text[] else array['read']::text[] end)
    returning id into v_id;
  return v_id;
end $$;

revoke all on function public.assistant_connector_mint_mine(text, text, boolean) from public, anon;
grant execute on function public.assistant_connector_mint_mine(text, text, boolean) to authenticated;
