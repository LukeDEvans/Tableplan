// Phone month view QA (Luke, 2026-10-26, option C): the month grid shows only
// dots and the tapped day is listed underneath.
//
// Usage: node scripts/qa-calendar-month.mjs [url]   (dev server must be running;
// delete data/tableplan-state.json first for a clean local state)
// Screenshots go to $QA_SHOTS (default: no screenshots).

import { chromium } from "playwright";
import { existsSync } from "node:fs";

// Same browser lookup as scripts/check-boot.mjs (system Chrome, Playwright's own,
// then the cloud sandbox's pre-staged build).
const LAUNCH_ARGS = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
async function launch() {
  try { return await chromium.launch({ ...LAUNCH_ARGS, channel: "chrome" }); } catch { /* not installed */ }
  try { return await chromium.launch(LAUNCH_ARGS); } catch { /* not installed */ }
  const sandboxChrome = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(sandboxChrome)) return await chromium.launch({ ...LAUNCH_ARGS, executablePath: sandboxChrome });
  throw new Error("No usable Chromium found (see scripts/check-boot.mjs).");
}

const URL = process.argv[2] || "http://localhost:4174/";
const SHOTS = process.env.QA_SHOTS || "";
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "✓" : "✖"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function run(width) {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width, height: 800 }, timezoneId: "America/Chicago", hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), { timeout: 20000 });
  if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), { timeout: 10000 });
  await page.waitForTimeout(1200);

  // Seed a few events: two on a busy day (plus three more to pass the cap),
  // one all-day event, and one on today.
  const today = new Date();
  const busy = new Date(today.getFullYear(), today.getMonth(), today.getDate() === 12 ? 13 : 12);
  const seed = [
    { id: "qa-m1", title: "Dentist", date: key(busy), startTime: "09:00", endTime: "10:00", allDay: false },
    { id: "qa-m2", title: "Book club", date: key(busy), startTime: "18:30", endTime: "20:00", allDay: false },
    { id: "qa-m3", title: "Call Mom", date: key(busy), startTime: "12:00", endTime: "12:30", allDay: false },
    { id: "qa-m4", title: "Gym", date: key(busy), startTime: "06:00", endTime: "07:00", allDay: false },
    { id: "qa-m5", title: "Errands", date: key(busy), startTime: "15:00", endTime: "16:00", allDay: false },
    { id: "qa-m6", title: "School holiday", date: key(busy), allDay: true },
    { id: "qa-m7", title: "Coffee with Sam", date: key(today), startTime: "08:00", endTime: "09:00", allDay: false },
  ];
  const have = new Set(await page.evaluate(() => window.__liveQA.planEventIds() || []));
  for (const ev of seed.filter((e) => !have.has(e.id))) {
    await page.evaluate((e) => window.__liveQA.reminderSeedLegacy({ ...e, createdAt: new Date().toISOString() }), ev);
  }
  await page.evaluate(() => document.getElementById("homePlanBtn")?.click());
  await page.waitForSelector(".plan-month-grid", { timeout: 8000 });
  await page.waitForTimeout(400);

  console.log(`▸ Month view at ${width}px`);
  const state0 = await page.evaluate(() => {
    const list = document.querySelector(".plan-month-daylist");
    const sel = document.querySelector(".plan-month-day.is-selected");
    return {
      listShown: !!list && getComputedStyle(list).display !== "none",
      selected: sel?.dataset.planDay || "",
      listText: list?.innerText.replace(/\s+/g, " ").trim() || "",
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  check(state0.listShown, "the day list shows under the grid");
  check(state0.selected === key(today), "today is selected on open", state0.selected);
  check(/Today/.test(state0.listText) && /Coffee with Sam/.test(state0.listText) && /8 AM/.test(state0.listText), "today's events are listed with times", state0.listText);
  check(state0.overflow <= 0, "nothing scrolls sideways", String(state0.overflow));

  const busyCell = await page.evaluate((k) => {
    const cell = document.querySelector(`.plan-month-day[data-plan-day="${k}"]`);
    const visible = [...cell.querySelectorAll(".plan-month-chip")].filter((c) => getComputedStyle(c).display !== "none");
    const titles = [...cell.querySelectorAll(".plan-month-chip-title")].filter((c) => getComputedStyle(c).display !== "none");
    return { dots: visible.length, titles: titles.length, height: cell.getBoundingClientRect().height };
  }, key(busy));
  check(busyCell.dots === 3, "a busy day shows at most three dots", String(busyCell.dots));
  check(busyCell.titles === 0, "cells show no titles", String(busyCell.titles));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/month-${width}-today.png` });

  // Tap the busy day: it's selected and listed, and no event dialog opens.
  await page.tap(`.plan-month-day[data-plan-day="${key(busy)}"]`);
  await page.waitForTimeout(250);
  const state1 = await page.evaluate(() => ({
    selected: document.querySelector(".plan-month-day.is-selected")?.dataset.planDay || "",
    rows: [...document.querySelectorAll(".plan-month-daylist .plan-agenda-event")].map((r) => r.innerText.replace(/\s+/g, " ").trim()),
    dialogOpen: [...document.querySelectorAll("dialog[open]")].length,
  }));
  check(state1.selected === key(busy), "tapping a day selects it", state1.selected);
  check(state1.rows.length === 6 && /All day/.test(state1.rows[0]) && /Gym/.test(state1.rows[1]), "the list has every event, all-day first then by time", JSON.stringify(state1.rows));
  check(state1.dialogOpen === 0, "tapping a day doesn't open the new-event dialog");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/month-${width}-busy.png` });

  // Tapping a listed event opens its detail panel.
  await page.tap(".plan-month-daylist .plan-agenda-event[data-plan-event-id='qa-m1']");
  await page.waitForTimeout(300);
  const detail = await page.evaluate(() => { const p = document.getElementById("planDetailPanel"); return p && !p.hidden ? p.innerText : ""; });
  check(/Dentist/.test(detail), "tapping a listed event opens it", detail.slice(0, 80));
  await page.evaluate(() => document.querySelector("[data-plan-detail-close]")?.click());
  await page.waitForTimeout(200);

  // The + adds an event on the selected day.
  await page.tap(".plan-month-daylist-add");
  await page.waitForTimeout(300);
  const addDate = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    return d ? (d.querySelector('input[type="date"]')?.value || "open") : "";
  });
  check(addDate === key(busy) || addDate === "open", "+ opens a new event for that day", addDate);
  await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));

  // An empty day says so.
  const empty = new Date(today.getFullYear(), today.getMonth(), busy.getDate() === 20 ? 21 : 20);
  await page.tap(`.plan-month-day[data-plan-day="${key(empty)}"]`);
  await page.waitForTimeout(200);
  const emptyText = await page.evaluate(() => document.querySelector(".plan-month-daylist-rows")?.innerText || "");
  check(/Nothing planned/.test(emptyText), "an empty day says nothing is planned", emptyText);

  // The date opens the day view.
  await page.tap(".plan-month-daylist-date");
  await page.waitForTimeout(300);
  const mode = await page.evaluate(() => document.getElementById("planViewSelect")?.value);
  check(mode === "day", "tapping the date opens the day view", mode);

  check(errors.length === 0, "no page errors", errors.join(" | "));
  await browser.close();
}

async function runDesktop() {
  const browser = await launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), { timeout: 20000 });
  if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.getElementById("homePlanBtn")?.click());
  await page.waitForSelector(".plan-month-grid", { timeout: 8000 });
  console.log("▸ Month view at 1200px");
  const shown = await page.evaluate(() => getComputedStyle(document.querySelector(".plan-month-daylist")).display);
  check(shown === "none", "the day list stays hidden on wide screens (cells show titles)", shown);
  await browser.close();
}

await run(390);
await run(360);
await runDesktop();
console.log(failures ? `\n✖ ${failures} check(s) failed` : "\n✔ Month view QA passed");
process.exit(failures ? 1 : 0);
