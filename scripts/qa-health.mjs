// qa-health.mjs — Apple Health on the Exercise page (HEALTH_DESIGN.md) in the real
// app at phone width, with fake Health rows standing in for the tables (local dev's
// __liveQA.healthForQa). Needs the dev server (npm run dev:local).
//   node scripts/qa-health.mjs [url] [screenshotDir]
// Checks: a Watch run on a planned day ticks the task and fills its log (time,
// distance in the workout's unit, heart rate, real start time); an older run lands in
// the library workout; unmatched swims and yoga go to the inbox; the rings strip and
// inbox button fit a 360px screen; filing the swims makes a new workout that takes
// both; dismissing yoga closes the window by itself; filed rows are marked.
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
const SHOTS = process.argv[3] || "";
if (SHOTS && !existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
const ARGS = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };

async function launch() {
  try { return await chromium.launch({ ...ARGS, channel: "chrome" }); } catch {}
  return chromium.launch(ARGS);
}

let failures = 0, checked = 0;
const check = (ok, m) => { checked++; if (!ok) { failures++; console.log(`  ✖ ${m}`); } else console.log(`  ✓ ${m}`); };

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, hasTouch: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.classList.contains("app-authed") || !document.getElementById("lockDevSignInBtn")?.hidden, { timeout: 20000 });
if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) {
  await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"));
}
await page.waitForTimeout(600);

const setup = await page.evaluate(() => {
  const pad = (n) => String(n).padStart(2, "0");
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const at = (daysAgo, h) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, 5, 0, 0); return d; };
  const yesterday = at(1, 7);
  // The Friday-start week holding yesterday, and its day id.
  const ids = ["friday-start", "saturday", "sunday", "monday", "tuesday", "wednesday", "thursday"];
  const back = yesterday.getDay() >= 5 ? yesterday.getDay() - 5 : yesterday.getDay() + 2;
  const weekStart = new Date(yesterday); weekStart.setDate(weekStart.getDate() - back);
  const workouts = [
    { id: "w-run", title: "Morning Run", type: "timed", exerciseDetails: { type: "timed" }, logs: [{ id: "old", date: key(at(30, 7)), timedMinutes: "30", distanceWhole: "5", distanceDecimal: "00", distanceUnit: "km" }] },
    { id: "w-legs", title: "Legs", type: "reps", exerciseDetails: { type: "reps" }, logs: [] },
  ];
  const playPlans = { [key(weekStart)]: { [ids[back]]: [{ id: "t-run", title: "Morning Run", sourceWorkoutId: "w-run", done: false }] } };
  window.__liveQA.seedWorkoutsForQa(workouts, playPlans);
  const iso = (d, mins) => [d.toISOString(), new Date(d.getTime() + mins * 60000).toISOString()];
  const row = (id, d, activity, mins, extra = {}) => { const [s, e] = iso(d, mins); return { id: id.repeat(32).slice(0, 32), started_at: s, ended_at: e, activity, duration_s: mins * 60, distance_m: null, energy_kcal: 300, hr_avg: 140, hr_max: 165, source: "Apple Watch", matched: null, ...extra }; };
  const rows = [
    row("a", yesterday, "run", 32, { distance_m: 6000 }),
    row("b", at(10, 18), "run", 25, { distance_m: 4000 }),
    row("c", at(3, 12), "swim", 40, { distance_m: 1500 }),
    row("d", at(20, 12), "swim", 35, { distance_m: 1200 }),
    row("e", at(2, 20), "yoga", 30),
  ];
  const days = Array.from({ length: 7 }, (_, i) => ({ day: key(at(6 - i, 12)), move_kcal: 300 + i * 60, move_goal: 600, exercise_min: 20 + i * 5, exercise_goal: 30, stand_h: 8 + i, stand_goal: 12 }));
  window.__liveQA.healthForQa({ rows, days });
  window.__liveQA.openExerciseForQa();
  return { weekKey: key(weekStart), dayId: ids[back], yesterday: key(yesterday) };
});

await page.waitForSelector(".health-strip", { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(500);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/health-exercise.png` });

let qa = await page.evaluate(() => window.__liveQA.healthForQa());
const run = qa.workouts.find((w) => w.id === "w-run");
const planned = run.logs.find((l) => l.healthId === "a".repeat(32));
const older = run.logs.find((l) => l.healthId === "b".repeat(32));
check(Boolean(planned), "yesterday's Watch run filled a Morning Run log");
check(planned?.taskId === "t-run" && qa.playPlans[setup.weekKey]?.[setup.dayId]?.[0]?.done === true, "…and ticked the planned task");
check(planned?.distanceUnit === "km" && planned?.distanceWhole === "6" && planned?.timedMinutes === "32", `…in km like the last log (${planned?.distanceWhole}.${planned?.distanceDecimal} ${planned?.distanceUnit}, ${planned?.timedMinutes} min)`);
check(planned?.hrAvg === "140" && planned?.startTime === "07:05", `…with heart rate and the real start (${planned?.hrAvg} bpm, ${planned?.startTime})`);
check(Boolean(older) && !older.taskId, "the older run went to the library workout");
check(qa.qa.rows.filter((r) => r.matched?.filed).length === 2, "both runs are marked filed");

const strip = await page.evaluate(() => {
  const el = document.querySelector(".health-strip");
  const btn = document.querySelector("[data-health-inbox]");
  return {
    shown: Boolean(el), rings: document.querySelectorAll(".health-strip-day svg").length,
    count: btn?.querySelector(".health-inbox-count")?.textContent || "",
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    stripRight: el ? el.getBoundingClientRect().right : 0,
  };
});
check(strip.shown && strip.rings === 7, `rings strip with 7 days (${strip.rings})`);
check(strip.count === "3", `inbox shows 3 unfiled (${strip.count})`);
check(strip.overflow <= 0 && strip.stripRight <= 360, `fits 360px (overflow ${strip.overflow}, strip right ${Math.round(strip.stripRight)})`);

await page.click("[data-health-inbox]");
await page.waitForSelector("#healthInboxDialog[open]");
if (SHOTS) await page.screenshot({ path: `${SHOTS}/health-inbox.png` });
const groups = await page.evaluate(() => [...document.querySelectorAll("[data-health-group]")].map((g) => g.dataset.healthGroup));
check(groups.join(",") === "yoga,swim", `inbox groups newest first (${groups.join(",")})`);

await page.selectOption('[data-health-group="swim"] select', "__new");
await page.click('[data-health-group="swim"] [data-health-file]');
await page.waitForTimeout(300);
qa = await page.evaluate(() => window.__liveQA.healthForQa());
const swim = qa.workouts.find((w) => w.healthActivity === "swim");
check(swim?.title === "Swim" && swim.logs.filter((l) => l.healthId).length === 2, `filing swims made "Swim" with both (${swim?.logs?.length})`);
check(await page.evaluate(() => document.querySelectorAll("[data-health-group]").length === 1), "one group left");

page.once("dialog", (d) => d.accept());
await page.click('[data-health-group="yoga"] [data-health-dismiss]');
await page.waitForTimeout(300);
check(await page.evaluate(() => !document.getElementById("healthInboxDialog").open), "the window closed by itself when empty");
check(await page.evaluate(() => !document.querySelector("[data-health-inbox]")), "inbox button gone");
qa = await page.evaluate(() => window.__liveQA.healthForQa());
check(qa.qa.rows.find((r) => r.activity === "yoga")?.matched?.dismissed === true, "yoga marked dismissed");

// The workout's history shows the Watch line.
await page.click('[data-record-workout="w-run"]');
await page.waitForTimeout(300);
const histBtn = await page.$("#viewActiveExerciseLogBtn");
if (histBtn) {
  await histBtn.click();
  await page.waitForTimeout(300);
  const hist = await page.evaluate(() => ({ watch: document.querySelectorAll(".workout-log-health").length, sorts: [...document.querySelectorAll("[data-history-sort]")].map((b) => b.dataset.historySort) }));
  check(hist.watch === 2, `history marks the 2 Watch entries (${hist.watch})`);
  check(hist.sorts.includes("hr") && hist.sorts.includes("kcal"), `history offers Avg HR and Calories (${hist.sorts.join(",")})`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/health-history.png` });
} else {
  console.log("  (history button not found; skipped)");
}

check(!errors.length, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
await browser.close();
console.log(`\n${checked - failures}/${checked} checks passed`);
process.exit(failures ? 1 : 0);
