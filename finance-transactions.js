// finance-transactions.js — PURE logic for the durable finance transaction store
// (FINANCE_TRANSACTIONS_DESIGN.md). No DOM, no network, no app state: used by the
// client (finance-ui.js / the store data module) AND by the server ingest
// (netlify/functions/_finance-ingest.js, via dynamic import).
//
// The store keeps every transaction the app ever sees — SimpleFIN pulls, CSV rows,
// manual entries — ONCE, keyed by the id the app already uses for its JSONB
// annotations (financeTxnLabels etc.), so nothing keyed by txn id has to move.

// ── Merchant tokens (moved here from finance-ui.js so the server can share them) ──
const FIN_MERCHANT_STOPWORDS = new Set(["pos", "debit", "credit", "card", "purchase", "ach", "web", "id", "des", "co", "the", "of", "and", "inc", "llc", "com"]);
export function financeMerchantTokens(desc) {
  return String(desc || "").toLowerCase()
    .replace(/[0-9#*]+/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !FIN_MERCHANT_STOPWORDS.has(t));
}
export function financeMerchantKey(desc) { return financeMerchantTokens(desc).slice(0, 3).join(" "); }

function sharesMerchantToken(a, b) {
  const tb = new Set(financeMerchantTokens(b).slice(0, 3));
  return financeMerchantTokens(a).slice(0, 3).some((t) => tb.has(t));
}

const DAY_MS = 86400000;
const round2 = (n) => Math.round(n * 100) / 100;
const time = (iso) => { const t = new Date(iso || 0).getTime(); return Number.isFinite(t) ? t : 0; };

// ── Row ⇄ model ─────────────────────────────────────────────────────────────
// Store row (snake_case, DB) → the txn shape financeLabeledTxns already consumes
// ({ id, posted, amount, description, pending }) plus store metadata.
export function storeRowToTxn(row) {
  return {
    id: String(row?.id || ""),
    posted: row?.posted || null,
    amount: row?.amount == null ? null : Number(row.amount),
    description: String(row?.description || ""),
    pending: Boolean(row?.pending),
    accountId: String(row?.account_id || ""),
    origin: String(row?.origin || ""),
    status: String(row?.status || "active"),
    supersededBy: row?.superseded_by || null,
    importLabel: row?.import_label || "",
    importBatch: row?.import_batch || "",
    updatedAt: row?.updated_at || null,
  };
}

// Normalized SimpleFIN accounts payload (the shape simplefin.js / daily-briefing
// write to finaccts_) → store rows. Only bank-owned columns plus `status: "active"`
// / `superseded_by: null`: a row the bank is sending RIGHT NOW is by definition
// live, so a pending row wrongly reconciled while its account was missing from a
// partial pull heals on the next pull. import_label / import_batch are absent, so
// a merge-duplicates upsert never touches them (and simplefin rows never carry them).
export function feedToStoreRows(groupId, accounts, nowIso = new Date().toISOString()) {
  const rows = [];
  const seen = new Set();
  for (const a of Array.isArray(accounts) ? accounts : []) {
    const accountId = String(a?.id || "");
    if (!accountId) continue;
    for (const t of Array.isArray(a.transactions) ? a.transactions : []) {
      const id = String(t?.id || "");
      const amount = Number(t?.amount);
      if (!id || t?.amount == null || !Number.isFinite(amount) || seen.has(id)) continue;
      seen.add(id);
      rows.push({
        id,
        group_id: String(groupId),
        origin: "simplefin",
        account_id: accountId,
        posted: t.posted || null,
        amount: round2(amount),
        description: String(t.description || "").slice(0, 200),
        pending: Boolean(t.pending),
        status: "active",
        superseded_by: null,
        last_seen_at: nowIso,
      });
    }
  }
  return rows;
}

// ── Pending → posted reconcile ───────────────────────────────────────────────
// For each ACTIVE pending store row that the latest feed no longer contains (and
// whose date the feed covers, so absence is meaningful), find its posted
// successor: same account, same sign, posted the same day…+7 days after, a shared merchant
// token, not already claimed. The AMOUNT MAY DIFFER — gas/hotel pre-auths post at
// the real amount, which the client's same-amount dedupe misses. Exactly one
// candidate (or the nearest equal-amount one) → superseded. None after
// `vanishDays` → vanished (a declined/dropped pre-auth). Ambiguous → untouched.
//
// Returns [{ id, status, superseded_by }] patches; never touches posted rows.
export function reconcilePending(storeRows, feedAccounts, { now = Date.now(), windowStart = null, vanishDays = 10 } = {}) {
  const feedIds = new Set();
  // Only accounts PRESENT in this pull can prove absence — SimpleFIN pulls are
  // often partial (one institution errors and its account is simply missing).
  const feedAccountIds = new Set();
  let earliestFeed = null;
  for (const a of Array.isArray(feedAccounts) ? feedAccounts : []) {
    if (a?.id) feedAccountIds.add(String(a.id));
    for (const t of Array.isArray(a?.transactions) ? a.transactions : []) {
      if (t?.id) feedIds.add(String(t.id));
      const d = (t?.posted || "").slice(0, 10);
      if (d && (!earliestFeed || d < earliestFeed)) earliestFeed = d;
    }
  }
  const coverFrom = windowStart ? time(windowStart) : (earliestFeed ? time(earliestFeed) : null);
  if (coverFrom == null) return []; // an empty feed proves nothing about absence

  const rows = (Array.isArray(storeRows) ? storeRows : []).filter((r) => r && r.id != null && r.account_id != null);
  const claimed = new Set(rows.filter((r) => r.superseded_by).map((r) => String(r.superseded_by)));
  const postedByAccount = new Map();
  for (const r of rows) {
    if (r.pending || (r.status && r.status !== "active")) continue;
    const k = String(r.account_id);
    if (!postedByAccount.has(k)) postedByAccount.set(k, []);
    postedByAccount.get(k).push(r);
  }

  const patches = [];
  const absent = rows.filter((r) => r.pending && (r.status || "active") === "active"
    && !feedIds.has(String(r.id)) && feedAccountIds.has(String(r.account_id)));
  // Undated pending rows (SimpleFIN sends posted:0 for many pendings) can't be
  // matched to a successor by date; once gone from their account's pull for
  // `undatedVanishDays` since first seen, they're dropped (vanished), never kept
  // as ghosts forever.
  for (const p of absent.filter((r) => !r.posted)) {
    const seen = time(p.first_seen_at);
    if (seen && now - seen > 2 * DAY_MS) patches.push({ id: String(p.id), status: "vanished", superseded_by: null });
  }
  const pendings = absent
    .filter((r) => r.posted && time(r.posted) >= coverFrom)
    .sort((a, b) => time(a.posted) - time(b.posted));
  for (const p of pendings) {
    const pAmt = Number(p.amount) || 0;
    const pTime = time(p.posted);
    const cands = (postedByAccount.get(String(p.account_id)) || []).filter((q) => {
      if (claimed.has(String(q.id))) return false;
      const qAmt = Number(q.amount) || 0;
      if ((qAmt > 0) !== (pAmt > 0)) return false;
      // Successor posts the same calendar day or later (never an EARLIER charge
      // at the same merchant), within a week.
      if ((q.posted || "").slice(0, 10) < (p.posted || "").slice(0, 10)) return false;
      if ((time(q.posted) - pTime) / DAY_MS > 7) return false;
      return sharesMerchantToken(p.description, q.description);
    });
    let match = null;
    if (cands.length === 1) match = cands[0];
    else if (cands.length > 1) {
      // Several same-amount successors (e.g. two identical coffees) are
      // interchangeable — pair with the nearest-in-time one; the next pending
      // then claims the other. Differing amounts stay ambiguous.
      const exact = cands.filter((q) => Math.abs((Number(q.amount) || 0) - pAmt) < 0.005)
        .sort((a, b) => Math.abs(time(a.posted) - pTime) - Math.abs(time(b.posted) - pTime));
      if (exact.length) match = exact[0];
    }
    if (match) {
      claimed.add(String(match.id));
      patches.push({ id: String(p.id), status: "superseded", superseded_by: String(match.id) });
    } else if (!cands.length && now - pTime > vanishDays * DAY_MS) {
      patches.push({ id: String(p.id), status: "vanished", superseded_by: null });
    }
  }
  return patches;
}

// ── Store → accounts view ────────────────────────────────────────────────────
// Rebuilds the `financeLive.accounts` shape for financeLabeledTxns as a UNION:
// the live feed's transactions ∪ the store's ACTIVE rows, by id. The feed is never
// dropped — so a store that (so far) holds only manual/CSV rows, a lagging or
// failing ingest, or a partial pull can never hide a bank transaction. For an id
// in both, the store row wins (it carries import metadata), unless the store has
// marked it superseded/vanished — then it's hidden. Account metadata comes from
// the live payload; store-only accounts (e.g. an imported CSV account) get a
// synthesized entry. Manual rows are excluded (they flow through the manual path).
//
// CSV ⇄ bank overlap (design §4.2, both directions): a CSV row on an account that
// ALSO has a bank row for the same charge (±1 day, same amount, shared merchant
// token) is hidden, one-to-one — whichever arrived first. Import-time dedupe only
// sees bank rows already stored; this catches the bank delivering a charge AFTER
// the CSV that already contained it.
export function storeAccountsView(rows, liveAccounts, accountNames = {}) {
  const storeById = new Map();
  const byAccount = new Map();
  const push = (k, t) => { if (!byAccount.has(k)) byAccount.set(k, new Map()); byAccount.get(k).set(t.id, t); };
  const toTxn = (r) => ({
    id: String(r.id), posted: r.posted || null, amount: r.amount == null ? null : Number(r.amount),
    description: String(r.description || ""), pending: Boolean(r.pending),
    importLabel: r.import_label || "", origin: r.origin || "",
  });
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.origin === "manual" || !r.account_id) continue;
    storeById.set(String(r.id), r);
    if ((r.status || "active") === "active") push(String(r.account_id), toTxn(r));
  }
  const out = [];
  const seen = new Set();
  for (const a of Array.isArray(liveAccounts) ? liveAccounts : []) {
    const k = String(a?.id || "");
    seen.add(k);
    for (const t of Array.isArray(a?.transactions) ? a.transactions : []) {
      const id = String(t?.id || "");
      if (!id) continue;
      const stored = storeById.get(id);
      if (stored) continue; // active → already in the map (store version); inactive → hidden
      push(k, { ...t, id, origin: "simplefin" });
    }
    out.push({ ...a, transactions: hideCsvDuplicatesOfBank([...(byAccount.get(k)?.values() || [])]) });
  }
  for (const [k, map] of byAccount) {
    if (seen.has(k)) continue;
    const fallback = k.startsWith("csv:") ? k.slice(4) : "Imported account";
    out.push({ id: k, org: "", name: accountNames[k] || fallback, currency: "USD", balance: null, available: null, balanceDate: null, imported: true, transactions: hideCsvDuplicatesOfBank([...map.values()]) });
  }
  return out;
}

// Within ONE account's transactions: drop each CSV row that duplicates a bank
// (non-CSV) row — same amount, posted within 1.5 days, sharing a merchant token
// (or the CSV row has no description) — pairing one-to-one, nearest first.
export function hideCsvDuplicatesOfBank(txns) {
  const list = Array.isArray(txns) ? txns : [];
  const csv = list.filter((t) => t.origin === "csv");
  if (!csv.length) return list;
  const bank = list.filter((t) => t.origin !== "csv");
  const claimed = new Set();
  const hidden = new Set();
  for (const c of [...csv].sort((a, b) => time(a.posted) - time(b.posted))) {
    const cTok = new Set(financeMerchantTokens(c.description).slice(0, 3));
    const cTime = time(c.posted);
    const match = bank
      .filter((b) => !claimed.has(b.id) && Math.abs((Number(b.amount) || 0) - (Number(c.amount) || 0)) < 0.005)
      .filter((b) => Math.abs(time(b.posted) - cTime) <= 1.5 * DAY_MS)
      .filter((b) => !cTok.size || financeMerchantTokens(b.description).slice(0, 3).some((t) => cTok.has(t)))
      .sort((a, b) => Math.abs(time(a.posted) - cTime) - Math.abs(time(b.posted) - cTime))[0];
    if (match) { claimed.add(match.id); hidden.add(c.id); }
  }
  return hidden.size ? list.filter((t) => !hidden.has(t.id)) : list;
}

// ── Month-actuals snapshot window (design §5.3 — protects past budgets) ─────
// With permanent history, feeding the WHOLE store to financeMonthsToSnapshot would
// mark every past month "fully covered" and re-snapshot it from transactions whose
// labels may have aged out of the 600-entry cap — silently shrinking past actuals.
// So the snapshot only ever sees what the old 45-day feed would have: bank/CSV
// transactions posted within `days` of `now`, plus manual transactions (always
// included, as before). Manual entries can't widen coverage any more: that's
// enforced in financeMonthsToSnapshot, which measures coverage from non-manual
// transactions only (review M2). Older months stay frozen.
export function snapshotWindowTxns(txns, now = Date.now(), days = 45) {
  const cutoff = now - days * DAY_MS;
  return (Array.isArray(txns) ? txns : []).filter((t) => t?.isManual || time(t?.posted) >= cutoff);
}

// ── Review-deck / bell window (design §5.4) ─────────────────────────────────
export function recentTxns(txns, now = Date.now(), days = 60) {
  const cutoff = now - days * DAY_MS;
  return (Array.isArray(txns) ? txns : []).filter((t) => time(t?.posted) >= cutoff);
}

// Latest updated_at among rows — the incremental-sync cursor.
export function latestUpdatedAt(rows, prev = null) {
  let best = prev || null;
  for (const r of Array.isArray(rows) ? rows : []) {
    const u = r?.updated_at;
    if (u && (!best || u > best)) best = u;
  }
  return best;
}

// Merge an incremental page into the mirror (by id; later wins).
export function mergeStoreRows(existing, incoming) {
  const byId = new Map();
  for (const r of Array.isArray(existing) ? existing : []) if (r?.id != null) byId.set(String(r.id), r);
  for (const r of Array.isArray(incoming) ? incoming : []) if (r?.id != null) byId.set(String(r.id), r);
  return [...byId.values()];
}

// ── Manual transactions ⇄ store (design §6) ─────────────────────────────────
// Manual entries are DUAL-WRITTEN (JSONB financeManualTxns + a store row) during
// the transition, so turning the store off loses nothing. The store adds two
// things: a delete there is final (a JSONB copy resurrected by a device merge
// stays hidden), and entries that only exist in the store (e.g. after the legacy
// list is retired) still show.
export function manualAccountSlug(account) {
  return String(account || "cash").trim().toLowerCase().replace(/\s+/g, "-") || "cash";
}

export function manualTxnToRow(m, groupId) {
  return {
    id: String(m.id),
    group_id: String(groupId),
    origin: "manual",
    account_id: `manual:${manualAccountSlug(m.account)}`,
    posted: m.posted || null,
    amount: round2(Number(m.amount) || 0),
    description: String(m.description || "").slice(0, 200),
    pending: false,
    status: "active",
  };
}

// JSONB list + store rows → the manual entries to show. JSONB content wins for
// ids present in both (it's written first on every save, so it's never staler on
// this device); a store row with status "deleted" hides its id everywhere.
export function mergeManualTxns(jsonbList, storeRows) {
  const storeManual = (Array.isArray(storeRows) ? storeRows : []).filter((r) => r?.origin === "manual");
  const deleted = new Set(storeManual.filter((r) => r.status === "deleted").map((r) => String(r.id)));
  const out = [];
  const seen = new Set();
  for (const m of Array.isArray(jsonbList) ? jsonbList : []) {
    if (!m?.id || deleted.has(String(m.id))) continue;
    seen.add(String(m.id));
    out.push(m);
  }
  for (const r of storeManual) {
    if (r.status !== "active" || seen.has(String(r.id))) continue;
    const slug = String(r.account_id || "").replace(/^manual:/, "");
    out.push({ id: String(r.id), posted: r.posted, amount: Number(r.amount) || 0, description: r.description || "", account: slug.replace(/-/g, " ") || "Cash" });
  }
  return out;
}

// JSONB manual entries not yet in the store → rows to copy (idempotent by id).
export function manualRowsToCopy(jsonbList, storeRows, groupId) {
  const have = new Set((Array.isArray(storeRows) ? storeRows : []).filter((r) => r?.origin === "manual").map((r) => String(r.id)));
  return (Array.isArray(jsonbList) ? jsonbList : []).filter((m) => m?.id && !have.has(String(m.id))).map((m) => manualTxnToRow(m, groupId));
}

// ── SimpleFIN reconnect remap (design §12) ───────────────────────────────────
// Relinking SimpleFIN can make the bank issue NEW account and transaction ids, so
// the next ingest stores the same real charges again under the new account. A
// remap merges an OLD account (in the store, no longer in the live feed) into the
// NEW account that replaced it:
//   • each old row that matches a new row (same amount, posted within 2 days,
//     a shared merchant token — or the only candidate) → superseded_by the new row,
//     so it's hidden and its annotations follow it (carrySupersededAnnotations);
//   • old posted rows with no match are real history the new connection doesn't
//     reach → moved onto the new account (same id, so annotations stay put);
//   • old pending rows with no match never posted under the old connection → vanished.
// Pure and deterministic: the server recomputes it from the stored rows and never
// trusts a plan sent by the client; the client uses it only to preview.

const REMAP_WINDOW_DAYS = 2;
const activeSimplefin = (r, accountId) => r && r.origin === "simplefin" && String(r.account_id) === String(accountId)
  && (r.status || "active") === "active";

export function planAccountRemap(storeRows, oldAccountId, newAccountId) {
  const rows = Array.isArray(storeRows) ? storeRows : [];
  const oldRows = rows.filter((r) => activeSimplefin(r, oldAccountId)).sort((a, b) => time(a.posted) - time(b.posted));
  const newRows = rows.filter((r) => activeSimplefin(r, newAccountId));
  const plan = { oldAccountId: String(oldAccountId), newAccountId: String(newAccountId), supersede: [], move: [], vanish: [], overlapUnmatched: 0 };
  if (!oldAccountId || !newAccountId || String(oldAccountId) === String(newAccountId)) return plan;
  const newEarliest = newRows.reduce((m, r) => (r.posted && (!m || time(r.posted) < m) ? time(r.posted) : m), null);
  const claimed = new Set();
  for (const o of oldRows) {
    const oAmt = Number(o.amount) || 0;
    const oTime = time(o.posted);
    const cands = o.posted ? newRows.filter((n) => !claimed.has(String(n.id))
      && n.posted && Math.abs((Number(n.amount) || 0) - oAmt) < 0.005
      && Math.abs(time(n.posted) - oTime) <= REMAP_WINDOW_DAYS * DAY_MS) : [];
    const byNearest = (a, b) => Math.abs(time(a.posted) - oTime) - Math.abs(time(b.posted) - oTime);
    const sharing = cands.filter((n) => sharesMerchantToken(o.description, n.description)).sort(byNearest);
    const match = sharing[0] || (cands.length === 1 ? cands[0] : null);
    if (match) {
      claimed.add(String(match.id));
      plan.supersede.push({ id: String(o.id), superseded_by: String(match.id) });
    } else if (o.pending) {
      plan.vanish.push(String(o.id));
    } else {
      plan.move.push(String(o.id));
      if (newEarliest != null && oTime >= newEarliest) plan.overlapUnmatched++;
    }
  }
  return plan;
}

// Old SimpleFIN accounts worth offering for a remap: they still hold active rows
// in the store but are missing from the live feed (a remap on an account the bank
// still sends would be undone by the next ingest, which re-activates live rows).
export function remapCandidateAccounts(storeRows, liveAccountIds) {
  const live = new Set((liveAccountIds || []).map(String));
  const byAccount = new Map();
  for (const r of Array.isArray(storeRows) ? storeRows : []) {
    if (!r || r.origin !== "simplefin" || (r.status || "active") !== "active" || !r.account_id) continue;
    const k = String(r.account_id);
    if (live.has(k)) continue;
    const e = byAccount.get(k) || { accountId: k, count: 0, from: null, to: null };
    e.count++;
    const d = (r.posted || "").slice(0, 10);
    if (d && (!e.from || d < e.from)) e.from = d;
    if (d && (!e.to || d > e.to)) e.to = d;
    byAccount.set(k, e);
  }
  return [...byAccount.values()].sort((a, b) => String(b.to || "").localeCompare(String(a.to || "")));
}

// The live account that most of an old account's charges match (null if none).
export function suggestRemapTarget(storeRows, oldAccountId, liveAccountIds) {
  let best = null;
  for (const id of liveAccountIds || []) {
    const n = planAccountRemap(storeRows, oldAccountId, id).supersede.length;
    if (n > 0 && (!best || n > best.matched)) best = { accountId: String(id), matched: n };
  }
  return best;
}

// JSONB annotation maps keyed by transaction id (finance section). When the store
// marks a row superseded (pending→posted, or a reconnect remap), each annotation
// moves from the old id to its successor unless the successor already has one.
export const FINANCE_TXN_ID_MAPS = [
  "financeTxnLabels", "financeTxnSignFlips", "financeTxnNoteOverrides", "financeTxnReceipts",
  "financeTxnConfirmed", "financeNotifDismissed", "financeTxnLinks",
];

// Mutates `state`'s maps in place; returns true if anything moved. financeTxnLinks
// maps a return's id → its purchase's id, so a superseded PURCHASE id is also
// rewritten where it appears as a value.
export function carrySupersededAnnotations(state, storeRows) {
  const next = new Map();
  for (const r of Array.isArray(storeRows) ? storeRows : []) {
    if (r && r.status === "superseded" && r.superseded_by) next.set(String(r.id), String(r.superseded_by));
  }
  if (!next.size || !state) return false;
  let moved = false;
  for (const key of FINANCE_TXN_ID_MAPS) {
    const map = state[key];
    if (!map || typeof map !== "object") continue;
    for (const [oldId, newId] of next) {
      if (!Object.prototype.hasOwnProperty.call(map, oldId)) continue;
      if (!Object.prototype.hasOwnProperty.call(map, newId)) map[newId] = map[oldId];
      delete map[oldId];
      moved = true;
    }
  }
  const links = state.financeTxnLinks;
  if (links && typeof links === "object") {
    for (const [ret, purchase] of Object.entries(links)) {
      const to = next.get(String(purchase));
      if (to) { links[ret] = to; moved = true; }
    }
  }
  return moved;
}
