import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { canonicalizeUrl, normalizeImportUrlInput, isTrackingParam } from "../import-canonical.js";
const require = createRequire(import.meta.url);
const server = require("../netlify/functions/_import-url.js"); // the CJS mirror

describe("canonicalizeUrl (client dedup key)", () => {
  it("strips fragment, default port, and trailing slash (keeps root)", () => {
    expect(canonicalizeUrl("https://Ex.com:443/a/b/#sec")).toBe("https://ex.com/a/b");
    expect(canonicalizeUrl("https://ex.com/")).toBe("https://ex.com/");
  });
  it("removes tracking params, keeps content params + order", () => {
    expect(canonicalizeUrl("https://ex.com/p?utm_source=x&id=9&fbclid=z&q=hi")).toBe("https://ex.com/p?id=9&q=hi");
  });
  it("treats variants of the same link as equal", () => {
    const a = canonicalizeUrl("https://www.nytimes.com/2026/01/01/x.html?utm_medium=share");
    const b = canonicalizeUrl("https://www.nytimes.com/2026/01/01/x.html/");
    expect(a).toBe(b);
  });
  it("does NOT collapse genuinely different content", () => {
    expect(canonicalizeUrl("https://ex.com/a?id=1")).not.toBe(canonicalizeUrl("https://ex.com/a?id=2"));
    expect(canonicalizeUrl("https://ex.com/a")).not.toBe(canonicalizeUrl("https://ex.com/b"));
  });
  it("passes non-http(s) and junk through untouched (trimmed)", () => {
    expect(canonicalizeUrl("  not a url ")).toBe("not a url");
    expect(canonicalizeUrl("mailto:x@y.com")).toBe("mailto:x@y.com");
  });
});

describe("normalizeImportUrlInput", () => {
  it("extracts the first URL and undoubles", () => {
    expect(normalizeImportUrlInput("saw this https://ex.com/x cool")).toBe("https://ex.com/x");
    expect(normalizeImportUrlInput("https://ex.com/xhttps://ex.com/x")).toBe("https://ex.com/x");
  });
});

// The client (ESM import-canonical.js) and the server (CJS _import-url.js) keep
// separate copies for the ESM/CJS split; this guarantees they never drift.
describe("client ↔ server parity", () => {
  const urls = [
    "https://Ex.com:443/a/b/#sec", "https://ex.com/p?utm_source=x&id=9&fbclid=z&q=hi",
    "http://ex.com:80/", "https://www.site.com/post/?igshid=1&ref_src=tw", "not a url",
    "https://ex.com/a?id=1", "HTTPS://EX.COM/A/", "ftp://x.com/y",
  ];
  it("canonicalizeUrl matches the server for every case", () => {
    for (const u of urls) expect(canonicalizeUrl(u)).toBe(server.canonicalizeUrl(u));
  });
  it("normalizeImportUrlInput + isTrackingParam match the server", () => {
    for (const u of ["a https://x.com/y z", "", "https://x.comhttps://x.com"]) {
      expect(normalizeImportUrlInput(u)).toBe(server.normalizeImportUrlInput(u));
    }
    for (const k of ["utm_source", "fbclid", "id", "q", "MC_CID"]) {
      expect(isTrackingParam(k)).toBe(server.isTrackingParam ? server.isTrackingParam(k) : isTrackingParam(k));
    }
  });
});
