// history-log.js — append-only permanent history (the `live_history` table).
//
// The app's in-state history lists are deliberately capped so the synced JSONB
// sections stay small (mediaHistory 60, articleHistory 2000, cadenceEvents 1000,
// AI chat 20 in localStorage). Those caps used to DESTROY history. Now every entry
// is also appended here once, so the caps only bound the UI's "recent" window.
// DATA_EXPORT.md §3.
//
// Egress / storm discipline (CLAUDE.md, ARCHITECTURE §8):
//   • Writes happen only because the user did something (played, read, practiced,
//     chatted) — debounced and batched. There are NO reads here except the explicit
//     "Export my data" fetch (fetchAllHistory), and no polling of any kind.
//   • Failures back off and stop: a missing table / auth failure disables sending
//     for the session; transient errors retry at most MAX_RETRIES times per trigger.
//   • The pending queue is bounded (maxQueue) and persisted, so an offline session
//     or an unapplied migration loses nothing recent — and can't grow without limit.
//   • Idempotent: stable row ids + on_conflict ignore-duplicates, so a re-send or a
//     repeated backfill is a no-op server-side.
//
// Pure: storage, network, clock and timers are injected (unit-testable with fakes).

export const HISTORY_QUEUE_KEY = "live-history-queue-v1";
export const HISTORY_KINDS = ["media_play", "article_read", "practice_event", "ai_chat"];

const MAX_ID = 200, MAX_REF = 300, MAX_TITLE = 500, MAX_PAYLOAD_CHARS = 16000, MAX_CHAT_TEXT = 8000;
const MAX_RETRIES = 3;

// FNV-1a 32-bit → base36. Stable content hash for rows that have no id of their own.
export function fnv1a(input) {
  let h = 0x811c9dc5;
  const s = String(input ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
const toIso = (v) => {
  const d = typeof v === "number" ? new Date(v) : new Date(String(v || ""));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// Normalize one row to the table's shape; null when it can't be stored.
export function normalizeHistoryRow(row) {
  if (!row || !HISTORY_KINDS.includes(row.kind) || !row.id) return null;
  const occurred = toIso(row.occurred_at);
  if (!occurred) return null;
  let payload = row.payload ?? null;
  if (payload != null) {
    const json = JSON.stringify(payload);
    if (json.length > MAX_PAYLOAD_CHARS) payload = { truncated: true, preview: json.slice(0, 2000) };
  }
  return {
    id: clip(row.id, MAX_ID),
    kind: row.kind,
    occurred_at: occurred,
    ref_id: clip(row.ref_id, MAX_REF),
    title: clip(row.title, MAX_TITLE),
    payload,
  };
}

// ── Row builders, one per source ────────────────────────────────────────────────

// media-history.js entry { kind, id, title, subtitle, artworkUrl, ref, at(ms) }.
// Every play is its own row (the in-state list de-dupes replays; history doesn't).
export function historyRowFromMedia(e) {
  if (!e?.kind || !e?.id) return null;
  const at = Number.isFinite(e.at) ? e.at : Date.now();
  return normalizeHistoryRow({
    id: `mp:${e.kind}:${fnv1a(e.id)}:${at}`,
    kind: "media_play",
    occurred_at: at,
    ref_id: e.id,
    title: e.title,
    payload: { mediaKind: e.kind, subtitle: e.subtitle || "", ref: e.ref ?? null },
  });
}

// articleHistory entry { id, title, url, date(ISO) }.
export function historyRowFromArticle(h) {
  if (!h?.id) return null;
  return normalizeHistoryRow({
    id: `ar:${fnv1a(h.id)}:${h.date}`,
    kind: "article_read",
    occurred_at: h.date,
    ref_id: h.id,
    title: h.title,
    payload: { url: h.url || "" },
  });
}

// music/events.js event { id, type, at, source, subject?, refs?, data? }.
export function historyRowFromPracticeEvent(e) {
  if (!e?.id) return null;
  return normalizeHistoryRow({
    id: `pe:${e.id}`,
    kind: "practice_event",
    occurred_at: e.at,
    ref_id: e.subject ?? null,
    title: e.type,
    payload: { source: e.source, refs: e.refs ?? null, data: e.data ?? null },
  });
}

// A plain-text chat turn. The user's context preamble ("CURRENT CONTEXT: … ---")
// is app-generated, not something the user said, so only the message is kept.
// Id is a content hash so re-logging the same stored turn after a reload is a no-op.
export function historyRowFromChat(msg, at = Date.now()) {
  if (!msg || typeof msg.content !== "string" || !msg.content.trim()) return null;
  let text = msg.content;
  if (msg.role === "user" && text.startsWith("CURRENT CONTEXT:")) text = text.split("\n\n---\n\n")[1] || "";
  if (!text.trim()) return null;
  return normalizeHistoryRow({
    id: `chat:${msg.role}:${fnv1a(`${msg.role}|${msg.content}`)}`,
    kind: "ai_chat",
    occurred_at: at,
    ref_id: null,
    title: msg.role,
    payload: { role: msg.role, text: text.slice(0, MAX_CHAT_TEXT) },
  });
}

// ── The writer ──────────────────────────────────────────────────────────────────
//
// deps = {
//   storage:   { getItem(k), setItem(k, v) }  — localStorage-like (may throw)
//   post:      async (rows) → { ok, status }  — insert with ignore-duplicates
//   getUserId: () → string | null             — null = signed out / local-dev: no-op
//   schedule:  (fn, ms) → handle; cancel: (handle) → void
//   log?:      (msg) → void
// }
export function createHistoryLog({ storage, post, getUserId, schedule, cancel, log = () => {}, maxQueue = 5000, batchSize = 200, flushDelayMs = 4000 }) {
  let loadedFor = null;   // user id the in-memory queue belongs to
  let queue = [];         // normalized rows, oldest first
  let ids = new Set();
  let backfilled = {};
  let disabled = false;   // table missing / auth refused — stop for this session
  let timer = null;
  let flushing = null;
  let retries = 0;
  let probe = batchSize;  // shrinks on a 400 to isolate a row the server rejects
  let warnedOverflow = false;

  function ensureLoaded() {
    const uid = getUserId();
    if (!uid) return null;
    if (loadedFor === uid) return uid;
    loadedFor = uid;
    queue = []; ids = new Set(); backfilled = {};
    try {
      const saved = JSON.parse(storage.getItem(HISTORY_QUEUE_KEY) || "null");
      if (saved && saved.userId === uid) {
        queue = (Array.isArray(saved.rows) ? saved.rows : []).map(normalizeHistoryRow).filter(Boolean);
        ids = new Set(queue.map((r) => r.id));
        backfilled = saved.backfilled && typeof saved.backfilled === "object" ? saved.backfilled : {};
      }
    } catch { /* unreadable — start empty */ }
    return uid;
  }

  function save() {
    if (!loadedFor) return;
    try { storage.setItem(HISTORY_QUEUE_KEY, JSON.stringify({ userId: loadedFor, rows: queue, backfilled })); }
    catch { /* quota / private mode — the queue still lives in memory */ }
  }

  function arm(ms = flushDelayMs) {
    if (disabled || timer || !queue.length) return;
    timer = schedule(() => { timer = null; flush(); }, ms);
  }

  function enqueue(rows) {
    let added = 0;
    for (const raw of rows) {
      const r = normalizeHistoryRow(raw);
      if (!r || ids.has(r.id)) continue;
      queue.push(r); ids.add(r.id); added++;
    }
    if (queue.length > maxQueue) {
      const drop = queue.splice(0, queue.length - maxQueue);
      for (const r of drop) ids.delete(r.id);
      if (!warnedOverflow) { warnedOverflow = true; log(`history queue full — dropped ${drop.length} oldest unsent rows`); }
    }
    return added;
  }

  function record(rowOrRows) {
    if (!ensureLoaded()) return 0;
    const added = enqueue(Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]);
    if (added) { retries = 0; save(); arm(); }
    return added;
  }

  // One-time upload of history that existed before this log (per user, per tag).
  function backfill(tag, rows) {
    if (!ensureLoaded() || backfilled[tag]) return 0;
    backfilled[tag] = true;
    const added = enqueue(rows || []);
    save();
    arm();
    return added;
  }

  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      try {
        const uid = ensureLoaded();
        if (!uid || disabled || !queue.length) return;
        const batch = queue.slice(0, Math.max(1, probe));
        let res;
        try { res = await post(batch.map((r) => ({ user_id: uid, ...r }))); }
        catch { res = { ok: false, status: 0 }; }
        if (getUserId() !== uid) return; // account changed mid-flight — drop the result
        if (res?.ok) {
          const sent = new Set(batch.map((r) => r.id));
          queue = queue.filter((r) => !sent.has(r.id));
          for (const id of sent) ids.delete(id);
          retries = 0;
          probe = Math.min(batchSize, probe * 2); // grow back after isolating a bad row
          save();
          arm(queue.length ? 1500 : flushDelayMs);
          return;
        }
        const status = res?.status || 0;
        if (status === 404 || status === 401 || status === 403) {
          disabled = true;
          log(`history log disabled for this session (HTTP ${status}) — ${queue.length} rows kept locally`);
          return;
        }
        if (status === 400 || status === 409 || status === 422) {
          if (batch.length === 1) {
            queue.shift(); ids.delete(batch[0].id); save();
            log(`history row rejected and dropped (${batch[0].kind} ${batch[0].id})`);
            probe = batchSize;
          } else {
            probe = Math.max(1, Math.floor(batch.length / 2));
          }
          arm(500);
          return;
        }
        // Network / 5xx: bounded exponential backoff, then wait for the next record().
        if (retries < MAX_RETRIES) { retries++; arm(flushDelayMs * 2 ** retries); }
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  }

  // Account boundary: forget everything in memory (storage is cleared by the
  // app's sign-out sweep — HISTORY_QUEUE_KEY is account-scoped).
  function reset() {
    if (timer) cancel(timer);
    timer = null; loadedFor = null; queue = []; ids = new Set(); backfilled = {};
    disabled = false; retries = 0; probe = batchSize;
  }

  return {
    record, backfill, flush, reset,
    status: () => ({ queued: queue.length, disabled, userId: loadedFor }),
  };
}

// ── Export read (explicit trigger only) ─────────────────────────────────────────

const HISTORY_SELECT = "id,kind,occurred_at,ref_id,title,payload";

// Keyset page query, newest first: (occurred_at, id) strictly below the cursor.
export function buildHistoryPageQuery(userId, cursor, limit = 1000) {
  let q = `live_history?user_id=eq.${encodeURIComponent(userId)}&select=${HISTORY_SELECT}&order=occurred_at.desc,id.desc&limit=${limit}`;
  if (cursor?.occurredAt) {
    const t = encodeURIComponent(cursor.occurredAt);
    const id = encodeURIComponent(String(cursor.id || "").replace(/["\\]/g, (c) => `\\${c}`));
    q += `&or=(occurred_at.lt."${t}",and(occurred_at.eq."${t}",id.lt."${id}"))`;
  }
  return q;
}

// Every history row for the user, newest first. `fetchJson(path)` → array.
// Hard-bounded (maxPages × limit) so a bad cursor can never loop.
export async function fetchAllHistory(fetchJson, userId, { limit = 1000, maxPages = 200 } = {}) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchJson(buildHistoryPageQuery(userId, cursor, limit));
    if (!Array.isArray(batch)) throw new Error("history: unexpected response");
    out.push(...batch);
    if (batch.length < limit) break;
    const last = batch[batch.length - 1];
    cursor = { occurredAt: last.occurred_at, id: last.id };
  }
  return out;
}
