import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const g = require("../netlify/functions/_gcal.js");

afterEach(() => vi.restoreAllMocks());

describe("signed OAuth state (shared _oauth-state, Calendar purpose)", () => {
  const secret = "test-secret";
  it("round-trips the user and the native flag", () => {
    const s = g.signState("user-1", { secret, now: 1_000_000, native: true });
    expect(g.verifyState(s, { secret, now: 1_000_000 + 60_000 })).toEqual({ userId: "user-1", native: true });
    expect(g.verifyState(g.signState("user-1", { secret, now: 1_000_000 }), { secret, now: 1_000_000 })).toEqual({ userId: "user-1", native: false });
  });
  it("rejects tampered, foreign-key, expired and Gmail-purpose states", () => {
    const s = g.signState("user-1", { secret, now: 1_000_000 });
    const [, sig] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ userId: "victim", nonce: "x", exp: 9e15 })).toString("base64url");
    expect(g.verifyState(`${forged}.${sig}`, { secret, now: 1_000_000 })).toBeNull();
    expect(g.verifyState(s, { secret: "other", now: 1_000_000 })).toBeNull();
    expect(g.verifyState(s, { secret, now: 1_000_000 + 16 * 60_000 })).toBeNull();
    const { createOAuthState } = require("../netlify/functions/_oauth-state.js");
    expect(g.verifyState(createOAuthState("user-1", secret, { now: 1_000_000 }), { secret, now: 1_000_000 })).toBeNull();
  });
});

describe("gcal-callback returns to the right place", () => {
  it("sends an iPhone-app flow back to the app scheme, a web flow back to the site", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
    process.env.URL = "https://example.netlify.app";
    const { handler } = require("../netlify/functions/gcal-callback.js");
    const native = g.signState("u1", { native: true, secret: "svc" });
    const web = g.signState("u1", { secret: "svc" });
    const r1 = await handler({ queryStringParameters: { error: "access_denied", state: native } });
    expect(r1.headers.Location).toBe("com.mrlukedevans.live://gcal?status=error&reason=denied");
    const r2 = await handler({ queryStringParameters: { error: "access_denied", state: web } });
    expect(r2.headers.Location).toBe("https://example.netlify.app/?gcal=error&reason=denied#plan");
    const r3 = await handler({ queryStringParameters: { code: "c", state: "forged.sig" } });
    expect(r3.headers.Location).toBe("https://example.netlify.app/?gcal=error&reason=state#plan");
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
    expect(body.results["cal-a"]).toMatchObject({ status: "ok", full: true, items: [{ id: "e1" }], own: true, defaultReminders: [] });
    expect(body.results["cal-zzz"]).toEqual({ status: "unavailable", reason: "not-linked" });
    const gcall = calls.find((c) => c.includes("/events?"));
    expect(gcall).toContain("singleEvents=true");
    // Reminders are requested for the app's own event reminders (IOS_NOTIFICATIONS_DESIGN.md §4).
    expect(decodeURIComponent(gcall)).toContain("reminders");
    expect(decodeURIComponent(gcall)).toContain("defaultReminders");
    expect(calls.some((c) => c.includes("oauth2.googleapis.com/token"))).toBe(false); // token still valid → no refresh
    vi.unstubAllGlobals();
  });
});

describe("gcal-events reminder ownership", () => {
  it("marks a calendar read through another household member's link as not own, and passes default reminders through", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "csecret";
    const future = new Date(Date.now() + 3600_000).toISOString();
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const u = String(url);
      const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
      if (u.includes("/auth/v1/user")) return ok({ id: "luke" });
      if (u.includes("/rest/v1/gcal_links")) return ok([
        { user_id: "luke", app_calendar_id: "cal-mine", google_calendar_id: "luke@gmail.com", enabled: true },
        { user_id: "wife", app_calendar_id: "cal-hers", google_calendar_id: "wife@gmail.com", enabled: true }
      ]);
      if (u.includes("/rest/v1/live_group_members")) return ok([{ group_id: "home" }]);
      if (u.includes("/rest/v1/gcal_accounts")) return ok([{ user_id: "x", refresh_token: "r", access_token: "at", expires_at: future }]);
      if (u.includes("calendars/luke%40gmail.com/events")) return ok({ items: [], defaultReminders: [{ method: "popup", minutes: 30 }] });
      if (u.includes("calendars/wife%40gmail.com/events")) return ok({ items: [], defaultReminders: [{ method: "popup", minutes: 10 }] });
      throw new Error(`unexpected fetch ${u}`);
    }));
    const { handler } = require("../netlify/functions/gcal-events.js");
    const res = await handler({ httpMethod: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ calendars: [{ appCalendarId: "cal-mine" }, { appCalendarId: "cal-hers" }] }) });
    const body = JSON.parse(res.body);
    expect(body.results["cal-mine"]).toMatchObject({ status: "ok", own: true, defaultReminders: [{ method: "popup", minutes: 30 }] });
    expect(body.results["cal-hers"]).toMatchObject({ status: "ok", own: false });
    vi.unstubAllGlobals();
  });
});
