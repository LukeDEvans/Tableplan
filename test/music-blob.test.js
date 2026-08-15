import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
// Browsers expose globalThis.crypto; Vitest's node VM context does not, so
// polyfill it for the test (the shipped module correctly uses globalThis.crypto).
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import { makeBlobAsset, blobAvailability, addLocation, hashBytes, newBlobId } from "../music/blob.js";

describe("BlobAsset — identity & derived availability", () => {
  it("mints a stable blobId and defaults ownership to owned", () => {
    const a = makeBlobAsset({ mimeType: "application/vnd.recordare.musicxml+xml", size: 1234 });
    expect(a.blobId).toMatch(/^blob_/);
    expect(a.ownership).toBe("owned");
    expect("availability" in a).toBe(false); // availability is derived, never stored
  });
  it("derives availability from locations", () => {
    const local = makeBlobAsset({ locations: [{ kind: "idb", key: "k1" }] });
    const remote = makeBlobAsset({ locations: [{ kind: "url", url: "https://x/y.xml" }] });
    const gone = makeBlobAsset({ locations: [] });
    expect(blobAvailability(local)).toBe("local");
    expect(blobAvailability(remote)).toBe("remote");
    expect(blobAvailability(gone)).toBe("missing");
  });
  it("uses a local-bytes checker to demote a stale idb pointer to remote/missing", () => {
    const a = makeBlobAsset({ locations: [{ kind: "idb", key: "k1" }, { kind: "url", url: "https://x" }] });
    expect(blobAvailability(a, () => false)).toBe("remote");   // idb key empty, url still there
    const b = makeBlobAsset({ locations: [{ kind: "idb", key: "k2" }] });
    expect(blobAvailability(b, () => false)).toBe("missing");  // idb empty, nothing else
    expect(blobAvailability(b, () => true)).toBe("local");
  });
  it("addLocation is idempotent", () => {
    let a = makeBlobAsset({});
    a = addLocation(a, { kind: "idb", key: "k1" });
    a = addLocation(a, { kind: "idb", key: "k1" });
    expect(a.locations).toHaveLength(1);
  });
  it("hashBytes gives a stable sha-256 hex (content identity)", async () => {
    const bytes = new TextEncoder().encode("hello");
    const h1 = await hashBytes(bytes);
    const h2 = await hashBytes(new TextEncoder().encode("hello"));
    expect(h1).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(h1).toBe(h2);
  });
  it("newBlobId is unique", () => { expect(newBlobId()).not.toBe(newBlobId()); });
});
