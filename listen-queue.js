// One Listen queue and player per person, the same in every view
// (LISTEN_QUEUE_DESIGN.md, Luke 2026-11-13).
//
// Saved shows, saved articles and books stay in the view's own `media` row.
// What belongs to the PERSON — where they are in each episode, what they've
// finished, what they added to or took out of the queue, their listening
// history — lives in their own `listen` row (u-<uid>:listen), which no view
// switch ever swaps. That's what fixes episodes that finished in one view but
// stayed in the queue of another (2026-11-13: played while shopping in
// Household, still queued in Personal).
//
// Which shows fill the queue automatically: the person's home library — their
// Personal shows if they have the Personal view, else the Household shows
// (Luke, 2026-11-13: "Personal shows only"; a Household episode joins his
// queue only when he adds it by hand).
//
// Pure helpers only — no DOM, no app state.

// The keys that moved out of the `media` section into the person's `listen` row.
export const LISTEN_PERSON_KEYS = Object.freeze([
  "podcastProgress",      // per-episode position, played mark
  "mediaProgress",        // per-item positions (books, other media)
  "readingProgress",      // book / audiobook positions
  "mediaQueueAdded",      // manual "Add to queue" entries
  "mediaQueueRemoved",    // "Remove from queue"
  "podcastAutoSkipped",   // "Remove from list" (also hides under Recent)
  "mediaAllPinnedOrder",  // the queue's hand-dragged order
  "mediaHistory",         // recently played
]);

const HISTORY_CAP = 60; // history-log.js keeps mediaHistory at 60

function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
function arr(v) { return Array.isArray(v) ? v : []; }

// When an entry was last touched (positions carry lastPlayedAt, played marks playedAt).
function touchedAt(e) {
  const t = Math.max(Date.parse(e?.lastPlayedAt || "") || 0, Date.parse(e?.playedAt || "") || 0, Number(e?.updatedAt) || 0);
  return Number.isFinite(t) ? t : 0;
}

// Per-item progress maps: the more recently touched entry wins; a finished mark
// on either side sticks, so nothing already finished comes back into a queue.
export function mergeProgressMaps(...maps) {
  const out = {};
  for (const m of maps) {
    for (const [id, e] of Object.entries(obj(m))) {
      if (!e || typeof e !== "object") continue;
      const cur = out[id];
      if (!cur) { out[id] = { ...e }; continue; }
      const winner = touchedAt(e) > touchedAt(cur) ? { ...e } : { ...cur };
      const finished = [cur, e].find((x) => x.played === true);
      if (finished) {
        winner.played = true;
        if (!winner.playedAt && finished.playedAt) winner.playedAt = finished.playedAt;
      }
      out[id] = winner;
    }
  }
  return out;
}

function unionStrings(...lists) {
  const seen = new Set();
  const out = [];
  for (const l of lists) for (const s of arr(l)) {
    if (typeof s !== "string" || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// Manual queue entries: one per ref (what it points at), the first seen wins,
// so the person's own queue keeps its order and Household's adds follow.
function unionQueueAdded(...lists) {
  const refs = new Set();
  const ids = new Set();
  const out = [];
  for (const l of lists) for (const e of arr(l)) {
    if (!e || typeof e !== "object" || !e.id || !e.ref) continue;
    if (refs.has(e.ref) || ids.has(e.id)) continue;
    refs.add(e.ref);
    ids.add(e.id);
    out.push(e);
  }
  return out;
}

function unionHistory(...lists) {
  const byId = new Map();
  for (const l of lists) for (const h of arr(l)) {
    if (!h || typeof h !== "object") continue;
    const id = h.id || `${h.kind || ""}:${h.at || ""}`;
    if (!byId.has(id)) byId.set(id, h);
  }
  return [...byId.values()]
    .sort((a, b) => (Number(b.at) || Date.parse(b.at) || 0) - (Number(a.at) || Date.parse(a.at) || 0))
    .slice(0, HISTORY_CAP);
}

// The one-time move (design §5): fold the queue state this device already has
// and the copies in the old `media` rows into one. `sources` in priority
// order — the person's current copy first, then their Personal media row, then
// the Household media row. Running it twice gives the same result.
export function mergeListenSeed(...sources) {
  const s = sources.map(obj);
  const pinned = s.map((x) => arr(x.mediaAllPinnedOrder)).find((l) => l.length) || [];
  return {
    podcastProgress: mergeProgressMaps(...s.map((x) => x.podcastProgress)),
    mediaProgress: mergeProgressMaps(...s.map((x) => x.mediaProgress)),
    readingProgress: mergeProgressMaps(...s.map((x) => x.readingProgress)),
    mediaQueueAdded: unionQueueAdded(...s.map((x) => x.mediaQueueAdded)),
    mediaQueueRemoved: unionStrings(...s.map((x) => x.mediaQueueRemoved)),
    podcastAutoSkipped: unionStrings(...s.map((x) => x.podcastAutoSkipped)),
    mediaAllPinnedOrder: [...pinned],
    mediaHistory: unionHistory(...s.map((x) => x.mediaHistory)),
  };
}

// PostgREST select for just these keys of a media row (keeps the one-time read
// to a few KB instead of the whole row, which carries saved-article text).
export function listenKeysSelect() {
  return ["id", ...LISTEN_PERSON_KEYS.map((k) => `${k}:state->${k}`)].join(",");
}

// A row read with listenKeysSelect() back into a plain { key: value } object.
export function listenKeysFromRow(row) {
  const out = {};
  for (const k of LISTEN_PERSON_KEYS) if (row && row[k] != null) out[k] = row[k];
  return out;
}
