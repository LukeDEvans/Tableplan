import { describe, it, expect } from "vitest";
import { rat } from "../music/rational.js";
import { hitTestPosition, hitTestNote, positionToRect, findNote, noteToPosition, roundTrips } from "../music/score-renderer.js";

// A synthetic LayoutIndex — what an OSMD/Verovio adapter would emit after
// rendering. Two measures, a handful of notes with pixel rects. No browser.
const context = { workId: "w1", movementId: "m1", editionId: "e1" };
const N = (measureIndex, num, den, eventId, midis, x, y) => ({ measureIndex, offset: rat(num, den), eventId, midis, page: 0, rect: { x, y, w: 18, h: 40 } });
const layout = {
  context, measureIds: ["m_A", "m_B"],
  notes: [
    N(0, 0, 1, "ev1", [60], 100, 200),   // m0 downbeat
    N(0, 1, 3, "ev2", [62], 140, 200),   // m0 triplet-eighth (exact 1/3)
    N(0, 2, 3, "ev3", [64], 180, 200),   // m0 2/3
    N(1, 0, 1, "ev4", [67], 260, 200),   // m1 downbeat
    N(1, 1, 2, "ev5", [69], 300, 200),   // m1 "and of 1"
  ],
};

describe("score-renderer — click → ScorePosition", () => {
  it("maps a click inside a note's rect to that note's edition-pinned position", () => {
    const pos = hitTestPosition(layout, 145, 210); // over ev2
    expect(pos).toMatchObject({ workId: "w1", editionId: "e1", measureIndex: 0, eventId: "ev2" });
    expect(pos.offset).toEqual({ num: 1, den: 3 });
    expect(pos.measureId).toBe("m_A"); // stable id stamped from the measure map
  });
  it("falls back to the nearest note when the click misses every rect", () => {
    const note = hitTestNote(layout.notes, 320, 400); // below/right of everything
    expect(note.eventId).toBe("ev5"); // nearest centre
  });
  it("returns null for an empty layout", () => {
    expect(hitTestPosition({ context, notes: [] }, 10, 10)).toBeNull();
  });
});

describe("score-renderer — ScorePosition → pixels", () => {
  it("finds the exact note rect for a position", () => {
    const pos = noteToPosition(layout.notes[2], context, layout.measureIds); // ev3, m0 2/3
    const rect = positionToRect(layout, pos);
    expect(rect).toMatchObject({ x: 180, y: 200 });
  });
  it("falls back to the at-or-before note when offset has no exact match", () => {
    const pos = { ...context, measureIndex: 0, offset: rat(1, 2) }; // between 1/3 and 2/3
    const note = findNote(layout, pos);
    expect(note.eventId).toBe("ev2"); // 1/3 is the last onset at-or-before 1/2
  });
  it("returns null when the measure isn't laid out", () => {
    expect(positionToRect(layout, { ...context, measureIndex: 9, offset: rat(0, 1) })).toBeNull();
  });
});

describe("score-renderer — the decoupling round-trip", () => {
  it("click → position → pixels lands back on the same note (every note)", () => {
    for (const n of layout.notes) {
      const x = n.rect.x + n.rect.w / 2, y = n.rect.y + n.rect.h / 2;
      expect(roundTrips(layout, x, y)).toBe(true);
    }
  });
});
