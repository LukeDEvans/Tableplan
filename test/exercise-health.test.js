import { describe, it, expect } from "vitest";
import {
  guessActivity, workoutForActivity, planSlotsForDate, fileHealthWorkout, healthLogFields,
  healthInbox, ringFractions, ringWeek, healthLogSummary, activityLabel, HEALTH_ACTIVITIES,
} from "../health-workouts.js";

// Midday UTC: the same calendar day in UTC and Minneapolis.
const row = (over = {}) => ({
  id: "0123456789abcdef0123456789abcdef",
  started_at: "2026-11-20T18:00:00Z",
  ended_at: "2026-11-20T18:31:05Z",
  activity: "run",
  duration_s: 1865,
  distance_m: 5000,
  energy_kcal: 352.4,
  hr_avg: 151.2,
  hr_max: 172,
  source: "Apple Watch",
  matched: null,
  ...over,
});
const lib = [
  { id: "w-run", title: "Morning Run", logs: [] },
  { id: "w-legs", title: "Legs", logs: [] },
  { id: "w-soccer", title: "Pickup soccer", logs: [] },
];

describe("activity guesses", () => {
  it("reads common workout titles", () => {
    expect(guessActivity("Morning Run")).toBe("run");
    expect(guessActivity("Bike to work")).toBe("cycle");
    expect(guessActivity("Legs")).toBe("strength");
    expect(guessActivity("Lake Harriet sailing")).toBe("sail");
    expect(guessActivity("Piano")).toBe("");
  });

  it("every activity has a label and an Exercise kind", () => {
    for (const [key, a] of Object.entries(HEALTH_ACTIVITIES)) {
      expect(key).toMatch(/^[a-z_]{1,32}$/); // the server's check
      expect(a.label).toBeTruthy();
      expect(["timed", "reps", "game"]).toContain(a.kind);
    }
    expect(activityLabel("nope")).toBe("Workout");
  });

  it("a taught workout wins; a guess counts only when it's the only one", () => {
    expect(workoutForActivity("run", lib)).toBe("w-run");
    const two = [...lib, { id: "w-run2", title: "Long run", logs: [] }];
    expect(workoutForActivity("run", two)).toBe("");
    expect(workoutForActivity("run", [...two, { id: "w-x", title: "Anything", healthActivity: "run" }])).toBe("w-x");
    // Taught something else → not a guess any more.
    expect(workoutForActivity("run", [{ id: "w-run", title: "Morning Run", healthActivity: "walk" }])).toBe("");
  });
});

describe("planned-week slots", () => {
  it("maps weekdays into the Friday-start week", () => {
    expect(planSlotsForDate("2026-11-24")).toEqual([{ weekKey: "2026-11-20", dayId: "tuesday" }]);
    expect(planSlotsForDate("2026-11-26")).toEqual([{ weekKey: "2026-11-20", dayId: "thursday" }]);
  });
  it("a Friday is this week's start and last week's finish", () => {
    expect(planSlotsForDate("2026-11-20")).toEqual([
      { weekKey: "2026-11-20", dayId: "friday-start" },
      { weekKey: "2026-11-13", dayId: "friday-finish" },
    ]);
  });
});

describe("filing a Health workout", () => {
  it("ticks the planned task that day when its workout matches", () => {
    const playPlans = { "2026-11-20": { "friday-start": [{ id: "t1", sourceWorkoutId: "w-run", done: false }] } };
    expect(fileHealthWorkout(row(), { workouts: lib, playPlans })).toEqual({
      action: "plan", workoutId: "w-run", weekKey: "2026-11-20", dayId: "friday-start", taskId: "t1", date: "2026-11-20",
    });
  });
  it("adds to the library workout when nothing is planned (or the plan is done)", () => {
    const playPlans = { "2026-11-20": { "friday-start": [{ id: "t1", sourceWorkoutId: "w-run", done: true }] } };
    expect(fileHealthWorkout(row(), { workouts: lib, playPlans })).toEqual({ action: "library", workoutId: "w-run", date: "2026-11-20" });
  });
  it("goes to the inbox when no workout takes the activity", () => {
    expect(fileHealthWorkout(row({ activity: "swim" }), { workouts: lib })).toEqual({ action: "inbox" });
  });
  it("is idempotent: a log already carrying the healthId means filed", () => {
    const filed = [{ id: "w-run", title: "Morning Run", logs: [{ id: "l1", healthId: row().id }] }];
    expect(fileHealthWorkout(row(), { workouts: filed })).toEqual({ action: "already", workoutId: "w-run", logId: "l1" });
  });
  it("skips dismissed workouts", () => {
    expect(fileHealthWorkout(row({ activity: "swim", matched: { dismissed: true } }), { workouts: lib })).toEqual({ action: "skip" });
  });
});

describe("log fields", () => {
  it("fills time, distance (in the workout's unit) and the Watch numbers", () => {
    const f = healthLogFields(row(), { kind: "timed", distanceUnit: "km" });
    expect(f).toMatchObject({
      date: "2026-11-20", timedHours: "0", timedMinutes: "31", timedSeconds: "05",
      distanceWhole: "5", distanceDecimal: "00", distanceUnit: "km",
      healthId: row().id, hrAvg: "151", hrMax: "172", kcal: "352", healthSeconds: "1865", healthSource: "Apple Watch",
    });
    expect(f.startTime).toMatch(/^\d{2}:\d{2}$/);
  });
  it("defaults to miles, rounded to the wheel's .05 steps", () => {
    const f = healthLogFields(row(), { kind: "timed" });
    expect([f.distanceWhole, f.distanceDecimal, f.distanceUnit]).toEqual(["3", "10", "mi"]); // 3.107 mi
  });
  it("strength gets no time or distance wheels; games get minutes", () => {
    const s = healthLogFields(row({ activity: "strength", distance_m: null }), { kind: "reps" });
    expect(s.timedMinutes).toBeUndefined();
    expect(s.distanceWhole).toBeUndefined();
    expect(s.hrAvg).toBe("151");
    expect(healthLogFields(row(), { kind: "game" }).gameDuration).toBe("31");
  });
  it("summarises only Health logs", () => {
    expect(healthLogSummary({ healthId: "x", hrAvg: "151", kcal: "352" })).toBe("151 bpm avg · 352 kcal");
    expect(healthLogSummary({ hrAvg: "151" })).toBe("");
  });
});

describe("inbox", () => {
  it("groups unfiled workouts by activity, newest group first", () => {
    const rows = [
      row({ id: "a".repeat(32), activity: "swim", started_at: "2026-11-01T18:00:00Z" }),
      row({ id: "b".repeat(32), activity: "swim", started_at: "2026-11-10T18:00:00Z" }),
      row({ id: "c".repeat(32), activity: "yoga", started_at: "2026-11-15T18:00:00Z" }),
      row({ id: "d".repeat(32), activity: "run" }), // files to Morning Run
      row({ id: "e".repeat(32), activity: "yoga", matched: { dismissed: true } }),
    ];
    const inbox = healthInbox(rows, { workouts: lib });
    expect(inbox.map((g) => [g.activity, g.rows.length])).toEqual([["yoga", 1], ["swim", 2]]);
    expect(inbox[1].rows[0].id).toBe("b".repeat(32));
  });
});

describe("rings", () => {
  it("fractions of each goal, zero without a goal", () => {
    expect(ringFractions({ move_kcal: 300, move_goal: 600, exercise_min: 45, exercise_goal: 30, stand_h: 6, stand_goal: 0 }))
      .toEqual({ move: 0.5, exercise: 1.5, stand: 0 });
  });
  it("the last seven days ending today", () => {
    const week = ringWeek([{ day: "2026-11-24", move_kcal: 1 }], new Date(2026, 10, 24));
    expect(week.map((d) => d.day)).toEqual(["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"]);
    expect(week[6].row).toEqual({ day: "2026-11-24", move_kcal: 1 });
    expect(week[0].row).toBeNull();
  });
});
