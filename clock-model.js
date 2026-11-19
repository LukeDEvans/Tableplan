// clock-model.js — Clock's alarms, timers and stopwatch (UTILITIES_MENU_DESIGN.md §6).
// Pure. Alarms and timers ring through AlarmKit on the iPhone (LiveClock plugin,
// iOS 26+); the laptop has timers and the stopwatch only (decision 11).

export const WEEKDAYS = Object.freeze(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]);
const SHORT = { sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat" };

// Stopwatch / timer display: "1:02:03", "02:03.45" (with hundredths), "2:03".
export function formatDuration(ms, { hundredths = false } = {}) {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  const pad = (n) => String(n).padStart(2, "0");
  if (hundredths) return `${h ? `${h}:${pad(m)}` : pad(m)}:${pad(s)}.${pad(cs)}`;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// "7:30 AM"
export function formatAlarmTime(hour, minute) {
  const h = ((Number(hour) % 24) + 24) % 24;
  const m = String(Math.max(0, Math.min(59, Number(minute) || 0))).padStart(2, "0");
  return `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

// ["monday",…] → "Weekdays" / "Weekends" / "Every day" / "Mon, Wed" / "Once"
export function repeatLabel(days) {
  const set = new Set((days || []).filter((d) => WEEKDAYS.includes(d)));
  if (!set.size) return "Once";
  if (set.size === 7) return "Every day";
  const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  if (set.size === 5 && weekdays.every((d) => set.has(d))) return "Weekdays";
  if (set.size === 2 && set.has("saturday") && set.has("sunday")) return "Weekends";
  return WEEKDAYS.filter((d) => set.has(d)).map((d) => SHORT[d]).join(", ");
}

// Seconds from h/m/s fields, clamped to 24 h.
export function timerSeconds({ hours = 0, minutes = 0, seconds = 0 } = {}) {
  const total = (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
  return Math.max(0, Math.min(24 * 3600, Math.round(total)));
}

// ── Stopwatch (kept on the device; survives the sheet closing) ──────────────
export function createStopwatch() { return { running: false, startedAt: 0, elapsed: 0, laps: [] }; }
export function stopwatchElapsed(sw, now = Date.now()) { return sw.elapsed + (sw.running ? now - sw.startedAt : 0); }
export function stopwatchStart(sw, now = Date.now()) { return sw.running ? sw : { ...sw, running: true, startedAt: now }; }
export function stopwatchStop(sw, now = Date.now()) { return sw.running ? { ...sw, running: false, elapsed: stopwatchElapsed(sw, now), startedAt: 0 } : sw; }
export function stopwatchReset() { return createStopwatch(); }
export function stopwatchLap(sw, now = Date.now()) {
  if (!sw.running) return sw;
  const total = stopwatchElapsed(sw, now);
  const prev = sw.laps.length ? sw.laps[0].total : 0;
  return { ...sw, laps: [{ n: sw.laps.length + 1, split: total - prev, total }, ...sw.laps].slice(0, 99) };
}

// ── Timers (a list, several can run at once) ───────────────────────────────
// { id, label, seconds, endsAt (ms, running), remaining (ms, paused), source }
export function startTimer(seconds, { label = "", now = Date.now(), id = `timer-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, source = "clock" } = {}) {
  return { id, label: String(label || "").slice(0, 60), seconds, endsAt: now + seconds * 1000, remaining: null, source };
}
export function timerRemaining(t, now = Date.now()) { return t.endsAt ? Math.max(0, t.endsAt - now) : Math.max(0, t.remaining || 0); }
export function pauseTimer(t, now = Date.now()) { return t.endsAt ? { ...t, remaining: timerRemaining(t, now), endsAt: null } : t; }
export function resumeTimer(t, now = Date.now()) { return t.endsAt ? t : { ...t, endsAt: now + (t.remaining || 0), remaining: null }; }
export function timerDone(t, now = Date.now()) { return Boolean(t.endsAt) && t.endsAt <= now; }

// Common presets on the timer screen.
export const TIMER_PRESETS = Object.freeze([60, 180, 300, 600, 900, 1800]);
