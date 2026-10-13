// Client side of Google Calendar sync (GOOGLE_CALENDAR_SYNC_DESIGN.md §5).
// Network calls to the gcal-* Netlify functions, the per-device raw-event cache,
// and the pure reconciliation of server links onto state.calendars entries.
// app.js owns the glue (when to call these, persist, re-render); nothing here
// touches app state directly.
//
// Where things live:
//   • gcal_links (server) is the AUTHORITY for which app calendar ↔ Google calendar.
//     state.calendars entries carry googleCalendarId only as a cache/hint — older
//     deployed clients strip unknown fields on re-save, and reconcileGoogleLinks
//     re-applies them on the next status fetch.
//   • Google events are never written to synced state: they live in this device's
//     localStorage cache (raw events per app calendar) and are flattened into the
//     existing "linked" cache that every reader already consumes.

import { applyGoogleEvents, storeToCacheEntries, appCalendarIdForGoogle, googleEventToFeedEvent } from "./google.js";

export const GCAL_CACHE_KEY = "live-gcal-cache-v1";
const FULL_REFRESH_MS = 24 * 3600 * 1000; // re-pull the whole window daily (window drift)
const DELTA_OVERLAP_MS = 2 * 60 * 1000;   // updatedMin overlap so nothing slips between calls

async function call(path, token, { method = "GET", body } = {}) {
  const res = await fetch(`/.netlify/functions/${path}`, {
    method,
    cache: "no-store",
    headers: { authorization: `Bearer ${token || ""}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Google Calendar request failed (${res.status})`);
  return data;
}

export const gcalApi = {
  status: (token) => call("gcal-calendars", token),
  action: (token, body) => call("gcal-calendars", token, { method: "POST", body }),
  authUrl: (token, { native = false } = {}) => call(native ? "gcal-auth?client=ios" : "gcal-auth", token),
  events: (token, body) => call("gcal-events", token, { method: "POST", body })
};

// ── Device cache ──────────────────────────────────────────────────────────────

export function loadGcalCache(storage = globalThis.localStorage) {
  try { return JSON.parse(storage?.getItem(GCAL_CACHE_KEY) || "{}") || {}; } catch { return {}; }
}

export function saveGcalCache(cache, storage = globalThis.localStorage) {
  try { storage?.setItem(GCAL_CACHE_KEY, JSON.stringify(cache)); } catch { /* quota */ }
}

// Build the gcal-events request for a set of API calendars: a delta (updatedMin)
// when this device has a recent full pull, otherwise a full window.
// A store pulled before reminders were fetched (no `rv`) gets one full re-pull so
// its events carry reminders; if the server is older and still omits them, the
// attempt is remembered (rvTriedAt) and retried at most daily, never every refresh.
const REMINDERS_VERSION = 1;
function hasReminders(c, now) {
  return c?.rv === REMINDERS_VERSION || (c?.rvTriedAt && now - Date.parse(c.rvTriedAt) < FULL_REFRESH_MS);
}

export function buildEventsRequest(apiCalendars, cache, { now = Date.now(), force = false } = {}) {
  return {
    mode: "live",
    timeMin: new Date(now - 60 * 86400000).toISOString(),
    timeMax: new Date(now + 400 * 86400000).toISOString(),
    calendars: apiCalendars.map((cal) => {
      const c = cache[cal.id];
      const fresh = !force && c?.fullAt && now - Date.parse(c.fullAt) < FULL_REFRESH_MS && c.fetchedAt && hasReminders(c, now);
      return fresh
        ? { appCalendarId: cal.id, updatedMin: new Date(Date.parse(c.fetchedAt) - DELTA_OVERLAP_MS).toISOString() }
        : { appCalendarId: cal.id };
    })
  };
}

// Fold a gcal-events response into the cache. Returns { cache, unavailable } where
// unavailable maps app calendar id → reason (caller may fall back to iCal).
// Calendars no longer requested are pruned so the cache can't grow unbounded.
export function applyEventsResponse(cache, response, apiCalendarIds) {
  const next = {};
  const unavailable = {};
  for (const id of apiCalendarIds) {
    const r = response?.results?.[id];
    if (r?.status === "ok") {
      const prev = cache[id] || {};
      const store = applyGoogleEvents(prev, r.items, { full: r.full });
      // Reminder metadata (IOS_NOTIFICATIONS_DESIGN.md §4): whose reminders these
      // are and the calendar's default reminders. A delta from an older server
      // omits them, so keep the previous values rather than wiping them.
      const sent = Array.isArray(r.defaultReminders);
      const meta = {
        own: typeof r.own === "boolean" ? r.own : (prev.own ?? false),
        defaultReminders: sent ? r.defaultReminders : (prev.defaultReminders || []),
        ...(r.full ? { rvTriedAt: r.fetchedAt } : (prev.rvTriedAt ? { rvTriedAt: prev.rvTriedAt } : {})),
        ...((r.full && sent) || (!r.full && prev.rv === REMINDERS_VERSION) ? { rv: REMINDERS_VERSION } : {})
      };
      next[id] = { ...store, ...meta, fetchedAt: r.fetchedAt, fullAt: r.full ? r.fetchedAt : (prev.fullAt || r.fetchedAt), truncated: Boolean(r.truncated) };
    } else {
      if (cache[id]) next[id] = cache[id];
      unavailable[id] = r?.reason || "no-response";
    }
  }
  return { cache: next, unavailable };
}

export function cacheEntriesFor(apiCalendars, cache) {
  return apiCalendars.flatMap((cal) => storeToCacheEntries(cache[cal.id], { id: cal.id, name: cal.name, color: cal.color }));
}

// ── Links → state.calendars ───────────────────────────────────────────────────

// Re-apply the server's links to the linked-calendar list.
//   calendars:      state.calendars (normalized)
//   links:          [{ googleCalendarId, appCalendarId, enabled }] from the server
//   googleCalendars:[{ id, summary, color }] from calendarList (for names/colours)
//   tombstoned:     Set of app calendar ids deleted on any device
// Returns { calendars, changed, unlink } — `unlink` lists app ids the user deleted
// in the app whose server link is still enabled (tell the server so automatic
// discovery never brings them back).
export function reconcileGoogleLinks(calendars, links, googleCalendars, tombstoned = new Set(), { colorFor = (c) => c } = {}) {
  const byGoogleId = new Map((googleCalendars || []).map((c) => [c.id, c]));
  let changed = false;
  const unlink = [];
  const out = (calendars || []).map((c) => ({ ...c }));
  for (const link of links || []) {
    const entry = out.find((c) => c.id === link.appCalendarId);
    if (!link.enabled) continue;
    if (tombstoned.has(link.appCalendarId)) { unlink.push(link.appCalendarId); continue; }
    if (entry) {
      if (entry.googleCalendarId !== link.googleCalendarId) { entry.googleCalendarId = link.googleCalendarId; changed = true; }
      continue;
    }
    const g = byGoogleId.get(link.googleCalendarId);
    if (!g) continue; // calendar no longer visible to this account — don't add a dead entry
    out.push({ id: link.appCalendarId, name: g.summary || "Google Calendar", url: "", color: colorFor(g.color, out.length), enabled: true, googleCalendarId: link.googleCalendarId });
    changed = true;
  }
  return { calendars: out, changed, unlink };
}

// Fresh app id for re-adding a calendar the user removed earlier (the old id is
// tombstoned in synced state, so it can't be reused).
export function readdAppCalendarId(googleCalendarId, now = Date.now()) {
  return appCalendarIdForGoogle(googleCalendarId, `readd-${now.toString(36)}`);
}

// Rows for the Settings panel: each Google calendar with whether it's in the app.
export function panelRows(googleCalendars, links, calendars) {
  const appIds = new Set((calendars || []).map((c) => c.id));
  return (googleCalendars || []).map((g) => {
    const link = (links || []).find((l) => l.googleCalendarId === g.id);
    const inApp = Boolean(link?.enabled && appIds.has(link.appCalendarId));
    return { id: g.id, name: g.summary || g.id, color: g.color, accessRole: g.accessRole, primary: g.primary, inApp, link: link || null };
  }).sort((a, b) => (b.primary - a.primary) || (b.inApp - a.inApp) || a.name.localeCompare(b.name));
}

// A Google-backed calendar's events as feed events for the meal-plan share
// (calendar/meal-plan-share.js), or null when this device holds no copy yet.
export function feedEventsFor(calendar, cache) {
  const store = cache?.[calendar?.id];
  if (!store?.events) return null;
  return Object.values(store.events).map(googleEventToFeedEvent).filter(Boolean);
}
