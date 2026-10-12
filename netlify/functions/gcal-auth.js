// Starts the Google Calendar connection (GOOGLE_CALENDAR_SYNC_DESIGN.md §4).
// Separate from the Gmail connection on purpose: disconnecting one never affects
// the other. Returns the Google consent URL; the browser navigates to it.
const { json, userIdFromRequest, signState, redirectUri, GCAL_SCOPE } = require("./_gcal");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  const userId = await userIdFromRequest(event);
  if (!userId) return json(401, { error: "Not authenticated." });
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  if (!clientId) return json(503, { error: "GOOGLE_CLIENT_ID not configured." });

  let state;
  try { state = signState({ u: userId }); } catch { return json(503, { error: "OAuth state secret not configured." }); }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: [GCAL_SCOPE, "email"].join(" "),
    access_type: "offline",
    prompt: "consent",
    state
  });
  return json(200, { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
};
