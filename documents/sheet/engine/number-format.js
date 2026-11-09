// Number formats (SPREADSHEET_DESIGN.md §5): Sheets/Excel format codes, used to draw
// cells, by TEXT() and when writing Excel files. formatValue(value, code) → { text, color }.
//
// Supported: up to four sections (positive;negative;zero;text) with [Red]/[Color5]/
// [#hex] colours and [>100] conditions; 0 # ? digit placeholders, decimals, thousands
// separators (and trailing commas scaling by 1000), %, scientific (0.00E+00),
// fractions (# ?/?, # ??/16), literal "text", \x, _x (a space), *x (repeat — drawn as
// one), @ (the text); dates and times: d dd ddd dddd m mm mmm mmmm mmmmm yy yyyy h hh
// m mm (minutes after h / before s) s ss .0 .00 AM/PM A/P, elapsed [h] [m] [s].
// "General" (and an empty code) is Sheets' automatic display.

import { numberToText, ymdFromSerial, timeFromSerial, isErr } from "./values.js";

const COLORS = { black: "#000000", blue: "#0000ff", cyan: "#00ffff", green: "#00ff00", magenta: "#ff00ff", red: "#ff0000", white: "#ffffff", yellow: "#ffff00" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Named formats the toolbar offers (Sheets' Format › Number list, US locale).
export const FORMATS = Object.freeze({
  general: "General",
  number: "#,##0.00",
  percent: "0.00%",
  scientific: "0.00E+00",
  accounting: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)',
  financial: "#,##0.00;(#,##0.00)",
  currency: '"$"#,##0.00',
  currencyRounded: '"$"#,##0',
  date: "m/d/yyyy",
  time: "h:mm:ss AM/PM",
  datetime: "m/d/yyyy h:mm:ss",
  duration: "[h]:mm:ss",
  text: "@",
});

const cache = new Map();

export function formatValue(value, code = "General") {
  if (value === null || value === undefined) return { text: "" };
  if (isErr(value)) return { text: value.code };
  if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE" };
  const fmt = compile(code || "General");
  if (typeof value === "string") {
    const sec = fmt.text;
    if (!sec) return { text: value };
    return { text: renderText(sec, value), color: sec.color };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return { text: "#NUM!" };
  const sec = pickSection(fmt, value);
  if (!sec) return { text: generalNumber(value) };
  if (sec.general) return { text: (sec.neg && value < 0 ? "-" : "") + generalNumber(sec.neg ? Math.abs(value) : value), color: sec.color };
  const v = sec.useAbs ? Math.abs(value) : value;
  return { text: renderNumber(sec, v), color: sec.color };
}

// Sheets' "Automatic" for numbers in a cell: up to 10 decimals shown, scientific when huge.
export function generalNumber(n) {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e11 || abs < 1e-9) {
    const s = n.toExponential(2).replace("e+", "E+").replace("e-", "E-");
    return s.replace(/E([+-])(\d)$/, "E$10$2");
  }
  const s = Number(n.toPrecision(11)).toString();
  return /e/i.test(s) ? numberToText(n) : s;
}

function pickSection(fmt, v) {
  const secs = fmt.num;
  if (!secs.length) return null;
  // conditions: [>100] etc. (first two sections may have them)
  if (secs.some((s) => s.cond)) {
    for (const s of secs) if (!s.cond || testCond(s.cond, v)) return { ...s, useAbs: !!s.cond && v < 0 && secs.indexOf(s) > 0 };
    return secs[secs.length - 1];
  }
  if (secs.length === 1) return { ...secs[0], neg: true, useAbs: false };
  if (v > 0 || (v === 0 && secs.length < 3)) return { ...secs[0], useAbs: false };
  if (v < 0) return { ...secs[1], useAbs: true };
  return { ...secs[2], useAbs: false };
}
const testCond = ({ op, n }, v) => (op === ">" ? v > n : op === ">=" ? v >= n : op === "<" ? v < n : op === "<=" ? v <= n : op === "=" ? v === n : v !== n);

// ---- compiling a code ------------------------------------------------------------------

function splitSections(code) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') inQ = !inQ;
    if (!inQ && ch === "\\") { cur += ch + (code[i + 1] ?? ""); i++; continue; }
    if (!inQ && ch === ";") { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function compile(code) {
  if (cache.has(code)) return cache.get(code);
  const parts = splitSections(code);
  const secs = parts.map(compileSection);
  let text = null;
  const num = [];
  secs.forEach((s, i) => {
    if (s.isText || (i === 3)) text = s;
    else num.push(s);
  });
  if (secs.length < 4 && !text && secs.some((s) => s.hasAt)) text = secs.find((s) => s.hasAt);
  const out = { num: num.filter((s) => !s.isText), text };
  if (cache.size > 500) cache.clear();
  cache.set(code, out);
  return out;
}

function compileSection(src) {
  const sec = { tokens: [], color: undefined, cond: null, general: false, isText: false, hasAt: false, date: false, elapsed: false };
  let s = src;
  // leading [..] blocks: colour, condition, locale
  for (;;) {
    const m = /^\[([^\]]*)\]/.exec(s);
    if (!m) break;
    const b = m[1];
    const lower = b.toLowerCase();
    if (COLORS[lower]) sec.color = COLORS[lower];
    else if (/^color\s*\d+$/i.test(b)) sec.color = undefined;
    else if (/^#[0-9a-f]{6}$/i.test(b)) sec.color = b;
    else if (/^(<=|>=|<>|<|>|=)\s*-?\d+(\.\d+)?$/.test(b)) { const mm = /^(<=|>=|<>|<|>|=)\s*(-?\d+(?:\.\d+)?)$/.exec(b); sec.cond = { op: mm[1], n: Number(mm[2]) }; }
    else if (/^\$/.test(b)) { /* locale/currency tag: [$€-407] → its symbol */ const sym = b.slice(1).split("-")[0]; sec.tokens.push({ k: "lit", v: sym }); }
    else if (/^(h+|m+|s+)$/i.test(b)) break; // elapsed time, handled below
    else { /* unknown: ignore */ }
    s = s.slice(m[0].length);
  }
  if (/^general$/i.test(s.trim()) || s.trim() === "") { sec.general = true; return sec; }
  const T = sec.tokens;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const rest = s.slice(i);
    let m;
    if (ch === '"') { const j = s.indexOf('"', i + 1); T.push({ k: "lit", v: s.slice(i + 1, j < 0 ? s.length : j) }); i = j < 0 ? s.length : j; continue; }
    if (ch === "\\") { T.push({ k: "lit", v: s[i + 1] ?? "" }); i++; continue; }
    if (ch === "_") { T.push({ k: "lit", v: " " }); i++; continue; }
    if (ch === "*") { i++; continue; } // fill: drawn without repeating
    if (ch === "@") { T.push({ k: "at" }); sec.hasAt = true; continue; }
    if ((m = /^\[(h+|m+|s+)\]/i.exec(rest))) { T.push({ k: "el", v: m[1][0].toLowerCase(), n: m[1].length }); sec.date = true; sec.elapsed = true; i += m[0].length - 1; continue; }
    if ((m = /^(AM\/PM|am\/pm|A\/P|a\/p)/.exec(rest))) { T.push({ k: "ampm", v: m[1] }); sec.date = true; i += m[0].length - 1; continue; }
    if ((m = /^(y+|d+|h+|s+|m+)/i.exec(rest))) { T.push({ k: "dt", v: m[1][0].toLowerCase(), n: m[1].length }); sec.date = true; i += m[0].length - 1; continue; }
    if ((m = /^[Ee][+-]/.exec(rest))) { T.push({ k: "exp", sign: rest[1] }); i += 1; continue; }
    if ("0#?".includes(ch)) { T.push({ k: "digit", v: ch }); continue; }
    if (ch === ".") { T.push({ k: "dot" }); continue; }
    if (ch === ",") { T.push({ k: "comma" }); continue; }
    if (ch === "%") { T.push({ k: "pct" }); continue; }
    if (ch === "/") { T.push({ k: "slash" }); continue; }
    T.push({ k: "lit", v: ch });
  }
  if (sec.hasAt && !T.some((t) => t.k === "digit" || t.k === "dt" || t.k === "el")) sec.isText = true;
  if (sec.date) fixMinutes(T);
  return sec;
}

// "m" after h or before s means minutes, not months.
function fixMinutes(T) {
  const dts = T.map((t, i) => [t, i]).filter(([t]) => t.k === "dt" || t.k === "el");
  for (let j = 0; j < dts.length; j++) {
    const [t] = dts[j];
    if (t.k !== "dt" || t.v !== "m" || t.n > 2) continue;
    const prev = dts[j - 1]?.[0], next = dts[j + 1]?.[0];
    if ((prev && (prev.v === "h")) || (next && next.v === "s")) t.v = "M"; // minutes
  }
}

// ---- rendering --------------------------------------------------------------------------

function renderText(sec, s) {
  return sec.tokens.map((t) => (t.k === "at" ? s : t.k === "lit" ? t.v : "")).join("");
}

function renderNumber(sec, v) {
  if (sec.date) return renderDate(sec, v);
  const T = sec.tokens;
  // where the number parts are
  const pct = T.filter((t) => t.k === "pct").length;
  let x = v * Math.pow(100, pct);
  const expAt = T.findIndex((t) => t.k === "exp");
  const slashAt = T.findIndex((t) => t.k === "slash");
  if (slashAt >= 0 && T.some((t) => t.k === "digit")) return renderFraction(sec, x);
  // trailing commas after the last digit scale by 1000 each
  let lastDigit = -1;
  T.forEach((t, i) => { if (t.k === "digit") lastDigit = i; });
  let scale = 0;
  for (let i = lastDigit + 1; i < T.length && T[i].k === "comma"; i++) scale++;
  x /= Math.pow(1000, scale);
  const numToks = T.filter((t, i) => (t.k === "digit" || t.k === "dot" || (t.k === "comma" && i < lastDigit) || t.k === "exp"));
  const dot = numToks.findIndex((t) => t.k === "dot");
  const expTok = numToks.findIndex((t) => t.k === "exp");
  const intToks = numToks.slice(0, dot >= 0 ? dot : expTok >= 0 ? expTok : numToks.length).filter((t) => t.k === "digit");
  const fracToks = dot >= 0 ? numToks.slice(dot + 1, expTok >= 0 ? expTok : numToks.length).filter((t) => t.k === "digit") : [];
  const expToks = expTok >= 0 ? numToks.slice(expTok + 1).filter((t) => t.k === "digit") : [];
  const grouping = T.some((t, i) => t.k === "comma" && i < lastDigit && i > T.findIndex((q) => q.k === "digit"));
  const neg = x < 0;
  x = Math.abs(x);
  let exponent = 0;
  if (expAt >= 0) {
    if (x !== 0) {
      const intDigits = Math.max(1, intToks.length);
      exponent = Math.floor(Math.log10(x)) - (intDigits - 1);
      x = x / Math.pow(10, exponent);
      const r = Number(x.toFixed(fracToks.length));
      if (r >= Math.pow(10, intDigits)) { x /= 10; exponent += 1; }
    }
  }
  let fixed = roundFixed(x, fracToks.length);
  let [ip, fp = ""] = fixed.split(".");
  // integer digits
  let intStr = ip === "0" && !intToks.some((t) => t.v === "0") ? "" : ip;
  const minInt = intToks.filter((t) => t.v === "0").length;
  const padQ = intToks.filter((t) => t.v === "?").length;
  if (intStr.length < minInt) intStr = intStr.padStart(minInt, "0");
  if (grouping) intStr = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (padQ && intStr.length < minInt + padQ) intStr = intStr.padStart(minInt + padQ, " ");
  // fraction digits: trailing zeros removed for #, spaced for ?
  let fracStr = "";
  for (let i = 0; i < fracToks.length; i++) fracStr += fp[i] ?? "0";
  for (let i = fracToks.length - 1; i >= 0; i--) {
    if (fracToks[i].v === "0") break;
    if (fracStr[i] !== "0") break;
    fracStr = fracStr.slice(0, i) + (fracToks[i].v === "?" ? " " : "") + fracStr.slice(i + 1);
  }
  // build: walk tokens, emitting literals around the number
  let out = "", numDone = false;
  for (let i = 0; i < T.length; i++) {
    const t = T[i];
    if (t.k === "lit") out += t.v;
    else if (t.k === "pct") out += "%";
    else if (t.k === "at") out += "";
    else if ((t.k === "digit" || t.k === "dot" || t.k === "comma" || t.k === "exp") && !numDone) {
      numDone = true;
      let s = intStr;
      if (dot >= 0) s += (fracStr.length || fracToks.length ? "." : ".") + fracStr;
      if (dot >= 0 && fracToks.length === 0) s = intStr + ".";
      if (expAt >= 0) {
        const e = Math.abs(exponent);
        const sign = exponent < 0 ? "-" : (T[expAt].sign === "+" ? "+" : "");
        s += "E" + sign + String(e).padStart(Math.max(1, expToks.filter((q) => q.v === "0").length), "0");
      }
      out += s;
      // skip the rest of the number tokens (literals between them are kept below)
      while (i + 1 < T.length && ["digit", "dot", "comma", "exp"].includes(T[i + 1].k)) i++;
    } else if (t.k === "digit" || t.k === "dot" || t.k === "comma" || t.k === "exp") { /* number already written */ }
  }
  if (neg && !(Number(fixed) === 0 && expAt < 0)) out = "-" + out;
  return out;
}

function roundFixed(x, digits) {
  const p = Math.pow(10, digits);
  const y = Number((x * p).toPrecision(15));
  const r = Math.floor(y + 0.5);
  if (r >= 1e21) return x.toFixed(Math.min(digits, 20));
  const s = String(r).padStart(digits + 1, "0");
  return digits ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s;
}

function renderFraction(sec, x) {
  const T = sec.tokens;
  const slash = T.findIndex((t) => t.k === "slash");
  const denToks = [];
  for (let i = slash + 1; i < T.length && (T[i].k === "digit" || (T[i].k === "lit" && /\d/.test(T[i].v))); i++) denToks.push(T[i]);
  const fixedDen = denToks.length && denToks.every((t) => t.k === "lit") ? Number(denToks.map((t) => t.v).join("")) : null;
  const maxDen = fixedDen || Math.pow(10, denToks.filter((t) => t.k === "digit").length) - 1;
  // whole part present if there are digits before a literal space before the numerator
  const numStart = (() => { let i = slash - 1; while (i >= 0 && T[i].k === "digit") i--; return i + 1; })();
  const hasWhole = T.slice(0, numStart).some((t) => t.k === "digit");
  const neg = x < 0; x = Math.abs(x);
  let whole = hasWhole ? Math.floor(x) : 0;
  let frac = x - whole;
  let bestN = 0, bestD = 1;
  if (fixedDen) { bestD = fixedDen; bestN = Math.round(frac * fixedDen); }
  else {
    let bestErr = Infinity;
    for (let d = 1; d <= maxDen; d++) { const n = Math.round(frac * d); const e = Math.abs(frac - n / d); if (e < bestErr - 1e-12) { bestErr = e; bestN = n; bestD = d; } }
  }
  if (bestN === bestD && hasWhole) { whole += 1; bestN = 0; }
  const wholeStr = hasWhole ? (whole || bestN === 0 ? String(whole) : "") : "";
  const fracStr = bestN === 0 && hasWhole ? "" : `${bestN}/${bestD}`;
  return `${neg ? "-" : ""}${[wholeStr, fracStr].filter(Boolean).join(" ") || "0"}`;
}

function renderDate(sec, v) {
  if (v < 0) return "#NUM!";
  const T = sec.tokens;
  const hasAmPm = T.some((t) => t.k === "ampm");
  // rounding to the shown precision of seconds
  const secDec = (() => { const i = T.findIndex((t) => t.k === "dt" && t.v === "s"); if (i < 0) return 0; let n = 0; if (T[i + 1]?.k === "dot") for (let j = i + 2; j < T.length && T[j].k === "digit" && T[j].v === "0"; j++) n++; return n; })();
  const step = Math.pow(10, secDec);
  const totalMs = Math.round(v * 86400 * step) / step;
  const serial = totalMs / 86400;
  const d = ymdFromSerial(serial);
  const t = timeFromSerial(serial);
  const secsFloat = Math.round((totalMs % 60) * step) / step;
  let out = "";
  for (let i = 0; i < T.length; i++) {
    const k = T[i];
    if (k.k === "lit") { out += k.v; continue; }
    if (k.k === "el") {
      const total = totalMs;
      const val = k.v === "h" ? Math.floor(total / 3600) : k.v === "m" ? Math.floor(total / 60) : Math.floor(total);
      out += String(val).padStart(k.n, "0");
      continue;
    }
    if (k.k === "ampm") { const pm = t.h >= 12; out += k.v.length > 3 ? (pm ? "PM" : "AM") : (k.v[0] === "a" ? (pm ? "p" : "a") : (pm ? "P" : "A")); continue; }
    if (k.k === "dot" && secDec && T[i - 1]?.k === "dt" && T[i - 1].v === "s") {
      out += "." + String(Math.round((secsFloat - Math.floor(secsFloat)) * step)).padStart(secDec, "0");
      while (T[i + 1]?.k === "digit") i++;
      continue;
    }
    if (k.k === "dt") {
      switch (k.v) {
        case "y": out += k.n <= 2 ? String(d.y % 100).padStart(2, "0") : String(d.y); break;
        case "d": out += k.n === 1 ? d.d : k.n === 2 ? String(d.d).padStart(2, "0") : k.n === 3 ? DAYS[d.wd].slice(0, 3) : DAYS[d.wd]; break;
        case "m": out += k.n === 1 ? d.m : k.n === 2 ? String(d.m).padStart(2, "0") : k.n === 3 ? MONTHS[d.m - 1].slice(0, 3) : k.n === 4 ? MONTHS[d.m - 1] : MONTHS[d.m - 1][0]; break;
        case "M": out += k.n === 1 ? t.mi : String(t.mi).padStart(2, "0"); break;
        case "h": { const h = hasAmPm ? ((t.h + 11) % 12) + 1 : t.h; out += k.n === 1 ? h : String(h).padStart(2, "0"); break; }
        case "s": out += k.n === 1 ? t.s : String(t.s).padStart(2, "0"); break;
        default: break;
      }
      continue;
    }
    if (k.k === "digit") out += k.v === "0" ? "0" : "";
    if (k.k === "slash") out += "/";
    if (k.k === "dot") out += ".";
    if (k.k === "comma") out += ",";
    if (k.k === "pct") out += "%";
  }
  return out;
}

// Is this code a date/time format (so a cell's value reads as a date)?
export function isDateFormat(code) {
  const f = compile(code || "General");
  return f.num.some((s) => s.date);
}
