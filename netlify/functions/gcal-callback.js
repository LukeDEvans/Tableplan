// Google redirects here after consent. Verifies the SIGNED state, exchanges the
// code, stores the refresh token in gcal_accounts, then sends the browser back
// to the app (?gcal=connected | ?gcal=error&reason=…).
const { verifyState, redirectUri, appBase, saveAccount, GCAL_SCOPE } = require("./_gcal");

function back(params) {
  return { statusCode: 302, headers: { Location: `${appBase()}/?${new URLSearchParams(params)}#plan` }, body: "" };
}

exports.handler = async (event) => {
  const { code, error, state } = event.queryStringParameters || {};
  if (error || !code || !state) return back({ gcal: "error", reason: error === "access_denied" ? "denied" : "missing" });

  const payload = verifyState(state);
  if (!payload?.u) return back({ gcal: "error", reason: "state" });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()) return back({ gcal: "error", reason: "config" });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri(), grant_type: "authorization_code" })
  });
  const tokens = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokens.refresh_token) return back({ gcal: "error", reason: "token" });
  const scopes = String(tokens.scope || "");
  // Granular consent lets the user untick the calendar box; without it nothing works.
  if (!scopes.split(/\s+/).includes(GCAL_SCOPE)) return back({ gcal: "error", reason: "scope" });

  let email = "";
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    email = (await r.json())?.email || "";
  } catch { /* email is cosmetic */ }

  try {
    await saveAccount(payload.u, {
      google_email: email,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
      scopes
    });
  } catch (e) {
    console.error("gcal-callback: save failed", e.message);
    return back({ gcal: "error", reason: "save" });
  }
  return back({ gcal: "connected" });
};
