import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const g = require("../netlify/functions/_gcal.js");

afterEach(() => vi.restoreAllMocks());

describe("signed OAuth state", () => {
  const secret = "test-secret";
  it("round-trips a payload", () => {
    const s = g.signState({ u: "user-1" }, { secret, now: 1_000_000 });
    expect(g.verifyState(s, { secret, now: 1_000_000 + 60_000 })).toMatchObject({ u: "user-1" });
  });
  it("rejects a forged / tampered / plain-base64 state", () => {
    const s = g.signState({ u: "user-1" }, { secret, now: 1_000_000 });
    const [body, sig] = s.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ u: "victim", t: 1_000_000, n: "x" })).toString("base64url");
    expect(g.verifyState(`${forgedBody}.${sig}`, { secret, now: 1_000_000 })).toBeNull();
    expect(g.verifyState(`${body}.${sig.slice(1)}x`, { secret, now: 1_000_000 })).toBeNull();
    expect(g.verifyState(forgedBody, { secret, now: 1_000_000 })).toBeNull(); // the Gmail flow's shape
    expect(g.verifyState(s, { secret: "other", now: 1_000_000 })).toBeNull();
  });
  it("expires after 15 minutes", () => {
    const s = g.signState({ u: "user-1" }, { secret, now: 1_000_000 });
    expect(g.verifyState(s, { secret, now: 1_000_000 + 16 * 60_000 })).toBeNull();
  });
});

describe("chooseLinks (which token reads a calendar)", () => {
  const links = [
    { appCalendarId: "cal-a", googleCalendarId: "luke@gmail.com", userId: "luke", enabled: true },
    { appCalendarId: "cal-b", googleCalendarId: "fam@group", userId: "wife", enabled: true },
    { appCalendarId: "cal-b", googleCalendarId: "fam@group", userId: "luke", enabled: true },
    { appCalendarId: "cal-c", googleCalendarId: "x@group", userId: "stranger", enabled: true },
    { appCalendarId: "cal-d", googleCalendarId: "off@group", userId: "luke", enabled: false }
  ];
  const groups = { luke: "home", wife: "home", stranger: "other" };
  const groupOf = (u) => groups[u] || null;

  it("prefers the caller's own link, falls back to a household member's, never a stranger's or a disabled one", () => {
    const chosen = g.chooseLinks(["cal-a", "cal-b", "cal-c", "cal-d"], links, "wife", groupOf);
    expect(chosen["cal-a"].userId).toBe("luke");      // household fallback
    expect(chosen["cal-b"].userId).toBe("wife");      // own link wins
    expect(chosen["cal-c"]).toBeUndefined();          // other household
    expect(chosen["cal-d"]).toBeUndefined();          // removed from the app
  });
  it("a caller with no group only reads their own links", () => {
    const chosen = g.chooseLinks(["cal-a"], links, "loner", () => null);
    expect(chosen["cal-a"]).toBeUndefined();
  });
});

describe("link input validation", () => {
  it("accepts real Google calendar ids and app ids, rejects junk", () => {
    expect(g.validLinkInput({ googleCalendarId: "en.usa#holiday@group.v.calendar.google.com", appCalendarId: "gcal-0123456789abcdef" })).toBe(true);
    expect(g.validLinkInput({ googleCalendarId: "luke@gmail.com", appCalendarId: "3f2a1c9e-1b2c-4d5e-8f90-123456789abc" })).toBe(true);
    expect(g.validLinkInput({ googleCalendarId: "a b", appCalendarId: "x" })).toBe(false);
    expect(g.validLinkInput({ googleCalendarId: "ok@x", appCalendarId: "bad)id" })).toBe(false);
    expect(g.validLinkInput(null)).toBe(false);
  });
});

describe("gcal-events handler", () => {
  it("returns per-calendar results and never touches a calendar it can't authorize", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "csecret";
    const future = new Date(Date.now() + 3600_000).toISOString();
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const u = String(url);
      calls.push(u);
      const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
      if (u.includes("/auth/v1/user")) return ok({ id: "luke" });
      if (u.includes("/rest/v1/gcal_links")) return ok([{ user_id: "luke", app_calendar_id: "cal-a", google_calendar_id: "luke@gmail.com", enabled: true }]);
      if (u.includes("/rest/v1/live_group_members")) return ok([{ group_id: "home" }]);
      if (u.includes("/rest/v1/gcal_accounts")) return ok([{ user_id: "luke", refresh_token: "r", access_token: "at", expires_at: future }]);
      if (u.includes("googleapis.com/calendar/v3/calendars/luke%40gmail.com/events")) return ok({ items: [{ id: "e1", summary: "Shift", start: { dateTime: "2026-10-13T08:00:00-05:00" }, end: { dateTime: "2026-10-13T16:00:00-05:00" } }] });
      throw new Error(`unexpected fetch ${u}`);
    }));
    const { handler } = require("../netlify/functions/gcal-events.js");
    const res = await handler({ httpMethod: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ calendars: [{ appCalendarId: "cal-a" }, { appCalendarId: "cal-zzz" }] }) });
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.results["cal-a"]).toMatchObject({ status: "ok", full: true, items: [{ id: "e1" }] });
    expect(body.results["cal-zzz"]).toEqual({ status: "unavailable", reason: "not-linked" });
    const gcall = calls.find((c) => c.includes("/events?"));
    expect(gcall).toContain("singleEvents=true");
    expect(calls.some((c) => c.includes("oauth2.googleapis.com/token"))).toBe(false); // token still valid → no refresh
    vi.unstubAllGlobals();
  });
});
