// meal-plan-state.js — pure, DOM-free helpers for meal-plan state edits that
// need to be safe/testable outside the createMealplanModule factory:
//   - snapshotWeekPlan / restoreWeekPlan: roll back an auto-fill that cleared a
//     day/week but then filled nothing (or hit a missing folder).
//   - hasMealAheadTask: make-ahead / prep-ahead task de-dupe across the Tasks
//     backlog and the scheduled day plans.
// Imported by mealplan-ui.js; see test/meal-plan-state.test.js.

// Same normalization mealplan-ui.js uses for task-title comparison.
function normalize(value) {
  return value.toLowerCase().replace(/^[\d\s./-]+/, "").replace(/\s+/g, " ").trim();
}

// Auto-fill clears a day/week before regenerating. Snapshot everything the clear
// touches (deep clone) so every early return (no rule filled, missing folders)
// can put the plan back exactly — otherwise the cleared in-memory plan is saved
// by the next persist (data loss). Pure: operates only on its arguments.
const PLAN_SNAPSHOT_FIELDS = ["slots", "combinedMealSections", "publishedSlots", "publishedCombinedMealSections", "mealPlanView"];
function clonePlanValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
export function snapshotWeekPlan(week, publishedWeeks, key) {
  const fields = {};
  PLAN_SNAPSHOT_FIELDS.forEach((field) => {
    fields[field] = { present: Object.prototype.hasOwnProperty.call(week || {}, field), value: clonePlanValue(week?.[field]) };
  });
  const hasPublished = !!publishedWeeks && Object.prototype.hasOwnProperty.call(publishedWeeks, key);
  return { fields, published: { present: hasPublished, value: hasPublished ? clonePlanValue(publishedWeeks[key]) : undefined } };
}
export function restoreWeekPlan(week, publishedWeeks, key, snapshot) {
  if (!week || !snapshot) return;
  PLAN_SNAPSHOT_FIELDS.forEach((field) => {
    const saved = snapshot.fields[field];
    if (saved.present) week[field] = clonePlanValue(saved.value);
    else delete week[field];
  });
  if (!publishedWeeks) return;
  if (snapshot.published.present) publishedWeeks[key] = clonePlanValue(snapshot.published.value);
  else delete publishedWeeks[key];
}

// Make-ahead / prep-ahead de-dupe: a task counts as already created if a task
// with the same title for this week is in the backlog OR already scheduled onto
// any day of any week in state.doPlans ({ [weekKey]: { [dayId]: tasks[] } }).
// Backlog tasks without a weekKey match every week (legacy behavior); scheduled
// tasks without one belong to the week they're planned in.
export function hasMealAheadTask(backlog, doPlans, title, key) {
  const wanted = normalize(String(title || ""));
  const matches = (task, fallbackWeek) => {
    if (!task || normalize(String(task.title || "")) !== wanted) return false;
    const taskWeek = task.weekKey || fallbackWeek;
    return !taskWeek || taskWeek === key;
  };
  if ((Array.isArray(backlog) ? backlog : []).some((task) => matches(task, ""))) return true;
  return Object.entries(doPlans && typeof doPlans === "object" ? doPlans : {}).some(([planWeek, days]) => (
    Object.values(days && typeof days === "object" ? days : {}).some((tasks) => (
      Array.isArray(tasks) && tasks.some((task) => matches(task, planWeek))
    ))
  ));
}
