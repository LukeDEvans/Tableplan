// Unified media USER-STATE layer — Continue · History · Saved across every media
// kind (design §12/§13/§14). It bridges the two things that already exist: the
// canonical Media envelope (media-model.js) and the unified history store
// (media-history.js). It adds NO new store for history (reuses state.mediaHistory)
// and introduces ONE app-owned Saved store (state.mediaSaved) for cross-provider
// Watch-Later / Listen-Later / Favourites. Pure, DOM-free — the app calls these
// over plain arrays and persist()s; no per-kind logic leaks into the UI.

import { makeMediaItem, mediaKey, MEDIA_KIND } from "./media-model.js";
import { makeHistoryEntry, pushHistory, recentHistory } from "./media-history.js";

const clamp01 = (n) => Math.max(0, Math.min(1, n));

// ── History (canonical envelope ⇄ the existing media-history store) ────────────
// A MediaItem → a media-history entry. `ref` carries what replay/reopen needs so
// the entry can be turned back into a canonical item without a second store.
export function toHistoryEntry(item) {
  return makeHistoryEntry({
    kind: item.kind,
    id: item.id,
    title: item.title,
    subtitle: item.subtitle,
    artworkUrl: item.artworkUrl,
    ref: { providerRefs: item.providerRefs || [], meta: item.meta || {}, source: item.source ?? null },
    at: (item.userState && item.userState.lastAt) || Date.now(),
  });
}

/** Record a canonical item as recently-played (reuses media-history.pushHistory). */
export function recordPlayback(list, item, opts = {}) {
  return pushHistory(list, toHistoryEntry(item), opts);
}

/** A media-history entry → a lightweight canonical MediaItem (for rendering). */
export function fromHistoryEntry(entry) {
  const ref = (entry && entry.ref) || {};
  return makeMediaItem({
    kind: entry.kind, id: entry.id, title: entry.title, subtitle: entry.subtitle, artworkUrl: entry.artworkUrl,
    providerRefs: ref.providerRefs || [], meta: ref.meta || {}, source: ref.source ?? null,
    userState: { lastAt: entry.at },
  });
}

/** Recent history as canonical items, optionally filtered by kind(s). */
export function historyItems(list, opts) {
  return recentHistory(list, opts).map(fromHistoryEntry);
}

// ── Continue (resume across kinds; per-kind progress semantics, design §12) ────
export function progressRatio(p) {
  if (!p) return 0;
  if (p.completed) return 1;
  if (typeof p.percent === "number") return clamp01(p.percent);
  if (p.duration && p.position != null) return clamp01(p.position / p.duration);
  return 0;
}

function fmtRemaining(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** Human progress label — never forcing one kind's semantics onto another. */
export function progressLabel(p) {
  if (!p) return "";
  if (p.kind === "episodic" && p.season != null) return `S${p.season}${p.episode != null ? ` E${p.episode}` : ""}`;
  if (p.kind === "live") return "Live";
  if (p.completed) return "Done";
  if (p.duration && p.position != null) return `${fmtRemaining(p.duration - p.position)} left`;
  if (typeof p.percent === "number") return `${Math.round(p.percent * 100)}%`;
  return "";
}

/** Is this item worth resuming? (Started, not finished; a series in progress; not live.) */
export function isContinuable(item) {
  const p = item && item.userState && item.userState.progress;
  if (!p || p.completed || p.kind === "live") return false;
  if (p.kind === "episodic") return true;
  const r = progressRatio(p);
  return r > 0.01 && r < 0.98;
}

/** The Continue list from canonical items (any adapter), newest-activity first. */
export function continueList(items, { limit } = {}) {
  const out = (items || [])
    .filter(isContinuable)
    .sort((a, b) => ((b.userState && b.userState.lastAt) || 0) - ((a.userState && a.userState.lastAt) || 0));
  return limit != null ? out.slice(0, limit) : out;
}

// ── Saved (app-owned Watch-Later / Listen-Later / Favourites, design §14) ──────
export const SAVED_LIST = Object.freeze({ WATCH_LATER: "watch-later", LISTEN_LATER: "listen-later", FAVORITES: "favorites" });

/** A saved record (id === mediaKey so it unions cleanly across devices). */
export function makeSavedItem(item, list = SAVED_LIST.WATCH_LATER) {
  const key = mediaKey(item);
  return {
    id: key, key, list,
    kind: item.kind, title: item.title, subtitle: item.subtitle, artworkUrl: item.artworkUrl,
    providerRefs: item.providerRefs || [], meta: item.meta || {}, source: item.source ?? null,
    savedAt: Date.now(),
  };
}

const keyOf = (itemOrKey) => (typeof itemOrKey === "string" ? itemOrKey : mediaKey(itemOrKey));

export function isSaved(saved, itemOrKey, list) {
  const key = keyOf(itemOrKey);
  return (saved || []).some((s) => s.key === key && (!list || s.list === list));
}

export function saveItem(saved, item, list = SAVED_LIST.WATCH_LATER) {
  const arr = Array.isArray(saved) ? saved : [];
  const key = mediaKey(item);
  if (arr.some((s) => s.key === key && s.list === list)) return arr; // idempotent
  return [makeSavedItem(item, list), ...arr];
}

export function unsaveItem(saved, itemOrKey, list) {
  const key = keyOf(itemOrKey);
  return (saved || []).filter((s) => !(s.key === key && (!list || s.list === list)));
}

export function toggleSaved(saved, item, list = SAVED_LIST.WATCH_LATER) {
  return isSaved(saved, item, list) ? unsaveItem(saved, item, list) : saveItem(saved, item, list);
}

/** Saved items, newest first, filterable by list and/or kind. */
export function savedList(saved, { list, kind } = {}) {
  return (saved || [])
    .filter((s) => (!list || s.list === list) && (!kind || s.kind === kind))
    .slice()
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}
