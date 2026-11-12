import { describe, it, expect } from "vitest";
import {
  sessionClaims, secondStepNeeded, verifiedTotpFactors, cleanCode, faceIdLockDue, faceIdPrefOn,
  oauthReturnError, stripOauthReturnError, oauthErrorMessage, FACE_ID_GRACE_MS, FACE_ID_PREF_KEY,
} from "../auth-second-step.js";

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (claims) => `${b64url({ alg: "HS256" })}.${b64url(claims)}.sig`;
const session = (aal, factors = []) => ({ access_token: jwt({ sub: "u1", aal }), user: { id: "u1", factors } });
const totp = (status = "verified") => ({ id: "f1", factor_type: "totp", status });

describe("secondStepNeeded", () => {
  it("is false with no session or no authenticator", () => {
    expect(secondStepNeeded(null)).toBe(false);
    expect(secondStepNeeded(session("aal1"))).toBe(false);
    expect(secondStepNeeded(session("aal1", [totp("unverified")]))).toBe(false); // a setup left half-done never locks anyone out
  });
  it("asks for the code when an authenticator is on and the session is aal1", () => {
    expect(secondStepNeeded(session("aal1", [totp()]))).toBe(true);
  });
  it("is done once the session is aal2", () => {
    expect(secondStepNeeded(session("aal2", [totp()]))).toBe(false);
  });
  it("asks when the token can't be read (fails closed for an account with a factor)", () => {
    expect(secondStepNeeded({ access_token: "garbage", user: { factors: [totp()] } })).toBe(true);
  });
  it("ignores other factor types", () => {
    expect(verifiedTotpFactors(session("aal1", [{ id: "p", factor_type: "phone", status: "verified" }]))).toEqual([]);
  });
  it("reads claims from a base64url token", () => {
    expect(sessionClaims(session("aal2"))).toMatchObject({ aal: "aal2", sub: "u1" });
    expect(sessionClaims({})).toBe(null);
  });
});

describe("codes", () => {
  it("keeps six digits", () => {
    expect(cleanCode(" 123 456 ")).toBe("123456");
    expect(cleanCode("1234567")).toBe("123456");
    expect(cleanCode(null)).toBe("");
  });
});

describe("Face ID lock timing", () => {
  const now = 1_000_000_000;
  it("asks on first open, and never when off", () => {
    expect(faceIdLockDue({ enabled: true, lastUnlockedAt: 0, hiddenAt: 0, now })).toBe(true);
    expect(faceIdLockDue({ enabled: false, lastUnlockedAt: 0, hiddenAt: 0, now })).toBe(false);
  });
  it("doesn't ask after a short trip away", () => {
    expect(faceIdLockDue({ enabled: true, lastUnlockedAt: now - 1e6, hiddenAt: now - 60_000, now })).toBe(false);
    expect(faceIdLockDue({ enabled: true, lastUnlockedAt: now - 1e6, hiddenAt: 0, now })).toBe(false);
  });
  it("asks after the grace period", () => {
    expect(faceIdLockDue({ enabled: true, lastUnlockedAt: now - 1e7, hiddenAt: now - FACE_ID_GRACE_MS, now })).toBe(true);
  });
  it("is on unless switched off on this device", () => {
    const store = (v) => ({ getItem: (k) => (k === FACE_ID_PREF_KEY ? v : null) });
    expect(faceIdPrefOn(store(null))).toBe(true);
    expect(faceIdPrefOn(store("on"))).toBe(true);
    expect(faceIdPrefOn(store("off"))).toBe(false);
    expect(faceIdPrefOn({ getItem: () => { throw new Error("private"); } })).toBe(true);
  });
});

describe("Google/Apple return errors", () => {
  const site = "https://effervescent-malabi-e0af55.netlify.app/";
  it("reads the reason from the hash or the query", () => {
    expect(oauthReturnError(`${site}#error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code`))
      .toEqual({ error: "server_error", code: "unexpected_failure", description: "Unable to exchange external code" });
    expect(oauthReturnError(`${site}?error=access_denied&error_description=Signups+not+allowed+for+this+instance`).description)
      .toBe("Signups not allowed for this instance");
  });
  it("is null for a normal URL or a page route", () => {
    expect(oauthReturnError(`${site}#plan`)).toBe(null);
    expect(oauthReturnError("nope")).toBe(null);
  });
  it("strips only the error parameters", () => {
    expect(stripOauthReturnError(`${site}?x=1&error=e&error_description=d`)).toBe(`${site}?x=1`);
    expect(stripOauthReturnError(`${site}#error=e&error_code=c`)).toBe(site);
    expect(stripOauthReturnError(`${site}#plan`)).toBe(`${site}#plan`);
  });
  it("words the message for the gate", () => {
    expect(oauthErrorMessage({ error: "server_error", description: "Unable to exchange external code" }))
      .toBe("Google/Apple sign-in failed: Unable to exchange external code. Use the email code for now.");
  });
});
