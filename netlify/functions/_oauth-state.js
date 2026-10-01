// Signed OAuth `state` tokens (SRV-1).
//
// The Gmail OAuth flow round-trips `state` through Google back to
// gmail-callback, which trusts the userId inside it to decide whose row the
// refresh token is written to. An unsigned state lets anyone forge another
// user's id and overwrite / take over their mailbox link. So the state is:
//
//   base64url(JSON{ userId, nonce, exp[, native] }) + "." + base64url(HMAC-SHA256(payload))
//
// `native: true` marks a flow started from the iPhone app (Apple's sign-in
// sheet), so the callback hands control back to the app instead of the website.
//
// The HMAC key is derived from the existing SUPABASE_SERVICE_ROLE_KEY (no new
// env var): HMAC(serviceKey, "<purpose>").
const crypto = require("crypto");

const DEFAULT_PURPOSE = "gmail-oauth-state-v1";
const DEFAULT_TTL_MS = 15 * 60 * 1000;

function deriveKey(secret, purpose = DEFAULT_PURPOSE) {
  const s = String(secret || "").trim();
  if (!s) throw new Error("oauth-state: missing signing secret");
  return crypto.createHmac("sha256", s).update(purpose).digest();
}

function sign(payloadB64, key) {
  return crypto.createHmac("sha256", key).update(payloadB64).digest("base64url");
}

function createOAuthState(userId, secret, { purpose = DEFAULT_PURPOSE, ttlMs = DEFAULT_TTL_MS, now = Date.now(), native = false } = {}) {
  if (!userId) throw new Error("oauth-state: missing userId");
  const key = deriveKey(secret, purpose);
  const payload = Buffer.from(JSON.stringify({
    userId: String(userId),
    nonce: crypto.randomBytes(16).toString("base64url"),
    exp: now + ttlMs,
    ...(native ? { native: true } : {})
  })).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

// Returns { userId, native } when the signature and expiry check out, else null.
function verifyOAuthState(state, secret, { purpose = DEFAULT_PURPOSE, now = Date.now() } = {}) {
  try {
    if (typeof state !== "string" || state.length > 2048) return null;
    const parts = state.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [payload, sig] = parts;
    const key = deriveKey(secret, purpose);
    const expected = Buffer.from(sign(payload, key));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed.userId !== "string" || !parsed.userId) return null;
    if (!Number.isFinite(parsed.exp) || parsed.exp < now) return null;
    return { userId: parsed.userId, native: parsed.native === true };
  } catch {
    return null;
  }
}

module.exports = { createOAuthState, verifyOAuthState, DEFAULT_TTL_MS };
