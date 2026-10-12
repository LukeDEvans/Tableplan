// Google Calendar connection status, calendar list and app↔Google links.
//   GET  → { connected, email, calendars:[{id,summary,accessRole,color,primary}], links:[…] }
//   POST { action: "link", links:[{googleCalendarId, appCalendarId}] }   propose links (existing rows win)
//   POST { action: "relink", googleCalendarId, appCalendarId }           re-add a removed calendar (fresh app id)
//   POST { action: "unlink", appCalendarId }                             user removed it from the app
//   POST { action: "disconnect" }                                         revoke + forget everything
// Called on app open (throttled client-side to ~hourly) and when Settings opens.
const g = require("./_gcal");

function publicLinks(links) {
  return links.map(({ googleCalendarId, appCalendarId, enabled }) => ({ googleCalendarId, appCalendarId, enabled }));
}

exports.handler = async (event) => {
  const userId = await g.userIdFromRequest(event);
  if (!userId) return g.json(401, { error: "Not authenticated." });

  try {
    if (event.httpMethod === "GET") {
      const account = await g.loadAccount(userId);
      if (!account) return g.json(200, { connected: false });
      const tok = await g.getAccessToken(account);
      if (tok.invalidGrant) return g.json(200, { connected: false, reconnect: true });
      if (!tok.token) return g.json(502, { error: tok.error || "Google token unavailable." });
      const [calendars, links] = await Promise.all([g.listGoogleCalendars(tok.token), g.listLinks(userId)]);
      return g.json(200, { connected: true, email: account.google_email || "", calendars, links: publicLinks(links) });
    }

    if (event.httpMethod !== "POST") return g.json(405, { error: "Method not allowed" });
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { return g.json(400, { error: "Bad JSON" }); }

    if (body.action === "disconnect") {
      const account = await g.loadAccount(userId);
      if (account?.refresh_token) {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(account.refresh_token)}`, { method: "POST" }).catch(() => {});
      }
      await g.deleteAccount(userId);
      return g.json(200, { connected: false });
    }

    const account = await g.loadAccount(userId);
    if (!account) return g.json(409, { error: "Google Calendar is not connected." });

    if (body.action === "link") return g.json(200, { links: publicLinks(await g.insertLinks(userId, body.links)) });
    if (body.action === "relink") return g.json(200, { links: publicLinks(await g.relink(userId, body)) });
    if (body.action === "unlink") return g.json(200, { links: publicLinks(await g.disableLink(userId, body.appCalendarId)) });
    return g.json(400, { error: "Unknown action" });
  } catch (e) {
    console.error("gcal-calendars:", e.message);
    return g.json(500, { error: "Google Calendar request failed." });
  }
};
