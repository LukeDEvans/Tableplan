// Browser check for the News section header and Saved sidebar (Luke, 2026-11-20),
// against the local dev server (npm run dev:local) with a seeded feed:
//   - opens on the Front page; the title is centered on the window; no
//     "N stories · N unread" line
//   - a touch swipe left on the header goes to Sports, right comes back; a swipe
//     right from the Front page goes to For you; a sideways trackpad swipe steps too
//   - a tap on the title opens the section menu (current one marked, papers at the
//     foot); picking a section opens it; Escape / a tap outside closes the menu
//   - the header stays pinned while the stories scroll
//   - the menu button opens the Saved list over the page; a tap beside it closes it
//   - no sideways scroll, no console errors
// Usage: node scripts/qa-news-header.mjs [url] [screenshotDir]
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
const SECS = ["us", "world", "politics", "mn", "business", "sports", "culture"];
const STORIES = Array.from({ length: 30 }, (_, i) => ({
  id: `s${i}`, url: `https://www.nytimes.com/2026/11/20/x/story-${i}.html`,
  title: `A reasonably long headline for story number ${i} about the news`,
  paper: i % 3 ? "nyt" : "startribune", section: SECS[i % SECS.length], publishedAt: ago(i * 0.7 + 0.2)
}));

async function swipe(page, cdp, dx) {
  const box = await page.$eval("[data-news-section-bar]", (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const pts = (x) => [{ x, y: box.y, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(box.x) });
  for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(box.x + (dx * i) / 6) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(350);
}
const title = (page) => page.$eval("[data-news-section-btn]", (b) => b.textContent.trim());

async function run(browser, { width, height }) {
  const touch = width < 700;
  console.log(`▸ ${width}px`);
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon/i.test(m.text())) errors.push(m.text()); });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#lockDevSignInBtn:not([hidden])", { timeout: 20000 });
  await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), null, { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById("homeNewsBtn")?.click());
  await page.waitForSelector("#newsMainPage:not([hidden])", { timeout: 10000 });
  await page.evaluate((list) => window.__liveQA.newsSetFeed(list, { nyt: { status: "signed-in" }, economist: { status: "signed-in" }, startribune: { status: "signed-in" } }, { forYou: true }), STORIES);
  await page.waitForTimeout(300);

  check((await title(page)) === "Front page", `opens on the Front page (${await title(page)})`);
  const c = await page.$eval("[data-news-section-btn]", (b) => { const r = b.getBoundingClientRect(); return { mid: r.left + r.width / 2, vw: innerWidth }; });
  check(Math.abs(c.mid - c.vw / 2) <= 3, `title centered on the window (${Math.round(c.mid)} of ${c.vw})`);
  const subs = await page.$$eval("#newsContent .news-head-sub", (els) => els.map((e) => e.textContent));
  check(!subs.some((t) => /unread/.test(t)), "no stories · unread line");
  if (OUT) await page.screenshot({ path: `${OUT}/header-front-${width}.png` });

  if (touch) {
    const cdp = await ctx.newCDPSession(page);
    await swipe(page, cdp, -120);
    check((await title(page)) === "Sports", `swipe left → Sports (${await title(page)})`);
    if (OUT) await page.screenshot({ path: `${OUT}/header-sports-${width}.png` });
    await swipe(page, cdp, 120);
    check((await title(page)) === "Front page", `swipe right → back to Front page (${await title(page)})`);
    await swipe(page, cdp, 120);
    check((await title(page)) === "For you", `swipe right from Front page → For you (${await title(page)})`);
    await swipe(page, cdp, 120);
    check((await title(page)) === "For you", "no step past the first section");
    check(!(await page.$(".news-section-menu")), "a swipe doesn't open the menu");
    await swipe(page, cdp, -120);
    await swipe(page, cdp, -20);
    check((await title(page)) === "Front page", "a short drag doesn't step");
  } else {
    await page.mouse.move(c.mid, (await page.$eval("[data-news-section-bar]", (el) => el.getBoundingClientRect().top + 20)));
    for (let i = 0; i < 6; i++) await page.mouse.wheel(30, 0);
    await page.waitForTimeout(350);
    check((await title(page)) === "Sports", `trackpad swipe → Sports (${await title(page)})`);
    await page.waitForTimeout(700);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(-30, 0);
    await page.waitForTimeout(350);
    check((await title(page)) === "Front page", `trackpad swipe back → Front page (${await title(page)})`);
    await page.focus("[data-news-section-btn]");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
    check((await title(page)) === "Sports", "→ key steps to Sports");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(200);
  }

  // Menu
  await page.click("[data-news-section-btn]");
  const items = await page.$$eval(".news-section-menu [data-news-pick]", (els) => els.map((e) => `${e.dataset.newsPick}${e.dataset.newsKey ? ":" + e.dataset.newsKey : ""}`));
  check(items.slice(0, 3).join() === "foryou,front,section:sports", `menu order (${items.slice(0, 3).join()})`);
  check(items.some((i) => i.startsWith("paper:")), "papers at the foot of the menu");
  const cur = await page.$eval(".news-section-item.is-current", (e) => e.textContent.trim());
  check(cur === "Front page", `current section marked (${cur})`);
  const mb = await page.$eval(".news-section-menu", (m) => { const r = m.getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight }; });
  const areaB = await page.$eval("#newsContent", (el) => el.getBoundingClientRect().bottom);
  check(mb.l >= 0 && mb.r <= mb.vw && mb.b <= areaB, `menu fits on screen (${Math.round(mb.l)}–${Math.round(mb.r)}, bottom ${Math.round(mb.b)})`);
  await page.waitForTimeout(250);
  if (OUT) await page.screenshot({ path: `${OUT}/header-menu-${width}.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  check(!(await page.$(".news-section-menu")), "Escape closes the menu");
  await page.click("[data-news-section-btn]");
  await page.click('.news-section-menu [data-news-pick="section"][data-news-key="mn"]');
  await page.waitForTimeout(250);
  check((await title(page)) === "Minnesota", `menu pick opens the section (${await title(page)})`);
  await page.click("[data-news-section-btn]");
  await page.click('.news-section-menu [data-news-pick="front"]');
  await page.waitForTimeout(250);

  // Pinned while scrolling
  const top0 = await page.$eval("[data-news-section-bar]", (el) => el.getBoundingClientRect().top);
  await page.$eval("#newsContent .news-scroll", (s) => s.scrollTo({ top: 1200 }));
  await page.waitForTimeout(200);
  const scrolled = await page.$eval("#newsContent .news-scroll", (s) => s.scrollTop);
  const top1 = await page.$eval("[data-news-section-bar]", (el) => el.getBoundingClientRect().top);
  check(scrolled > 300 && Math.abs(top1 - top0) < 1, `header stays put while stories scroll (scrolled ${scrolled}px, header ${Math.round(top0)}→${Math.round(top1)})`);
  if (OUT) await page.screenshot({ path: `${OUT}/header-scrolled-${width}.png` });

  // Saved sidebar
  check(!(await page.$eval("#newsSidebar", (el) => el.getBoundingClientRect().width > 4)), "Saved list closed by default");
  await page.click("#newsSidebarToggle");
  await page.waitForTimeout(350);
  const sb = await page.$eval("#newsSidebar", (el) => ({ w: el.getBoundingClientRect().width, title: el.querySelector(".news-side-title")?.textContent.trim(), panel: !!el.querySelector("#articleListPanel"), tabs: el.querySelectorAll("[data-news-view]").length }));
  check(sb.w > 200 && sb.title === "Saved" && sb.panel, `menu button opens the Saved list (${Math.round(sb.w)}px, "${sb.title}", list ${sb.panel})`);
  check(sb.tabs === 0, "no section or paper tabs left in the sidebar");
  if (OUT) await page.screenshot({ path: `${OUT}/sidebar-saved-${width}.png` });
  await page.mouse.click(width - 10, height / 2);
  await page.waitForTimeout(350);
  check(!(await page.$eval("#newsSidebar", (el) => el.classList.contains("is-expanded"))), "a tap beside it closes it");
  check((await title(page)) === "Front page", "…without opening a story");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `no sideways scroll (${overflow}px)`);
  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await ctx.close();
}

const browser = await launch();
try {
  await run(browser, { width: 390, height: 844 });
  await run(browser, { width: 360, height: 700 });
  await run(browser, { width: 1280, height: 860 });
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
