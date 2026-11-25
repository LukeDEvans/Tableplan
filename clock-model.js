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

// ── iPhone-style Clock helpers (Luke, 2026-11-20) ───────────────────────────

// "America/Argentina/Buenos_Aires" → "Buenos Aires"
export function cityFromZone(zone) {
  const last = String(zone || "").split("/").pop() || "";
  return last.replace(/_/g, " ").replace(/^GMT$/, "GMT");
}

// Minutes the zone is ahead of UTC at `date`.
export function zoneOffsetMinutes(zone, date = new Date()) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(date).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
    return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  } catch { return 0; }
}

// The zone's wall-clock time split for display: { time: "7:05", ampm: "AM", dayKey }
export function zoneTimeParts(zone, date = new Date()) {
  const fmt = (o) => new Intl.DateTimeFormat("en-US", { timeZone: zone, ...o }).format(date);
  try {
    const [time, ampm] = fmt({ hour: "numeric", minute: "2-digit", hour12: true }).split(/\s+/);
    return { time, ampm: ampm || "", dayKey: fmt({ year: "numeric", month: "2-digit", day: "2-digit" }) };
  } catch {
    return { time: "--:--", ampm: "", dayKey: "" };
  }
}

// "Today, +0HRS" / "Tomorrow, +6HRS" / "Yesterday, −5:30HRS" against `homeZone`.
export function worldClockSubtitle(zone, homeZone, date = new Date()) {
  const diff = zoneOffsetMinutes(zone, date) - zoneOffsetMinutes(homeZone, date);
  const day = zoneTimeParts(zone, date).dayKey;
  const home = zoneTimeParts(homeZone, date).dayKey;
  const word = day === home ? "Today" : day > home ? "Tomorrow" : "Yesterday";
  const sign = diff < 0 ? "−" : "+";
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${word}, ${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}HRS`;
}

// Fastest and slowest finished laps (ids by lap number), only once there are two.
export function lapExtremes(laps = []) {
  if (!Array.isArray(laps) || laps.length < 2) return { best: null, worst: null };
  let best = laps[0];
  let worst = laps[0];
  for (const l of laps) {
    if (l.split < best.split) best = l;
    if (l.split > worst.split) worst = l;
  }
  return best.n === worst.n ? { best: null, worst: null } : { best: best.n, worst: worst.n };
}

// Alarms kept on the device as records ({ id, hour, minute, label, weekdays,
// enabled, nativeId }) so one can be switched off and on like the iPhone's. The
// phone's AlarmKit list is the truth for what will ring:
// • a record whose alarm is no longer scheduled is switched off (a one-time alarm
//   that has rung goes off, as on the iPhone);
// • a scheduled alarm no record knows (made before records existed) becomes one.
export function reconcileAlarms(records = [], native = []) {
  const live = new Map((native || []).filter((a) => a && a.kind !== "timer" && a.id).map((a) => [a.id, a]));
  const known = new Set();
  const out = (records || []).filter((r) => r && r.id).map((r) => {
    if (r.nativeId && live.has(r.nativeId)) { known.add(r.nativeId); return r; }
    return r.enabled || r.nativeId ? { ...r, enabled: false, nativeId: null } : r;
  });
  for (const [id, a] of live) {
    if (known.has(id)) continue;
    out.push({ id: `alarm-${id}`, hour: Number(a.hour) || 0, minute: Number(a.minute) || 0, label: a.label || "Alarm", weekdays: Array.isArray(a.weekdays) ? a.weekdays : [], enabled: true, nativeId: id });
  }
  return out.sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
}

// The iPhone's repeat wording in the alarm row and editor.
export function alarmRepeatText(days) {
  const set = new Set((days || []).filter((d) => WEEKDAYS.includes(d)));
  if (!set.size) return "";
  if (set.size === 7) return "every day";
  const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  if (set.size === 5 && weekdays.every((d) => set.has(d))) return "weekdays";
  if (set.size === 2 && set.has("saturday") && set.has("sunday")) return "weekends";
  if (set.size === 1) return `every ${[...set][0][0].toUpperCase()}${[...set][0].slice(1)}`;
  return WEEKDAYS.filter((d) => set.has(d)).map((d) => SHORT[d]).join(" ");
}

// Recent timer durations, newest first, one per duration+label, at most 8.
export function addRecentTimer(recents = [], { seconds, label = "" }) {
  if (!seconds) return recents || [];
  const key = `${seconds}|${label}`;
  return [{ seconds, label }, ...(recents || []).filter((r) => `${r.seconds}|${r.label || ""}` !== key)].slice(0, 8);
}

// "10 min", "1 hr, 30 min", "45 sec"
export function durationWords(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h && `${h} hr`, m && `${m} min`, sec && `${sec} sec`].filter(Boolean).join(", ") || "0 sec";
}
