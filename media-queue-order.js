// The order the Media queue plays in — and so the order "Up Next" is listed in.
//
// One rule: after the current item, playback takes the queue from the top, in
// the order it is listed right now. Nothing is remembered from when playback
// started, so a reorder, a new episode sorted to the top, or playing something
// from the middle of the list all change what comes next. Two exceptions, both
// for the current run only:
//   skipped  items passed with the Next button without finishing. They go to
//            the back of the line (and are listed there), so Next never bounces
//            between the same two items.
//   done     items that already finished or failed but are somehow still
//            listed. They are not played again.
//
// Pure helpers only — no DOM, no app state.

// Ids that play after `currentId`, in order. `listIds` is the queue as listed,
// before the current item is moved to the top.
export function upNextOrder(listIds, { currentId = null, skippedIds = [], doneIds = [] } = {}) {
  const ids = Array.isArray(listIds) ? listIds : [];
  const done = new Set(doneIds);
  const listed = new Set(ids);
  const seen = new Set();
  const skipped = [];
  for (const id of skippedIds) {
    if (id === currentId || done.has(id) || !listed.has(id) || seen.has(id)) continue;
    seen.add(id);
    skipped.push(id);
  }
  return [...ids.filter((id) => id !== currentId && !done.has(id) && !seen.has(id)), ...skipped];
}

// The queue as it is shown: the same items, with the skipped ones moved to the
// end so the list reads in the order it will play. `items` already has the
// current item first (or has no current item).
export function withSkippedLast(items, skippedIds = [], currentId = null) {
  if (!Array.isArray(items) || !skippedIds.length) return items;
  const order = upNextOrder(items.map((i) => i.id), { currentId, skippedIds });
  const byId = new Map(items.map((i) => [i.id, i]));
  const current = currentId != null && byId.has(currentId) ? [byId.get(currentId)] : [];
  return [...current, ...order.map((id) => byId.get(id))];
}

// The item to go back to with the Previous button: the most recent one in the
// trail (what was current before, oldest first) that can still be played.
export function previousFromTrail(trail, playableIds, currentId = null) {
  const ok = new Set(playableIds);
  for (let i = (trail || []).length - 1; i >= 0; i--) {
    if (trail[i] !== currentId && ok.has(trail[i])) return trail[i];
  }
  return null;
}

// The item that holds the "Now Playing" slot while nothing is loaded: what was
// in the player when it was last used (paused, then the app was closed or
// reloaded). It keeps the slot until it is finished or removed, so a newer
// episode from a higher tier lists under it, not over it.
//   localId      the item this device last had loaded (episode or article)
//   lastHistory  the newest entry of the synced listening history — covers an
//                episode paused on another device
//   progress     state.podcastProgress
// An item that is no longer in the queue (played, read, removed) holds nothing.
export function heldQueueId({ localId = null, lastHistory = null, progress = {}, listIds = [] } = {}) {
  const listed = new Set(listIds);
  if (localId && listed.has(localId)) return localId;
  if (lastHistory && lastHistory.kind === "podcast" && listed.has(lastHistory.id)) {
    const p = (progress || {})[lastHistory.id];
    if (p && !p.played && p.position > 0) return lastHistory.id;
  }
  return null;
}
