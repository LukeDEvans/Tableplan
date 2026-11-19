#!/usr/bin/env node
// Headless QA for upcoming podcast episodes and the series hold
// (PODCAST_UPCOMING_DESIGN.md). Seeds a show whose series has parts 1–2 out and
// parts 3–4 announced, plus the cached upcoming rows, then checks:
// the queue holds parts 1–2; the show's panel lists "Coming …" rows and a held
// card; "Release now" puts the series in the queue; stale rows hold nothing;
// no sideways scroll on a phone.
//
//   node scripts/qa-podcast-upcoming.mjs [url] [screenshot-dir]
//   (default http://localhost:4174/; needs `npm run dev:local`)
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
const OUT = process.argv[3] || "";
const LAUNCH = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
const results = [];
const check = (cond, name, detail) => {
  results.push(!!cond);
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
};
async function launch() {
  try { return await chromium.launch({ ...LAUNCH, channel: "chrome" }); } catch { /* none */ }
  try { return await chromium.launch(LAUNCH); } catch { /* none */ }
  const p = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(p)) return chromium.launch({ ...LAUNCH, executablePath: p });
  throw new Error("No Chromium available");
}

const DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString();
const FEED = "https://feeds.megaphone.fm/GLT4787413333";
const S = "The Charge of the Light Brigade";
const podcasts = [
  { id: "trih", title: "The Rest Is History", url: FEED, art: "", episodes: [
    { id: "lb1", title: `${S}: Outbreak of The Crimean War (Part 1)`, pubDate: iso(Date.now() - 4 * DAY), audioUrl: "https://example.invalid/1.mp3" },
    { id: "lb2", title: `${S}: The Tsar’s Terrible Siege (Part 2)`, pubDate: iso(Date.now() - 1 * DAY), audioUrl: "https://example.invalid/2.mp3" },
    { id: "solo", title: "The Squire: The Most Important Man in History", pubDate: iso(Date.now() - 2 * DAY), audioUrl: "https://example.invalid/s.mp3" },
  ] },
];
const upcomingRows = (fetchedAgo) => [
  { feed_url: FEED, title: `${S}: Crushing the Russians (Part 3)`, expected_at: iso(Date.now() + 2 * DAY), fetched_at: iso(Date.now() - fetchedAgo), first_seen_at: iso(Date.now() - fetchedAgo) },
  { feed_url: FEED, title: `${S}: Into The Valley of Death (Part 4)`, expected_at: iso(Date.now() + 5 * DAY), fetched_at: iso(Date.now() - fetchedAgo), first_seen_at: iso(Date.now() - fetchedAgo) },
];

const browser = await launch();
try {
  for (const [label, fetchedAgo] of [["fresh rows", 2 * 3600e3], ["stale rows", 4 * DAY]]) {
    console.log(`▸ ${label}`);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, timezoneId: "America/Chicago" });
    // `at` is now, so the app doesn't re-fetch (local dev has no Supabase anyway).
    await context.addInitScript((rows) => {
      localStorage.setItem("live-podcast-upcoming-v1", JSON.stringify({ at: Date.now(), rows }));
    }, upcomingRows(fetchedAgo));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), { timeout: 30000 });
    if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
    await page.waitForFunction(() => !!window.__liveQA?.viewsReady?.(), { timeout: 20000 });
    await page.waitForTimeout(500);
    await page.evaluate((p) => window.__liveQA.listenSeedForQa({ podcasts: p, books: [] }), podcasts);
    const queue = () => page.evaluate(() => window.__liveQA.listenQueueForQa());

    let q = await queue();
    if (label === "fresh rows") {
      check(!q.includes("lb1") && !q.includes("lb2"), "parts 1–2 are held from the queue", JSON.stringify(q));
      check(q.includes("solo"), "an episode outside the series is still queued", JSON.stringify(q));
    } else {
      check(q.includes("lb1") && q.includes("lb2"), "stale rows hold nothing (Luke, 2026-11-19)", JSON.stringify(q));
    }

    await page.evaluate(() => document.getElementById("homeListenBtn").click());
    await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('[data-media-tab="podcasts"]').click());
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('[data-podcast-tab="shows"]').click());
    await page.waitForSelector('.podcast-shows-grid [data-show-id="trih"]');
    await page.click('.podcast-shows-grid [data-show-id="trih"]');
    await page.waitForSelector('[data-podcast-show-detail="trih"]');
    await page.waitForTimeout(300);
    const panel = '[data-podcast-show-detail="trih"]';
    const rows = await page.locator(`${panel} .podcast-upcoming-row`).allTextContents();
    const noSideScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    if (label === "fresh rows") {
      check(rows.length === 2, "panel lists the two coming parts", JSON.stringify(rows));
      check(/Part 3 · Crushing/.test(rows[0] || "") && /Coming \w{3}, \w{3} \d+/.test(rows[0] || ""), "soonest first, with its date", rows[0]);
      const card = await page.locator(`${panel} .podcast-bundle-card`).textContent().catch(() => "");
      check(/Light Brigade/.test(card) && /2 of 4 parts out/.test(card), "held card names the series and counts parts", card?.replace(/\s+/g, " "));
      check(noSideScroll, "no sideways scroll with the panel open");
      if (OUT) await page.screenshot({ path: `${OUT}/upcoming-panel.png` });
      await page.click(`${panel} [data-release-series]`);
      await page.waitForTimeout(300);
      q = await queue();
      check(q.includes("lb1") && q.includes("lb2"), "Release now puts the series in the queue", JSON.stringify(q));
      check((await page.locator(`${panel} .podcast-bundle-card`).count()) === 0, "the held card goes after Release now");
      // "All episodes" view shows the same rows
      await page.click(`${panel} [data-podcast-show-all]`);
      await page.waitForTimeout(300);
      check((await page.locator("#podcastEpisodeList > .podcast-upcoming .podcast-upcoming-row").count()) === 2, "All episodes lists the coming parts too");
      check((await page.locator("#podcastBundleToggle").count()) === 0, "the old per-show switch is gone");
    } else {
      check(rows.length === 0 && (await page.locator(`${panel} .podcast-bundle-card`).count()) === 0, "stale rows show nothing in the panel", JSON.stringify(rows));
    }
    check(errors.length === 0, "no page errors", errors.join(" | "));
    await context.close();
  }
} finally {
  await browser.close();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
