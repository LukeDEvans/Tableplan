// Events for Google-backed app calendars (GOOGLE_CALENDAR_SYNC_DESIGN.md §4).
//   POST { mode: "live" | "masters", calendars: [{ appCalendarId, updatedMin? }], timeMin?, timeMax? }
//   → { results: { [appCalendarId]: { status: "ok", full, items, fetchedAt, truncated } | { status: "unavailable", reason } } }
//
// Reads go through the caller's own link, or — for a household calendar another
// member connected — through that member's link when both are in the same live
// group. Event data flows Google → this function → device; nothing is written to
// Supabase, so refreshing costs only two tiny indexed reads.
const g = require("./_gcal");

const MAX_CALENDARS = 30;
const DAY = 86400000;

function isoOrNull(v) {
  const t = Date.parse(v || "");
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return g.json(405, { error: "Method not allowed" });
  const userId = await g.userIdFromRequest(event);
  if (!userId) return g.json(401, { error: "Not authenticated." });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return g.json(400, { error: "Bad JSON" }); }

  const mode = body.mode === "masters" ? "masters" : "live";
  const requested = (Array.isArray(body.calendars) ? body.calendars : []).slice(0, MAX_CALENDARS)
    .filter((c) => c && /^[\w\-]{1,80}$/.test(String(c.appCalendarId || "")));
  if (!requested.length) return g.json(200, { results: {} });

  const now = Date.now();
  const timeMin = mode === "masters" ? new Date(now - 730 * DAY).toISOString() : (isoOrNull(body.timeMin) || new Date(now - 60 * DAY).toISOString());
  const timeMax = mode === "masters" ? undefined : (isoOrNull(body.timeMax) || new Date(now + 400 * DAY).toISOString());

  try {
    const appIds = requested.map((c) => c.appCalendarId);
    const links = await g.linksForAppIds(appIds);
    const userIds = [...new Set([userId, ...links.map((l) => l.userId)])];
    const groups = new Map(await Promise.all(userIds.map(async (u) => [u, await g.groupIdFor(u).catch(() => null)])));
    const chosen = g.chooseLinks(appIds, links, userId, (u) => groups.get(u) || null);

    const tokens = new Map(); // owner userId → Promise<{token}|…>
    const tokenFor = (owner) => {
      if (!tokens.has(owner)) tokens.set(owner, g.loadAccount(owner).then((acct) => g.getAccessToken(acct)));
      return tokens.get(owner);
    };

    const results = {};
    await Promise.all(requested.map(async (req) => {
      const link = chosen[req.appCalendarId];
      if (!link) { results[req.appCalendarId] = { status: "unavailable", reason: "not-linked" }; return; }
      const tok = await tokenFor(link.userId);
      if (!tok?.token) { results[req.appCalendarId] = { status: "unavailable", reason: tok?.invalidGrant ? "reconnect" : "token" }; return; }
      const updatedMin = mode === "live" ? isoOrNull(req.updatedMin) : null;
      const fetchedAt = new Date().toISOString();
      try {
        const { items, truncated } = await g.listGoogleEvents(tok.token, link.googleCalendarId, { mode, timeMin, timeMax, updatedMin });
        results[req.appCalendarId] = { status: "ok", full: !updatedMin, items, fetchedAt, truncated };
      } catch (e) {
        if (updatedMin && (e.status === 410 || e.status === 400)) {
          // Delta window rejected → fall back to a full refetch of the window.
          try {
            const { items, truncated } = await g.listGoogleEvents(tok.token, link.googleCalendarId, { mode, timeMin, timeMax });
            results[req.appCalendarId] = { status: "ok", full: true, items, fetchedAt, truncated };
            return;
          } catch (e2) { e = e2; }
        }
        results[req.appCalendarId] = { status: "unavailable", reason: e.status === 404 || e.status === 403 ? "no-access" : "google-error" };
      }
    }));
    return g.json(200, { results });
  } catch (e) {
    console.error("gcal-events:", e.message);
    return g.json(500, { error: "Google Calendar request failed." });
  }
};
