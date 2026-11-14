import { describe, it, expect } from "vitest";
import { createMemoryDocStore } from "../documents/editor/store-memory.js";

// The word processor's preview mode (a Word attachment opened from Mail) runs on this
// store: it must behave like a document store and reach nothing outside itself.
describe("createMemoryDocStore", () => {
  it("hands back the content it was given, and later what was saved", async () => {
    const store = createMemoryDocStore({ content: new Uint8Array([1, 2, 3]) });
    expect([...(await store.loadContent())]).toEqual([1, 2, 3]);
    await store.saveContent(new Uint8Array([9]));
    expect([...(await store.loadContent())]).toEqual([9]);
  });
  it("serves the file's own images and nothing else", async () => {
    const id = "a".repeat(32);
    const store = createMemoryDocStore({ content: new Uint8Array(), images: [{ id, bytes: new Uint8Array([7]) }] });
    expect([...(await store.images.get(id))]).toEqual([7]);
    await expect(store.images.get("b".repeat(32))).rejects.toMatchObject({ code: "MISSING" });
  });
  it("has no versions, no channel and no file row", async () => {
    const store = createMemoryDocStore({ content: new Uint8Array() });
    expect(await store.versions.list()).toEqual([]);
    expect(store.versions.cached()).toEqual([]);
    expect(store.channel).toBeNull();
    expect(store.fileId).toBeNull();
    await expect(store.saveRow({ bodyText: "x" })).resolves.toBeUndefined();
    await expect(store.rename("x")).resolves.toBeUndefined();
    expect(await store.extraParts()).toEqual([]);
  });
});
