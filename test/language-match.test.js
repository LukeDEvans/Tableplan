import { describe, it, expect } from "vitest";
import {
  createMatchGame, startGame, select, tick, endGame, pauseGame, resumeGame,
  nextDueAt, remainingMs, gameSummary, seededRng, MATCH_DEFAULTS,
} from "../language-match.js";
import { normalizeForm } from "../language-curriculum.js";

const word = (n) => ({ id: `w${n}`, text: `nl${n}`, en: `en${n}` });
const pool = (n) => Array.from({ length: n }, (_, i) => word(i + 1));

function newGame(n = 20, opts = {}) {
  const g = createMatchGame(pool(n), { rng: seededRng(opts.seed ?? 7), ...opts });
  startGame(g, 0);
  return g;
}
const rightIndexOf = (g, pairId) => g.right.findIndex((s) => s.pairId === pairId && s.state === "active");
const activeLeft = (g) => g.left.map((s, i) => ({ ...s, i })).filter((s) => s.state === "active");

// Match the first active left card with its answer.
function matchOne(g, now) {
  const L = activeLeft(g)[0];
  select(g, "left", L.i, now);
  return select(g, "right", rightIndexOf(g, L.pairId), now);
}
// Pick a wrong English card for the first active left card.
function missOne(g, now) {
  const L = activeLeft(g)[0];
  const wrong = g.right.findIndex((s) => s.state === "active" && s.pairId !== L.pairId);
  select(g, "left", L.i, now);
  return select(g, "right", wrong, now);
}

function assertBoardSound(g) {
  const live = (col) => col.filter((s) => s.state !== "empty").map((s) => s.pairId);
  const L = live(g.left);
  const R = live(g.right);
  expect(new Set(L).size).toBe(L.length); // no word twice on a side
  expect(new Set(R).size).toBe(R.length);
  const activeL = g.left.filter((s) => s.state === "active").map((s) => s.pairId).sort();
  const activeR = g.right.filter((s) => s.state === "active").map((s) => s.pairId).sort();
  expect(activeL).toEqual(activeR); // every Dutch card's answer is showing
}

describe("language-match: board", () => {
  it("starts with five distinct pairs on each side", () => {
    const g = newGame(20);
    expect(g.left).toHaveLength(5);
    expect(activeLeft(g)).toHaveLength(5);
    assertBoardSound(g);
    expect(g.status).toBe("playing");
    expect(remainingMs(g, 0)).toBe(MATCH_DEFAULTS.durationMs);
  });

  it("adapts the board to a small pool and never invents words", () => {
    const g = newGame(3);
    expect(g.left).toHaveLength(3);
    expect(new Set(activeLeft(g).map((s) => s.pairId))).toEqual(new Set(["w1", "w2", "w3"]));
  });

  it("an empty pool ends at once", () => {
    const g = createMatchGame([], { rng: seededRng(1) });
    startGame(g, 0);
    expect(g.status).toBe("ended");
    expect(g.endReason).toBe("empty");
  });

  it("keeps confusable cards off the board together", () => {
    const p = [
      { id: "a", text: "de man", en: "man" },
      { id: "b", text: "de man", en: "husband" }, // same Dutch
      { id: "c", text: "de vent", en: "Man" },     // same English, other case
      ...pool(6),
    ];
    for (let seed = 1; seed < 40; seed += 1) {
      const g = createMatchGame(p, { rng: seededRng(seed) });
      startGame(g, 0);
      for (let t = 1; t < 40 && g.status === "playing"; t += 1) {
        matchOne(g, t * 2000);
        tick(g, t * 2000 + 1600);
        const live = g.left.filter((s) => s.state !== "empty").map((s) => s.pairId);
        expect(live.filter((id) => id === "a" || id === "b").length).toBeLessThanOrEqual(1);
        const ens = g.left.filter((s) => s.state !== "empty").map((s) => normalizeForm(p.find((e) => e.id === s.pairId).en));
        expect(new Set(ens).size).toBe(ens.length);
      }
    }
  });
});

describe("language-match: selecting and matching", () => {
  it("a correct pair scores one and removes both cards from play", () => {
    const g = newGame();
    const L = activeLeft(g)[0];
    expect(select(g, "left", L.i, 10).type).toBe("select");
    const ev = select(g, "right", rightIndexOf(g, L.pairId), 20);
    expect(ev.type).toBe("match");
    expect(g.correct).toBe(1);
    expect(g.attempts).toBe(1);
    expect(g.left[L.i].state).toBe("matched");
    expect(select(g, "left", L.i, 30).type).toBe("ignored"); // can't pick a matched card
  });

  it("a wrong pair changes nothing but the attempt count", () => {
    const g = newGame();
    const before = JSON.stringify([g.left, g.right]);
    expect(missOne(g, 10).type).toBe("miss");
    expect(g.correct).toBe(0);
    expect(g.attempts).toBe(1);
    expect(JSON.stringify([g.left, g.right])).toBe(before);
    expect(g.selected).toEqual({ left: null, right: null });
    expect(remainingMs(g, 10)).toBe(MATCH_DEFAULTS.durationMs - 10); // timer keeps going, no penalty
  });

  it("a second tap on the same side moves the selection; a repeat tap clears it", () => {
    const g = newGame();
    const [a, b] = activeLeft(g);
    select(g, "left", a.i, 1);
    select(g, "left", b.i, 2);
    expect(g.selected.left).toBe(b.i);
    expect(select(g, "left", b.i, 3).type).toBe("deselect");
    expect(g.selected.left).toBe(null);
    expect(g.attempts).toBe(0); // no completed attempt yet
  });

  it("rapid double taps can't count a match twice", () => {
    const g = newGame();
    const L = activeLeft(g)[0];
    const ri = rightIndexOf(g, L.pairId);
    select(g, "left", L.i, 1);
    select(g, "right", ri, 2);
    select(g, "right", ri, 2); // same instant, same card
    select(g, "left", L.i, 2);
    expect(g.correct).toBe(1);
    expect(g.attempts).toBe(1);
  });

  it("bad input is ignored", () => {
    const g = newGame();
    expect(select(g, "middle", 0, 1).type).toBe("ignored");
    expect(select(g, "left", 99, 1).type).toBe("ignored");
  });
});

describe("language-match: replacements", () => {
  it("replaces a matched pair after 500–1500 ms with a different pair", () => {
    for (let seed = 1; seed < 30; seed += 1) {
      const g = newGame(20, { seed });
      const ev = matchOne(g, 1000);
      const due = nextDueAt(g);
      expect(due - 1000).toBeGreaterThanOrEqual(500);
      expect(due - 1000).toBeLessThanOrEqual(1500);
      expect(tick(g, due - 1)).toEqual([]);
      tick(g, due);
      expect(g.left[ev.left].state).toBe("active");
      expect(g.left[ev.left].pairId).not.toBe(ev.pairId);
      assertBoardSound(g);
    }
  });

  it("keeps five pairs and a sound board through a long game, sharing words fairly", () => {
    const g = newGame(15, { target: 1000, seed: 3 });
    const pick = seededRng(99);
    let t = 0;
    for (let i = 0; i < 60; i += 1) {
      t += 900;
      tick(g, t);
      const live = activeLeft(g);
      if (live.length) { // match a random card, like a person would
        const L = live[Math.floor(pick() * live.length)];
        select(g, "left", L.i, t);
        select(g, "right", rightIndexOf(g, L.pairId), t);
      }
      if (i % 4 === 0) missOne(g, t);
      assertBoardSound(g);
    }
    tick(g, t + 2000);
    expect(activeLeft(g)).toHaveLength(5);
    const shown = Object.values(g.shown);
    expect(Object.keys(g.shown)).toHaveLength(15); // every word got a turn
    expect(Math.max(...shown) - Math.min(...shown)).toBeLessThanOrEqual(2);
  });

  it("doesn't bring back the pair just matched when there are spares", () => {
    for (let seed = 1; seed < 50; seed += 1) {
      const g = newGame(6, { seed, target: 1000 });
      let t = 0;
      for (let i = 0; i < 10; i += 1) {
        t += 2000;
        const ev = matchOne(g, t);
        tick(g, t + 1500);
        expect(g.left[ev.left].pairId).not.toBe(ev.pairId);
        expect(g.left.some((s) => s.state === "active" && s.pairId === ev.pairId)).toBe(false);
      }
    }
  });

  it("with exactly five words, the matched pair comes back (nothing else exists)", () => {
    const g = newGame(5, { target: 100 });
    const ev = matchOne(g, 100);
    tick(g, 2000);
    expect(g.left[ev.left].pairId).toBe(ev.pairId);
    assertBoardSound(g);
  });

  it("pending replacements are dropped when the game ends", () => {
    const g = newGame(20, { durationMs: 1000 });
    matchOne(g, 900);
    expect(g.refills).toHaveLength(1);
    tick(g, 1000);
    expect(g.status).toBe("ended");
    expect(g.refills).toEqual([]);
    const snapshot = JSON.stringify(g.left);
    tick(g, 5000);
    expect(JSON.stringify(g.left)).toBe(snapshot);
  });
});

describe("language-match: ending", () => {
  it("ends when time runs out, at exactly the limit even if the tick is late", () => {
    const g = newGame();
    matchOne(g, 5000);
    tick(g, 119_999);
    expect(g.status).toBe("playing");
    tick(g, 125_000);
    expect(g.status).toBe("ended");
    expect(g.endReason).toBe("time");
    expect(gameSummary(g, 200_000).durationMs).toBe(120_000);
  });

  it("ends the moment the target is reached", () => {
    const g = newGame(20, { target: 3 });
    let t = 0;
    while (g.status === "playing") {
      t += 2000;
      tick(g, t);
      matchOne(g, t);
    }
    expect(g.endReason).toBe("target");
    expect(g.correct).toBe(3);
    expect(gameSummary(g, t).reached).toBe(true);
    expect(select(g, "left", 0, t + 1).type).toBe("ignored"); // board frozen
  });

  it("a tap after time is up is not counted", () => {
    const g = newGame();
    const L = activeLeft(g)[0];
    select(g, "left", L.i, 1000);
    expect(select(g, "right", rightIndexOf(g, L.pairId), 120_001).type).toBe("ignored");
    expect(g.correct).toBe(0);
    expect(g.status).toBe("ended");
  });

  it("an ended game can't be ended or started again", () => {
    const g = newGame();
    endGame(g, 1000, "left");
    endGame(g, 2000, "time");
    startGame(g, 3000);
    expect(g.endReason).toBe("left");
    expect(g.endedAt).toBe(1000);
  });

  it("accuracy is correct ÷ attempts, and null with no attempts", () => {
    const g = newGame();
    expect(gameSummary(g, 0).accuracy).toBe(null);
    matchOne(g, 10);
    missOne(g, 20);
    missOne(g, 30);
    tick(g, 3000);
    matchOne(g, 3000);
    const s = gameSummary(g, 3000);
    expect(s.correct).toBe(2);
    expect(s.attempts).toBe(4);
    expect(s.accuracy).toBe(0.5);
  });

  it("per-word counts track seen, correct and wrong", () => {
    const g = newGame();
    const L = activeLeft(g)[0];
    missOne(g, 10);
    select(g, "left", L.i, 20);
    select(g, "right", rightIndexOf(g, L.pairId), 21);
    expect(g.words[L.pairId]).toEqual({ seen: 1, c: 1, w: 1 });
  });
});

describe("language-match: pause", () => {
  it("time and replacements stand still while paused", () => {
    const g = newGame();
    const ev = matchOne(g, 10_000);
    const due = nextDueAt(g);
    pauseGame(g, 10_100);
    expect(select(g, "left", activeLeft(g)[0].i, 10_200).type).toBe("ignored");
    expect(tick(g, 500_000)).toEqual([]);
    resumeGame(g, 60_100); // paused 50 s
    expect(remainingMs(g, 60_100)).toBe(120_000 - 10_100);
    expect(nextDueAt(g)).toBe(due + 50_000);
    tick(g, due + 50_000);
    expect(g.left[ev.left].state).toBe("active");
  });

  it("separate games don't share state", () => {
    const a = newGame();
    matchOne(a, 10);
    const b = newGame();
    expect(b.correct).toBe(0);
    expect(b.selected).toEqual({ left: null, right: null });
  });
});
