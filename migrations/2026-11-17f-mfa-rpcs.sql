-- The authenticator code, part 3 (ISSUES.md P1, Luke's OK 2026-11-17).
-- Security-definer functions skip row security, so the tables'
-- require_mfa_when_enrolled policy (2026-11-17c) doesn't cover them. A sign-in
-- that skipped the code (aal1) could still call them directly. This adds
-- session_meets_mfa() to:
--   • doc_can_access: the gate behind every Documents / Photos function
--     (doc_*purge*, doc_pdrop_moved_receipt, photo_purge, *_deletable, usage,
--     doc_vault_scope, doc_grant_ok, photo_can_access / photo_blob_allowed);
--   • the messaging functions that act on auth.uid() directly;
--   • doc_shares_group and msg_contacts.
-- Left alone on purpose: live_get_my_*_ids / live_is_group_creator. They only
-- return the caller's own group ids, and they sit inside nearly every table's
-- policies, which the restrictive policy already gates.
-- Nobody without a verified factor is affected: session_meets_mfa() is true for them,
-- and for service-role calls (no auth.uid()).

-- Boolean SQL functions: select X  →  select (select public.session_meets_mfa()) and (X)
do $$
declare f text; def text; fixed text;
begin
  foreach f in array array['public.doc_can_access(text)', 'public.msg_is_member(uuid)', 'public.msg_can_contact(uuid)', 'public.doc_shares_group(uuid)'] loop
    def := pg_get_functiondef(f::regprocedure);
    if position('session_meets_mfa' in def) > 0 then continue; end if;
    fixed := regexp_replace(def, '\$function\$\s*select\s(.*?);?\s*\$function\$', '$function$ select (select public.session_meets_mfa()) and (\1) $function$');
    if fixed = def then raise exception 'no change for %', f; end if;
    execute fixed;
  end loop;
end $$;

-- msg_contacts returns rows: keep them only for a session that meets the rule.
do $$
declare def text; fixed text;
begin
  def := pg_get_functiondef('public.msg_contacts()'::regprocedure);
  if position('session_meets_mfa' in def) = 0 then
    fixed := regexp_replace(def, '\$function\$\s*(select\s.*?);?\s*\$function\$', '$function$ select * from (\1) q where (select public.session_meets_mfa()) $function$');
    if fixed = def then raise exception 'no change for msg_contacts'; end if;
    execute fixed;
  end if;
end $$;

-- plpgsql messaging functions: refuse before doing anything.
do $$
declare f text; def text; fixed text;
begin
  foreach f in array array['public.msg_add_members(uuid,uuid[])', 'public.msg_claim_prekey(uuid)', 'public.msg_create_conversation(uuid,uuid[])', 'public.msg_remove_member(uuid,uuid)', 'public.msg_reset_identity(text)', 'public.msg_send(uuid,uuid,jsonb)'] loop
    def := pg_get_functiondef(f::regprocedure);
    if position('session_meets_mfa' in def) > 0 then continue; end if;
    fixed := regexp_replace(def, '\mbegin\M', E'begin\n  if not public.session_meets_mfa() then raise exception ''authenticator code'' using errcode = ''42501''; end if;', 'i');
    if fixed = def then raise exception 'no change for %', f; end if;
    execute fixed;
  end loop;
end $$;
