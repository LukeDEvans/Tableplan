#!/usr/bin/env node
// Headless QA for the grouped page menus and the Recreate pages (Luke, 2026-10-17):
// the landing links and the page-title menu as six accordion groups (one open at a
// time), Listen and Weather back in the menus, Scores as its own page, Exercise and
// Leisure as rows of cards, and Explore's Local / State / Country / World rows.
// Drives the real app against the dev server at phone width. Places are seeded
// into Explore's device cache, so nothing is looked up on the network.
//
//   node scripts/qa-page-groups.mjs [url]   (default http://localhost:4174/; needs `npm run dev:local`)
//   QA_GROUPS_SHOT=/path/prefix → also saves 390px screenshots
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
const SHOT = process.env.QA_GROUPS_SHOT || "";
const LAUNCH = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
const results = [];
const check = (cond, name, detail) => {
  results.push([cond ? "PASS" : "FAIL", name]);
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
};

async function launch() {
  try { return await chromium.launch({ ...LAUNCH, channel: "chrome" }); } catch { /* none */ }
  try { return await chromium.launch(LAUNCH); } catch { /* none */ }
  const p = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(p)) return chromium.launch({ ...LAUNCH, executablePath: p });
  throw new Error("No Chromium available");
}

const HOME = { label: "Minneapolis, MN", latitude: 44.9778, longitude: -93.265, timezone: "America/Chicago" };
const PLACES = {
  [`home:${HOME.latitude.toFixed(3)},${HOME.longitude.toFixed(3)}`]: { lat: 44.9778, lng: -93.265, country: "us", state: "Minnesota", at: Date.now() },
  "stillwater, mn": { lat: 45.0564, lng: -92.8085, country: "us", state: "Minnesota", at: Date.now() },
  "duluth, mn": { lat: 46.7867, lng: -92.1005, country: "us", state: "Minnesota", at: Date.now() },
  "chicago, il": { lat: 41.8781, lng: -87.6298, country: "us", state: "Illinois", at: Date.now() },
  "amsterdam": { lat: 52.3676, lng: 4.9041, country: "nl", state: "North Holland", at: Date.now() },
};
const TRIPS = [
  { id: "t-still", name: "Stillwater weekend", destination: "Stillwater, MN", status: "idea" },
  { id: "t-dul", name: "North Shore", destination: "Duluth, MN", status: "idea" },
  { id: "t-chi", name: "Chicago", destination: "Chicago, IL", status: "planning", startDate: "2026-11-20", endDate: "2026-11-23" },
  { id: "t-ams", name: "Amsterdam", destination: "Amsterdam", status: "idea" },
  { id: "t-mys", name: "Somewhere", destination: "Atlantis", status: "idea" },
];
const WORKOUTS = [
  { id: "w-bench", title: "Bench press", type: "reps", exerciseDetails: { type: "reps", reps: [{ lift: "Bench", sets: "3", reps: "8", weight: "135" }] } },
  { id: "w-run", title: "Run", type: "timed", exerciseDetails: { type: "timed" } },
  { id: "w-bike", title: "Bike", type: "timed", exerciseDetails: { type: "timed" } },
  { id: "w-soccer", title: "Pickup soccer", type: "game", exerciseDetails: { type: "game" } },
];
const SAILING = [
  { id: "s1", date: "2026-08-02", vesselName: "Luna", departurePort: "Bayfield", arrivalPort: "Madeline Island", crew: [], sails: [] },
  { id: "s2", date: "2026-07-12", vesselName: "Luna", crew: [], sails: [] },
];

const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "America/Chicago" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("https://nominatim.openstreetmap.org/**", (r) => r.fulfill({ json: [] }));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), { timeout: 20000 });
  if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => !!window.__liveQA?.recreateSeed, { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__liveQA.goHome());
  await page.waitForTimeout(300);
  await page.evaluate((seed) => window.__liveQA.recreateSeed(seed), { trips: TRIPS, home: HOME, places: PLACES, workouts: WORKOUTS, sailingLog: SAILING });
  await page.waitForTimeout(300);

  const goHome = () => page.evaluate(() => window.__liveQA.goHome());
  // Group headings slide open/closed (~200ms); wait for the slide to finish.
  const tapHead = async (sel) => { await page.click(sel); await page.waitForTimeout(320); };
  const area = () => page.evaluate(() => window.__liveQA.activeArea());
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const visibleIn = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((b) => b.offsetParent).map((b) => b.textContent.trim()), sel);
  const shot = async (name) => { if (!SHOT) return; await page.waitForTimeout(350); await page.screenshot({ path: `${SHOT}-${name}.png` }); };

  // Every view lists its pages flat (Luke, 2026-10-20): no group headings.
  // Personal: Overview, then Calendar, News, Finance, Watch, Listen, Mail,
  // Explore, Exercise, Leisure — no Tasks, Weather, Scores, Meal Plan or Shop.
  const PERSONAL = ["Overview", "Calendar", "News", "Finance", "Watch", "Listen", "Mail", "Explore", "Exercise", "Leisure"];
  const listed = (root) => visibleIn(`${root} .page-overview-btn, ${root} .page-group-pages > button`);
  console.log("Landing page");
  check((await visibleIn("#homePageGroups .page-group-head")).length === 0, "no group headings");
  check(JSON.stringify(await listed("#homePageGroups")) === JSON.stringify(PERSONAL), "Personal lists its pages flat", (await listed("#homePageGroups")).join(", "));
  check(await fits(), "landing fits the phone width");
  const box = await page.evaluate(() => { const r = document.getElementById("homePageGroups").getBoundingClientRect(); const widest = Math.max(...[...document.querySelectorAll("#homePageGroups button")].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().width)); return { w: r.width, widest }; });
  check(box.w <= box.widest + 2 * 36 + 4 + 2, "the box is only as wide as its links (no minimum width)", JSON.stringify(box));
  await shot("home");
  await page.evaluate(() => window.__liveQA.recreateSeed({ notif: { mail: 2 } }));
  check(await page.evaluate(() => document.getElementById("homeMailBtn").classList.contains("has-notif-dot") || document.getElementById("homeMailBtn").className.includes("notif")), "a page's notification marks its link");
  await page.evaluate(() => window.__liveQA.recreateSeed({ notif: { mail: 0 } }));

  console.log("Page-title menu");
  await page.click("#homeListenBtn");
  await page.waitForTimeout(300);
  check(await area() === "media", "Listen opens from the landing page");
  await page.click("#pageTitleBtn");
  await page.waitForTimeout(300);
  check(JSON.stringify(await listed("#pageTitleMenu")) === JSON.stringify(PERSONAL), "the menu lists the same pages, flat", (await listed("#pageTitleMenu")).join(", "));
  check(await page.evaluate(() => document.getElementById("titleListenBtn").classList.contains("is-current")), "the current page is marked, not removed");
  check(await fits(), "menu fits the phone width");
  await shot("menu");

  console.log("Scores is back in News");
  await page.evaluate(() => document.getElementById("titleNewsBtn").click());
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__liveQA.showScoresForQa?.());
  await page.waitForTimeout(600);
  check(await area() === "news" && await page.evaluate(() => !!document.querySelector("[data-news-sports-tab]")), "News → Sports has Scores and Stories tabs");
  check(await page.evaluate(() => (document.getElementById("newsScoresMount")?.innerHTML || "").length > 50), "the Scores view mounts in News");
  check(await fits(), "News → Scores fits the phone width");
  await shot("news-scores");
  await page.evaluate(() => { location.hash = "#scores"; });
  await page.waitForTimeout(600);
  check(await area() === "news", "the old #scores route opens News → Scores");

  console.log("Exercise");
  await page.evaluate(() => document.getElementById("titleExerciseBtn").click());
  await page.waitForTimeout(400);
  check(await area() === "play", "Exercise opens");
  const exRows = await page.evaluate(() => [...document.querySelectorAll("#playPlannerGrid .recreate-section")].map((s) => ({
    title: s.querySelector(".recreate-section-title").textContent,
    cards: [...s.querySelectorAll(".workout-pool-card")].map((c) => c.querySelector(".workout-pool-title").textContent),
    lastIsAdd: s.querySelector(".recreate-row > :last-child .recreate-add-card") != null,
  })));
  check(JSON.stringify(exRows.map((r) => r.title)) === JSON.stringify(["Strength", "Cardio", "Games"]), "rows per kind: Strength, Cardio, Games");
  check(exRows[0]?.cards.includes("Bench press") && exRows[1]?.cards.includes("Run") && exRows[1]?.cards.includes("Bike") && exRows[2]?.cards.includes("Pickup soccer"), "each workout sits in its kind's row", JSON.stringify(exRows));
  check(exRows.every((r) => r.lastIsAdd), "every row ends with a + card");
  await page.click('[data-exercise-new="reps"]');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.getElementById("workoutDetailDialog")?.open && document.querySelector('[data-workout-panel="reps"]') && !document.querySelector('[data-workout-panel="reps"]').hidden), "Strength's + starts a reps workout");
  await page.keyboard.press("Escape");
  check(await fits(), "Exercise fits the phone width");
  await shot("exercise");

  console.log("Leisure");
  await page.evaluate(() => document.getElementById("titleLeisureBtn").click());
  await page.waitForTimeout(400);
  check(await area() === "recreate" && (await page.textContent("#pageTitleText")).trim() === "Leisure", "Leisure opens (the old Recreate page)");
  const lRows = await page.evaluate(() => [...document.querySelectorAll("#recreatePlannerGrid .recreate-section")].map((s) => ({
    title: s.querySelector(".recreate-section-title").textContent,
    cards: [...s.querySelectorAll(".workout-pool-card")].map((c) => c.querySelector(".workout-pool-title").textContent),
  })));
  check(JSON.stringify(lRows.map((r) => r.title)) === JSON.stringify(["Sailing", "Piano", "Dutch"]), "one row per hobby");
  check(lRows[0]?.cards.length === 4 && lRows[0].cards[0] === "Sailing" && lRows[0].cards[3] === "New entry", "Sailing: the hobby, its entries, then +", JSON.stringify(lRows[0]));
  check(lRows[1]?.cards[0] === "Piano" && lRows[1].cards.at(-1) === "Import score", "Piano: the hobby, its scores, then +", JSON.stringify(lRows[1]));
  await page.click('[data-leisure-sail="s1"]');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => [...document.querySelectorAll("dialog")].some((d) => d.open)), "a sailing card opens that entry");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.click('[data-open-hobby="sailing"]');
  await page.waitForTimeout(200);
  check(await page.evaluate(() => !!document.querySelector("#recreatePlannerGrid .sail-log-panel")), "the hobby card opens the full sailing log");
  await page.click("[data-recreate-back]");
  check(await fits(), "Leisure fits the phone width");
  await shot("leisure");

  console.log("Explore");
  await page.evaluate(() => document.getElementById("titleExploreBtn").click());
  await page.waitForTimeout(500);
  check(await area() === "explore" && await page.isVisible("#exploreLanding") && !(await page.isVisible("#exploreTripsShell")), "Explore opens on its rows");
  const rowsOf = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#exploreLanding .recreate-section")].map((s) => [
    s.dataset.recreateSection, [...s.querySelectorAll("[data-explore-card]")].map((c) => c.dataset.exploreCard),
  ])));
  let rows = await rowsOf();
  check(JSON.stringify(Object.keys(rows)) === JSON.stringify(["local", "state", "country", "world", "unsorted"]), "Local, State, Country, World (+ Not sorted yet)", Object.keys(rows).join(","));
  check(rows.local?.join() === "t-still" && rows.state?.join() === "t-dul" && rows.country?.join() === "t-chi" && rows.world?.join() === "t-ams" && rows.unsorted?.join() === "t-mys", "trips sorted by distance from home", JSON.stringify(rows));
  check(await page.evaluate(() => ["local", "state", "country", "world"].every((k) => document.querySelector(`[data-recreate-section="${k}"] .recreate-row > :last-child [data-explore-add="${k}"]`))), "each of the four rows ends with +");
  check(await fits(), "Explore fits the phone width");
  await shot("explore");
  await page.click('[data-explore-card="t-chi"]');
  await page.waitForTimeout(400);
  check(await page.isVisible("#exploreTripsShell") && !(await page.isVisible("#exploreLanding")) && (await page.textContent("#exploreDetailName")).trim() === "Chicago", "a card opens its trip");
  await shot("explore-trip");
  await page.click("#exploreBackBtn");
  await page.waitForTimeout(200);
  check(await page.isVisible("#exploreLanding"), "back returns to the rows");
  await page.click('[data-explore-card="t-chi"]', { button: "right" });
  await page.click('[data-explore-move="world"]');
  await page.waitForTimeout(200);
  rows = await rowsOf();
  check(rows.world?.includes("t-chi") && !rows.country?.includes("t-chi") && (await page.evaluate(() => window.__liveQA.tripById("t-chi").scope)) === "world", "moving a trip keeps it in the chosen row");
  // Scroll first, as a person would: a page scroll closes open menus (by design).
  await page.locator('[data-explore-card="t-chi"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.click('[data-explore-card="t-chi"]', { button: "right" });
  await page.click('[data-explore-move=""]');
  await page.waitForTimeout(200);
  check((await rowsOf()).country?.includes("t-chi"), "Sort by distance puts it back");
  await page.click('[data-explore-add="state"]');
  await page.waitForTimeout(300);
  await page.fill("#tnTripName", "Lutsen");
  await page.fill("#tnDest", "Lutsen, MN");
  await page.click("#tnCreate");
  await page.waitForTimeout(400);
  const lutsen = await page.evaluate(() => document.getElementById("exploreDetailName")?.textContent.trim());
  check(lutsen === "Lutsen" && await page.isVisible("#exploreTripsShell"), "a row's + starts a trip and opens it");
  await page.click("#exploreBackBtn");
  await page.waitForTimeout(200);
  check(await page.evaluate(() => [...document.querySelectorAll('[data-recreate-section="state"] [data-explore-card]')].some((c) => c.textContent.includes("Lutsen"))), "the new trip lands in the row it was added from");

  console.log("Home again");
  await goHome();
  await page.waitForTimeout(300);
  await page.setViewportSize({ width: 360, height: 740 });
  check(await fits(), "landing fits 360px");

  check(errors.length === 0, "no page errors", errors.join(" | "));
} finally {
  await browser.close();
}
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
