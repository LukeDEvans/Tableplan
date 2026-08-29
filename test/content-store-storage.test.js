import { describe, it, expect } from "vitest";
import { createMemoryStorage, hasLocalBytes } from "../content-store/storage.js";

describe("StoragePort — in-memory fake (generic)", () => {
  it("round-trips records and bytes across named stores", async () => {
    const s = createMemoryStorage(["bytes", "records"]);
    await s.put("records", "r1", { id: "r1", title: "T" });
    await s.put("bytes", "b1", new Uint8Array([1, 2, 3]));
    expect(await s.get("records", "r1")).toEqual({ id: "r1", title: "T" });
    expect(await s.get("bytes", "b1")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await s.has("bytes", "b1")).toBe(true);
    expect(await s.getAll("records")).toHaveLength(1);
  });
  it("delete removes an entry; missing get is undefined", async () => {
    const s = createMemoryStorage();
    await s.put("bytes", "b1", new Uint8Array([9]));
    await s.delete("bytes", "b1");
    expect(await s.has("bytes", "b1")).toBe(false);
    expect(await s.get("bytes", "missing")).toBeUndefined();
  });
  it("auto-creates an unknown store on first access (getAll → [])", async () => {
    const s = createMemoryStorage();
    expect(await s.getAll("neverSeen")).toEqual([]);
    expect(await s.has("neverSeen", "x")).toBe(false);
  });
  it("keys are stringified consistently", async () => {
    const s = createMemoryStorage();
    await s.put("bytes", 42, new Uint8Array([1]));
    expect(await s.has("bytes", "42")).toBe(true);
    expect(await s.get("bytes", 42)).toEqual(new Uint8Array([1]));
  });
  it("hasLocalBytes checks the bytes store for a blobId", async () => {
    const s = createMemoryStorage();
    await s.put("bytes", "blob_1", new Uint8Array([1]));
    expect(await hasLocalBytes(s, "blob_1")).toBe(true);
    expect(await hasLocalBytes(s, "blob_2")).toBe(false);
  });
});
