// The normalized, app-owned ScoreModel — derived from MusicXML but insulating
// every consumer from its format. MusicXML `divisions` never leaves the parser:
// each ScoreModel carries its OWN integer resolution `ticksPerQuarter`, derived
// as the LCM of every divisions value the score actually uses, so every onset is
// an exact integer tick with no global constant frozen. Event onsets/durations
// are ALSO kept as exact rationals (quarter notes), which are the resolution-
// free, migratable form the position layer persists.
//
// ScoreModel:
//   id, representationId, parseVersion, ticksPerQuarter,
//   parts:    [{ id, name }]
//   measures: [ Measure ]
//   repeats:  [ { kind, measureIndex, ... } ]     // barline repeats/voltas (basic)
//   warnings: [ string ]                          // non-fatal parse issues, surfaced not swallowed
//
// Measure:
//   index, printedNumber, implicit(bool),
//   timeSig: [beats, beatType], keySigFifths,
//   startTick, durationTicks, durationQuarters:{num,den},
//   events: [ Event ]
//
// Event:
//   id, partId, staff, voice, kind:"note"|"chord"|"rest",
//   onset:{num,den}, dur:{num,den},      // exact rational quarters (onset within measure)
//   onsetTick, durationTicks,            // integer ticks at this model's resolution
//   midis:number[], pitches:[{midi,tied}]

import { lcmAll, toTicks, toNumber } from "./rational.js";

/** Derive a model's integer resolution from the divisions values it uses. */
export function deriveResolution(divisionsValues) {
  const vals = (divisionsValues && divisionsValues.length) ? divisionsValues : [1];
  return lcmAll(vals);
}

/** Exact integer tick for a rational-quarters value at this model's resolution. */
export function quartersToTick(rational, ticksPerQuarter) {
  const { ticks, exact } = toTicks(rational, ticksPerQuarter);
  return { tick: ticks, exact };
}

/**
 * Human-readable beat number (1-based) for display only, from an exact
 * within-measure offset. Beat unit follows the time signature denominator
 * (4/4 → quarter beats: offset 1.5q = beat 2.5; 6/8 → eighth beats). Compound-
 * meter dotted grouping is a display refinement; the value here is exact.
 */
export function offsetToDisplayBeat(offsetRational, timeSig) {
  const beatType = (timeSig && timeSig[1]) || 4;
  const beatUnitInQuarters = 4 / beatType;         // eighth = 0.5q, quarter = 1q
  return 1 + toNumber(offsetRational) / beatUnitInQuarters;
}

/** Light normalizer/guard for a ScoreModel object (defensive on load). */
export function makeScoreModel(p = {}) {
  return {
    entity: "scoreModel",
    id: String(p.id || ""),
    representationId: String(p.representationId || ""),
    parseVersion: Number.isFinite(p.parseVersion) ? p.parseVersion : 0,
    ticksPerQuarter: Number.isFinite(p.ticksPerQuarter) ? p.ticksPerQuarter : 1,
    parts: Array.isArray(p.parts) ? p.parts : [],
    measures: Array.isArray(p.measures) ? p.measures : [],
    repeats: Array.isArray(p.repeats) ? p.repeats : [],
    warnings: Array.isArray(p.warnings) ? p.warnings : [],
  };
}

/** Total tick length of the model (sum of measure durations). */
export function totalTicks(model) {
  return model.measures.reduce((s, m) => s + (m.durationTicks || 0), 0);
}
