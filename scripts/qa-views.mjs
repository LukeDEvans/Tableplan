#!/usr/bin/env node
// Headless QA for the view shell (VIEWS_DESIGN.md, build step 2): the view band
// under the landing logo and in the header while the page menu is open; swipes
// on the band (only there), its ‹ › chevrons and the arrow keys; the cyclical
// order Household | Personal | Business; each view's pages (Household and
// Business flat) and look; routes with a view prefix; the last view surviving a
// reload; and a household member seeing Household only.
//
//   node scripts/qa-views.mjs [url]   (default http://localhost:4174/; needs `npm run dev:local`)
//   Start from a clean local state (delete data/tableplan-state.json first): local dev
//   keeps one state file across runs, so a crashed run's layer switches would linger.
//   QA_VIEWS_SHOT=/path/prefix → also saves screenshots
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
const SHOT = process.env.QA_VIEWS_SHOT || "";
const LAUNCH = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
const results = [];
const check = (cond, name, detail) => {
  results.push([cond ? "PASS" : "FAIL", name]);
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
};

async function launch() {
  try { return await chromium.launch({ ...LAUNCH, channel: "chrome" }); } catch { /* none */ }
  try { return await chromium.launch(LAUNCH); } catch { /* none */ }
  const p = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(p)) return chromium.launch({ ...LAUNCH, executablePath: p });
  throw new Error("No Chromium available");
}

const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, timezoneId: "America/Chicago" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const boot = async (path = "") => {
    await page.goto("about:blank"); // a hash-only change wouldn't reload the app
    await page.goto(URL + path, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), { timeout: 20000 });
    if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
    await page.waitForFunction(() => !!window.__liveQA?.viewsReady?.(), { timeout: 20000 });
    await page.waitForTimeout(400);
  };
  const view = () => page.evaluate(() => window.__liveQA.view());
  const area = () => page.evaluate(() => window.__liveQA.activeArea());
  const goHome = async () => { await page.evaluate(() => window.__liveQA.goHome()); await page.waitForTimeout(200); };
  const bandName = (sel) => page.evaluate((s) => document.querySelector(`${s} .view-band-name`)?.textContent.trim(), sel);
  const visibleIn = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((b) => b.offsetParent).map((b) => b.textContent.trim()), sel);
  const palette = () => page.evaluate(() => document.body.dataset.palette || "classic");
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const shot = async (name) => { if (!SHOT) return; await page.waitForTimeout(300); await page.screenshot({ path: `${SHOT}-${name}.png` }); };
  // A one-finger horizontal swipe of dx px, starting at the middle of `sel`.
  const swipe = async (sel, dx, dy = 0) => {
    await page.evaluate(({ sel, dx, dy }) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const touch = (cx, cy) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
      el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [touch(x, y)], changedTouches: [touch(x, y)] }));
      el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], changedTouches: [touch(x + dx, y + dy)] }));
    }, { sel, dx, dy });
    await page.waitForTimeout(350);
  };
  const flatPages = (root) => visibleIn(`${root} .page-group-pages > button`);

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { try { localStorage.removeItem("live-view-v1"); } catch {} });
  await boot();
  await goHome();

  console.log("Landing page (admin)");
  check(await view() === "personal", "first launch opens in Personal", await view());
  check(await bandName("#homeViewBand") === "Personal", "the band under the logo reads Personal");
  const order = await page.evaluate(() => {
    const logo = document.querySelector(".home-logo").getBoundingClientRect();
    const band = document.querySelector("#homeViewBand").getBoundingClientRect();
    const links = document.querySelector("#homePageGroups").getBoundingClientRect();
    return band.top >= logo.bottom - 12 && band.bottom <= links.top + 12;
  });
  check(order, "the band sits between the logo and the links");
  const font = await page.evaluate(() => getComputedStyle(document.querySelector("#homeViewBand .view-band-name")).fontFamily);
  check(/Great Vibes/.test(font), "the band uses the script face", font);
  check((await visibleIn("#homeViewBand .view-band-step")).length === 0, "no chevrons on the landing band (swipe the page instead)");
  check(await page.evaluate(() => { const o = document.getElementById("homeOverviewBtn"); const first = document.getElementById("homePlanBtn"); return !!o?.offsetParent && o.getBoundingClientRect().bottom <= first.getBoundingClientRect().top; }), "Overview sits at the top of the landing links");
  check(!(await page.evaluate(() => document.getElementById("homeBriefing")?.offsetParent)), "no overview under the landing links");

  console.log("The Overview window (Personal only)");
  await page.click("#homeOverviewBtn");
  await page.waitForTimeout(400);
  const ov = await page.evaluate(() => { const d = document.getElementById("overviewDialog"); return d?.open ? d.textContent.replace(/\s+/g, " ") : ""; });
  check(/Overview/.test(ov) && /Calendar/.test(ov) && /Tasks/.test(ov), "Overview opens a window with the write-up", ov.slice(0, 90));
  check(await fits(), "the Overview window fits 390px");
  await shot("overview");
  await page.click("#closeOverviewBtn");
  await page.waitForTimeout(200);
  check(!(await page.evaluate(() => document.getElementById("overviewDialog").open)), "Close shuts it");
  await page.click("#homeOverviewBtn");
  await page.waitForTimeout(300);
  await page.click("#hbCalPanel");
  await page.waitForTimeout(500);
  check(await area() === "plan" && !(await page.evaluate(() => document.getElementById("overviewDialog").open)), "its Calendar panel closes it and opens the Calendar");
  await goHome();
  check(JSON.stringify(await flatPages("#homePageGroups")) === JSON.stringify(["Calendar", "News", "Finance", "Watch", "Listen", "Mail", "Explore", "Exercise", "Leisure"]) && (await visibleIn("#homePageGroups .page-group-head")).length === 0, "Personal: its pages flat, no Tasks / Weather / Scores / Meal Plan / Shop", (await flatPages("#homePageGroups")).join(", "));
  await shot("personal");

  console.log("Swiping on the landing page");
  await swipe("#homeViewBand", 90);
  check(await view() === "household", "finger right → Household");
  await page.waitForTimeout(100);
  check(await bandName("#homeViewBand") === "Household", "the band reads Household");
  check(JSON.stringify(await flatPages("#homePageGroups")) === JSON.stringify(["Calendar", "Meal Plan", "Finance", "Shop", "Watch", "Listen"]), "Household: six pages, flat", (await flatPages("#homePageGroups")).join(", "));
  check((await visibleIn("#homePageGroups .page-group-head")).length === 0, "no group headings in Household");
  check(await palette() === "household", "Household wears the Household theme", await palette());
  check(await fits(), "Household landing fits 390px");
  check(!(await page.evaluate(() => document.getElementById("homeOverviewBtn").offsetParent)), "no Overview in Household");
  await shot("household");
  await swipe("#homeViewBand", 90);
  check(await view() === "business", "finger right again → Business (wraps)");
  check(JSON.stringify(await flatPages("#homePageGroups")) === JSON.stringify(["Calendar"]), "Business: Calendar only");
  check(await palette() === "urbangreens", "Business wears Urban Greens", await palette());
  await shot("business");
  await swipe("#homeViewBand", 90);
  check(await view() === "personal", "and again → Personal");
  await swipe("#homeViewBand", -90);
  check(await view() === "business", "finger left from Personal → Business");
  await swipe("#homeViewBand", -90);
  check(await view() === "household", "finger left from Business → Household (wraps)");
  await swipe("#homeViewBand", 20);
  check(await view() === "household", "a short drag doesn't switch");
  await swipe("#homeViewBand", 60, 80);
  check(await view() === "household", "a mostly vertical drag doesn't switch");
  await swipe(".home-logo", 120);
  check(await view() === "business", "a swipe anywhere on the page switches too (on the logo)");
  await swipe("#homePageGroups", -120);
  check(await view() === "household", "…and on the page list");

  console.log("Arrow keys");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  check(await view() === "personal", "→ key steps right on the landing page");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  check(await view() === "household", "← key steps left");

  console.log("From a page, with the page menu open");
  await page.click("#homePlanBtn");
  await page.waitForTimeout(500);
  check(await area() === "plan", "Calendar opens from Household");
  check(await page.evaluate(() => location.hash.startsWith("#household/")), "the route carries the view", await page.evaluate(() => location.hash));
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  check(await view() === "household", "arrow keys do nothing on a page with the menu closed");
  check(await page.evaluate(() => document.querySelector("#headerViewBand").hidden), "header band hidden while the menu is closed");
  await page.click("#pageTitleBtn");
  await page.waitForTimeout(350);
  check(!(await page.evaluate(() => document.querySelector("#headerViewBand").hidden)), "opening the menu shows the band in the header");
  check(await page.evaluate(() => !document.querySelector("#pageTitle").offsetParent), "…in place of the page title");
  check(await bandName("#headerViewBand") === "Household", "header band reads Household");
  check(JSON.stringify(await flatPages("#pageTitleMenu")) === JSON.stringify(["Calendar", "Meal Plan", "Finance", "Shop", "Watch", "Listen"]), "menu lists Household's pages flat");
  check(await fits(), "header band + menu fit 390px");
  await shot("menu-household");
  await swipe("#headerViewBand", -90);
  check(await bandName("#headerViewBand") === "Personal", "swiping the header band shows Personal in the band");
  check(JSON.stringify(await flatPages("#pageTitleMenu")) === JSON.stringify(["Calendar", "News", "Finance", "Watch", "Listen", "Mail", "Explore", "Exercise", "Leisure"]), "…and Personal's pages in the menu", (await flatPages("#pageTitleMenu")).join(", "));
  check(await view() === "household" && await area() === "plan" && (await page.evaluate(() => window.__liveQA.scopes())).plan === "household", "the page doesn't change yet: still Household's Calendar");
  check(await palette() === "household", "…in Household's look");
  check(!(await page.evaluate(() => document.querySelector("#pageTitleMenu").hidden)), "the menu stays open");
  check(!!(await page.evaluate(() => document.getElementById("titleOverviewBtn").offsetParent)), "Overview is listed at the top of Personal's menu");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  check(await bandName("#headerViewBand") === "Business" && JSON.stringify(await flatPages("#pageTitleMenu")) === JSON.stringify(["Calendar"]), "→ key steps the menu to Business");
  check(await view() === "household", "…still without changing the page");
  await page.click("#headerViewBand .view-band-name");
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.querySelector("#pageTitleMenu").hidden), "tapping the name closes the menu, like the title");
  check(await page.evaluate(() => !!document.querySelector("#pageTitle").offsetParent), "the page title is back");
  check(await view() === "household", "closing without picking a page keeps Household");
  await page.click("#pageTitleBtn");
  await page.waitForTimeout(300);
  check(await bandName("#headerViewBand") === "Household", "reopening the menu starts from the current view");

  console.log("Picking a page in another view");
  await page.click('#headerViewBand [data-view-step="1"]'); // Household → Personal (menu only)
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector("#titleNewsBtn").click());
  await page.waitForTimeout(700);
  check(await view() === "personal" && await area() === "news", "picking News switches to Personal, on News", `${await view()} / ${await area()}`);
  check(await page.evaluate(() => document.querySelector("#pageTitleMenu").hidden), "the menu closes");
  await page.click("#pageTitleBtn");
  await page.waitForTimeout(300);
  await page.click('#headerViewBand [data-view-step="-1"]'); // → Household (menu only)
  await page.waitForTimeout(300);
  check(await view() === "personal" && await area() === "news", "News stays put while the menu shows Household");
  await page.evaluate(() => document.querySelector("#titlePlanBtn").click());
  await page.waitForTimeout(700);
  check(await view() === "household" && await area() === "plan" && (await page.evaluate(() => window.__liveQA.scopes())).plan === "household", "picking Calendar switches to Household's Calendar", `${await view()} / ${await area()}`);
  check(await palette() === "household", "…in Household's look");
  await page.click("#pageTitleBtn");
  await page.waitForTimeout(300);
  await page.click('#headerViewBand [data-view-step="1"]'); // → Personal (menu only)
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector("#titleOverviewBtn").click());
  await page.waitForTimeout(500);
  check(await view() === "personal" && await page.evaluate(() => document.getElementById("overviewDialog").open), "Overview from the menu switches to Personal and opens over the page");
  await page.click("#closeOverviewBtn");
  await page.waitForTimeout(200);
  await goHome();
  await page.keyboard.press("ArrowLeft"); // Personal → Household for the next part
  await page.waitForTimeout(400);
  check(await view() === "household", "back to Household");

  console.log("Opening a page outside the view (dock, link)");
  await page.evaluate(() => document.querySelector("#homeShopBtn").click());
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__liveQA.goHome());
  await page.evaluate(() => document.getElementById("weatherTicker").click()); // Weather: only from the dock, in any view
  await page.waitForTimeout(600);
  check(await area() === "weather" && await view() === "household", "Weather from the dock opens in the view you're in", `${await area()} / ${await view()}`);
  await page.evaluate(() => window.__liveQA.goHome());
  await page.evaluate(() => document.querySelector("#homeNewsBtn").click()); // hidden in Household; a link reaches it the same way
  await page.waitForTimeout(600);
  check(await area() === "news" && await view() === "personal", "News opened from Household moves to Personal", `${await area()} / ${await view()}`);

  console.log("Routes and reload");
  await boot("#household/shop");
  check(await view() === "household", "#household/shop opens Household");
  check(await area() === "shop", "…on Shop");
  await boot("#business");
  check(await view() === "business", "#business opens Business");
  await boot();
  check(await view() === "business", "a reload reopens the last view used");
  await boot("#calendar");
  check(await view() === "business", "an old route without a view keeps the current view when it has the page");

  console.log("Display per view");
  await goHome();
  check(await palette() === "urbangreens", "Business keeps its own look after reload");

  console.log("Each view reads its own rows");
  const scopes = () => page.evaluate(() => window.__liveQA.scopes());
  const go = async (dir) => { await page.keyboard.press(dir > 0 ? "ArrowRight" : "ArrowLeft"); await page.waitForTimeout(500); };
  await goHome();
  await page.evaluate(() => window.__liveQA.businessSpaceForQa({ id: "biz-qa", name: "Business", role: "owner" }));
  while (await view() !== "personal") await go(1);
  let sc = await scopes();
  check(sc.plan === "personal" && sc.media === "personal" && sc.watch === "personal" && sc.do === "personal" && sc.travel === "personal" && sc.grocery === "household", "Personal: own rows, Shop is the household list", JSON.stringify(sc));
  await page.evaluate(() => window.__liveQA.planSeedForQa([{ id: "ev-mine", title: "Dentist", date: "2026-10-21", allDay: true }]));
  await go(-1);
  check(await view() === "household", "→ Household");
  sc = await scopes();
  check(sc.plan === "household" && sc.media === "household" && sc.watch === "household" && sc.do === "household" && sc.grocery === "household" && sc.travel === "personal", "Household: its pages read the household row; Explore's trips stay personal", JSON.stringify(sc));
  let evs = await page.evaluate(() => window.__liveQA.planEventsInRangeForQa("2026-10-21", "2026-10-21"));
  check(!evs.some((e) => e.id === "ev-mine"), "Household doesn't show Personal events", JSON.stringify(evs));
  await page.evaluate(() => window.__liveQA.planSeedForQa([{ id: "ev-home", title: "Family dinner", date: "2026-10-21", allDay: true }]));
  await go(-1);
  check(await view() === "business", "→ Business");
  sc = await scopes();
  check(sc.plan === "business", "Business: the Calendar reads the business row", JSON.stringify(sc));
  evs = await page.evaluate(() => window.__liveQA.planEventsInRangeForQa("2026-10-21", "2026-10-21"));
  check(!evs.some((e) => e.id === "ev-home" || e.id === "ev-mine"), "Business starts with its own empty calendar", JSON.stringify(evs));
  await page.evaluate(() => window.__liveQA.billsSeedForQa([{ id: "bill-qa", name: "Electric", expectedDay: 21, lastAmount: 90 }]));
  evs = await page.evaluate(() => window.__liveQA.planEventsInRangeForQa("2026-10-21", "2026-10-21"));
  check(!evs.some((e) => e.source === "finance" || e.source === "eat" || e.source === "do" || e.source === "play" || e.source === "birthday"), "Business shows no Bills, Meal Plan, Tasks, Exercise or Birthdays", JSON.stringify(evs));
  await page.evaluate(() => window.__liveQA.planSeedForQa([{ id: "ev-work", title: "Shift", date: "2026-10-21", allDay: true }]));
  await go(-1);
  check(await view() === "personal", "→ Personal again");
  evs = await page.evaluate(() => window.__liveQA.planEventsInRangeForQa("2026-10-21", "2026-10-21"));
  check(evs.some((e) => e.id === "ev-mine") && !evs.some((e) => e.id === "ev-home" || e.id === "ev-work"), "Personal: its own event back; no layers until switched on", JSON.stringify(evs));
  await page.evaluate(() => window.__liveQA.billsSeedForQa([{ id: "bill-qa", name: "Electric", expectedDay: 21, lastAmount: 90 }]));
  check((await page.evaluate(() => window.__liveQA.planEventsInRangeForQa("2026-10-21", "2026-10-21"))).some((e) => e.source === "finance"), "Personal still shows Bills");
  await page.evaluate(() => { window.__liveQA.setLayerForQa("household", true); window.__liveQA.setLayerForQa("business", true); });
  evs = await page.evaluate(() => window.__liveQA.planEventsInRangeForQa("2026-10-21", "2026-10-21"));
  const home = evs.find((e) => e.id === "ev-home"), work = evs.find((e) => e.id === "ev-work");
  check(home?.source === "layer" && home.layerView === "household" && work?.layerView === "business" && evs.some((e) => e.id === "ev-mine"), "layers on: Household and Business events show, marked", JSON.stringify(evs));
  await page.evaluate(() => document.querySelector("#homePlanBtn").click());
  await page.waitForTimeout(600);
  const layerRows = await page.evaluate(() => [...document.querySelectorAll("[data-layer-toggle]")].map((b) => b.dataset.layerToggle + ":" + b.getAttribute("aria-checked")));
  check(JSON.stringify(layerRows) === JSON.stringify(["household:true", "business:true"]), "the sidebar's layer switches reflect them", JSON.stringify(layerRows));
  await page.evaluate(() => window.__liveQA.setLayerForQa("business", false));
  evs = await page.evaluate(() => window.__liveQA.planEventsInRangeForQa("2026-10-21", "2026-10-21"));
  check(!evs.some((e) => e.id === "ev-work") && evs.some((e) => e.id === "ev-home"), "turning one off hides just that one");
  // Open a layered event: it switches to its own view.
  await page.evaluate(() => window.__liveQA.setLayerForQa("business", true));
  await page.evaluate(() => { window.planViewDateForQa = true; });
  const opened = await page.evaluate(async () => {
    const pill = document.querySelector('[data-plan-event-id="ev-work"]');
    return Boolean(pill);
  });
  if (opened) {
    await page.click('[data-plan-event-id="ev-work"]');
    await page.waitForTimeout(300);
    const btn = await page.$("[data-plan-detail-layer]");
    check(Boolean(btn), "a layered event's detail offers Open in Business");
    if (btn) { await btn.click(); await page.waitForTimeout(800); }
    check(await view() === "business" && await area() === "plan", "…which switches to Business, on the Calendar", `${await view()} / ${await area()}`);
    const detail = await page.evaluate(() => { const p = document.getElementById("planDetailPanel"); return p && !p.hidden ? p.textContent : ""; });
    check(/Shift/.test(detail) && /Edit/.test(detail), "…and opens it there as an ordinary, editable event", detail.slice(0, 80));
    await page.evaluate(() => document.querySelector("[data-plan-detail-close]")?.click());
    await page.waitForTimeout(200);
  } else {
    console.log("  (layered event not in the visible calendar range — open-in-view check skipped)");
  }
  // Layers never appear outside Personal
  await page.evaluate(() => window.__liveQA.goHome());
  while (await view() !== "household") await go(1);
  evs = await page.evaluate(() => window.__liveQA.planEventsInRangeForQa("2026-10-21", "2026-10-21"));
  check(!evs.some((e) => e.source === "layer"), "no layers in Household", JSON.stringify(evs));
  while (await view() !== "personal") await go(1);
  await page.evaluate(() => { window.__liveQA.setLayerForQa("household", false); window.__liveQA.setLayerForQa("business", false); });

  console.log("Watch redraws with the view");
  while (await view() !== "personal") await go(1);
  await page.evaluate(() => window.__liveQA.watchSeedForQa([{ id: "w-qa", title: "Dune QA", type: "movie" }]));
  await page.evaluate(() => document.getElementById("homeWatchBtn").click());
  await page.waitForTimeout(600);
  const watchShows = () => page.evaluate(() => document.getElementById("watchPlannerGrid").textContent.includes("Dune QA"));
  check(await watchShows(), "Personal's Watch list shows its item");
  await page.click("#pageTitleBtn");
  await page.waitForTimeout(300);
  await page.click('#headerViewBand [data-view-step="-1"]'); // → Household (menu only)
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById("titleWatchBtn").click());
  await page.waitForTimeout(1000);
  check(await view() === "household" && !(await watchShows()), "picking Watch in Household shows Household's list, not Personal's");
  await goHome();

  console.log("Finance follows the view once there are personal accounts");
  while (await view() !== "personal") await go(1);
  check((await scopes()).finance === "household", "no personal accounts: Personal shows the household's Finance (as before)");
  await page.evaluate(() => window.__liveQA.personalFinanceForQa(true));
  await page.waitForTimeout(600);
  check((await scopes()).finance === "personal", "with personal accounts: Personal reads the person's own Finance");
  await page.evaluate(() => document.querySelector("#homeFinanceBtn").click());
  await page.waitForTimeout(800);
  const summary = await page.evaluate(() => document.querySelector(".fin-household-summary")?.textContent.replace(/\s+/g, " ") || "");
  check(/Household/.test(summary) && /Open in Household/.test(summary), "Personal Finance shows the Household card", summary.slice(0, 80));
  check(await fits(), "Personal Finance fits 390px");
  await shot("finance-personal");
  await page.click('[data-fin-action="open-household"]');
  await page.waitForTimeout(800);
  check(await view() === "household" && (await scopes()).finance === "household" && await area() === "finance", "Open in Household switches views and stays on Finance", `${await view()} / ${(await scopes()).finance} / ${await area()}`);
  check(!(await page.evaluate(() => !!document.querySelector(".fin-household-summary"))), "no Household card in Household");
  check(!(await page.evaluate(() => window.__liveQA.shadowOnDeviceForQa())).includes("finance"), "the finance copy not on screen is never saved on the device");
  await page.evaluate(() => window.__liveQA.personalFinanceForQa(false));
  await page.waitForTimeout(400);
  await goHome();
  while (await view() !== "personal") await go(1);
  check((await scopes()).finance === "household", "turning it off: Personal shows the household's Finance again");

  console.log("The ticker's game card");
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  const t = (name, abbr) => ({ name, short: name, abbr, refs: { espn: abbr } });
  await page.evaluate((board) => window.__liveQA.scoresSetBoard(board), { date: today, games: [{ id: "g-qa", league: "nfl", start: new Date().toISOString(), state: "live", detail: "3rd 5:32", home: { team: t("Minnesota Vikings", "MIN"), score: 21 }, away: { team: t("Green Bay Packers", "GB"), score: 17 } }] });
  while (await view() !== "household") await go(1);
  await page.evaluate((d) => window.__liveQA.tickerGameForQa(d, "g-qa"), today);
  await page.waitForTimeout(400);
  const card = await page.evaluate(() => { const d = document.getElementById("gameCardDialog"); return d?.open ? d.textContent.replace(/\s+/g, " ") : ""; });
  check(/Minnesota Vikings/.test(card) && /21/.test(card) && /3rd 5:32/.test(card), "in Household a ticker tap opens the game card", card.slice(0, 90));
  check(await view() === "household" && await area() !== "scores", "…and stays in Household");
  check(await fits(), "the card fits 390px");
  await shot("game-card");
  await page.click("[data-game-card-close]");
  await page.waitForTimeout(200);
  check(!(await page.evaluate(() => document.getElementById("gameCardDialog")?.open)), "Close shuts it");
  while (await view() !== "personal") await go(1);

  console.log("A household member");
  await page.evaluate(() => window.__liveQA.viewsAsRole("member"));
  await goHome();
  await page.waitForTimeout(300);
  check(await view() === "household", "Household only");
  check(await bandName("#homeViewBand") === "Household", "the band reads Household");
  check((await visibleIn("#homeViewBand .view-band-step")).length === 0, "no chevrons");
  check(!(await page.evaluate(() => document.getElementById("homeOverviewBtn").offsetParent)), "no Overview for her");
  await swipe("#homeViewBand", 90);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  check(await view() === "household", "swipes and arrow keys don't switch");
  check(JSON.stringify(await flatPages("#homePageGroups")) === JSON.stringify(["Calendar", "Meal Plan", "Finance", "Shop", "Watch", "Listen"]), "her six pages, flat");
  check(await palette() === "classic", "her own Display choice (Classic by default), not the admin's Household look", await palette());
  await page.evaluate(() => document.querySelector("#homePlanBtn").click());
  await page.waitForTimeout(400);
  check(await page.evaluate(() => location.hash === "#plan" || !location.hash.includes("/")), "her routes carry no view prefix", await page.evaluate(() => location.hash));
  await page.click("#pageTitleBtn");
  await page.waitForTimeout(300);
  check(await bandName("#headerViewBand") === "Household", "her header band reads Household while the menu is open");
  await shot("member-menu");

  await page.setViewportSize({ width: 360, height: 780 });
  await page.evaluate(() => window.__liveQA.viewsAsRole("admin"));
  await goHome();
  check(await fits(), "landing with the band fits 360px");
  check(errors.length === 0, "no page errors", errors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter(([r]) => r === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
