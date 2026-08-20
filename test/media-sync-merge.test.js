import { describe, it, expect } from "vitest";
import { makeSavedItem, toHistoryEntry, recordPlayback, SAVED_LIST } from "../media-state.js";
import { makeMediaItem } from "../media-model.js";

// Mirrors app.js mergeStates' unionById (union by top-level id, tombstones filter
// deletions). mediaSaved + mediaHistory both go through this on cross-device sync,
// so this proves neither store loses records — the exact convergence guarantee.
function unionById(a, b, tombstoned = null) {
  const map = new Map((b || []).filter((x) => x?.id != null).map((x) => [x.id, x]));
  (a || []).filter((x) => x?.id != null).forEach((x) => map.set(x.id, x));
  const arr = [...map.values()];
  return tombstoned ? arr.filter((x) => !tombstoned.has(String(x.id))) : arr;
}

const vid = (id, title) => makeMediaItem({ kind: "video", id, title, meta: { tmdbId: id.replace(/\D/g, "") } });

describe("mediaSaved cross-device merge", () => {
  it("every saved record has a stable top-level id (=== mediaKey) — never dropped by unionById", () => {
    const s = makeSavedItem(vid("tmdb_1", "Dune"), SAVED_LIST.WATCH_LATER);
    expect(s.id).toBeTruthy();
    expect(s.id).toBe(s.key);
  });
  it("save on device A + save on device B → union keeps BOTH; a tombstoned key is removed", () => {
    const deviceA = [makeSavedItem(vid("tmdb_1", "Dune"))];
    const deviceB = [makeSavedItem(vid("tmdb_2", "Arrival"))];
    expect(unionById(deviceA, deviceB).map((s) => s.title).sort()).toEqual(["Arrival", "Dune"]);
    // A also un-saved Dune (its key is tombstoned) → gone after merge even though B never had it
    const merged = unionById(deviceA, deviceB, new Set([makeSavedItem(vid("tmdb_1", "Dune")).id]));
    expect(merged.map((s) => s.title)).toEqual(["Arrival"]);
  });
});

describe("mediaHistory cross-device merge", () => {
  it("every history entry has a stable top-level id — safe to union", () => {
    const e = toHistoryEntry(vid("jf_9", "Show"));
    expect(e.id).toBe("jf_9");
    expect(e.kind).toBe("video");
  });
  it("plays on two devices union (neither lost); same id de-dupes to one", () => {
    let a = []; a = recordPlayback(a, vid("tmdb_1", "Dune")); a = recordPlayback(a, vid("mus_x", "Song"));
    let b = []; b = recordPlayback(b, vid("tmdb_2", "Arrival")); b = recordPlayback(b, vid("tmdb_1", "Dune"));
    const merged = unionById(a, b);
    expect(merged.map((h) => h.id).sort()).toEqual(["mus_x", "tmdb_1", "tmdb_2"]); // Dune once, not twice
  });
});
