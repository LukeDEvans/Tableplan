import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { safeFetch, statusForImportError } = require("../netlify/functions/_import-fetch.js");

// A fake Response using the res.text() path (readCapped falls back to text()
// when there is no streaming body — simplest for deterministic tests).
function fakeRes({ status = 200, headers = {}, body = "", location } = {}) {
  const h = new Map();
  for (const [k, v] of Object.entries({ "content-type": "text/html", ...headers })) h.set(k.toLowerCase(), v);
  if (location) h.set("location", location);
  return {
    status,
    headers: { get: (k) => (h.has(String(k).toLowerCase()) ? h.get(String(k).toLowerCase()) : null) },
    body: null,
    async text() { return body; },
  };
}
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

describe("safeFetch — SSRF rejection (pre-connect)", () => {
  it("rejects non-http(s) schemes", async () => {
    await expect(safeFetch("ftp://example.com", { lookupImpl: publicLookup })).rejects.toMatchObject({ code: "bad-scheme" });
  });
  it("rejects localhost and internal hosts", async () => {
    await expect(safeFetch("http://localhost/x", { lookupImpl: publicLookup })).rejects.toMatchObject({ code: "blocked-host" });
  });
  it("rejects non-allowed ports", async () => {
    await expect(safeFetch("http://example.com:8080/x", { lookupImpl: publicLookup })).rejects.toMatchObject({ code: "bad-port" });
  });
  it("rejects a public hostname that RESOLVES to a private IP", async () => {
    const lookupImpl = async () => [{ address: "10.0.0.7", family: 4 }];
    await expect(safeFetch("http://evil.example.com/x", { lookupImpl })).rejects.toMatchObject({ code: "blocked-ip" });
  });
  it("rejects a host resolving to the cloud metadata IP", async () => {
    const lookupImpl = async () => [{ address: "169.254.169.254", family: 4 }];
    await expect(safeFetch("http://metadata.example/x", { lookupImpl })).rejects.toMatchObject({ code: "blocked-ip" });
  });
});

describe("safeFetch — redirects", () => {
  it("validates each redirect target and rejects a redirect to a private address", async () => {
    const fetchImpl = async () => fakeRes({ status: 302, location: "http://10.0.0.1/internal" });
    await expect(safeFetch("http://example.com/start", { fetchImpl, lookupImpl: publicLookup }))
      .rejects.toMatchObject({ code: "blocked-host" });
  });
  it("enforces a maximum redirect count", async () => {
    let n = 0;
    const fetchImpl = async () => fakeRes({ status: 302, location: `http://example.com/next${n++}` });
    await expect(safeFetch("http://example.com/start", { fetchImpl, lookupImpl: publicLookup, maxRedirects: 3 }))
      .rejects.toMatchObject({ code: "too-many-redirects" });
  });
  it("follows a valid redirect to a public host and returns the final URL", async () => {
    let hop = 0;
    const fetchImpl = async (url) => hop++ === 0
      ? fakeRes({ status: 301, location: "https://example.com/final" })
      : fakeRes({ status: 200, body: "<html>ok</html>" });
    const out = await safeFetch("https://example.com/start", { fetchImpl, lookupImpl: publicLookup });
    expect(out.finalUrl).toBe("https://example.com/final");
    expect(out.body).toContain("ok");
  });
});

describe("safeFetch — resource limits", () => {
  it("maps an aborted request to a timeout", async () => {
    const fetchImpl = async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };
    await expect(safeFetch("https://example.com/x", { fetchImpl, lookupImpl: publicLookup }))
      .rejects.toMatchObject({ code: "timeout" });
  });
  it("rejects a response larger than maxBytes", async () => {
    const fetchImpl = async () => fakeRes({ body: "x".repeat(5000) });
    await expect(safeFetch("https://example.com/x", { fetchImpl, lookupImpl: publicLookup, maxBytes: 1000 }))
      .rejects.toMatchObject({ code: "too-large" });
  });
  it("rejects on an oversized declared Content-Length before reading", async () => {
    const fetchImpl = async () => fakeRes({ headers: { "content-length": "9999999" }, body: "small" });
    await expect(safeFetch("https://example.com/x", { fetchImpl, lookupImpl: publicLookup, maxBytes: 1000 }))
      .rejects.toMatchObject({ code: "too-large" });
  });
  it("rejects an unsupported content type", async () => {
    const fetchImpl = async () => fakeRes({ headers: { "content-type": "application/pdf" }, body: "%PDF" });
    await expect(safeFetch("https://example.com/x", { fetchImpl, lookupImpl: publicLookup }))
      .rejects.toMatchObject({ code: "bad-content-type" });
  });
  it("allows a caller-supplied content-type list", async () => {
    const fetchImpl = async () => fakeRes({ headers: { "content-type": "text/plain" }, body: "hi there" });
    const out = await safeFetch("https://example.com/x", { fetchImpl, lookupImpl: publicLookup, allowedContentTypes: ["text/plain"] });
    expect(out.contentType).toBe("text/plain");
  });
});

describe("safeFetch — clean request context", () => {
  it("never forwards cookies or authorization to the target", async () => {
    let seen = null;
    const fetchImpl = async (_url, init) => { seen = init.headers; return fakeRes({ body: "<html>ok</html>" }); };
    await safeFetch("https://example.com/x", { fetchImpl, lookupImpl: publicLookup });
    const keys = Object.keys(seen).map((k) => k.toLowerCase());
    expect(keys).not.toContain("cookie");
    expect(keys).not.toContain("authorization");
    expect(keys).toContain("user-agent");
  });
  it("returns ok/status/contentType/body on success", async () => {
    const fetchImpl = async () => fakeRes({ status: 200, body: "<html>hello</html>" });
    const out = await safeFetch("https://example.com/x", { fetchImpl, lookupImpl: publicLookup });
    expect(out).toMatchObject({ ok: true, status: 200, contentType: "text/html" });
    expect(out.body).toContain("hello");
  });
});

describe("statusForImportError", () => {
  it("maps codes to sensible HTTP statuses", () => {
    expect(statusForImportError({ code: "blocked-host" })).toBe(400);
    expect(statusForImportError({ code: "too-large" })).toBe(422);
    expect(statusForImportError({ code: "timeout" })).toBe(504);
    expect(statusForImportError({ code: "dns" })).toBe(502);
    expect(statusForImportError({ code: "whatever" })).toBe(500);
  });
});
