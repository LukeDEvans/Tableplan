// Date and time functions (SPREADSHEET_DESIGN.md §3, pass A). Dates are serial
// numbers (day 0 = 1899-12-30); fmt tells the grid how to show a result when the
// cell has no format of its own.

import { def, flatValues, omitted, NUM_ERR, VAL_ERR, ERR, err, isErr, isEmpty } from "./helpers.js";
import { serialFromYMD, ymdFromSerial, timeFromSerial, textToDateSerial, serialFromMs } from "../values.js";

const D = { fmt: "date" };
const floorDay = Math.floor;

function dateArg(v) {
  // a date argument may be a serial or date text
  return v;
}

function addMonths(serial, months) {
  const { y, m, d } = ymdFromSerial(serial);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = target.getUTCFullYear(), tm = target.getUTCMonth() + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return serialFromYMD(ty, tm, Math.min(d, last));
}

function weekendMask(weekend) {
  // returns Set of weekday numbers (0=Sun) that are weekends
  if (omitted(weekend) || weekend === 1) return new Set([0, 6]);
  if (typeof weekend === "string") {
    if (!/^[01]{7}$/.test(weekend) || weekend === "1111111") return null;
    const s = new Set();
    [...weekend].forEach((ch, i) => { if (ch === "1") s.add((i + 1) % 7); }); // Monday first
    return s;
  }
  const map = { 2: [0, 1], 3: [1, 2], 4: [2, 3], 5: [3, 4], 6: [4, 5], 7: [5, 6], 11: [0], 12: [1], 13: [2], 14: [3], 15: [4], 16: [5], 17: [6] };
  return map[weekend] ? new Set(map[weekend]) : null;
}
function holidaySet(ctx, holidays) {
  if (omitted(holidays)) return new Set();
  const out = new Set();
  for (const v of flatValues(ctx, holidays)) {
    if (isErr(v)) throw Object.assign(new Error("e"), { sheetError: v });
    if (typeof v === "number") out.add(floorDay(v));
    else if (typeof v === "string") { const d = textToDateSerial(v); if (d !== null) out.add(floorDay(d)); }
  }
  return out;
}
const weekday0 = (serial) => ymdFromSerial(serial).wd;

function networkdays(ctx, start, end, weekend, holidays) {
  const we = weekendMask(weekend);
  if (!we) return NUM_ERR("Invalid weekend.");
  const hs = holidaySet(ctx, holidays);
  let s = floorDay(start), e = floorDay(end);
  const sign = s <= e ? 1 : -1;
  if (sign < 0) [s, e] = [e, s];
  if (e - s > 1_000_000) return NUM_ERR("NETWORKDAYS range too large.");
  let n = 0;
  for (let d = s; d <= e; d++) if (!we.has(weekday0(d)) && !hs.has(d)) n++;
  return n * sign;
}
function workday(ctx, start, days, weekend, holidays) {
  const we = weekendMask(weekend);
  if (!we) return NUM_ERR("Invalid weekend.");
  if (we.size === 7) return NUM_ERR("No working days.");
  const hs = holidaySet(ctx, holidays);
  let d = floorDay(start);
  let left = Math.trunc(days);
  const step = left < 0 ? -1 : 1;
  let guard = 0;
  while (left !== 0) { d += step; if (!we.has(weekday0(d)) && !hs.has(d)) left -= step; if (++guard > 5_000_000) return NUM_ERR("WORKDAY range too large."); }
  return d;
}

function days360(s, e, european) {
  let a = ymdFromSerial(s), b = ymdFromSerial(e);
  let d1 = a.d, d2 = b.d;
  const lastFeb = (x) => x.m === 2 && ymdFromSerial(serialFromYMD(x.y, x.m, x.d) + 1).m === 3;
  if (european) { if (d1 === 31) d1 = 30; if (d2 === 31) d2 = 30; }
  else {
    if (lastFeb(a)) { if (lastFeb(b)) d2 = 30; d1 = 30; }
    if (d1 === 31) d1 = 30;
    if (d2 === 31 && d1 >= 30) d2 = 30;
  }
  return (b.y - a.y) * 360 + (b.m - a.m) * 30 + (d2 - d1);
}

function yearfrac(s, e, basis) {
  if (s > e) [s, e] = [e, s];
  s = floorDay(s); e = floorDay(e);
  switch (basis) {
    case 0: return days360(s, e, false) / 360;
    case 1: {
      // as Sheets: whole years, then the rest over the length of the year it falls in
      const a = ymdFromSerial(s);
      const anniv = (k) => { const last = new Date(Date.UTC(a.y + k, a.m, 0)).getUTCDate(); return serialFromYMD(a.y + k, a.m, Math.min(a.d, last)); };
      let k = 0;
      while (anniv(k + 1) <= e) k++;
      const from = anniv(k), to = anniv(k + 1);
      return k + (e - from) / (to - from);
    }
    case 2: return (e - s) / 360;
    case 3: return (e - s) / 365;
    case 4: return days360(s, e, true) / 360;
    default: return NUM_ERR("YEARFRAC basis must be 0 to 4.");
  }
}

function isoWeek(serial) {
  const { y, m, d } = ymdFromSerial(serial);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
}

export function dateFunctions() {
  return [
    def("DATE", { args: ["int", "int", "int"], ...D }, (ctx, y, m, d) => {
      if (y < 0 || y >= 10000) return NUM_ERR("DATE year out of range.");
      if (y < 1900) y += 1900;
      const s = serialFromYMD(y, m, d);
      return s < 0 ? NUM_ERR("DATE evaluates to an out of range value.") : s;
    }),
    def("DATEVALUE", { args: ["scalar"] }, (ctx, v) => {
      if (typeof v === "number") return floorDay(v);
      const s = typeof v === "string" ? textToDateSerial(v) : null;
      return s === null ? VAL_ERR(`DATEVALUE parameter '${v}' cannot be parsed to date/time.`) : floorDay(s);
    }),
    def("TIMEVALUE", { args: ["scalar"] }, (ctx, v) => {
      const s = typeof v === "string" ? textToDateSerial(v) : null;
      return s === null ? VAL_ERR(`TIMEVALUE parameter '${v}' cannot be parsed to date/time.`) : s - floorDay(s);
    }),
    def("DAY", { args: ["number"] }, (ctx, s) => (s < 0 ? NUM_ERR("DAY of a negative date.") : ymdFromSerial(s).d)),
    def("MONTH", { args: ["number"] }, (ctx, s) => (s < 0 ? NUM_ERR("MONTH of a negative date.") : ymdFromSerial(s).m)),
    def("YEAR", { args: ["number"] }, (ctx, s) => (s < 0 ? NUM_ERR("YEAR of a negative date.") : ymdFromSerial(s).y)),
    def("HOUR", { args: ["number"] }, (ctx, s) => (s < 0 ? NUM_ERR("HOUR of a negative time.") : timeFromSerial(s).h)),
    def("MINUTE", { args: ["number"] }, (ctx, s) => (s < 0 ? NUM_ERR("MINUTE of a negative time.") : timeFromSerial(s).mi)),
    def("SECOND", { args: ["number"] }, (ctx, s) => (s < 0 ? NUM_ERR("SECOND of a negative time.") : timeFromSerial(s).s)),
    def("TIME", { args: ["int", "int", "int"], fmt: "time" }, (ctx, h, m, s) => {
      const total = h * 3600 + m * 60 + s;
      if (total < 0) return NUM_ERR("TIME evaluates to an out of range value.");
      return (total % 86400) / 86400;
    }),
    def("DAYS", { args: ["number", "number"] }, (ctx, e, s) => floorDay(e) - floorDay(s)),
    def("DAYS360", { args: ["number", "number", "bool"], min: 2, max: 3 }, (ctx, s, e, eu) => days360(s, e, !omitted(eu) && eu)),
    def("DATEDIF", { args: ["number", "number", "text"] }, (ctx, s, e, unit) => {
      s = floorDay(s); e = floorDay(e);
      if (s > e) return NUM_ERR("DATEDIF start date must be before the end date.");
      const a = ymdFromSerial(s), b = ymdFromSerial(e);
      let months = (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
      switch (unit.toUpperCase()) {
        case "D": return e - s;
        case "M": return months;
        case "Y": return Math.floor(months / 12);
        case "MD": { let d = b.d - a.d; if (d < 0) { const prevLast = new Date(Date.UTC(b.y, b.m - 1, 0)).getUTCDate(); d += prevLast; } return d; }
        case "YM": return months % 12;
        case "YD": {
          // as Sheets (and Excel): the end's month and day, counted within the start's year
          const s0 = serialFromYMD(a.y, a.m, a.d);
          let e0 = serialFromYMD(a.y, b.m, b.d);
          if (e0 < s0) e0 = serialFromYMD(a.y + 1, b.m, b.d);
          return e0 - s0;
        }
        default: return NUM_ERR(`DATEDIF unit '${unit}' is not valid.`);
      }
    }),
    def("EDATE", { args: ["number", "int"], ...D }, (ctx, s, m) => addMonths(floorDay(s), m)),
    def("EOMONTH", { args: ["number", "int"], ...D }, (ctx, s, m) => { const x = addMonths(serialFromYMD(ymdFromSerial(s).y, ymdFromSerial(s).m, 1), m + 1); return x - 1; }),
    def("ISOWEEKNUM", { args: ["number"] }, (ctx, s) => isoWeek(s)),
    def("WEEKDAY", { args: ["number", "int"], min: 1, max: 2 }, (ctx, s, type) => {
      const wd = weekday0(s); // 0 = Sunday
      const t = omitted(type) ? 1 : type;
      if (t === 1 || t === 17) return wd + 1;
      if (t === 2 || t === 11) return ((wd + 6) % 7) + 1;
      if (t === 3) return (wd + 6) % 7;
      if (t >= 12 && t <= 16) { const start = t - 10; return ((wd - start + 7) % 7) + 1; } // 12 = Tuesday first…
      return NUM_ERR("WEEKDAY type out of range.");
    }),
    def("WEEKNUM", { args: ["number", "int"], min: 1, max: 2 }, (ctx, s, type) => {
      const t = omitted(type) ? 1 : type;
      if (t === 21) return isoWeek(s);
      const startDay = t === 1 || t === 17 ? 0 : t === 2 || t === 11 ? 1 : t >= 12 && t <= 16 ? t - 10 : null;
      if (startDay === null) return NUM_ERR("WEEKNUM type out of range.");
      const { y } = ymdFromSerial(s);
      const jan1 = serialFromYMD(y, 1, 1);
      const offset = (weekday0(jan1) - startDay + 7) % 7;
      return Math.floor((floorDay(s) - jan1 + offset) / 7) + 1;
    }),
    def("NETWORKDAYS", { args: ["number", "number", "any"], min: 2, max: 3 }, (ctx, s, e, h) => networkdays(ctx, s, e, 1, h)),
    def("NETWORKDAYS.INTL", { args: ["number", "number", "scalar", "any"], min: 2, max: 4 }, (ctx, s, e, w, h) => networkdays(ctx, s, e, w, h)),
    def("WORKDAY", { args: ["number", "number", "any"], min: 2, max: 3, ...D }, (ctx, s, n, h) => workday(ctx, s, n, 1, h)),
    def("WORKDAY.INTL", { args: ["number", "number", "scalar", "any"], min: 2, max: 4, ...D }, (ctx, s, n, w, h) => workday(ctx, s, n, w, h)),
    def("YEARFRAC", { args: ["number", "number", "int"], min: 2, max: 3 }, (ctx, s, e, b) => yearfrac(s, e, omitted(b) ? 0 : b)),
    def("NOW", { args: [], fmt: "datetime" }, (ctx) => ctx.nowSerial()),
    def("TODAY", { args: [], ...D }, (ctx) => ctx.today()),
    def("EPOCHTODATE", { args: ["number", "int"], min: 1, max: 2, fmt: "datetime" }, (ctx, t, unit) => {
      const u = omitted(unit) ? 1 : unit;
      const ms = u === 1 ? t * 1000 : u === 2 ? t : u === 3 ? t / 1000 : null;
      if (ms === null) return NUM_ERR("EPOCHTODATE unit must be 1, 2 or 3.");
      if (t < 0) return NUM_ERR("EPOCHTODATE of a negative time.");
      return serialFromMs(ms);
    }),
  ];
}

export { dateArg, isEmpty, err, ERR };
