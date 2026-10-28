// Shared server-side plumbing for Google Calendar sync (GOOGLE_CALENDAR_SYNC_DESIGN.md §4).
// Used by gcal-auth / gcal-callback / gcal-calendars / gcal-events.
//
// Storage: gcal_accounts + gcal_links (migrations/2026-10-12-gcal-accounts.sql) —
// small, isolated, service-role-only tables, never the hot tableplan_states rows.
// Every per-call DB touch here is a primary-key / indexed read of a few hundred bytes.

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const GCAL_SCOPE = "https://www.googleapis.com/auth/calendar";

function serviceKey() {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

function sbHeaders(key, extra = {}) {
  return { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json", ...extra };
}

async function sb(path, { method = "GET", body, prefer } = {}) {
  const key = serviceKey();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: sbHeaders(key, prefer ? { prefer } : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`supabase ${method} ${path.split("?")[0]} → ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: JSON.stringify(body) };
}

function bearer(event) {
  const h = event.headers?.authorization || event.headers?.Authorization || "";
  return h.replace(/^Bearer\s+/i, "").trim();
}

async function userIdFromRequest(event) {
  const token = bearer(event);
  const key = serviceKey();
  if (!token || !key) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id || null;
  } catch { return null; }
}

const { userGroupQuery } = require("./_group-lookup.js");

// ── Signed OAuth state ───────────────────────────────────────────────────────
// Same signed, expiring state as the Gmail flow (_oauth-state.js, SRV-1), under
// its own purpose so a Gmail state can never complete a Calendar connection.
const { createOAuthState, verifyOAuthState } = require("./_oauth-state");
const STATE_PURPOSE = "gcal-oauth-state-v1";

function signState(userId, { native = false, secret = serviceKey(), now } = {}) {
  return createOAuthState(userId, secret, { purpose: STATE_PURPOSE, native, ...(now ? { now } : {}) });
}

// Returns { userId, native } or null.
function verifyState(state, { secret = serviceKey(), now } = {}) {
  if (!secret) return null;
  return verifyOAuthState(state, secret, { purpose: STATE_PURPOSE, ...(now ? { now } : {}) });
}

function redirectUri() {
  return process.env.GCAL_REDIRECT_URI || `${(process.env.URL || "").replace(/\/$/, "")}/.netlify/functions/gcal-callback`;
}

function appBase() {
  return (process.env.APP_URL || process.env.URL || "").replace(/\/$/, "");
}

// ── Accounts & tokens ────────────────────────────────────────────────────────

async function loadAccount(userId) {
  const rows = await sb(`gcal_accounts?user_id=eq.${encodeURIComponent(userId)}&select=*`);
  return rows?.[0] || null;
}

async function saveAccount(userId, fields) {
  await sb("gcal_accounts?on_conflict=user_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: { user_id: userId, ...fields, updated_at: new Date().toISOString() }
  });
}

async function deleteAccount(userId) {
  await sb(`gcal_links?user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE", prefer: "return=minimal" });
  await sb(`gcal_accounts?user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE", prefer: "return=minimal" });
}

// Returns { token } or { invalidGrant: true } (account removed so the app shows
// "Reconnect") or { error }.
async function getAccessToken(account) {
  if (!account) return { error: "not connected" };
  const exp = account.expires_at ? Date.parse(account.expires_at) : 0;
  if (account.access_token && exp - Date.now() > 60_000) return { token: account.access_token };
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: account.refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      grant_type: "refresh_token"
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.error === "invalid_grant") {
      await deleteAccount(account.user_id).catch(() => {});
      return { invalidGrant: true };
    }
    return { error: `token refresh failed (${res.status})` };
  }
  await saveAccount(account.user_id, {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
  }).catch(() => {});
  return { token: data.access_token };
}

// ── Links ────────────────────────────────────────────────────────────────────

function toLink(row) {
  return { googleCalendarId: row.google_calendar_id, appCalendarId: row.app_calendar_id, enabled: row.enabled !== false, userId: row.user_id };
}

async function listLinks(userId) {
  const rows = await sb(`gcal_links?user_id=eq.${encodeURIComponent(userId)}&select=*`);
  return (rows || []).map(toLink);
}

const ID_RE = /^[\w.@#+\-]{1,200}$/;
function validLinkInput(l) {
  return Boolean(l) && typeof l.googleCalendarId === "string" && typeof l.appCalendarId === "string"
    && ID_RE.test(l.googleCalendarId) && /^[\w\-]{1,80}$/.test(l.appCalendarId);
}

// Insert proposed links; an existing (user, google calendar) row always wins, so
// two devices proposing at once converge on one app id.
async function insertLinks(userId, links) {
  const rows = (links || []).filter(validLinkInput).slice(0, 50).map((l) => ({
    user_id: userId, google_calendar_id: l.googleCalendarId, app_calendar_id: l.appCalendarId, enabled: true
  }));
  if (rows.length) {
    await sb("gcal_links?on_conflict=user_id,google_calendar_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: rows });
  }
  return listLinks(userId);
}

// Re-add a calendar the user removed earlier: it needs a FRESH app id, because the
// old one is tombstoned in synced state and would be filtered out forever.
async function relink(userId, link) {
  if (!validLinkInput(link)) throw new Error("invalid link");
  await sb("gcal_links?on_conflict=user_id,google_calendar_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: { user_id: userId, google_calendar_id: link.googleCalendarId, app_calendar_id: link.appCalendarId, enabled: true, updated_at: new Date().toISOString() }
  });
  return listLinks(userId);
}

async function disableLink(userId, appCalendarId) {
  if (!/^[\w\-]{1,80}$/.test(String(appCalendarId || ""))) throw new Error("invalid id");
  await sb(`gcal_links?user_id=eq.${encodeURIComponent(userId)}&app_calendar_id=eq.${encodeURIComponent(appCalendarId)}`, {
    method: "PATCH", prefer: "return=minimal", body: { enabled: false, updated_at: new Date().toISOString() }
  });
  return listLinks(userId);
}

async function linksForAppIds(appIds) {
  const ids = (appIds || []).filter((id) => /^[\w\-]{1,80}$/.test(String(id)));
  if (!ids.length) return [];
  const list = ids.map((id) => `"${id}"`).join(",");
  const rows = await sb(`gcal_links?app_calendar_id=in.(${encodeURIComponent(list)})&enabled=eq.true&select=*`);
  return (rows || []).map(toLink);
}

async function groupIdFor(userId) {
  const rows = await sb(userGroupQuery(userId));
  return rows?.[0]?.group_id || null;
}

// For each requested app calendar, pick the link to read through: the caller's
// own link first; otherwise a household member's (same live group) link.
// Pure; `groupOf` maps userId → group id (or null).
function chooseLinks(appIds, links, callerId, groupOf) {
  const callerGroup = groupOf(callerId);
  const out = {};
  for (const id of appIds) {
    const candidates = links.filter((l) => l.appCalendarId === id && l.enabled);
    const own = candidates.find((l) => l.userId === callerId);
    if (own) { out[id] = own; continue; }
    const shared = callerGroup ? candidates.find((l) => groupOf(l.userId) === callerGroup) : null;
    if (shared) out[id] = shared;
  }
  return out;
}

// ── Google API ───────────────────────────────────────────────────────────────

async function gApi(token, path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const res = await fetch(`https://www.googleapis.com/calendar/v3/${path}${qs.toString() ? `?${qs}` : ""}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Google ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function listGoogleCalendars(token) {
  const out = [];
  let pageToken;
  for (let i = 0; i < 5; i++) {
    const data = await gApi(token, "users/me/calendarList", { maxResults: 250, pageToken, fields: "items(id,summary,summaryOverride,accessRole,backgroundColor,primary,hidden,deleted),nextPageToken" });
    for (const c of data.items || []) {
      if (c.deleted) continue;
      out.push({ id: c.id, summary: c.summaryOverride || c.summary || c.id, accessRole: c.accessRole, color: c.backgroundColor || null, primary: Boolean(c.primary), hidden: Boolean(c.hidden) });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

// reminders + defaultReminders feed the app's own event reminders
// (IOS_NOTIFICATIONS_DESIGN.md §4): Google's per-user reminder settings for the
// token owner. Google → Netlify → device only; nothing reaches Supabase.
// location, htmlLink and the meeting's video link let the event detail open Maps,
// Google Calendar and Meet/Zoom (APP_LINKS_DESIGN.md). Device cache only.
const LIVE_FIELDS = "items(id,status,summary,location,htmlLink,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),start,end,recurringEventId,updated,reminders),defaultReminders,nextPageToken";
const MASTER_FIELDS = "items(id,status,summary,description,location,start,end,recurrence,recurringEventId,originalStartTime,created,updated,reminders,extendedProperties,attendees(self),hangoutLink,conferenceData(conferenceId),attachments(title)),nextPageToken";

// mode "live": expanded occurrences in [timeMin, timeMax), optionally only those
// changed since updatedMin. mode "masters": unexpanded series for the severance
// dry run (bounded to the last 2 years to stay inside the function time limit).
async function listGoogleEvents(token, googleCalendarId, { mode = "live", timeMin, timeMax, updatedMin } = {}) {
  const items = [];
  let pageToken;
  const maxPages = mode === "masters" ? 10 : 8;
  let truncated = false;
  let defaultReminders = null;
  for (let i = 0; i < maxPages; i++) {
    const params = mode === "masters"
      ? { singleEvents: "false", timeMin, maxResults: 2500, pageToken, fields: MASTER_FIELDS }
      : { singleEvents: "true", timeMin, timeMax, updatedMin, showDeleted: updatedMin ? "true" : undefined, maxResults: 2500, pageToken, fields: LIVE_FIELDS };
    const data = await gApi(token, `calendars/${encodeURIComponent(googleCalendarId)}/events`, params);
    items.push(...(data.items || []));
    if (Array.isArray(data.defaultReminders)) defaultReminders = data.defaultReminders;
    pageToken = data.nextPageToken;
    if (!pageToken) break;
    if (i === maxPages - 1) truncated = true;
  }
  return { items, truncated, defaultReminders: mode === "live" ? (defaultReminders || []) : undefined };
}

module.exports = {
  SUPABASE_URL, GCAL_SCOPE, json, sb, userIdFromRequest, signState, verifyState, redirectUri, appBase,
  loadAccount, saveAccount, deleteAccount, getAccessToken,
  listLinks, insertLinks, relink, disableLink, linksForAppIds, groupIdFor, chooseLinks, validLinkInput,
  gApi, listGoogleCalendars, listGoogleEvents
};
