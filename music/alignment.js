// TimelineAlignment — the canonical relationship between a musical ScorePosition
// and performance time (design §20). Built from a follow/practice capture (the
// matched positions + their event timestamps), it powers: click-a-measure →
// hear that moment, jump audio ⇄ score, tempo analysis, and comparing two
// performances of the same Work.
//
// Pure and DOM-free. Musical distance is measured in QUARTER NOTES (exact in the
// model, collapsed to a float here only because tempo/time are inherently
// approximate display quantities). v0 is single-movement / single-edition.
//
// A capture SAMPLE: { position (ScorePosition), tMs (ms since start) }.
// An ALIGNMENT:      { movementId, editionId, points:[{ q, tMs, measureIndex }],
//                      durationQuarters, durationMs }  (points strictly forward).

import { toNumber } from "./rational.js";

/** Absolute quarter-note offset of a position within its movement. */
export function absQuarters(model, position) {
  const measures = model?.measures || [];
  let q = 0;
  const upto = Math.min(position.measureIndex || 0, measures.length);
  for (let i = 0; i < upto; i++) q += measureQuarters(measures[i]);
  q += toNumber(position.offset || { num: 0, den: 1 });
  return q;
}

function measureQuarters(m) {
  if (m && m.durationQuarters) return toNumber(m.durationQuarters);
  const [beats, beatType] = (m && m.timeSig) || [4, 4];
  return beats * (4 / beatType);
}

/**
 * Build an alignment from capture samples. Points are made strictly forward in
 * BOTH q and time (a repeat/restart or a backward correction starts a fresh
 * forward run is out of scope for v0 — we keep the monotonic spine), which is
 * what tempo and seeking need.
 */
export function buildAlignment(samples, model, { movementId = null, editionId = null } = {}) {
  const raw = (samples || [])
    .filter((s) => s && s.position && Number.isFinite(s.tMs))
    .map((s) => ({ q: absQuarters(model, s.position), tMs: s.tMs, measureIndex: s.position.measureIndex || 0 }))
    .sort((a, b) => a.tMs - b.tMs);

  const points = [];
  for (const p of raw) {
    const last = points[points.length - 1];
    if (!last) { points.push(p); continue; }
    if (p.tMs <= last.tMs) continue;      // need strictly increasing time
    if (p.q <= last.q) continue;          // keep the forward musical spine
    points.push(p);
  }

  const durationQuarters = points.length ? points[points.length - 1].q - points[0].q : 0;
  const durationMs = points.length ? points[points.length - 1].tMs - points[0].tMs : 0;
  return {
    movementId: movementId || null,
    editionId: editionId || null,
    points,
    durationQuarters,
    durationMs,
  };
}

/** Overall tempo in BPM (quarter notes per minute), or null if indeterminate. */
export function averageTempo(alignment) {
  const { durationQuarters, durationMs } = alignment || {};
  if (!durationMs || durationMs <= 0 || !durationQuarters) return null;
  return round1((durationQuarters * 60000) / durationMs);
}

/**
 * Local tempo between consecutive points: [{ measureIndex, tMs, bpm }]. This is
 * the tempo curve — where you rushed or dragged. Optionally smoothed over a
 * window of N segments (median) to tame per-note jitter.
 */
export function tempoCurve(alignment, { smooth = 1 } = {}) {
  const pts = (alignment && alignment.points) || [];
  const seg = [];
  for (let i = 1; i < pts.length; i++) {
    const dq = pts[i].q - pts[i - 1].q;
    const dt = pts[i].tMs - pts[i - 1].tMs;
    if (dq <= 0 || dt <= 0) continue;
    seg.push({ measureIndex: pts[i].measureIndex, tMs: pts[i].tMs, bpm: (dq * 60000) / dt });
  }
  if (smooth <= 1) return seg.map((s) => ({ ...s, bpm: round1(s.bpm) }));
  return seg.map((s, i) => {
    const from = Math.max(0, i - Math.floor(smooth / 2));
    const to = Math.min(seg.length, from + smooth);
    const bpms = seg.slice(from, to).map((x) => x.bpm).sort((a, b) => a - b);
    return { ...s, bpm: round1(bpms[Math.floor(bpms.length / 2)]) };
  });
}

/** Performance time (ms) for a musical position — for "click a measure → hear it". */
export function timeAtPosition(alignment, model, position) {
  const pts = (alignment && alignment.points) || [];
  if (!pts.length) return null;
  const q = absQuarters(model, position);
  return interp(pts, q, "q", "tMs");
}

/** Musical location for a performance time — for "scrub audio → follow the score". */
export function positionAtTime(alignment, tMs) {
  const pts = (alignment && alignment.points) || [];
  if (!pts.length) return null;
  const q = interp(pts, tMs, "tMs", "q");
  // Tag with the measureIndex of the nearest point (good enough for seeking UI).
  let nearest = pts[0];
  for (const p of pts) if (Math.abs(p.tMs - tMs) < Math.abs(nearest.tMs - tMs)) nearest = p;
  return { q, measureIndex: nearest.measureIndex };
}

// Linear interpolation of `outKey` for a target `inKey` value across sorted pts,
// clamped to the endpoints (friendlier than null for seek/jump UIs).
function interp(pts, target, inKey, outKey) {
  if (target <= pts[0][inKey]) return pts[0][outKey];
  if (target >= pts[pts.length - 1][inKey]) return pts[pts.length - 1][outKey];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (target <= b[inKey]) {
      const span = b[inKey] - a[inKey];
      if (span <= 0) return a[outKey];
      const f = (target - a[inKey]) / span;
      return a[outKey] + f * (b[outKey] - a[outKey]);
    }
  }
  return pts[pts.length - 1][outKey];
}

function round1(n) { return Math.round(n * 10) / 10; }
