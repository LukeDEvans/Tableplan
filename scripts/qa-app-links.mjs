// Browser check for APP_LINKS_DESIGN.md (buttons that open another app).
// Runs the real app against the local dev server (npm run dev:local):
//   - Finance › Accounts: "Your banks" lists only banks the catalog knows; a tap
//     opens the bank's website on the web app
//   - Finance › Insights: a Verizon bill has Pay; rent doesn't
//   - Calendar: an event with a place offers Apple Maps / Google Maps; a bill
//     on the calendar offers Pay
//   - Shop: Target's heading has its app button; an item's menu has
//     "Find at Target" / "Find at Costco", which opens Target's search
//   - Contacts: a phone number has Text and FaceTime links
//   - Explore: the destination opens Maps; a Delta flight offers "Open Delta"
//   - News: ⋯ → "Open in NYT app" on an nytimes.com story, not on a tracker link
//   - Settings › Admin › Beta › Link Test lists banks, stores and maps
//   - no sideways scroll at 390 / 360 px, light and dark, no console errors
// Usage: node scripts/qa-app-links.mjs [url] [screenshotDir]
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
const opened = (page) => page.evaluate(() => { const o = window.__opened.slice(); window.__opened.length = 0; return o; });
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
const shot = async (page, name, width, dark) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}-${width}${dark ? "-dark" : ""}.png` }); };

function pad(n) { return String(n).padStart(2, "0"); }
function keyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

async function run(browser, { width, height, dark }) {
  console.log(`▸ ${width}px${dark ? " (dark)" : ""}`);
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light", hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon/i.test(m.text())) errors.push(m.text()); });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#lockDevSignInBtn:not([hidden])", { timeout: 20000 });
  await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), null, { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });

  const today = new Date();
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 20);
  const billDay = 28; // after any test date's "today", so it's upcoming (or overdue on the 28th)
  const todayKey = keyOf(today);
  await page.evaluate(({ todayKey, lastSeen, billDay }) => window.__liveQA.appLinksSeedForQa({
    accounts: [
      { id: "a1", owner: "Joint", name: "SoFi — Checking", kind: "cash", manualBalance: 1200 },
      { id: "a2", owner: "Joint", name: "Chase — Credit", kind: "debt", manualBalance: -300 },
      { id: "a3", owner: "Joint", name: "SoFi — Savings", kind: "cash", manualBalance: 5000 },
      { id: "a4", owner: "Joint", name: "Sure 401(k)", kind: "retirement", manualBalance: 9000 },
    ],
    bills: [
      { id: "b1", merchantKey: "verizon", name: "Electronic Withdrawal Verizon Wireless", lineItemKey: "", expectedDay: billDay, lastAmount: 80, lastSeen, active: true, ackAmount: null, missAck: "", newAck: false },
      { id: "b2", merchantKey: "kula", name: "Web Authorized Pmt Kula Property Ma", lineItemKey: "", expectedDay: billDay, lastAmount: 1900, lastSeen, active: true, ackAmount: null, missAck: "", newAck: false },
    ],
    stores: [{ id: "st-target", name: "Target" }, { id: "st-costco", name: "Costco" }, { id: "st-kow", name: "Kowalski's" }],
    groceries: ["paper towels"],
    locations: { "paper-towels": { storeId: "st-target", order: 0, storeRank: ["st-target"] } },
    contacts: [{ id: "c1", name: "Pat Example", phones: [{ label: "mobile", value: "(612) 555-0100" }], emails: [], addresses: [], groups: [] }],
    events: [{ id: "e1", title: "Twins game", date: todayKey, startTime: "19:10", endTime: "22:00", allDay: false, location: { name: "Target Field, Minneapolis" } }],
    trips: [{ id: "t1", name: "Fall trip", destination: "Duluth, MN", startDate: todayKey, endDate: todayKey, status: "booked" }],
  }), { todayKey, lastSeen: keyOf(lastMonth), billDay });

  // ── Finance ──
  await page.evaluate(() => { window.__liveQA.openPageForQa("finance"); });
  await page.waitForTimeout(600);
  await page.click('[data-fin-action="fin-tab"][data-tab="accounts"]').catch(() => null);
  await page.waitForSelector(".fin-bank-links .out-link-chip", { timeout: 8000 }).catch(() => null);
  const banks = await texts(page, ".fin-bank-links .out-link-chip");
  check(banks.join("|") === "SoFi|Chase", `Your banks: ${banks.join(", ") || "(none)"}`);
  check(await noSideScroll(page), "no sideways scroll (Finance › Accounts)");
  await shot(page, "finance-accounts", width, dark);
  if (banks.length) {
    await page.click(".fin-bank-links .out-link-chip >> nth=0");
    const o = await opened(page);
    check(o.length === 1 && o[0] === "https://www.sofi.com/login/", `SoFi opens its website: ${o.join(", ")}`);
  }
  await page.click('[data-fin-action="fin-tab"][data-tab="insights"]').catch(() => null);
  await page.waitForTimeout(400);
  const billRows = await page.$$eval(".fin-bill-row", (rows) => rows.map((r) => ({ name: r.querySelector(".fin-bill-name")?.textContent.trim(), pay: Boolean(r.querySelector(".out-link-chip")) })));
  const verizon = billRows.find((r) => /verizon/i.test(r.name || ""));
  const rent = billRows.find((r) => /kula/i.test(r.name || ""));
  check(Boolean(verizon?.pay) && rent && !rent.pay, `bills: Verizon has Pay, rent doesn't (${JSON.stringify(billRows)})`);
  check(await noSideScroll(page), "no sideways scroll (Finance › Insights)");
  await shot(page, "finance-bills", width, dark);
  if (verizon?.pay) {
    await page.click(".fin-bill-row .out-link-chip >> nth=0");
    const o = await opened(page);
    check(o.length === 1 && /verizon\.com/.test(o[0]), `Pay opens Verizon: ${o.join(", ")}`);
  }

  // ── Calendar ──
  await page.evaluate((k) => window.__liveQA.openPlanEventForQa("e1", k), todayKey);
  await page.waitForSelector(".plan-detail-links .out-link-chip", { timeout: 5000 }).catch(() => null);
  const evLinks = await texts(page, ".plan-detail-links .out-link-chip");
  check(evLinks.join("|") === "Apple Maps|Google Maps", `event with a place: ${evLinks.join(", ") || "(none)"}`);
  check(await noSideScroll(page), "no sideways scroll (event detail)");
  await shot(page, "event", width, dark);
  if (evLinks.length === 2) {
    await page.click(".plan-detail-links .out-link-chip >> nth=1");
    const o = await opened(page);
    check(o.length === 1 && o[0].startsWith("https://www.google.com/maps/dir/?api=1&destination=Target%20Field"), `Google Maps directions: ${o.join(", ")}`);
  }
  const billKey = `${todayKey.slice(0, 8)}${billDay}`;
  await page.evaluate((k) => window.__liveQA.openPlanEventForQa(`finbill-b1-${k}`, k), billKey);
  await page.waitForTimeout(300);
  const billLinks = await texts(page, ".plan-detail-links .out-link-chip");
  check(billLinks.some((t) => /Pay at Verizon/.test(t)), `bill on the calendar: ${billLinks.join(", ") || "(none)"}`);
  await page.evaluate(() => document.querySelector("#planDetailPanel [data-plan-detail-close]")?.click());
  await page.waitForTimeout(300);

  // ── Shop ──
  await page.evaluate(() => { window.__liveQA.openPageForQa("shop"); });
  await page.waitForSelector('[data-grocery-store-section="st-target"]', { timeout: 8000 }).catch(() => null);
  const appBtn = await page.$('[data-grocery-store-section="st-target"] .grocery-store-app');
  check(Boolean(appBtn), "Target's heading has its app button");
  check(await noSideScroll(page), "no sideways scroll (Shop)");
  await shot(page, "shop", width, dark);
  if (appBtn) {
    await appBtn.click();
    const o = await opened(page);
    check(o.length === 1 && o[0] === "https://www.target.com/", `Target button opens target.com: ${o.join(", ")}`);
  }
  const wrap = await page.$('[data-grocery-store-section="st-target"] [data-grocery-wrap-key]');
  check(Boolean(wrap), "the item sits under Target");
  if (wrap) {
    await wrap.dispatchEvent("contextmenu", { clientX: 40, clientY: 200 });
    await page.waitForTimeout(200);
  }
  const findAt = await texts(page, ".grocery-library-context-menu [data-find-at-store]");
  check(findAt.join("|") === "Find at Target|Find at Costco", `item menu: ${findAt.join(", ") || "(none)"}`);
  check(await noSideScroll(page), "no sideways scroll (item menu)");
  await shot(page, "shop-menu", width, dark);
  if (findAt.length) {
    await page.click(".grocery-library-context-menu [data-find-at-store] >> nth=0");
    const o = await opened(page);
    check(o.length === 1 && o[0].toLowerCase() === "https://www.target.com/s?searchterm=paper+towels", `Find at Target: ${o.join(", ")}`);
    check(!(await page.$(".grocery-library-context-menu")), "the menu closes");
  }

  // ── Contacts ──
  await page.evaluate(() => { window.__liveQA.openPageForQa("contacts"); });
  await page.waitForSelector(".contact-phone-act", { timeout: 8000 }).catch(() => null);
  const hrefs = await page.$$eval(".contact-card .contact-phone-act", (els) => els.map((e) => e.getAttribute("href")));
  check(hrefs.join("|") === "sms:6125550100|facetime:6125550100", `contact phone: ${hrefs.join(", ") || "(none)"}`);
  check(await noSideScroll(page), "no sideways scroll (Contacts)");
  await shot(page, "contacts", width, dark);

  // ── Explore ──
  await page.evaluate(() => window.__liveQA.openTripForQa("t1"));
  await page.waitForSelector(".travel-meta-chip--link", { timeout: 8000 }).catch(() => null);
  const dest = await page.$(".travel-meta-chip--link");
  check(Boolean(dest), "trip destination is a Maps button");
  check(await noSideScroll(page), "no sideways scroll (trip)");
  await shot(page, "trip", width, dark);
  if (dest) {
    await dest.evaluate((el) => el.click());
    const o = await opened(page);
    check(o.length === 1 && o[0] === "https://www.google.com/maps/search/?api=1&query=Duluth%2C%20MN", `destination opens Google Maps on the web: ${o.join(", ")}`);
  }
  const flight = await page.evaluate(() => window.__liveQA.itemDetailHtmlForQa("travel", { mode: "airplane", flightNumber: "DL 1234", from: "MSP", to: "AMS" }));
  check(/Open Delta/.test(flight || ""), "a Delta flight offers Open Delta");
  const hotel = await page.evaluate(() => window.__liveQA.itemDetailHtmlForQa("lodging", { name: "Grandma's house" }));
  check(!/out-link-chip/.test(hotel || "x"), "an unknown stay offers nothing");

  // ── News ──
  await page.evaluate(() => {
    const now = new Date().toISOString();
    window.__liveQA.newsSetFeed([
      { id: "n1", url: "https://www.nytimes.com/2026/10/27/us/story.html", title: "A story on the paper's site", section: "us", paper: "nyt", source: "NYT", publishedAt: now, discoveredAt: now },
      { id: "n2", url: "https://nl.nytimes.com/f/a/tracker", title: "A newsletter link", section: "us", paper: "nyt", source: "NYT", publishedAt: now, discoveredAt: now },
    ], {});
    window.__liveQA.openPageForQa("news");
  });
  await page.waitForSelector('[data-news-id="n1"] [data-news-dots]', { timeout: 8000 }).catch(() => null);
  await page.click('[data-news-id="n1"] [data-news-dots]').catch(() => null);
  await page.waitForTimeout(200);
  const appItem = await texts(page, '[data-news-id="n1"] [data-news-act="app"]');
  check(appItem[0] === "Open in NYT app", `story menu: ${appItem.join(", ") || "(none)"}`);
  check(await noSideScroll(page), "no sideways scroll (News menu)");
  await shot(page, "news-menu", width, dark);
  if (appItem.length) {
    await page.click('[data-news-id="n1"] [data-news-act="app"]');
    await page.waitForTimeout(200);
    const o = await opened(page);
    check(o.length === 1 && o[0] === "https://www.nytimes.com/2026/10/27/us/story.html", `opens the story's link: ${o.join(", ")}`);
  }
  await page.click('[data-news-id="n2"] [data-news-dots]').catch(() => null);
  await page.waitForTimeout(200);
  check((await page.$$('[data-news-id="n2"] [data-news-act="app"]')).length === 0, "a tracker link gets no app item");

  // ── Link Test ──
  await page.evaluate(() => window.__liveQA.settingsForQa("link-test"));
  await page.waitForSelector(".link-test-row", { timeout: 5000 }).catch(() => null);
  const names = await texts(page, ".link-test-name");
  check(names.includes("SoFi") && names.includes("Target · search “milk”") && names.includes("Apple Maps"), `Link Test lists ${names.length} links incl. banks, stores, maps`);
  check(await noSideScroll(page), "no sideways scroll (Link Test)");
  await shot(page, "linktest", width, dark);

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
