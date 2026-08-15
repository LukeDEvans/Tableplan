// Stable measure identity across reparses (design adjustment 4).
//
// A `measureId` is the DURABLE anchor a ScorePosition (and thus every annotation
// and session) leans on; `measureIndex` is just its refreshable ordering. The
// problem: reparsing a score (better parser) or replacing the file (correction)
// can insert/remove/renumber measures, which would silently move index-based
// anchors. So:
//
//   • First parse — mint a fresh id per measure and persist a MeasureIdentity
//     record { ids[], fingerprints[] } (index-aligned) alongside the edition.
//   • Reparse/replace — align OLD vs NEW measures by a content FINGERPRINT using
//     a longest-common-subsequence diff. Matched measures KEEP their id; new
//     measures MINT ids; measures that vanish are RETIRED. Any stored position
//     whose measureId was retired is reported so the caller flags it
//     `needs-review` — never dropped (design doc §21).
//
// The fingerprint is derived from musical content (event onsets + pitches +
// durations), so cosmetic/engraving-only parser changes don't break identity,
// while a genuinely different measure gets a new id.

let seq = 0;
export function newMeasureId() {
  seq += 1;
  return `m_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
export function resetMeasureIds() { seq = 0; }

/**
 * Content fingerprint for one ScoreModel measure. Reads events defensively:
 * each event may carry `onset` {num,den} (quarters from measure start),
 * `midis` (number[]), and `dur` {num,den}. Order-independent, so voice ordering
 * quirks don't matter.
 */
export function measureFingerprint(measure) {
  const events = (measure && Array.isArray(measure.events)) ? measure.events : [];
  const tokens = events.map((e) => {
    const on = ratStr(e.onset);
    const midis = Array.isArray(e.midis) ? [...e.midis].sort((a, b) => a - b).join(".") : (e.midi ?? "r");
    const dur = ratStr(e.dur ?? e.duration);
    return `${on}|${midis}|${dur}`;
  }).sort();
  return hash32(`${measure?.timeSig ? measure.timeSig.join("/") : ""}#${tokens.join(";")}`);
}

/** First parse: mint an id per measure + capture fingerprints. */
export function mintMeasureIdentity(measures) {
  const ids = measures.map(() => newMeasureId());
  const fingerprints = measures.map(measureFingerprint);
  return { ids, fingerprints };
}

/**
 * Reparse/replace reconciliation. Returns the new identity plus a migration
 * report. `prior` is the persisted { ids, fingerprints }.
 *   matched   : count of measures that kept their id
 *   minted    : count of brand-new measures
 *   retired   : measureIds that no longer exist → positions on them need review
 */
export function reconcileMeasureIdentity(prior, newMeasures) {
  const priorIds = prior?.ids || [];
  const priorFp = prior?.fingerprints || [];
  const newFp = newMeasures.map(measureFingerprint);

  const pairs = lcsAlign(priorFp, newFp); // [{oldIndex,newIndex}] in increasing order
  const newIds = new Array(newMeasures.length).fill(null);
  const matchedOld = new Set();
  for (const { oldIndex, newIndex } of pairs) {
    newIds[newIndex] = priorIds[oldIndex] ?? newMeasureId();
    matchedOld.add(oldIndex);
  }
  let minted = 0;
  for (let i = 0; i < newIds.length; i++) {
    if (!newIds[i]) { newIds[i] = newMeasureId(); minted += 1; }
  }
  const retired = priorIds.filter((_, i) => !matchedOld.has(i));
  return {
    identity: { ids: newIds, fingerprints: newFp },
    report: { matched: pairs.length, minted, retired },
  };
}

/** Resolve a measureId → current measureIndex after a reparse (null if retired). */
export function indexOfMeasureId(identity, measureId) {
  const i = (identity?.ids || []).indexOf(measureId);
  return i < 0 ? null : i;
}

// ── internals ────────────────────────────────────────────────────────────────
function ratStr(r) { return r && Number.isInteger(r.num) && Number.isInteger(r.den) ? `${r.num}/${r.den}` : String(r ?? ""); }

// Longest common subsequence over fingerprint arrays → aligned index pairs.
function lcsAlign(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push({ oldIndex: i, newIndex: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return pairs;
}

// djb2 → hex, compact and deterministic (fingerprint, not cryptographic).
function hash32(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, "0");
}
