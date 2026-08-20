// Deliberate practice — sections (design §27). A Section is a named measure
// range of a Work with an optional target tempo: "measures 42–57, aim for 96
// BPM." Practicing while a section is active tags the session, so the app can
// track attempts and progress toward the target — the difference between
// "playing a piece" and "practicing a skill."
//
// Pure and DOM-free. Measure numbers are 1-based (what the user sees on the
// score), converted from 0-based position.measureIndex at the call site.

import { uid } from "./domain.js";

const str = (v, d = "") => (v == null ? d : String(v));
const nowIso = () => new Date().toISOString();
const toInt = (v, d) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : d; };
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Normalize/build a Section. start/end are 1-based inclusive measure numbers. */
export function makeSection(p = {}) {
  const start = Math.max(1, toInt(p.startMeasure, 1));
  const end = Math.max(start, toInt(p.endMeasure, start));
  return {
    entity: "section",
    id: str(p.id) || uid("sec"),
    workId: str(p.workId),
    editionId: str(p.editionId) || null,
    label: str(p.label) || `Measures ${start}–${end}`,
    startMeasure: start,
    endMeasure: end,
    targetTempo: p.targetTempo == null || p.targetTempo === "" ? null : Number(p.targetTempo) || null,
    createdAt: str(p.createdAt) || nowIso(),
  };
}

/** Is a 1-based measure number inside the section? */
export function sectionContains(section, measure1Based) {
  return measure1Based >= section.startMeasure && measure1Based <= section.endMeasure;
}

/** The tag stored on a session that practiced this section. */
export function sectionTag(section) {
  return { sectionId: section.id, startMeasure: section.startMeasure, endMeasure: section.endMeasure };
}

const metricVal = (session, type) => (session?.metrics || []).find((m) => m && m.type === type)?.value;

/**
 * Progress for a section from a work's sessions: attempts, best/last tempo, best
 * accuracy, and whether the target tempo has been reached. Sessions are assumed
 * newest-first (as the app stores them); pass only this work's sessions.
 */
export function sectionStats(section, sessions) {
  const mine = (sessions || []).filter((s) => (s?.sectionsPracticed || []).some((x) => x && x.sectionId === section.id));
  const tempos = mine.map((s) => metricVal(s, "tempo")).filter(isNum);
  const accs = mine.map((s) => metricVal(s, "accuracy")).filter(isNum);
  const lastWithTempo = mine.find((s) => isNum(metricVal(s, "tempo")));
  const bestTempo = tempos.length ? Math.max(...tempos) : null;
  return {
    attempts: mine.length,
    bestTempo,
    lastTempo: lastWithTempo ? metricVal(lastWithTempo, "tempo") : null,
    bestAccuracy: accs.length ? Math.max(...accs) : null,
    targetReached: isNum(section.targetTempo) && isNum(bestTempo) ? bestTempo >= section.targetTempo : false,
    // 0..1 progress toward the target tempo (best so far / target), capped at 1.
    tempoProgress: isNum(section.targetTempo) && section.targetTempo > 0 && isNum(bestTempo)
      ? Math.min(1, bestTempo / section.targetTempo) : null,
  };
}
