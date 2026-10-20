import { describe, it, expect } from "vitest";
import {
  mergeWordStats, applySessionToWordStats, normalizeWordStats,
  mergeSessions, addSession, lastSession, SESSION_CAP,
} from "../language-progress.js";

const session = (n, endedAt, extra = {}) => ({
  id: `s${n}`, lang: "nl", scope: "lesson:A", label: "A", startedAt: endedAt, endedAt,
  durationMs: 1000, correct: 3, attempts: 4, target: 30, reached: false, endReason: "time", ...extra,
});

describe("language-progress: word stats", () => {
  it("adds a session's counts and stamps when and where", () => {
    const out = applySessionToWordStats(
      { a: { seen: 1, c: 1, w: 0, last: "2026-10-01T00:00:00Z" } },
      { a: { seen: 2, c: 1, w: 3 }, b: { seen: 1, c: 0, w: 0 }, z: { seen: 0, c: 0, w: 0 } },
      { at: "2026-10-20T12:00:00Z", scope: "lesson:A" },
    );
    expect(out.a).toEqual({ seen: 3, c: 2, w: 3, last: "2026-10-20T12:00:00Z", scope: "lesson:A" });
    expect(out.b.seen).toBe(1);
    expect(out.z).toBeUndefined(); // untouched words aren't written
  });

  it("merging takes the larger of each counter, so stale data can't lower progress", () => {
    const fresh = { a: { seen: 5, c: 4, w: 1, last: "2026-10-20T12:00:00Z", scope: "lesson:B" } };
    const stale = { a: { seen: 2, c: 1, w: 3, last: "2026-10-10T12:00:00Z", scope: "lesson:A" }, b: { seen: 1, c: 0, w: 0, last: "" } };
    const m1 = mergeWordStats(fresh, stale);
    const m2 = mergeWordStats(stale, fresh);
    expect(m1).toEqual(m2); // order doesn't matter
    expect(m1.a).toEqual({ seen: 5, c: 4, w: 3, last: "2026-10-20T12:00:00Z", scope: "lesson:B" });
    expect(m1.b.seen).toBe(1);
    expect(mergeWordStats(m1, m1)).toEqual(m1); // idempotent
  });

  it("a copy without the key (e.g. from an older app build) keeps the other side's progress", () => {
    const mine = { a: { seen: 1, c: 1, w: 0, last: "x" } };
    expect(mergeWordStats(undefined, mine)).toEqual(normalizeWordStats(mine));
    expect(mergeWordStats(mine, undefined)).toEqual(normalizeWordStats(mine));
  });

  it("cleans junk", () => {
    expect(normalizeWordStats({ a: { seen: -3, c: "2", w: NaN }, b: null })).toEqual({ a: { seen: 0, c: 2, w: 0, last: "" } });
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
