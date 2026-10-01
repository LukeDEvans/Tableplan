const { verifyOAuthState } = require("./_oauth-state");

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

// Where a flow started in the iPhone app returns: the app's own URL scheme. The
// app's sign-in sheet (ASWebAuthenticationSession, WebAuthPlugin.swift) is
// waiting for this scheme and closes itself when it sees it. Only a status goes
// back — the Gmail tokens never leave the server.
const NATIVE_RETURN = "com.mrlukedevans.live://gmail";

exports.handler = async (event) => {
  const { code, error, state: stateParam } = event.queryStringParameters || {};
  const appBase = (process.env.APP_URL || process.env.URL || "").replace(/\/$/, "");
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  // Verify the signed, expiring state (SRV-1) before trusting its userId. Done
  // first so even an error result goes back to the right place (app vs site).
  const verified = stateParam && serviceKey ? verifyOAuthState(stateParam, serviceKey) : null;
  const finish = (result) => verified?.native
    ? redirect(`${NATIVE_RETURN}?${result === "connected" ? "status=connected" : `status=error&reason=${encodeURIComponent(result)}`}`)
    : redirect(result === "connected" ? `${appBase}/#mail?gm_connected=1` : `${appBase}/#mail?gm_error=${encodeURIComponent(result)}`);

  if (error || !code || !stateParam) return finish("denied");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.URL}/.netlify/functions/gmail-callback`;

  if (!clientId || !clientSecret || !serviceKey) return finish("config");
  if (!verified) return finish("state");
  const userId = verified.userId;

  // Verify userId is a real Supabase user
  const userCheck = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  if (!userCheck.ok) return finish("user");

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" })
  });

  const tokens = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokens.refresh_token) return finish("token");

  let email = "";
  try {
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const profile = await profileRes.json();
    email = profile.email || "";
  } catch {}

  await saveUserGmailTokens(serviceKey, userId, {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
    email
  });

  return finish("connected");
};

async function saveUserGmailTokens(serviceKey, userId, tokens) {
  await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({ id: `gmail_${userId}`, state: tokens })
  });
}

function redirect(url) {
  return { statusCode: 302, headers: { Location: url }, body: "" };
}
