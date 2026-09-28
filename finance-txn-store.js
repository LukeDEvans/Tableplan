// finance-txn-store.js — the client's ONLY door to the durable finance_transactions
// table (ARCHITECTURE §15: data access behind one small module so a local-first
// adapter can replace it). FINANCE_TRANSACTIONS_DESIGN.md §5.2.
//
//   • Mirror: rows persist in a local StoragePort (IndexedDB in the browser, memory
//     in tests) so finance renders offline / at boot without a network read.
//   • Sync: ONE incremental read per explicit trigger (finance open, manual Refresh,
//     after an import) — rows changed since the cursor. No timers, no Realtime, no
//     polling (CLAUDE.md egress warning).
//   • Cursor is KEYSET (updated_at, id), not updated_at alone: a bulk upsert stamps
//     hundreds of rows with the SAME updated_at, so a plain `updated_at > X` page
//     would skip rows at a page boundary and `>=` would loop forever.
//   • Deletes are soft (status='deleted'), so they arrive as ordinary changes.
//
// All I/O is injected (fetchJson, storage) → unit-testable with fakes.

import { mergeStoreRows } from "./finance-transactions.js";

export const FIN_TXN_DB = "live-finance-txns";
export const FIN_TXN_STORES = ["rows", "meta"];
const PAGE = 1000;
const MAX_PAGES = 50;
const LOOKBACK_MS = 2 * 60 * 1000; // hard bound per sync (50k rows) — a first load of years of history fits easily

const SELECT = "id,group_id,origin,account_id,posted,amount,description,pending,status,superseded_by,import_label,import_batch,updated_at";

// PostgREST query for one keyset page after `cursor` ({ updatedAt, id } | null).
export function buildSyncQuery(groupId, cursor, limit = PAGE) {
  const g = encodeURIComponent(groupId);
  let q = `finance_transactions?group_id=eq.${g}&select=${SELECT}&order=updated_at.asc,id.asc&limit=${limit}`;
  if (cursor?.updatedAt) {
    const u = encodeURIComponent(cursor.updatedAt);
    const id = encodeURIComponent(String(cursor.id || "").replace(/["\\]/g, (c) => `\\${c}`));
    // Values double-quoted: PostgREST logic trees split on "," and "()", and a
    // timestamp's "+00:00" offset must survive (it's URL-encoded above).
    q += `&or=(updated_at.gt."${u}",and(updated_at.eq."${u}",id.gt."${id}"))`;
  }
  return q;
}

export function createFinanceTxnStore({ storage, fetchJson, groupId }) {
  if (!storage || typeof fetchJson !== "function" || !groupId) throw new Error("createFinanceTxnStore: storage, fetchJson, groupId required");
  const rowsKey = `rows:${groupId}`;
  const cursorKey = `cursor:${groupId}`;
  let rows = null;          // null = mirror not loaded yet
  let cursor = null;
  let syncing = null;       // in-flight sync promise (re-entrant calls share it)
  let disposed = false;     // set on account-boundary purge — never persist after it

  async function load() {
    if (rows) return rows;
    try {
      rows = (await storage.get("rows", rowsKey)) || [];
      cursor = (await storage.get("meta", cursorKey)) || null;
    } catch {
      rows = [];
      cursor = null;
    }
    return rows;
  }

  // Pull every row changed since the cursor. Returns { changed, rows }.
  // Re-entrant: a second call while one is in flight gets the same promise, so a
  // double trigger can never double-fetch (the auth-storm lesson in CLAUDE.md).
  function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      await load();
      let changed = 0;
      // Re-read a short overlap behind the cursor on the first page: updated_at is
      // the writing transaction's START time, so a slow write can commit AFTER a
      // later-starting one we already synced past. The merge is idempotent by id,
      // so the overlap only costs a few duplicate rows.
      const cursorMs = cursor?.updatedAt ? new Date(cursor.updatedAt).getTime() : NaN;
      let pageCursor = Number.isFinite(cursorMs)
        ? { updatedAt: new Date(cursorMs - LOOKBACK_MS).toISOString(), id: "" }
        : cursor;
      for (let page = 0; page < MAX_PAGES; page++) {
        const batch = await fetchJson(buildSyncQuery(groupId, pageCursor));
        if (!Array.isArray(batch)) throw new Error("finance store: unexpected response");
        if (!batch.length) break;
        // Count only rows that are new or actually different (the overlap re-reads
        // rows we already hold — those aren't changes and shouldn't re-render).
        const prev = new Map(rows.map((r) => [String(r.id), r]));
        for (const r of batch) {
          const old = prev.get(String(r.id));
          if (!old || JSON.stringify(old) !== JSON.stringify(r)) changed++;
        }
        rows = mergeStoreRows(rows, batch);
        const last = batch[batch.length - 1];
        pageCursor = { updatedAt: last.updated_at, id: String(last.id) };
        if (!cursor?.updatedAt || String(last.updated_at) >= String(cursor.updatedAt)) cursor = pageCursor;
        if (batch.length < PAGE) break;
      }
      if (changed && !disposed) {
        try {
          await storage.put("rows", rowsKey, rows);
          await storage.put("meta", cursorKey, cursor);
        } catch { /* mirror is a cache; the DB stays authoritative */ }
      }
      return { changed, rows };
    })().finally(() => { syncing = null; });
    return syncing;
  }

  return {
    load,
    sync,
    rows: () => rows,          // null until load() — callers treat null as "not ready"
    isLoaded: () => rows !== null,
    dispose: () => { disposed = true; },
  };
}
