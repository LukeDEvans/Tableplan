// The gdocs function's Google Slides actions (SLIDES_DESIGN.md §10), with Google faked.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const g = require("../netlify/functions/_gcal.js");
const { handler } = require("../netlify/functions/gdocs.js");

const FILE = "1AbcdEFGhijkLMNopqrsTUV";
let fetched = [];
beforeEach(() => {
  fetched = [];
  vi.spyOn(g, "userIdFromRequest").mockResolvedValue("u1");
  vi.spyOn(g, "loadAccount").mockResolvedValue({ scopes: g.DOCS_SCOPES.join(" ") });
  vi.spyOn(g, "getAccessToken").mockResolvedValue({ token: "t" });
});
afterEach(() => vi.restoreAllMocks());
const call = (body) => handler({ httpMethod: "POST", headers: {}, body: JSON.stringify(body) });

describe("Google Slides through gdocs", () => {
  it("lists presentations and folders", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => { fetched.push(String(url)); return new Response(JSON.stringify({ files: [{ id: "p1", name: "Trip", mimeType: "application/vnd.google-apps.presentation" }, { id: "f1", name: "Old", mimeType: "application/vnd.google-apps.folder" }] })); }));
    const r = await call({ action: "list", kind: "slides" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).items.map((x) => x.kind)).toEqual(["slides", "folder"]);
    expect(decodeURIComponent(fetched[0])).toContain("application/vnd.google-apps.presentation");
  });
  it("hands over the PowerPoint export in pieces", async () => {
    const big = new Uint8Array(3 * 1024 * 1024 + 10).map((_, i) => i % 251);
    vi.stubGlobal("fetch", vi.fn(async (url) => { fetched.push(String(url)); return new Response(big); }));
    const a = JSON.parse((await call({ action: "slidesPptx", fileId: FILE, offset: 0 })).body);
    expect(a.size).toBe(big.length);
    expect(a.next).toBe(3 * 1024 * 1024);
    const b = JSON.parse((await call({ action: "slidesPptx", fileId: FILE, offset: a.next })).body);
    expect(b.next).toBeNull();
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.hash).toBe(a.hash);
    expect(Buffer.from(b.data, "base64")).toEqual(Buffer.from(big.subarray(a.next)));
    expect(fetched[0]).toContain(`/files/${FILE}/export?mimeType=application%2Fvnd.openxmlformats-officedocument.presentationml.presentation`);
  });
  it("says plainly when Google won't export something that large", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { errors: [{ reason: "exportSizeLimitExceeded" }], message: "too big" } }), { status: 403 })));
    const r = await call({ action: "slidesPptx", fileId: FILE, offset: 0 });
    expect(r.statusCode).toBe(413);
    expect(JSON.parse(r.body).error).toMatch(/too large/);
  });
  it("rejects a bad file id", async () => {
    const r = await call({ action: "slidesPptx", fileId: "../x", offset: 0 });
    expect(r.statusCode).toBe(400);
  });
});
