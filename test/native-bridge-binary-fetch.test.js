import { describe, it, expect } from "vitest";
import { installBinaryFetchFix, isRawBytesBody } from "../native-fetch-fix.js";

function fakeWin() {
  const calls = [];
  const win = {
    fetch: (url, o) => { calls.push(["native", url]); return Promise.resolve("n"); },
    CapacitorWebFetch: (url, o) => { calls.push(["web", url]); return Promise.resolve("w"); },
  };
  return { win, calls };
}

describe("binary uploads on the iPhone app", () => {
  it("sends byte bodies through the web view's fetch, everything else native", async () => {
    const { win, calls } = fakeWin();
    expect(installBinaryFetchFix(win)).toBe(true);
    await win.fetch("https://r2/put", { method: "PUT", body: new Uint8Array([255, 216, 255]) });
    await win.fetch("https://r2/put2", { method: "PUT", body: new Uint8Array([1]).buffer });
    await win.fetch("https://s/up", { method: "POST", body: new Blob([new Uint8Array([1, 2])], { type: "image/jpeg" }) });
    await win.fetch("https://api/json", { method: "POST", body: JSON.stringify({ a: 1 }) });
    await win.fetch("https://api/get");
    await win.fetch("https://api/file", { method: "POST", body: new File(["x"], "a.txt") });
    expect(calls).toEqual([["web", "https://r2/put"], ["web", "https://r2/put2"], ["web", "https://s/up"], ["native", "https://api/json"], ["native", "https://api/get"], ["native", "https://api/file"]]);
  });
  it("does nothing in a browser (no Capacitor) and installs once", () => {
    const win = { fetch: () => {} };
    expect(installBinaryFetchFix(win)).toBe(false);
    const { win: w2 } = fakeWin();
    expect(installBinaryFetchFix(w2)).toBe(true);
    expect(installBinaryFetchFix(w2)).toBe(false);
  });
  it("knows a byte body", () => {
    expect(isRawBytesBody(new DataView(new ArrayBuffer(2)))).toBe(true);
    expect(isRawBytesBody("text")).toBe(false);
    expect(isRawBytesBody(null)).toBe(false);
  });
});
