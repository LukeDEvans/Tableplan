const { createOAuthState } = require("./_oauth-state");

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return json(401, { error: "Not authenticated." });

  const userId = await getUserId(accessToken, serviceKey);
  if (!userId) return json(401, { error: "Invalid session." });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return json(503, { error: "GOOGLE_CLIENT_ID not configured." });

  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.URL}/.netlify/functions/gmail-callback`;

  if (!serviceKey) return json(503, { error: "SUPABASE_SERVICE_ROLE_KEY not configured." });

  // Signed, expiring state (SRV-1): the callback trusts userId only after
  // verifying the HMAC, so it can't be forged to hijack another user's link.
  // ?client=ios: started from the iPhone app's sign-in sheet — the callback
  // returns to the app (NATIVE_RETURN in gmail-callback) instead of the site.
  const native = (event.queryStringParameters || {}).client === "ios";
  const state = createOAuthState(userId, serviceKey, { native });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
      // Lets the app create/manage Gmail filters (e.g. auto-filing statements).
      "https://www.googleapis.com/auth/gmail.settings.basic",
      "email",
      "profile"
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return json(200, { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
};

async function getUserId(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user.id || null;
  } catch { return null; }
}

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}
