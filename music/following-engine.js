// Score-following engine — estimates where the performer is in the canonical
// score and emits a ScorePosition + confidence. It knows nothing about pages,
// pixels, scrolling, or rendering (design doc §12); the presentation layer
// decides what to do with the position. Algorithms are swappable behind this
// interface; this is a deliberately simple, tempo-agnostic v0.
//
//   FollowingEngine:
//     load(model, { context, startAt })  → FollowState
//     push(PerformanceEvent)             → FollowState
//     reset(at?)                         → FollowState
//     state()                            → FollowState
//   FollowState: { position, confidence(0..1), lost, matched, skipped }
//
// v0 matcher: match incoming noteOn pitches against a flattened expected-note
// sequence, with a small forward window (tolerates missed/skipped notes) and a
// backward window (tolerates restarts/repeats). It is pitch-based and therefore
// tempo/rubato/pause-agnostic — timing never derails it. Chords match on pitch
// membership; wrong/extra notes don't advance and erode confidence; enough
// consecutive misses flips `lost`.

import { makePosition, compareWithinMovement } from "./position.js";

/** Flatten a ScoreModel into the ordered sequence of played notes + positions. */
export function buildExpectedSequence(model, context = {}) {
  const seq = [];
  for (const m of (model?.measures || [])) {
    for (const e of (m.events || [])) {
      if (e.kind === "rest" || !e.midis || !e.midis.length) continue;
      seq.push({
        midis: [...e.midis],
        position: makePosition({ ...context, measureIndex: m.index, offset: e.onset, eventId: e.id }),
      });
    }
  }
  return seq;
}

export function createFollowingEngine({ id = "naive-v0", window = 4, backWindow = 3, lostAfter = 4, historySize = 8 } = {}) {
  let expected = [];
  let cursor = 0;             // index of the next expected note
  let lastPosition = null;
  let history = [];           // recent match booleans (confidence window)
  let misses = 0;             // consecutive misses (lost detection)
  let chordIdx = -1;          // expected index currently being completed (multi-note chord)
  let chordSatisfied = new Set(); // midis already played for expected[chordIdx]

  const confidence = () => (history.length ? Math.round((history.filter(Boolean).length / history.length) * 100) / 100 : 0);
  const record = (ok) => { history.push(ok); if (history.length > historySize) history.shift(); misses = ok ? 0 : misses + 1; };
  const st = (matched, skipped = 0) => ({ position: lastPosition, confidence: confidence(), lost: misses >= lostAfter, matched, skipped });
  const hit = (midis, midi) => midis.includes(midi);
  // Land on expected[i]: record the position, advance the cursor past it, and
  // remember it as the chord being completed so later members of the SAME chord
  // (piano is polyphonic: a chord arrives as several noteOns) count as correct.
  const enterMatch = (i, midi) => { lastPosition = expected[i].position; chordIdx = i; chordSatisfied = new Set([midi]); cursor = i + 1; };
  const clearChord = () => { chordIdx = -1; chordSatisfied = new Set(); };

  const api = {
    id,
    load(model, opts = {}) {
      expected = buildExpectedSequence(model, opts.context || {});
      cursor = 0; history = []; misses = 0; clearChord();
      lastPosition = expected[0]?.position || null;
      if (opts.startAt) return api.reset(opts.startAt);
      return st(false);
    },
    push(event) {
      if (!event || event.type !== "noteOn" || event.note?.midi == null) return st(false);
      const midi = event.note.midi;
      // 0. Completing the current chord: another member of the chord we just
      //    landed on — correct, holds position, doesn't erode confidence.
      if (chordIdx >= 0 && chordIdx < expected.length) {
        const members = expected[chordIdx].midis;
        if (members.length > 1 && members.includes(midi) && !chordSatisfied.has(midi)) {
          chordSatisfied.add(midi); record(true); return st(true, 0);
        }
      }
      // 1. Forward window: correct note, or jump past missed/skipped notes.
      for (let i = cursor; i < Math.min(cursor + window, expected.length); i++) {
        if (hit(expected[i].midis, midi)) {
          const skipped = i - cursor;
          enterMatch(i, midi); record(true);
          return st(true, skipped);
        }
      }
      // 2. Backward window: a restart or repeat of a recently-passed note.
      for (let i = Math.max(0, cursor - 1 - backWindow); i < cursor - 1; i++) {
        if (hit(expected[i].midis, midi)) {
          const jumped = i - cursor; // negative → moved back
          enterMatch(i, midi); record(true);
          return st(true, jumped);
        }
      }
      // 3. Wrong / extra note: no advance, confidence erodes.
      record(false);
      return st(false);
    },
    reset(at) {
      history = []; misses = 0; clearChord();
      if (!at) { cursor = 0; lastPosition = expected[0]?.position || null; return st(false); }
      let idx = expected.length;
      for (let i = 0; i < expected.length; i++) {
        let cmp;
        try { cmp = compareWithinMovement(expected[i].position, at); } catch { idx = i; break; }
        if (cmp >= 0) { idx = i; break; }
      }
      cursor = Math.min(idx, expected.length);
      lastPosition = expected[Math.min(cursor, expected.length - 1)]?.position || null;
      return st(false);
    },
    state() { return st(false); },
    expectedLength() { return expected.length; },
  };
  return api;
}
