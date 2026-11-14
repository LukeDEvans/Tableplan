// Starts the Google Calendar connection (GOOGLE_CALENDAR_SYNC_DESIGN.md §4).
// Separate from the Gmail connection on purpose: disconnecting one never affects
// the other. Returns the Google consent URL. ?client=ios marks a flow started from
// the iPhone app's sign-in sheet, so the callback returns to the app.
const { json, userIdFromRequest, signState, redirectUri, GCAL_SCOPE, DOCS_SCOPES } = require("./_gcal");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });
  const userId = await userIdFromRequest(event);
  if (!userId) return json(401, { error: "Not authenticated." });
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  if (!clientId) return json(503, { error: "GOOGLE_CLIENT_ID not configured." });

  const native = (event.queryStringParameters || {}).client === "ios";
  // ?docs=1: also read-only Drive and Docs, for bringing Google Docs into Document
  // (WORD_PROCESSOR_DESIGN.md §9). The calendar scope stays in the same consent.
  const docs = (event.queryStringParameters || {}).docs === "1";
  let state;
  try { state = signState(userId, { native }); } catch { return json(503, { error: "OAuth state signing not configured." }); }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: [GCAL_SCOPE, "email", ...(docs ? DOCS_SCOPES : [])].join(" "),
    include_granted_scopes: "true",
    access_type: "offline",
    prompt: "consent",
    state
  });
  return json(200, { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
};
