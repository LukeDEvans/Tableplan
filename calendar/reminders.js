// Event reminders — pure core (IOS_NOTIFICATIONS_DESIGN.md §4–5).
//
// Reminders are PER PERSON: a reminder goes only to the user who asked for it.
// The user's choices live in their own live_notification_prefs row (see
// calendar/reminder-prefs.js), never on the shared planEvents entries:
//
//   prefs = { "<planEventId>": { min: 30 } | { off: true },
//             "gcal:<appCalendarId>:<googleSeriesId>": { min: 10 } | { off: true } }
//
// Sources, per user:
//   • local plan events — the user's own entry for the event id;
//   • Google events — the user's app-side entry if any, else Google's own reminder
//     for that user (only on calendars read with the user's own token: `own`);
//   • the old shared planEvents[].reminder field — folded once into the household
//     admin's prefs (legacyReminderFolds); {off:true} is a tombstone, so a reminder
//     turned off in the new UI can never be folded back in.
//
// Everything here is pure: callers pass events, Google caches, prefs and `now`.
// The output feeds both the iPhone's local notifications (reminders-native.js) and
// the in-app minute tick on the web.

import { eventInstancesInRange } from "./projection.js";
import { googleEventStart, googleReminderMinutes } from "./google.js";

export const REMINDER_HORIZON_DAYS = 14;
export const MAX_SCHEDULED_REMINDERS = 50; // iOS keeps 64 pending; leave slack
export const MAX_REMINDER_MINUTES = 40320; // 4 weeks — Google's own limit

const MINUTE = 60000;
const DAY = 86400000;

function pad2(n) { return String(n).padStart(2, "0"); }
function dateKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function isDateKey(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v); }
function isTime(v) { return typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v); }

// Local wall-clock instant for a date key + "HH:MM" (or midnight).
function localInstant(key, time) {
  const [y, m, d] = key.split("-").map(Number);
  const [hh, mm] = time ? time.split(":").map(Number) : [0, 0];
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

// ── Keys & values ─────────────────────────────────────────────────────────────

export function googleReminderKey(appCalendarId, googleSeriesId) {
  return `gcal:${appCalendarId}:${googleSeriesId}`;
}

export function isValidReminderMinutes(m) {
  return Number.isInteger(m) && m >= 0 && m <= MAX_REMINDER_MINUTES;
}

// One stored value → { min } | { off: true } | null (unusable).
export function normalizeReminderValue(v) {
  if (v && typeof v === "object") {
    if (v.off === true) return { off: true };
    const min = Number(v.min);
    if (isValidReminderMinutes(min)) return { min };
  }
  return null;
}

export function normalizeReminderPrefs(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, v] of Object.entries(raw)) {
    if (!key || key.length > 300) continue;
    const val = normalizeReminderValue(v);
    if (val) out[key] = val;
  }
  return out;
}

// The editor's select value ("" = no reminder, else minutes) → a stored value.
export function reminderValueFromSelect(raw) {
  if (raw === "" || raw == null) return { off: true };
  const min = Number(raw);
  return isValidReminderMinutes(min) ? { min } : { off: true };
}

// A stored value → the editor's select value.
export function reminderSelectValue(v) {
  const val = normalizeReminderValue(v);
  return val && "min" in val ? String(val.min) : "";
}

// The legacy shared field on events → entries to fold into the admin's prefs.
// Only events with a valid legacy reminder and NO entry yet (a tombstone counts as
// an entry, so a turned-off reminder stays off).
export function legacyReminderFolds(planEvents, prefs) {
  const out = {};
  for (const e of planEvents || []) {
    if (!e?.id || e.id in (prefs || {}) || e.id in out) continue;
    const min = Number(e.reminder);
    if (e.reminder != null && isValidReminderMinutes(min)) out[e.id] = { min };
  }
  return out;
}

// ── Human text ────────────────────────────────────────────────────────────────

export function reminderLeadText(min) {
  if (min === 0) return "starting now";
  if (min < 60) return `in ${min} min`;
  if (min % 1440 === 0) return min === 1440 ? "tomorrow" : `in ${min / 1440} days`;
  if (min % 60 === 0) return min === 60 ? "in 1 hour" : `in ${min / 60} hours`;
  return `in ${Math.floor(min / 60)} hr ${min % 60} min`;
}

export function reminderDescription(min) {
  if (min === 0) return "At time of event";
  if (min < 60) return `${min} minutes before`;
  if (min % 1440 === 0) return min === 1440 ? "1 day before" : `${min / 1440} days before`;
  if (min % 60 === 0) return min === 60 ? "1 hour before" : `${min / 60} hours before`;
  return `${min} minutes before`;
}

// ── Notification ids ──────────────────────────────────────────────────────────

// Stable positive 31-bit id (iOS/Capacitor needs an integer). Derived from the
// reminder's identity AND its content, so a changed time or title yields a new id:
// the scheduler then cancels the old notification and adds the new one.
export function notificationId(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 1) || 1;
}

// ── Instances ─────────────────────────────────────────────────────────────────

// Every reminder this user should get whose fire time falls in (now, now+horizon],
// nearest first, capped at `max`.
//   planEvents:   this user's visible local events (both scopes; de-duplicated here)
//   googleStores: [{ appCalendarId, calendarName, own, defaultReminders, events: { [gid]: raw } }]
//   prefs:        the user's normalized reminder prefs (legacy folds already merged)
//   formatTime:   "HH:MM" → display text (the app's planFormatTime)
// Each instance: { key, id, fireAt, title, body, kind, eventId, date, calendarId, minutes }
export function reminderInstances({ planEvents = [], googleStores = [], prefs = {}, now = Date.now(), formatTime = (t) => t, horizonDays = REMINDER_HORIZON_DAYS, max = MAX_SCHEDULED_REMINDERS } = {}) {
  const until = now + horizonDays * DAY;
  const todayKey = dateKey(new Date(now));
  const out = [];
  const push = ({ key, fireAt, title, startTime, allDay, minutes, kind, eventId, date, calendarId, calendarName }) => {
    if (!(fireAt > now && fireAt <= until)) return;
    const when = allDay ? "All day" : formatTime(startTime);
    const body = [when, reminderLeadText(minutes), calendarName].filter(Boolean).join(" · ");
    out.push({ key, id: notificationId(`${key}|${fireAt}|${title}|${body}`), fireAt, title, body, kind, eventId, date, calendarId: calendarId || null, minutes });
  };

  // Local plan events: the user's own choice only. Timed events, start day only.
  const seen = new Set();
  for (const e of planEvents) {
    if (!e?.id || seen.has(e.id)) continue;
    seen.add(e.id);
    if (e.allDay || !isTime(e.startTime) || !isDateKey(e.date)) continue;
    const pref = normalizeReminderValue(prefs[e.id]);
    if (!pref || pref.off) continue;
    const endKey = dateKey(new Date(until + pref.min * MINUTE + DAY));
    for (const inst of eventInstancesInRange(e, todayKey, endKey)) {
      if (inst.spanPos && inst.spanPos !== "start") continue;
      const startAt = localInstant(inst.date, e.startTime);
      push({ key: `${e.id}:${inst.date}`, fireAt: startAt - pref.min * MINUTE, title: String(e.title || "Event"), startTime: e.startTime, allDay: false, minutes: pref.min, kind: "local", eventId: e.id, date: inst.date, calendarId: e.calendarId });
    }
  }

  // Google events (already expanded to instances by the API).
  for (const store of googleStores) {
    if (!store?.appCalendarId) continue;
    for (const raw of Object.values(store.events || {})) {
      if (!raw?.id || raw.status === "cancelled") continue;
      const start = googleEventStart(raw);
      if (!start) continue;
      const seriesId = raw.recurringEventId || raw.id;
      const pref = normalizeReminderValue(prefs[googleReminderKey(store.appCalendarId, seriesId)]);
      if (pref?.off) continue;
      const minutes = pref ? [pref.min] : (store.own ? googleReminderMinutes(raw, store.defaultReminders || [], { allDay: start.allDay }) : []);
      const startAt = localInstant(start.date, start.allDay ? null : start.time);
      for (const min of minutes) {
        push({ key: `g:${store.appCalendarId}:${raw.id}:${min}`, fireAt: startAt - min * MINUTE, title: String(raw.summary || "").trim() || "(No title)", startTime: start.time, allDay: start.allDay, minutes: min, kind: "google", eventId: raw.id, date: start.date, calendarId: store.appCalendarId, calendarName: store.calendarName || "" });
      }
    }
  }

  out.sort((a, b) => a.fireAt - b.fireAt || a.key.localeCompare(b.key));
  return out.slice(0, max);
}

// What to change on the device: notifications to add, and pending ids to cancel.
// Anything pending that isn't wanted is cancelled — reminders are the only thing
// this app schedules locally.
export function diffSchedule(wanted, pendingIds) {
  const pending = new Set((pendingIds || []).map(Number));
  const wantedIds = new Set(wanted.map((w) => w.id));
  return {
    add: wanted.filter((w) => !pending.has(w.id)),
    cancel: [...pending].filter((id) => !wantedIds.has(id))
  };
}

// Instances firing in [fromMs, toMs) — the in-app minute tick.
export function dueReminders(instances, fromMs, toMs) {
  return (instances || []).filter((r) => r.fireAt >= fromMs && r.fireAt < toMs);
}
