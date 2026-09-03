// publications-notify.js — the PURE notification / triage / retention lifecycle for
// Publications (Phase 2B). This state is kept ENTIRELY SEPARATE from the canonical
// Article (publications.js): an Article never carries notification/reading/listening/
// consumption/playlist fields. The lifecycle is a map articleId → { state,
// discoveredAt, resolvedAt }, so the same Article can be saved, no-longer-a-
// notification, partially read, and in the playlist all at once (those live elsewhere).
//
// Locked distinctions (audit + Phase 2B §7):
//   DISCOVERY  — a feed found the Article (Phase 2A ingest).
//   NOTIFICATION — a temporary triage entry (PENDING) for a NEWLY-discovered Article.
//   RETENTION  — the user chose to KEEP it (SAVED) → the permanent library.
//   DISMISSED  — the user skipped it (canonical Article is KEPT, just not in the library).
// Retention of the NOTIFICATION view (default 7 days) never deletes the Article or
// any consumption/reading/listening history — it only ages an entry out of triage.

export const NOTIF = Object.freeze({ PENDING: "pending", SAVED: "saved", DISMISSED: "dismissed" });
export const DEFAULT_NOTIFICATION_RETENTION_DAYS = 7; // configurable later; not hard-baked into the model
const DAY_MS = 86400000;

export function normalizeNotifications(x) {
  return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}

const nowIso = () => new Date().toISOString();
const ms = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? 0 : t; };

// Sort key: newest PUBLICATION date first (audit §14 — never reorder on rediscovery,
// because reconcile preserves publishedAt), then discovery, then id for stability.
function byRecency(a, b) {
  return (ms(b.publishedAt) - ms(a.publishedAt))
    || (ms(b.discoveredAt) - ms(a.discoveredAt))
    || String(a.id).localeCompare(String(b.id));
}

// Mark ONE article discovered. Creates a PENDING notification ONLY if the article
// has never been seen. Rediscovery of a saved/dismissed/expired article does NOT
// reset it to pending (§20) — its existing lifecycle entry is left untouched.
export function markDiscovered(map, articleId, at = nowIso()) {
  const m = normalizeNotifications(map);
  if (!articleId || m[articleId]) return m;
  return { ...m, [articleId]: { state: NOTIF.PENDING, discoveredAt: at, resolvedAt: null } };
}

// Mark a batch discovered (an ingest run) — only genuinely-new ids become PENDING.
export function markManyDiscovered(map, articleIds, at = nowIso()) {
  let m = normalizeNotifications(map);
  for (const id of articleIds || []) m = markDiscovered(m, id, at);
  return m;
}

function transition(map, articleId, state, at) {
  const m = normalizeNotifications(map);
  if (!articleId) return m;
  const prev = m[articleId] || { discoveredAt: at, resolvedAt: null };
  return { ...m, [articleId]: { ...prev, state, resolvedAt: at } };
}

// Retain the Article (the permanent library). Resolves its notification. Does NOT
// play, consume, mark read, or add to a playlist — those are separate concerns.
export function saveArticle(map, articleId, at = nowIso()) { return transition(map, articleId, NOTIF.SAVED, at); }

// Skip it. Resolves the notification; the canonical Article is KEPT (recoverable).
export function dismissArticle(map, articleId, at = nowIso()) { return transition(map, articleId, NOTIF.DISMISSED, at); }

const stateOf = (map, id) => normalizeNotifications(map)[id]?.state || null;
export function isSaved(map, id) { return stateOf(map, id) === NOTIF.SAVED; }
export function isDismissed(map, id) { return stateOf(map, id) === NOTIF.DISMISSED; }

// Is a PENDING entry still within the (notification-only) retention window?
function withinRetention(entry, now, retentionDays) {
  return ms(entry.discoveredAt) >= (new Date(now).getTime() - retentionDays * DAY_MS);
}

// The Notifications triage deck: PENDING articles discovered within the retention
// window, newest publication date first. Expiring an entry from THIS view never
// deletes the Article (retainedArticles/history are unaffected).
export function pendingNotifications(articles, notifMap, now = nowIso(), { retentionDays = DEFAULT_NOTIFICATION_RETENTION_DAYS } = {}) {
  const m = normalizeNotifications(notifMap);
  return (articles || [])
    .filter((a) => { const n = m[a.id]; return n && n.state === NOTIF.PENDING && withinRetention(n, now, retentionDays); })
    .sort(byRecency);
}

// Deterministic badge: the exact count of actionable notifications. `badgeLabel`
// caps the DISPLAY at 99+ while the underlying count stays exact (§18).
export function notificationBadgeCount(articles, notifMap, now = nowIso(), opts = {}) {
  return pendingNotifications(articles, notifMap, now, opts).length;
}
export function badgeLabel(count) { return count > 99 ? "99+" : String(Math.max(0, count | 0)); }

// The permanent library = SAVED articles, newest publication date first. Optional
// publication filter runs through the canonical Article.publicationId (multiple
// discovery feeds still resolve to ONE Article).
export function retainedArticles(articles, notifMap, { publicationId = null } = {}) {
  const m = normalizeNotifications(notifMap);
  return (articles || [])
    .filter((a) => m[a.id]?.state === NOTIF.SAVED && (!publicationId || a.publicationId === publicationId))
    .sort(byRecency);
}

// "Recent" = retained articles whose PUBLICATION date is within `days`.
export function recentRetained(articles, notifMap, now = nowIso(), { days = 14 } = {}) {
  const cutoff = new Date(now).getTime() - days * DAY_MS;
  return retainedArticles(articles, notifMap).filter((a) => ms(a.publishedAt) >= cutoff);
}

// Cap the notification map to the articles that still exist + a bounded number of
// resolved entries, so it can't grow without bound in the interim state store.
export function pruneNotifications(map, articleIds, { keepResolved = 2000 } = {}) {
  const m = normalizeNotifications(map);
  const live = new Set((articleIds || []).map(String));
  const kept = {};
  const resolved = [];
  for (const [id, n] of Object.entries(m)) {
    if (!live.has(id)) continue;                       // article gone → drop its entry
    if (n.state === NOTIF.PENDING) kept[id] = n;       // always keep pending
    else resolved.push([id, n]);
  }
  resolved.sort((a, b) => ms(b[1].resolvedAt) - ms(a[1].resolvedAt));
  for (const [id, n] of resolved.slice(0, keepResolved)) kept[id] = n;
  return kept;
}
