// Browser check for the dock's headlines-and-scores strip (news-ticker.js).
// Runs the real app against the local dev server (npm run dev:local) with the
// News feed and a few days of scores seeded, at phone and laptop widths:
//   - the strip shows above the dock's slides at a third of their height
//   - news first, then the followed teams' games for the days in view
//   - it steps through items; a long headline is marked to scroll
//   - tapping a game opens News → Sports → Scores on that day with it expanded
//   - tapping a headline opens the reader
//   - no sideways scroll, no console errors
// Usage: node scripts/qa-ticker.mjs [url] [screenshotDir]
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

async function run(browser, { width, height, dark }) {
  console.log(`▸ ${width}px${dark ? " (dark)" : ""}`);
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light", hasTouch: width < 600 });
  const page = await ctx.newPage();
  // Team logos: served locally so the check doesn't depend on a vendor's CDN.
  await page.route("https://logos.test/**", (route) => {
    const dark = route.request().url().includes("-dark");
    route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${dark ? "#ffd166" : "#4f2683"}"/></svg>` });
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon/i.test(m.text())) errors.push(m.text()); });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#lockDevSignInBtn:not([hidden])", { timeout: 20000 });
  await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), null, { timeout: 15000 });
  await page.waitForTimeout(800);

  const seeded = await page.evaluate(async () => {
    const qa = window.__liveQA;
    const pad = (n) => String(n).padStart(2, "0");
    const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const now = new Date();
    const day = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return d; };
    const t = (name, abbr) => ({ name, short: name.split(" ").pop(), abbr, refs: {}, logo: `https://logos.test/${abbr}.svg`, logoDark: `https://logos.test/${abbr}-dark.svg` });
    const vikings = t("Minnesota Vikings", "MIN"), packers = t("Green Bay Packers", "GB"), wild = t("Minnesota Wild", "MIN"), stars = t("Dallas Stars", "DAL");
    const ajax = t("Ajax", "AJX"), psv = t("PSV", "PSV"), bears = t("Chicago Bears", "CHI"), lions = t("Detroit Lions", "DET");
    qa.sportsSetPrefs({ teams: [{ ...vikings, scope: "nfl", league: "nfl" }, { ...wild, scope: "nhl", league: "nhl" }, { ...ajax, scope: "soccer", league: "eredivisie" }] });
    const iso = (d, h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x.toISOString(); };
    const g = (id, league, away, home, d, h, extra = {}) => ({ id, league, start: iso(d, h), state: "pre", away: { team: away, score: extra.as ?? null }, home: { team: home, score: extra.hs ?? null }, ...extra });
    const days = {
      [key(day(-1))]: [g("y-vik", "nfl", vikings, packers, day(-1), 12, { state: "final", as: 24, hs: 17, detail: "Final" })],
      [key(day(0))]: [
        g("t-live", "nfl", packers, vikings, day(0), 12, { state: "live", as: 7, hs: 10, detail: "3rd 5:21" }),
        g("t-ajax", "eredivisie", psv, ajax, day(0), 13, { state: "final", as: 1, hs: 3 }),
        g("t-other", "nfl", bears, lions, day(0), 12, { state: "live", as: 0, hs: 3 }),
      ],
      [key(day(1))]: [g("tm-wild", "nhl", stars, wild, day(1), 19)],
    };
    qa.scoresSetBoard({ date: key(day(0)), days });
    const lead = new Date(Date.now() - 3600e3).toISOString();
    qa.newsSetFeed([
      { id: "s1", url: "https://example.com/1", title: "Senate passes the budget after an all-night session that ran past dawn, ending a weeks-long standoff over spending", section: "politics", paper: "nyt", source: "NYT", publishedAt: lead, discoveredAt: lead, lead },
      { id: "s2", url: "https://example.com/2", title: "Twins name a new manager", section: "sports", paper: "startribune", source: "Star Tribune", publishedAt: lead, discoveredAt: lead, lead: new Date(Date.now() - 7200e3).toISOString() },
      { id: "s3", url: "https://example.com/3", title: "Not a lead", section: "world", paper: "nyt", source: "NYT", publishedAt: lead, discoveredAt: lead },
    ], {});
    const r = await qa.tickerRefresh();
    return { ...r, beforeNoon: now.getHours() < 12 };
  });
  const kinds = seeded.items.map((i) => i.kind);
  check(kinds[0] === "news" && kinds[1] === "news" && kinds.slice(2).every((k) => k === "game"), `news first, then games: ${seeded.items.map((i) => i.key).join(", ")}`);
  check(!seeded.items.some((i) => i.key === "n:s3"), "only lead stories");
  check(!seeded.items.some((i) => i.key === "g:t-other"), "only followed teams' games");
  const wantDay = seeded.beforeNoon ? "g:y-vik" : "g:tm-wild";
  const notDay = seeded.beforeNoon ? "g:tm-wild" : "g:y-vik";
  check(seeded.items.some((i) => i.key === wantDay) && !seeded.items.some((i) => i.key === notDay), `${seeded.beforeNoon ? "before noon: yesterday's result, not tomorrow's" : "after noon: tomorrow's game, not yesterday's"}`);
  check(seeded.items.find((i) => i.kind === "game").key === "g:t-live", "today's live game leads today's games");

  const geo = await page.evaluate(() => {
    const dock = document.getElementById("bottomDock").getBoundingClientRect();
    const tick = document.getElementById("dockTicker").getBoundingClientRect();
    const track = document.getElementById("dockTrack").getBoundingClientRect();
    const css = getComputedStyle(document.body);
    return { dock: dock.height, tick: tick.height, tickTop: tick.top, trackTop: track.top, miniH: parseFloat(css.getPropertyValue("--mini-player-h")), scrollW: document.documentElement.scrollWidth, vw: innerWidth };
  });
  check(Math.abs(geo.tick - geo.miniH / 3) < 1.5, `strip is a third of the dock (${geo.tick.toFixed(1)}px vs ${(geo.miniH / 3).toFixed(1)}px)`);
  check(geo.tickTop < geo.trackTop, "strip sits above the weather / player slides");
  check(geo.scrollW <= geo.vw, "no sideways scroll");
  if (OUT) await page.screenshot({ path: `${OUT}/ticker-${width}${dark ? "-dark" : ""}-news.png` });
  if (width < 600) check(await page.evaluate(() => document.querySelector("#dockTickerStage .dtk-item")?.classList.contains("is-long")), "a long headline is set to scroll through (phone width)");
  await page.waitForTimeout(2600);
  if (OUT) await page.screenshot({ path: `${OUT}/ticker-${width}${dark ? "-dark" : ""}-news-scrolled.png`, clip: { x: 0, y: geo.tickTop - 40, width, height: geo.dock + 40 } });

  // Step to the live game and tap it.
  let cur = seeded.current;
  for (let i = 0; i < 6 && cur !== "g:t-live"; i++) cur = await page.evaluate(() => window.__liveQA.tickerNext());
  await page.waitForTimeout(450);
  if (OUT) await page.screenshot({ path: `${OUT}/ticker-${width}${dark ? "-dark" : ""}-game.png`, clip: { x: 0, y: geo.tickTop - 40, width, height: geo.dock + 40 } });
  check(await page.evaluate(() => document.querySelectorAll("#dockTickerStage .dtk-item").length === 1), "one item on stage after the transition");
  // The local dev state may pin a mode; CSS only reads the resolved data-theme.
  await page.evaluate((d) => { document.body.dataset.theme = d ? "dark" : "light"; }, !!dark);
  await page.waitForTimeout(300);
  const look = await page.evaluate(() => {
    const item = document.querySelector("#dockTickerStage .dtk-item");
    const shown = [...item.querySelectorAll(".dtk-logo img")].filter((i) => getComputedStyle(i).display !== "none");
    const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
    return {
      logos: shown.length, loaded: shown.every((i) => i.complete && i.naturalWidth > 0), darkVariant: shown.every((i) => i.src.includes("-dark")),
      ink: lum(getComputedStyle(item.querySelector(".dtk-side.is-fav")).color),
      strip: getComputedStyle(document.getElementById("dockTicker")).backgroundColor, text: getComputedStyle(item.querySelector(".dtk-side.is-fav")).color,
    };
  });
  check(look.logos === 2 && look.loaded, "a logo beside each team");
  check(look.darkVariant === !!dark, `${dark ? "dark" : "light"}-background logos in ${dark ? "dark" : "light"} mode`);
  if (!dark) check(look.strip === "rgb(255, 255, 255)" && look.text === "rgb(43, 63, 99)", `light mode: white strip, dock-blue text (${look.strip} / ${look.text})`);
  else check(look.ink > 0.9, "dark mode: light text on the dock blue");
  await page.click('#dockTickerStage [data-dtk-key="g:t-live"]');
  await page.waitForTimeout(600);
  const opened = await page.evaluate(() => ({
    news: !document.getElementById("newsMainPage").hidden, // Scores is in News → Sports (back there 2026-10-20)
    expanded: document.querySelector('[data-scores-game="mine|t-live"]')?.getAttribute("aria-expanded"),
  }));
  check(opened.news && opened.expanded === "true", "tapping a game opens News → Sports → Scores with that game expanded");
  if (OUT) await page.screenshot({ path: `${OUT}/ticker-${width}${dark ? "-dark" : ""}-scores.png` });

  // Back home, step to a headline and tap it.
  await page.evaluate(() => { location.hash = ""; });
  for (let i = 0; i < 8 && cur !== "n:s2"; i++) cur = await page.evaluate(() => window.__liveQA.tickerNext());
  await page.waitForTimeout(450);
  await page.click('#dockTickerStage [data-dtk-key="n:s2"]');
  await page.waitForTimeout(800);
  const reader = await page.evaluate(() => { const r = document.getElementById("articleReaderPanel"); return !!r && !r.hidden && r.offsetParent !== null; });
  check(reader, "tapping a headline opens the reader");
  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await ctx.close();
}

const browser = await launch();
try {
  await run(browser, { width: 360, height: 780 });
  await run(browser, { width: 1280, height: 860, dark: true });
} finally {
  await browser.close();
}
console.log(failures ? `\n✗ ${failures} check(s) failed` : "\n✔ ticker checks passed");
process.exit(failures ? 1 : 0);
