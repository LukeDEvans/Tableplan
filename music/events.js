// Cadence domain-events log — a durable, append-only journal of meaningful
// musical activity (design §36). NOT event sourcing: the canonical records
// (Works, sessions…) remain the source of truth for reads; events are a
// complementary history that pays for itself three ways — activity/analytics
// ("you've practiced 6 days running"), sync (events union cleanly across
// devices), and future knowledge-graph/journal ties.
//
// Pure and DOM-free: the app appends events on import/practice/delete and syncs
// them as the id-keyed `cadenceEvents` collection (union merge ⇒ neither device
// loses history). Bounded: capped so the log can never grow without limit.
//
// Event: { id, type, at (ISO), subject?, refs?, data?, source }

let evtCounter = 0;
function eventId() {
  evtCounter += 1;
  return `evt_${Date.now().toString(36)}${evtCounter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// Known types kept as an open set (unknown types still round-trip via makeEvent),
// so a new event kind never needs a schema change — only a new constant here.
export const EVENT = {
  SCORE_IMPORTED: "score-imported",
  SCORE_DELETED: "score-deleted",
  SCORE_CORRECTED: "score-corrected",   // OMR/edit correction (future)
  PRACTICE_COMPLETED: "practice-completed",
  ANNOTATION_ADDED: "annotation-added", // future
  GOAL_COMPLETED: "goal-completed",     // future graph tie
};

export const DEFAULT_EVENT_CAP = 1000;

/** Normalize/build an event. Tolerant of partials (a synced row or a fresh call). */
export function makeEvent(p = {}) {
  const e = {
    id: p.id ? String(p.id) : eventId(),
    type: String(p.type || "unknown"),
    at: p.at ? String(p.at) : new Date().toISOString(),
    source: String(p.source || "app"),
  };
  if (p.subject != null) e.subject = String(p.subject);           // usually a workId
  if (p.refs && typeof p.refs === "object") e.refs = { ...p.refs }; // { sessionId, editionId, … }
  if (p.data && typeof p.data === "object") e.data = { ...p.data }; // small display payload
  return e;
}

/**
 * Append an event to a log, de-duped by id and bounded to `cap` (newest kept).
 * Returns a NEW array (never mutates), so it slots into state assignment cleanly.
 */
export function appendEvent(log, eventLike, { cap = DEFAULT_EVENT_CAP } = {}) {
  const list = Array.isArray(log) ? log : [];
  const event = eventLike && eventLike.id && eventLike.type ? eventLike : makeEvent(eventLike);
  if (list.some((e) => e && e.id === event.id)) return list;
  const next = [...list, event];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Chronological view (newest first), optionally filtered to one subject/type. */
export function listEvents(log, { subject = null, type = null } = {}) {
  return (Array.isArray(log) ? log : [])
    .filter((e) => e && (!subject || e.subject === subject) && (!type || e.type === type))
    .slice()
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}

/** Tiny rollup for an activity summary: counts per type + total + last timestamp. */
export function summarizeEvents(log) {
  const byType = {};
  let lastAt = null;
  for (const e of (Array.isArray(log) ? log : [])) {
    if (!e || !e.type) continue;
    byType[e.type] = (byType[e.type] || 0) + 1;
    if (!lastAt || String(e.at || "") > lastAt) lastAt = e.at || null;
  }
  return { total: Array.isArray(log) ? log.length : 0, byType, lastAt };
}
