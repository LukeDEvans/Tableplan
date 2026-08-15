import { describe, it, expect } from "vitest";
import { rat } from "../music/rational.js";
import { makePosition } from "../music/position.js";
import { noteOn, noteOff, sustain } from "../music/performance-event.js";
import { createFollowingEngine, buildExpectedSequence } from "../music/following-engine.js";
import { createTestInputProvider } from "../music/input-provider.js";

// Hand-built ScoreModel: a short line + a chord. (No parser needed.)
const note = (midi, on, id) => ({ kind: "note", midis: [midi], onset: rat(on, 1), id });
const chord = (midis, on, id) => ({ kind: "chord", midis, onset: rat(on, 1), id });
const rest = (on, id) => ({ kind: "rest", midis: [], onset: rat(on, 1), id });
const model = {
  measures: [
    { index: 0, timeSig: [4, 4], events: [note(60, 0, "a"), note(62, 1, "b"), note(64, 2, "c"), note(65, 3, "d")] },
    { index: 1, timeSig: [4, 4], events: [note(67, 0, "e"), rest(1, "r"), chord([60, 64, 67], 2, "f")] },
  ],
};
const context = { workId: "w", movementId: "m", editionId: "e" };
const eng = () => { const e = createFollowingEngine(); e.load(model, { context }); return e; };
let t = 0; const on = (midi) => noteOn((t += 100), midi, { source: "test" });

describe("following — expected sequence", () => {
  it("flattens played notes in order, excluding rests", () => {
    const seq = buildExpectedSequence(model, context);
    expect(seq.map((s) => s.midis[0])).toEqual([60, 62, 64, 65, 67, 60]); // last = chord's first midi
    expect(seq).toHaveLength(6);
    expect(seq[0].position).toMatchObject({ measureIndex: 0, editionId: "e" });
  });
});

describe("following — correct performance", () => {
  it("advances note-by-note with rising confidence, never lost", () => {
    const e = eng();
    for (const m of [60, 62, 64, 65]) { const s = e.push(on(m)); expect(s.matched).toBe(true); expect(s.lost).toBe(false); }
    const s = e.push(on(67)); // into measure 1
    expect(s.position).toMatchObject({ measureIndex: 1, offset: { num: 0, den: 1 } });
    expect(s.confidence).toBe(1);
  });
});

describe("following — mistakes", () => {
  it("a wrong note doesn't advance and erodes confidence, then recovers", () => {
    const e = eng();
    e.push(on(60));
    const wrong = e.push(on(61));
    expect(wrong.matched).toBe(false);
    expect(wrong.position).toMatchObject({ measureIndex: 0, offset: { num: 0, den: 1 } }); // stayed on C
    expect(wrong.confidence).toBeLessThan(1);
    expect(e.push(on(62)).matched).toBe(true); // recovers
  });

  it("a missed/skipped note is jumped past when the next played note matches ahead", () => {
    const e = eng();
    e.push(on(60));
    const s = e.push(on(64)); // skipped 62
    expect(s.matched).toBe(true);
    expect(s.skipped).toBe(1);
    expect(s.position).toMatchObject({ measureIndex: 0, eventId: "c" });
  });

  it("extra notes are ignored; the line continues", () => {
    const e = eng();
    e.push(on(60)); e.push(on(62));
    expect(e.push(on(99)).matched).toBe(false); // extra
    expect(e.push(on(64)).matched).toBe(true);  // continues
  });

  it("flips to lost after enough consecutive misses", () => {
    const e = eng();
    let s;
    for (const m of [1, 2, 3, 4]) s = e.push(on(m)); // all wrong (sub-piano pitches)
    expect(s.lost).toBe(true);
  });
});

describe("following — restarts, repeats, chords", () => {
  it("reset(position) jumps the cursor to an arbitrary starting point", () => {
    const e = eng();
    e.push(on(60)); e.push(on(62)); e.push(on(64)); e.push(on(65)); e.push(on(67));
    e.reset(makePosition({ ...context, measureIndex: 0, offset: rat(0, 1) }));
    const s = e.push(on(60)); // starts over from the top
    expect(s.matched).toBe(true);
    expect(s.position).toMatchObject({ measureIndex: 0, eventId: "a" });
  });

  it("detects a jump BACK to a recently-played note (repeat)", () => {
    const e = eng();
    e.push(on(60)); e.push(on(62)); e.push(on(64)); e.push(on(65)); // cursor at 4
    const s = e.push(on(62)); // 62 is behind — a repeat
    expect(s.matched).toBe(true);
    expect(s.position).toMatchObject({ eventId: "b" });
    expect(s.skipped).toBeLessThan(0); // negative = moved back
  });

  it("matches a chord on any of its member pitches", () => {
    const e = eng();
    e.reset(makePosition({ ...context, measureIndex: 1, offset: rat(0, 1) })); // at the m1 downbeat (67)
    e.push(on(67));
    const s = e.push(on(64)); // 64 is a member of the [60,64,67] chord
    expect(s.matched).toBe(true);
    expect(s.position).toMatchObject({ measureIndex: 1, eventId: "f" });
  });
});

describe("following — robustness", () => {
  it("is tempo/pause-agnostic (matches by pitch regardless of timing)", () => {
    const e = eng();
    expect(e.push(noteOn(0, 60)).matched).toBe(true);
    expect(e.push(noteOn(50, 62)).matched).toBe(true);       // fast
    expect(e.push(noteOn(9999999, 64)).matched).toBe(true);  // long pause — still fine
  });

  it("survives noisy input interleaved with correct notes", () => {
    const e = eng();
    let s;
    for (const m of [60, 99, 62, 30, 64]) s = e.push(on(m)); // 2 wrong among 3 correct
    expect(s.matched).toBe(true);
    expect(s.position).toMatchObject({ eventId: "c" }); // reached the 3rd correct note
    expect(s.lost).toBe(false);
  });

  it("ignores non-note events (noteOff, sustain)", () => {
    const e = eng();
    e.push(on(60));
    const before = e.state().position;
    expect(e.push(noteOff(10, 60)).matched).toBe(false);
    expect(e.push(sustain(11, true)).matched).toBe(false);
    expect(e.state().position).toEqual(before); // cursor unchanged
  });
});

describe("following — test input provider drives the engine", () => {
  it("replays a fixture stream into the engine via a sink", () => {
    const e = eng();
    const provider = createTestInputProvider([noteOn(0, 60), noteOn(100, 62), noteOn(200, 64)]);
    const states = [];
    provider.start((ev) => states.push(e.push(ev)));
    provider.feedAll();
    expect(states.map((s) => s.matched)).toEqual([true, true, true]);
    expect(states.at(-1).position).toMatchObject({ eventId: "c" });
  });
});
