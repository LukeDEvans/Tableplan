// InputProvider contract + a deterministic test provider. Capture is decoupled
// from interpretation (design doc §11): every provider normalizes to a
// PerformanceEvent stream that the FollowingEngine consumes, so the engine and
// its tests are identical whether input is a perfect MIDI stream, a noisy
// microphone transcription, or a replayed fixture.
//
//   InputProvider:
//     id, kind
//     isAvailable()        → Promise<boolean>
//     start(sink)          → Promise<void>   sink: (PerformanceEvent) => void
//     stop()               → void
//
// Concrete browser providers live in input-midi.js (Web MIDI) and, later,
// input-mic.js (Web Audio pitch/onset detection). This module hosts the pure
// test provider so score-following is testable with no hardware.

/**
 * Replays a fixed list of PerformanceEvents to the sink. Call feedAll() to emit
 * them all synchronously (deterministic tests), or feed(e) to push one at a time.
 */
export function createTestInputProvider(events = []) {
  let sink = null;
  return {
    id: "test",
    kind: "test",
    async isAvailable() { return true; },
    async start(s) { sink = s; },
    stop() { sink = null; },
    feed(event) { if (sink) sink(event); return event; },
    feedAll(list = events) { for (const e of list) if (sink) sink(e); },
  };
}
