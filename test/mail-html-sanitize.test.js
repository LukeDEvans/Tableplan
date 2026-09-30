// html-sanitize.js — the pure URL-scheme allowlist half. (The DOMParser-based
// sanitizers need a browser; they're exercised by a Playwright check, not here.)
import { describe, it, expect } from "vitest";
import { safeUrl, isSafeHref, isSafeSrc } from "../html-sanitize.js";

describe("safeUrl", () => {
  it("passes allowlisted schemes through, trimmed", () => {
    expect(safeUrl("  https://example.com/a?b=1 ")).toBe("https://example.com/a?b=1");
    expect(safeUrl("http://x.test")).toBe("http://x.test");
    expect(safeUrl("MAILTO:a@b.c")).toBe("MAILTO:a@b.c");
    expect(safeUrl("tel:+15551234")).toBe("tel:+15551234");
  });
  it("rejects script-bearing and other schemes", () => {
    for (const u of ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "java\nscript:x",
      "\u0000javascript:x", "vbscript:x", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd",
      "//evil.test/x", "/relative", "blob:https://x/y"]) {
      expect(safeUrl(u)).toBe("");
    }
  });
  it("returns the fallback for empty/unsafe input", () => {
    expect(safeUrl("", "#")).toBe("#");
    expect(safeUrl(null, "#")).toBe("#");
    expect(safeUrl(undefined)).toBe("");
    expect(safeUrl("javascript:x", "#")).toBe("#");
  });
  it("does not let whitespace/control chars smuggle a safe-looking prefix", () => {
    expect(safeUrl("ht\ttps://ok.test")).toBe("ht\ttps://ok.test"); // browser strips the tab → https
    expect(safeUrl("javascript​:alert(1)")).toBe("");
  });
});

describe("isSafeHref / isSafeSrc", () => {
  it("hrefs: http(s)/mailto/tel + in-page fragments", () => {
    expect(isSafeHref("#top")).toBe(true);
    expect(isSafeHref("https://a.b")).toBe(true);
    expect(isSafeHref("javascript:void(0)")).toBe(false);
    expect(isSafeHref("data:text/html,x")).toBe(false);
    expect(isSafeHref("")).toBe(false);
  });
  it("srcs: http(s), cid:, data:image only", () => {
    expect(isSafeSrc("https://img.test/a.png")).toBe(true);
    expect(isSafeSrc("cid:part1@x")).toBe(true);
    expect(isSafeSrc("data:image/png;base64,AAAA")).toBe(true);
    expect(isSafeSrc("data:text/html,x")).toBe(false);
    expect(isSafeSrc("javascript:x")).toBe(false);
    expect(isSafeSrc("#x")).toBe(false);
  });
});
