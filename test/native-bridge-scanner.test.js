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

import { nativeWebAuth, parseAppCallback, APP_CALLBACK_SCHEME } from "../native-bridge.js";
describe("in-app sign-in bridge", () => {
  it("is null outside the native app", () => { expect(nativeWebAuth()).toBeNull(); });
  it("reads the status the Gmail callback puts on the app-scheme URL", () => {
    expect(parseAppCallback(`${APP_CALLBACK_SCHEME}://gmail?status=connected`)).toEqual({ status: "connected", reason: "" });
    expect(parseAppCallback(`${APP_CALLBACK_SCHEME}://gmail?status=error&reason=denied`)).toEqual({ status: "error", reason: "denied" });
    expect(parseAppCallback("https://evil.example/?status=connected").status).toBe("unknown");
    expect(parseAppCallback("not a url").status).toBe("unknown");
  });
});
