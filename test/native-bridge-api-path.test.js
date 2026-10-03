// In the iPhone app canUseLocalBackend() is true (capacitor://localhost), so URL
// helpers pick local-dev /api/<name> paths. nativeApiPath() maps each to the
// deployed function so the native fetch shim reaches something real. This test
// keeps that mapping complete: every /api/<name> the client code uses must map
// to a function that exists in netlify/functions (or a v2 /api route).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { nativeApiPath } from "../native-bridge.js";

const ROOT = new URL("../", import.meta.url);
const fnNames = new Set(readdirSync(new URL("netlify/functions/", ROOT)).map((f) => f.replace(/\.(m|c)?js$/, "")));
// Local-only routes of server.js (dev state file + backups). Their callers are
// local-dev features; on the live site they have no function by design.
const LOCAL_ONLY = new Set(["state", "backup"]);

function clientApiNames() {
  const names = new Set();
  for (const f of readdirSync(new URL(".", ROOT))) {
    if (!f.endsWith(".js") || f === "server.js") continue;
    const src = readFileSync(new URL(f, ROOT), "utf8");
    for (const m of src.matchAll(/["'`]\/api\/([a-z0-9-]+)/gi)) names.add(m[1]);
  }
  return [...names];
}

describe("nativeApiPath", () => {
  it("maps local /api paths to the deployed function, keeping the query", () => {
    expect(nativeApiPath("/api/weather?action=search&q=Minneapolis")).toBe("/.netlify/functions/weather?action=search&q=Minneapolis");
    expect(nativeApiPath("/api/google-places?q=x")).toBe("/.netlify/functions/google-places?q=x");
    expect(nativeApiPath("/api/calendars?url=abc")).toBe("/.netlify/functions/google-calendar?url=abc");
  });
  it("keeps v2 functions that are routed at /api/<name>", () => {
    expect(nativeApiPath("/api/chat")).toBe("/api/chat");
    expect(nativeApiPath("/api/clean-recipe")).toBe("/api/clean-recipe");
    expect(nativeApiPath("/api/push-subscribe")).toBe("/api/push-subscribe");
  });
  it("leaves non-/api paths alone", () => {
    expect(nativeApiPath("/.netlify/functions/weather?x=1")).toBe("/.netlify/functions/weather?x=1");
    expect(nativeApiPath("https://example.com/api/x")).toBe("https://example.com/api/x");
  });
  it("every /api/<name> the client uses reaches a real deployed function", () => {
    const names = clientApiNames();
    expect(names).toContain("weather");
    const missing = names.filter((n) => !LOCAL_ONLY.has(n)).filter((n) => {
      const mapped = nativeApiPath(`/api/${n}`);
      if (mapped.startsWith("/api/")) return !fnNames.has(n); // v2 route: the function must exist
      return !fnNames.has(mapped.replace("/.netlify/functions/", ""));
    });
    expect(missing).toEqual([]);
  });
});
