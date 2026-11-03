// The doc-storage Edge Function (supabase/functions/doc-storage/index.ts), run in Node:
// TypeScript stripped by esbuild, Deno.serve and Deno.env stood in, and Postgres's
// access answer (doc_can_access over PostgREST) mocked per scope.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const ENV = {
  SUPABASE_URL: "https://proj.supabase.co", SUPABASE_ANON_KEY: "anon",
  DOC_S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com", DOC_S3_BUCKET: "liv-documents",
  DOC_S3_ACCESS_KEY_ID: "AK", DOC_S3_SECRET_ACCESS_KEY: "SK",
};
let handler;
let env = { ...ENV };
let allowed = new Set();
const realFetch = globalThis.fetch;

beforeAll(async () => {
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/rest/v1/rpc/doc_can_access")) {
      const scope = JSON.parse(init.body).p_scope;
      const ok = init.headers.authorization === "Bearer good.token" && allowed.has(scope);
      return new Response(JSON.stringify(ok), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const out = await build({ entryPoints: [fileURLToPath(new URL("../supabase/functions/doc-storage/index.ts", import.meta.url))], bundle: true, format: "esm", write: false, platform: "neutral", logLevel: "silent" });
  await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
});
afterAll(() => { globalThis.fetch = realFetch; delete globalThis.Deno; });

const scope = "7aa1feaf-4c11-4b20-a1b4-234082e90c97";
const fileId = "d0000000-0000-0000-0000-00000000000a";
const call = (body, { auth = "Bearer good.token", origin = "capacitor://localhost", method = "POST" } = {}) =>
  handler(new Request("https://proj.supabase.co/functions/v1/doc-storage", { method, headers: { authorization: auth, origin, "content-type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined }));

describe("doc-storage", () => {
  it("signs uploads for a scope the caller may use, pinning each size", async () => {
    allowed = new Set([scope]);
    const res = await call({ op: "put", items: [{ scope, fileId, part: "content", size: 1234 }, { scope, fileId, part: "thumb", size: 10 }] });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    const { urls } = await res.json();
    expect(urls).toHaveLength(2);
    expect(urls[0].url).toMatch(new RegExp(`^https://acct\\.r2\\.cloudflarestorage\\.com/liv-documents/${scope}/${fileId}/content\\?`));
    expect(urls[0].url).toContain("X-Amz-SignedHeaders=content-length%3Bhost");
    expect(urls[0].url).toContain("X-Amz-Expires=600");
  });

  it("refuses scopes the caller can't use, bad tokens, and junk", async () => {
    allowed = new Set();
    expect((await call({ op: "get", items: [{ scope, fileId, part: "content" }] })).status).toBe(403);
    allowed = new Set([scope]);
    expect((await call({ op: "get", items: [{ scope, fileId, part: "content" }] }, { auth: "Bearer other.token" })).status).toBe(403);
    expect((await call({ op: "get", items: [{ scope, fileId, part: "content" }] }, { auth: "" })).status).toBe(401);
    for (const bad of [
      { op: "list", items: [{ scope, fileId, part: "content" }] },
      { op: "get", items: [] },
      { op: "get", items: Array(26).fill({ scope, fileId, part: "content" }) },
      { op: "get", items: [{ scope: "../etc", fileId, part: "content" }] },
      { op: "get", items: [{ scope, fileId: "nope", part: "content" }] },
      { op: "get", items: [{ scope, fileId, part: "index.html" }] },
      { op: "put", items: [{ scope, fileId, part: "content" }] },
      { op: "put", items: [{ scope, fileId, part: "content", size: 71 * 1024 * 1024 }] },
    ]) expect((await call(bad)).status).toBe(400);
  });

  it("answers CORS only for the app's origins, and only POST", async () => {
    allowed = new Set([scope]);
    const pre = await handler(new Request("https://x/doc-storage", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("null");
    const ok = await handler(new Request("https://x/doc-storage", { method: "OPTIONS", headers: { origin: "https://effervescent-malabi-e0af55.netlify.app" } }));
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://effervescent-malabi-e0af55.netlify.app");
    expect((await call(null, { method: "GET" })).status).toBe(405);
  });

  it("is off when switched off or not configured", async () => {
    env = { ...ENV, DOCUMENTS_STORAGE_DISABLED: "1" };
    expect((await call({ op: "get", items: [{ scope, fileId, part: "content" }] })).status).toBe(503);
    env = { ...ENV, DOC_S3_SECRET_ACCESS_KEY: undefined };
    expect((await call({ op: "get", items: [{ scope, fileId, part: "content" }] })).status).toBe(503);
    env = { ...ENV };
  });
});
