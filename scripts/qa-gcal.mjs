#!/usr/bin/env node
// Headless QA for Google Calendar sync, Phase 1 (GOOGLE_CALENDAR_SYNC_DESIGN.md).
// Runs the REAL client paths in app.js (discovery → linking → in-place migration →
// event load with times → plan projection → panel → unlink → severance dry run)
// against the dev server, with the gcal-* Netlify functions mocked via page.route
// (local dev has no functions). Requires the dev server: `npm run dev:local`, on a
// fresh local state (it adds and removes calendars in the local backend's state file).
//
//   node scripts/qa-gcal.mjs [url]   (default http://localhost:4174/)
//   QA_GCAL_SHOT=/path/prefix  → also saves 360px + desktop screenshots of the panel
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
const LAUNCH = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
const results = [];
const pass = (name) => { results.push(["PASS", name]); console.log(`  ✓ ${name}`); };
const failed = (name, detail) => { results.push(["FAIL", name]); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); };
const check = (cond, name, detail) => (cond ? pass(name) : failed(name, detail));

async function launch() {
  try { return await chromium.launch({ ...LAUNCH, channel: "chrome" }); } catch { /* none */ }
  try { return await chromium.launch(LAUNCH); } catch { /* none */ }
  const p = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(p)) return chromium.launch({ ...LAUNCH, executablePath: p });
  throw new Error("No Chromium available");
}

const LUKE = "luke@gmail.com";
const WIFE = "wife@gmail.com";
const HOLIDAYS = "en.usa#holiday@group.v.calendar.google.com";
const LEGACY_URL = "https://calendar.google.com/calendar/ical/luke%40gmail.com/private-abc/basic.ics";

const server = { links: [], posts: [], eventCalls: [], icalCalls: 0 };
const googleCalendars = [
  { id: LUKE, summary: "Luke", accessRole: "owner", color: "#9fe1e7", primary: true },
  { id: WIFE, summary: "Wife", accessRole: "writer", color: "#f691b2" },
  { id: HOLIDAYS, summary: "Holidays in United States", accessRole: "reader", color: "#16a765" }
];
const liveItems = {
  [LUKE]: [
    { id: "shift1", summary: "Work shift", start: { dateTime: "2026-10-13T08:00:00-05:00" }, end: { dateTime: "2026-10-13T16:00:00-05:00" } },
    { id: "soccerA", summary: "Soccer", start: { dateTime: "2026-10-13T17:00:00-05:00" }, end: { dateTime: "2026-10-13T18:00:00-05:00" } },
    { id: "soccerB", summary: "Soccer", start: { dateTime: "2026-10-13T19:00:00-05:00" }, end: { dateTime: "2026-10-13T20:00:00-05:00" } }
  ],
  [WIFE]: [{ id: "trip", summary: "Girls trip", start: { date: "2026-10-16" }, end: { date: "2026-10-19" } }],
  [HOLIDAYS]: [{ id: "hol", summary: "Halloween", start: { date: "2026-10-31" }, end: { date: "2026-11-01" } }]
};
const masterItems = {
  [LUKE]: [
    { id: "s", summary: "Gym", start: { dateTime: "2026-10-12T06:00:00-05:00" }, end: { dateTime: "2026-10-12T07:00:00-05:00" }, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"] },
    { id: "b", summary: "Pay bills", start: { date: "2026-11-01" }, end: { date: "2026-11-02" }, recurrence: ["RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15"] }
  ],
  [WIFE]: [{ id: "w", summary: "Book club", start: { dateTime: "2026-10-20T19:00:00-05:00" }, end: { dateTime: "2026-10-20T21:00:00-05:00" }, attendees: [{ self: true }, { email: "x@y" }] }]
};

async function mockFunctions(page) {
  await page.route("**/api/calendars**", (route) => { server.icalCalls += 1; route.fulfill({ json: { events: [{ summary: "Legacy iCal event", date: "2026-10-14" }] } }); });
  await page.route("**/.netlify/functions/gcal-calendars", async (route) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: { connected: true, email: LUKE, calendars: googleCalendars, links: server.links } });
    const body = JSON.parse(req.postData() || "{}");
    server.posts.push(body);
    if (body.action === "link") for (const l of body.links) if (!server.links.some((x) => x.googleCalendarId === l.googleCalendarId)) server.links.push({ ...l, enabled: true });
    if (body.action === "relink") server.links = [...server.links.filter((x) => x.googleCalendarId !== body.googleCalendarId), { googleCalendarId: body.googleCalendarId, appCalendarId: body.appCalendarId, enabled: true }];
    if (body.action === "unlink") server.links = server.links.map((x) => (x.appCalendarId === body.appCalendarId ? { ...x, enabled: false } : x));
    return route.fulfill({ json: { links: server.links } });
  });
  await page.route("**/.netlify/functions/gcal-events", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    server.eventCalls.push(body);
    const results = {};
    for (const c of body.calendars) {
      const link = server.links.find((l) => l.appCalendarId === c.appCalendarId && l.enabled);
      if (!link) { results[c.appCalendarId] = { status: "unavailable", reason: "not-linked" }; continue; }
      const items = body.mode === "masters" ? (masterItems[link.googleCalendarId] || []) : (liveItems[link.googleCalendarId] || []);
      results[c.appCalendarId] = { status: "ok", full: !c.updatedMin, items, fetchedAt: new Date().toISOString(), truncated: false };
    }
    route.fulfill({ json: { results } });
  });
}

async function main() {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await mockFunctions(page);

  console.log(`▸ Google Calendar QA against ${URL}`);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), { timeout: 20000 });
  if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), { timeout: 10000 });
  await page.waitForTimeout(1500);

  // Legacy iCal calendar for Luke's Google calendar, added the old way (a Google
  // iCal URL in the sidebar's Add Calendar dialog lands in the linked store).
  await page.evaluate(() => document.getElementById("homePlanBtn")?.click());
  await page.waitForSelector("[data-add-cal]", { state: "attached", timeout: 8000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector("[data-add-cal]")?.click());
  await page.evaluate((url) => {
    document.getElementById("planNewCalName").value = "Luke (iCal)";
    document.getElementById("planNewCalUrl").value = url;
    document.getElementById("addPlanCalBtn").click();
  }, LEGACY_URL);
  await page.waitForTimeout(800);
  const legacyId = await page.evaluate(async () => (await window.__liveQA.gcalSyncNow()).calendars.find((c) => c.url)?.id);
  check(Boolean(legacyId), "legacy iCal calendar exists before connecting");

  // Connect (mocked) and run discovery + event load through the real paths.
  await page.evaluate(() => window.__liveQA.gcalForce(true));
  server.icalCalls = 0;
  const after = await page.evaluate(() => window.__liveQA.gcalSyncNow());
  const legacy = after.calendars.find((c) => c.id === legacyId);
  check(legacy?.googleCalendarId === LUKE, "legacy iCal calendar migrated in place (same app id, now Google-backed)", JSON.stringify(legacy));
  const wife = after.calendars.find((c) => c.googleCalendarId === WIFE);
  check(Boolean(wife) && /^gcal-[0-9a-f]{16}$/.test(wife.id) && wife.url === "", "editable shared calendar auto-added with a deterministic id", JSON.stringify(wife));
  check(!after.calendars.some((c) => c.googleCalendarId === HOLIDAYS), "view-only calendar NOT auto-added");
  check(server.icalCalls === 0, "no iCal fetch for a calendar the API serves", `icalCalls=${server.icalCalls}`);
  const shift = after.events.find((e) => e.summary === "Work shift");
  check(shift && shift.startTime === "08:00" && shift.endTime === "16:00" && shift.allDay === false && shift.date === "2026-10-13", "timed Google event carries real start/end times", JSON.stringify(shift));
  const tripDays = after.events.filter((e) => e.summary === "Girls trip").map((e) => e.date).sort();
  check(JSON.stringify(tripDays) === JSON.stringify(["2026-10-16", "2026-10-17", "2026-10-18"]), "multi-day all-day event spans the right days (exclusive end)", JSON.stringify(tripDays));

  const plan = await page.evaluate(() => window.__liveQA.gcalPlanEvents("2026-10-13"));
  const planShift = plan.find((e) => e.title === "Work shift");
  check(planShift && !planShift.allDay && planShift.startTime === "08:00", "Plan calendar shows the Google event as timed (not all-day)", JSON.stringify(planShift));
  const soccer = plan.filter((e) => e.title === "Soccer");
  check(soccer.length === 2 && new Set(soccer.map((e) => e.id)).size === 2, "two same-titled events the same day both show, with distinct ids", JSON.stringify(soccer));

  // Second sync is a delta (updatedMin) — not a full re-pull.
  await page.evaluate(() => window.__liveQA.gcalSyncNow());
  const lastLive = [...server.eventCalls].reverse().find((b) => b.mode === "live");
  const firstSynced = lastLive.calendars.filter((c) => [legacyId, wife.id].includes(c.appCalendarId));
  check(firstSynced.length === 2 && firstSynced.every((c) => c.updatedMin), "follow-up refresh asks Google only for changes (updatedMin)", JSON.stringify(lastLive.calendars));

  // Panel in the sidebar's Add Calendar dialog.
  await page.evaluate(() => document.getElementById("homePlanBtn")?.click());
  await page.waitForSelector("[data-add-cal]", { state: "attached", timeout: 8000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector("[data-add-cal]")?.click());
  await page.waitForSelector("#planAddCalGcal .gcal-row", { timeout: 5000 }).catch(() => {});
  const panel = await page.evaluate(() => {
    const el = document.getElementById("planAddCalGcal");
    return { visible: Boolean(el && !el.hidden && el.offsetParent), text: el?.innerText || "", rows: el?.querySelectorAll(".gcal-row").length || 0 };
  });
  check(panel.visible && panel.rows === 3 && /In app/.test(panel.text) && /Add/.test(panel.text), "Add Calendar dialog shows the Google panel with In app / Add rows", JSON.stringify(panel));

  if (process.env.QA_GCAL_SHOT) {
    await page.screenshot({ path: `${process.env.QA_GCAL_SHOT}-desktop.png` });
  }
  // Phone width: nothing wider than the viewport inside the panel.
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => {
    const el = document.getElementById("planAddCalGcal");
    const r = el.getBoundingClientRect();
    return { right: Math.round(r.right), docScroll: document.documentElement.scrollWidth, width: window.innerWidth };
  });
  check(panel.visible && overflow.right <= overflow.width && overflow.docScroll <= overflow.width, "panel fits a 360px phone (no sideways scroll)", JSON.stringify(overflow));
  if (process.env.QA_GCAL_SHOT) await page.screenshot({ path: `${process.env.QA_GCAL_SHOT}-phone.png` });
  await page.setViewportSize({ width: 1200, height: 900 });

  // Add the view-only Holidays calendar by hand.
  await page.evaluate((id) => document.querySelector(`#planAddCalGcal [data-gcal-action="add"][data-gcal-id="${CSS.escape(id)}"]`)?.click(), HOLIDAYS);
  await page.waitForTimeout(1500);
  const withHol = await page.evaluate(() => window.__liveQA.gcalSyncNow());
  check(withHol.calendars.some((c) => c.googleCalendarId === HOLIDAYS) && withHol.events.some((e) => e.summary === "Halloween"), "view-only calendar can be added by hand and its events load");

  // Remove the wife calendar from the app → server link disabled, never re-added.
  await page.evaluate(() => document.getElementById("closePlanAddCalBtn")?.click());
  await page.waitForTimeout(300);
  await page.evaluate((id) => document.querySelector(`[data-cal-edit="${CSS.escape(id)}"]`)?.click(), wife.id);
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById("planCalDialogDeleteBtn")?.click());
  await page.waitForTimeout(800);
  check(server.posts.some((p) => p.action === "unlink" && p.appCalendarId === wife.id), "removing a Google calendar tells the server (unlink)");
  const afterRemove = await page.evaluate(() => window.__liveQA.gcalSyncNow());
  check(!afterRemove.calendars.some((c) => c.googleCalendarId === WIFE), "a removed calendar is not re-added by discovery");

  // Show on Meal Plan: offered for a Google API calendar in its Edit dialog, and
  // switching it on puts its timed events on the meal plan.
  await page.evaluate(() => document.getElementById("closeCalendarsBtn")?.click());
  await page.evaluate((id) => document.querySelector(`[data-cal-edit="${id}"]`)?.click(), legacyId);
  await page.waitForTimeout(500);
  const toggle = await page.evaluate(() => {
    const row = document.getElementById("planCalMealPlanRow");
    const input = document.getElementById("planCalMealPlan");
    return { shown: Boolean(row && !row.hidden), exists: Boolean(input) };
  });
  check(toggle.exists && toggle.shown, "Edit dialog offers 'Show on Meal Plan' for a Google API calendar", JSON.stringify(toggle));
  await page.evaluate(() => { const i = document.getElementById("planCalMealPlan"); if (i) i.checked = true; document.getElementById("addPlanCalBtn")?.click(); });
  await page.waitForTimeout(800);
  const mealEvents = await page.evaluate(() => window.__liveQA.gcalMealPlanEvents());
  const mealShift = (mealEvents || []).find((e) => e.title === "Work shift");
  check(mealShift && mealShift.startTime === "08:00" && mealShift.endTime === "16:00" && mealShift.allDay === false, "switched-on Google calendar puts its timed events on the meal plan", JSON.stringify(mealEvents));
  await page.evaluate(() => document.querySelector("[data-add-cal]")?.click());
  await page.waitForTimeout(400);

  // Severance dry run from the Google panel (sidebar's Add Calendar dialog).
  await page.evaluate(() => document.querySelector('#planAddCalGcal [data-gcal-action="report"]')?.click());
  await page.waitForFunction(() => /Dry run|import cleanly/.test(document.querySelector("#planAddCalGcal .gcal-report")?.innerText || ""), { timeout: 5000 }).catch(() => {});
  const report = await page.evaluate(() => document.querySelector("#planAddCalGcal .gcal-report")?.innerText || "");
  check(/Pay bills/.test(report) && /several days/.test(report) && /repeating series/.test(report), "dry-run report lists what wouldn't import exactly", report.slice(0, 300));
  check(server.eventCalls.some((b) => b.mode === "masters"), "dry run reads unexpanded series (masters mode)");

  check(errors.length === 0, "no uncaught page errors", errors.join(" | "));
  await browser.close();
  const failures = results.filter(([s]) => s === "FAIL").length;
  console.log(failures ? `\n✘ ${failures} of ${results.length} checks failed` : `\n✔ all ${results.length} Google Calendar checks passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
