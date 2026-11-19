// Listen's Podcasts (Shows) and Books grids match the Watch page: four covers a
// row on a phone, and tapping a cover opens a panel under its row. Run against
// the dev server (npm run dev:local):  node scripts/qa-listen-grid.mjs [outDir]
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const URL = "http://localhost:4174/";
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const LAUNCH = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
async function launch() {
  try { return await chromium.launch({ ...LAUNCH, channel: "chrome" }); } catch { /* next */ }
  try { return await chromium.launch(LAUNCH); } catch { /* next */ }
  const p = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(p)) return chromium.launch({ ...LAUNCH, executablePath: p });
  throw new Error("No Chromium found");
}
let failed = 0;
const check = (ok, label, extra = "") => { console.log(`  ${ok ? "✓" : "✖"} ${label}${ok ? "" : " " + extra}`); if (!ok) failed++; };
const art = (c) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="${c}"/></svg>`)}`;
const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
const podcasts = ["Alpha Hour", "Bravo Daily", "Charlie Talks", "Delta Signal", "Echo Chamber Notes With A Long Title", "Foxtrot", "Golf Report"].map((title, i) => ({
  id: `pod${i}`, title, url: "", art: i === 5 ? "" : art(["#b5651d", "#2a6f97", "#6a4c93", "#2d6a4f", "#9d0208", "#444", "#e09f3e"][i]),
  lastFetched: day(0),
  episodes: Array.from({ length: 9 }, (_, n) => ({ id: `pod${i}-ep${n}`, title: `${title} — episode ${20 - n}`, pubDate: day(n * 3 + i), duration: 1800 + n * 60, audioUrl: "https://example.invalid/a.mp3" })),
}));
const books = Array.from({ length: 10 }, (_, i) => ({
  id: `book${i}`, title: ["The Long Way", "Salt", "North Woods", "A Very Long Book Title That Wraps Around", "Tides", "Orbit", "Home", "Ash", "Field Notes", "Winter"][i],
  authors: [`Author ${i}`], status: i < 2 ? "reading" : i < 8 ? "want" : "read", format: "audiobook",
  coverUrl: i === 3 ? null : art(["#264653", "#2a9d8f", "#e9c46a", "#f4a261", "#e76f51", "#6d597a", "#355070", "#b56576", "#457b9d", "#1d3557"][i]),
  year: 2000 + i, pageCount: 200 + i * 10, categories: [], readDate: i >= 8 ? "2026-01-0" + i : null, createdAt: day(i),
}));

const browser = await launch();
for (const [name, width, height] of [["phone", 390, 844], ["laptop", 1280, 800]]) {
  console.log(`▸ ${name} (${width}px)`);
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: name === "phone" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => { const b = document.getElementById("lockDevSignInBtn"); return document.body.classList.contains("app-authed") || (b && !b.hidden && b.offsetParent); }, { timeout: 30000 });
  if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"));
  await page.waitForTimeout(1200);
  await page.evaluate(({ podcasts, books }) => window.__liveQA.listenSeedForQa({ podcasts, books }), { podcasts, books });
  await page.evaluate(() => document.getElementById("homeListenBtn").click());
  await page.waitForTimeout(600);
  const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}-${n}.png` }); };

  // ── Podcasts › Shows ──
  await page.evaluate(() => document.querySelector('[data-media-tab="podcasts"]').click());
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-podcast-tab="shows"]').click());
  await page.waitForSelector(".podcast-shows-grid [data-show-id]");
  const perRow = (sel) => page.evaluate((sel) => {
    const cards = [...document.querySelectorAll(sel)].filter((c) => c.offsetParent);
    const top = cards[0].getBoundingClientRect().top;
    return cards.filter((c) => Math.abs(c.getBoundingClientRect().top - top) < 2).length;
  }, sel);
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  if (name === "phone") check((await perRow(".podcast-shows-grid .watch-card")) === 4, "Shows: four covers in a row");
  check(await noSideScroll(), "Shows: no sideways scroll");
  await shot("1-shows");
  await page.click('.podcast-shows-grid [data-show-id="pod1"]');
  await page.waitForSelector('[data-podcast-show-detail="pod1"]');
  await page.waitForTimeout(400);
  check(await page.evaluate(() => !!document.querySelector(".podcast-shows-grid [data-show-id='pod0']")), "Shows: the grid stays on screen with the panel open");
  check((await page.locator('[data-podcast-show-detail] .podcast-episode-row').count()) === 5, "Shows: panel lists the 5 most recent episodes");
  check((await page.locator('[data-podcast-show-detail] .podcast-episode-row .article-row-title').first().textContent()).includes("episode 20"), "Shows: newest episode first");
  check(await page.evaluate(() => {
    const d = document.querySelector("[data-podcast-show-detail]"), c = document.querySelector('.podcast-shows-grid [data-show-id="pod1"]');
    const row = [...document.querySelectorAll(".podcast-shows-grid .watch-card")].filter((x) => Math.abs(x.getBoundingClientRect().top - c.getBoundingClientRect().top) < 2);
    return row.every((x) => x.getBoundingClientRect().bottom <= d.getBoundingClientRect().top + 1) && d.getBoundingClientRect().width > c.getBoundingClientRect().width * 3;
  }), "Shows: panel spans the grid under the open cover's row");
  check(await page.evaluate(() => {
    const d = document.querySelector("[data-podcast-show-detail]"), p = document.querySelector('.podcast-shows-grid [data-show-id="pod1"] .watch-poster').getBoundingClientRect();
    const ptr = d.querySelector(".watch-detail-pointer").getBoundingClientRect();
    return Math.abs((ptr.left + ptr.width / 2) - (p.left + p.width / 2)) < 3;
  }), "Shows: pointer sits under the open cover");
  check(await noSideScroll(), "Shows: no sideways scroll with the panel open");
  await shot("2-show-panel");
  await page.click('.podcast-shows-grid [data-show-id="pod2"]');
  await page.waitForSelector('[data-podcast-show-detail="pod2"]');
  check((await page.locator("[data-podcast-show-detail]").count()) === 1, "Shows: opening another show moves the panel");
  await page.click('.podcast-shows-grid [data-show-id="pod2"]');
  await page.waitForTimeout(200);
  check((await page.locator("[data-podcast-show-detail]").count()) === 0, "Shows: tapping the open cover closes the panel");
  await page.click('.podcast-shows-grid [data-show-id="pod4"]');
  await page.waitForSelector('[data-podcast-show-detail="pod4"]');
  await page.waitForTimeout(400);
  await shot("3-show-panel-row2");
  await page.click("[data-podcast-show-all]");
  await page.waitForSelector("#podcastShowBackBtn");
  check((await page.locator("#podcastEpisodeList .podcast-episode-row").count()) === 9, "Shows: All episodes opens the show's full list");
  await page.click("#podcastShowBackBtn");
  await page.waitForSelector('[data-podcast-show-detail="pod4"]');
  check(true, "Shows: Back returns to the grid with the panel still open");

  // ── Books ──
  await page.evaluate(() => document.querySelector('[data-media-tab="books"]').click());
  await page.waitForSelector("#readingPlannerGrid .listen-card[data-reading-item]");
  await page.waitForTimeout(300);
  if (name === "phone") check((await perRow("#readingPlannerGrid .watch-section:nth-of-type(2) .watch-card")) === 4, "Books: four covers in a row");
  check(await noSideScroll(), "Books: no sideways scroll");
  await shot("4-books");
  await page.click('[data-reading-item="book3"]');
  await page.waitForSelector('[data-reading-detail="book3"]');
  await page.waitForTimeout(400);
  check((await page.locator("[data-reading-detail] .reading-library-btn").count()) === 3, "Books: panel has the library, Libby and Audible links");
  check((await page.locator("[data-reading-detail] .watch-detail-sub").textContent()).includes("Author 3"), "Books: panel shows the author");
  check(await noSideScroll(), "Books: no sideways scroll with the panel open");
  await shot("5-book-panel");
  await page.click("[data-reading-detail] [data-reading-menu]");
  await page.waitForSelector(".watch-item-context-menu");
  check(true, "Books: the panel's ⋯ opens Shelves & options");
  await shot("6-book-menu");
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector(".watch-item-context-menu")?.remove());
  await page.click('[data-reading-item="book3"]');
  await page.waitForTimeout(200);
  check((await page.locator("[data-reading-detail]").count()) === 0, "Books: tapping the open cover closes the panel");
  check(errors.length === 0, "no page errors", errors.join(" | "));
  await page.close();
}
await browser.close();
if (failed) { console.error(`\n✖ ${failed} check(s) failed`); process.exit(1); }
console.log("\n✓ Listen grid QA passed");
