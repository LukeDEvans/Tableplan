// Server-side ingest of SimpleFIN pulls into the durable finance_transactions store
// (FINANCE_TRANSACTIONS_DESIGN.md §3). Called by the ONLY two bridge callers —
// the daily-briefing cron and simplefin.js `accounts` on a real bridge fetch —
// right after they write the finaccts_ cache. It never calls the bridge itself.
//
// ARCH §8 shape:
//   bounded        — one bulk upsert of ≤ MAX_ROWS rows + a date-windowed reconcile
//                    read + a handful of PATCHes; nothing loops or reschedules.
//   idempotent     — PK (group_id, id) upsert with merge-duplicates on bank-owned
//                    columns only, so a repeat pull changes nothing.
//   non-amplifying — no write here triggers another ingest.
//   failure-isolated — every caller wraps this in try/catch; a missing table (SQL
//                    not applied yet) or a PostgREST error is logged and swallowed,
//                    never blocking the cache write or the balance snapshot.
//   observable     — one structured line per run, no descriptions/amounts (no PII).

const DEFAULT_SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const MAX_ROWS = 5000;
const DAY_MS = 86400000;

let _pure = null;
async function pure() {
  if (!_pure) _pure = await import("../../finance-transactions.js");
  return _pure;
}

function headers(serviceKey, extra = {}) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "content-type": "application/json", ...extra };
}

// Does this group still need the one-time 90-day backfill? true when the store
// holds NO simplefin row older than 60 days (never ingested, or only 45-day pulls
// so far — e.g. an interactive refresh ingested before the first cron ran). Keying
// on "has history" rather than "has any row" means an early 45-day ingest can't
// skip the backfill. (An account genuinely younger than 60 days keeps asking for 90
// days — same ONE bridge call a day, just a longer window, so no extra cost.)
// Returns null when the table isn't reachable (migration not applied) — callers
// then skip ingest entirely and keep today's 45-day pull.
async function storeNeedsBackfill({ serviceKey, groupId, supabaseUrl = DEFAULT_SUPABASE_URL, fetchImpl = fetch, now = Date.now() }) {
  try {
    const cutoff = new Date(now - 60 * DAY_MS).toISOString();
    const res = await fetchImpl(
      `${supabaseUrl}/rest/v1/finance_transactions?group_id=eq.${encodeURIComponent(groupId)}&origin=eq.simplefin` +
      `&posted=lt.${encodeURIComponent(cutoff)}&select=id&limit=1`,
      { headers: headers(serviceKey), cache: "no-store" }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return !(Array.isArray(rows) && rows.length > 0);
  } catch {
    return null;
  }
}

async function ingestFeed({ serviceKey, groupId, accounts, supabaseUrl = DEFAULT_SUPABASE_URL, fetchImpl = fetch, now = Date.now() }) {
  const { feedToStoreRows, reconcilePending } = await pure();
  const rows = feedToStoreRows(groupId, accounts, new Date(now).toISOString()).slice(0, MAX_ROWS);
  const result = { upserted: 0, superseded: 0, vanished: 0 };
  if (!rows.length) {
    console.log(`[fin-ingest] group=${hashId(groupId)} rows=0`);
    return result;
  }

  const up = await fetchImpl(`${supabaseUrl}/rest/v1/finance_transactions?on_conflict=group_id,id`, {
    method: "POST",
    headers: headers(serviceKey, { prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(rows),
  });
  if (!up.ok) throw new Error(`upsert ${up.status}`);
  result.upserted = rows.length;

  // Reconcile pending → posted within the feed's window (+ the 7-day successor
  // slack). Only simplefin rows can be pending, and only they are patched.
  const earliest = rows.reduce((m, r) => (r.posted && (!m || r.posted < m) ? r.posted : m), null);
  if (earliest) {
    const since = new Date(new Date(earliest).getTime() - 8 * DAY_MS).toISOString();
    const res = await fetchImpl(
      `${supabaseUrl}/rest/v1/finance_transactions?group_id=eq.${encodeURIComponent(groupId)}&origin=eq.simplefin` +
      `&status=in.(active,superseded)&or=(posted.gte."${encodeURIComponent(since)}",posted.is.null)` +
      `&select=id,account_id,amount,description,posted,pending,status,superseded_by,first_seen_at&limit=${MAX_ROWS}`,
      { headers: headers(serviceKey), cache: "no-store" }
    );
    if (!res.ok) throw new Error(`reconcile read ${res.status}`);
    const stored = await res.json();
    const patches = reconcilePending(stored, accounts, { now });
    for (const p of patches) {
      const r = await fetchImpl(
        `${supabaseUrl}/rest/v1/finance_transactions?group_id=eq.${encodeURIComponent(groupId)}&id=eq.${encodeURIComponent(p.id)}&origin=eq.simplefin&pending=eq.true`,
        { method: "PATCH", headers: headers(serviceKey, { prefer: "return=minimal" }), body: JSON.stringify({ status: p.status, superseded_by: p.superseded_by }) }
      );
      if (!r.ok) throw new Error(`reconcile patch ${r.status}`);
      if (p.status === "superseded") result.superseded++;
      else result.vanished++;
    }
  }
  console.log(`[fin-ingest] group=${hashId(groupId)} upserted=${result.upserted} superseded=${result.superseded} vanished=${result.vanished}`);
  return result;
}

// SimpleFIN reconnect remap (FINANCE_TRANSACTIONS_DESIGN.md §12): merge an OLD
// account's stored rows into the NEW account that replaced it after a relink.
// simplefin rows are service-role-only writes, so this is the only place it can
// happen. The plan is recomputed HERE from the stored rows (the client only sends
// which two accounts) with the same pure planAccountRemap the client previews with.
// Guards: the old account must be absent from the live feed (else the next ingest
// re-activates its rows) and the new one present. Bounded (one read of the two
// accounts, one bulk upsert) and idempotent (a merged account has no active rows).
async function remapAccount({ serviceKey, groupId, oldAccountId, newAccountId, liveAccountIds, supabaseUrl = DEFAULT_SUPABASE_URL, fetchImpl = fetch }) {
  const oldId = String(oldAccountId || "");
  const newId = String(newAccountId || "");
  const live = new Set((Array.isArray(liveAccountIds) ? liveAccountIds : []).map(String));
  if (!oldId || !newId || oldId === newId) return { error: "Pick two different accounts." };
  if (live.has(oldId)) return { error: "That account is still in the bank feed, so it can't be merged yet." };
  if (!live.has(newId)) return { error: "The account to merge into isn't in the bank feed." };
  const { planAccountRemap } = await pure();
  const q = (v) => `"${String(v).replace(/["\\]/g, (c) => `\\${c}`)}"`;
  const res = await fetchImpl(
    `${supabaseUrl}/rest/v1/finance_transactions?group_id=eq.${encodeURIComponent(groupId)}&origin=eq.simplefin&status=eq.active` +
    `&account_id=in.(${encodeURIComponent(`${q(oldId)},${q(newId)}`)})` +
    `&select=id,group_id,origin,account_id,posted,amount,description,pending,status,superseded_by&limit=${MAX_ROWS}`,
    { headers: headers(serviceKey), cache: "no-store" }
  );
  if (!res.ok) throw new Error(`remap read ${res.status}`);
  const rows = await res.json();
  const plan = planAccountRemap(rows, oldId, newId);
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  // Full rows (every NOT NULL column) so the upsert is a pure update of existing
  // rows; only status / superseded_by / account_id actually change.
  const base = (r) => ({ id: r.id, group_id: r.group_id, origin: r.origin, account_id: r.account_id, posted: r.posted, amount: r.amount, description: r.description, pending: r.pending, status: r.status, superseded_by: r.superseded_by });
  const out = [];
  for (const s of plan.supersede) if (byId.has(s.id)) out.push({ ...base(byId.get(s.id)), status: "superseded", superseded_by: s.superseded_by });
  for (const id of plan.move) if (byId.has(id)) out.push({ ...base(byId.get(id)), account_id: newId });
  for (const id of plan.vanish) if (byId.has(id)) out.push({ ...base(byId.get(id)), status: "vanished", superseded_by: null });
  if (out.length) {
    const up = await fetchImpl(`${supabaseUrl}/rest/v1/finance_transactions?on_conflict=group_id,id`, {
      method: "POST",
      headers: headers(serviceKey, { prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(out),
    });
    if (!up.ok) throw new Error(`remap write ${up.status}`);
  }
  const result = { superseded: plan.supersede.length, moved: plan.move.length, vanished: plan.vanish.length, overlapUnmatched: plan.overlapUnmatched };
  console.log(`[fin-remap] group=${hashId(groupId)} superseded=${result.superseded} moved=${result.moved} vanished=${result.vanished}`);
  return result;
}

// Log a short, non-reversible tag instead of the group id.
function hashId(s) {
  let h = 0;
  for (const ch of String(s || "")) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36).slice(0, 6);
}

// Keep the finaccts_ cache shape unchanged (45 days) even on the 90-day backfill
// pull, so the client's feed — and its month-actuals coverage — is exactly as today.
function trimAccountsToDays(accounts, days, now = Date.now()) {
  const cutoff = now - days * DAY_MS;
  return (Array.isArray(accounts) ? accounts : []).map((a) => ({
    ...a,
    transactions: (a.transactions || []).filter((t) => !t.posted || new Date(t.posted).getTime() >= cutoff),
  }));
}

module.exports = { ingestFeed, storeNeedsBackfill, trimAccountsToDays, remapAccount, MAX_ROWS };
