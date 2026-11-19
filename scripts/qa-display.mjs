#!/usr/bin/env node
// Settings › Display check (Luke, 2026-11-04): each view's own logo and name,
// theme cards without color-name lines, and the automatic changes (holidays,
// game days with ranked teams).
//
//   node scripts/qa-display.mjs [url]   (default http://localhost:4174/; needs `npm run dev:local`)
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const URL = process.argv[2] || "http://localhost:4174/";
const SHOTS = process.env.QA_SHOTS || "";
const fails = [];
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails.push(label);
};

async function launch() {
  const args = { headless: true };
  try { return await chromium.launch({ ...args, channel: "chrome" }); } catch { /* not here */ }
  try { return await chromium.launch(args); } catch { /* not here */ }
  const sandbox = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(sandbox)) return chromium.launch({ ...args, executablePath: sandbox });
  throw new Error("No Chromium found");
}

// A small transparent PNG with a green square — a stand-in logo.
function testPng(w = 200, h = 80) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < h; y++) { const row = Buffer.alloc(1 + w * 4); for (let x = 0; x < w; x++) { const on = x > 20 && x < 180 && y > 10 && y < 70; row.set(on ? [120, 187, 52, 255] : [0, 0, 0, 0], 1 + x * 4); } rows.push(row); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.dismiss());
const shot = async (name) => { if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };

console.log(`▸ Display QA against ${URL}`);
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), { timeout: 20000 });
if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
await page.waitForFunction(() => document.body.classList.contains("app-authed"), { timeout: 10000 });
await page.waitForTimeout(1200);
await page.evaluate(() => window.__liveQA.viewsAsRole?.("admin"));

// Favorites: Twins first (not switched on), then Vikings, then Wild.
const team = (scope, league, name, short) => ({ scope, league, name, short, refs: {} });
await page.evaluate((teams) => window.__liveQA.sportsSetPrefs({ teams }), [
  team("mlb", "mlb", "Minnesota Twins", "Twins"),
  team("nfl", "nfl", "Minnesota Vikings", "Vikings"),
  team("nhl", "nhl", "Minnesota Wild", "Wild"),
  team("nfl", "nfl", "Green Bay Packers", "Packers"),
]);

const openDisplay = async () => {
  await page.evaluate(() => {
    document.getElementById("contextSettingsDialog")?.close();
    document.getElementById("generalSettingsMenuBtn")?.click();
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#contextSettingsBody [data-context-settings-action="display"]')?.click());
  await page.waitForTimeout(250);
};

await openDisplay();
const cards = await page.evaluate(() => [...document.querySelectorAll(".display-theme-card")].map((c) => ({ name: c.querySelector(".display-theme-name")?.textContent.trim(), desc: c.querySelector(".display-theme-desc")?.textContent.trim() || "" })));
check(cards.length >= 10, `theme cards render (${cards.length})`);
check(cards.filter((c) => c.desc).every((c) => c.name === "Seasonal"), "only Seasonal keeps a line under its name", JSON.stringify(cards.filter((c) => c.desc && c.name !== "Seasonal")));
check(await page.evaluate(() => !!document.querySelector("[data-display-logo-pick]") && !!document.querySelector("[data-display-name]")), "Logo & name controls are there");
const fit = await page.evaluate(() => { const b = document.getElementById("contextSettingsBody"); return { sw: b.scrollWidth, cw: b.clientWidth }; });
check(fit.sw <= fit.cw + 1, "Display fits a phone width with no sideways scroll", JSON.stringify(fit));
await shot("display-top");

// Name: Personal → "Luke's Things"
const view0 = await page.evaluate(() => window.__liveQA.view());
await page.fill("[data-display-name]", "Urban Greens HQ");
await page.press("[data-display-name]", "Enter");
await page.waitForTimeout(200);
const band = await page.evaluate(() => document.querySelector("#homeViewBand .view-band-name")?.textContent.trim());
check(band === "Urban Greens HQ", `the view band shows the new name (${view0})`, band);
await page.fill("[data-display-name]", "");
await page.press("[data-display-name]", "Enter");
await page.waitForTimeout(200);
const band2 = await page.evaluate(() => document.querySelector("#homeViewBand .view-band-name")?.textContent.trim());
check(band2 && band2 !== "Urban Greens HQ", "an empty name goes back to the default", band2);

// Logo: upload, then remove.
await page.setInputFiles("[data-display-logo-input]", { name: "logo.png", mimeType: "image/png", buffer: testPng() });
await page.waitForFunction(() => document.querySelector(".home-logo")?.classList.contains("is-custom"), { timeout: 5000 }).catch(() => {});
const logo = await page.evaluate(() => { const img = document.querySelector(".home-logo"); return { custom: img?.classList.contains("is-custom"), src: (img?.getAttribute("src") || "").slice(0, 22), preview: !!document.querySelector(".display-logo-preview.is-custom"), remove: !!document.querySelector("[data-display-logo-remove]") }; });
check(logo.custom && logo.src.startsWith("data:image/png"), "the landing logo is the uploaded one", JSON.stringify(logo));
check(logo.preview && logo.remove, "Display shows the new logo with “Use the sailboat”", JSON.stringify(logo));
await shot("display-logo");
await page.evaluate(() => { document.getElementById("contextSettingsDialog")?.close(); window.__liveQA.goHome?.(); });
await page.waitForTimeout(300);
await shot("home-custom-logo");
await openDisplay();
await page.click("[data-display-logo-remove]");
await page.waitForTimeout(300);
check(await page.evaluate(() => !document.querySelector(".home-logo").classList.contains("is-custom") && document.querySelector(".home-logo").getAttribute("src") === "./home-logo.png"), "“Use the sailboat” puts the sailboat back");

// Game days: switch on, Vikings on (not Twins), a live Vikings game → Vikings colors.
const teamRows = await page.evaluate(() => [...document.querySelectorAll("[data-display-team]")].map((r) => ({ key: r.dataset.displayTeam, name: r.querySelector(".display-team-name").textContent.trim(), disabled: r.querySelector("[data-display-team-on]").disabled })));
check(teamRows.length === 4 && teamRows[0].name === "Minnesota Twins", "teams listed in favorites order", JSON.stringify(teamRows.map((t) => t.name)));
check(teamRows.find((t) => t.name === "Green Bay Packers")?.disabled, "a team without colors can't be switched on");
await page.click("[data-display-gameday]");
await page.waitForTimeout(150);
await page.click('[data-display-team="nfl:minnesota-vikings"] [data-display-team-on]');
await page.click('[data-display-team="nhl:minnesota-wild"] [data-display-team-on]');
await page.waitForTimeout(150);
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const side = (scope, name, short) => ({ team: { name, short } });
const dateKey = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
const board = (games) => ({ date: dateKey, games, leagues: {} });
await page.evaluate((b) => window.__liveQA.scoresSetBoard(b), board([
  { id: "g1", league: "mlb", start: iso(now - 3600e3), state: "live", home: side("mlb", "Minnesota Twins", "Twins"), away: side("mlb", "Detroit Tigers", "Tigers") },
  { id: "g2", league: "nhl", start: iso(now - 1800e3), state: "live", home: side("nhl", "Minnesota Wild", "Wild"), away: side("nhl", "St. Louis Blues", "Blues") },
  { id: "g3", league: "nfl", start: iso(now - 600e3), state: "live", home: side("nfl", "Minnesota Vikings", "Vikings"), away: side("nfl", "Green Bay Packers", "Packers") },
]));
let r = await page.evaluate(() => window.__liveQA.gamedayRecheck());
check(r?.palette === "vikings", "Vikings (ranked above Wild) win while both play; the Twins game is ignored", JSON.stringify(r));
check(r?.timer === "game", "a live game re-checks every minute", JSON.stringify(r));
await shot("display-gameday");
// Move Wild to the top: now Wild's colors show.
await page.click('[data-display-team="nhl:minnesota-wild"] [data-display-team-move="-1"]');
await page.waitForTimeout(150);
await page.click('[data-display-team="nhl:minnesota-wild"] [data-display-team-move="-1"]');
await page.waitForTimeout(150);
const order = await page.evaluate(() => [...document.querySelectorAll("[data-display-team] .display-team-name")].map((n) => n.textContent.trim()));
check(order[0] === "Minnesota Wild", "moving a team up re-ranks the favorites", JSON.stringify(order));
r = await page.evaluate(() => window.__liveQA.gamedayRecheck());
check(r?.palette === "wild", "after re-ranking, Wild's colors show", JSON.stringify(r));
const nowLine = await page.evaluate(() => document.querySelector(".display-now")?.textContent.trim() || "");
check(/Wild/.test(nowLine), "Display says what's showing and why", nowLine);
// Games over → back to the view's own theme.
await page.evaluate((b) => window.__liveQA.scoresSetBoard(b), board([
  { id: "g2", league: "nhl", start: iso(now - 4 * 3600e3), state: "final", home: { team: { name: "Minnesota Wild", short: "Wild" }, score: 3 }, away: { team: { name: "St. Louis Blues", short: "Blues" }, score: 1 } },
]));
r = await page.evaluate(() => window.__liveQA.gamedayRecheck());
check(r?.shown?.reason !== "game", "after the final, the game colors go away", JSON.stringify(r));
// Game days off → a live game doesn't change anything.
await page.evaluate((b) => window.__liveQA.scoresSetBoard(b), board([
  { id: "g3", league: "nfl", start: iso(now - 600e3), state: "live", home: { team: { name: "Minnesota Vikings", short: "Vikings" } }, away: { team: { name: "Green Bay Packers", short: "Packers" } } },
]));
await openDisplay();
await page.click("[data-display-gameday]");
r = await page.evaluate(() => window.__liveQA.gamedayRecheck());
check(r?.shown?.reason !== "game", "with Game days off, a live game changes nothing", JSON.stringify(r));
await shot("display-bottom");

check(errors.length === 0, "no page errors", errors.join(" | "));
await browser.close();
if (fails.length) { console.log(`\n✗ ${fails.length} failed`); process.exit(1); }
console.log("\n✔ Display QA passed");
