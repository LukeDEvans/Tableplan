// Playback speed: one shared value for every player, changed in steps of 0.25
// with the − / + buttons. Pure helpers only — app.js owns the stored value and
// the buttons.

export const SPEED_STEP = 0.25;
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 3;

// The nearest allowed speed (a multiple of 0.25 between 0.5 and 3). A value that
// isn't a usable number — nothing stored yet, or junk — is normal speed.
export function snapPlaybackSpeed(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 1;
  const snapped = Math.round(n / SPEED_STEP) * SPEED_STEP;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, snapped));
}

// One step slower (dir < 0) or faster (dir > 0), stopping at the ends.
export function stepPlaybackSpeed(current, dir) {
  const from = snapPlaybackSpeed(current);
  if (!dir) return from;
  return snapPlaybackSpeed(from + (dir > 0 ? SPEED_STEP : -SPEED_STEP));
}

// "1×", "1.25×", "2.5×" — trailing zeros trimmed.
export function formatSpeedLabel(v) {
  return `${Number(v).toFixed(2).replace(/\.?0+$/, "")}×`;
}

// The control itself: − value +. Every copy on the page is kept in step by
// app.js (syncSpeedSteppersUi), and one delegated click handler serves them all.
export function speedStepperHtml(speed, { id = "" } = {}) {
  const s = snapPlaybackSpeed(speed);
  return `<div class="speed-stepper"${id ? ` id="${id}"` : ""} role="group" aria-label="Playback speed">
    <button class="speed-step-btn" type="button" data-speed-step="-1" aria-label="Slower"${s <= SPEED_MIN ? " disabled" : ""}>&minus;</button>
    <span class="speed-step-val" aria-live="polite">${formatSpeedLabel(s)}</span>
    <button class="speed-step-btn" type="button" data-speed-step="1" aria-label="Faster"${s >= SPEED_MAX ? " disabled" : ""}>+</button>
  </div>`;
}
