// Browser check for the blended Front page (Luke, 2026-11-20; NEWS_FRONT_PAGE_DESIGN.md
// §12), against the local dev server (npm run dev:local) with a seeded blended feed:
//   - "Top stories" then "For you", in the server's order; a lifted story says For you
//   - a For you card's reason shows in its meta line
//   - For you is no longer a section; "What News has learned" is at the foot of the
//     section menu and its back arrow returns to the Front page
//   - stories left on screen unopened are reported as seen when leaving the Front page
//   - no sideways scroll, no console errors
// Usage: node scripts/qa-news-blend.mjs [url] [screenshotDir]
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
const OUT = process.argv[3] || "";
if (OUT && !existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const LAUNCH_ARGS = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
async function launch() {
  try { return await chromium.launch({ ...LAUNCH_ARGS, channel: "chrome" }); } catch { /* not installed */ }
  try { return await chromium.launch(LAUNCH_ARGS); } catch { /* not installed */ }
  const sandbox = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  return chromium.launch({ ...LAUNCH_ARGS, executablePath: sandbox });
}
let failures = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "✓" : "✗"} ${msg}`); if (!ok) failures++; };
const ago = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const lead = (i) => new Date(Date.now() - i * 1000).toISOString();
const FEED = [
  { id: "t1", top: true, lead: lead(0), url: "https://www.nytimes.com/live/2026/11/20/us/ground-stop", title: "Live: Ground stop halts flights nationwide", paper: "nyt", section: "us", publishedAt: ago(1) },
  { id: "t2", top: true, lead: lead(1), url: "https://www.startribune.com/msp-ground-stop/601", title: "MSP departures halted as FAA grounds flights", paper: "startribune", section: "mn", publishedAt: ago(1.2) },
  { id: "t3", top: true, lead: lead(2), url: "https://www.nytimes.com/2026/11/20/world/summit.html", title: "Leaders meet in Beijing with arms control on the agenda", paper: "nyt", section: "world", publishedAt: ago(3) },
  { id: "t4", top: true, forYou: true, why: "Vikings", lead: lead(3), url: "https://www.startribune.com/vikings/602", title: "Vikings activate Jefferson ahead of Sunday", paper: "startribune", section: "sports", publishedAt: ago(2) },
  ...Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, url: `https://www.nytimes.com/2026/11/20/x/r${i}.html`, title: `River story ${i} with a headline of ordinary length`, paper: i % 2 ? "nyt" : "economist", section: ["business", "mn", "science", "politics"][i % 4], publishedAt: ago(i + 1), ...(i === 0 ? { why: "AI" } : {}) }))
];

async function run(browser, { width, height }) {
  console.log(`▸ ${width}px`);
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 700 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon/i.test(m.text())) errors.push(m.text()); });
  await page.route(/\.(jpg|png)$/, (r) => r.abort());
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#lockDevSignInBtn:not([hidden])", { timeout: 20000 });
  await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), null, { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById("homeNewsBtn")?.click());
  await page.waitForSelector("#newsMainPage:not([hidden])", { timeout: 10000 });
  await page.evaluate((list) => window.__liveQA.newsSetFeed(list, { nyt: { status: "signed-in" } }, { forYou: true, blend: true, learned: { likes: [{ feature: "t:ai", label: "AI", kind: "t" }], dislikes: [], muted: [], teams: [] } }), FEED);
  await page.waitForTimeout(300);

  const heads = await page.$$eval("#newsContent .news-group-head", (els) => els.map((e) => e.textContent.trim()));
  check(heads.join("|") === "Top stories|For you", `groups (${heads.join("|")})`);
  const ids = await page.$$eval("#newsContent [data-news-id]", (els) => els.map((e) => e.dataset.newsId));
  check(ids.slice(0, 5).join() === "t1,t2,t3,t4,r0", `server order kept (${ids.slice(0, 5).join()})`);
  const kicker = await page.textContent(".news-kicker");
  check(/^Top story · U\.S\./.test(kicker.trim()), `lead kicker (${kicker.trim()})`);
  const lifted = await page.$eval('[data-news-id="t4"] .news-card-sec', (e) => e.textContent.trim());
  check(/^For you · Sports/.test(lifted), `lifted story says For you (${lifted})`);
  const why = await page.$eval('[data-news-id="r0"] .news-card-meta', (e) => e.textContent.trim());
  check(why.startsWith("AI ·"), `reason in the meta line (${why})`);
  if (OUT) await page.screenshot({ path: `${OUT}/blend-${width}.png` });

  await page.click("[data-news-section-btn]");
  const items = await page.$$eval(".news-section-menu [data-news-pick]", (els) => els.map((e) => e.dataset.newsPick));
  check(!items.includes("foryou"), "For you is no longer a section");
  check(items[0] === "front" && items.at(-1) === "learned", `What News has learned at the foot (${items[0]} … ${items.at(-1)})`);
  if (OUT) { await page.waitForTimeout(250); await page.screenshot({ path: `${OUT}/blend-menu-${width}.png` }); }
  await page.keyboard.press("Escape");

  // Leave stories on screen > 1.5 s, open one, then leave the Front page.
  await page.waitForTimeout(1800);
  await page.click('[data-news-id="t2"] [data-news-dots]');
  await page.click('.news-menu [data-news-act="send"]');
  await page.click("[data-news-section-btn]");
  await page.click('.news-section-menu [data-news-pick="learned"]');
  await page.waitForTimeout(250);
  check((await page.textContent(".news-title")).trim() === "What News has learned", "menu opens What News has learned");
  const sent = await page.evaluate(() => window.__liveQA.newsDecisions());
  const skips = sent.filter((d) => d.decision === "skip").map((d) => d.id);
  check(skips.includes("t1") && !skips.includes("t2"), `seen stories reported on leaving the Front page, not the saved one (${skips.join(",")})`);
  await page.click("[data-news-back]");
  await page.waitForTimeout(250);
  check((await page.textContent("[data-news-section-btn]")).trim() === "Front page", "back arrow returns to the Front page");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `no sideways scroll (${overflow}px)`);
  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await ctx.close();
}

const browser = await launch();
try {
  await run(browser, { width: 390, height: 844 });
  await run(browser, { width: 1280, height: 860 });
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
