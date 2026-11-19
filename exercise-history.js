// Exercise history — sorting a workout's logged entries (Luke, 2026-11-19).
// Pure: no DOM, no app state. The recording window's History view (app.js,
// toggleRecordingHistory) offers the sorts that fit the workout's kind; Date,
// newest first, is the default. Tapping the chosen sort again flips its order.

const KM_PER_MILE = 1.609344;
const KG_TO_LB = 2.20462;

// Each sort: key, label, the order it starts in, and how to read a log's value.
// A log with no value for a sort always sinks to the bottom, whatever the order.
const SORTS = {
  date: { key: "date", label: "Date", dir: "desc", value: (log) => String(log?.date || log?.createdAt || "") || null },
  duration: { key: "duration", label: "Time", dir: "desc", value: logMinutes },
  distance: { key: "distance", label: "Distance", dir: "desc", value: logKm },
  speed: { key: "speed", label: "Speed", dir: "desc", value: logKmPerHour },
  sets: { key: "sets", label: "Sets done", dir: "desc", value: (log) => countTrue(log?.setCompletion) || null },
  heaviest: { key: "heaviest", label: "Heaviest", dir: "desc", value: logHeaviestLb },
  rating: { key: "rating", label: "Rating", dir: "desc", value: (log) => ({ easy: 3, ok: 2, hard: 1 })[log?.gameRating] || null },
  name: { key: "name", label: "Event", dir: "asc", value: (log) => String(log?.gameName || "").trim().toLowerCase() || null },
};

const SORTS_BY_TYPE = {
  timed: ["date", "duration", "distance", "speed"],
  reps: ["date", "sets", "heaviest"],
  game: ["date", "rating", "name"],
};

/** The sorts offered for a workout kind, in display order. */
export function historySortOptions(type) {
  return (SORTS_BY_TYPE[type] || SORTS_BY_TYPE.timed).map((key) => {
    const { label, dir } = SORTS[key];
    return { key, label, dir };
  });
}

/** The sort to use: the asked-for one if this kind offers it, else Date newest first. */
export function resolveHistorySort(type, sort) {
  const offered = historySortOptions(type);
  const match = offered.find((option) => option.key === sort?.key);
  if (!match) return { key: "date", dir: "desc" };
  return { key: match.key, dir: sort.dir === "asc" || sort.dir === "desc" ? sort.dir : match.dir };
}

/** Tapping a sort: the same one flips its order; another starts in its own order. */
export function nextHistorySort(type, current, tappedKey) {
  const now = resolveHistorySort(type, current);
  if (now.key === tappedKey) return { key: tappedKey, dir: now.dir === "desc" ? "asc" : "desc" };
  return resolveHistorySort(type, { key: tappedKey });
}

/** A new array of logs in the given order. Ties fall back to newest date first. */
export function sortHistoryLogs(logs, type, sort) {
  const { key, dir } = resolveHistorySort(type, sort);
  const read = SORTS[key].value;
  const sign = dir === "asc" ? 1 : -1;
  const byDateDesc = (a, b) => compare(SORTS.date.value(b), SORTS.date.value(a));
  return (Array.isArray(logs) ? logs : [])
    .map((log) => ({ log, value: read(log) }))
    .sort((a, b) => {
      const aMissing = a.value == null;
      const bMissing = b.value == null;
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      const primary = aMissing ? 0 : sign * compare(a.value, b.value);
      return primary || byDateDesc(a.log, b.log);
    })
    .map((entry) => entry.log);
}

/** "32.4 km/h" (or mph when the log is in miles); "" when there's no speed. */
export function formatLogSpeed(log) {
  const kmh = logKmPerHour(log);
  if (kmh == null) return "";
  const miles = String(log?.distanceUnit || "km") === "mi";
  const value = miles ? kmh / KM_PER_MILE : kmh;
  return `${value.toFixed(1)} ${miles ? "mph" : "km/h"}`;
}

function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function num(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function logMinutes(log) {
  const minutes = num(log?.timedHours) * 60 + num(log?.timedMinutes) + num(log?.timedSeconds) / 60;
  return minutes > 0 ? minutes : null;
}

function logKm(log) {
  const whole = String(log?.distanceWhole || "").trim();
  if (!whole && !String(log?.distanceDecimal || "").trim()) return null;
  const decimal = String(log?.distanceDecimal || "").trim();
  const distance = num(`${whole || "0"}.${decimal || "0"}`);
  if (distance <= 0) return null;
  return String(log?.distanceUnit || "km") === "mi" ? distance * KM_PER_MILE : distance;
}

function logKmPerHour(log) {
  const km = logKm(log);
  const minutes = logMinutes(log);
  return km != null && minutes != null ? km / (minutes / 60) : null;
}

function logHeaviestLb(log) {
  const weights = Object.values(log?.repWeights || {})
    .map((text) => {
      const value = num(text);
      return /kg/i.test(String(text)) ? value * KG_TO_LB : value;
    })
    .filter((value) => value > 0);
  return weights.length ? Math.max(...weights) : null;
}

function countTrue(map) {
  return Object.values(map || {}).filter(Boolean).length;
}
