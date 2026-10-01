import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createOAuthState } = require("../netlify/functions/_oauth-state.js");
const { handler } = require("../netlify/functions/gmail-callback.js");

// Where the Gmail OAuth callback sends the user: back to the website, or — for a
// flow started in the iPhone app's sign-in sheet — back to the app's URL scheme.
const KEY = "svc-key";
let tokenOk;
beforeEach(() => {
  tokenOk = true;
  Object.assign(process.env, { SUPABASE_SERVICE_ROLE_KEY: KEY, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec", URL: "https://site.example", APP_URL: "https://site.example" });
  globalThis.fetch = async (url) => {
    const u = String(url);
    const ok = (b) => ({ ok: true, json: async () => b });
    if (u.includes("/auth/v1/admin/users/")) return ok({ id: "u1" });
    if (u.includes("oauth2.googleapis.com/token")) return tokenOk ? ok({ refresh_token: "r", access_token: "a", expires_in: 3600 }) : { ok: false, json: async () => ({}) };
    if (u.includes("userinfo")) return ok({ email: "me@example.com" });
    if (u.includes("/rest/v1/tableplan_states")) return ok({});
    throw new Error("unexpected " + u);
  };
});
afterEach(() => { for (const k of ["SUPABASE_SERVICE_ROLE_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "URL", "APP_URL"]) delete process.env[k]; });
const call = (q) => handler({ queryStringParameters: q });

describe("gmail-callback return target", () => {
  it("website flow → back to the site's Mail page", async () => {
    const res = await call({ code: "c", state: createOAuthState("u1", KEY) });
    expect(res.headers.Location).toBe("https://site.example/#mail?gm_connected=1");
  });
  it("iPhone-app flow → back to the app's URL scheme (status only)", async () => {
    const res = await call({ code: "c", state: createOAuthState("u1", KEY, { native: true }) });
    expect(res.headers.Location).toBe("com.mrlukedevans.live://gmail?status=connected");
  });
  it("iPhone-app flow errors go back to the app too", async () => {
    expect((await call({ error: "access_denied", state: createOAuthState("u1", KEY, { native: true }) })).headers.Location)
      .toBe("com.mrlukedevans.live://gmail?status=error&reason=denied");
    tokenOk = false;
    expect((await call({ code: "c", state: createOAuthState("u1", KEY, { native: true }) })).headers.Location)
      .toBe("com.mrlukedevans.live://gmail?status=error&reason=token");
  });
  it("an unverifiable state never goes to the app scheme", async () => {
    expect((await call({ code: "c", state: "forged.state" })).headers.Location).toBe("https://site.example/#mail?gm_error=state");
  });
});
