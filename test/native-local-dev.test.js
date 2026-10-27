// The iPhone app (capacitor://localhost) passes canUseLocalBackend(), which the URL
// helpers rely on (nativeApiPath maps /api/<name>). Dev-only behaviour must use
// isLocalDevHost() instead, so the app never offers local dev mode, writes local
// backups or attaches dev hooks (ISSUES.md P2, 2026-10-03; fixed 2026-10-26).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const groceries = readFileSync(new URL("../groceries-ui.js", import.meta.url), "utf8");
const body = (src, name) => { const i = src.indexOf(name); return src.slice(i, src.indexOf("\n}", i)); };

describe("local dev is never the iPhone app", () => {
  it("isLocalDevHost excludes the app", () => {
    expect(body(app, "function isLocalDevHost()")).toContain("canUseLocalBackend() && !isNativeApp()");
  });
  it("dev-only paths use isLocalDevHost", () => {
    for (const fn of ["async function signInLocalDev()", "function scheduleLocalBackup()", "async function writeLocalBackup(", "async function tryPreChangeBackup(", "async function writeStateToLocalBackend()", "async function snapshotBeforeSharedStateReplacement("]) {
      const b = body(app, fn);
      expect(b, fn).toContain("isLocalDevHost()");
      expect(b, fn).not.toContain("canUseLocalBackend()");
    }
    expect(app).toContain('if (lockDevBtn && isLocalDevHost()) {');
    expect(app).toContain('if (isLocalDevHost() && localStorage.getItem("live_local_dev") === "1") {');
    expect(app).toMatch(/} else if \(isLocalDevHost\(\)\) \{\s*providers\.push\(\{\s*label: "Local file"/);
  });
  it("Scan and go isn't switched off in the app", () => {
    expect(body(groceries, "function scanAndGoAvailable()")).toContain("if (isLocalDevHost()) return false;");
  });
});
