// Browser check for News → Scores as its own section (Luke, 2026-11-20), against the
// local dev server (npm run dev:local) with a seeded feed and scoreboard:
//   - no margin inside News's border (the section header reaches the border)
//   - Scores sits one swipe right of the Front page; Sports is among the sections
//     in its usual place (after Culture); Sports has no Scores/Stories tabs
//   - a tab row (★ then each league shown); a tab shows only its games; a swipe
//     sideways on the games moves one tab
//   - the day strip is three days wide (yesterday, today, tomorrow) and scrolls
//   - the table and ★ buttons are squares the size of the ☰ button
//   - an open game: no Follow buttons, no schedule/table links, "Game page" with no
//     arrow, Watch buttons for a game later today; Xfinity carries the phone's
//     App Store fallback
//   - a team's name opens its schedule; ☰ turns into ‹ and back again; the team
//     card's star follows/unfollows; the card stays pinned while the season scrolls
//   - ★ opens the My teams window; the gear menu has Scores (teams and leagues)
//   - no sideways scroll, no console errors
// Usage: node scripts/qa-news-scores.mjs [url] [screenshotDir]
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
const STORIES = Array.from({ length: 20 }, (_, i) => ({
  id: `s${i}`, url: `https://www.nytimes.com/2026/11/20/x/story-${i}.html`,
  title: `A headline for story number ${i}`, paper: "nyt", section: SECS[i % SECS.length], publishedAt: ago(i * 0.7 + 0.2)
}));

async function swipeAt(page, cdp, selector, dx) {
  const box = await page.$eval(selector, (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 60) }; });
  const pts = (x) => [{ x, y: box.y, id: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(box.x) });
  for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(box.x + (dx * i) / 6) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(350);
}
const title = (page) => page.$eval("[data-news-section-btn]", (b) => b.textContent.trim());
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function run(browser, { width, height }) {
  console.log(`▸ ${width}px`);
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true });
  const page = await ctx.newPage();
  await page.route("https://logos.test/**", (r) => r.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#4f2683"/></svg>` }));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon/i.test(m.text())) errors.push(m.text()); });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#lockDevSignInBtn:not([hidden])", { timeout: 20000 });
  await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), null, { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => { localStorage.removeItem("live-scores-tab-v1"); window.open = () => null; });
  await page.evaluate(() => document.getElementById("homeNewsBtn")?.click());
  await page.waitForSelector("#newsMainPage:not([hidden])", { timeout: 10000 });
  await page.evaluate((list) => window.__liveQA.newsSetFeed(list, { nyt: { status: "signed-in" } }, {}), STORIES);
  await page.waitForTimeout(300);
  const cdp = await ctx.newCDPSession(page);

  // ── Shell ──
  const edge = await page.evaluate(() => {
    const p = document.getElementById("newsMainPage").getBoundingClientRect();
    const b = document.querySelector(".news-section-bar").getBoundingClientRect();
    return { left: b.left - p.left, right: p.right - b.right };
  });
  check(edge.left <= 3 && edge.right <= 3, `section header reaches the border (${edge.left.toFixed(1)} / ${edge.right.toFixed(1)} px)`);
  const order = await page.evaluate(() => { document.querySelector("[data-news-section-btn]").click(); return [...document.querySelectorAll(".news-section-item")].map((b) => b.textContent.trim()); });
  await page.keyboard.press("Escape");
  const iScores = order.indexOf("Scores"), iFront = order.indexOf("Front page"), iSports = order.indexOf("Sports"), iCulture = order.indexOf("Culture");
  check(iScores >= 0 && iFront === iScores + 1, `Scores just before Front page in the menu (${order.slice(0, 4).join(", ")}…)`);
  check(iSports === iCulture + 1, `Sports in its usual place, after Culture (${iSports})`);
  await swipeAt(page, cdp, "[data-news-section-bar]", -120);
  check((await title(page)) === "World", `swipe left from the Front page → World (${await title(page)})`);
  await swipeAt(page, cdp, "[data-news-section-bar]", 120);
  await page.waitForTimeout(700); // a swipe isn't also a tap on the title
  await page.click("[data-news-section-btn]");
  await page.click('.news-section-item[data-news-pick="section"][data-news-key="sports"]');
  await page.waitForTimeout(300);
  check((await title(page)) === "Sports" && !(await page.$(".news-tabs")), "Sports shows stories with no Scores/Stories tabs");
  await page.click("[data-news-section-btn]");
  await page.click('.news-section-item[data-news-pick="front"]');
  await page.waitForTimeout(300);

  // ── Scores ──
  const today = await page.evaluate(() => {
    const qa = window.__liveQA;
    const pad = (n) => String(n).padStart(2, "0");
    const d = new Date();
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const t = (name, abbr, id) => ({ name, short: name.split(" ").pop(), abbr, refs: { espn: id }, logo: `https://logos.test/${abbr}.svg` });
    const vik = t("Minnesota Vikings", "MIN", "16"), gb = t("Green Bay Packers", "GB", "9"), chi = t("Chicago Bears", "CHI", "3"), det = t("Detroit Lions", "DET", "8");
    const wild = t("Minnesota Wild", "MIN", "30"), stl = t("St. Louis Blues", "STL", "19");
    qa.sportsSetPrefs({ teams: [{ ...vik, scope: "nfl", league: "nfl" }, { ...wild, scope: "nhl", league: "nhl" }] });
    qa.mediaServicesForQa(["xfinity"]);
    const start = new Date(Date.now() - 3600e3).toISOString();
    const later = new Date(Date.now() + 3 * 3600e3).toISOString();
    const season = Array.from({ length: 17 }, (_, i) => ({ id: `w${i}`, league: "nfl", start: new Date(Date.now() + (i - 10) * 7 * 86400e3).toISOString(), state: i < 10 ? "final" : "pre", detail: i < 10 ? "Final" : "", broadcasts: ["FOX"], away: { team: i % 2 ? gb : chi, score: i < 10 ? 10 + i : null }, home: { team: vik, score: i < 10 ? 20 : null } }));
    qa.scoresSetBoard({ date: key, days: { [key]: [
      { id: "live-vik", league: "nfl", start, state: "live", detail: "3rd 5:21", broadcasts: ["FOX"], away: { team: gb, score: 7 }, home: { team: vik, score: 10 }, link: "https://www.espn.com/nfl/game/_/gameId/1" },
      { id: "fin-chi", league: "nfl", start, state: "final", detail: "Final", broadcasts: ["CBS"], away: { team: chi, score: 3 }, home: { team: det, score: 20 } },
      { id: "wild", league: "nhl", start: later, state: "pre", detail: "", broadcasts: ["FanDuel SN North"], away: { team: stl, score: null }, home: { team: wild, score: null } },
    ] }, seasons: { "nfl|espn:16": season } });
    qa.showScoresForQa();
    return key;
  });
  await page.waitForSelector(".scores-tabs", { timeout: 10000 });
  check((await title(page)) === "Scores", `the section is called Scores (${await title(page)})`);
  await swipeAt(page, cdp, "[data-news-section-bar]", -120);
  check((await title(page)) === "Front page", "swipe left from Scores → Front page");
  await swipeAt(page, cdp, "[data-news-section-bar]", 120);
  check((await title(page)) === "Scores", "swipe right from the Front page → Scores");

  const tabs = await page.$$eval(".scores-tab", (els) => els.map((e) => ({ key: e.dataset.scoresLtab, on: e.classList.contains("is-active") })));
  check(tabs[0]?.key === "mine" && tabs[0].on, `★ is the first tab and opens first (${tabs.map((t) => t.key).join(" ")})`);
  const mineGames = await page.$$eval(".scores-game", (els) => els.length);
  check(mineGames === 2, `★ shows my teams' games today (${mineGames})`);
  check(!(await page.$(".scores-idles")), "★ has no idle-team rows (they're in the My teams window)");
  if (OUT) await page.screenshot({ path: `${OUT}/scores-mine-${width}.png` });

  await page.click('.scores-tab[data-scores-ltab="nfl"]');
  await page.waitForTimeout(200);
  const nfl = await page.$$eval(".scores-game", (els) => els.length);
  check(nfl === 2, `NFL tab shows the NFL games only (${nfl})`);
  await swipeAt(page, cdp, "[data-scores-body]", -140);
  const after = await page.$eval(".scores-tab.is-active", (e) => e.dataset.scoresLtab);
  check(after === tabs[2]?.key, `a swipe left on the games → the next tab (${after})`);
  await swipeAt(page, cdp, "[data-scores-body]", 140);
  await swipeAt(page, cdp, "[data-scores-body]", 140);
  check(await page.$eval(".scores-tab.is-active", (e) => e.dataset.scoresLtab) === "mine", "two swipes right → back to ★");

  const strip = await page.evaluate(() => {
    const s = document.querySelector(".scores-days").getBoundingClientRect();
    const full = [...document.querySelectorAll(".scores-day")].filter((d) => { const r = d.getBoundingClientRect(); return r.left >= s.left - 1 && r.right <= s.right + 1; });
    return { visible: full.map((d) => d.querySelector(".scores-day-dow").textContent), scrolls: document.querySelector(".scores-days").scrollWidth > s.width + 10 };
  });
  check(strip.visible.length === 3 && strip.visible[1] === "Today", `three days in view, today in the middle (${strip.visible.join(" · ")})`);
  check(strip.scrolls, "the strip scrolls to other days");

  const sizes = await page.evaluate(() => [...document.querySelectorAll("#newsSidebarToggle, .scores-sq")].map((b) => { const r = b.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; }));
  check(new Set(sizes).size === 1 && sizes.length === 3, `table and ★ are the ☰ button's squares (${sizes.join(", ")})`);

  // ── An open game ──
  await page.click('[data-scores-game="mine|live-vik"]');
  await page.waitForTimeout(250);
  const open = await page.$eval(".scores-game.is-open", (el) => ({
    follow: el.querySelectorAll("[data-scores-follow]").length,
    links: [...el.querySelectorAll(".scores-textlink")].map((b) => b.textContent),
    gamePage: el.querySelector(".scores-link")?.textContent || "",
    watch: [...el.querySelectorAll(".game-watch-btn")].map((b) => ({ t: b.textContent.trim(), phone: b.dataset.outPhoneWeb || "" })),
  }));
  check(open.follow === 0 && open.links.length === 0, "no Follow buttons, schedule or table links in an open game");
  check(open.gamePage === "Game page", `"Game page" has no arrow (${JSON.stringify(open.gamePage)})`);
  check(open.watch.length >= 2 && /Xfinity/.test(open.watch[0].t) && /apps\.apple\.com/.test(open.watch[0].phone), `Watch: ${open.watch.map((w) => w.t).join(" | ")}; Xfinity's phone fallback is the App Store`);
  if (OUT) await page.screenshot({ path: `${OUT}/scores-game-${width}.png` });
  await page.click('[data-scores-game="mine|wild"]');
  await page.waitForTimeout(250);
  const later = await page.$$eval(".scores-game.is-open .game-watch-btn", (els) => els.map((e) => e.textContent.trim()));
  check(later.length >= 1, `a game three hours out still offers where to watch (${later.join(" | ")})`);

  // ── A team's schedule ──
  check(!(await page.$eval("#newsSidebarToggle", (b) => b.classList.contains("is-back"))), "☰ before any page is opened");
  await page.click('.scores-game.is-open .scores-side:nth-child(2) .scores-name.is-link');
  await page.waitForSelector(".scores-teamhead", { timeout: 5000 });
  check(await page.$eval(".scores-teamhead h3", (h) => h.textContent) === "Minnesota Wild", "a team's name opens its schedule");
  check(await page.$eval("#newsSidebarToggle", (b) => b.classList.contains("is-back") && b.getAttribute("aria-label") === "Back"), "☰ turns into ‹ Back");
  check(!(await page.$(".scores-back, .scores-follow")), "no ‹ Back or Follow button inside the page");
  await page.click("#newsSidebarToggle");
  await page.waitForTimeout(250);
  check(!!(await page.$(".scores-tabs")) && !(await page.$eval("#newsSidebarToggle", (b) => b.classList.contains("is-back"))), "‹ goes back to the day and ☰ returns");
  check(!(await page.$("#newsSidebar.is-expanded")), "going back doesn't open the Saved list");

  await page.click('.scores-tab[data-scores-ltab="nfl"]');
  await page.click('[data-scores-game="nfl|live-vik"]');
  await page.waitForTimeout(200);
  await page.click('.scores-game.is-open .scores-side:nth-child(2) .scores-name.is-link');
  await page.waitForSelector(".scores-srow", { timeout: 5000 });
  const star = () => page.$eval(".scores-teamhead-star", (b) => b.getAttribute("aria-pressed"));
  check(await star() === "true", "the Vikings' card star is filled (followed)");
  await page.click(".scores-teamhead-star");
  await page.waitForTimeout(200);
  check(await star() === "false", "tapping the star unfollows");
  await page.click(".scores-teamhead-star");
  await page.waitForTimeout(200);
  check(await star() === "true", "tapping again follows");
  const pinned = await page.evaluate(async () => {
    const sc = document.querySelector("#newsContent .news-scroll");
    sc.scrollTop = sc.scrollHeight;
    await new Promise((r) => setTimeout(r, 120));
    const head = document.querySelector(".scores-teamhead").getBoundingClientRect(), box = sc.getBoundingClientRect();
    return { scrolled: sc.scrollTop > 100, top: Math.round(head.top - box.top) };
  });
  check(pinned.scrolled && pinned.top >= -1 && pinned.top <= 16, `the team card stays pinned while the season scrolls (top ${pinned.top}px)`);
  if (OUT) await page.screenshot({ path: `${OUT}/scores-team-${width}.png` });
  check(await noSideScroll(page), "no sideways scroll (team page)");
  await page.click("#newsSidebarToggle");
  await page.waitForTimeout(250);

  // ── My teams window ──
  await page.click("[data-scores-mine]");
  await page.waitForSelector("#scoresMineDialog[open]", { timeout: 5000 });
  const rows = await page.$$eval("#scoresMineDialog .scores-mine-list > *", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  const vRow = rows.find((r) => /Vikings/.test(r)) || "", wRow = rows.find((r) => /Wild/.test(r)) || "";
  check(rows.length === 2 && /vs Packers · 10–7 · 3rd/.test(vRow) && /vs Blues/.test(wRow), `My teams: ${rows.join(" | ")}`);
  if (OUT) await page.screenshot({ path: `${OUT}/scores-myteams-${width}.png` });
  await page.click('#scoresMineDialog [data-scores-mine-game="live-vik"]');
  await page.waitForTimeout(300);
  check(!(await page.$("#scoresMineDialog[open]")) && !!(await page.$('.scores-game.is-open [data-scores-game="mine|live-vik"], [data-scores-game="mine|live-vik"][aria-expanded="true"]')), "a game in My teams opens on today's board");

  // ── Gear menu › Scores ──
  await page.evaluate(() => document.getElementById("appMenuBtn")?.click() || document.querySelector("#settingsBtn, .settings-btn, [aria-controls='appMenu']")?.click());
  await page.waitForTimeout(200);
  const menuOk = await page.evaluate(() => { const b = document.getElementById("menuScoresBtn"); return !!b && !b.hidden; });
  check(menuOk, "News's gear menu has Scores");
  await page.evaluate(() => document.getElementById("menuScoresBtn").click());
  await page.waitForSelector("#scoresSettingsDialog[open]", { timeout: 5000 }).catch(() => null);
  check(!!(await page.$("#scoresSettingsDialog[open]")), "Scores opens My teams / Leagues");
  await page.evaluate(() => document.getElementById("scoresSettingsDialog")?.close());

  await page.click("#newsSidebarToggle");
  await page.waitForTimeout(200);
  check(!!(await page.$("#newsSidebar.is-expanded")), "☰ still opens the Saved list");
  await page.click("#newsSidebarToggle");
  check(await noSideScroll(page), "no sideways scroll (Scores)");
  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await ctx.close();
  return today;
}

const browser = await launch();
try {
  await run(browser, { width: 390, height: 844 });
  await run(browser, { width: 360, height: 740 });
} finally { await browser.close(); }
console.log(failures ? `\n✗ ${failures} check(s) failed` : "\n✔ all checks passed");
process.exit(failures ? 1 : 0);
