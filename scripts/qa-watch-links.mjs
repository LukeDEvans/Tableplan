// Browser check for STREAMING_HANDOFF_DESIGN.md (Watch & Scores hand-offs).
// Runs the real app against the local dev server (npm run dev:local):
//   - a live game on FOX shows Watch buttons: Xfinity Stream first (live TV),
//     Fox One second; a final game shows none
//   - tapping a button on the web opens the website (no plugin here)
//   - the dock's game card shows the same buttons
//   - Settings › Admin › Beta › Link Test lists every service
//   - Watch › Streaming Services has the Sports apps group
//   - no sideways scroll at 360 / 390 px, no console errors
// Usage: node scripts/qa-watch-links.mjs [url] [screenshotDir]
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
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function run(browser, { width, height, dark }) {
  console.log(`▸ ${width}px${dark ? " (dark)" : ""}`);
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light", hasTouch: true });
  const page = await ctx.newPage();
  await page.route("https://logos.test/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#4f2683"/></svg>` }));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon/i.test(m.text())) errors.push(m.text()); });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#lockDevSignInBtn:not([hidden])", { timeout: 20000 });
  await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), null, { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });

  const today = await page.evaluate(() => {
    const qa = window.__liveQA;
    const pad = (n) => String(n).padStart(2, "0");
    const d = new Date();
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const t = (name, abbr) => ({ name, short: name.split(" ").pop(), abbr, refs: {}, logo: `https://logos.test/${abbr}.svg` });
    const vikings = t("Minnesota Vikings", "MIN"), packers = t("Green Bay Packers", "GB"), bears = t("Chicago Bears", "CHI"), lions = t("Detroit Lions", "DET");
    qa.sportsSetPrefs({ teams: [{ ...vikings, scope: "nfl", league: "nfl" }] });
    qa.mediaServicesForQa(["xfinity"]);
    const start = new Date(Date.now() - 3600e3).toISOString();
    qa.scoresSetBoard({ date: key, days: { [key]: [
      { id: "live-vik", league: "nfl", start, state: "live", detail: "3rd 5:21", broadcasts: ["FOX"], away: { team: packers, score: 7 }, home: { team: vikings, score: 10 } },
      { id: "fin-chi", league: "nfl", start, state: "final", detail: "Final", broadcasts: ["CBS"], away: { team: bears, score: 3 }, home: { team: lions, score: 20 } },
    ] } });
    qa.showScoresForQa();
    return key;
  });
  await page.waitForSelector('[data-scores-game$="live-vik"]', { timeout: 10000 });
  await page.click('[data-scores-game$="live-vik"]');
  await page.waitForTimeout(300);
  const btns = await page.$$eval(".scores-game.is-open .game-watch-btn", (els) => els.map((e) => e.textContent.trim()));
  check(btns.length === 2 && /Xfinity/.test(btns[0]) && /Fox One/.test(btns[1]), `live FOX game: ${btns.join(" | ")}`);
  check(await noSideScroll(page), "no sideways scroll (Scores)");
  if (OUT) await page.screenshot({ path: `${OUT}/scores-${width}${dark ? "-dark" : ""}.png` });
  await page.click(".scores-game.is-open .game-watch-btn >> nth=1");
  await page.waitForTimeout(200);
  const opened = await page.evaluate(() => window.__opened.slice());
  check(opened.length === 1 && opened[0] === "https://www.foxone.com/", `web opens the website: ${opened.join(", ")}`);
  check(await page.$('.scores-game.is-open') !== null, "tapping a Watch button doesn't collapse the game");

  await page.click('[data-scores-game$="fin-chi"]');
  await page.waitForTimeout(300);
  check((await page.$$(".scores-game.is-open .game-watch-btn")).length === 0, "final game: no Watch buttons");

  await page.evaluate((key) => window.__liveQA.tickerGameForQa(key, "live-vik"), today);
  await page.waitForSelector("#gameCardDialog .game-watch-btn", { timeout: 5000 }).catch(() => null);
  const card = await page.$$eval("#gameCardDialog .game-watch-btn", (els) => els.map((e) => e.textContent.trim()));
  check(card.length === 2, `game card has the buttons: ${card.join(" | ")}`);
  if (OUT) await page.screenshot({ path: `${OUT}/gamecard-${width}${dark ? "-dark" : ""}.png` });
  await page.evaluate(() => document.getElementById("gameCardDialog")?.close());

  await page.evaluate(() => window.__liveQA.settingsForQa("link-test"));
  await page.waitForSelector(".link-test-row", { timeout: 5000 }).catch(() => null);
  const rows = await page.$$eval(".link-test-row", (els) => els.length);
  check(rows >= 15, `Link Test lists ${rows} services`);
  check(await noSideScroll(page), "no sideways scroll (Link Test)");
  if (OUT) await page.screenshot({ path: `${OUT}/linktest-${width}${dark ? "-dark" : ""}.png` });

  await page.evaluate(() => window.__liveQA.settingsForQa("watch-services"));
  await page.waitForTimeout(300);
  const sports = await page.evaluate(() => [...document.querySelectorAll(".sync-context-label")].some((e) => e.textContent.trim() === "Sports apps"));
  check(sports, "Streaming Services has Sports apps");
  if (OUT) await page.screenshot({ path: `${OUT}/services-${width}${dark ? "-dark" : ""}.png`, fullPage: false });

  check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await ctx.close();
}

const browser = await launch();
try {
  await run(browser, { width: 390, height: 844 });
  await run(browser, { width: 360, height: 740, dark: true });
} finally { await browser.close(); }
console.log(failures ? `\n✗ ${failures} check(s) failed` : "\n✔ all checks passed");
process.exit(failures ? 1 : 0);
