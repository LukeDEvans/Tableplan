// Mints an Apple Music developer token (a short-lived ES256 JWT) for MusicKit JS.
//
// The client (music-provider-applemusic.js) fetches this before configuring
// MusicKit. The signing key never reaches the browser — only the resulting JWT.
//
// TOKEN-READY STUB: until the three env vars below are set, this returns
// 503 {error, configured:false} and the Apple Music provider stays inert
// (isAvailable()=false), exactly like Jamendo without a client id. Drop the key
// in and it lights up — no code change.
//
// Netlify env (never commit these):
//   APPLE_MUSIC_PRIVATE_KEY  the .p8 contents (PEM, "-----BEGIN PRIVATE KEY-----…").
//                            Paste with real newlines, or with \n escapes (handled).
//   APPLE_MUSIC_KEY_ID       the 10-char MusicKit Key ID (JWT header `kid`).
//   APPLE_MUSIC_TEAM_ID      your 10-char Apple Developer Team ID (JWT `iss`).
//
// Prereqs you own outside the code: an Apple Developer Program membership and a
// MusicKit identifier + private key (developer.apple.com → Certificates,
// Identifiers & Profiles → Keys → enable MusicKit). The END USER also needs an
// Apple Music subscription to play full tracks (checked client-side).

const crypto = require("crypto");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(json(200, {}));
  if (event.httpMethod !== "GET") return cors(json(405, { error: "Method not allowed" }));

  const keyId = (process.env.APPLE_MUSIC_KEY_ID || "").trim();
  const teamId = (process.env.APPLE_MUSIC_TEAM_ID || "").trim();
  const privateKey = normalizePem(process.env.APPLE_MUSIC_PRIVATE_KEY || "");
  if (!keyId || !teamId || !privateKey) {
    return cors(json(503, { error: "Apple Music not configured.", configured: false }));
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const ttl = 60 * 60 * 24 * 150; // 150 days (Apple caps developer tokens at ~180)
    const token = signES256({ alg: "ES256", kid: keyId }, { iss: teamId, iat: now, exp: now + ttl }, privateKey);
    // Cache at the edge for a day; the token is valid far longer, so this is safe
    // and avoids re-signing on every load.
    return cors(json(200, { token, expiresAt: (now + ttl) * 1000, configured: true }, { "cache-control": "public, max-age=86400" }));
  } catch (e) {
    return cors(json(500, { error: `Could not mint token: ${String(e && e.message || e).slice(0, 200)}`, configured: false }));
  }
};

// ES256 JWT. Node's crypto with dsaEncoding "ieee-p1363" yields the JOSE raw
// R||S signature MusicKit expects (not DER).
function signES256(header, payload, privateKey) {
  const enc = (obj) => base64url(Buffer.from(JSON.stringify(obj)));
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const sig = crypto.sign("sha256", Buffer.from(signingInput), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${base64url(sig)}`;
}

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Netlify env values often arrive with literal "\n" instead of newlines.
function normalizePem(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.includes("\\n") ? s.replace(/\\n/g, "\n") : s;
}

function json(statusCode, body, extraHeaders) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8", ...(extraHeaders || {}) }, body: JSON.stringify(body) };
}

function cors(res) {
  return {
    ...res,
    headers: {
      ...(res.headers || {}),
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type, accept",
    },
  };
}
