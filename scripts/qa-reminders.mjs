#!/usr/bin/env node
// Headless QA for per-person event reminders (IOS_NOTIFICATIONS_DESIGN.md Phase 1).
// Drives the REAL app paths against the dev server: the event editor's reminder,
// the per-user prefs (device-only in local dev), the one-time legacy fold, the
// reminder instances that feed the iPhone's local notifications, the web tick,
// and the Google event "Remind me" picker — with gcal-* functions mocked (Google's
// own reminders for the token owner, none for a household member's calendar).
// The iPhone plugin itself is covered by test/calendar-reminders.test.js.
//
//   node scripts/qa-reminders.mjs [url]   (default http://localhost:4174/; needs `npm run dev:local`)
//   QA_REMINDERS_SHOT=/path/prefix → also saves 360px screenshots
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
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

// Dates relative to "now" in the browser's zone (America/Chicago below).
const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
const TOMORROW = keyOf(tomorrow);
const isoAt = (key, hh) => `${key}T${pad(hh)}:00:00-05:00`; // CDT/CST offset is close enough for a mock; times are read back via Date

const LUKE = "luke@gmail.com";
const WIFE = "wife@gmail.com";
const server = { links: [] };
const liveItems = {
  [LUKE]: [
    { id: "shift", summary: "Work shift", start: { dateTime: isoAt(TOMORROW, 8) }, end: { dateTime: isoAt(TOMORROW, 16) }, reminders: { useDefault: true } },
    { id: "dentist", summary: "Dentist", start: { dateTime: isoAt(TOMORROW, 11) }, end: { dateTime: isoAt(TOMORROW, 12) }, reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }, { method: "email", minutes: 60 }] } }
  ],
  [WIFE]: [
    { id: "yoga", summary: "Yoga", start: { dateTime: isoAt(TOMORROW, 18) }, end: { dateTime: isoAt(TOMORROW, 19) }, reminders: { useDefault: true } }
  ]
};
const ownerOf = { [LUKE]: true, [WIFE]: false }; // Wife's calendar is read through her token
const defaults = { [LUKE]: [{ method: "popup", minutes: 30 }], [WIFE]: [{ method: "popup", minutes: 10 }] };

async function mockFunctions(page) {
  await page.route("**/api/calendars**", (route) => route.fulfill({ json: { events: [] } }));
  await page.route("**/.netlify/functions/gcal-calendars", async (route) => {
    const req = route.request();
    const cals = [{ id: LUKE, summary: "Luke", accessRole: "owner", color: "#9fe1e7", primary: true }, { id: WIFE, summary: "Wife", accessRole: "writer", color: "#f691b2" }];
    if (req.method() === "GET") return route.fulfill({ json: { connected: true, email: LUKE, calendars: cals, links: server.links } });
    const body = JSON.parse(req.postData() || "{}");
    if (body.action === "link") for (const l of body.links) if (!server.links.some((x) => x.googleCalendarId === l.googleCalendarId)) server.links.push({ ...l, enabled: true });
    return route.fulfill({ json: { links: server.links } });
  });
  await page.route("**/.netlify/functions/gcal-events", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const results = {};
    for (const c of body.calendars) {
      const link = server.links.find((l) => l.appCalendarId === c.appCalendarId && l.enabled);
      if (!link) { results[c.appCalendarId] = { status: "unavailable", reason: "not-linked" }; continue; }
      results[c.appCalendarId] = { status: "ok", full: !c.updatedMin, items: liveItems[link.googleCalendarId] || [], fetchedAt: new Date().toISOString(), truncated: false, own: ownerOf[link.googleCalendarId], defaultReminders: defaults[link.googleCalendarId] };
    }
    route.fulfill({ json: { results } });
  });
}

async function main() {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, timezoneId: "America/Chicago" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await mockFunctions(page);

  console.log(`▸ Event reminders QA against ${URL}`);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), { timeout: 20000 });
  if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), { timeout: 10000 });
  await page.waitForTimeout(1500);
  const qa = (fn, ...args) => page.evaluate(([f, a]) => window.__liveQA[f](...a), [fn, args]);
  const now = await page.evaluate(() => Date.now());

  // ── 0. The reminders switch is reachable the way a person looks for it ──────
  // Gear → Settings → Notifications (the page-level Settings → General → Calendars
  // route isn't reachable from the phone's UI).
  await page.click("#appMenuBtn");
  await page.click("#generalSettingsMenuBtn");
  await page.waitForSelector('#contextSettingsDialog[open] [data-context-settings-action="notifications"]', { timeout: 5000 }).catch(() => {});
  const hasNotifBtn = await page.evaluate(() => Boolean(document.querySelector('#contextSettingsDialog[open] [data-context-settings-action="notifications"]')));
  check(hasNotifBtn, "gear → Settings shows a Notifications button");
  if (hasNotifBtn) await page.click('[data-context-settings-action="notifications"]');
  const notifPanel = await page.evaluate(() => {
    const el = document.querySelector('#contextSettingsDialog[open] [data-reminder-device-panel]');
    return el && !el.hidden ? { text: el.innerText.replace(/\s+/g, " ").trim(), title: document.getElementById("contextSettingsTitle")?.textContent } : null;
  });
  check(notifPanel && notifPanel.title === "Notifications" && /Reminders on this browser/.test(notifPanel.text), "…which shows the reminders switch for this device", JSON.stringify(notifPanel));
  await page.evaluate(() => document.getElementById("contextSettingsDialog")?.close());

  // ── 1. Legacy shared reminder folds once into the admin's own prefs ─────────
  const legacyId = `qa-legacy-${Date.now()}`;
  await qa("reminderSeedLegacy", { id: legacyId, title: "Legacy call", date: TOMORROW, startTime: "14:00", allDay: false, reminder: 15, createdAt: new Date().toISOString() });
  const folded = await qa("reminderFold");
  check(folded[legacyId]?.min === 15, "legacy shared reminder folds into the admin's own reminders", JSON.stringify(folded[legacyId]));

  // ── 2. Editor: a new event's reminder is saved per person, not on the event ─
  await page.evaluate(() => document.getElementById("homePlanBtn")?.click());
  await page.waitForTimeout(500);
  const before = new Set(await qa("planEventIds"));
  await qa("reminderOpenEditor", TOMORROW);
  await page.fill("#planEventTitle", "QA reminder event");
  await page.evaluate(() => { const c = document.getElementById("planEventAllDay"); if (c.checked) c.click(); });
  await qa("reminderSetTime", "planEventStart", "10:00");
  await qa("reminderSetTime", "planEventEnd", "11:00");
  await page.selectOption("#planEventReminder", "30");
  await page.click("#savePlanEventBtn");
  await page.waitForTimeout(400);
  const newId = (await qa("planEventIds")).find((id) => !before.has(id));
  const saved = newId ? await qa("planEvent", newId) : null;
  const prefs1 = await qa("reminderPrefs");
  check(Boolean(saved) && saved.reminder === undefined, "the shared event carries no reminder field", JSON.stringify(saved && { reminder: saved.reminder }));
  check(prefs1[newId]?.min === 30, "the reminder is stored in the user's own prefs", JSON.stringify(prefs1[newId]));
  const inst1 = await qa("reminderInstances", now);
  const mine = inst1.find((r) => r.eventId === newId);
  const expectFire = await page.evaluate((k) => new Date(`${k}T09:30:00`).getTime(), TOMORROW);
  check(mine && mine.fireAt === expectFire && /in 30 min/.test(mine.body), "it is scheduled 30 minutes before (local time)", JSON.stringify(mine));

  await qa("reminderOpenEditor", TOMORROW, newId);
  check(await page.inputValue("#planEventReminder") === "30", "reopening the editor shows the user's reminder");
  await page.selectOption("#planEventReminder", "");
  await page.click("#savePlanEventBtn");
  await page.waitForTimeout(400);
  const prefs2 = await qa("reminderPrefs");
  check(prefs2[newId]?.off === true, "'No reminder' is stored as off", JSON.stringify(prefs2[newId]));
  check(!(await qa("reminderInstances", now)).some((r) => r.eventId === newId), "turned-off reminder is no longer scheduled");

  // The legacy event: the editor shows the folded value; turning it off sticks.
  await qa("reminderOpenEditor", TOMORROW, legacyId);
  check(await page.inputValue("#planEventReminder") === "15", "editor shows the folded legacy reminder");
  await page.selectOption("#planEventReminder", "");
  await page.click("#savePlanEventBtn");
  await page.waitForTimeout(400);
  const refolded = await qa("reminderFold");
  check(refolded[legacyId]?.off === true, "a legacy reminder turned off is never folded back in", JSON.stringify(refolded[legacyId]));

  // ── 3. Detail panel + web tick ──────────────────────────────────────────────
  await qa("reminderOpenEditor", TOMORROW, newId);
  await page.selectOption("#planEventReminder", "5");
  await page.click("#savePlanEventBtn");
  await page.waitForTimeout(300);
  await qa("reminderOpenDetail", newId, TOMORROW);
  await page.waitForTimeout(200);
  const detailText = await page.evaluate(() => document.getElementById("planDetailPanel")?.innerText || "");
  check(/5 minutes before/.test(detailText), "event details show the user's reminder", detailText.replace(/\s+/g, " ").slice(0, 160));
  await page.evaluate(() => document.querySelector("[data-plan-detail-close]")?.click());
  const fireAt = await page.evaluate((k) => new Date(`${k}T09:55:00`).getTime(), TOMORROW);
  await qa("reminderTick", fireAt - 30000, fireAt + 30000);
  const toast = await page.evaluate(() => document.getElementById("mailToast")?.innerText || "");
  check(/QA reminder event/.test(toast) && /in 5 min/.test(toast), "the in-app tick fires the reminder when it comes due (web)", toast);
  await qa("reminderTick", fireAt + 30000, fireAt + 90000);
  await page.evaluate(() => document.getElementById("mailToast")?.remove());
  await qa("reminderTick", fireAt - 30000, fireAt + 30000);
  check(!(await page.evaluate(() => document.getElementById("mailToast"))), "a reminder fires only once");

  // ── 4. Google events ────────────────────────────────────────────────────────
  await page.evaluate(() => window.__liveQA.gcalForce(true));
  await page.evaluate(() => window.__liveQA.gcalSyncNow());
  await page.waitForTimeout(500);
  const inst2 = await qa("reminderInstances", now);
  const g = (id) => inst2.filter((r) => r.kind === "google" && r.eventId === id).map((r) => r.minutes);
  check(JSON.stringify(g("shift")) === "[30]", "own Google event with the calendar default → 30 min", JSON.stringify(g("shift")));
  check(JSON.stringify(g("dentist")) === "[10]", "own Google event's popup override → 10 min (email ignored)", JSON.stringify(g("dentist")));
  check(g("yoga").length === 0, "a household member's Google reminders never fire for this user", JSON.stringify(g("yoga")));

  const planG = await page.evaluate((k) => window.__liveQA.gcalPlanEvents(k), TOMORROW);
  const shiftEv = planG.find((e) => e.externalId === "shift");
  await qa("reminderOpenDetail", shiftEv.id, TOMORROW);
  await page.waitForTimeout(200);
  const sel = "[data-plan-detail-reminder]";
  const picker = await page.evaluate((s) => { const el = document.querySelector(s); return el ? { value: el.value, text: el.options[el.selectedIndex].text } : null; }, sel);
  check(picker?.value === "google" && /30 minutes before/.test(picker.text), "Google event details offer 'Remind me', defaulting to Google's reminder", JSON.stringify(picker));
  if (process.env.QA_REMINDERS_SHOT) {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${process.env.QA_REMINDERS_SHOT}-google-detail-360.png` });
    const overflow = await page.evaluate(() => { const p = document.getElementById("planDetailPanel"); return p ? p.scrollWidth - p.clientWidth : 0; });
    check(overflow <= 0, "the picker fits a 360px phone", `overflow=${overflow}`);
    await page.setViewportSize({ width: 1200, height: 900 });
  }
  await page.selectOption(sel, "5");
  await page.waitForTimeout(200);
  const inst3 = await qa("reminderInstances", now);
  check(JSON.stringify(inst3.filter((r) => r.eventId === "shift").map((r) => r.minutes)) === "[5]", "choosing a time overrides Google's for this user");
  await page.selectOption(sel, "google");
  await page.waitForTimeout(200);
  const prefsG = await qa("reminderPrefs");
  check(!Object.keys(prefsG).some((k) => k.startsWith("gcal:") && k.endsWith(":shift")), "'Google's reminder' removes the override");
  check(JSON.stringify((await qa("reminderInstances", now)).filter((r) => r.eventId === "shift").map((r) => r.minutes)) === "[30]", "…and Google's 30 min applies again");
  await page.evaluate(() => document.querySelector("[data-plan-detail-close]")?.click());

  const yogaEv = planG.find((e) => e.externalId === "yoga");
  await qa("reminderOpenDetail", yogaEv.id, TOMORROW);
  await page.waitForTimeout(200);
  const yogaPicker = await page.evaluate((s) => { const el = document.querySelector(s); return el ? el.options[el.selectedIndex].text : null; }, sel);
  check(yogaPicker === "No reminder", "a household member's Google event starts with no reminder for this user", yogaPicker);
  await page.selectOption(sel, "10");
  await page.waitForTimeout(200);
  check(JSON.stringify((await qa("reminderInstances", now)).filter((r) => r.eventId === "yoga").map((r) => r.minutes)) === "[10]", "…and this user can ask for one");

  check(errors.length === 0, "no uncaught page errors", errors.join(" | "));
  await browser.close();
  const failedCount = results.filter(([r]) => r === "FAIL").length;
  console.log(failedCount ? `\n✗ ${failedCount} of ${results.length} reminder checks failed` : `\n✔ all ${results.length} reminder checks passed`);
  process.exit(failedCount ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
