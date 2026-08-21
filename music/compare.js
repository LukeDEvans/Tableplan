// Performance comparison — the "compare two attempts" brain (design §24/§38).
// Given two practice sessions of the same Work, produce a structured, musically-
// meaningful diff: how much faster/more accurate, which measures improved or
// regressed, which trouble spots were resolved or newly appeared. This is what
// turns a pile of sessions into "you improved 18 BPM this month and finally
// nailed the left-hand run at measure 42."
//
// Pure and DOM-free. Reads the versioned metrics the practice layer already
// stores on a session (accuracy, tempo, tempoByMeasure, troubleSpots), so it
// depends on nothing but plain records — swappable and fully unit-testable.

const round1 = (n) => Math.round(n * 10) / 10;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Pull a compact attempt summary out of a PracticeSession's metrics[]. */
export function attemptSummary(session) {
  const metric = (t) => (session?.metrics || []).find((m) => m && m.type === t)?.value;
  const tbm = metric("tempoByMeasure");
  return {
    id: session?.id || null,
    startedAt: session?.startedAt || null,
    durationMs: session?.durationMs ?? null,
    accuracy: isNum(metric("accuracy")) ? metric("accuracy") : null,
    avgTempo: isNum(metric("tempo")) ? metric("tempo") : null,
    tempoByMeasure: tbm && typeof tbm === "object" ? tbm : {},
    troubleSpots: Array.isArray(metric("troubleSpots")) ? metric("troubleSpots").map(Number) : [],
  };
}

/**
 * Compare an EARLIER attempt `a` against a LATER attempt `b` (deltas are b − a,
 * so positive = improved). Both are attemptSummary shapes.
 */
export function comparePerformances(a, b) {
  const measures = [...new Set([
    ...Object.keys(a.tempoByMeasure || {}),
    ...Object.keys(b.tempoByMeasure || {}),
  ].map(Number))].sort((x, y) => x - y);

  const tempoByMeasure = measures.map((mi) => {
    const av = a.tempoByMeasure?.[mi] ?? null;
    const bv = b.tempoByMeasure?.[mi] ?? null;
    return { measureIndex: mi, a: av, b: bv, delta: (isNum(av) && isNum(bv)) ? round1(bv - av) : null };
  });

  const aTrouble = new Set(a.troubleSpots || []);
  const bTrouble = new Set(b.troubleSpots || []);

  return {
    avgTempoDelta: (isNum(a.avgTempo) && isNum(b.avgTempo)) ? round1(b.avgTempo - a.avgTempo) : null,
    accuracyDelta: (isNum(a.accuracy) && isNum(b.accuracy)) ? Math.round((b.accuracy - a.accuracy) * 100) / 100 : null,
    tempoByMeasure,
    troubleResolved: [...aTrouble].filter((mi) => !bTrouble.has(mi)).sort((x, y) => x - y), // troubled then, fine now
    troubleNew: [...bTrouble].filter((mi) => !aTrouble.has(mi)).sort((x, y) => x - y),       // regressed
  };
}

/** One-line human headline for a comparison, or "" if there's nothing to say. */
export function comparisonHeadline(cmp) {
  const parts = [];
  if (isNum(cmp.avgTempoDelta) && Math.abs(cmp.avgTempoDelta) >= 1) {
    parts.push(`${cmp.avgTempoDelta > 0 ? "+" : "−"}${Math.abs(cmp.avgTempoDelta)} BPM`);
  }
  if (isNum(cmp.accuracyDelta) && Math.abs(cmp.accuracyDelta) >= 0.01) {
    parts.push(`${cmp.accuracyDelta > 0 ? "+" : "−"}${Math.abs(Math.round(cmp.accuracyDelta * 100))}% accuracy`);
  }
  if (cmp.troubleResolved.length) parts.push(`resolved ${cmp.troubleResolved.length} trouble spot${cmp.troubleResolved.length > 1 ? "s" : ""}`);
  if (cmp.troubleNew.length) parts.push(`${cmp.troubleNew.length} new trouble spot${cmp.troubleNew.length > 1 ? "s" : ""}`);
  return parts.join(" · ");
}
