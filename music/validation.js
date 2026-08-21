// Musical validation — a deterministic, recognition-INDEPENDENT check of a
// ScoreModel for musically suspicious structures (design §13). Kept strictly
// separate from OMR/recognition: a recognizer emits "value + confidence"; this
// asks a different question — "is the result musically consistent?" — with
// rule-based logic that never changes as recognizers come and go. It validates
// ANY ScoreModel, so it also catches dodgy MusicXML imports, not just OMR output.
//
// Pure, DOM-free, exact (rational arithmetic — no float drift). v0 focuses on the
// highest-signal checks: measure duration vs. time signature (the #1 OMR error),
// overfull voices, and empty measures. Each issue is anchored to a measureIndex
// so the review UI can jump straight to it. Conservative by design — a false
// "this looks wrong" is worse than a missed subtlety.

import { rat, add, compare, toNumber, ZERO } from "./rational.js";

export const SEVERITY = { ERROR: "error", WARNING: "warning" };

/** Capacity of a measure in quarter-notes, exact: beats × (4 / beatType). */
export function measureCapacity(timeSig) {
  const [beats, beatType] = timeSig || [4, 4];
  return rat((beats || 4) * 4, beatType || 4);
}

const num = (r) => Math.round(toNumber(r) * 1000) / 1000;

function issue(severity, type, measureIndex, message, { voice = null, expected = null, actual = null } = {}) {
  const o = { severity, type, measureIndex, message };
  if (voice != null) o.voice = voice;
  if (expected) o.expected = num(expected);
  if (actual) o.actual = num(actual);
  return o;
}

/**
 * Validate a ScoreModel. Returns { issues[], ok, errorCount, warningCount }.
 * Each issue: { severity, type, measureIndex, message, voice?, expected?, actual? }.
 */
export function validateScoreModel(model) {
  const issues = [];
  const measures = model?.measures || [];

  measures.forEach((m, idx) => {
    const cap = measureCapacity(m.timeSig);
    const events = m.events || [];
    const mLabel = m.printedNumber || (idx + 1);

    if (!events.length) {
      if (!m.implicit) issues.push(issue(SEVERITY.WARNING, "empty-measure", idx, `Measure ${mLabel} has no notes or rests.`));
      return;
    }

    // Sum each voice's durations exactly (within a voice, events tile in time).
    const byVoice = new Map();
    for (const ev of events) {
      const v = ev.voice || 1;
      byVoice.set(v, add(byVoice.get(v) || ZERO, (ev.dur && ev.dur.den) ? ev.dur : ZERO));
    }

    let maxFill = ZERO;
    for (const [v, fill] of byVoice) {
      if (compare(fill, maxFill) > 0) maxFill = fill;
      if (compare(fill, cap) > 0) {
        issues.push(issue(SEVERITY.ERROR, "overfull-voice", idx,
          `Measure ${mLabel} voice ${v} is overfull (${num(fill)} of ${num(cap)} quarter-notes).`,
          { voice: v, expected: cap, actual: fill }));
      }
    }

    // Incomplete: no voice fills the bar. Skip pickups (implicit) and the final
    // bar (a short last measure is normal), where under-fill is expected.
    if (compare(maxFill, cap) < 0 && !m.implicit && idx !== measures.length - 1) {
      issues.push(issue(SEVERITY.WARNING, "incomplete-measure", idx,
        `Measure ${mLabel} looks incomplete (${num(maxFill)} of ${num(cap)} quarter-notes).`,
        { expected: cap, actual: maxFill }));
    }
  });

  return {
    issues,
    ok: issues.length === 0,
    errorCount: issues.filter((i) => i.severity === SEVERITY.ERROR).length,
    warningCount: issues.filter((i) => i.severity === SEVERITY.WARNING).length,
  };
}

/** Compact human summary for a validation result, or "" when clean. */
export function validationSummary(result) {
  if (!result || result.ok) return "";
  const measures = [...new Set(result.issues.map((i) => i.measureIndex + 1))].slice(0, 4);
  const more = new Set(result.issues.map((i) => i.measureIndex)).size - measures.length;
  const where = `m. ${measures.join(", ")}${more > 0 ? ` +${more}` : ""}`;
  const n = result.issues.length;
  return `${n} measure${n > 1 ? "s" : ""} may have timing issues (${where})`;
}
