import { describe, it, expect, afterEach } from "vitest";
import { saveFile, chooseSaveRoute } from "../save-file.js";

function fakeEnv({ canShare = true, shareError = null } = {}) {
  const log = [];
  class FakeFile { constructor(parts, name, opts) { this.name = name; this.type = opts?.type; } }
  const env = {
    File: FakeFile,
    navigator: {
      canShare: ({ files }) => canShare && files.length === 1,
      share: async (data) => { if (shareError) throw shareError; log.push(["share", data.files[0].name, data.title]); },
    },
    URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => log.push(["revoke"]) },
    document: {
      body: { appendChild: () => {} },
      createElement: () => ({ click() { log.push(["download", this.download]); }, remove() {} }),
    },
  };
  return { env, log };
}
const blob = { type: "text/csv" };

afterEach(() => { delete globalThis.Capacitor; });

describe("saveFile — share sheet in the iOS app, download elsewhere", () => {
  it("routes by platform + share support", () => {
    expect(chooseSaveRoute({ native: true, canShareFiles: true })).toBe("share");
    expect(chooseSaveRoute({ native: true, canShareFiles: false })).toBe("download");
    expect(chooseSaveRoute({ native: false, canShareFiles: true })).toBe("download");
  });
  it("browser (not native) downloads even when the Web Share API exists", async () => {
    const { env, log } = fakeEnv();
    expect(await saveFile(blob, "a.csv", { env })).toBe("downloaded");
    expect(log[0]).toEqual(["download", "a.csv"]);
  });
  it("native app shares the file; a dismissed sheet is 'cancelled', not an error", async () => {
    globalThis.Capacitor = { isNativePlatform: () => true };
    const { env, log } = fakeEnv();
    expect(await saveFile(blob, "a.csv", { env, title: "Music library" })).toBe("shared");
    expect(log[0]).toEqual(["share", "a.csv", "Music library"]);
    const aborted = fakeEnv({ shareError: Object.assign(new Error("x"), { name: "AbortError" }) });
    expect(await saveFile(blob, "a.csv", { env: aborted.env })).toBe("cancelled");
  });
  it("native app without file sharing falls back to a download", async () => {
    globalThis.Capacitor = { isNativePlatform: () => true };
    const { env, log } = fakeEnv({ canShare: false });
    expect(await saveFile(blob, "a.csv", { env })).toBe("downloaded");
    expect(log[0][0]).toBe("download");
  });
});
