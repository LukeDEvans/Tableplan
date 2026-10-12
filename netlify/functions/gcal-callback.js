// Google redirects here after consent. Verifies the SIGNED state, exchanges the
// code, stores the refresh token in gcal_accounts, then sends the browser back
// to the site (?gcal=connected | ?gcal=error&reason=…) — or, for a flow started
// in the iPhone app, to the app's URL scheme, where the sign-in sheet is waiting.
// Only a status goes back; tokens never leave the server.
const { verifyState, redirectUri, appBase, saveAccount, GCAL_SCOPE } = require("./_gcal");

const NATIVE_RETURN = "com.mrlukedevans.live://gcal";

exports.handler = async (event) => {
  const { code, error, state } = event.queryStringParameters || {};
  // Verify first so even an error result goes back to the right place.
  const payload = state ? verifyState(state) : null;
  const back = ({ gcal, reason }) => {
    const location = payload?.native
      ? `${NATIVE_RETURN}?${gcal === "connected" ? "status=connected" : `status=error&reason=${encodeURIComponent(reason || "unknown")}`}`
      : `${appBase()}/?${new URLSearchParams(reason ? { gcal, reason } : { gcal })}#plan`;
    return { statusCode: 302, headers: { Location: location }, body: "" };
  };

  if (error || !code || !state) return back({ gcal: "error", reason: error === "access_denied" ? "denied" : "missing" });
  if (!payload?.userId) return back({ gcal: "error", reason: "state" });

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
    await saveAccount(payload.userId, {
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
