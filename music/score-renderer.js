// ScoreRenderer contract + the library-agnostic mapping between screen pixels
// and canonical ScorePositions. This is where "rendering and navigation are
// separate" and "rendering is testable independently" become concrete.
//
// A renderer adapter (OSMD, Verovio, …) does exactly one Cadence-specific thing
// after it draws: emit a LayoutIndex — the list of rendered notes, each carrying
// BOTH its musical coordinates {measureIndex, offset, eventId, midis} AND its
// pixel rect {page,x,y,w,h}. Everything else — click→position, position→pixels,
// nearest-note hit testing — is pure functions over that index, so the whole
// decoupling can be unit-tested with a synthetic LayoutIndex and no browser.
//
// ScoreRenderer (implemented by adapters, browser-only):
//   async load(container, musicXmlString, { mode })  // "paged" | "continuous"
//   async render()
//   getLayoutIndex() -> LayoutIndex                    // the Cadence-specific bit
//   highlight(scorePosition)                           // draw a cursor at a position
//   setMode(mode); setZoom(z); destroy()
//
// LayoutIndex:
//   { context: { workId, movementId, editionId },
//     notes: [ { measureIndex, offset:{num,den}, eventId, midis, page, rect:{x,y,w,h} } ] }

import { makePosition, samePosition } from "./position.js";
import { compare as ratCompare } from "./rational.js";

/** Turn a LayoutIndex note into a canonical ScorePosition (edition-pinned). */
export function noteToPosition(note, context, measureIds = []) {
  return makePosition({
    workId: context.workId, movementId: context.movementId, editionId: context.editionId,
    measureIndex: note.measureIndex,
    measureId: measureIds[note.measureIndex] || undefined,
    offset: note.offset,
    eventId: note.eventId,
  });
}

/**
 * viewportToPosition — click (x,y) → ScorePosition. Prefers a note whose rect
 * contains the point; otherwise the nearest note by centre distance (optionally
 * limited to a page). Returns null for an empty layout.
 */
export function hitTestPosition(layout, x, y, page = null) {
  const note = hitTestNote(layout.notes, x, y, page);
  return note ? noteToPosition(note, layout.context, layout.measureIds) : null;
}

export function hitTestNote(notes, x, y, page = null) {
  const pool = page == null ? notes : notes.filter((n) => n.page === page);
  if (!pool.length) return null;
  const inside = pool.find((n) => x >= n.rect.x && x <= n.rect.x + n.rect.w && y >= n.rect.y && y <= n.rect.y + n.rect.h);
  if (inside) return inside;
  let best = null, bestD = Infinity;
  for (const n of pool) {
    const cx = n.rect.x + n.rect.w / 2, cy = n.rect.y + n.rect.h / 2;
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

/**
 * positionToViewport — ScorePosition → pixel rect. Exact match on
 * measureIndex+offset when present; otherwise falls back to the measure's first
 * note (so navigation still lands on the right bar). Returns null if the measure
 * isn't laid out.
 */
export function positionToRect(layout, pos) {
  const note = findNote(layout, pos);
  return note ? { page: note.page ?? 0, ...note.rect } : null;
}

export function findNote(layout, pos) {
  const inMeasure = layout.notes.filter((n) => n.measureIndex === pos.measureIndex);
  if (!inMeasure.length) return null;
  // exact offset match
  const exact = inMeasure.find((n) => ratCompare(n.offset, pos.offset) === 0
    && (pos.eventId == null || n.eventId === pos.eventId));
  if (exact) return exact;
  // nearest-at-or-before the requested offset, else the measure's first note
  let candidate = inMeasure[0];
  for (const n of inMeasure) if (ratCompare(n.offset, pos.offset) <= 0) candidate = n;
  return candidate;
}

/** Round-trip helper used by tests and by tap-to-seek: a click resolves to a
 * position that maps back onto the same note's rect. */
export function roundTrips(layout, x, y) {
  const pos = hitTestPosition(layout, x, y);
  if (!pos) return false;
  const rect = positionToRect(layout, pos);
  if (!rect) return false;
  const note = hitTestNote(layout.notes, x, y);
  return samePosition(pos, noteToPosition(note, layout.context, layout.measureIds));
}
