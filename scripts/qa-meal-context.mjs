#!/usr/bin/env node
// qa-meal-context.mjs — the Meal Plan's Events & Notes cards (Luke, 2026-10-23):
// always open, no toggle; a "+" the old chevron's size offers Event (the event
// editor timed across the meal's mealtime, ticked "Meal Plan") or Note (reveals
// the note box). Runs against the dev server (npm run dev:local) in local dev.
//   node scripts/qa-meal-context.mjs [url]     QA_SHOT=/path/prefix to save screenshots
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
const SHOT = process.env.QA_SHOT || "";
const LAUNCH = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
const results = [];
const check = (cond, name, detail) => {
  results.push(cond);
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
};

async function launch() {
  try { return await chromium.launch({ ...LAUNCH, channel: "chrome" }); } catch { /* none */ }
  try { return await chromium.launch(LAUNCH); } catch { /* none */ }
  const p = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(p)) return chromium.launch({ ...LAUNCH, executablePath: p });
  throw new Error("No Chromium available");
}

const browser = await launch();
try {
  for (const width of [390, 360]) {
    console.log(`\n${width}px`);
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, timezoneId: "America/Chicago" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), { timeout: 20000 });
    if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
    await page.waitForFunction(() => !!window.__liveQA?.viewsReady?.(), { timeout: 20000 });
    await page.evaluate(() => window.__liveQA.goHome());
    // Meal Plan is Household's page: step the landing page's view to Household.
    for (let i = 0; i < 3 && (await page.evaluate(() => window.__liveQA.view())) !== "household"; i++) {
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(350);
    }
    // A fresh device has no household members, so the planner is empty; add one.
    await page.evaluate(() => window.__liveQA.ensureMealMember());
    await page.waitForTimeout(300);
    await page.click("#homeEatBtn");
    await page.waitForSelector(".meal-context-card", { state: "visible", timeout: 15000 });
    await page.waitForTimeout(300);

    const card = page.locator(".meal-context-card:visible").first();
    check(await page.locator("[data-meal-context-toggle], .meal-context-chevron, .meal-context-body").count() === 0, "no open/close toggle, chevron or collapsible body");
    const add = card.locator("[data-meal-context-add]");
    check(await add.isVisible(), "a + sits in the card header");
    const size = await add.locator("svg").evaluate((s) => { const r = s.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    check(size[0] === 14 && size[1] === 14, "the + glyph is the chevron's 14×14", String(size));
    const tap = await add.evaluate((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    check(tap[0] >= 26 && tap[1] >= 26, "the + has a usable tap area", String(tap));
    check(!(await card.locator("[data-meal-note]").isVisible()), "an empty note box stays hidden");
    if (SHOT) await page.screenshot({ path: `${SHOT}-${width}-card.png` });

    // + → Note
    await add.click();
    const menu = page.locator(".meal-context-add-menu");
    check(await menu.isVisible() && (await menu.locator("button").allTextContents()).map((t) => t.trim()).join(",") === "Event,Note", "the + opens a menu: Event, Note");
    const menuFits = await menu.evaluate((m) => { const r = m.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; });
    check(menuFits, "the menu fits on screen");
    if (SHOT) await page.screenshot({ path: `${SHOT}-${width}-menu.png` });
    await menu.locator("[data-meal-add-note]").click();
    const note = card.locator("[data-meal-note]");
    check(await note.isVisible() && await note.evaluate((t) => document.activeElement === t), "Note reveals and focuses the note box");
    await note.fill("Pick up bread");
    await note.blur();
    await page.waitForTimeout(200);
    const meal = await card.getAttribute("data-meal");
    const day = await card.getAttribute("data-day");
    const saved = await page.evaluate(({ day, meal }) => {
      const area = document.querySelector(`[data-meal-note][data-day="${day}"][data-meal="${meal}"]`);
      return area?.value;
    }, { day, meal });
    check(saved === "Pick up bread" && await note.isVisible(), "a written note stays shown");
    await note.fill("");
    await note.blur();
    check(!(await note.isVisible()), "an emptied note tucks away again");

    // + → Event
    await add.click();
    await page.locator(".meal-context-add-menu [data-meal-add-event]").click();
    await page.waitForSelector("#planEventDialog[open]", { timeout: 5000 });
    const form = await page.evaluate(() => ({
      date: document.getElementById("planEventDate").value,
      allDay: document.getElementById("planEventAllDay").checked,
      mealPlan: document.getElementById("planEventAddMealPlan")?.checked,
      timesShown: !document.getElementById("planTimeFields").hidden,
    }));
    const cardDate = await add.getAttribute("data-date");
    check(form.date === cardDate, "Event opens the editor on the meal's day", `${form.date} vs ${cardDate}`);
    check(!form.allDay && form.timesShown, "the new event is timed (the meal's mealtime)");
    check(form.mealPlan === true, "the new event is ticked Meal Plan");
    if (SHOT) await page.screenshot({ path: `${SHOT}-${width}-event.png` });
    await page.evaluate(() => document.getElementById("planEventDialog").close());

    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll");
    check(errors.length === 0, "no page errors", errors.join(" | "));
    await context.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
