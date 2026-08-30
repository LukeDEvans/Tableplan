// Calendar recurrence engine — pure, extracted byte-faithfully from app.js so it
// can be unit-tested in isolation. Nothing here touches app state, the DOM, or
// the network: every function is a deterministic transform over its arguments.
//
// The two tiny date helpers below (dateKeyFromDate / planWeekStart) are private
// copies of app.js's identically-named helpers. They are duplicated rather than
// imported because app.js's copies are load-bearing for ~100 other call sites and
// this module must stay dependency-free; the implementations are identical, and
// the tests pin the behavior.

// Local-date → "YYYY-MM-DD" key (local, no timezone shift).
function dateKeyFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Sunday 00:00 of the week containing `date`.
function planWeekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

// Date of the Nth-weekday-of-month (e.g. 3rd Friday, or last Friday when setPos
// is -1). Returns null when that occurrence doesn't exist in the month.
export function planNthWeekdayDate(year, month, weekday, setPos) {
  const dim = new Date(year, month + 1, 0).getDate();
  if (setPos === -1) {
    const last = new Date(year, month, dim);
    return new Date(year, month, dim - ((last.getDay() - weekday + 7) % 7));
  }
  const first = new Date(year, month, 1);
  const day = 1 + ((weekday - first.getDay() + 7) % 7) + (setPos - 1) * 7;
  return day > dim ? null : new Date(year, month, day);
}

export function normalizeRecurrence(r) {
  if (!r || typeof r !== "object") return null;
  const freq = ["daily", "weekly", "monthly", "yearly"].includes(r.freq) ? r.freq : null;
  if (!freq) return null;
  const interval = Math.max(1, Math.min(365, Math.round(Number(r.interval) || 1)));
  const until = (typeof r.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.until)) ? r.until : null;
  // "Ends after N times" is stored as both count (for the editor) and a derived
  // until date (so expansion stays purely until-based).
  const count = (Number.isInteger(r.count) && r.count > 0 && r.count <= 3650) ? r.count : null;
  // Weekly events can repeat on specific days of the week (0 = Sun … 6 = Sat).
  let byWeekdays = null;
  if (freq === "weekly" && Array.isArray(r.byWeekdays)) {
    const days = [...new Set(r.byWeekdays.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
    if (days.length) byWeekdays = days;
  }
  // Monthly/yearly can repeat on the same day-of-month/date, or on the "nth
  // weekday" (e.g. the third Friday, or the last Friday).
  let monthMode = null, byWeekday = null, bySetPos = null;
  if (freq === "monthly" || freq === "yearly") {
    monthMode = r.monthMode === "nthWeekday" ? "nthWeekday" : "dayOfMonth";
    if (monthMode === "nthWeekday") {
      byWeekday = (Number.isInteger(r.byWeekday) && r.byWeekday >= 0 && r.byWeekday <= 6) ? r.byWeekday : null;
      bySetPos = [1, 2, 3, 4, 5, -1].includes(Number(r.bySetPos)) ? Number(r.bySetPos) : 1;
      if (byWeekday === null) { monthMode = "dayOfMonth"; bySetPos = null; }
    }
  }
  return { freq, interval, until, count, byWeekdays, monthMode, byWeekday, bySetPos };
}

// Date of the Nth occurrence of a recurring event, counting from its start.
// Used to convert an "ends after N times" choice into a concrete until date so
// occurrence expansion stays purely until-based.
export function planNthOccurrenceDate(baseEvent, count) {
  if (!baseEvent?.recurrence || !(count >= 1)) return null;
  const endD = new Date(baseEvent.date + "T00:00:00");
  if (isNaN(endD)) return null;
  endD.setFullYear(endD.getFullYear() + 20); // generous horizon; loops are capped internally
  const occ = expandRecurringOccurrences(
    { ...baseEvent, recurrence: { ...baseEvent.recurrence, until: null, count: null }, exceptions: [] },
    baseEvent.date, dateKeyFromDate(endD)
  );
  return occ[count - 1] || occ[occ.length - 1] || null;
}

// Expand a recurring event into occurrence date-keys within [startKey, endKey].
export function expandRecurringOccurrences(e, startKey, endKey) {
  const occ = [];
  const rec = e.recurrence;
  if (!rec) return occ;
  const base = new Date(e.date + "T00:00:00");
  if (isNaN(base)) return occ;
  const exceptions = new Set(e.exceptions || []);
  const hardEnd = (rec.until && rec.until < endKey) ? rec.until : endKey;

  // Weekly on specific weekdays: scan day-by-day, keeping the chosen weekdays
  // in weeks that fall on the interval (e.g. every 2 weeks on Mon & Wed).
  if (rec.freq === "weekly" && Array.isArray(rec.byWeekdays) && rec.byWeekdays.length) {
    const days = new Set(rec.byWeekdays);
    const baseWeekStart = planWeekStart(base); // Sunday of the event's start week
    const startD2 = new Date(startKey + "T00:00:00");
    const scan = new Date(Math.max(base.getTime(), startD2.getTime()));
    scan.setHours(0, 0, 0, 0);
    let g = 0;
    while (g++ < 1500) {
      const key = dateKeyFromDate(scan);
      if (key > hardEnd) break;
      if (key >= startKey && key >= e.date && days.has(scan.getDay()) && !exceptions.has(key)) {
        const weekOffset = Math.round((planWeekStart(scan) - baseWeekStart) / (7 * 86400000));
        if (weekOffset >= 0 && weekOffset % rec.interval === 0) occ.push(key);
      }
      scan.setDate(scan.getDate() + 1);
    }
    return occ;
  }

  // Monthly / yearly on the Nth weekday (e.g. 3rd Friday, or last Friday). For
  // yearly the month is fixed to the event's month; for monthly it advances.
  if ((rec.freq === "monthly" || rec.freq === "yearly") && rec.monthMode === "nthWeekday" && Number.isInteger(rec.byWeekday)) {
    const endD = new Date(hardEnd + "T00:00:00");
    let y = base.getFullYear(), m = base.getMonth(), g3 = 0;
    while (g3++ < 1500) {
      if (new Date(y, m, 1) > endD) break;
      const occDate = planNthWeekdayDate(y, m, rec.byWeekday, rec.bySetPos);
      if (occDate) {
        const key = dateKeyFromDate(occDate);
        if (key > hardEnd) break;
        if (key >= startKey && key >= e.date && !exceptions.has(key)) occ.push(key);
      }
      if (rec.freq === "monthly") { m += rec.interval; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; }
      else { y += rec.interval; }
    }
    return occ;
  }

  // Monthly / yearly on a day-of-month: anchor on the original day so a month or
  // year that lacks that day (e.g. the 31st in Feb, or Feb 29 in a common year)
  // is SKIPPED, not rolled forward into the next month (which would drift the day
  // and drop months entirely).
  if (rec.freq === "monthly" || rec.freq === "yearly") {
    const anchorDay = base.getDate();
    const anchorMonth = base.getMonth();
    const endD = new Date(hardEnd + "T00:00:00");
    let y = base.getFullYear(), m = base.getMonth(), g4 = 0;
    while (g4++ < 2400) {
      const mm = rec.freq === "yearly" ? anchorMonth : m;
      if (new Date(y, mm, 1) > endD) break;
      const dim = new Date(y, mm + 1, 0).getDate(); // days in this month
      if (anchorDay <= dim) {
        const key = dateKeyFromDate(new Date(y, mm, anchorDay));
        if (key > hardEnd) break;
        if (key >= startKey && key >= e.date && !exceptions.has(key)) occ.push(key);
      }
      if (rec.freq === "monthly") { m += rec.interval; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; }
      else { y += rec.interval; }
    }
    return occ;
  }

  // Daily / weekly (every N days/weeks). Fast-forward from an old start so we
  // don't burn the iteration cap before reaching the visible window.
  const d = new Date(base);
  const startD = new Date(startKey + "T00:00:00");
  if (d < startD) {
    const step = (rec.freq === "daily" ? 1 : 7) * rec.interval;
    const jumps = Math.floor((startD - d) / 86400000 / step);
    if (jumps > 0) d.setDate(d.getDate() + jumps * step);
  }
  let guard = 0;
  while (guard++ < 1500) {
    const key = dateKeyFromDate(d);
    if (key > hardEnd) break;
    if (key >= startKey && !exceptions.has(key)) occ.push(key);
    if (rec.freq === "daily") d.setDate(d.getDate() + rec.interval);
    else if (rec.freq === "weekly") d.setDate(d.getDate() + 7 * rec.interval);
    else break;
  }
  return occ;
}
