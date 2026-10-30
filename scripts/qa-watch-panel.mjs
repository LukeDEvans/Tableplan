#!/usr/bin/env node
// Headless QA for the Watch page (Luke, 2026-10-29): the show panel opens under
// the whole row (the row stays put), a pointer marks the open poster and slides
// within a row, Watched · Tabs · Remove work by tapping, Remove has Undo, the
// Next-episode line ticks an episode, the tracker's check boxes are small, a
// season's open state isn't saved, "Find the right title" links a plain title
// and tags titles already on the list, there's no "+" to add a show (the search
// bar does that), a short list starts at the top, and services outside yours
// sit behind an "Other services" button.
//
//   node scripts/qa-watch-panel.mjs [url]   (default http://localhost:4174/; needs `npm run dev:local`)
//   TMDB is mocked; nothing leaves the machine. QA_WATCH_SHOT=/path/prefix → screenshots.
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
const SHOT = process.env.QA_WATCH_SHOT || "";
const LAUNCH = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
const results = [];
const check = (cond, name, detail) => {
  results.push(!!cond);
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}${detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
};

async function launch() {
  try { return await chromium.launch({ ...LAUNCH, channel: "chrome" }); } catch { /* none */ }
  try { return await chromium.launch(LAUNCH); } catch { /* none */ }
  const p = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(p)) return chromium.launch({ ...LAUNCH, executablePath: p });
  throw new Error("No Chromium available");
}
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const prov = (n) => ({ link: "https://www.themoviedb.org/x", flatrate: [{ provider_id: 1, provider_name: n }] });
const eps = (n) => Array.from({ length: n }, (_, i) => ({ episodeNumber: i + 1, name: `A fairly long episode title number ${i + 1}` }));
// Fresh ids each run: a removal in an earlier run stays recorded (and syncs back).
const RUN = String(Date.now() % 1000000);
let R = RUN;
const seedFor = (r) => JSON.parse(JSON.stringify(SEED).replaceAll(`-${RUN}"`, `-${r}"`));
const SEED = [
  { id: `qa-m1-${R}`, type: "movie", title: "Oppenheimer", tmdbId: 872585, year: "2023", runtime: 181, streamingProviders: prov("Peacock"), createdAt: "2026-10-01T00:00:00Z" },
  { id: `qa-m2-${R}`, type: "movie", title: "Past Lives", tmdbId: 666277, year: "2023", streamingProviders: prov("Max"), createdAt: "2026-10-02T00:00:00Z" },
  { id: `qa-m3-${R}`, type: "movie", title: "Arrival", tmdbId: 329865, year: "2016", streamingProviders: prov("Netflix"), createdAt: "2026-10-03T00:00:00Z" },
  { id: `qa-m4-${R}`, type: "movie", title: "Heat", tmdbId: 949, year: "1995", streamingProviders: prov("Netflix"), createdAt: "2026-10-04T00:00:00Z" },
  { id: `qa-m5-${R}`, type: "movie", title: "Some Title From Notes", createdAt: "2026-10-05T00:00:00Z" },
  { id: `qa-t1-${R}`, type: "tv", title: "House of the Dragon", tmdbId: 94997, year: "2022", totalSeasons: 3, streamingProviders: prov("Max"),
    seasonProgress: { 1: { watched: true }, 2: { watched: true }, 3: { episodes: { 1: true, 2: true, 3: true, 4: true, 5: true }, __expanded: true } },
    episodeData: { 3: eps(8) }, createdAt: "2026-07-22T00:00:00Z" },
];
const SEARCH = [
  { tmdbId: 111, type: "movie", title: "The Right Match", year: "2019", posterPath: null },
  { tmdbId: 872585, type: "movie", title: "Oppenheimer", year: "2023", posterPath: null },
];

const browser = await launch();
try {
  for (const width of [390, 360]) {
    console.log(`\n${width}px`);
    R = `${RUN}w${width}`; // fresh ids per width too
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.route(/image\.tmdb\.org/, (r) => r.fulfill({ status: 404, body: "" }));
    await page.route(/(functions|api)\/tmdb-search/, (r) => r.fulfill(json({ results: SEARCH })));
    await page.route(/(functions|api)\/tmdb-season/, (r) => r.fulfill(json({ episodes: eps(8) })));
    await page.route(/(?:functions|api)\/(tmdb-watch-providers|tmdb-details|youtube-search|stream-links|showtimes)/, (r) => r.fulfill(json({ results: [], items: [], providers: null })));

    await page.goto(URL + "#watch", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), null, { timeout: 30000 });
    if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
    await page.waitForSelector("#discoverSearchInput", { state: "visible", timeout: 20000 });
    // Seed only once the view's rows are settled (they can swap in after boot).
    await page.waitForFunction(() => window.__liveQA?.viewsReady?.() === true, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.evaluate((r) => { globalThis.__qaR = r; }, R);
    await page.evaluate((items) => window.__liveQA.watchSeedForQa(items), seedFor(R));
    await page.evaluate(() => document.querySelector('[data-watch-category="all"]')?.click());
    await page.waitForTimeout(400);

    const tops = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-watch-item]")].map((c) => [c.dataset.watchItem, Math.round(c.getBoundingClientRect().top + scrollY)])));
    const before = await tops();
    if (process.env.QA_DEBUG) console.log("seeded", seedFor(R).map((i) => i.id), Object.keys(before));
    check(before[`qa-m1-${globalThis.__qaR ?? R}`] === before[`qa-m4-${globalThis.__qaR ?? R}`], "four movies share the first row", before);

    // Open the 2nd poster: the row stays put, the panel sits under the whole row.
    await page.locator(`[data-watch-item="qa-m2-${globalThis.__qaR ?? R}"]`).tap();
    await page.waitForTimeout(350);
    const after = await tops();
    check([`qa-m1-${globalThis.__qaR ?? R}`, `qa-m2-${globalThis.__qaR ?? R}`, `qa-m3-${globalThis.__qaR ?? R}`, `qa-m4-${globalThis.__qaR ?? R}`].every((id) => after[id] === after[`qa-m1-${globalThis.__qaR ?? R}`]), "the row stays put when a poster opens", after);
    const geo = await page.evaluate(() => {
      const d = document.querySelector(`[data-watch-detail="qa-m2-${globalThis.__qaR ?? R}"]`);
      const row = [...document.querySelectorAll(`[data-watch-item="qa-m1-${globalThis.__qaR ?? R}"],[data-watch-item="qa-m4-${globalThis.__qaR ?? R}"]`)].map((c) => c.getBoundingClientRect().bottom);
      const p = document.querySelector(`[data-watch-item="qa-m2-${globalThis.__qaR ?? R}"] .watch-poster`).getBoundingClientRect();
      const ptr = d?.querySelector(".watch-detail-pointer")?.getBoundingClientRect();
      return { below: d && d.getBoundingClientRect().top >= Math.max(...row) - 1, ptrX: ptr && Math.round(ptr.left + ptr.width / 2), posterX: Math.round(p.left + p.width / 2) };
    });
    check(geo.below, "the panel opens under the whole row");
    check(geo.ptrX != null && Math.abs(geo.ptrX - geo.posterX) <= 2, "the pointer points at the open poster", geo);
    if (SHOT) await page.screenshot({ path: `${SHOT}-panel-${width}.png` });

    // Services: no "Your services" / "Other services" headings; services outside
    // yours fold into one "Other services" button that opens a window (Luke, 2026-10-29).
    const m2 = `qa-m2-${globalThis.__qaR ?? R}`;
    await page.waitForSelector(`[data-watch-detail="${m2}"] [data-watch-other-services]`, { timeout: 8000 }).catch(() => {});
    check(await page.locator(`[data-watch-detail="${m2}"] .discover-svc-label`).count() === 0, "the panel has no services headings");
    const otherBtn = page.locator(`[data-watch-detail="${m2}"] [data-watch-other-services]`);
    check(await otherBtn.count() === 1, "services outside yours fold into an 'Other services' button");
    if (await otherBtn.count()) {
      const looks = await page.evaluate((id) => {
        const b = document.querySelector(`[data-watch-detail="${id}"] [data-watch-other-services]`);
        return b.classList.contains("discover-svc") && getComputedStyle(b).borderRadius === "999px";
      }, m2);
      check(looks, "…styled like the service buttons");
      await otherBtn.tap();
      await page.waitForTimeout(250);
      const win = await page.evaluate(() => {
        const d = document.getElementById("watchOtherServicesDialog");
        return { open: d.open, title: d.querySelector("#watchOtherServicesTitle").textContent, services: [...d.querySelectorAll("#watchOtherServicesBody .discover-svc")].map((b) => b.textContent.trim()) };
      });
      check(win.open && win.title === "Past Lives" && win.services.join() === "Max", "…which opens a window naming the other services", win);
      if (SHOT) await page.screenshot({ path: `${SHOT}-other-${width}.png` });
      await page.locator("#closeWatchOtherServicesBtn").tap();
      await page.waitForTimeout(200);
      check(!(await page.evaluate(() => document.getElementById("watchOtherServicesDialog").open)), "…and closes");
    }

    // Another poster in the same row: the pointer slides; the panel doesn't re-animate.
    await page.locator(`[data-watch-item="qa-m4-${globalThis.__qaR ?? R}"]`).tap();
    await page.waitForTimeout(60);
    const slide = await page.evaluate(() => {
      const d = document.querySelector(`[data-watch-detail="qa-m4-${globalThis.__qaR ?? R}"]`);
      return { sliding: d?.classList.contains("is-sliding"), steady: d?.classList.contains("is-steady") };
    });
    check(slide.sliding && slide.steady, "switching within the row slides the pointer", slide);
    await page.waitForTimeout(350);
    const geo2 = await page.evaluate(() => {
      const ptr = document.querySelector(`[data-watch-detail="qa-m4-${globalThis.__qaR ?? R}"] .watch-detail-pointer`).getBoundingClientRect();
      const p = document.querySelector(`[data-watch-item="qa-m4-${globalThis.__qaR ?? R}"] .watch-poster`).getBoundingClientRect();
      return Math.abs((ptr.left + ptr.width / 2) - (p.left + p.width / 2));
    });
    check(geo2 <= 2, "…and ends at the new poster", geo2);
    check(await page.locator(`[data-watch-item="qa-m4-${globalThis.__qaR ?? R}"].is-expanded`).count() === 1, "the open poster carries the ring");

    // Tap again closes.
    await page.locator(`[data-watch-item="qa-m4-${globalThis.__qaR ?? R}"]`).tap();
    await page.waitForTimeout(200);
    check(await page.locator("[data-watch-detail]").count() === 0, "tapping the open poster closes the panel");

    // Remove with Undo.
    await page.locator(`[data-watch-item="qa-m3-${globalThis.__qaR ?? R}"]`).tap();
    await page.waitForTimeout(250);
    await page.locator(`[data-watch-act-remove="qa-m3-${globalThis.__qaR ?? R}"]`).tap();
    await page.waitForTimeout(200);
    check(await page.locator(`[data-watch-item="qa-m3-${globalThis.__qaR ?? R}"]`).count() === 0, "Remove hides the show at once");
    check(await page.locator("#mailToast .mail-toast-undo").count() === 1, "…with an Undo toast");
    const tombEarly = await page.evaluate(() => window.__liveQA.watchTombstonesForQa());
    check(!(tombEarly || []).includes(`qa-m3-${globalThis.__qaR ?? R}`), "…and nothing recorded until the toast is gone", tombEarly);
    await page.evaluate(() => document.querySelector("#mailToast .mail-toast-undo").click());
    await page.waitForTimeout(200);
    check(await page.locator(`[data-watch-item="qa-m3-${globalThis.__qaR ?? R}"]`).count() === 1, "Undo puts it back");
    await page.waitForTimeout(6300);
    check(await page.locator(`[data-watch-item="qa-m3-${globalThis.__qaR ?? R}"]`).count() === 1, "…and it stays after the toast would have expired");

    // Remove for real.
    await page.locator(`[data-watch-item="qa-m3-${globalThis.__qaR ?? R}"]`).tap();
    await page.waitForTimeout(250);
    await page.locator(`[data-watch-act-remove="qa-m3-${globalThis.__qaR ?? R}"]`).tap();
    await page.waitForTimeout(6400);
    const gone = await page.evaluate(() => window.__liveQA.watchItemsForQa());
    check(Array.isArray(gone) && !gone.some((i) => i.id === `qa-m3-${globalThis.__qaR ?? R}`), "without Undo the show is removed", gone && gone.map((i) => i.id));
    check((await page.evaluate(() => window.__liveQA.watchTombstonesForQa())).includes(`qa-m3-${globalThis.__qaR ?? R}`), "…and the removal is recorded for sync");

    // Tabs popover.
    await page.locator(`[data-watch-item="qa-m1-${globalThis.__qaR ?? R}"]`).tap();
    await page.waitForTimeout(250);
    await page.waitForTimeout(400); // let the open's scroll finish (a scroll closes menus)
    await page.locator(`[data-watch-act-tabs="qa-m1-${globalThis.__qaR ?? R}"]`).tap();
    await page.waitForTimeout(150);
    check(await page.locator(".watch-tabs-menu [data-watch-tab-new]").count() === 1, "Tabs opens a menu with New tab…");
    await page.locator(".watch-tabs-menu [data-watch-tab-new]").tap();
    await page.waitForTimeout(150);
    await page.fill("#watchCategoryInlineInput", "Date night");
    await page.press("#watchCategoryInlineInput", "Enter");
    await page.waitForTimeout(250);
    const filed = await page.evaluate(() => {
      const items = window.__liveQA.watchItemsForQa();
      return items.find((i) => i.id === `qa-m1-${globalThis.__qaR ?? R}`)?.categories?.length || 0;
    });
    check(filed === 1, "New tab… files the show under the new tab", filed);
    await page.evaluate(() => document.querySelector('[data-watch-category="all"]')?.click());
    await page.waitForTimeout(200);

    // Watched opens the log window.
    await page.locator(`[data-watch-item="qa-m1-${globalThis.__qaR ?? R}"]`).tap();
    await page.waitForTimeout(250);
    await page.locator(`[data-watch-act-watched="qa-m1-${globalThis.__qaR ?? R}"]`).tap();
    await page.waitForTimeout(200);
    const checkBtn = await page.evaluate(() => {
      const b = document.querySelector(`[data-watch-act-watched="qa-m1-${globalThis.__qaR ?? R}"]`);
      return b && { text: b.textContent.trim(), label: b.getAttribute("aria-label"), w: Math.round(b.getBoundingClientRect().width), circle: !!b.querySelector("svg circle") };
    });
    check(checkBtn && !checkBtn.text && checkBtn.label === "Watched" && checkBtn.circle && checkBtn.w <= 48, "Watched is just a check in a circle (no word)", checkBtn);
    check(await page.evaluate(() => document.getElementById("watchLogDialog")?.open), "Watched opens the watched/rating window");
    await page.evaluate(() => document.getElementById("watchLogDialog")?.close());

    // Next episode + tracker layout. A short screen so the list has to scroll,
    // which is what makes a redraw jump.
    await page.setViewportSize({ width, height: 560 });
    await page.waitForTimeout(200);
    await page.locator(`[data-watch-item="qa-t1-${globalThis.__qaR ?? R}"]`).scrollIntoViewIfNeeded();
    await page.locator(`[data-watch-item="qa-t1-${globalThis.__qaR ?? R}"]`).tap();
    await page.waitForTimeout(350);
    const nextText = await page.locator(`[data-watch-detail="qa-t1-${globalThis.__qaR ?? R}"] .watch-next-ep`).textContent().catch(() => "");
    check(/S3 E6/.test(nextText || ""), "Next shows S3 E6", nextText);
    if (SHOT) await page.screenshot({ path: `${SHOT}-tv-${width}.png` });
    await page.locator("[data-watch-next-tick]").tap();
    await page.waitForTimeout(300);
    const nextText2 = await page.locator(`[data-watch-detail="qa-t1-${globalThis.__qaR ?? R}"] .watch-next-ep`).textContent().catch(() => "");
    check(/S3 E7/.test(nextText2 || ""), "ticking it moves Next to S3 E7", nextText2);
    check(await page.locator(`[data-watch-detail="qa-t1-${globalThis.__qaR ?? R}"] .watch-episode`).count() === 0, "seasons start closed (the old saved open flag is ignored)");
    const s3 = `[data-watch-season-expand="qa-t1-${globalThis.__qaR ?? R}"][data-season="3"]`;
    await page.locator(s3).scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const where = () => page.evaluate((sel) => ({ top: Math.round(document.querySelector(sel).getBoundingClientRect().top), list: Math.round(document.querySelector(".watch-list-panel").scrollTop), win: Math.round(scrollY) }), s3);
    const w0 = await where();
    await page.locator(s3).tap();
    await page.waitForTimeout(300);
    const w1 = await where();
    check(w0.list + w0.win > 0, "(the list is scrolled down for the next checks)", w0);
    check(Math.abs(w1.top - w0.top) <= 1, "opening a season doesn't move the screen", { w0, w1 });
    const ep8 = page.locator(`[data-watch-episode="qa-t1-${globalThis.__qaR ?? R}"][data-episode="8"]`);
    await ep8.scrollIntoViewIfNeeded(); // the tap would do this itself; measure after it
    await page.waitForTimeout(150);
    const w1b = await where();
    await ep8.tap();
    await page.waitForTimeout(300);
    const w2 = await where();
    check(w1b.list + w1b.win > 0 && Math.abs(w2.top - w1b.top) <= 1, "ticking an episode doesn't move the screen", { w1b, w2 });
    check(await page.evaluate(() => window.__liveQA.watchItemsForQa().find((i) => i.id === `qa-t1-${globalThis.__qaR ?? R}`).seasonProgress[3].episodes[8] === true), "…and the tick is saved");
    const sizes = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".watch-episode")].map((e) => e.getBoundingClientRect());
      const name = document.querySelector(".watch-episode-name").getBoundingClientRect().height;
      return { head: Math.round(document.querySelector(".watch-season-head").getBoundingClientRect().height), row: Math.round(rows[0].height), name: Math.round(name), gap: Math.round(rows[1].top - rows[0].bottom) };
    });
    check(sizes.head <= 34, "season boxes are about 2/3 of the old 48px", sizes);
    // A row is its title plus 2px; a long title still wraps to a second line.
    check(sizes.row <= Math.max(sizes.name, 20) + 3 && sizes.gap <= 1, "episodes sit close together", sizes);
    const lay = await page.evaluate(() => {
      const cb = document.querySelector(".watch-episode .watch-check").getBoundingClientRect().width;
      const sc = document.querySelector(".watch-season-check").getBoundingClientRect().width;
      const name = document.querySelector(".watch-episode-name").getBoundingClientRect().width;
      const head = document.querySelector(".watch-season-name").getBoundingClientRect().height;
      return { cb, sc, name, head };
    });
    check(lay.cb <= 24 && lay.sc <= 24, "tracker check boxes are small", lay);
    check(lay.name > 180, "episode titles get the row's width", lay);
    check(lay.head < 26, "'Season 3' stays on one line", lay);
    const savedOpen = await page.evaluate(() => JSON.stringify(window.__liveQA.watchItemsForQa().find((i) => i.id === `qa-t1-${globalThis.__qaR ?? R}`).seasonProgress));
    check(!/__expanded/.test(savedOpen), "opening a season isn't saved", savedOpen);
    if (SHOT) await page.screenshot({ path: `${SHOT}-tracker-${width}.png` });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "nothing scrolls sideways");
    await page.setViewportSize({ width, height: 844 });

    // Link a plain title.
    await page.locator(`[data-watch-item="qa-m5-${globalThis.__qaR ?? R}"]`).scrollIntoViewIfNeeded();
    await page.locator(`[data-watch-item="qa-m5-${globalThis.__qaR ?? R}"]`).tap();
    await page.waitForTimeout(250);
    await page.locator(`[data-watch-find="qa-m5-${globalThis.__qaR ?? R}"]`).tap();
    await page.waitForSelector("#watchSearchDialogResults .watch-tmdb-result", { timeout: 5000 });
    check(await page.inputValue("#watchSearchDialogInput") === "Some Title From Notes", "Find starts with the show's title");
    check(/Find the right title/.test(await page.locator("#watchSearchDialog h2").textContent()), "…in link mode");
    if (SHOT) await page.screenshot({ path: `${SHOT}-link-${width}.png` });
    const tags = await page.locator("#watchSearchDialogResults .watch-result-tag").allTextContents();
    check(tags.length === 1 && tags[0] === "In your list", "a result already on the list is tagged", tags);
    await page.locator("#watchSearchDialogResults .watch-tmdb-result").nth(1).tap();
    await page.waitForTimeout(250);
    check(await page.evaluate(() => document.getElementById("watchSearchDialog").open), "…and can't be picked to link");
    await page.locator("#watchSearchDialogResults .watch-tmdb-result").first().tap();
    await page.waitForTimeout(300);
    const linked = await page.evaluate(() => window.__liveQA.watchItemsForQa().find((i) => i.id === `qa-m5-${globalThis.__qaR ?? R}`));
    check(linked?.tmdbId === 111 && linked?.title === "Some Title From Notes", "the tapped result links that show (same entry)", linked && { tmdbId: linked.tmdbId, title: linked.title });

    // No "+" to add a show: the search bar does that (Luke, 2026-10-29). The tab "+" stays.
    check(await page.locator(".watch-category-bar [data-open-watch-search], .watch-corner-btn").count() === 0, "no '+' to add a show beside the tabs");
    check(await page.locator(".watch-category-bar [data-watch-category-add]").count() === 1, "…the '+' that adds a tab is still there");

    // A short list starts at the top of the list area, not the middle (Luke, 2026-10-29).
    for (const [label, kinds] of [["TV only", ["tv", "tv", "tv"]], ["movies and TV", ["movie", "tv", "movie", "tv"]]]) {
      await page.evaluate((items) => window.__liveQA.watchSeedForQa(items), kinds.map((type, i) => ({ id: `qa-s${i}-${R}-${label.length}`, type, title: `Short ${i}`, tmdbId: 8000 + i })));
      await page.waitForTimeout(300);
      const gaps = await page.evaluate(() => {
        const list = document.querySelector(".watch-list-panel").getBoundingClientRect().top;
        const heads = [...document.querySelectorAll(".watch-section-head")].map((h) => h.getBoundingClientRect());
        const grids = [...document.querySelectorAll(".watch-grid")].map((g) => g.getBoundingClientRect());
        return { firstPoster: Math.round(grids[0].top - list), headToGrid: Math.round(grids[0].top - heads[0].bottom), between: heads[1] ? Math.round(heads[1].top - grids[0].bottom) : null };
      });
      check(gaps.firstPoster < 60 && gaps.headToGrid < 16 && (gaps.between === null || gaps.between < 40), `a short list (${label}) starts at the top`, gaps);
      if (SHOT) await page.screenshot({ path: `${SHOT}-short-${label.length}-${width}.png` });
    }
    await page.evaluate(() => document.querySelector("[data-watch-focus-search]") === null);
    await page.evaluate(() => window.__liveQA.watchSeedForQa([]));
    await page.waitForTimeout(300);
    await page.locator("[data-watch-focus-search]").tap();
    check(await page.evaluate(() => document.activeElement?.id === "discoverSearchInput"), "the empty list's button goes to the search bar");

    check(errors.length === 0, "no page errors", errors.slice(0, 3));
    await context.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n✗ ${failed} of ${results.length} checks failed` : `\n✔ all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
