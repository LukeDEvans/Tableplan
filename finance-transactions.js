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
// write to finaccts_) → store rows carrying ONLY bank-owned columns. App-owned
// columns (status, superseded_by, import_label) are deliberately absent so a
// merge-duplicates upsert can never overwrite them.
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
        last_seen_at: nowIso,
      });
    }
  }
  return rows;
}

// ── Pending → posted reconcile ───────────────────────────────────────────────
// For each ACTIVE pending store row that the latest feed no longer contains (and
// whose date the feed covers, so absence is meaningful), find its posted
// successor: same account, same sign, posted −1…+7 days after, a shared merchant
// token, not already claimed. The AMOUNT MAY DIFFER — gas/hotel pre-auths post at
// the real amount, which the client's same-amount dedupe misses. Exactly one
// candidate (or the nearest equal-amount one) → superseded. None after
// `vanishDays` → vanished (a declined/dropped pre-auth). Ambiguous → untouched.
//
// Returns [{ id, status, superseded_by }] patches; never touches posted rows.
export function reconcilePending(storeRows, feedAccounts, { now = Date.now(), windowStart = null, vanishDays = 10 } = {}) {
  const feedIds = new Set();
  let earliestFeed = null;
  for (const a of Array.isArray(feedAccounts) ? feedAccounts : []) {
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
  const pendings = rows
    .filter((r) => r.pending && (r.status || "active") === "active" && !feedIds.has(String(r.id)))
    .filter((r) => time(r.posted) >= coverFrom)
    .sort((a, b) => time(a.posted) - time(b.posted));
  for (const p of pendings) {
    const pAmt = Number(p.amount) || 0;
    const pTime = time(p.posted);
    const cands = (postedByAccount.get(String(p.account_id)) || []).filter((q) => {
      if (claimed.has(String(q.id))) return false;
      const qAmt = Number(q.amount) || 0;
      if ((qAmt > 0) !== (pAmt > 0)) return false;
      const days = (time(q.posted) - pTime) / DAY_MS;
      if (days < -1 || days > 7) return false;
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
// Rebuilds the `financeLive.accounts` shape from store rows so financeLabeledTxns
// keeps its structure: account metadata (org/name/balance) from the live payload,
// transactions from the store (ACTIVE rows only — superseded/vanished are hidden).
// Accounts that exist only in the store (e.g. a CSV-imported account) get a
// synthesized entry named by `accountNames[accountId]`. Manual rows are excluded
// here — they still flow through the manual-txn path.
export function storeAccountsView(rows, liveAccounts, accountNames = {}) {
  const byAccount = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.origin === "manual" || (r.status && r.status !== "active")) continue;
    const k = String(r.account_id || "");
    if (!k) continue;
    if (!byAccount.has(k)) byAccount.set(k, []);
    byAccount.get(k).push({
      id: String(r.id),
      posted: r.posted || null,
      amount: r.amount == null ? null : Number(r.amount),
      description: String(r.description || ""),
      pending: Boolean(r.pending),
      importLabel: r.import_label || "",
      origin: r.origin || "",
    });
  }
  const out = [];
  const seen = new Set();
  for (const a of Array.isArray(liveAccounts) ? liveAccounts : []) {
    const k = String(a?.id || "");
    seen.add(k);
    out.push({ ...a, transactions: byAccount.get(k) || [] });
  }
  for (const [k, transactions] of byAccount) {
    if (seen.has(k)) continue;
    const fallback = k.startsWith("csv:") ? k.slice(4) : "Imported account";
    out.push({ id: k, org: "", name: accountNames[k] || fallback, currency: "USD", balance: null, available: null, balanceDate: null, imported: true, transactions });
  }
  return out;
}

// ── Month-actuals snapshot window (design §5.3 — protects past budgets) ─────
// With permanent history, feeding the WHOLE store to financeMonthsToSnapshot would
// mark every past month "fully covered" and re-snapshot it from transactions whose
// labels may have aged out of the 600-entry cap — silently shrinking past actuals.
// So the snapshot only ever sees what the old 45-day feed would have: bank/CSV
// transactions posted within `days` of `now`, plus manual transactions (which were
// always included at any age). Older months stay frozen.
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
