// receipts-sync.js — keeps the app's one receipts list (state.receipts) in step
// with the fin_receipts table (migrations/2026-11-12-fin-receipts.sql).
//
// The receipts list stays where every page already reads it. This module only
// moves changes in and out:
//   pull: rows changed since the last read (household + this person's Personal
//         scope; row security decides) → merged into the list, table wins.
//   push: receipts whose content or scope changed since they were last synced →
//         updated or inserted; receipts removed from the list → deleted_at.
// No polling: the app calls sync() when it starts, after a save, and when it
// comes back to the foreground. A pull reads only rows changed since the last one.
//
// Scope of a receipt: the household's group id, or "u-<uid>" when it is marked
// a Personal purchase (receipt.view === "personal"; FINANCE_AUDIT §8). Moving a
// receipt between the two is an update of `scope`, which row security allows
// only to someone who can see both.

const ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/;
const SCOPE_RE = /^[A-Za-z0-9_-]{1,80}$/;
const enc = encodeURIComponent;
const okId = (id) => typeof id === "string" && ID_RE.test(id);

// ---- pure ------------------------------------------------------------------------

export const receiptScope = (receipt, { groupId, userId }) =>
  (receipt?.view === "personal" && userId ? `u-${userId}` : groupId) || "";

export const receiptSig = (receipt, scope) => `${scope}|${JSON.stringify(receipt)}`;

// What to send. synced: Map id → { sig, scope } as of the last sync.
// isRemoved(id): true only when the app recorded deleting it (a tombstone). A
// receipt merely missing from the list (not loaded yet) is never removed.
// → { write: [{ id, scope, data }], remove: [{ id, scope }] }
export function planReceiptPush(receipts, synced, scopes, isRemoved = () => false) {
  const write = [];
  const seen = new Set();
  for (const r of receipts || []) {
    if (!okId(r?.id)) continue;
    seen.add(r.id);
    const scope = receiptScope(r, scopes);
    if (!SCOPE_RE.test(scope)) continue;
    if (synced.get(r.id)?.sig !== receiptSig(r, scope)) write.push({ id: r.id, scope, data: r });
  }
  const remove = [];
  for (const [id, s] of synced) if (!seen.has(id) && !s.deleted && isRemoved(id)) remove.push({ id, scope: s.scope });
  return { write, remove };
}

// Rows from the table → the merged list, plus which ids were removed elsewhere.
// A row the table has (not deleted) replaces the local copy; a deleted row drops it.
export function applyReceiptRows(receipts, rows) {
  const byId = new Map((receipts || []).filter((r) => r?.id).map((r) => [r.id, r]));
  const removed = [];
  let changed = false;
  for (const row of rows || []) {
    if (!okId(row?.id)) continue;
    if (row.deleted_at) {
      if (byId.delete(row.id)) { removed.push(row.id); changed = true; }
      continue;
    }
    if (!row.data || typeof row.data !== "object" || row.data.id !== row.id) continue;
    const cur = byId.get(row.id);
    if (!cur || JSON.stringify(cur) !== JSON.stringify(row.data)) { byId.set(row.id, row.data); changed = true; }
  }
  return { receipts: changed ? [...byId.values()] : receipts, removed, changed };
}

// ---- with the network --------------------------------------------------------------

// transport: messaging/server.js createRestTransport. store: { get(key), set(key, value) }
// for the "since" stamp and the synced signatures (per person; small).
// getReceipts(): the current list. setReceipts(list, { removed }): replace it.
// scopes(): { groupId, userId }.
export function createReceiptsSync({ transport, store, getReceipts, setReceipts, scopes, isRemoved = () => false, normalize = (r) => r }) {
  const KEY = "live-receipts-sync-v1";
  let mem = null;
  const load = () => {
    if (mem) return mem;
    let saved = null;
    try { saved = JSON.parse(store.get(KEY) || "null"); } catch { saved = null; }
    mem = { since: saved?.since || "", user: saved?.user || "", synced: new Map(Object.entries(saved?.synced || {})) };
    return mem;
  };
  const save = () => {
    try { store.set(KEY, JSON.stringify({ since: mem.since, user: mem.user, synced: Object.fromEntries(mem.synced) })); } catch { /* storage full or blocked: next sync re-reads */ }
  };
  let running = null;
  let again = false;

  async function pull(s) {
    const q = `select=id,scope,data,updated_at,deleted_at&order=updated_at.asc&limit=500${s.since ? `&updated_at=gt.${enc(s.since)}` : ""}`;
    const rows = (await transport.select("fin_receipts", q)) || [];
    if (!rows.length) return 0;
    const fixed = rows.map((row) => (row.deleted_at || !row.data ? row : { ...row, data: normalize(row.data) }));
    const { receipts, removed, changed } = applyReceiptRows(getReceipts(), fixed);
    if (changed) setReceipts(receipts, { removed });
    for (const row of fixed) {
      if (row.deleted_at) s.synced.set(row.id, { sig: "", scope: row.scope, deleted: true });
      else if (row.data?.id === row.id) s.synced.set(row.id, { sig: receiptSig(row.data, row.scope), scope: row.scope });
    }
    s.since = rows[rows.length - 1].updated_at || s.since;
    return rows.length;
  }

  async function push(s, sc) {
    const { write, remove } = planReceiptPush(getReceipts(), s.synced, sc, isRemoved);
    if (write.length) {
      // Which already exist (and that I can see): update those, insert the rest.
      const ids = write.map((w) => w.id);
      const have = new Set();
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        for (const row of (await transport.select("fin_receipts", `id=in.(${chunk.map((id) => `"${id}"`).join(",")})&select=id`)) || []) have.add(row.id);
      }
      const fresh = write.filter((w) => !have.has(w.id));
      for (let i = 0; i < fresh.length; i += 50) await transport.insert("fin_receipts", fresh.slice(i, i + 50).map(({ id, scope, data }) => ({ id, scope, data })));
      for (const w of write.filter((x) => have.has(x.id))) {
        await transport.update("fin_receipts", `id=eq.${enc(w.id)}`, { scope: w.scope, data: w.data, deleted_at: null });
      }
      for (const w of write) s.synced.set(w.id, { sig: receiptSig(w.data, w.scope), scope: w.scope });
    }
    for (const r of remove) {
      await transport.update("fin_receipts", `id=eq.${enc(r.id)}`, { deleted_at: new Date().toISOString() });
      s.synced.set(r.id, { sig: "", scope: r.scope, deleted: true });
    }
    return write.length + remove.length;
  }

  let lastPullAt = 0;
  async function run({ pull: doPull = true } = {}) {
    const sc = scopes();
    if (!sc?.userId || !sc?.groupId) return { pulled: 0, pushed: 0 };
    const s = load();
    // Another person signed in on this device: start over (never push their list as ours).
    if (s.user !== sc.userId) { s.user = sc.userId; s.since = ""; s.synced = new Map(); }
    // Pull first, so a receipt changed on another device isn't overwritten by an
    // older copy here; then push what's left.
    let pulled = 0;
    if (doPull || !lastPullAt) {
      for (let n = 0; n < 10; n++) { const got = await pull(s); pulled += got; if (got < 500) break; }
      lastPullAt = Date.now();
    }
    const pushed = await push(s, sc);
    save();
    return { pulled, pushed };
  }

  return {
    // One at a time; a call while running queues exactly one more.
    // { pull: false }: only send this device's changes (after a save); the first
    // sync of a session always reads too.
    sync(opts = {}) {
      if (running) { again = true; return running; }
      running = (async () => {
        try { return await run(opts); }
        finally {
          running = null;
          if (again) { again = false; queueMicrotask(() => this.sync().catch(() => {})); }
        }
      })();
      return running;
    },
    reset() { mem = { since: "", user: "", synced: new Map() }; save(); },
  };
}
