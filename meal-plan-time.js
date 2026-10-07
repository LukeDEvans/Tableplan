// meal-plan-time.js — pure helper: which meal column the meal plan should open
// on for the current time of day (e.g. noon → Lunch). DOM-free; see
// test/meal-plan-time.test.js.

// Start-of-window (minutes after midnight) for well-known meal labels. Drives the
// open-on-now column and the column windows (mealTimeWindowForLabel):
// Breakfast until 11:00, Lunch 11–15, Dinner 15:00 on, plus a few common custom labels.
// Which meals a calendar EVENT lands on uses the narrower mealtimes further down.
const KNOWN_MEAL_STARTS = {
  breakfast: 0,
  brunch: 10 * 60,
  lunch: 11 * 60,
  "afternoon snack": 15 * 60,
  dinner: 15 * 60,
  supper: 15 * 60,
  dessert: 20 * 60
};

// Unlabeled/custom meal types are spread across waking hours (06:00–21:00) by
// position, so a 3-column custom plan still behaves like breakfast/lunch/dinner.
function spreadStart(index, count) {
  return 6 * 60 + Math.round((index * 15 * 60) / Math.max(1, count));
}

// labels: meal column labels in display order. minutes: minutes after midnight.
// Returns the index of the column whose window started most recently (ties go to
// the later column); before every window starts, the earliest-starting column.
export function mealColumnIndexForTime(labels, minutes) {
  const list = Array.isArray(labels) ? labels : [];
  if (!list.length) return 0;
  const starts = list.map((label, index) => (
    KNOWN_MEAL_STARTS[String(label || "").trim().toLowerCase()] ?? spreadStart(index, list.length)
  ));
  let chosen = -1;
  starts.forEach((start, index) => {
    if (start <= minutes && (chosen < 0 || start >= starts[chosen])) chosen = index;
  });
  if (chosen >= 0) return chosen;
  return starts.indexOf(Math.min(...starts));
}

export function minutesSinceMidnight(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

// The prep window runs Friday → Friday: the opening Friday holds only the last
// meal (dinner), while that Friday's earlier meals live on the PREVIOUS window's
// closing Friday. True when `date` is a Friday and the time-of-day meal is one
// of those earlier meals, i.e. "today" should open on the previous window.
export function isFridayBeforeLastMeal(labels, date = new Date()) {
  const list = Array.isArray(labels) ? labels : [];
  if (date.getDay() !== 5 || list.length < 2) return false;
  return mealColumnIndexForTime(list, minutesSinceMidnight(date)) < list.length - 1;
}

// Time-of-day window [start, end) in minutes for the meal column `label`, derived
// from the same start table as mealColumnIndexForTime: a column runs from its
// start until the next later-starting column (or midnight), and the
// earliest-starting column also covers the early morning (from 00:00). Label
// match is case-insensitive, so custom / lower-case meal types get a window.
// For the default Breakfast/Lunch/Dinner this reproduces the old fixed windows
// (0–11:00, 11:00–15:00, 15:00–24:00). Returns null if `label` isn't a column.
export function mealTimeWindowForLabel(labels, label) {
  const list = Array.isArray(labels) ? labels : [];
  const wanted = String(label || "").trim().toLowerCase();
  const index = list.findIndex((item) => String(item || "").trim().toLowerCase() === wanted);
  if (!wanted || index < 0) return null;
  const starts = list.map((item, i) => (
    KNOWN_MEAL_STARTS[String(item || "").trim().toLowerCase()] ?? spreadStart(i, list.length)
  ));
  const start = starts[index];
  const later = starts.filter((value) => value > start);
  const end = later.length ? Math.min(...later) : 24 * 60;
  return [start === Math.min(...starts) ? 0 : start, end];
}

// ── Which meals does a calendar event land on? ───────────────────────────────
// A meal COLUMN's window (above) tiles the whole day, so a workday touched every
// meal. What matters for planning is narrower: is the person away WHILE the meal
// is eaten? Each meal therefore has a MEALTIME — the stretch it's normally eaten
// in — and an event lands on the meal only when it takes up that stretch:
// an 08:00–16:00 shift lands on Lunch (breakfast and dinner are at home), an
// evening or overnight shift lands on Dinner.
const KNOWN_MEALTIMES = {
  breakfast: [6 * 60, 8 * 60],
  brunch: [10 * 60, 11 * 60 + 30],
  lunch: [11 * 60 + 30, 13 * 60 + 30],
  "afternoon snack": [15 * 60, 16 * 60],
  dinner: [17 * 60 + 30, 20 * 60],
  supper: [17 * 60 + 30, 20 * 60],
  dessert: [20 * 60, 21 * 60]
};
// An event lands on a meal when it overlaps the mealtime by at least this much…
export const MEAL_OVERLAP_MINUTES = 45;
// …or when it is a short event (under this long) that STARTS during the mealtime
// — a 7:30 dinner reservation belongs on Dinner even though it only clips the end.
export const SHORT_EVENT_MINUTES = 180;

// Mealtime [start, end) in minutes for the meal column `label`. Custom labels get
// the first two hours of their column's slice of the day (see spreadStart), cut
// short where the next column starts. Returns null if `label` isn't a column.
export function mealtimeForLabel(labels, label) {
  const list = Array.isArray(labels) ? labels : [];
  const wanted = String(label || "").trim().toLowerCase();
  const index = list.findIndex((item) => String(item || "").trim().toLowerCase() === wanted);
  if (!wanted || index < 0) return null;
  if (KNOWN_MEALTIMES[wanted]) return [...KNOWN_MEALTIMES[wanted]];
  const starts = list.map((item, i) => (
    KNOWN_MEAL_STARTS[String(item || "").trim().toLowerCase()] ?? spreadStart(i, list.length)
  ));
  const start = starts[index];
  const later = starts.filter((value) => value > start);
  return [start, Math.min(start + 120, later.length ? Math.min(...later) : 24 * 60)];
}

function clockMinutes(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// True for a timed event that ends on the day AFTER it starts without saying so
// with an end date (19:00–07:00): the remainder spills into the next morning.
export function eventRunsPastMidnight(event) {
  if (!event || event.allDay) return false;
  const start = clockMinutes(event.startTime);
  const end = clockMinutes(event.endTime);
  return start != null && end != null && end < start;
}

// The part of the day an event takes up, for one day it touches. `part` says
// which day of the event this is:
//   "single" — starts and ends this day          "start" — starts this day, runs past midnight
//   "mid"    — a whole day inside a longer event "end"   — began on an earlier day, ends this day
// Returns { allDay: true }, or { start, end, startsHere, duration } in minutes,
// or null when the event takes up none of this day.
export function eventDaySpan(event, part = "single") {
  if (!event) return null;
  if (part === "mid" || event.allDay) return { allDay: true };
  const start = clockMinutes(event.startTime);
  if (start == null) return { allDay: true };
  const end = clockMinutes(event.endTime);
  if (part === "end") {
    return end ? { start: 0, end, startsHere: false, duration: Infinity } : null;
  }
  if (part === "start") {
    return { start, end: 24 * 60, startsHere: true, duration: 24 * 60 - start + (end || 0) };
  }
  const stop = end != null && end > start ? end : start;
  return { start, end: stop, startsHere: true, duration: stop - start };
}

// Does that part of the day take up the mealtime? All-day events land on every meal.
export function spanCoversMealtime(span, mealtime) {
  if (!span || !Array.isArray(mealtime)) return false;
  if (span.allDay) return true;
  const [from, to] = mealtime;
  if (span.startsHere && span.duration < SHORT_EVENT_MINUTES && span.start >= from && span.start < to) return true;
  return Math.min(span.end, to) - Math.max(span.start, from) >= MEAL_OVERLAP_MINUTES;
}
