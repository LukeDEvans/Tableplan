// Browser check for News → For you (NEWS_RANKING_DESIGN.md), against the local dev
// server (npm run dev:local) with the feed seeded in For you's order:
//   - the For you tab sits above Front page and opens the ranked list in seed order
//     (an Athletic story included), with each card's reason in its meta line
//   - the ⋯ menu has More like this / Less like this / Mute topic
//   - Less like this and Mute topic take the story out of For you
//   - without For you on the server, none of it shows
//   - no sideways scroll at 390 and 360 px, the menu fits, no console errors
// Usage: node scripts/qa-news-for-you.mjs [url] [screenshotDir]
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
const STORIES = [
  { id: "s1", url: "https://www.nytimes.com/2026/10/28/technology/ai-model.html", title: "OpenAI ships a model that plans its own experiments", paper: "nyt", section: "business", publishedAt: ago(2), why: "AI" },
  { id: "s2", url: "https://www.nytimes.com/athletic/7731000/2026/10/28/jefferson/", title: "Justin Jefferson questionable for Sunday against the Packers", paper: "athletic", section: "sports", publishedAt: ago(5), why: "Vikings" },
  { id: "s3", url: "https://www.startribune.com/legislature-session/601000001", title: "Lawmakers sketch a special session on transit funding", paper: "startribune", section: "mn", publishedAt: ago(1), why: "Minnesota" },
  { id: "s4", url: "https://www.economist.com/finance-and-economics/2026/10/28/rates", title: "Why central banks are in no hurry to cut", paper: "economist", section: "business", publishedAt: ago(9), why: "Markets" },
  { id: "s5", url: "https://www.nytimes.com/2026/10/28/arts/museum.html", title: "A museum reopens after a decade of repairs", paper: "nyt", section: "culture", publishedAt: ago(3), why: "Something different" }
];

async function run(browser, { width, height, forYou }) {
  console.log(`▸ ${width}px${forYou ? "" : " (server without For you)"}`);
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 600 });
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
  await page.evaluate(([list, fy]) => window.__liveQA.newsSetFeed(list, { nyt: { status: "signed-in" } }, { forYou: fy }), [STORIES, forYou]);
  await page.waitForTimeout(300);

  const tab = await page.$('[data-news-view="foryou"]');
  if (!forYou) {
    check(!tab, "no For you tab");
    await page.click("[data-news-dots]");
    const items = await page.$$eval(".news-menu [data-news-act]", (els) => els.map((e) => e.dataset.newsAct));
    check(!items.includes("more") && !items.includes("mute"), `⋯ menu has no feedback items (${items.join(", ")})`);
    check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
    await ctx.close();
    return;
  }
  check(!!tab, "For you tab shown");
  const order = await page.$$eval("#newsSidebar [data-news-view]", (els) => els.slice(0, 2).map((e) => e.dataset.newsView));
  check(order.join() === "foryou,front", `For you sits above Front page (${order.join()})`);
  if (width < 700) await page.evaluate(() => document.getElementById("newsSidebar")?.classList.add("is-expanded"));
  await page.click('[data-news-view="foryou"]');
  await page.waitForTimeout(200);
  const title = await page.textContent(".news-title");
  check(title.trim() === "For you", `title is "For you" (${title.trim()})`);
  const ids = await page.$$eval("#newsContent [data-news-id]", (els) => els.map((e) => e.dataset.newsId));
  check(ids.join() === "s1,s2,s3,s4,s5", `seed order kept, Athletic included (${ids.join()})`);
  const kicker = await page.textContent(".news-kicker");
  check(/^Top for you/.test(kicker.trim()), `lead kicker (${kicker.trim()})`);
  const meta = await page.$$eval("#newsContent .news-card-meta", (els) => els.map((e) => e.textContent.trim()));
  check(meta[0].startsWith("Vikings ·"), `reason leads the meta line (${meta[0]})`);
  if (OUT) await page.screenshot({ path: `${OUT}/foryou-${width}.png`, fullPage: false });

  // ⋯ menu
  await page.click('[data-news-id="s3"] [data-news-dots]');
  const items = await page.$$eval(".news-menu [data-news-act]", (els) => els.map((e) => e.dataset.newsAct));
  check(["more", "less", "mute"].every((a) => items.includes(a)), `⋯ menu has More / Less / Mute (${items.join(", ")})`);
  const box = await page.$eval(".news-menu", (m) => { const r = m.getBoundingClientRect(); return { left: r.left, right: r.right, vw: innerWidth }; });
  check(box.left >= 0 && box.right <= box.vw, `menu fits on screen (${Math.round(box.left)}–${Math.round(box.right)} of ${box.vw})`);
  if (OUT) await page.screenshot({ path: `${OUT}/foryou-menu-${width}.png`, fullPage: false });
  await page.click('.news-menu [data-news-act="less"]');
  await page.waitForTimeout(200);
  let left = await page.$$eval("#newsContent [data-news-id]", (els) => els.map((e) => e.dataset.newsId));
  check(!left.includes("s3"), `Less like this removes the story (${left.join()})`);
  await page.click('[data-news-id="s4"] [data-news-dots]');
  await page.click('.news-menu [data-news-act="mute"]');
  await page.waitForTimeout(200);
  left = await page.$$eval("#newsContent [data-news-id]", (els) => els.map((e) => e.dataset.newsId));
  check(!left.includes("s4"), `Mute topic removes the story (${left.join()})`);
  await page.click('[data-news-id="s1"] [data-news-dots]');
  await page.click('.news-menu [data-news-act="more"]');
  await page.waitForTimeout(200);
  left = await page.$$eval("#newsContent [data-news-id]", (els) => els.map((e) => e.dataset.newsId));
  check(left.includes("s1"), "More like this keeps the story");

  // Front page still has no Athletic stories and keeps newest-first.
  if (width < 700) await page.evaluate(() => document.getElementById("newsSidebar")?.classList.add("is-expanded"));
  await page.click('[data-news-view="front"]');
  await page.waitForTimeout(200);
  const front = await page.$$eval("#newsContent [data-news-id]", (els) => els.map((e) => e.dataset.newsId));
  check(!front.includes("s2") && front[0] === "s3", `Front page unchanged: newest first, no Athletic (${front.join()})`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `no sideways scroll (${overflow}px)`);
  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await ctx.close();
}

const browser = await launch();
try {
  await run(browser, { width: 390, height: 844, forYou: true });
  await run(browser, { width: 360, height: 760, forYou: true });
  await run(browser, { width: 1280, height: 860, forYou: true });
  await run(browser, { width: 390, height: 844, forYou: false });
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
