// async-operation.js — a MINIMAL async-operation STATUS CONTRACT (matrix item 15:
// jobs/operations INCORPORATED, not a job engine). Long-running user-facing work —
// an import, a receipt/recipe scan, TTS generation, a sync flush — can register an
// operation so its status is observable: the developer diagnostics surface lists
// in-flight work, and future AI tooling can reason about what is running.
//
// What this is NOT: it does not schedule, execute, retry, or persist anything. The
// caller owns execution; this only records status. Retryable/recurring BACKGROUND
// JOBS remain governed by ARCHITECTURE.md §8 (bounded, idempotent, killable,
// server-side). This is the small observability contract §8 lacked on the client.
//
// Account-safety: in-memory only, reset on reload → no account-boundary surface.

export const OP_STATUS = Object.freeze({
  PENDING: "pending", RUNNING: "running", SUCCESS: "success", ERROR: "error", CANCELLED: "cancelled",
});
const TERMINAL = new Set([OP_STATUS.SUCCESS, OP_STATUS.ERROR, OP_STATUS.CANCELLED]);

export function createOperationTracker({ cap = 50 } = {}) {
  const ops = [];
  const now = () => new Date().toISOString();
  const find = (id) => ops.find((o) => o.id === id);
  // Keep at most `cap` records: drop the oldest TERMINAL ops first (never a live one).
  const prune = () => {
    while (ops.length > cap) {
      const i = ops.findIndex((o) => TERMINAL.has(o.status));
      if (i < 0) break;
      ops.splice(i, 1);
    }
  };
  const stamp = (o, patch) => { Object.assign(o, patch, { updatedAt: now() }); return o; };

  return {
    start(id, label, meta = {}) {
      const existing = find(id);
      if (existing) return stamp(existing, { status: OP_STATUS.RUNNING, error: null });
      const op = { id: String(id), label: label || String(id), status: OP_STATUS.RUNNING, progress: null, startedAt: now(), updatedAt: now(), error: null, meta };
      ops.push(op); prune(); return op;
    },
    update(id, { progress, status } = {}) {
      const o = find(id); if (!o) return null;
      return stamp(o, { ...(progress != null ? { progress } : {}), ...(status ? { status } : {}) });
    },
    succeed(id) { const o = find(id); return o ? stamp(o, { status: OP_STATUS.SUCCESS, progress: 1 }) : null; },
    fail(id, err) { const o = find(id); return o ? stamp(o, { status: OP_STATUS.ERROR, error: String(err?.message || err || "error").slice(0, 200) }) : null; },
    cancel(id) { const o = find(id); return o ? stamp(o, { status: OP_STATUS.CANCELLED }) : null; },
    get(id) { return find(id) || null; },
    list() { return ops.slice(); },
    active() { return ops.filter((o) => o.status === OP_STATUS.RUNNING || o.status === OP_STATUS.PENDING); },
    clear() { ops.length = 0; },
  };
}
