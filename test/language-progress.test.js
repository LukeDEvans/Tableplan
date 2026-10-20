import { describe, it, expect } from "vitest";
import {
  mergeWordStats, applySessionToWordStats, normalizeWordStats, wordTotals,
  mergeSessions, addSession, lastSession, SESSION_CAP,
} from "../language-progress.js";

const session = (n, endedAt, extra = {}) => ({
  id: `s${n}`, lang: "nl", scope: "lesson:A", label: "A", startedAt: endedAt, endedAt,
  durationMs: 1000, correct: 3, attempts: 4, target: 30, reached: false, endReason: "time", ...extra,
});

describe("language-progress: word stats", () => {
  const at = "2026-10-20T12:00:00Z";
  it("adds a session's counts to this device and stamps when and where", () => {
    const out = applySessionToWordStats(
      { a: { n: { phone: [1, 1, 0] }, last: "2026-10-01T00:00:00Z" } },
      { a: { seen: 2, c: 1, w: 3 }, b: { seen: 1, c: 0, w: 0 }, z: { seen: 0, c: 0, w: 0 } },
      { at, scope: "lesson:A", device: "phone" },
    );
    expect(out.a).toEqual({ n: { phone: [3, 2, 3] }, last: at, scope: "lesson:A" });
    expect(wordTotals(out).b).toEqual({ seen: 1, c: 0, w: 0, last: at });
    expect(out.z).toBeUndefined(); // untouched words aren't written
  });

  it("totals sum across devices", () => {
    expect(wordTotals({ a: { n: { phone: [3, 2, 1], laptop: [4, 1, 0] }, last: "x" } }).a).toEqual({ seen: 7, c: 3, w: 1, last: "x" });
  });

  it("practice on a device holding a stale copy still counts in full", () => {
    // Phone has 10 sightings; the laptop's copy is stale (sees only its own 5).
    const server = { a: { n: { phone: [10, 5, 0], laptop: [5, 2, 0] }, last: "2026-10-19T00:00:00Z" } };
    const laptopStale = { a: { n: { laptop: [5, 2, 0] }, last: "2026-10-10T00:00:00Z" } };
    const laptopAfter = applySessionToWordStats(laptopStale, { a: { seen: 3, c: 1, w: 0 } }, { at, device: "laptop" });
    const merged = mergeWordStats(laptopAfter, server);
    expect(wordTotals(merged).a.seen).toBe(18); // 10 + 8: nothing thrown away
    expect(wordTotals(merged).a.c).toBe(8);
  });

  it("merging keeps each device's larger numbers, so stale data can't lower progress", () => {
    const fresh = { a: { n: { phone: [5, 4, 1] }, last: "2026-10-20T12:00:00Z", scope: "lesson:B" } };
    const stale = { a: { n: { phone: [2, 1, 3], laptop: [1, 0, 0] }, last: "2026-10-10T12:00:00Z", scope: "lesson:A" }, b: { n: { phone: [1, 0, 0] }, last: "" } };
    const m1 = mergeWordStats(fresh, stale);
    const m2 = mergeWordStats(stale, fresh);
    expect(m1).toEqual(m2); // order doesn't matter
    expect(m1.a).toEqual({ n: { phone: [5, 4, 3], laptop: [1, 0, 0] }, last: "2026-10-20T12:00:00Z", scope: "lesson:B" });
    expect(mergeWordStats(m1, m1)).toEqual(m1); // idempotent
  });

  it("a copy without the key (e.g. from an older app build) keeps the other side's progress", () => {
    const mine = { a: { n: { phone: [1, 1, 0] }, last: "x" } };
    expect(mergeWordStats(undefined, mine)).toEqual(normalizeWordStats(mine));
    expect(mergeWordStats(mine, undefined)).toEqual(normalizeWordStats(mine));
  });

  it("cleans junk", () => {
    expect(normalizeWordStats({ a: { n: { p: [-3, "2", NaN], "": [1, 1, 1] } }, b: null })).toEqual({ a: { n: { p: [0, 2, 0] }, last: "" } });
    expect(normalizeWordStats([1, 2])).toEqual({});
  });
});

describe("language-progress: sessions", () => {
  it("merges by id, newest first, and keeps only the newest", () => {
    const a = Array.from({ length: 40 }, (_, i) => session(i, `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T0${i % 10}:00:00Z`));
    const b = Array.from({ length: 40 }, (_, i) => session(i + 20, `2026-11-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00Z`));
    const m = mergeSessions(a, b);
    expect(m).toHaveLength(SESSION_CAP);
    expect(new Set(m.map((s) => s.id)).size).toBe(SESSION_CAP);
    for (let i = 1; i < m.length; i += 1) expect(m[i - 1].endedAt >= m[i].endedAt).toBe(true);
    expect(mergeSessions(m, m)).toEqual(m);
  });

  it("adding the same session twice keeps one", () => {
    const one = addSession([], session(1, "2026-10-20T00:00:00Z"));
    expect(addSession(one, session(1, "2026-10-20T00:00:00Z"))).toHaveLength(1);
  });

  it("finds the last session overall and per scope", () => {
    const list = [session(1, "2026-10-01T00:00:00Z"), session(2, "2026-10-03T00:00:00Z", { scope: "unit:U" }), session(3, "2026-10-02T00:00:00Z")];
    expect(lastSession(list).id).toBe("s2");
    expect(lastSession(list, "lesson:A").id).toBe("s3");
    expect(lastSession(list, "review")).toBe(null);
  });
});
