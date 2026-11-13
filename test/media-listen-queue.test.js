import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LISTEN_PERSON_KEYS, mergeProgressMaps, mergeListenSeed, listenKeysSelect, listenKeysFromRow } from "../listen-queue.js";
import { listenHomeScope, scopeForView, VIEW_TOGGLE_SECTIONS } from "../views.js";

const SRC = readFileSync(fileURLToPath(new URL("../app.js", import.meta.url)), "utf8");
const sections = SRC.match(/const STATE_SECTIONS = \{([\s\S]*?)\n\};/)[1];
const sectionKeys = (name) => {
  const m = new RegExp(`\\n  ${name}:\\s*\\[([^\\]]*)\\]`).exec(sections);
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
};

describe("the person's own Listen row (LISTEN_QUEUE_DESIGN.md)", () => {
  it("app.js's listen section holds exactly these keys, and media no longer does", () => {
    expect(sectionKeys("listen")).toEqual([...LISTEN_PERSON_KEYS]);
    const media = sectionKeys("media");
    for (const k of LISTEN_PERSON_KEYS) expect(media).not.toContain(k);
  });

  it("is a fixed personal section that no view switch swaps", () => {
    expect(SRC).toMatch(/\n  listen: "personal",/);
    expect(VIEW_TOGGLE_SECTIONS).not.toContain("listen");
  });

  it("the queue's library is Personal for someone who has it, else Household", () => {
    expect(listenHomeScope(["household", "personal", "business"])).toBe("personal");
    expect(listenHomeScope(["household"])).toBe("household");
    expect(scopeForView("household", "media")).toBe("household"); // the library on screen still follows the view
  });
});

describe("mergeProgressMaps", () => {
  it("the more recent position wins", () => {
    const a = { e: { position: 30, lastPlayedAt: "2026-11-10T10:00:00Z" } };
    const b = { e: { position: 900, lastPlayedAt: "2026-11-13T10:00:00Z" } };
    expect(mergeProgressMaps(a, b).e.position).toBe(900);
    expect(mergeProgressMaps(b, a).e.position).toBe(900);
  });

  it("a finished mark sticks, even against a later position", () => {
    const done = { e: { played: true, playedAt: "2026-11-13T09:00:00Z", position: 3000 } };
    const later = { e: { position: 10, lastPlayedAt: "2026-11-13T12:00:00Z" } };
    const m = mergeProgressMaps(later, done).e;
    expect(m.played).toBe(true);
    expect(m.playedAt).toBe("2026-11-13T09:00:00Z");
  });

  it("keeps entries from every side and ignores junk", () => {
    expect(Object.keys(mergeProgressMaps({ a: {} }, { b: {} }, null, { c: null }))).toEqual(["a", "b"]);
  });
});

describe("mergeListenSeed (the one-time move)", () => {
  const personal = {
    podcastProgress: { p1: { position: 100, lastPlayedAt: "2026-11-12T00:00:00Z" } },
    mediaQueueAdded: [{ id: "q1", ref: "episode:p1", kind: "episode", itemId: "p1" }],
    mediaQueueRemoved: ["x"],
    mediaAllPinnedOrder: [],
    mediaHistory: [{ id: "h1", at: 1 }],
  };
  const household = {
    podcastProgress: { p1: { played: true, playedAt: "2026-11-13T19:00:00Z" } }, // the bug: finished while in Household
    mediaQueueAdded: [{ id: "q2", ref: "episode:p1", kind: "episode", itemId: "p1" }, { id: "q3", ref: "episode:h1", kind: "episode", itemId: "h1" }],
    mediaQueueRemoved: ["x", "y"],
    mediaAllPinnedOrder: ["h1"],
    mediaHistory: [{ id: "h2", at: 5 }, { id: "h1", at: 1 }],
  };

  it("the episode finished in Household is finished for the person", () => {
    expect(mergeListenSeed({}, personal, household).podcastProgress.p1.played).toBe(true);
  });

  it("joins queue adds once per item, Personal's first", () => {
    expect(mergeListenSeed({}, personal, household).mediaQueueAdded.map((e) => e.id)).toEqual(["q1", "q3"]);
  });

  it("joins removals and history (newest first); takes the first non-empty drag order", () => {
    const s = mergeListenSeed({}, personal, household);
    expect(s.mediaQueueRemoved).toEqual(["x", "y"]);
    expect(s.mediaHistory.map((h) => h.id)).toEqual(["h2", "h1"]);
    expect(s.mediaAllPinnedOrder).toEqual(["h1"]);
  });

  it("running it again changes nothing", () => {
    const once = mergeListenSeed({}, personal, household);
    expect(mergeListenSeed(once, personal, household)).toEqual(once);
  });

  it("handles missing rows (someone with no Personal row)", () => {
    const s = mergeListenSeed(undefined, undefined, household);
    expect(s.mediaQueueAdded.map((e) => e.id)).toEqual(["q2", "q3"]);
    for (const k of LISTEN_PERSON_KEYS) expect(s).toHaveProperty(k);
  });
});

describe("reading only the moved keys", () => {
  it("selects each key out of the row's state", () => {
    expect(listenKeysSelect()).toBe(`id,${LISTEN_PERSON_KEYS.map((k) => `${k}:state->${k}`).join(",")}`);
  });
  it("turns a selected row back into plain keys, skipping nulls", () => {
    expect(listenKeysFromRow({ id: "r", podcastProgress: { a: {} }, mediaHistory: null })).toEqual({ podcastProgress: { a: {} } });
  });
});
