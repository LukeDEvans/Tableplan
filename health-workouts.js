// Apple Health workouts → the Exercise page (HEALTH_DESIGN.md §5; Luke, 2026-11-24).
// Pure: no DOM, no app state, no network. app.js hands in the Health rows
// (live_health_workouts / live_health_days), the workout library and the planned
// weeks, and applies what this returns.
//
// Filing a Watch workout, in order:
//   1. a log already carries its healthId          → "already" (another device filed it)
//   2. a planned task that day is for a workout of this activity → "plan" (tick it, fill its log)
//   3. a library workout of this activity          → "library" (add a log that day)
//   4. otherwise                                   → "inbox" ("From Apple Watch", Luke files it once)
// A workout's activity is what Luke taught it (`healthActivity`, set when he files from
// the inbox); a guess from its title counts only when exactly one workout guesses that
// activity and no workout was taught it — so nothing is filed somewhere surprising.

const KM_PER_MILE = 1.609344;

// Liv's words for sports (also the server's `activity` column), with a label and the
// Exercise kind a new workout of it would be.
export const HEALTH_ACTIVITIES = {
  run: { label: "Run", kind: "timed" },
  walk: { label: "Walk", kind: "timed" },
  hike: { label: "Hike", kind: "timed" },
  cycle: { label: "Ride", kind: "timed" },
  swim: { label: "Swim", kind: "timed" },
  row: { label: "Row", kind: "timed" },
  elliptical: { label: "Elliptical", kind: "timed" },
  stairs: { label: "Stairs", kind: "timed" },
  ski: { label: "Ski", kind: "timed" },
  ski_xc: { label: "Cross-country ski", kind: "timed" },
  snowboard: { label: "Snowboard", kind: "timed" },
  skate: { label: "Skate", kind: "timed" },
  paddle: { label: "Paddle", kind: "timed" },
  sail: { label: "Sail", kind: "timed" },
  cardio: { label: "Cardio", kind: "timed" },
  hiit: { label: "HIIT", kind: "timed" },
  dance: { label: "Dance", kind: "timed" },
  strength: { label: "Strength", kind: "reps" },
  core: { label: "Core", kind: "reps" },
  yoga: { label: "Yoga", kind: "reps" },
  pilates: { label: "Pilates", kind: "reps" },
  cooldown: { label: "Cooldown", kind: "reps" },
  soccer: { label: "Soccer", kind: "game" },
  basketball: { label: "Basketball", kind: "game" },
  tennis: { label: "Tennis", kind: "game" },
  pickleball: { label: "Pickleball", kind: "game" },
  golf: { label: "Golf", kind: "game" },
  hockey: { label: "Hockey", kind: "game" },
  volleyball: { label: "Volleyball", kind: "game" },
  disc: { label: "Disc sports", kind: "game" },
  other: { label: "Workout", kind: "timed" },
};

export function activityLabel(activity) {
  return HEALTH_ACTIVITIES[activity]?.label || "Workout";
}

// Title words → activity, for the one-time guess. Order matters: "trail run" is a run.
const GUESSES = [
  [/\b(run|running|jog|jogging|5k|10k|half marathon|marathon)\b/, "run"],
  [/\b(walk|walking)\b/, "walk"],
  [/\b(hike|hiking)\b/, "hike"],
  [/\b(bike|biking|cycle|cycling|ride|spin|peloton)\b/, "cycle"],
  [/\b(swim|swimming|laps)\b/, "swim"],
  [/\b(row|rowing|erg)\b/, "row"],
  [/\belliptical\b/, "elliptical"],
  [/\b(stairs|stair ?master|stepmill)\b/, "stairs"],
  [/\b(cross[- ]country ski|nordic ski)/, "ski_xc"],
  [/\b(ski|skiing)\b/, "ski"],
  [/\bsnowboard/, "snowboard"],
  [/\b(skate|skating)\b/, "skate"],
  [/\b(kayak|canoe|paddle|sup)\b/, "paddle"],
  [/\b(sail|sailing)\b/, "sail"],
  [/\b(hiit|intervals?)\b/, "hiit"],
  [/\b(yoga)\b/, "yoga"],
  [/\b(pilates)\b/, "pilates"],
  [/\b(core|abs)\b/, "core"],
  [/\b(lift|lifting|weights?|strength|legs|arms|chest|back|shoulders|squat|deadlift|bench)\b/, "strength"],
  [/\b(soccer|futbol|football)\b/, "soccer"],
  [/\bbasketball\b/, "basketball"],
  [/\btennis\b/, "tennis"],
  [/\bpickleball\b/, "pickleball"],
  [/\bgolf\b/, "golf"],
  [/\bhockey\b/, "hockey"],
  [/\bvolleyball\b/, "volleyball"],
  [/\b(frisbee|ultimate|disc golf)\b/, "disc"],
  [/\bdanc(e|ing)\b/, "dance"],
];

export function guessActivity(title) {
  const t = String(title || "").toLowerCase();
  for (const [re, activity] of GUESSES) if (re.test(t)) return activity;
  return "";
}

// activity → the library workout that takes it, or "" when none or ambiguous.
export function workoutForActivity(activity, workouts) {
  const list = Array.isArray(workouts) ? workouts : [];
  const taught = list.filter((w) => w?.healthActivity === activity);
  if (taught.length) return taught[0].id;
  // A workout already taught another activity never counts as a guess.
  const guessed = list.filter((w) => !w?.healthActivity && guessActivity(w?.title) === activity);
  return guessed.length === 1 ? guessed[0].id : "";
}

const pad = (n) => String(n).padStart(2, "0");
export function localDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function hhmm(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// The planned-week slots a date falls in. Weeks start on Friday (the meal plan's
// week, Luke 2026-11-17); a Friday is both that week's "friday-start" and the
// previous week's "friday-finish".
const DAY_IDS = ["friday-start", "saturday", "sunday", "monday", "tuesday", "wednesday", "thursday"];
export function planSlotsForDate(dateKey) {
  const [y, m, d] = String(dateKey).split("-").map(Number);
  if (!y || !m || !d) return [];
  const date = new Date(y, m - 1, d);
  const dow = date.getDay();
  const back = dow >= 5 ? dow - 5 : dow + 2;
  const start = new Date(y, m - 1, d - back);
  const slots = [{ weekKey: localDateKey(start), dayId: DAY_IDS[back] }];
  if (back === 0) slots.push({ weekKey: localDateKey(new Date(y, m - 1, d - 7)), dayId: "friday-finish" });
  return slots;
}

// Where a Health workout goes. `rows` of other workouts aren't needed: one at a time.
export function fileHealthWorkout(row, { workouts = [], playPlans = {} } = {}) {
  if (!row?.id) return { action: "skip" };
  for (const w of workouts) {
    const log = (w?.logs || []).find((l) => l?.healthId === row.id);
    if (log) return { action: "already", workoutId: w.id, logId: log.id };
  }
  if (row.matched?.dismissed) return { action: "skip" };
  const workoutId = workoutForActivity(row.activity, workouts);
  if (!workoutId) return { action: "inbox" };
  const dateKey = localDateKey(new Date(row.started_at));
  for (const { weekKey, dayId } of planSlotsForDate(dateKey)) {
    const tasks = playPlans?.[weekKey]?.[dayId];
    const task = Array.isArray(tasks) ? tasks.find((t) => t?.sourceWorkoutId === workoutId && !t?.done) : null;
    if (task) return { action: "plan", workoutId, weekKey, dayId, taskId: task.id, date: dateKey };
  }
  return { action: "library", workoutId, date: dateKey };
}

// The log fields a Health workout fills in, for a workout of `kind`. Distance goes in
// the unit Luke last used for this workout (miles when he hasn't logged one).
export function healthLogFields(row, { kind = "timed", distanceUnit = "" } = {}) {
  const start = new Date(row.started_at);
  const end = new Date(row.ended_at);
  const secs = Math.max(0, Math.round(Number(row.duration_s) || 0));
  const out = {
    date: localDateKey(start),
    startTime: Number.isNaN(start.getTime()) ? "" : hhmm(start),
    endTime: Number.isNaN(end.getTime()) ? "" : hhmm(end),
    healthId: row.id,
    healthSource: String(row.source || "").slice(0, 60),
    healthSeconds: String(secs),
    hrAvg: row.hr_avg ? String(Math.round(row.hr_avg)) : "",
    hrMax: row.hr_max ? String(Math.round(row.hr_max)) : "",
    kcal: row.energy_kcal ? String(Math.round(row.energy_kcal)) : "",
  };
  if (kind === "timed") {
    out.timedHours = String(Math.floor(secs / 3600));
    out.timedMinutes = pad(Math.floor((secs % 3600) / 60));
    out.timedSeconds = pad(secs % 60);
    const meters = Number(row.distance_m);
    if (meters > 0) {
      const unit = ["km", "mi", "m", "yd"].includes(distanceUnit) ? distanceUnit : "mi";
      const value = unit === "km" ? meters / 1000 : unit === "mi" ? meters / 1000 / KM_PER_MILE : unit === "yd" ? meters / 0.9144 : meters;
      // The distance wheels hold a whole number and hundredths in steps of .05.
      const rounded = Math.round(value * 20) / 20;
      const whole = Math.floor(rounded);
      out.distanceWhole = String(whole);
      out.distanceDecimal = pad(Math.round((rounded - whole) * 100));
      out.distanceUnit = unit;
    }
  } else if (kind === "game") {
    out.gameDuration = String(Math.round(secs / 60));
  }
  return out;
}

// The inbox: unfiled, undismissed workouts, newest first, grouped by activity so one
// tap can file every past workout of a kind.
export function healthInbox(rows, { workouts = [], playPlans = {} } = {}) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (fileHealthWorkout(row, { workouts, playPlans }).action !== "inbox") continue;
    const g = groups.get(row.activity) || { activity: row.activity, label: activityLabel(row.activity), rows: [] };
    g.rows.push(row);
    groups.set(row.activity, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, rows: g.rows.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at))) }))
    .sort((a, b) => String(b.rows[0].started_at).localeCompare(String(a.rows[0].started_at)));
}

// Rings: fraction of each goal (0 when there's no goal), for one day row.
export function ringFractions(day) {
  const frac = (v, goal) => (Number(goal) > 0 ? Math.max(0, Number(v) || 0) / Number(goal) : 0);
  return {
    move: frac(day?.move_kcal, day?.move_goal),
    exercise: frac(day?.exercise_min, day?.exercise_goal),
    stand: frac(day?.stand_h, day?.stand_goal),
  };
}

// The last `count` days ending today, each with its ring row (or null).
export function ringWeek(days, today = new Date(), count = 7) {
  const byDay = new Map((Array.isArray(days) ? days : []).map((d) => [String(d.day), d]));
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = localDateKey(date);
    out.push({ day: key, weekday: date.toLocaleDateString("en-US", { weekday: "narrow" }), row: byDay.get(key) || null });
  }
  return out;
}

// A log line's Watch part: "142 bpm avg · 410 kcal" ("" when the log isn't from Health).
export function healthLogSummary(log) {
  if (!log?.healthId) return "";
  const parts = [];
  if (log.hrAvg) parts.push(`${log.hrAvg} bpm avg`);
  if (log.kcal) parts.push(`${log.kcal} kcal`);
  return parts.join(" · ");
}
