// meal-plan-time.js — pure helper: which meal column the meal plan should open
// on for the current time of day (e.g. noon → Lunch). DOM-free; see
// test/meal-plan-time.test.js.

// Start-of-window (minutes after midnight) for well-known meal labels. Matches
// mealplan-ui.js MEAL_TIME_WINDOWS (Breakfast until 11:00, Lunch 11–15, Dinner
// 15:00 on) plus a few common custom labels.
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
