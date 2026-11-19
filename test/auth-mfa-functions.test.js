// Netlify functions refuse a sign-in that skipped the authenticator code
// (netlify/functions/_auth-user.js), matching the database's
// require_mfa_when_enrolled policy (migrations/2026-11-17c-mfa-aal2-rls.sql).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { authUserFetch, mfaShortfall, jwtClaims } = require("../netlify/functions/_auth-user.js");

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (claims) => `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
const user = (factors) => ({ id: "u1", email: "luke@example.com", ...(factors ? { factors } : {}) });
const verified = [{ id: "f1", factor_type: "totp", status: "verified" }];
const unverified = [{ id: "f1", factor_type: "totp", status: "unverified" }];

function fakeFetch(body, status = 200) {
  return async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const call = (tok, body, status) =>
  authUserFetch("https://x.supabase.co/auth/v1/user", { headers: { apikey: "k", Authorization: `Bearer ${tok}` } }, fakeFetch(body, status));

describe("authUserFetch", () => {
  it("lets an aal1 sign-in through when the user has no verified factor", async () => {
    const res = await call(token({ aal: "aal1" }), user());
    expect(res.ok).toBe(true);
    expect((await res.json()).id).toBe("u1");
    expect((await call(token({ aal: "aal1" }), user(unverified))).ok).toBe(true);
  });

  it("refuses an aal1 sign-in when the user has a verified factor", async () => {
    const res = await call(token({ aal: "aal1" }), user(verified));
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("mfa_required");
  });

  it("refuses a token with no aal claim when a factor is verified", async () => {
    expect((await call(token({ sub: "u1" }), user(verified))).status).toBe(401);
    expect((await call("not-a-jwt", user(verified))).status).toBe(401);
  });

  it("lets an aal2 sign-in through", async () => {
    const res = await call(token({ aal: "aal2" }), user(verified));
    expect(res.ok).toBe(true);
    expect((await res.json()).id).toBe("u1");
  });

  it("passes a failed check straight back", async () => {
    const res = await call(token({ aal: "aal2" }), { msg: "bad jwt" }, 401);
    expect(res.status).toBe(401);
  });

  it("reads the header whatever its case, and from a Headers object", async () => {
    const tok = token({ aal: "aal1" });
    const viaHeaders = await authUserFetch("u", { headers: new Headers({ authorization: `Bearer ${tok}` }) }, fakeFetch(user(verified)));
    expect(viaHeaders.status).toBe(401);
  });

  it("helpers", () => {
    expect(jwtClaims(token({ aal: "aal2" })).aal).toBe("aal2");
    expect(jwtClaims("x")).toEqual({});
    expect(mfaShortfall(token({ aal: "aal1" }), user(verified))).toBe(true);
    expect(mfaShortfall(token({ aal: "aal1" }), user())).toBe(false);
  });
});

describe("every function that checks a user token goes through authUserFetch", () => {
  const dir = new URL("../netlify/functions/", import.meta.url);
  const files = readdirSync(dir).filter((f) => /\.(m?js)$/.test(f) && f !== "_auth-user.js");
  it("no bare fetch of /auth/v1/user", () => {
    const bare = [];
    for (const f of files) {
      const src = readFileSync(new URL(f, dir), "utf8");
      src.split("\n").forEach((line, i) => {
        if (line.includes("/auth/v1/user") && !/authUserFetch\(/.test(line)) bare.push(`${f}:${i + 1}`);
      });
    }
    expect(bare, "call authUserFetch (netlify/functions/_auth-user.js) instead of fetch").toEqual([]);
  });
});
