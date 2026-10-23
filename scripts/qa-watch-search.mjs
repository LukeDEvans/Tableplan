#!/usr/bin/env node
// Headless QA for the Watch page (Luke, 2026-10-22): the Watch list fits four
// posters a row on a phone, and its search has no bookmark buttons — tapping a
// result adds it to the list, empties the search box and shows the list again.
//
//   node scripts/qa-watch-search.mjs [url]   (default http://localhost:4174/; needs `npm run dev:local`)
//   TMDB search, providers and YouTube are mocked; nothing leaves the machine.
//   QA_WATCH_SHOT=/path/prefix → also saves screenshots
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
const SHOT = process.env.QA_WATCH_SHOT || "";
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

const QA_TITLE = `QA Show ${Date.now() % 100000}`;
const QA_ID = String(900000 + (Date.now() % 90000));
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const browser = await launch();
try {
  for (const width of [390, 360]) {
    console.log(`\n${width}px`);
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.route(/tmdb-search/, (r) => r.fulfill(json({ results: [
      { tmdbId: QA_ID, type: "tv", title: QA_TITLE, year: "2024", posterPath: null },
    ] })));
    await page.route(/tmdb-watch-providers|tmdb-details|youtube-search/, (r) => r.fulfill(json({ results: [], items: [] })));

    await page.goto(URL + "#watch", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), { timeout: 20000 });
    if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
    await page.waitForSelector("#discoverSearchInput", { state: "visible", timeout: 20000 });
    await page.waitForTimeout(600);

    // Seed the list with five posters so the column count can be measured.
    const cols = await page.evaluate(() => {
      const grid = document.querySelector("#watchPlannerGrid .watch-grid") || (() => {
        const g = document.createElement("div");
        g.className = "watch-item-list watch-grid";
        document.getElementById("watchPlannerGrid").appendChild(g);
        return g;
      })();
      const probe = document.createElement("div");
      probe.className = "watch-item-list watch-grid";
      probe.dataset.qaProbe = "1";
      probe.innerHTML = Array.from({ length: 5 }, () => `<article class="watch-card"><div class="watch-poster"></div><div class="watch-card-meta"><span class="watch-card-title">A rather long show title</span></div></article>`).join("");
      grid.parentElement.appendChild(probe);
      const tops = [...probe.children].map((c) => Math.round(c.getBoundingClientRect().top));
      const n = tops.filter((t) => t === tops[0]).length;
      probe.remove();
      return n;
    });
    check(cols === 4, "Watch list shows four posters a row", `got ${cols}`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "nothing scrolls sideways");

    // Search, then tap the result.
    await page.fill("#discoverSearchInput", QA_TITLE);
    await page.waitForSelector("#discoverResults .discover-card", { timeout: 10000 });
    if (SHOT) await page.screenshot({ path: `${SHOT}-results-${width}.png` });
    check(await page.locator("#discoverResults .discover-save").count() === 0, "search results have no bookmark buttons");
    check(await page.locator("#discoverResults .discover-card--pick").count() >= 1, "result is a tappable card");
    await page.locator("#discoverResults .discover-card--pick").first().click({ position: { x: 30, y: 30 } });
    await page.waitForTimeout(700);

    check(await page.inputValue("#discoverSearchInput") === "", "search box is emptied");
    check(await page.evaluate(() => document.getElementById("discoverResults").hidden && !document.getElementById("watchPlannerGrid").hidden), "back on the Watch list");
    const added = await page.evaluate((t) => [...document.querySelectorAll("#watchPlannerGrid .watch-card-title")].filter((e) => e.textContent.trim() === t).length, QA_TITLE);
    check(added === 1, "the show is in the Watch list once", `found ${added}`);
    if (SHOT) await page.screenshot({ path: `${SHOT}-list-${width}.png` });

    // Tapping it again from search doesn't add a second copy.
    await page.fill("#discoverSearchInput", QA_TITLE);
    await page.waitForSelector("#discoverResults .discover-card--pick", { timeout: 10000 });
    await page.locator("#discoverResults .discover-card--pick").first().click({ position: { x: 30, y: 30 } });
    await page.waitForTimeout(700);
    const again = await page.evaluate((t) => [...document.querySelectorAll("#watchPlannerGrid .watch-card-title")].filter((e) => e.textContent.trim() === t).length, QA_TITLE);
    check(again === 1 && (await page.inputValue("#discoverSearchInput")) === "", "picking it again keeps one copy and still returns to the list", `found ${again}`);

    // Tidy: remove the QA show from local state.
    await page.evaluate((id) => {
      const s = window.__liveQA?.state?.();
      if (s?.watchItems) s.watchItems = s.watchItems.filter((w) => String(w.tmdbId) !== id);
    }, QA_ID);
    check(errors.length === 0, "no page errors", errors.join(" | "));
    await context.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n✖ ${failed} check(s) failed` : `\n✔ all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
