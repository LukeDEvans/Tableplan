// iCalendar (ICS / VCal) → plan-event parser, extracted byte-faithfully from
// server.js so the external-calendar pipeline has a single, tested source of
// truth (§11 — preserve and generalize ICS). This is what turns any subscribed
// feed — Google/Apple ICS, or an Amion on-call VCal endpoint — into the app's
// event shape, so ICS and Amion share one parser rather than parallel ones (§12).
//
// Pure and environment-agnostic (string/Date/Intl only): server.js imports it,
// and vitest exercises it against real feed samples.
//
// The small text helpers below are private copies of server.js's shared ICS
// helpers (which stay there for its holiday/calendar parsers). The only import is
// the sibling pure recurrence engine (COUNT → until uses the SAME expansion the
// client renders with).

import { planNthOccurrenceDate, normalizeRecurrence } from "./recurrence.js";

function unfoldIcsLines(text) {
  return String(text || "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

// Only the VEVENT's OWN properties: cut at its END:VEVENT (so a trailing
// VTIMEZONE / END:VCALENDAR can't leak in) and drop nested VALARM sub-blocks,
// whose DESCRIPTION/SUMMARY/TRIGGER would otherwise shadow the event's.
function veventBody(rawBlock) {
  const endIdx = rawBlock.indexOf("END:VEVENT");
  const body = endIdx === -1 ? rawBlock : rawBlock.slice(0, endIdx);
  return body.replace(/BEGIN:VALARM[\s\S]*?(END:VALARM|$)/g, "");
}

function readIcsLine(block, propertyName) {
  return block.split(/\n/).find((item) => item.startsWith(`${propertyName};`) || item.startsWith(`${propertyName}:`)) || "";
}

function readIcsProperty(block, propertyName) {
  const line = readIcsLine(block, propertyName);
  return line ? line.slice(line.indexOf(":") + 1).trim() : "";
}

// RFC 5545 TEXT unescape: \n / \N → newline, \\ → \, \, → , and \; → ;
function cleanIcsText(value) {
  return String(value || "").replace(/\\([\\;,nN])/g, (_, c) => (c === "n" || c === "N") ? "\n" : c).trim();
}

// Small stable string hash (FNV-1a) for a deterministic fallback UID.
function stableHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

// A usable IANA zone name, or null (→ fall back to the process-local zone).
function resolveTimeZone(tz) {
  if (!tz || typeof tz !== "string") return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return null; }
}

const p2 = (n) => String(n).padStart(2, "0");

// A UTC instant → wall-clock { date, time } in `timeZone` (the VIEWER's zone,
// sent by the client), or in the process-local zone when none is given (local
// dev: server-local == viewer).
function instantToWall(instantMs, timeZone) {
  if (timeZone) {
    const dtf = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    const p = Object.fromEntries(dtf.formatToParts(new Date(instantMs)).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p2(+p.hour % 24)}:${p.minute}` };
  }
  const d = new Date(instantMs);
  return { date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, time: `${p2(d.getHours())}:${p2(d.getMinutes())}` };
}

// Parse one ICS DATE / DATE-TIME value. `tzid` is the property's TZID param (if
// any). Z and TZID values are converted into `timeZone` (see instantToWall);
// floating values are taken as-is. `rawDate` is the value's own calendar date
// BEFORE conversion (used to shift BYDAY when conversion crosses midnight).
function parseIcsDateValue(value, tzid, timeZone) {
  const v = String(value || "").trim();
  const allDay = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (allDay) { const date = `${allDay[1]}-${allDay[2]}-${allDay[3]}`; return { date, time: null, allDay: true, rawDate: date }; }
  const utc = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?Z$/);
  if (utc) {
    const inst = Date.UTC(+utc[1], +utc[2] - 1, +utc[3], +utc[4], +utc[5], +(utc[6] || 0));
    return { ...instantToWall(inst, timeZone), allDay: false, rawDate: `${utc[1]}-${utc[2]}-${utc[3]}` };
  }
  const dt = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (!dt) return null;
  const rawDate = `${dt[1]}-${dt[2]}-${dt[3]}`;
  if (tzid) {
    const inst = icsTzidToInstant(+dt[1], +dt[2], +dt[3], +dt[4], +dt[5], tzid);
    if (inst != null) return { ...instantToWall(inst, timeZone), allDay: false, rawDate };
  }
  // Floating local time (no zone, or an unknown TZID): taken as-is.
  return { date: rawDate, time: `${dt[4]}:${dt[5]}`, allDay: false, rawDate };
}

function lineTzid(line) {
  return (String(line || "").match(/[;:]TZID=([^:;]+)/i) || [])[1] || null;
}

// Day difference b − a between two YYYY-MM-DD keys (DST-safe via UTC).
function dayDiff(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// parsePlanIcs(text, { timeZone }) — `timeZone` is the viewer's IANA zone; Z and
// TZID datetimes (DTSTART/DTEND/EXDATE/UNTIL/RECURRENCE-ID) are converted into
// it. Omitted/invalid → the process-local zone (unchanged local-dev behaviour).
export function parsePlanIcs(text, options = {}) {
  const timeZone = resolveTimeZone(options?.timeZone);
  const parsed = unfoldIcsLines(text)
    .join("\n")
    .split("BEGIN:VEVENT")
    .slice(1)
    .map((rawBlock) => {
      const block = veventBody(rawBlock);
      const summary = cleanIcsText(readIcsProperty(block, "SUMMARY"));
      if (!summary) return null;
      const start = readIcsDatetimeFull(block, "DTSTART", timeZone);
      if (!start?.date) return null;
      const end = readIcsDatetime(block, "DTEND", { timeZone }) || computeIcsEnd(start, readIcsProperty(block, "DURATION"));
      // All-day DTEND is EXCLUSIVE (the day after the last day), so subtract one to
      // get the inclusive last day; a timed DTEND is the actual end.
      let endDate = null;
      if (end?.allDay && end.date) {
        const inclusive = icsAddDays(end.date, -1);
        if (inclusive > start.date) endDate = inclusive;
      } else if (end?.date && end.date !== start.date) {
        endDate = end.date;
      }
      const uid = readIcsProperty(block, "UID") || `ics-${stableHash(`${readIcsProperty(block, "DTSTART")}|${summary}`)}`;
      const ridLine = readIcsLine(block, "RECURRENCE-ID");
      const recurrenceDate = ridLine ? parseIcsDateValue(ridLine.slice(ridLine.indexOf(":") + 1), lineTzid(ridLine), timeZone)?.date || null : null;
      const cancelled = /^CANCELLED$/i.test(readIcsProperty(block, "STATUS"));
      const event = {
        uid: recurrenceDate ? `${uid}@${recurrenceDate}` : uid, // an override is its own event, distinct from the master
        title: summary,
        date: start.date,
        startTime: start.time || null,
        endTime: end?.time || null,
        endDate,
        allDay: start.allDay,
        notes: cleanIcsText(readIcsProperty(block, "DESCRIPTION")),
        location: cleanIcsText(readIcsProperty(block, "LOCATION")),
        recurrence: recurrenceDate ? null : parseIcsRrule(block, start.date, { timeZone, start }),
        exceptions: recurrenceDate ? [] : parseIcsExdates(block, { timeZone })
      };
      return { uid, recurrenceDate, cancelled, event };
    })
    .filter(Boolean);

  // RECURRENCE-ID overrides (moved/edited single instances) and cancelled
  // instances REPLACE the master's occurrence on that date: add it to the master's
  // exceptions so the series doesn't also render it there.
  const masters = new Map();
  parsed.forEach((p) => { if (!p.recurrenceDate && !masters.has(p.uid)) masters.set(p.uid, p.event); });
  parsed.forEach((p) => {
    if (!p.recurrenceDate) return;
    const master = masters.get(p.uid);
    if (master?.recurrence && !master.exceptions.includes(p.recurrenceDate)) master.exceptions.push(p.recurrenceDate);
  });
  return parsed.filter((p) => !p.cancelled).map((p) => p.event);
}

// Parse an RRULE into the app's recurrence shape (freq/interval/until/byWeekdays/
// monthMode/byWeekday/bySetPos) so the client expands it like a personal event.
// `options.start` (the parsed DTSTART, incl. its pre-conversion rawDate) lets
// BYDAY follow DTSTART when zone conversion moved it across midnight. Returns
// null for a rule the app can't represent faithfully (→ the caller shows a single
// event rather than a WRONG series).
export function parseIcsRrule(block, startDate, options = {}) {
  const timeZone = resolveTimeZone(options?.timeZone);
  const line = block.split("\n").find((l) => l.startsWith("RRULE:") || l.startsWith("RRULE;"));
  if (!line) return null;
  const rule = Object.fromEntries(line.slice(line.indexOf(":") + 1).split(";").map((kv) => { const [k, v] = kv.split("="); return [String(k).toUpperCase(), v]; }));
  let freq = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" }[String(rule.FREQ || "").toUpperCase()];
  if (!freq) return null;
  const interval = Math.max(1, parseInt(rule.INTERVAL, 10) || 1);
  const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  // Weekday shift when Z/TZID conversion moved DTSTART to another local day.
  const start = options?.start;
  const shift = (start?.rawDate && start.date && start.rawDate !== start.date) ? dayDiff(start.rawDate, start.date) : 0;
  const shiftDay = (d) => (((d + shift) % 7) + 7) % 7;
  const rec = { freq, interval };
  if (rule.UNTIL) {
    // UNTIL is converted exactly like DTSTART (a UTC UNTIL near midnight lands on
    // the viewer's day, not the raw UTC day).
    const u = parseIcsDateValue(rule.UNTIL, lineTzid(readIcsLine(block, "DTSTART")), timeZone);
    if (u?.date) rec.until = u.date;
  }
  if (rule.BYDAY) {
    const parts = String(rule.BYDAY).split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
    const parsedDays = parts.map((x) => x.match(/^([+-]?\d+)?([A-Z]{2})$/)).filter((m) => m && dayMap[m[2]] != null);
    if (parsedDays.length !== parts.length) return null; // malformed BYDAY
    const hasOrdinal = parsedDays.some((m) => m[1] != null);
    if (freq === "weekly" || (freq === "daily" && interval === 1 && !hasOrdinal)) {
      // Daily-with-BYDAY at interval 1 ("every weekday") == weekly on those days.
      if (freq === "daily") freq = rec.freq = "weekly";
      const days = [...new Set(parsedDays.map((m) => shiftDay(dayMap[m[2]])))].sort((a, b) => a - b);
      if (days.length) rec.byWeekdays = days;
    } else if (freq === "monthly" || freq === "yearly") {
      // Only ONE weekday with ONE supported position is representable (nth weekday,
      // 1..5 or last). An ordinal in BYDAY or a single BYSETPOS both work.
      if (parsedDays.length !== 1) return null;
      const m = parsedDays[0];
      const pos = m[1] != null ? parseInt(m[1], 10) : (rule.BYSETPOS != null ? parseInt(rule.BYSETPOS, 10) : NaN);
      if (![1, 2, 3, 4, 5, -1].includes(pos)) return null; // e.g. -2FR, or every-Monday-of-month
      // Yearly nth-weekday is "nth weekday of DTSTART's month" in the app; without a
      // matching single BYMONTH an RFC yearly BYDAY means nth weekday of the YEAR.
      if (freq === "yearly" && String(parseInt(rule.BYMONTH, 10)) !== String(Number(String(startDate || "").slice(5, 7)))) return null;
      rec.monthMode = "nthWeekday"; rec.byWeekday = dayMap[m[2]]; rec.bySetPos = pos;
    } else {
      return null; // DAILY with interval > 1 + BYDAY: not representable
    }
  }
  if (!rec.until && rule.COUNT && startDate) {
    // COUNT → the actual date of the Nth occurrence, computed by the SAME expansion
    // engine the client uses (so multi-BYDAY / nth-weekday / month-end SKIP count right).
    const n = parseInt(rule.COUNT, 10);
    if (n > 0) {
      const until = planNthOccurrenceDate({ date: startDate, recurrence: normalizeRecurrence(rec) }, n);
      if (until) rec.until = until;
    }
  }
  return rec;
}

export function parseIcsExdates(block, options = {}) {
  const timeZone = resolveTimeZone(options?.timeZone);
  const out = [];
  block.split("\n").forEach((l) => {
    if (!/^EXDATE[;:]/i.test(l)) return;
    const tzid = lineTzid(l.slice(0, l.indexOf(":") + 1));
    l.slice(l.indexOf(":") + 1).split(",").forEach((v) => {
      const d = parseIcsDateValue(v, tzid, timeZone);
      if (d?.date && !out.includes(d.date)) out.push(d.date);
    });
  });
  return out;
}

function readIcsDatetimeFull(block, prop, timeZone) {
  const line = block.split("\n").find((l) => l.startsWith(`${prop}:`) || l.startsWith(`${prop};`));
  if (!line) return null;
  return parseIcsDateValue(line.slice(line.indexOf(":") + 1), lineTzid(line.slice(0, line.indexOf(":") + 1)), timeZone);
}

// { date, time, allDay } for a DTSTART/DTEND-style property. Z and TZID values
// convert into options.timeZone (the viewer's zone) or the process-local zone.
export function readIcsDatetime(block, prop, options = {}) {
  const full = readIcsDatetimeFull(block, prop, resolveTimeZone(options?.timeZone));
  if (!full) return null;
  return { date: full.date, time: full.time, allDay: full.allDay };
}

// Offset (minutes ahead of UTC) that `tzid` is at the given UTC instant.
function tzOffsetMinutes(instantMs, tzid) {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tzid, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(dtf.formatToParts(new Date(instantMs)).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - instantMs) / 60000;
}

// Wall-clock (y,mo,d,h,mi) in IANA `tzid` → the UTC instant (ms), or null for
// an unknown zone. Two passes handle DST edges.
function icsTzidToInstant(y, mo, d, h, mi, tzid) {
  try {
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    let inst = guess - tzOffsetMinutes(guess, tzid) * 60000;
    inst = guess - tzOffsetMinutes(inst, tzid) * 60000;
    return inst;
  } catch { return null; }
}

function computeIcsEnd(start, duration) {
  if (!start) return null;
  if (!duration) {
    if (start.allDay) return { date: icsAddDays(start.date, 1), time: null, allDay: true };
    if (start.time) return { date: start.date, time: icsAddHour(start.time, 1), allDay: false };
    return start;
  }
  const days = Number(duration.match(/P(\d+)D/i)?.[1] || 0);
  const hours = Number(duration.match(/T.*?(\d+)H/i)?.[1] || 0);
  const mins = Number(duration.match(/T.*?(\d+)M/i)?.[1] || 0);
  if (start.allDay && days) return { date: icsAddDays(start.date, days), time: null, allDay: true };
  if (start.time && (hours || mins)) return { date: start.date, time: icsAddMinutes(start.time, hours * 60 + mins), allDay: false };
  return start;
}

function icsAddDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  const p = (n) => String(n).padStart(2, "0"); // local components (toISOString is UTC → off-by-one in +offset zones)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function icsAddHour(time, h) {
  const [hr, mn] = time.split(":").map(Number);
  return `${String((hr + h) % 24).padStart(2, "0")}:${String(mn).padStart(2, "0")}`;
}

function icsAddMinutes(time, mins) {
  const [hr, mn] = time.split(":").map(Number);
  const total = hr * 60 + mn + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
