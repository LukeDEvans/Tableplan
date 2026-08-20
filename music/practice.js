// Practice-session service — the durable daily-use loop. Sessions are canonical
// user data (music/domain.js makePracticeSession): they link to a Work/Movement/
// Edition, carry timing, and own extensible metrics later. Stored locally in the
// "practiceSessions" StoragePort store (offline-owned); metadata sync is a later
// concern. Pure over an injected StoragePort, so it's fully testable.

import { makePracticeSession, makeRecording } from "./domain.js";

/** Persist a session (normalizes + assigns an id). Returns the stored record. */
export async function saveSession(storage, sessionLike) {
  const s = makePracticeSession(sessionLike);
  await storage.put("practiceSessions", s.id, s);
  return s;
}

// ── Recordings (first-class Performances) ────────────────────────────────────
// A Recording captures WHAT was played — here, the event-stream/alignment of a
// follow-tracked session. Kept local (durable per device) and linked from the
// session via recordingId; the small comparison summary already rides the synced
// session metrics, so heavy alignment data need not bloat the synced rows.

/** Persist a recording (normalizes + assigns an id). Returns the stored record. */
export async function saveRecording(storage, recordingLike) {
  const r = makeRecording(recordingLike);
  await storage.put("recordings", r.id, r);
  return r;
}

export async function getRecording(storage, id) {
  return id ? storage.get("recordings", id) : undefined;
}

export async function deleteRecording(storage, id) {
  if (id) await storage.delete("recordings", id);
}

/** Sessions, newest first, optionally filtered to one work. */
export async function listSessions(storage, { workId = null } = {}) {
  const all = await storage.getAll("practiceSessions");
  const rows = workId ? all.filter((s) => s.workId === workId) : all;
  return rows.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
}

export async function deleteSession(storage, id) { await storage.delete("practiceSessions", id); }

/** Aggregate stats for a set of sessions. */
export function sessionStats(sessions) {
  const totalMs = sessions.reduce((m, s) => m + (s.durationMs || 0), 0);
  return { count: sessions.length, totalMs, lastAt: sessions[0]?.startedAt || null };
}

/** Per-work rollup: { [workId]: { count, totalMs, lastAt } } — for library summaries. */
export async function workStats(storage) {
  const all = await storage.getAll("practiceSessions");
  const byWork = {};
  for (const s of all) {
    const w = (byWork[s.workId] ||= { count: 0, totalMs: 0, lastAt: null });
    w.count += 1;
    w.totalMs += s.durationMs || 0;
    if (!w.lastAt || String(s.startedAt || "") > w.lastAt) w.lastAt = s.startedAt || null;
  }
  return byWork;
}

/** Compact human duration: 45s · 12m · 1h 20m. */
export function formatDuration(ms) {
  const secs = Math.round((ms || 0) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), rem = mins % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/** Relative day label for a timestamp: Today · Yesterday · Mon · Aug 3. */
export function relativeDay(iso, now = new Date()) {
  if (!iso) return "";
  const d = new Date(iso);
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
