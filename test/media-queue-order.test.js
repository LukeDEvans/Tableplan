import { describe, it, expect } from "vitest";
import { upNextOrder, withSkippedLast, previousFromTrail, heldQueueId } from "../media-queue-order.js";

describe("the queue plays in the order Up Next lists", () => {
  it("after the current item, the top of the list is next", () => {
    expect(upNextOrder(["a", "b", "c", "d"], { currentId: "a" })).toEqual(["b", "c", "d"]);
  });
  it("playing from the middle does not skip the items above it", () => {
    // The old behaviour kept only what was BELOW the started row: c → d.
    expect(upNextOrder(["a", "b", "c", "d"], { currentId: "c" })).toEqual(["a", "b", "d"]);
  });
  it("a new episode sorted to the top while playing is next", () => {
    expect(upNextOrder(["new", "a", "b", "c"], { currentId: "a" })[0]).toBe("new");
  });
  it("a reorder while playing is followed", () => {
    expect(upNextOrder(["a", "d", "c", "b"], { currentId: "a" })).toEqual(["d", "c", "b"]);
  });
  it("an item passed with Next goes to the back of the line", () => {
    expect(upNextOrder(["a", "b", "c", "d"], { currentId: "b", skippedIds: ["a"] })).toEqual(["c", "d", "a"]);
  });
  it("pressing Next repeatedly walks the whole list instead of bouncing", () => {
    const list = ["a", "b", "c"]; let cur = "a"; const skipped = []; const visited = [cur];
    for (let i = 0; i < 5; i++) {
      const next = upNextOrder(list, { currentId: cur, skippedIds: skipped })[0];
      skipped.push(cur); cur = next; visited.push(cur);
      skipped.splice(0, skipped.length, ...skipped.filter((id) => id !== cur)); // becoming current takes it off the back of the line
    }
    expect(visited).toEqual(["a", "b", "c", "a", "b", "c"]);
  });
  it("an item that finished or failed but is still listed is not played again", () => {
    expect(upNextOrder(["a", "b", "c"], { currentId: "c", doneIds: ["a"] })).toEqual(["b"]);
  });
  it("skipped ids that left the list are ignored", () => {
    expect(upNextOrder(["b", "c"], { currentId: "b", skippedIds: ["gone", "c", "c"] })).toEqual(["c"]);
  });
});

describe("the list is shown in the order it will play", () => {
  const items = (...ids) => ids.map((id) => ({ id }));
  it("moves skipped items to the end, current stays first", () => {
    const shown = withSkippedLast(items("b", "a", "c", "d"), ["a"], "b");
    expect(shown.map((i) => i.id)).toEqual(["b", "c", "d", "a"]);
  });
  it("is untouched when nothing was skipped", () => {
    const list = items("a", "b");
    expect(withSkippedLast(list, [], "a")).toBe(list);
  });
  it("matches upNextOrder exactly", () => {
    const natural = ["a", "b", "c", "d", "e"]; const skipped = ["b", "a"]; const cur = "c";
    const hoisted = items("c", "a", "b", "d", "e");
    expect(withSkippedLast(hoisted, skipped, cur).slice(1).map((i) => i.id)).toEqual(upNextOrder(natural, { currentId: cur, skippedIds: skipped }));
  });
});

describe("Previous goes back to what was playing before", () => {
  it("takes the most recent item still playable", () => {
    expect(previousFromTrail(["a", "b", "gone"], ["a", "b", "c"], "c")).toBe("b");
  });
  it("is null with no trail", () => { expect(previousFromTrail([], ["a"], "a")).toBe(null); });
});

describe("a paused item keeps the Now Playing slot when nothing is loaded", () => {
  const list = ["newHighTier", "paused", "other"];
  it("the item this device last had loaded holds the slot, episode or article", () => {
    expect(heldQueueId({ localId: "paused", listIds: list })).toBe("paused");
  });
  it("an episode paused on another device holds it through the synced history", () => {
    expect(heldQueueId({ lastHistory: { kind: "podcast", id: "paused" }, progress: { paused: { position: 300 } }, listIds: list })).toBe("paused");
  });
  it("nothing holds the slot once the item is finished or out of the queue", () => {
    expect(heldQueueId({ localId: "gone", listIds: list })).toBe(null);
    expect(heldQueueId({ lastHistory: { kind: "podcast", id: "paused" }, progress: { paused: { position: 300, played: true } }, listIds: list })).toBe(null);
  });
  it("an episode that was never started, or radio played last, holds nothing", () => {
    expect(heldQueueId({ lastHistory: { kind: "podcast", id: "paused" }, progress: {}, listIds: list })).toBe(null);
    expect(heldQueueId({ lastHistory: { kind: "radio", id: "mpr" }, listIds: list })).toBe(null);
  });
});
