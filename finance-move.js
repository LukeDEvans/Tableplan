// Finance: moving accounts between Household and a person's own finance
// (FINANCE_SPLIT_DESIGN.md §2.4 and §8 — step 3, "the move").
//
// Pure: no DOM, no network, no app state. Given the finance section an account
// leaves (`from`), the one it joins (`to`) and the stored transactions of the
// scope it leaves, `planFinanceMove` returns both sections as they should be
// saved, plus a report of what moved and what couldn't move cleanly. The same
// function runs the dry run (the report is shown, nothing is saved) and the
// move itself, in either direction.
//
// What follows an account:
//   - its entry in financeAccounts, its place in the cash / emergency /
//     retirement card lists, and its sub-label;
//   - everything keyed by one of its transactions: labels, notes, sign flips,
//     receipts, confirmations, links, dismissed notifications and alerts, and
//     per-transaction label skips;
//   - its manual transactions;
//   - what belongs to a merchant seen ONLY on the moving accounts: its rule,
//     display name, note counts, recurring charge, skip and alerts. A merchant
//     also seen on an account that stays keeps all of that where it is, and its
//     rule and display name are copied so the moved transactions still label
//     themselves.
// The budget categories the moved transactions are labelled with are copied
// (same ids, amounts blank) so the labels stay valid (Luke, 2026-11-11).
// Month totals are derived from transactions: both sections drop theirs and the
// app rebuilds them.
//
// `from` then records what left in `financeMovedOut`, so a device (or the
// database trigger) holding an older copy can't put any of it back.

import { FINANCE_TXN_ID_MAPS, financeMerchantKey, manualAccountSlug } from "./finance-transactions.js";

export const FINANCE_MOVED_OUT_KEY = "financeMovedOut";

// Maps keyed by merchant key (financeMerchantKey of a description).
const MERCHANT_MAPS = ["financeTxnRules", "financeMerchantNames", "financeTxnNoteCounts"];
// Merchant maps that are also copied when the merchant stays behind too.
const MERCHANT_MAPS_COPIED_WHEN_SHARED = ["financeTxnRules", "financeMerchantNames"];
// Maps whose keys are a merchant key, "id:<txnId>" or "<kind>:<txnId | merchant text>".
export const MIXED_KEY_MAPS = ["financeLabelSkips", "financeLabelSnoozes", "financeDismissedAlerts"];
// Lists of account ids behind the Overview cards.
export const ACCOUNT_ID_LISTS = ["financeCashAccountIds", "financeEmergencyAccountIds", "financeRetirementAccountIds"];

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const uniq = (list) => [...new Set(list.map(String))];

export function normalizeMovedOut(raw) {
  const m = isObj(raw) ? raw : {};
  return {
    epoch: Number.isFinite(Number(m.epoch)) ? Number(m.epoch) : 0,
    accounts: uniq(arr(m.accounts)),
    linked: uniq(arr(m.linked)),
    txns: uniq(arr(m.txns)),
  };
}

// The store's account id for a finance account entry: the bank's id for a
// linked account, "manual:<slug>" for a manual one.
export function storeAccountIdsFor(account) {
  if (!account) return [];
  if (account.linkedId) return [String(account.linkedId)];
  return [`manual:${manualAccountSlug(account.name)}`];
}

function categoryRefs(label) {
  const m = /^cat:([^:]+):(.+)$/.exec(String(label || ""));
  return m ? { groupId: m[1], categoryId: m[2] } : null;
}

// A "<prefix>:<rest>" key's rest, or the key itself.
function keyTail(key) {
  const i = String(key).indexOf(":");
  return i === -1 ? String(key) : String(key).slice(i + 1);
}

/**
 * Plan a move of `accountIds` (ids of entries in `from.financeAccounts`).
 *
 * @param {object} p
 * @param {object} p.from       finance section the accounts leave
 * @param {object} [p.to]       finance section they join (may be empty)
 * @param {string[]} p.accountIds
 * @param {object[]} [p.storeRows] stored transactions of the `from` scope:
 *                                 [{ id, account_id, description }]
 * @returns {{ ok: boolean, error?: string, from?: object, to?: object, report?: object,
 *             txnIds?: string[], linkedIds?: string[], storeAccountIds?: string[] }}
 */
export function planFinanceMove({ from, to = {}, accountIds, storeRows = [] } = {}) {
  if (!isObj(from)) return { ok: false, error: "No finance data to move from." };
  const want = new Set(arr(accountIds).map(String));
  const moving = arr(from.financeAccounts).filter((a) => a && want.has(String(a.id)));
  if (!moving.length) return { ok: false, error: "Pick at least one account." };
  const missing = [...want].filter((id) => !moving.some((a) => String(a.id) === id));
  if (missing.length) return { ok: false, error: "One of those accounts isn't here any more." };

  const src = clone(from);
  const dst = isObj(to) ? clone(to) : {};
  const movingIds = new Set(moving.map((a) => String(a.id)));
  const linkedIds = uniq(moving.filter((a) => a.linkedId).map((a) => a.linkedId));
  const storeAccountIds = uniq(moving.flatMap(storeAccountIdsFor));
  const storeAccountSet = new Set(storeAccountIds);
  const problems = [];

  // A manual account sharing its name with one that stays shares its store id
  // too, so their transactions can't be told apart.
  for (const a of moving.filter((x) => !x.linkedId)) {
    const [slugId] = storeAccountIdsFor(a);
    const twin = arr(from.financeAccounts).find((b) => b && !b.linkedId && !movingIds.has(String(b.id)) && storeAccountIdsFor(b)[0] === slugId);
    if (twin) problems.push({ kind: "same-name", accountId: String(a.id), message: `"${a.name}" has the same name as an account that stays; rename one first so their transactions can be told apart.` });
  }
  if (problems.some((p) => p.kind === "same-name")) return { ok: false, error: problems[0].message, problems };

  // ── Which transactions and merchants go ────────────────────────────────────
  const rows = arr(storeRows).filter((r) => r && r.id);
  const movedRows = rows.filter((r) => storeAccountSet.has(String(r.account_id)));
  const stayRows = rows.filter((r) => !storeAccountSet.has(String(r.account_id)));
  const manualMoving = arr(src.financeManualTxns).filter((m) => m && storeAccountSet.has(`manual:${manualAccountSlug(m.account)}`));
  const manualStaying = arr(src.financeManualTxns).filter((m) => !manualMoving.includes(m));
  const txnIds = uniq([...movedRows.map((r) => r.id), ...manualMoving.map((m) => m.id)]);
  const txnSet = new Set(txnIds);
  const merchantsOf = (list) => new Set(list.map((r) => financeMerchantKey(r.description)).filter(Boolean));
  const movedMerchants = merchantsOf([...movedRows, ...manualMoving]);
  const stayMerchants = merchantsOf([...stayRows, ...manualStaying]);
  const exclusive = new Set([...movedMerchants].filter((k) => !stayMerchants.has(k)));
  const shared = new Set([...movedMerchants].filter((k) => stayMerchants.has(k)));

  const counts = { transactions: movedRows.length, manualTransactions: manualMoving.length };
  const take = (key, pick) => {
    const map = src[key];
    if (!isObj(map)) return 0;
    let n = 0;
    for (const k of Object.keys(map)) {
      if (!pick(k, map[k])) continue;
      if (!isObj(dst[key])) dst[key] = {};
      if (!Object.prototype.hasOwnProperty.call(dst[key], k)) dst[key][k] = map[k];
      delete map[k];
      n++;
    }
    return n;
  };

  // ── Accounts, their card lists and sub-labels ──────────────────────────────
  dst.financeAccounts = [...arr(dst.financeAccounts).filter((a) => a && !movingIds.has(String(a.id))), ...moving.map(clone)];
  src.financeAccounts = arr(src.financeAccounts).filter((a) => a && !movingIds.has(String(a.id)));
  for (const key of ACCOUNT_ID_LISTS) {
    const went = arr(src[key]).map(String).filter((id) => movingIds.has(id));
    if (!went.length) continue;
    src[key] = arr(src[key]).filter((id) => !movingIds.has(String(id)));
    dst[key] = uniq([...arr(dst[key]), ...went]);
  }
  take("financeAccountSubLabels", (k) => movingIds.has(k));

  // ── Everything keyed by a moved transaction ────────────────────────────────
  for (const key of FINANCE_TXN_ID_MAPS) {
    const n = take(key, (k) => txnSet.has(k));
    if (n) counts[key] = n;
  }
  // A return linked to a purchase on the other side of the move: the link goes
  // with the return, and is reported, since it now points nowhere.
  for (const [side, map] of [["moved", dst.financeTxnLinks], ["stayed", src.financeTxnLinks]]) {
    for (const [ret, purchase] of Object.entries(isObj(map) ? map : {})) {
      const crosses = side === "moved" ? !txnSet.has(String(purchase)) : txnSet.has(String(purchase));
      if (!crosses || (side === "moved" && !txnSet.has(ret))) continue;
      problems.push({ kind: "split-link", txnId: ret, message: "A return and the purchase it's linked to end up in different views; the link is dropped." });
      delete map[ret];
    }
  }
  for (const key of MIXED_KEY_MAPS) {
    const n = take(key, (k) => txnSet.has(keyTail(k)) || exclusive.has(k) || exclusive.has(keyTail(k)) || exclusive.has(financeMerchantKey(keyTail(k))));
    if (n) counts[key] = n;
  }
  if (manualMoving.length) {
    const ids = new Set(manualMoving.map((m) => String(m.id)));
    src.financeManualTxns = arr(src.financeManualTxns).filter((m) => !ids.has(String(m?.id)));
    dst.financeManualTxns = [...arr(dst.financeManualTxns).filter((m) => !ids.has(String(m?.id))), ...manualMoving.map(clone)];
  }

  // ── Budget categories the moved transactions use (copied, amounts blank) ───
  const usedLabels = new Set();
  for (const id of txnIds) { const l = dst.financeTxnLabels?.[id]; if (typeof l === "string") usedLabels.add(l); }
  const copiedCategories = [];
  const missingCategories = new Set();
  for (const label of usedLabels) {
    const ref = categoryRefs(label);
    if (!ref) continue;
    const group = arr(from.financeBudgetGroups).find((g) => g && String(g.id) === ref.groupId);
    const category = arr(group?.categories).find((c) => c && String(c.id) === ref.categoryId);
    if (!group || !category) { missingCategories.add(label); continue; }
    if (!Array.isArray(dst.financeBudgetGroups)) dst.financeBudgetGroups = [];
    let g = dst.financeBudgetGroups.find((x) => x && String(x.id) === ref.groupId);
    if (!g) { g = { ...clone(group), categories: [] }; dst.financeBudgetGroups.push(g); }
    if (!Array.isArray(g.categories)) g.categories = [];
    if (g.categories.some((c) => c && String(c.id) === ref.categoryId)) continue;
    const copy = clone(category);
    copy.items = arr(copy.items).map((item) => ({ ...item, amount: 0, note: "" }));
    g.categories.push(copy);
    copiedCategories.push({ groupId: ref.groupId, categoryId: ref.categoryId, name: category.name || "" });
  }
  if (missingCategories.size) problems.push({ kind: "dead-label", count: missingCategories.size, message: `${missingCategories.size} label${missingCategories.size === 1 ? " points" : "s point"} at a budget category that no longer exists; those transactions arrive unlabelled.` });
  for (const id of txnIds) { if (missingCategories.has(dst.financeTxnLabels?.[id])) delete dst.financeTxnLabels[id]; }
  const labelLives = (label) => {
    const ref = categoryRefs(label);
    if (!ref) return true;
    return arr(dst.financeBudgetGroups).some((g) => String(g?.id) === ref.groupId && arr(g.categories).some((c) => String(c?.id) === ref.categoryId));
  };

  // ── What belongs to a merchant ─────────────────────────────────────────────
  for (const key of MERCHANT_MAPS) {
    const n = take(key, (k) => exclusive.has(k));
    if (n) counts[key] = n;
  }
  for (const key of MERCHANT_MAPS_COPIED_WHEN_SHARED) {
    for (const k of shared) {
      const v = src[key]?.[k];
      if (v === undefined) continue;
      if (!isObj(dst[key])) dst[key] = {};
      if (!Object.prototype.hasOwnProperty.call(dst[key], k)) dst[key][k] = clone(v);
    }
  }
  // A rule only keeps the labels that exist on the receiving side.
  for (const k of [...exclusive, ...shared]) {
    const rule = dst.financeTxnRules?.[k];
    if (!isObj(rule)) continue;
    for (const label of Object.keys(rule)) if (!labelLives(label)) delete rule[label];
    if (!Object.keys(rule).length) delete dst.financeTxnRules[k];
  }
  const recurringGo = arr(src.financeRecurring).filter((r) => r && exclusive.has(String(r.merchantKey || "")));
  if (recurringGo.length) {
    const keys = new Set(recurringGo.map((r) => String(r.merchantKey)));
    src.financeRecurring = arr(src.financeRecurring).filter((r) => !keys.has(String(r?.merchantKey || "")));
    dst.financeRecurring = [...arr(dst.financeRecurring).filter((r) => !keys.has(String(r?.merchantKey || ""))), ...recurringGo.map(clone)];
    counts.financeRecurring = recurringGo.length;
  }

  // A receiving side with no finance yet reads its transactions the same way.
  for (const key of ["financeTxnSource", "financeTxnSourceSetAt", "schemaVersion"]) {
    if (dst[key] === undefined && src[key] !== undefined) dst[key] = src[key];
  }

  // ── Derived month totals: both sides rebuild from their transactions ───────
  if (isObj(src.financeMonthActuals) && Object.keys(src.financeMonthActuals).length) src.financeMonthActuals = {};
  if (isObj(dst.financeMonthActuals) && Object.keys(dst.financeMonthActuals).length) dst.financeMonthActuals = {};

  // ── Record what left, and take back anything the other side had recorded ───
  const out = normalizeMovedOut(src[FINANCE_MOVED_OUT_KEY]);
  const back = normalizeMovedOut(dst[FINANCE_MOVED_OUT_KEY]);
  const epoch = Math.max(out.epoch, back.epoch) + 1;
  src[FINANCE_MOVED_OUT_KEY] = {
    epoch,
    accounts: uniq([...out.accounts, ...movingIds]),
    linked: uniq([...out.linked, ...linkedIds]),
    txns: uniq([...out.txns, ...txnIds]),
  };
  const linkedSet = new Set(linkedIds);
  dst[FINANCE_MOVED_OUT_KEY] = {
    epoch,
    accounts: back.accounts.filter((id) => !movingIds.has(id)),
    linked: back.linked.filter((id) => !linkedSet.has(id)),
    txns: back.txns.filter((id) => !txnSet.has(id)),
  };

  const report = {
    accounts: moving.map((a) => {
      const ids = new Set(storeAccountIdsFor(a));
      const own = movedRows.filter((r) => ids.has(String(r.account_id)));
      const ownIds = new Set(own.map((r) => String(r.id)));
      const inMap = (key) => Object.keys(isObj(from[key]) ? from[key] : {}).filter((k) => ownIds.has(k)).length;
      return {
        id: String(a.id), name: a.name || "", linked: Boolean(a.linkedId),
        transactions: own.length,
        labels: inMap("financeTxnLabels"), notes: inMap("financeTxnNoteOverrides"),
        links: inMap("financeTxnLinks"), receipts: inMap("financeTxnReceipts"),
      };
    }),
    counts,
    copiedCategories,
    merchants: { movedWithAccounts: exclusive.size, copied: shared.size },
    problems,
  };
  return { ok: true, from: src, to: dst, report, txnIds, linkedIds, storeAccountIds };
}

/**
 * Remove from a finance section everything its `financeMovedOut` says has left:
 * the accounts, their places in the card lists, and every entry keyed by a moved
 * transaction. Used on a copy that may predate the move (a device's old copy, a
 * merge result) so it can't show or save what moved. Returns the same object
 * when there is nothing to remove.
 */
export function stripMovedOut(section) {
  if (!isObj(section)) return section;
  const out = normalizeMovedOut(section[FINANCE_MOVED_OUT_KEY]);
  if (!out.accounts.length && !out.linked.length && !out.txns.length) return section;
  const accounts = new Set(out.accounts);
  const linked = new Set(out.linked);
  const txns = new Set(out.txns);
  let changed = false;
  const next = { ...section };
  if (Array.isArray(section.financeAccounts)) {
    const kept = section.financeAccounts.filter((a) => a && !accounts.has(String(a.id)) && !(a.linkedId && linked.has(String(a.linkedId))));
    if (kept.length !== section.financeAccounts.length) { next.financeAccounts = kept; changed = true; }
  }
  for (const key of ACCOUNT_ID_LISTS) {
    if (!Array.isArray(section[key])) continue;
    const kept = section[key].filter((id) => !accounts.has(String(id)));
    if (kept.length !== section[key].length) { next[key] = kept; changed = true; }
  }
  const dropKeys = (key, gone) => {
    const map = section[key];
    if (!isObj(map)) return;
    const keys = Object.keys(map).filter(gone);
    if (!keys.length) return;
    next[key] = { ...map };
    for (const k of keys) delete next[key][k];
    changed = true;
  };
  dropKeys("financeAccountSubLabels", (k) => accounts.has(k));
  for (const key of FINANCE_TXN_ID_MAPS) dropKeys(key, (k) => txns.has(k));
  for (const key of MIXED_KEY_MAPS) dropKeys(key, (k) => txns.has(keyTail(k)));
  if (Array.isArray(section.financeManualTxns)) {
    const kept = section.financeManualTxns.filter((m) => m && !txns.has(String(m.id)));
    if (kept.length !== section.financeManualTxns.length) { next.financeManualTxns = kept; changed = true; }
  }
  return changed ? next : section;
}

/**
 * Balance history (finhist rows: { days: { "YYYY-MM-DD": { netWorth, balances } } }):
 * the moved accounts' balances leave `from`'s days and join `to`'s, and each
 * touched day's net worth is recomputed from the change. Returns new objects.
 */
export function moveBalanceHistory({ fromDays, toDays, accountIds } = {}) {
  const ids = new Set(arr(accountIds).map(String));
  const src = clone(isObj(fromDays) ? fromDays : {});
  const dst = clone(isObj(toDays) ? toDays : {});
  const round2 = (n) => Math.round(n * 100) / 100;
  let daysTouched = 0;
  for (const [day, entry] of Object.entries(src)) {
    const balances = isObj(entry?.balances) ? entry.balances : {};
    let moved = 0;
    let any = false;
    for (const id of Object.keys(balances)) {
      if (!ids.has(id)) continue;
      const bal = Number(balances[id]) || 0;
      if (!isObj(dst[day])) dst[day] = { netWorth: 0, balances: {} };
      if (!isObj(dst[day].balances)) dst[day].balances = {};
      if (!Object.prototype.hasOwnProperty.call(dst[day].balances, id)) {
        dst[day].balances[id] = balances[id];
        dst[day].netWorth = round2((Number(dst[day].netWorth) || 0) + bal);
      }
      delete balances[id];
      moved += bal;
      any = true;
    }
    if (!any) continue;
    daysTouched++;
    entry.netWorth = round2((Number(entry.netWorth) || 0) - moved);
    if (!Object.keys(balances).length) delete src[day];
  }
  return { fromDays: src, toDays: dst, daysTouched };
}
