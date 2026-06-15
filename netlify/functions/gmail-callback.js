const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

exports.handler = async (event) => {
  const { code, error, state: stateParam } = event.queryStringParameters || {};
  const appBase = (process.env.APP_URL || process.env.URL || "").replace(/\/$/, "");

  if (error || !code || !stateParam) return redirect(`${appBase}/#mail?gm_error=denied`);

  // Decode userId from state param
  let userId;
  try {
    const parsed = JSON.parse(Buffer.from(stateParam, "base64url").toString());
    userId = parsed.userId;
  } catch { return redirect(`${appBase}/#mail?gm_error=state`); }
  if (!userId) return redirect(`${appBase}/#mail?gm_error=state`);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.URL}/.netlify/functions/gmail-callback`;
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!clientId || !clientSecret || !serviceKey) return redirect(`${appBase}/#mail?gm_error=config`);

  // Verify userId is a real Supabase user
  const userCheck = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  if (!userCheck.ok) return redirect(`${appBase}/#mail?gm_error=user`);

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" })
  });

  const tokens = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokens.refresh_token) return redirect(`${appBase}/#mail?gm_error=token`);

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

  return redirect(`${appBase}/#mail?gm_connected=1`);
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
