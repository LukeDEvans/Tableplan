// Finance: the move (FINANCE_SPLIT_DESIGN.md §2.4 and §8, step 3).
//
// Moves accounts between the household's finance and one member's own, on the
// server, with the service role. The same function runs the dry run (nothing is
// written; the report is returned) and the move, in either direction:
//
//   toPersonal  — <groupId>:finance  →  u-<userId>:finance
//   toHousehold — the reverse
//
// What moves, and where from → to (the planning is finance-move.js, pure):
//   - the finance section's account entries and everything keyed by their
//     transactions;
//   - stored transactions: finance_transactions.group_id;
//   - the assignment: live_finance_account_views (a row = Personal);
//   - balance history: finhist_<scope>;
//   - the bank cache: finaccts_<scope>.
//
// Order, chosen so that stopping anywhere leaves nothing lost and a re-run
// finishes the job (each step is idempotent):
//   1. backup of everything it is about to touch (finmovebackup_<groupId>);
//   2. the assignment — from here every bank pull already sorts the accounts
//      the new way, so no new data lands on the wrong side;
//   3. stored transactions;
//   4. balance history and bank cache;
//   5. the receiving finance section, then the one the accounts leave. Both are
//      written with "x-live-finance-move: 1", which the database trigger takes
//      as written (migrations/2026-11-11-finance-move-guard.sql);
//   6. a fresh daily-backup baseline for both scopes, so the nightly backup's
//      "never store a poorer copy" rule doesn't refuse the smaller section;
//   7. read back and check that nothing that moved is still where it left.
//
// Only the household's admin can move accounts, and only into their own
// personal finance (multi-view is admin-only: VIEWS_DESIGN §2.1).
//
// Nothing here logs an account id, a name, an amount or a description.

const DEFAULT_SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const MAX_ROWS = 20000;
const PAGE = 1000;
const BACKUP_DAYS = 30;

let _pure = null;
async function pure() {
  if (!_pure) _pure = await import("../../finance-move.js");
  return _pure;
}

function svc(serviceKey, extra = {}) {
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json", "content-type": "application/json", "x-live-writer": "2", ...extra };
}
const personalScopeId = (userId) => `u-${userId}`;
const inList = (values) => `in.(${values.map((v) => `"${String(v).replace(/["\\]/g, (c) => `\\${c}`)}"`).join(",")})`;
const dateKey = (d) => d.toISOString().slice(0, 10);

/**
 * @param {object} p
 * @param {string} p.serviceKey
 * @param {string} p.groupId
 * @param {string} p.userId       the caller (must be the group's admin)
 * @param {"toPersonal"|"toHousehold"} p.direction
 * @param {string[]} p.accountIds ids of finance account entries to move
 * @param {boolean} [p.dryRun]    true = report only, nothing written
 * @returns {Promise<{ status?: number, error?: string, ok?: boolean, dryRun?: boolean, report?: object, verified?: object }>}
 */
async function moveFinanceAccounts({ serviceKey, groupId, userId, direction, accountIds, dryRun = true, supabaseUrl = DEFAULT_SUPABASE_URL, fetchImpl = fetch, now = () => new Date() }) {
  if (direction !== "toPersonal" && direction !== "toHousehold") return { status: 400, error: "Unknown direction." };
  const ids = [...new Set((Array.isArray(accountIds) ? accountIds : []).map(String).filter(Boolean))];
  if (!ids.length) return { status: 400, error: "Pick at least one account." };
  const rest = `${supabaseUrl}/rest/v1`;
  const get = async (path) => {
    const res = await fetchImpl(`${rest}/${path}`, { headers: svc(serviceKey), cache: "no-store" });
    if (!res.ok) throw new Error(`read ${res.status}`);
    return res.json();
  };
  const loadState = async (id) => (await get(`tableplan_states?id=eq.${encodeURIComponent(id)}&select=state`))[0]?.state || null;
  const saveState = async (id, state, extraHeaders = {}) => {
    const res = await fetchImpl(`${rest}/tableplan_states?on_conflict=id`, {
      method: "POST",
      headers: svc(serviceKey, { prefer: "resolution=merge-duplicates,return=minimal", ...extraHeaders }),
      body: JSON.stringify({ id, state, updated_at: now().toISOString() }),
    });
    if (!res.ok) throw new Error(`write ${res.status}`);
  };

  // Who is asking.
  const members = await get(`live_group_members?group_id=eq.${encodeURIComponent(groupId)}&select=user_id,role`);
  const me = (Array.isArray(members) ? members : []).find((m) => String(m.user_id) === String(userId));
  if (!me || me.role !== "admin") return { status: 403, error: "Only the household's admin can move accounts." };

  const personal = personalScopeId(userId);
  const fromScope = direction === "toPersonal" ? groupId : personal;
  const toScope = direction === "toPersonal" ? personal : groupId;

  // Everything the plan needs.
  const fromSection = await loadState(`${fromScope}:finance`);
  if (!fromSection) return { status: 409, error: "There's no finance data to move from." };
  const toSection = (await loadState(`${toScope}:finance`)) || {};
  const storeRows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const page = await get(`finance_transactions?group_id=eq.${encodeURIComponent(fromScope)}&select=id,account_id,description&order=id&limit=${PAGE}&offset=${offset}`);
    storeRows.push(...page);
    if (page.length < PAGE) break;
  }
  if (storeRows.length >= MAX_ROWS) return { status: 409, error: "Too many stored transactions to move in one go." };

  const { planFinanceMove, moveBalanceHistory, storeAccountIdsFor, normalizeMovedOut } = await pure();
  // Rows an earlier, interrupted run already carried across still decide which
  // labels and notes belong to the accounts, so they are part of the plan too.
  const wanted = new Set(ids);
  const movingStoreIds = (Array.isArray(fromSection.financeAccounts) ? fromSection.financeAccounts : [])
    .filter((a) => a && wanted.has(String(a.id))).flatMap(storeAccountIdsFor);
  if (movingStoreIds.length) {
    const across = await get(`finance_transactions?group_id=eq.${encodeURIComponent(toScope)}&account_id=${encodeURIComponent(inList(movingStoreIds))}&select=id,account_id,description&limit=${MAX_ROWS}`);
    const have = new Set(storeRows.map((r) => String(r.id)));
    for (const r of across) if (!have.has(String(r.id))) storeRows.push(r);
  }
  // A run that stopped after both sections were written has nothing left to
  // plan: finish its last two steps (backup baseline, check) and report.
  const leftAlready = normalizeMovedOut(fromSection.financeMovedOut);
  const arrived = (Array.isArray(toSection.financeAccounts) ? toSection.financeAccounts : []).filter((a) => a && wanted.has(String(a.id)));
  if (!movingStoreIds.length && arrived.length === ids.length && ids.every((id) => leftAlready.accounts.includes(id))) {
    if (dryRun) return { ok: true, dryRun: true, alreadyMoved: true, report: { accounts: arrived.map((a) => ({ id: String(a.id), name: a.name || "" })), direction, problems: [] } };
    const done = { txnIds: leftAlready.txns, linkedIds: arrived.filter((a) => a.linkedId).map((a) => String(a.linkedId)), storeAccountIds: arrived.flatMap(storeAccountIdsFor), from: fromSection, to: toSection };
    await writeBackupBaselines({ loadState, saveState, now, sections: [[toScope, toSection], [fromScope, fromSection]] });
    const verified = await verifyMoved({ get, loadState, fromScope, plan: done, ids });
    return { ok: true, dryRun: false, alreadyMoved: true, verified };
  }
  const plan = planFinanceMove({ from: fromSection, to: toSection, accountIds: ids, storeRows });
  if (!plan.ok) return { status: 400, error: plan.error, problems: plan.problems || [] };

  const fromHist = (await loadState(`finhist_${fromScope}`)) || {};
  const toHist = (await loadState(`finhist_${toScope}`)) || {};
  const hist = moveBalanceHistory({ fromDays: fromHist.days, toDays: toHist.days, accountIds: ids });
  const report = { ...plan.report, direction, historyDays: hist.daysTouched };
  if (dryRun) return { ok: true, dryRun: true, report };

  // 1. Backup of everything about to change.
  const fromCache = await loadState(`finaccts_${fromScope}`);
  const toCache = await loadState(`finaccts_${toScope}`);
  const backupId = `finmovebackup_${groupId}`;
  const backups = ((await loadState(backupId)) || {}).backups || {};
  const cutoff = now().getTime() - BACKUP_DAYS * 86400000;
  for (const k of Object.keys(backups)) if (new Date(k).getTime() < cutoff) delete backups[k];
  backups[now().toISOString()] = {
    by: userId, direction, accountIds: ids, txnIds: plan.txnIds, linkedIds: plan.linkedIds, fromScope, toScope,
    fromSection, toSection, fromHistory: fromHist, toHistory: toHist, fromCache, toCache,
  };
  await saveState(backupId, { backups });

  // 2. The assignment (bank accounts only; a manual account has no row).
  if (plan.linkedIds.length) {
    if (direction === "toPersonal") {
      const res = await fetchImpl(`${rest}/live_finance_account_views?on_conflict=group_id,linked_id`, {
        method: "POST",
        headers: svc(serviceKey, { prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify(plan.linkedIds.map((linked_id) => ({ group_id: groupId, linked_id, owner_id: userId, view: "personal" }))),
      });
      if (!res.ok) throw new Error(`assign ${res.status}`);
    } else {
      const res = await fetchImpl(`${rest}/live_finance_account_views?group_id=eq.${encodeURIComponent(groupId)}&owner_id=eq.${encodeURIComponent(userId)}&linked_id=${encodeURIComponent(inList(plan.linkedIds))}`, {
        method: "DELETE", headers: svc(serviceKey, { prefer: "return=minimal" }),
      });
      if (!res.ok) throw new Error(`unassign ${res.status}`);
    }
  }

  // 3. Stored transactions. A row the receiving side already holds (a pull that
  //    ran between steps 2 and 3 of an earlier, interrupted run) wins; the
  //    leftover copy on the leaving side is removed rather than moved onto it.
  if (plan.storeAccountIds.length) {
    const accountFilter = `account_id=${encodeURIComponent(inList(plan.storeAccountIds))}`;
    const already = await get(`finance_transactions?group_id=eq.${encodeURIComponent(toScope)}&${accountFilter}&select=id&limit=${MAX_ROWS}`);
    const dupes = already.map((r) => String(r.id));
    for (let i = 0; i < dupes.length; i += 100) {
      const res = await fetchImpl(`${rest}/finance_transactions?group_id=eq.${encodeURIComponent(fromScope)}&id=${encodeURIComponent(inList(dupes.slice(i, i + 100)))}`, {
        method: "DELETE", headers: svc(serviceKey, { prefer: "return=minimal" }),
      });
      if (!res.ok) throw new Error(`store dedupe ${res.status}`);
    }
    const res = await fetchImpl(`${rest}/finance_transactions?group_id=eq.${encodeURIComponent(fromScope)}&${accountFilter}`, {
      method: "PATCH",
      headers: svc(serviceKey, { prefer: "return=minimal" }),
      body: JSON.stringify({ group_id: toScope }),
    });
    if (!res.ok) throw new Error(`store move ${res.status}`);
  }

  // 4. Balance history and the bank cache.
  if (hist.daysTouched) {
    await saveState(`finhist_${toScope}`, { ...toHist, days: hist.toDays });
    await saveState(`finhist_${fromScope}`, { ...fromHist, days: hist.fromDays });
  }
  const linked = new Set(plan.linkedIds);
  const goingAccounts = (fromCache?.accounts || []).filter((a) => linked.has(String(a?.id || "")));
  if (fromCache && goingAccounts.length) {
    const kept = (toCache?.accounts || []).filter((a) => !linked.has(String(a?.id || "")));
    await saveState(`finaccts_${toScope}`, { ...(toCache || {}), accounts: [...kept, ...goingAccounts], errors: toCache?.errors || fromCache.errors || [], fetchedAt: toCache?.fetchedAt || fromCache.fetchedAt || null });
    await saveState(`finaccts_${fromScope}`, { ...fromCache, accounts: fromCache.accounts.filter((a) => !linked.has(String(a?.id || ""))) });
  }

  // 5. The finance sections: the receiving one first, then the one they leave.
  const stamp = now().toISOString();
  const moveHeader = { "x-live-finance-move": "1" };
  await saveState(`${toScope}:finance`, { ...plan.to, stateUpdatedAt: stamp }, moveHeader);
  await saveState(`${fromScope}:finance`, { ...plan.from, stateUpdatedAt: stamp }, moveHeader);

  // 6. A fresh baseline for the nightly finance backup of both scopes.
  await writeBackupBaselines({ loadState, saveState, now, sections: [[toScope, plan.to], [fromScope, plan.from]] });

  // 7. Read back and check.
  const verified = await verifyMoved({ get, loadState, fromScope, plan, ids });
  console.log(`[fin-move] ${direction} accounts=${ids.length} txns=${plan.txnIds.length} clean=${verified.clean}`);
  return { ok: true, dryRun: false, report, verified };
}

// Older snapshots of the leaving side still hold what moved; they are
// server-only and age out, but the newest must be the post-move section, or the
// nightly backup's "never store a poorer copy" rule would refuse it from now on.
async function writeBackupBaselines({ loadState, saveState, now, sections }) {
  for (const [scope, section] of sections) {
    const id = `finbackup_${scope}`;
    const snaps = ((await loadState(id)) || {}).snapshots || {};
    snaps[dateKey(now())] = section;
    await saveState(id, { snapshots: snaps });
  }
}

// Is anything that moved still where it left? Counts only — never the data.
async function verifyMoved({ get, loadState, fromScope, plan, ids }) {
  const section = (await loadState(`${fromScope}:finance`)) || {};
  const moved = new Set(ids);
  const linked = new Set(plan.linkedIds);
  const txns = new Set(plan.txnIds);
  const accountsLeft = (section.financeAccounts || []).filter((a) => moved.has(String(a?.id)) || (a?.linkedId && linked.has(String(a.linkedId)))).length;
  let annotationsLeft = 0;
  for (const key of ["financeTxnLabels", "financeTxnSignFlips", "financeTxnNoteOverrides", "financeTxnReceipts", "financeTxnConfirmed", "financeNotifDismissed", "financeTxnLinks"]) {
    for (const k of Object.keys(section[key] && typeof section[key] === "object" ? section[key] : {})) if (txns.has(k)) annotationsLeft++;
  }
  let storeRowsLeft = 0;
  if (plan.storeAccountIds.length) {
    const rows = await get(`finance_transactions?group_id=eq.${encodeURIComponent(fromScope)}&account_id=${encodeURIComponent(inList(plan.storeAccountIds))}&select=id&limit=${MAX_ROWS}`);
    storeRowsLeft = rows.length;
  }
  const cache = await loadState(`finaccts_${fromScope}`);
  const cacheAccountsLeft = (cache?.accounts || []).filter((a) => linked.has(String(a?.id || ""))).length;
  const hist = await loadState(`finhist_${fromScope}`);
  let historyDaysLeft = 0;
  for (const day of Object.values(hist?.days && typeof hist.days === "object" ? hist.days : {})) {
    if (Object.keys(day?.balances || {}).some((id) => moved.has(id))) historyDaysLeft++;
  }
  const out = { accountsLeft, annotationsLeft, storeRowsLeft, cacheAccountsLeft, historyDaysLeft };
  return { ...out, clean: Object.values(out).every((n) => n === 0) };
}

module.exports = { moveFinanceAccounts, personalScopeId };
