// The phone's own newspaper sign-in check (news-device-signin.js): what status
// each paper gets from the signals the iPhone app can read, and that only a
// status — never a cookie value or page HTML — comes out of it.
import { describe, it, expect } from "vitest";
import {
  DEVICE_SIGNIN_PAPERS, statusFromSignals, pageLooksSignedOut, deviceSignInsNeedCheck,
  checkDeviceSignIns, signInPageProbeSource, signInPageProbe
} from "../news-device-signin.js";

const paper = (key) => DEVICE_SIGNIN_PAPERS.find((p) => p.key === key);
const NOW = Date.parse("2026-10-08T12:00:00Z");

describe("statusFromSignals", () => {
  it("a session cookie means signed in, without loading any page", () => {
    expect(statusFromSignals(paper("nyt"), { cookieNames: ["nyt-a", "NYT-S"] })).toBe("signed-in");
    expect(statusFromSignals(paper("economist"), { cookieNames: ["blaize_session"] })).toBe("signed-in");
  });
  it("no session cookie: the subscriber page decides", () => {
    const nyt = paper("nyt");
    expect(statusFromSignals(nyt, { cookieNames: ["nyt-a"], page: { loaded: true, url: "https://www.nytimes.com/saved", signedOut: false } })).toBe("signed-in");
    expect(statusFromSignals(nyt, { cookieNames: [], page: { loaded: true, url: "https://www.nytimes.com/saved", signedOut: true } })).toBe("none");
    expect(statusFromSignals(nyt, { cookieNames: [], page: { loaded: false, finalUrl: "https://myaccount.nytimes.com/auth/login?response_type=cookie" } })).toBe("none");
  });
  it("a page that didn't load gives no answer (the server keeps what it had)", () => {
    expect(statusFromSignals(paper("nyt"), { cookieNames: [], page: null })).toBeUndefined();
    expect(statusFromSignals(paper("economist"), { cookieNames: null, page: { loaded: false, finalUrl: "https://www.economist.com/for-you/bookmarks" } })).toBeUndefined();
  });
  it("Star Tribune can't be checked: unverified only after its sign-in sheet, else none", () => {
    const strib = paper("startribune");
    expect(statusFromSignals(strib, { cookieNames: ["a"], marked: true })).toBe("unverified");
    expect(statusFromSignals(strib, { cookieNames: ["a"], marked: false })).toBe("none");
    expect(statusFromSignals(strib, { cookieNames: [], marked: true })).toBe("none"); // signed out: cookies gone
    expect(statusFromSignals(strib, { cookieNames: null, marked: true })).toBeUndefined();
  });
});

describe("pageLooksSignedOut", () => {
  it("a redirect to a sign-in page is signed out, whatever the page says", () => {
    expect(pageLooksSignedOut({ loaded: true, signedOut: false, finalUrl: "https://myaccount.economist.com/s/login/?x=1" })).toBe(true);
    expect(pageLooksSignedOut({ loaded: true, signedOut: false, url: "https://example.com/sign-in" })).toBe(true);
    expect(pageLooksSignedOut({ loaded: true, signedOut: false, url: "https://www.nytimes.com/saved" })).toBe(false);
    expect(pageLooksSignedOut({ loaded: true, signedOut: false, url: "https://www.nytimes.com/2026/10/01/us/login-outage.html" })).toBe(false);
  });
});

describe("the in-page probe", () => {
  it("returns only the address and a yes/no, using the paper's signed-out markers", () => {
    const run = (html, p) => {
      const g = globalThis;
      const saved = { document: g.document, location: g.location };
      g.document = { readyState: "complete", documentElement: { outerHTML: html } };
      g.location = { href: "https://www.nytimes.com/saved" };
      try { return JSON.parse((0, eval)(signInPageProbeSource(p))); } finally { g.document = saved.document; g.location = saved.location; }
    };
    expect(run('<a data-testid="login-button">Log in</a>', paper("nyt"))).toEqual({ url: "https://www.nytimes.com/saved", signedOut: true });
    expect(run("<h1>Saved for later</h1>", paper("nyt"))).toEqual({ url: "https://www.nytimes.com/saved", signedOut: false });
    expect(run('{"loggedIn":false}', paper("economist")).signedOut).toBe(true);
  });
  it("answers null while the page is still loading", () => {
    const g = globalThis;
    const saved = g.document;
    g.document = { readyState: "loading" };
    try { expect(signInPageProbe("x", "")).toBe("null"); } finally { g.document = saved; }
  });
});

describe("deviceSignInsNeedCheck", () => {
  const at = (h) => new Date(NOW - h * 3_600_000).toISOString();
  it("true when any paper was never reported from a phone, or over a day ago", () => {
    expect(deviceSignInsNeedCheck({}, NOW)).toBe(true);
    expect(deviceSignInsNeedCheck({ nyt: { deviceAt: at(1) }, economist: { deviceAt: at(1) } }, NOW)).toBe(true);
    const fresh = { nyt: { deviceAt: at(1) }, economist: { deviceAt: at(2) }, startribune: { deviceAt: at(23) } };
    expect(deviceSignInsNeedCheck(fresh, NOW)).toBe(false);
    expect(deviceSignInsNeedCheck({ ...fresh, startribune: { deviceAt: at(25) } }, NOW)).toBe(true);
  });
});

describe("checkDeviceSignIns", () => {
  it("asks for cookie names, loads the subscriber page only without a session cookie, and returns statuses only", async () => {
    const calls = [];
    const reader = {
      cookieNames: async ({ domain }) => {
        calls.push(["cookieNames", domain]);
        return { names: domain === "nytimes.com" ? ["NYT-S"] : domain === "startribune.com" ? ["sid"] : ["_ga"] };
      },
      extract: async ({ url, script, minChars }) => {
        calls.push(["extract", url]);
        expect(minChars).toBe(1);
        expect(script).toContain("loggedIn");
        return { json: JSON.stringify({ url: "https://myaccount.economist.com/s/login/", signedOut: false }), finalUrl: "https://myaccount.economist.com/s/login/" };
      }
    };
    const out = await checkDeviceSignIns(reader, { isMarked: (k) => k === "startribune" });
    expect(out).toEqual({ nyt: "signed-in", economist: "none", startribune: "unverified" });
    expect(calls.filter((c) => c[0] === "extract")).toEqual([["extract", "https://www.economist.com/for-you/bookmarks"]]);
  });
  it("leaves a paper out when the phone couldn't find out", async () => {
    const reader = {
      cookieNames: async () => { throw new Error("not implemented"); },
      extract: async () => { throw new Error("offline"); }
    };
    expect(await checkDeviceSignIns(reader)).toEqual({});
    expect(await checkDeviceSignIns(null)).toEqual({});
  });
});
