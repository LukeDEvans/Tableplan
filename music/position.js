// Canonical score-position model — the single most important contract in the
// Cadence music domain. Musical semantics only (edition, measure, exact offset),
// never display coordinates (page/x/y/scroll). Everything downstream speaks it:
// score-following output, annotations, practice start/end, loop regions, mistake
// tracking, tempo measurements, coaching, recording alignment, navigation.
//
// V1 positions are EDITION-PINNED (editionId required): a position is always
// within one edition. Measure numbering/engraving is not assumed to align across
// editions — cross-edition equivalence is a separate later layer (EditionMapping).
//
// Timing is EXACT (music/rational.js): `offset` is a reduced fraction of a
// quarter note from the measure start (downbeat = {0,1}). No floats, no frozen
// global resolution; the value is resolution-independent and migratable across
// reparses.
//
// ScorePosition:
//   workId, movementId, editionId   required — edition-pinned
//   measureIndex  int               0-based ORDERING index into THIS edition's ScoreModel
//   measureId?    string            STABLE measure identity (survives reparse; see measure-identity.js).
//                                   The durable anchor; measureIndex is refreshed from it after a reparse.
//   offset        {num,den}         exact rational quarter-notes from measure start (downbeat = {0,1})
//   voice?, staff?, partId?, eventId?, repeatPass?
//
// ScoreRange: { start, end }

import { rat, ZERO, isRational, compare as ratCompare, equals as ratEquals } from "./rational.js";

export function makePosition(p = {}) {
  if (!p.workId) throw new Error("ScorePosition requires a workId");
  if (!p.movementId) throw new Error("ScorePosition requires a movementId");
  if (!p.editionId) throw new Error("ScorePosition is edition-pinned: editionId is required");
  const measureIndex = toInt(p.measureIndex, 0);
  if (measureIndex < 0) throw new Error("measureIndex must be >= 0");
  const offset = normalizeOffset(p.offset);
  if (ratCompare(offset, ZERO) < 0) throw new Error("offset (quarter-notes from measure start) must be >= 0");
  const pos = {
    workId: String(p.workId), movementId: String(p.movementId), editionId: String(p.editionId),
    measureIndex, offset,
  };
  if (p.measureId) pos.measureId = String(p.measureId);
  if (p.partId) pos.partId = String(p.partId);
  if (isNum(p.voice)) pos.voice = toInt(p.voice, 0);
  if (isNum(p.staff)) pos.staff = toInt(p.staff, 0);
  if (p.eventId) pos.eventId = String(p.eventId);
  if (isNum(p.repeatPass)) pos.repeatPass = toInt(p.repeatPass, 1);
  return pos;
}

export function makeRange(startLike, endLike) {
  const start = makePosition(startLike);
  const end = makePosition(endLike);
  if (start.workId !== end.workId || start.movementId !== end.movementId || start.editionId !== end.editionId) {
    throw new Error("ScoreRange endpoints must share Work, Movement and Edition");
  }
  return compareWithinMovement(start, end) <= 0 ? { start, end } : { start: end, end: start };
}

/** Equal musical location. Compares ordering coordinates + exact offset; the
 * measureId hint is not part of equality. */
export function samePosition(a, b) {
  if (!a || !b) return false;
  return a.workId === b.workId && a.movementId === b.movementId && a.editionId === b.editionId &&
    a.measureIndex === b.measureIndex && ratEquals(a.offset, b.offset) &&
    (a.voice ?? null) === (b.voice ?? null) && (a.staff ?? null) === (b.staff ?? null) &&
    (a.eventId ?? null) === (b.eventId ?? null);
}

/** Order within one movement (same edition) by measure then exact offset then eventId. -1|0|1. */
export function compareWithinMovement(a, b) {
  if (a.workId !== b.workId || a.movementId !== b.movementId) {
    throw new Error("compareWithinMovement: positions are in different movements");
  }
  if (a.editionId !== b.editionId) {
    throw new Error("compareWithinMovement: positions are in different editions (use EditionMapping)");
  }
  if (a.measureIndex !== b.measureIndex) return a.measureIndex < b.measureIndex ? -1 : 1;
  const c = ratCompare(a.offset, b.offset);
  if (c !== 0) return c;
  const ae = a.eventId ?? "", be = b.eventId ?? "";
  if (ae !== be) return ae < be ? -1 : 1;
  return 0;
}

/** Order across a whole Work; needs a movementOrder (map/array/object → ordinal). -1|0|1. */
export function comparePositions(a, b, movementOrder) {
  if (a.movementId === b.movementId) return compareWithinMovement(a, b);
  const oa = movementOrdinal(a.movementId, movementOrder);
  const ob = movementOrdinal(b.movementId, movementOrder);
  if (oa == null || ob == null) throw new Error("comparePositions across movements requires a movementOrder lookup");
  return oa < ob ? -1 : oa > ob ? 1 : 0;
}

/** Inclusive containment within a single movement/edition. */
export function positionInRange(pos, range) {
  const { start, end } = range;
  if (pos.workId !== start.workId || pos.movementId !== start.movementId || pos.editionId !== start.editionId) return false;
  return compareWithinMovement(pos, start) >= 0 && compareWithinMovement(pos, end) <= 0;
}

// ── internals ────────────────────────────────────────────────────────────────
function normalizeOffset(o) {
  if (o == null) return ZERO;
  if (isRational(o)) return rat(o.num, o.den);
  if (typeof o === "number") throw new Error("offset must be an exact rational {num,den}, not a float");
  if (Array.isArray(o) && o.length === 2) return rat(o[0], o[1]);
  throw new Error("offset must be a rational {num,den}");
}
function isNum(v) { return typeof v === "number" ? !Number.isNaN(v) : (v != null && v !== "" && !Number.isNaN(Number(v))); }
function toInt(v, d) { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : d; }
function movementOrdinal(movementId, order) {
  if (!order) return null;
  if (Array.isArray(order)) { const i = order.indexOf(movementId); return i < 0 ? null : i; }
  if (order instanceof Map) return order.has(movementId) ? order.get(movementId) : null;
  return Object.prototype.hasOwnProperty.call(order, movementId) ? order[movementId] : null;
}
