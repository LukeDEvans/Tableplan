// Google Calendar ↔ canonical calendar model — pure, dependency-free (except the
// recurrence normalizer). GOOGLE_CALENDAR_SYNC_DESIGN.md §4, §9.
//
// Three jobs:
//   1. LIVE DISPLAY: turn compact Google events (as returned by the gcal-events
//      Netlify function, singleEvents=true) into the flat "linked" cache entries
//      the existing readers already consume (syncedCalendarEventsForDate etc.),
//      now WITH real start/end times.
//   2. LINKING: recognise which Google calendar a legacy secret-iCal URL points at
//      (in-place migration), and mint a deterministic app calendar id for a newly
//      discovered Google calendar (so two devices discovering it at once agree).
//   3. SEVERANCE: convert unexpanded Google events (series masters + RRULEs +
//      exception instances) into app planEvents, and report — without writing
//      anything — what would import cleanly and what would degrade (§9 dry run).
//
// No app state, no IO, no DOM. Dates are interpreted in the runtime's local zone,
// which is how the app stores event times ("YYYY-MM-DD" + "HH:MM", local).

import { normalizeRecurrence, planNthOccurrenceDate } from "./recurrence.js";

// ── Small date helpers (local time) ────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, "0"); }

function localDateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function localTime(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function addDaysKey(key, n) {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localDateKey(d);
}

function isDateKey(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v); }

// A Google start/end object → { allDay, date, time } in local terms.
function readGoogleTime(t) {
  if (t && isDateKey(t.date)) return { allDay: true, date: t.date, time: null };
  if (t && t.dateTime) {
    const d = new Date(t.dateTime);
    if (!Number.isNaN(d.getTime())) return { allDay: false, date: localDateKey(d), time: localTime(d) };
  }
  return null;
}

// ── 2. Linking ────────────────────────────────────────────────────────────────

// The calendar id embedded in a Google secret/public iCal URL:
//   https://calendar.google.com/calendar/ical/<url-encoded id>/private-…/basic.ics
// Returns "" when the URL isn't a Google iCal URL.
export function googleCalendarIdFromIcalUrl(url) {
  try {
    const u = new URL(String(url || "").trim());
    if (!["calendar.google.com", "www.google.com"].includes(u.hostname)) return "";
    const m = u.pathname.match(/\/calendar\/ical\/([^/]+)\//);
    return m ? decodeURIComponent(m[1]).trim() : "";
  } catch { return ""; }
}

// FNV-1a 32-bit, twice with different seeds → 16 hex chars. Deterministic and
// sync (no WebCrypto), so every device mints the same app id for the same Google
// calendar without coordinating.
function fnv1a(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function appCalendarIdForGoogle(googleCalendarId, salt = "") {
  const key = `${String(googleCalendarId || "")}|${salt}`;
  return `gcal-${fnv1a(key, 0x811c9dc5)}${fnv1a(key, 0x01000193)}`;
}

// Which Google calendars are added to the app automatically. Calendars the user
// owns or can edit are "theirs" (incl. a spouse's calendar shared with edit
// rights); read-only subscriptions (holidays, contacts' birthdays, other people's
// view-only calendars) are only added by hand from Settings.
export function isAutoLinkCandidate(cal) {
  return cal?.accessRole === "owner" || cal?.accessRole === "writer";
}

// Decide which links to propose to the server for a freshly-fetched calendar list.
//   googleCalendars: [{ id, summary, accessRole, … }] from calendarList
//   links:           [{ googleCalendarId, appCalendarId, enabled }] already on the server
//   linkedCalendars: state.calendars (app entries; legacy ones carry an iCal `url`)
// Returns [{ googleCalendarId, appCalendarId, reason: "ical-match" | "auto" }].
// A legacy iCal entry is ALWAYS matched (even read-only) so its app id is kept;
// a calendar with any existing link row (enabled or not) is never re-proposed.
export function proposeGoogleLinks(googleCalendars, links, linkedCalendars) {
  const known = new Set((links || []).map((l) => l.googleCalendarId));
  const usedAppIds = new Set((links || []).map((l) => l.appCalendarId));
  const out = [];
  for (const cal of googleCalendars || []) {
    if (!cal?.id || known.has(cal.id)) continue;
    const legacy = (linkedCalendars || []).find((c) => c?.url && googleCalendarIdFromIcalUrl(c.url) === cal.id && !usedAppIds.has(c.id));
    if (legacy) {
      out.push({ googleCalendarId: cal.id, appCalendarId: legacy.id, reason: "ical-match" });
      usedAppIds.add(legacy.id);
    } else if (isAutoLinkCandidate(cal)) {
      out.push({ googleCalendarId: cal.id, appCalendarId: appCalendarIdForGoogle(cal.id), reason: "auto" });
    }
  }
  return out;
}

// ── 1. Live display ───────────────────────────────────────────────────────────

const MAX_ALL_DAY_SPAN = 62; // days; guards a mis-entered year-long event

// One compact Google event → zero or more linked-cache entries (one per day for a
// multi-day all-day event, matching how syncedCalendarEventsForDate matches by
// `date`). Cancelled events produce none.
export function googleEventToCacheEntries(raw, cal) {
  if (!raw || raw.status === "cancelled") return [];
  const start = readGoogleTime(raw.start);
  if (!start) return [];
  const end = readGoogleTime(raw.end);
  const base = {
    summary: String(raw.summary || "").trim() || "(No title)",
    monthDay: "",
    recursYearly: false,
    allDay: start.allDay,
    startTime: start.allDay ? null : start.time,
    endTime: null,
    endDate: null,
    gid: String(raw.id || ""),
    source: "google-api",
    calendarId: cal?.id || "",
    calendarName: cal?.name || "",
    calendarColor: cal?.color || ""
  };
  if (start.allDay) {
    // Google's all-day end date is EXCLUSIVE.
    const lastDay = end?.allDay && end.date > start.date ? addDaysKey(end.date, -1) : start.date;
    const entries = [];
    let key = start.date;
    for (let i = 0; i < MAX_ALL_DAY_SPAN && key <= lastDay; i++) {
      entries.push({ ...base, date: key, endDate: lastDay !== start.date ? lastDay : null });
      key = addDaysKey(key, 1);
    }
    return entries;
  }
  // Timed: shown on its start day. An end on the same local day becomes endTime;
  // an overnight end keeps endDate so detail views can say so.
  const sameDay = end && !end.allDay && end.date === start.date;
  return [{
    ...base,
    date: start.date,
    endTime: sameDay ? end.time : null,
    endDate: end && !end.allDay && end.date !== start.date ? end.date : null
  }];
}

// One compact Google event → the feed-event shape the meal-plan share reads
// (same fields the ICS parser produces), kept as ONE event with an inclusive
// endDate rather than split per day. null for cancelled / start-less events.
export function googleEventToFeedEvent(raw) {
  if (!raw?.id || raw.status === "cancelled") return null;
  const start = readGoogleTime(raw.start);
  if (!start) return null;
  const end = readGoogleTime(raw.end);
  let endDate = null;
  if (start.allDay && end?.allDay && end.date > start.date) {
    const last = addDaysKey(end.date, -1);
    if (last !== start.date) endDate = last;
  } else if (!start.allDay && end && !end.allDay && end.date !== start.date) {
    endDate = end.date;
  }
  return {
    uid: String(raw.id),
    title: String(raw.summary || "").trim() || "(No title)",
    date: start.date,
    allDay: start.allDay,
    startTime: start.allDay ? null : start.time,
    endTime: start.allDay || !end || end.allDay ? null : end.time,
    endDate
  };
}

// Apply a gcal-events response to one calendar's raw-event store.
//   store: { events: { [googleEventId]: compactRaw } }
//   full=true replaces everything; otherwise items are an updatedMin delta, where
//   cancelled items delete. Returns a NEW store (inputs untouched).
export function applyGoogleEvents(store, items, { full = false } = {}) {
  const events = full ? {} : { ...(store?.events || {}) };
  for (const it of items || []) {
    if (!it?.id) continue;
    if (it.status === "cancelled") delete events[it.id];
    else events[it.id] = it;
  }
  return { events };
}

// Flatten a store into cache entries for one app calendar.
export function storeToCacheEntries(store, cal) {
  return Object.values(store?.events || {}).flatMap((raw) => googleEventToCacheEntries(raw, cal));
}

// ── App-only fields carried on Google events (Phase 2 writes, severance reads) ─
// Kept in extendedProperties.private so they're invisible in Google's UI but
// survive a round trip. Values must be strings (Google's constraint).

export function toGooglePrivateProps(ev) {
  const p = {};
  if (ev?.id) p.tpEventId = String(ev.id);
  if (ev?.showInMealPlan) p.tpShowInMealPlan = "1";
  if (ev?.addToDo) p.tpAddToDo = "1";
  if (Array.isArray(ev?.chores) && ev.chores.length) p.tpChores = JSON.stringify(ev.chores);
  if (ev?.color) p.tpColor = String(ev.color);
  if (ev?.attachment && typeof ev.attachment === "object") p.tpAttachment = JSON.stringify(ev.attachment);
  if (ev?.location && typeof ev.location === "object") p.tpLocation = JSON.stringify(ev.location);
  return p;
}

function parseJsonSafe(v, fallback) {
  try { return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

export function fromGooglePrivateProps(p) {
  const src = p || {};
  const chores = parseJsonSafe(src.tpChores, []);
  const attachment = parseJsonSafe(src.tpAttachment, null);
  const location = parseJsonSafe(src.tpLocation, null);
  return {
    id: src.tpEventId ? String(src.tpEventId) : null,
    showInMealPlan: src.tpShowInMealPlan === "1",
    addToDo: src.tpAddToDo === "1",
    chores: Array.isArray(chores) ? chores.map((c) => String(c || "").trim()).filter(Boolean) : [],
    color: src.tpColor ? String(src.tpColor) : null,
    attachment: attachment && typeof attachment === "object" ? attachment : null,
    location: location && typeof location === "object" ? location : null
  };
}

// ── 3. Severance: RRULE → app recurrence ──────────────────────────────────────

const DAY_CODES = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const SUPPORTED_PARTS = new Set(["FREQ", "INTERVAL", "UNTIL", "COUNT", "BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS", "WKST"]);

export function parseRrule(line) {
  const body = String(line || "").replace(/^RRULE:/i, "").trim();
  const out = {};
  for (const part of body.split(";")) {
    const [k, v] = part.split("=");
    if (k && v != null) out[k.trim().toUpperCase()] = v.trim().toUpperCase();
  }
  return out;
}

// RFC 5545 date or date-time (optionally with Z) → local date key.
function icsDateToKey(v) {
  const m = String(v || "").match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  if (!m[4]) return `${m[1]}-${m[2]}-${m[3]}`;
  if (m[7]) return localDateKey(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])));
  return `${m[1]}-${m[2]}-${m[3]}`; // floating / TZID-local: the wall-clock date
}

// EXDATE lines (any of: VALUE=DATE, TZID=…, UTC Z, comma lists) → date keys.
export function exdatesFromRecurrence(lines) {
  const keys = [];
  for (const line of lines || []) {
    if (!/^EXDATE/i.test(line)) continue;
    const values = String(line).slice(String(line).indexOf(":") + 1).split(",");
    for (const v of values) { const k = icsDateToKey(v.trim()); if (k) keys.push(k); }
  }
  return [...new Set(keys)].sort();
}

// Convert one Google `recurrence` array (RRULE/EXDATE/RDATE lines) for a series
// starting on `startKey` into { recurrence, exceptions } in the app's model, or
// { unsupported: "<reason>" } when the app's engine can't express it exactly.
export function googleRecurrenceToApp(lines, startKey) {
  const all = (lines || []).map(String);
  const rrules = all.filter((l) => /^RRULE/i.test(l));
  if (all.some((l) => /^RDATE/i.test(l))) return { unsupported: "extra one-off dates (RDATE)" };
  if (all.some((l) => /^EXRULE/i.test(l))) return { unsupported: "exclusion rule (EXRULE)" };
  if (rrules.length !== 1) return { unsupported: rrules.length ? "more than one repeat rule" : "no repeat rule" };
  const r = parseRrule(rrules[0]);
  const extra = Object.keys(r).filter((k) => !SUPPORTED_PARTS.has(k));
  if (extra.length) return { unsupported: `repeat rule uses ${extra.join(", ")}` };

  const freqMap = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" };
  const freq = freqMap[r.FREQ];
  if (!freq) return { unsupported: `repeats ${String(r.FREQ || "?").toLowerCase()}` };
  const interval = r.INTERVAL ? Number(r.INTERVAL) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) return { unsupported: "unusual repeat interval" };

  const start = new Date(`${startKey}T00:00:00`);
  if (Number.isNaN(start.getTime())) return { unsupported: "invalid start date" };
  const rec = { freq, interval, until: null, count: null };

  if (r.UNTIL) {
    const k = icsDateToKey(r.UNTIL);
    if (!k) return { unsupported: "unreadable end date" };
    rec.until = k;
  }
  if (r.COUNT) {
    const c = Number(r.COUNT);
    if (!Number.isInteger(c) || c < 1 || c > 3650) return { unsupported: "unusual repeat count" };
    rec.count = c;
  }

  const byDay = r.BYDAY ? r.BYDAY.split(",").filter(Boolean) : [];
  const parsedDays = byDay.map((d) => {
    const m = d.match(/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/);
    return m ? { pos: m[1] ? Number(m[1]) : null, day: DAY_CODES[m[2]] } : null;
  });
  if (parsedDays.some((d) => !d)) return { unsupported: "unreadable weekday list" };
  const setPos = r.BYSETPOS ? Number(r.BYSETPOS) : null;
  if (r.BYSETPOS && !/^-?\d+$/.test(r.BYSETPOS)) return { unsupported: "multiple positions (BYSETPOS)" };
  const monthDays = r.BYMONTHDAY ? r.BYMONTHDAY.split(",") : [];
  if (monthDays.length > 1) return { unsupported: "several days of the month" };
  if (monthDays.length && Number(monthDays[0]) !== start.getDate()) return { unsupported: "day of month differs from the start date" };
  if (r.BYMONTH) {
    const months = r.BYMONTH.split(",");
    if (freq !== "yearly" || months.length !== 1 || Number(months[0]) !== start.getMonth() + 1) {
      return { unsupported: "specific months" };
    }
  }

  if (freq === "daily") {
    if (byDay.length || setPos != null || monthDays.length) return { unsupported: "daily rule limited to certain days" };
  } else if (freq === "weekly") {
    if (setPos != null || monthDays.length) return { unsupported: "weekly rule with positions" };
    if (parsedDays.some((d) => d.pos != null)) return { unsupported: "weekly rule with numbered weekdays" };
    if (parsedDays.length) rec.byWeekdays = [...new Set(parsedDays.map((d) => d.day))].sort((a, b) => a - b);
  } else {
    // monthly / yearly
    if (!parsedDays.length) {
      if (setPos != null) return { unsupported: "position without weekday" };
      rec.monthMode = "dayOfMonth";
    } else {
      if (parsedDays.length !== 1) return { unsupported: "several weekdays in a month" };
      const { pos, day } = parsedDays[0];
      const n = pos ?? setPos;
      if (pos != null && setPos != null) return { unsupported: "conflicting positions" };
      if (![1, 2, 3, 4, 5, -1].includes(n)) return { unsupported: "unusual weekday position" };
      rec.monthMode = "nthWeekday";
      rec.byWeekday = day;
      rec.bySetPos = n;
    }
  }

  const recurrence = normalizeRecurrence(rec);
  if (!recurrence) return { unsupported: "could not normalise rule" };
  // The app expands occurrences purely by `until`; "ends after N times" stores the
  // count AND its derived until (same as the event editor does).
  if (recurrence.count && !recurrence.until) {
    recurrence.until = planNthOccurrenceDate({ date: startKey, recurrence }, recurrence.count);
  }
  return { recurrence, exceptions: exdatesFromRecurrence(all) };
}

// ── 3b. Severance: masters + exceptions → planEvents, plus a dry-run report ────

function hasOtherGuests(it) {
  return Array.isArray(it?.attendees) && it.attendees.some((a) => !a?.self);
}

function planEventFromGoogle(it, appCalendarId, { recurrence = null, exceptions = [] } = {}) {
  const start = readGoogleTime(it.start);
  const end = readGoogleTime(it.end);
  const tp = fromGooglePrivateProps(it.extendedProperties?.private);
  let endDate = null;
  if (start.allDay && end?.allDay && end.date > start.date) {
    const last = addDaysKey(end.date, -1);
    if (last !== start.date) endDate = last;
  } else if (!start.allDay && end && !end.allDay && end.date !== start.date) {
    endDate = end.date;
  }
  const reminderMin = Array.isArray(it.reminders?.overrides) && it.reminders.overrides.length
    ? Number(it.reminders.overrides[0].minutes) : null;
  return {
    id: tp.id || `gimp-${it.id}`,
    title: String(it.summary || "").trim() || "(No title)",
    date: start.date,
    startTime: start.allDay ? null : start.time,
    endTime: start.allDay || !end || end.allDay ? null : end.time,
    allDay: start.allDay,
    color: tp.color,
    calendarId: appCalendarId,
    notes: String(it.description || "").trim(),
    location: tp.location || (it.location ? { name: String(it.location) } : null),
    attachment: tp.attachment,
    recurrence,
    exceptions,
    addToDo: tp.addToDo,
    chores: tp.chores,
    showInMealPlan: tp.showInMealPlan,
    reminder: Number.isFinite(reminderMin) ? reminderMin : null,
    endDate,
    createdAt: it.created || new Date().toISOString(),
    googleEventId: it.id
  };
}

// Convert one calendar's UNEXPANDED Google events (singleEvents=false: series
// masters, single events, and exception instances carrying recurringEventId +
// originalStartTime; cancelled instances included) into app planEvents.
// Returns { events, issues, stats } — `issues` are things that won't import
// exactly; `events` is what a cutover would write.
export function convertGoogleCalendar(items, { appCalendarId, calendarName = "" } = {}) {
  const events = [];
  const issues = [];
  const stats = { singles: 0, series: 0, movedOccurrences: 0, cancelledOccurrences: 0, guests: 0, meetLinks: 0, attachments: 0 };
  const all = (items || []).filter((it) => it?.id);
  const masters = new Map();
  const instances = [];
  for (const it of all) {
    if (it.recurringEventId) instances.push(it);
    else if (it.status !== "cancelled") masters.set(it.id, it);
  }

  const converted = new Map(); // master id → planEvent (only for convertible series)
  for (const it of masters.values()) {
    if (!readGoogleTime(it.start)) { issues.push({ calendar: calendarName, title: it.summary || "(No title)", reason: "no start time" }); continue; }
    if (hasOtherGuests(it)) stats.guests += 1;
    if (it.hangoutLink || it.conferenceData) stats.meetLinks += 1;
    if (Array.isArray(it.attachments) && it.attachments.length) stats.attachments += 1;
    if (Array.isArray(it.recurrence) && it.recurrence.length) {
      const startKey = readGoogleTime(it.start).date;
      const conv = googleRecurrenceToApp(it.recurrence, startKey);
      if (conv.unsupported) {
        issues.push({ calendar: calendarName, title: it.summary || "(No title)", reason: `${conv.unsupported} — would import as individual events` });
        continue;
      }
      const ev = planEventFromGoogle(it, appCalendarId, conv);
      converted.set(it.id, ev);
      events.push(ev);
      stats.series += 1;
    } else {
      events.push(planEventFromGoogle(it, appCalendarId));
      stats.singles += 1;
    }
  }

  for (const inst of instances) {
    const series = converted.get(inst.recurringEventId);
    if (!series) continue; // its series was unsupported (already reported) or missing
    const orig = readGoogleTime(inst.originalStartTime);
    if (!orig) continue;
    if (!series.exceptions.includes(orig.date)) series.exceptions = [...series.exceptions, orig.date].sort();
    if (inst.status === "cancelled") { stats.cancelledOccurrences += 1; continue; }
    if (!readGoogleTime(inst.start)) continue;
    const oneOff = planEventFromGoogle(inst, appCalendarId);
    oneOff.id = `${series.id}-${orig.date}`;
    events.push(oneOff);
    stats.movedOccurrences += 1;
  }

  return { events, issues, stats };
}

// Dry-run report across calendars. Input: [{ name, appCalendarId, items }].
export function buildSeveranceReport(calendars) {
  const perCalendar = [];
  const issues = [];
  const totals = { singles: 0, series: 0, movedOccurrences: 0, cancelledOccurrences: 0, guests: 0, meetLinks: 0, attachments: 0, events: 0 };
  for (const cal of calendars || []) {
    const r = convertGoogleCalendar(cal.items, { appCalendarId: cal.appCalendarId, calendarName: cal.name });
    perCalendar.push({ name: cal.name, appCalendarId: cal.appCalendarId, ...r.stats, events: r.events.length, issues: r.issues.length });
    issues.push(...r.issues);
    for (const k of Object.keys(totals)) totals[k] += k === "events" ? r.events.length : (r.stats[k] || 0);
  }
  return { perCalendar, issues, totals, clean: issues.length === 0 };
}
