import { describe, it, expect } from "vitest";
import { pushHistory, recentHistory, lastPlayed, migrateLegacyHistory, makeHistoryEntry } from "../media-history.js";

describe("unified media history", () => {
  it("prepends newest-first and dedupes by kind+id", () => {
    let h = [];
    h = pushHistory(h, { kind: "radio", id: "r1", title: "The Current", at: 1 });
    h = pushHistory(h, { kind: "music", id: "m1", title: "Bach", at: 2 });
    h = pushHistory(h, { kind: "radio", id: "r1", title: "The Current", at: 3 }); // replays r1
    expect(h.map((e) => `${e.kind}:${e.id}`)).toEqual(["radio:r1", "music:m1"]); // r1 back on top, no dup
    expect(h[0].at).toBe(3);
  });

  it("treats same id across different kinds as distinct", () => {
    let h = pushHistory([], { kind: "music", id: "x", title: "M" });
    h = pushHistory(h, { kind: "radio", id: "x", title: "R" });
    expect(h).toHaveLength(2);
  });

  it("caps the list", () => {
    let h = [];
    for (let i = 0; i < 70; i++) h = pushHistory(h, { kind: "music", id: `m${i}`, title: `${i}` }, { cap: 60 });
    expect(h).toHaveLength(60);
    expect(h[0].id).toBe("m69");
  });

  it("ignores entries without kind or id", () => {
    expect(pushHistory([], { title: "no ids" })).toEqual([]);
  });

  it("filters recent by kind(s) and returns lastPlayed", () => {
    let h = [];
    h = pushHistory(h, { kind: "music", id: "m1", title: "M1" });
    h = pushHistory(h, { kind: "radio", id: "r1", title: "R1" });
    h = pushHistory(h, { kind: "podcast", id: "p1", title: "P1" });
    expect(recentHistory(h, { kind: "radio" }).map((e) => e.id)).toEqual(["r1"]);
    expect(recentHistory(h, { kind: ["music", "podcast"] }).map((e) => e.id)).toEqual(["p1", "m1"]);
    expect(lastPlayed(h).id).toBe("p1");
    expect(lastPlayed(h, { kind: "music" }).id).toBe("m1");
  });
});

describe("legacy migration", () => {
  it("folds old per-type music/radio histories into the unified list, newest on top", () => {
    const music = [ // stored newest-first
      { id: "m2", title: "Newer", artist: "A2", kind: "recording", recording: { id: "rec2" }, at: 200 },
      { id: "m1", title: "Older", artist: "A1", kind: "stream", canonical: { id: "t1" }, at: 100 },
    ];
    const radio = [{ id: "r1", name: "The Current", category: "Music", logoUrl: "x", at: 300 }];
    const h = migrateLegacyHistory([], { music, radio });
    expect(h[0]).toMatchObject({ kind: "radio", id: "r1", title: "The Current", subtitle: "Music" });
    const m2 = h.find((e) => e.id === "m2");
    expect(m2).toMatchObject({ kind: "music", subtitle: "A2" });
    expect(m2.ref).toMatchObject({ mkind: "recording", recording: { id: "rec2" } });
    // order reflects timestamps: radio(300) > m2(200) > m1(100)
    expect(h.map((e) => e.id)).toEqual(["r1", "m2", "m1"]);
  });
});
