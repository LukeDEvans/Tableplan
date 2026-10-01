import { describe, it, expect } from "vitest";
import { nativeDocumentScanner, scannedPagesToFiles } from "../native-bridge.js";

describe("native document scanner bridge", () => {
  it("is null outside the native app (browser falls back to the camera input)", () => {
    expect(nativeDocumentScanner()).toBeNull();
  });

  it("turns base64 JPEG pages into Files for the scan pipeline", async () => {
    const files = scannedPagesToFiles([btoa("abc"), "", null, btoa("de")], 42);
    expect(files.map((f) => [f.name, f.type, f.size])).toEqual([
      ["receipt-42-1.jpg", "image/jpeg", 3],
      ["receipt-42-2.jpg", "image/jpeg", 2],
    ]);
    expect(new TextDecoder().decode(await files[0].arrayBuffer())).toBe("abc");
  });

  it("returns nothing for a cancelled / empty scan", () => {
    expect(scannedPagesToFiles(undefined)).toEqual([]);
  });
});
