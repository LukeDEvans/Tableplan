// Pure state helpers for the Tasks overlay (the Tasks window on the Calendar page).
// Kept free of DOM/app globals so the two behaviours the review flagged (T1 week
// isolation, T2 page-enable gating) are unit-testable independently of app.js.

// ── T1: week isolation ────────────────────────────────────────────────────────
// The task VIEW/data all read the app's shared prep week (currentWeek / weekKey()),
// which Meal Plan, Exercise, Grocery, etc. also use. To let the overlay browse task
// weeks WITHOUT moving those other views, app.js drives the shared week only for the
// duration of an overlay session: it stashes the shared week on open, points the
// shared week at the overlay's week while open, and restores it on close. This models
// that session so the isolation invariant — stepping the overlay never mutates the
// stashed shared week — can be tested. Dates are copied in/out so callers' Date
// objects are never mutated, and day math uses setDate (DST-safe, matching addDays).

export function beginTasksWeekSession(sharedWeek, openOnWeek) {
  return { sharedWeek: new Date(sharedWeek), overlayWeek: new Date(openOnWeek) };
}

// Step the overlay's week by whole weeks; returns the new overlay week. Never
// touches the stashed shared week.
export function stepTasksWeek(session, deltaWeeks) {
  const d = new Date(session.overlayWeek);
  d.setDate(d.getDate() + deltaWeeks * 7);
  session.overlayWeek = d;
  return d;
}

// End the session: the shared week to restore — unchanged since begin().
export function endTasksWeekSession(session) {
  return new Date(session.sharedWeek);
}

// ── T2: page-enable gating ────────────────────────────────────────────────────
// The Tasks bell is the only entry point into Tasks now, so it must honour the
// same page-enable policy as the (retired) Tasks page: if "do" is disabled in the
// user's page settings, the bell is hidden and cannot open Tasks. Single source of
// truth for the decision so the visible affordance and the open() guard can't drift.
export function tasksBellState(doEnabled) {
  return { hidden: !doEnabled, canOpen: !!doEnabled };
}
