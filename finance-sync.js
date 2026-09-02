// Finance synchronization safety — the pure, domain-specific merge invariants
// that keep the household ledger from losing data across devices (ARCHITECTURE.md
// §11). Extracted from app.js's mergeStates()/hydrate path so the logic that
// exists *because finance already lost data once* is directly unit-tested. Pure,
// DOM-free, no app state; app.js still orchestrates and owns the session-scoped
// `financeSectionHydrated` flag, delegating the decisions here.
//
// Two unusual invariants live here — read this before touching the merges:
//
// 1. BOOT-EMPTY PROTECTION. The localStorage mirror deliberately OMITS finance
//    (the household ledger is cloud-only), so on EVERY boot financeBudgetGroups /
//    financePeople / financePersonal come up as empty defaults until the Supabase
//    pull lands. A plain id-union whole-object-replaces a same-id record, which
//    let a just-booted client's EMPTY groups overwrite the cloud's real ones and
//    wipe every category — the recurring data-loss bug. The deep merges below
//    instead union by id AND union each record's nested child arrays, so both
//    sides always contribute and an empty just-booted record can never erase a
//    populated cloud one. `guardBootEmptyFinance` is the second layer: until the
//    cloud copy has actually hydrated this session, boot-empty finance must not
//    win a merge or be written back at all.
//
// 2. TOMBSTONES ARE THE ONLY WAY A DELETE WINS. Because empty-never-erases is the
//    rule, a genuine deletion can't propagate by "absence" — an id missing on one
//    side just gets re-supplied by the other. Delete handlers therefore tombstone
//    the removed id (financeBudgetGroups / financeCategories / financeLineItems /
//    financePeople / financeScenarios / financePersonal); `financeDeadSet` reads
//    those tombstones so a tombstoned id is filtered out of the merged result and
//    does not resurrect.

/** Stringified tombstone id-set for one finance collection key. */
export function financeDeadSet(tombstones, key) {
  return new Set((tombstones?.[key] || []).map(String));
}

// Union two id-keyed child arrays (items / scenarios). Both sides survive; newer
// wins on an id clash; tombstoned ids drop out. Order: existing (older) first,
// so a record's children keep a stable order across merges.
export function unionFinanceChildren(newer, older, deadSet) {
  const ids = [];
  const byId = new Map();
  const add = (x) => {
    if (!x || x.id == null) return;
    if (!byId.has(x.id)) ids.push(x.id);
    byId.set(x.id, x);
  };
  (older || []).forEach(add);
  (newer || []).forEach(add);
  return ids.map((id) => byId.get(id)).filter((x) => !deadSet.has(String(x.id)));
}

// Merge budget categories by id, unioning each category's nested line items so a
// boot-empty category can't blank the cloud's items. Newer wins on scalar fields.
export function mergeFinanceCategories(newer, older, deadCat, deadItem) {
  const ids = [];
  const byId = new Map();
  const seed = (c) => { if (c?.id == null) return; if (!byId.has(c.id)) ids.push(c.id); byId.set(c.id, c); };
  (older || []).forEach(seed);
  (newer || []).forEach((c) => {
    if (c?.id == null) return;
    const prev = byId.get(c.id);
    if (!prev) { ids.push(c.id); byId.set(c.id, c); return; }
    byId.set(c.id, { ...prev, ...c, items: unionFinanceChildren(c.items, prev.items, deadItem) });
  });
  return ids.map((id) => byId.get(id)).filter((c) => !deadCat.has(String(c.id)));
}

// Merge budget groups by id, deep-merging categories (and their line items) so a
// just-booted empty group can never wipe the cloud's categories. Tombstoned
// groups/categories/items are dropped.
export function mergeFinanceBudgetGroups(newer, older, tombstones) {
  const deadGroup = financeDeadSet(tombstones, "financeBudgetGroups");
  const deadCat = financeDeadSet(tombstones, "financeCategories");
  const deadItem = financeDeadSet(tombstones, "financeLineItems");
  const ids = [];
  const byId = new Map();
  const seed = (g) => { if (g?.id == null) return; if (!byId.has(g.id)) ids.push(g.id); byId.set(g.id, g); };
  (older || []).forEach(seed);
  (newer || []).forEach((g) => {
    if (g?.id == null) return;
    const prev = byId.get(g.id);
    if (!prev) { ids.push(g.id); byId.set(g.id, g); return; }
    byId.set(g.id, { ...prev, ...g, categories: mergeFinanceCategories(g.categories, prev.categories, deadCat, deadItem) });
  });
  return ids.map((id) => byId.get(id)).filter((g) => !deadGroup.has(String(g.id)));
}

// Merge people by id, unioning each person's scenarios so a boot-empty person
// can't blank the cloud's scenarios. Tombstoned people/scenarios are dropped.
export function mergeFinancePeople(newer, older, tombstones) {
  const deadPerson = financeDeadSet(tombstones, "financePeople");
  const deadScenario = financeDeadSet(tombstones, "financeScenarios");
  const ids = [];
  const byId = new Map();
  const seed = (p) => { if (p?.id == null) return; if (!byId.has(p.id)) ids.push(p.id); byId.set(p.id, p); };
  (older || []).forEach(seed);
  (newer || []).forEach((p) => {
    if (p?.id == null) return;
    const prev = byId.get(p.id);
    if (!prev) { ids.push(p.id); byId.set(p.id, p); return; }
    byId.set(p.id, { ...prev, ...p, scenarios: unionFinanceChildren(p.scenarios, prev.scenarios, deadScenario) });
  });
  return ids.map((id) => byId.get(id)).filter((p) => !deadPerson.has(String(p.id)));
}

// Merge personal budgets by id, unioning each record's income and expense items
// so a boot-empty personal budget can't blank the cloud's line items. Tombstoned
// personal records / line items are dropped.
export function mergeFinancePersonal(newer, older, tombstones) {
  const deadPersonal = financeDeadSet(tombstones, "financePersonal");
  const deadItem = financeDeadSet(tombstones, "financeLineItems");
  const ids = [];
  const byId = new Map();
  const seed = (p) => { if (p?.id == null) return; if (!byId.has(p.id)) ids.push(p.id); byId.set(p.id, p); };
  (older || []).forEach(seed);
  (newer || []).forEach((p) => {
    if (p?.id == null) return;
    const prev = byId.get(p.id);
    if (!prev) { ids.push(p.id); byId.set(p.id, p); return; }
    byId.set(p.id, {
      ...prev, ...p,
      incomeItems: unionFinanceChildren(p.incomeItems, prev.incomeItems, deadItem),
      expenseItems: unionFinanceChildren(p.expenseItems, prev.expenseItems, deadItem),
    });
  });
  return ids.map((id) => byId.get(id)).filter((p) => !deadPersonal.has(String(p.id)));
}

// Recurring charges are unique per MERCHANT, not per id. Unioning them by id let
// each device's independently-created entry for the same merchant survive, piling
// up hundreds of duplicates (each a separate alert). Collapse per merchantKey,
// keeping the "answer" state: the entry with the most recent charge wins the base
// (its amount/day/name), acknowledgements are OR-ed / kept so a dismissal on
// either device sticks, and key-less junk that can never match a charge is dropped.
export function dedupeFinanceRecurring(list) {
  if (!Array.isArray(list)) return [];
  const byKey = new Map();
  for (const raw of list) {
    const key = raw?.merchantKey || "";
    if (!key) continue; // drop key-less junk that can never match a charge
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, { ...raw }); continue; }
    // Base = the entry with the most recent charge (its amount/day/name win).
    const keepRaw = (raw.lastSeen || "") > (prev.lastSeen || "");
    const base = keepRaw ? { ...raw } : prev;
    const other = keepRaw ? prev : raw;
    base.newAck = Boolean(prev.newAck || raw.newAck);
    base.lineItemKey = base.lineItemKey || other.lineItemKey || "";
    base.missAck = (prev.missAck || "") > (raw.missAck || "") ? (prev.missAck || "") : (raw.missAck || "");
    const acks = [prev.ackAmount, raw.ackAmount].filter((v) => v !== null && v !== undefined);
    base.ackAmount = acks.includes(base.lastAmount) ? base.lastAmount : (acks.length ? acks[0] : null);
    byKey.set(key, base);
  }
  return [...byKey.values()];
}

// Per-transaction metadata that is (a) cached in device localStorage and (b)
// edited on THIS device, and that the section merge already combines
// NON-destructively (union of keys, newer wins per key, nothing dropped). These
// must ride that merge and must NOT be force-overwritten from the cloud at boot:
// doing so reverted the user's just-made budget label / merchant rename /
// payment-reason edits on the next reload whenever the cloud copy hadn't caught up
// yet. Everything else in the finance section (budget groups, people, accounts,
// personal budgets, account-selection arrays, scalars) can boot empty and/or is
// merged wholesale, so it still gets the cloud-restore guard below.
export const FINANCE_LOCAL_AUTHORITATIVE_KEYS = new Set([
  "financeTxnLabels", "financeTxnRules", "financeMonthActuals", "financeMerchantNames",
  "financeTxnLinks", "financeTxnSignFlips", "financeTxnNoteOverrides", "financeTxnNoteCounts",
  "financeManualTxns", "financeRecurring",
]);

// Until the cloud finance copy has actually hydrated this session, a boot-empty
// finance must never win a merge — a reload would otherwise silently blank budget
// picks / cash / emergency account selections. Once hydrated, local edits are
// authoritative and this is a no-op. `financeKeys` is STATE_SECTIONS.finance
// (passed in so the section list stays defined once, in app.js). Mutates `merged`
// in place: for every non-authoritative finance key present in the cloud copy,
// restore the cloud value over the boot-empty local one.
export function guardBootEmptyFinance(merged, sharedState, financeKeys, hydrated) {
  if (hydrated) return; // already have the real finance; local edits are authoritative
  for (const key of financeKeys) {
    if (FINANCE_LOCAL_AUTHORITATIVE_KEYS.has(key)) continue;
    if (sharedState && key in sharedState) merged[key] = sharedState[key];
  }
}
