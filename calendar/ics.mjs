// iCalendar (ICS / VCal) → plan-event parser, extracted byte-faithfully from
// server.js so the external-calendar pipeline has a single, tested source of
// truth (§11 — preserve and generalize ICS). This is what turns any subscribed
// feed — Google/Apple ICS, or an Amion on-call VCal endpoint — into the app's
// event shape, so ICS and Amion share one parser rather than parallel ones (§12).
//
// Pure and environment-agnostic (string/Date/Intl only): server.js imports it,
// and vitest exercises it against real feed samples.
//
// The three tiny helpers below are private copies of server.js's shared ICS
// helpers (which stay there for its holiday/calendar parsers); duplicating them
// keeps this module dependency-free, and the implementations are identical.

function unfoldIcsLines(text) {
  return String(text || "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function readIcsProperty(block, propertyName) {
  const line = block.split(/\n/).find((item) => item.startsWith(`${propertyName};`) || item.startsWith(`${propertyName}:`));
  return line ? line.slice(line.indexOf(":") + 1).trim() : "";
}

function cleanHolidaySummary(value) {
  return String(value || "").replace(/\\,/g, ",").replace(/\\;/g, ";").trim();
}

export function parsePlanIcs(text) {
  return unfoldIcsLines(text)
    .join("\n")
    .split("BEGIN:VEVENT")
    .slice(1)
    .map((block) => {
      const summary = cleanHolidaySummary(readIcsProperty(block, "SUMMARY"));
      if (!summary) return null;
      const start = readIcsDatetime(block, "DTSTART");
      if (!start.date) return null;
      const end = readIcsDatetime(block, "DTEND") || computeIcsEnd(start, readIcsProperty(block, "DURATION"));
      // All-day DTEND is EXCLUSIVE (the day after the last day), so subtract one to
      // get the inclusive last day; a timed DTEND is the actual end.
      let endDate = null;
      if (end?.allDay && end.date) {
        const inclusive = icsAddDays(end.date, -1);
        if (inclusive > start.date) endDate = inclusive;
      } else if (end?.date && end.date !== start.date) {
        endDate = end.date;
      }
      return {
        uid: readIcsProperty(block, "UID") || `ics-${Math.random().toString(36).slice(2)}`,
        title: summary,
        date: start.date,
        startTime: start.time || null,
        endTime: end.time || null,
        endDate,
        allDay: start.allDay,
        notes: cleanHolidaySummary(readIcsProperty(block, "DESCRIPTION")),
        location: cleanHolidaySummary(readIcsProperty(block, "LOCATION")),
        recurrence: parseIcsRrule(block, start.date),
        exceptions: parseIcsExdates(block)
      };
    })
    .filter(Boolean);
}

// Parse an RRULE into the app's recurrence shape (freq/interval/until/byWeekdays/
// monthMode/byWeekday/bySetPos) so the client expands it like a personal event.
export function parseIcsRrule(block, startDate) {
  const line = block.split("\n").find((l) => l.startsWith("RRULE:") || l.startsWith("RRULE;"));
  if (!line) return null;
  const rule = Object.fromEntries(line.slice(line.indexOf(":") + 1).split(";").map((kv) => { const [k, v] = kv.split("="); return [String(k).toUpperCase(), v]; }));
  const freq = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" }[String(rule.FREQ || "").toUpperCase()];
  if (!freq) return null;
  const interval = Math.max(1, parseInt(rule.INTERVAL, 10) || 1);
  const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const rec = { freq, interval };
  const untilM = rule.UNTIL && String(rule.UNTIL).match(/^(\d{4})(\d{2})(\d{2})/);
  if (untilM) rec.until = `${untilM[1]}-${untilM[2]}-${untilM[3]}`;
  else if (rule.COUNT && startDate) { // approximate COUNT as an until date
    const n = parseInt(rule.COUNT, 10);
    if (n > 0) {
      const d = new Date(`${startDate}T00:00:00`);
      if (freq === "daily") d.setDate(d.getDate() + (n - 1) * interval);
      else if (freq === "weekly") d.setDate(d.getDate() + (n - 1) * interval * 7);
      else if (freq === "monthly") d.setMonth(d.getMonth() + (n - 1) * interval);
      else d.setFullYear(d.getFullYear() + (n - 1) * interval);
      const p = (x) => String(x).padStart(2, "0");
      rec.until = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
  }
  if (rule.BYDAY) {
    const parts = String(rule.BYDAY).split(",");
    if (freq === "weekly") {
      const days = [...new Set(parts.map((x) => dayMap[x.replace(/[-\d]/g, "").toUpperCase()]).filter((x) => x != null))].sort((a, b) => a - b);
      if (days.length) rec.byWeekdays = days;
    } else {
      const m = parts[0].match(/^(-?\d+)?([A-Z]{2})$/i);
      if (m && m[1] != null && dayMap[m[2].toUpperCase()] != null) { rec.monthMode = "nthWeekday"; rec.byWeekday = dayMap[m[2].toUpperCase()]; rec.bySetPos = parseInt(m[1], 10); }
    }
  }
  return rec;
}

export function parseIcsExdates(block) {
  const out = [];
  block.split("\n").forEach((l) => {
    if (!/^EXDATE[;:]/i.test(l)) return;
    l.slice(l.indexOf(":") + 1).split(",").forEach((v) => { const m = v.trim().match(/^(\d{4})(\d{2})(\d{2})/); if (m) out.push(`${m[1]}-${m[2]}-${m[3]}`); });
  });
  return out;
}

export function readIcsDatetime(block, prop) {
  const line = block.split("\n").find((l) => l.startsWith(`${prop}:`) || l.startsWith(`${prop};`));
  if (!line) return null;
  const value = line.slice(line.indexOf(":") + 1).trim();
  const allDay = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (allDay) return { date: `${allDay[1]}-${allDay[2]}-${allDay[3]}`, time: null, allDay: true };
  // UTC ('Z'): convert to the server's LOCAL wall time. This is a single-user
  // local app, so server-local == the viewer's timezone; without this a 02:00Z
  // event would show on the wrong day/time near midnight.
  const utc = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?Z$/);
  if (utc) {
    const d = new Date(Date.UTC(+utc[1], +utc[2] - 1, +utc[3], +utc[4], +utc[5], +(utc[6] || 0)));
    const p = (n) => String(n).padStart(2, "0");
    return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}`, allDay: false };
  }
  const dt = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  // TZID: convert the wall-clock time in that IANA zone to the server's local time.
  const tzid = (line.match(/[;:]TZID=([^:;]+)/i) || [])[1];
  if (dt && tzid) {
    const local = icsTzidToLocal(+dt[1], +dt[2], +dt[3], +dt[4], +dt[5], tzid);
    if (local) {
      const p = (n) => String(n).padStart(2, "0");
      return { date: `${local.getFullYear()}-${p(local.getMonth() + 1)}-${p(local.getDate())}`, time: `${p(local.getHours())}:${p(local.getMinutes())}`, allDay: false };
    }
  }
  // Floating local time (no zone): taken as-is.
  if (dt) return { date: `${dt[1]}-${dt[2]}-${dt[3]}`, time: `${dt[4]}:${dt[5]}`, allDay: false };
  return null;
}

// Offset (minutes ahead of UTC) that `tzid` is at the given UTC instant.
function tzOffsetMinutes(instantMs, tzid) {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tzid, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(dtf.formatToParts(new Date(instantMs)).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - instantMs) / 60000;
}

// Wall-clock (y,mo,d,h,mi) in IANA `tzid` → a Date at the correct UTC instant,
// which then reads out in the server's local zone. Two passes handle DST edges.
function icsTzidToLocal(y, mo, d, h, mi, tzid) {
  try {
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    let inst = guess - tzOffsetMinutes(guess, tzid) * 60000;
    inst = guess - tzOffsetMinutes(inst, tzid) * 60000;
    return new Date(inst);
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
