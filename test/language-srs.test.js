import { describe, it, expect } from "vitest";
import {
  reviewCard, previewIntervals, decodeCard, encodeCard, normalizeCards, mergeCards,
  pullForward, buildSession, deckCounts, formatInterval, retrievability, isKnown, cardKey, parseCardKey,
} from "../language-srs.js";

// A fixed "day" clock: day n starts at n * DAY (UTC), so tests don't depend on the zone.
const DAY = 86_400_000;
const dayOf = (ms) => Math.floor(ms / DAY);
const at = (day, hour = 12) => day * DAY + hour * 3_600_000;
const opts = { dayOf };

describe("language-srs: FSRS scheduling", () => {
  it("a new card's first answer sets sensible intervals (Again 1d < Hard ≤ Good < Easy)", () => {
    const p = previewIntervals(null, at(100), opts);
    expect(p[1]).toBe(1);
    expect(p[2]).toBeGreaterThanOrEqual(1);
    expect(p[3]).toBeGreaterThan(p[2]);
    expect(p[4]).toBeGreaterThan(p[3]);
    expect(p[3]).toBe(4); // w2 ≈ 3.7 days
    expect(p[4]).toBe(14); // w3 ≈ 13.8 days
  });

  it("reviewing records due day, time, reps and the first day", () => {
    const c = decodeCard(reviewCard(null, 3, at(100), opts));
    expect(c.due).toBe(104);
    expect(c.last).toBe(at(100));
    expect(c.reps).toBe(1);
    expect(c.lapses).toBe(0);
    expect(c.first).toBe(100);
  });

  it("intervals grow with each on-time Good", () => {
    let t = reviewCard(null, 3, at(0), opts);
    const gaps = [];
    let day = 0;
    for (let i = 0; i < 5; i += 1) {
      const c = decodeCard(t);
      gaps.push(c.due - day);
      day = c.due;
      t = reviewCard(t, 3, at(day), opts);
    }
    for (let i = 1; i < gaps.length; i += 1) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
  });

  it("Again on a learned card is a lapse: shorter stability, due tomorrow", () => {
    let t = reviewCard(null, 3, at(0), opts);
    t = reviewCard(t, 3, at(4), opts);
    const before = decodeCard(t);
    const after = decodeCard(reviewCard(t, 1, at(before.due), opts));
    expect(after.s).toBeLessThan(before.s);
    expect(after.lapses).toBe(1);
    expect(after.due).toBe(before.due + 1);
  });

  it("a same-day repeat after Again doesn't inflate stability", () => {
    const a = decodeCard(reviewCard(null, 1, at(10, 9), opts));
    const b = decodeCard(reviewCard(encodeCard(a), 3, at(10, 9.1), opts));
    expect(b.s).toBeCloseTo(a.s, 1);
    expect(b.due - 10).toBeLessThanOrEqual(2); // Hard 1d < Good 2d at this tiny stability
  });

  it("retrievability is 90 % after one stability's worth of days", () => {
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 5);
    expect(retrievability(0, 10)).toBe(1);
  });

  it("formats intervals briefly", () => {
    expect(formatInterval(1)).toBe("1d");
    expect(formatInterval(13)).toBe("13d");
    expect(formatInterval(21)).toBe("3w");
    expect(formatInterval(90)).toBe("3mo");
    expect(formatInterval(730)).toBe("2y");
  });

  it("known = stability of three weeks or more", () => {
    expect(isKnown([21, 5, 0, 0, 3, 0, 0])).toBe(true);
    expect(isKnown([20.9, 5, 0, 0, 3, 0, 0])).toBe(false);
  });
});

describe("language-srs: storage and merge", () => {
  it("keys round-trip and bad keys/tuples are dropped", () => {
    expect(parseCardKey(cardKey("nl-s1-1-01", "p"))).toEqual({ entryId: "nl-s1-1-01", dir: "p" });
    expect(parseCardKey("x|q")).toBeNull();
    const n = normalizeCards({ "a|r": [3, 5, 1, 2, 1, 0, 1], "a|x": [1, 1, 1, 1, 1, 1], "b|r": [0, 5, 1, 1, 1, 1], "c|r": "no" });
    expect(Object.keys(n)).toEqual(["a|r"]);
  });

  it("the later review wins per card, in either order", () => {
    const older = { "a|r": [4, 5, 104, at(100), 1, 0, 100], "b|r": [4, 5, 104, at(100), 1, 0, 100] };
    const newer = { "a|r": [9, 5, 113, at(104), 2, 0, 100] };
    expect(mergeCards(newer, older)["a|r"][3]).toBe(at(104));
    expect(mergeCards(older, newer)["a|r"][3]).toBe(at(104));
    expect(mergeCards(newer, older)["b|r"]).toBeTruthy(); // absence never deletes
  });

  it("a pull-forward survives a merge with the unchanged copy", () => {
    const base = { "a|r": [9, 5, 113, at(104), 2, 0, 100] };
    const pulled = { "a|r": pullForward(base["a|r"], at(106), opts) };
    expect(pulled["a|r"][2]).toBe(106);
    expect(mergeCards(base, pulled)["a|r"][2]).toBe(106);
    expect(mergeCards(pulled, base)["a|r"][2]).toBe(106);
  });

  it("pull-forward leaves a card that's already due alone", () => {
    const t = [9, 5, 100, at(90), 2, 0, 80];
    expect(pullForward(t, at(105), opts)).toBe(t);
    expect(pullForward(undefined, at(105), opts)).toBeUndefined();
  });
});

describe("language-srs: sessions", () => {
  const entries = Array.from({ length: 30 }, (_, i) => ({ id: `w${i}` }));

  it("a fresh deck offers the daily number of new words, in course order", () => {
    const s = buildSession({}, entries, at(50), { ...opts, newLimit: 10 });
    expect(s.due).toEqual([]);
    expect(s.fresh.map((x) => x.entryId)).toEqual(entries.slice(0, 10).map((e) => e.id));
    expect(s.fresh.every((x) => x.dir === "r" && x.isNew)).toBe(true);
  });

  it("words introduced today count against the limit", () => {
    const cards = {};
    for (let i = 0; i < 6; i += 1) cards[`w${i}|r`] = reviewCard(null, 3, at(50, 9), opts);
    const s = buildSession(cards, entries, at(50, 15), { ...opts, newLimit: 10 });
    expect(s.fresh.length).toBe(4);
    expect(s.fresh[0].entryId).toBe("w6");
  });

  it("due cards come first, most overdue first; new words are spread through", () => {
    const cards = {};
    for (let i = 0; i < 8; i += 1) cards[`w${i}|r`] = [4, 5, 40 + i, at(36), 1, 0, 36];
    const s = buildSession(cards, entries, at(50), { ...opts, newLimit: 2 });
    expect(s.due.map((x) => x.entryId)).toEqual(["w0", "w1", "w2", "w3", "w4", "w5", "w6", "w7"]);
    // Each word's produce card has unlocked (answered right on an earlier day) and
    // comes before brand-new words; new cards are spread one after every four.
    expect(s.queue.map((x) => x.key)).toEqual(["w0|r", "w1|r", "w2|r", "w3|r", "w0|p", "w4|r", "w5|r", "w6|r", "w7|r", "w1|p"]);
  });

  it("the produce card unlocks the day after the recognize card was answered right", () => {
    const cards = { "w0|r": reviewCard(null, 3, at(50), opts) };
    expect(buildSession(cards, entries.slice(0, 1), at(50, 18), { ...opts, newLimit: 10 }).fresh).toEqual([]);
    const next = buildSession(cards, entries.slice(0, 1), at(51), { ...opts, newLimit: 10 }).fresh;
    expect(next.map((x) => x.key)).toEqual(["w0|p"]);
    // A recognize card only ever failed doesn't unlock it.
    const failed = { "w0|r": reviewCard(null, 1, at(50), opts) };
    expect(buildSession(failed, entries.slice(0, 1), at(52), { ...opts, newLimit: 10 }).fresh).toEqual([]);
  });

  it("deck counts: due, new, known", () => {
    const cards = { "w0|r": [30, 5, 10, at(1), 4, 0, 0], "w1|r": [3, 5, 99, at(1), 1, 0, 0], "w1|p": [3, 5, 50, at(1), 1, 0, 0] };
    expect(deckCounts(cards, entries.slice(0, 3), at(50), opts)).toEqual({ due: 2, fresh: 1, known: 1, learning: 1, total: 3 });
  });
});
