// Every Netlify function that checks a user's sign-in calls Supabase's
// /auth/v1/user through authUserFetch instead of fetch.
//
// /auth/v1/user accepts any valid token, including one from a sign-in that never
// entered the authenticator code (aal1). The functions then work with the
// service-role key, which skips the database's require_mfa_when_enrolled policy
// (migrations/2026-11-17c-mfa-aal2-rls.sql). So the same rule is applied here:
// a token below aal2 is refused when the user has a verified factor.
//
// A refused token comes back as a 401 Response, which every caller already
// treats as "not signed in". A user with no verified factor is unaffected.

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? String(headers[key] || "") : "";
}

// The token's claims, without checking its signature: /auth/v1/user has just
// checked it, and the claim is only read to refuse, never to grant.
function jwtClaims(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return {};
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const claims = JSON.parse(json);
    return claims && typeof claims === "object" ? claims : {};
  } catch {
    return {};
  }
}

function hasVerifiedFactor(user) {
  return Array.isArray(user?.factors) && user.factors.some((f) => f && f.status === "verified");
}

// True when this sign-in must not be let through.
function mfaShortfall(token, user) {
  return jwtClaims(token).aal !== "aal2" && hasVerifiedFactor(user);
}

const REFUSED = { code: "mfa_required", msg: "Enter your authenticator code in Liv first." };

async function authUserFetch(url, init = {}, impl = fetch) {
  const res = await impl(url, init);
  if (!res || !res.ok) return res;
  const token = headerValue(init.headers, "authorization").replace(/^Bearer\s+/i, "");
  // The body is read once here, so hand the caller a stand-in with the same
  // ok / status / json() / text() it would use.
  let user = null;
  if (typeof res.json === "function") {
    try { user = await res.json(); } catch { user = null; }
  }
  if (mfaShortfall(token, user)) return reply(401, REFUSED, res.headers);
  return reply(res.status || 200, user, res.headers);
}

function reply(status, body, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

module.exports = { authUserFetch, mfaShortfall, jwtClaims, hasVerifiedFactor };
