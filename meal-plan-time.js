// meal-plan-time.js — pure helper: which meal column the meal plan should open
// on for the current time of day (e.g. noon → Lunch). DOM-free; see
// test/meal-plan-time.test.js.

// Start-of-window (minutes after midnight) for well-known meal labels. Drives both the
// open-on-now column and the meal-context event windows (mealTimeWindowForLabel):
// Breakfast until 11:00, Lunch 11–15, Dinner 15:00 on, plus a few common custom labels.
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
