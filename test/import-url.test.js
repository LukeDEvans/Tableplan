import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const {
  canonicalizeUrl, assertAllowedUrl, isBlockedIp, isBlockedHostname, normalizeImportUrlInput,
} = require("../netlify/functions/_import-url.js");

describe("canonicalizeUrl", () => {
  it("removes the fragment", () => {
    expect(canonicalizeUrl("https://ex.com/a#section")).toBe("https://ex.com/a");
  });
  it("strips a trailing slash but keeps the root slash", () => {
    expect(canonicalizeUrl("https://ex.com/a/b/")).toBe("https://ex.com/a/b");
    expect(canonicalizeUrl("https://ex.com/")).toBe("https://ex.com/");
  });
  it("removes tracking params but keeps content params, preserving order", () => {
    expect(canonicalizeUrl("https://ex.com/p?utm_source=x&id=9&fbclid=abc&q=hi"))
      .toBe("https://ex.com/p?id=9&q=hi");
  });
  it("lowercases the host and drops default ports", () => {
    expect(canonicalizeUrl("https://Ex.COM:443/a")).toBe("https://ex.com/a");
    expect(canonicalizeUrl("http://Ex.com:80/a")).toBe("http://ex.com/a");
  });
  it("keeps a non-default port and legitimate query identity", () => {
    expect(canonicalizeUrl("https://ex.com:8080/p?recipe=42")).toBe("https://ex.com:8080/p?recipe=42");
  });
  it("is stable (idempotent)", () => {
    const once = canonicalizeUrl("https://Ex.com/a/?utm_medium=e&id=1#x");
    expect(canonicalizeUrl(once)).toBe(once);
  });
  it("returns the trimmed input for non-http(s) schemes", () => {
    expect(canonicalizeUrl("ftp://ex.com/x")).toBe("ftp://ex.com/x");
  });
});

describe("assertAllowedUrl", () => {
  it("accepts public http/https URLs", () => {
    expect(assertAllowedUrl("https://example.com/x").hostname).toBe("example.com");
    expect(assertAllowedUrl("http://example.com/x").hostname).toBe("example.com");
  });
  it("rejects non-http(s) schemes", () => {
    expect(() => assertAllowedUrl("ftp://example.com")).toThrow(/scheme/i);
    expect(() => assertAllowedUrl("file:///etc/passwd")).toThrow(/scheme/i);
  });
  it("rejects non-80/443 ports", () => {
    expect(() => assertAllowedUrl("http://example.com:8080/")).toThrow(/port/i);
  });
  it("rejects embedded credentials", () => {
    expect(() => assertAllowedUrl("https://user:pass@example.com/")).toThrow(/credential/i);
  });
  it("rejects localhost and internal hostnames", () => {
    expect(() => assertAllowedUrl("http://localhost/")).toThrow(/blocked/i);
    expect(() => assertAllowedUrl("http://router/")).toThrow(/blocked/i);         // single-label
    expect(() => assertAllowedUrl("http://db.internal/")).toThrow(/blocked/i);
  });
  it("rejects private/loopback IP literals as hosts", () => {
    expect(() => assertAllowedUrl("http://127.0.0.1/")).toThrow(/blocked/i);
    expect(() => assertAllowedUrl("http://169.254.169.254/latest/meta-data/")).toThrow(/blocked/i);
    expect(() => assertAllowedUrl("http://10.0.0.5/")).toThrow(/blocked/i);
  });
  it("attaches a code for status mapping", () => {
    try { assertAllowedUrl("http://localhost/"); } catch (e) { expect(e.code).toBe("blocked-host"); }
  });
});

describe("isBlockedIp — IPv4", () => {
  it("blocks private/reserved/link-local ranges", () => {
    for (const ip of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254",
                      "172.16.0.1", "172.31.255.255", "192.168.1.1", "198.18.0.1", "224.0.0.1", "255.255.255.255"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "151.101.1.140", "172.32.0.1"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });
});

describe("isBlockedIp — IPv6", () => {
  it("blocks loopback/unspecified/ULA/link-local/multicast and mapped IPv4", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });
  it("allows public IPv6", () => {
    expect(isBlockedIp("2001:4860:4860::8888")).toBe(false);
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
  });
});

describe("isBlockedHostname", () => {
  it("blocks empty, localhost, single-label, and internal suffixes", () => {
    for (const h of ["", "localhost", "intranet", "printer", "svc.local", "api.internal", "host.lan"]) {
      expect(isBlockedHostname(h), h).toBe(true);
    }
  });
  it("allows normal public hostnames", () => {
    for (const h of ["example.com", "www.nytimes.com", "sub.domain.co.uk"]) {
      expect(isBlockedHostname(h), h).toBe(false);
    }
  });
});

describe("normalizeImportUrlInput", () => {
  it("extracts the first URL from a messy string", () => {
    expect(normalizeImportUrlInput("check this https://ex.com/r out")).toBe("https://ex.com/r");
  });
  it("defends against an accidentally doubled URL", () => {
    expect(normalizeImportUrlInput("https://ex.com/rhttps://ex.com/r")).toBe("https://ex.com/r");
  });
  it("returns empty for no URL", () => {
    expect(normalizeImportUrlInput("just text")).toBe("");
    expect(normalizeImportUrlInput("")).toBe("");
  });
});
