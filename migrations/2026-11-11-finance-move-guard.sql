-- Finance: the move guard (FINANCE_SPLIT_DESIGN.md §8, step 3).
--
-- NOT APPLIED YET — waits for Luke's OK with the rest of step 3.
--
-- tp_protect_finance_merge (BEFORE UPDATE on tableplan_states, rows "%:finance")
-- deep-unions the per-transaction maps on every write, so that a device with an
-- old copy can never blank another device's labels. That same union would put
-- back everything a move takes OUT of a finance row (an account marked Personal
-- leaves the household's row), and a device with an old copy would re-send it.
--
-- This version keeps every existing rule and adds three:
--
--   A. The move itself — a server write with the header "x-live-finance-move: 1"
--      made with the service role — is taken as written: no union, no
--      empty-never-erases. Top-level keys it omits are still kept.
--   B. Nobody else can change "financeMovedOut" (the record of what has left
--      this row: { epoch, accounts, linked, txns }). After every other write,
--      whatever it lists is stripped from the row again, so an older copy can't
--      bring a moved account or anything keyed by its transactions back.
--   C. A writer whose copy predates the latest move (its financeMovedOut.epoch
--      is lower than the row's) can't replace the month totals, which were
--      reset by the move and are rebuilt by a device that has seen it.
--
-- Additive only: replaces the function body; the trigger itself is unchanged.

create or replace function public.tp_protect_finance_merge()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  old_ver int;
  new_ver int;
  k text;
  -- Flat keyed maps (txnId / merchantKey / month -> value) that are only ever
  -- added to on a given device. A stale writer (e.g. a backgrounded phone whose
  -- balance-refresh keeps re-saving its old finance copy) must never DROP an
  -- entry another device added, so these are DEEP-unioned rather than replaced
  -- wholesale by step 1. Mirrors the client's unionByKey. Trade-off: removing a
  -- key (unlabel / clear a name) won't propagate across devices without an
  -- explicit tombstone -- data preservation is the priority here.
  additive_keys text[] := array[
    'financeMerchantNames','financeTxnLabels','financeTxnRules',
    'financeTxnNoteOverrides','financeTxnNoteCounts','financeTxnLinks',
    'financeTxnSignFlips','financeMonthActuals'
  ];
  -- Maps keyed by a transaction id (finance-transactions.js FINANCE_TXN_ID_MAPS).
  txn_keys text[] := array[
    'financeTxnLabels','financeTxnSignFlips','financeTxnNoteOverrides','financeTxnReceipts',
    'financeTxnConfirmed','financeNotifDismissed','financeTxnLinks'
  ];
  -- Maps whose keys may be "id:<txnId>" or "<kind>:<txnId>" (finance-move.js MIXED_KEY_MAPS).
  mixed_keys text[] := array['financeLabelSkips','financeLabelSnoozes','financeDismissedAlerts'];
  account_lists text[] := array['financeCashAccountIds','financeEmergencyAccountIds','financeRetirementAccountIds'];
  raw_headers text := current_setting('request.headers', true);
  raw_claims text := current_setting('request.jwt.claims', true);
  is_move boolean := false;
  moved jsonb;
  old_epoch int;
  new_epoch int;
  gone_accounts text[];
  gone_linked text[];
  gone_txns text[];
begin
  if NEW.id not like '%:finance' then
    return NEW;
  end if;
  if OLD.state is null or jsonb_typeof(OLD.state) <> 'object' then
    return NEW;
  end if;
  if NEW.state is null or jsonb_typeof(NEW.state) <> 'object' then
    NEW.state := OLD.state;
    return NEW;
  end if;

  -- A) The move: the server (service role) says so in a header.
  begin
    is_move := coalesce((raw_headers::json)->>'x-live-finance-move', '') = '1'
               and coalesce((raw_claims::json)->>'role', '') = 'service_role';
  exception when others then
    is_move := false;
  end;
  if is_move then
    NEW.state := OLD.state || NEW.state;   -- still never drop a key it omitted
    return NEW;
  end if;

  old_ver := coalesce((OLD.state->>'schemaVersion')::int, 0);
  new_ver := coalesce((NEW.state->>'schemaVersion')::int, 0);
  begin
    old_epoch := coalesce((OLD.state->'financeMovedOut'->>'epoch')::int, 0);
    new_epoch := coalesce((NEW.state->'financeMovedOut'->>'epoch')::int, 0);
  exception when others then
    old_epoch := 0; new_epoch := 0;
  end;

  -- 0) Deep-union the additive per-transaction maps (old base, incoming wins per
  --    sub-key) so a stale writer can never blank out another device's labels,
  --    renames, notes, splits, sign-flips, links, or month actuals.
  foreach k in array additive_keys loop
    if jsonb_typeof(OLD.state->k) = 'object' and jsonb_typeof(NEW.state->k) = 'object' then
      NEW.state := jsonb_set(NEW.state, array[k], (OLD.state->k) || (NEW.state->k));
    end if;
  end loop;

  -- 1) Never drop a top-level key the writer omitted.
  NEW.state := OLD.state || NEW.state;

  -- 2) An older-schema client may not touch finance* keys.
  if new_ver < old_ver then
    NEW.state := NEW.state || (
      select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      from jsonb_each(OLD.state)
      where key like 'finance%'
    );
  end if;

  -- 3) Empty-never-erases, but ONLY for record arrays where [] is never a
  --    valid user state. A freshly booted client's mirror omits finance, so
  --    these come up []; an incoming empty must not blank a populated one.
  --    NOTE: the *AccountIds selection arrays are deliberately excluded --
  --    there [] legitimately means "auto", so clearing a card must be allowed.
  --    CASE guards keep jsonb_array_length off any non-array value.
  NEW.state := NEW.state || (
    select coalesce(jsonb_object_agg(o.key, o.value), '{}'::jsonb)
    from jsonb_each(OLD.state) o
    where o.key in ('financeAccounts', 'financePeople', 'financePersonal')
      and (case when jsonb_typeof(o.value) = 'array'
                then jsonb_array_length(o.value) else 0 end) > 0
      and (case when jsonb_typeof(NEW.state->o.key) = 'array'
                then jsonb_array_length(NEW.state->o.key) else -1 end) = 0
  );

  -- 4) Budget groups boot as 3 groups with EMPTY categories (array length 3,
  --    not 0), so guard on total category count: a write that would zero out
  --    categories the existing row still has keeps the existing groups.
  if jsonb_typeof(OLD.state->'financeBudgetGroups') = 'array'
     and jsonb_typeof(NEW.state->'financeBudgetGroups') = 'array'
     and coalesce((
        select sum(jsonb_array_length(coalesce(g->'categories','[]'::jsonb)))
        from jsonb_array_elements(OLD.state->'financeBudgetGroups') g
      ), 0) > 0
     and coalesce((
        select sum(jsonb_array_length(coalesce(g->'categories','[]'::jsonb)))
        from jsonb_array_elements(NEW.state->'financeBudgetGroups') g
      ), 0) = 0
  then
    NEW.state := jsonb_set(NEW.state, '{financeBudgetGroups}', OLD.state->'financeBudgetGroups');
  end if;

  -- B) Only the move changes the record of what has left this row.
  moved := OLD.state->'financeMovedOut';
  if moved is null or jsonb_typeof(moved) <> 'object' then
    NEW.state := NEW.state - 'financeMovedOut';
    return NEW;
  end if;
  NEW.state := jsonb_set(NEW.state, '{financeMovedOut}', moved);

  -- C) A copy from before the latest move can't replace the month totals.
  if new_epoch < old_epoch and OLD.state ? 'financeMonthActuals' then
    NEW.state := jsonb_set(NEW.state, '{financeMonthActuals}', OLD.state->'financeMonthActuals');
  end if;

  -- B, continued) Strip whatever has left, in case this write carried it back.
  gone_accounts := coalesce(array(select jsonb_array_elements_text(
    case when jsonb_typeof(moved->'accounts') = 'array' then moved->'accounts' else '[]'::jsonb end)), '{}');
  gone_linked := coalesce(array(select jsonb_array_elements_text(
    case when jsonb_typeof(moved->'linked') = 'array' then moved->'linked' else '[]'::jsonb end)), '{}');
  gone_txns := coalesce(array(select jsonb_array_elements_text(
    case when jsonb_typeof(moved->'txns') = 'array' then moved->'txns' else '[]'::jsonb end)), '{}');

  if cardinality(gone_txns) > 0 then
    foreach k in array txn_keys loop
      if jsonb_typeof(NEW.state->k) = 'object' then
        NEW.state := jsonb_set(NEW.state, array[k], (NEW.state->k) - gone_txns);
      end if;
    end loop;
    foreach k in array mixed_keys loop
      if jsonb_typeof(NEW.state->k) = 'object' then
        NEW.state := jsonb_set(NEW.state, array[k], (
          select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
          from jsonb_each(NEW.state->k) e
          where not (substring(e.key from position(':' in e.key) + 1) = any(gone_txns))
        ));
      end if;
    end loop;
    if jsonb_typeof(NEW.state->'financeManualTxns') = 'array' then
      NEW.state := jsonb_set(NEW.state, '{financeManualTxns}', (
        select coalesce(jsonb_agg(m order by ord), '[]'::jsonb)
        from jsonb_array_elements(NEW.state->'financeManualTxns') with ordinality as t(m, ord)
        where not (coalesce(m->>'id', '') = any(gone_txns))
      ));
    end if;
  end if;

  if cardinality(gone_accounts) > 0 or cardinality(gone_linked) > 0 then
    if jsonb_typeof(NEW.state->'financeAccounts') = 'array' then
      NEW.state := jsonb_set(NEW.state, '{financeAccounts}', (
        select coalesce(jsonb_agg(a order by ord), '[]'::jsonb)
        from jsonb_array_elements(NEW.state->'financeAccounts') with ordinality as t(a, ord)
        where not (coalesce(a->>'id', '') = any(gone_accounts))
          and not (coalesce(a->>'linkedId', '') <> '' and (a->>'linkedId') = any(gone_linked))
      ));
    end if;
    foreach k in array account_lists loop
      if jsonb_typeof(NEW.state->k) = 'array' then
        NEW.state := jsonb_set(NEW.state, array[k], (
          select coalesce(jsonb_agg(x order by ord), '[]'::jsonb)
          from jsonb_array_elements(NEW.state->k) with ordinality as t(x, ord)
          where not ((x #>> '{}') = any(gone_accounts))
        ));
      end if;
    end loop;
    if jsonb_typeof(NEW.state->'financeAccountSubLabels') = 'object' then
      NEW.state := jsonb_set(NEW.state, '{financeAccountSubLabels}', (NEW.state->'financeAccountSubLabels') - gone_accounts);
    end if;
  end if;

  return NEW;
end;
$function$;
