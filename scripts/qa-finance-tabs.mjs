#!/usr/bin/env node
// Browser check for the Finance page cleanup (Luke, 2026-11-23):
//   - three tabs (no Insights) in an opaque bar pinned to the window top, with a
//     sliding underline; nothing shows through above the bar while scrolling
//   - Transactions: no title, no box; search + Add + Filter + bell the same
//     height; sort lives in the Filter window; no category chips on rows; a red
//     underline (not a dot) on charges to review; each day's date pinned; the
//     tools tuck on scroll down and come back on scroll up
//   - a receipt with no bank charge yet shows as a row; upcoming bills sit above
//     the newest charge
//   - opening a charge brings it to the top; its card has ⋯ (no ✎, no ×), the
//     category as text (dropdown only when uncategorized), a View Receipt link,
//     the square scan button beside "No receipt image yet"; Edit lays out cleanly
//   - tapping a category or the merchant filters the list
//   - Accounts: only the list; account names open their bank; ⋯ › Edit accounts
//   - Budget holds the savings figures, net worth and the old Insights charts
//   - gear menu: Bank Link and Alerts open their windows
//   - no sideways scroll at 390 / 360 px, light and dark, no page errors
// Usage: node scripts/qa-finance-tabs.mjs [url] [screenshotDir]   (needs `npm run dev:local`)
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
const OUT = process.argv[3] || "";
if (OUT && !existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const LAUNCH = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
async function launch() {
  try { return await chromium.launch({ ...LAUNCH, channel: "chrome" }); } catch { /* none */ }
  try { return await chromium.launch(LAUNCH); } catch { /* none */ }
  const p = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  return chromium.launch({ ...LAUNCH, executablePath: p });
}
let failures = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "✓" : "✗"} ${msg}`); if (!ok) failures++; };
const shot = async (page, name, tag) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}-${tag}.png` }); };
const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function bankData() {
  const now = new Date();
  const day = (offset, h = 12) => { const d = new Date(now); d.setDate(now.getDate() - offset); d.setHours(h, 0, 0, 0); return d; };
  // Keep everything in this month so the default (this month's) list shows it.
  const back = (n) => Math.min(n, now.getDate() - 1);
  const txns = [];
  const add = (offset, desc, amount, extra = {}) => txns.push({ id: `T${txns.length + 1}`, posted: day(back(offset)).toISOString(), amount, description: desc, pending: false, ...extra });
  add(0, "TRADER JOE S #710 MPLS", -84.12);
  add(0, "Amazon.com*RV1IN47W3 Amzn.com/billWA", -23.99);
  add(1, "SQ *DANGEROUS MAN BREW", -18.5);
  add(1, "TARGET T-2177 MPLS", -61.07);
  add(1, "UBER   *EATS", -32.4);
  add(2, "COSTCO WHSE #1021", -212.33);
  add(2, "PAYROLL ACME CORP", 2450);
  add(3, "XCEL ENERGY", -96.2);
  add(3, "HOLIDAY STATIONSTORE 123", -45.0);
  add(4, "NETFLIX.COM", -15.49);
  for (let i = 0; i < 16; i++) add(5 + (i % 6), `CAFE NUMBER ${i}`, -(4 + i));
  return [{ id: "B-JOINT", org: "SoFi", name: "Checking", balance: 4200, balanceDate: day(0).toISOString(), transactions: txns },
          { id: "B-CARD", org: "U.S. Bank", name: "Visa", balance: -640, balanceDate: day(9).toISOString(), transactions: [] }];
}

async function run(browser, { width, height, dark }) {
  const tag = `${width}${dark ? "-dark" : ""}`;
  console.log(`▸ ${width}px${dark ? " (dark)" : ""}`);
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light", hasTouch: width < 700 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const accounts = bankData();
  await page.route("**/.netlify/functions/simplefin", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const send = (data) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (body.action === "status") return send({ connected: true, connectedAt: "2026-01-01T00:00:00Z" });
    if (body.action === "accounts") return send({ accounts, errors: [], cached: true, fetchedAt: new Date().toISOString() });
    if (body.action === "history") return send({ days: {} });
    if (body.action === "receipts") return send({ receipts: [] });
    return send({});
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#lockDevSignInBtn:not([hidden])", { timeout: 25000 });
  await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), null, { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });

  const today = new Date();
  const todayKey = keyOf(today);
  await page.evaluate(({ todayKey }) => {
    const groups = [
      { id: "fin-group-needs", label: "Needs", idealPct: 50, categories: [{ id: "groc", name: "Groceries", mode: "sum", activeItemId: "", items: [{ id: "i1", name: "", amount: 800, note: "" }] }, { id: "util", name: "Utilities", mode: "sum", activeItemId: "", items: [{ id: "i2", name: "", amount: 150, note: "" }] }] },
      { id: "fin-group-wants", label: "Wants", idealPct: 30, categories: [{ id: "dine", name: "Dining out", mode: "sum", activeItemId: "", items: [{ id: "i3", name: "", amount: 200, note: "" }] }] },
      { id: "fin-group-savings", label: "Savings", idealPct: 20, categories: [] },
    ];
    window.__liveQA.financeStateSeedForQa({
      financeAccounts: [
        { id: "a1", owner: "Joint", name: "SoFi — Checking", kind: "cash", linkedId: "B-JOINT" },
        { id: "a2", owner: "Joint", name: "U.S. Bank — Visa", kind: "debt", linkedId: "B-CARD" },
      ],
      financeBudgetGroups: groups,
      financeTxnLabels: { T1: "cat:fin-group-needs:groc", T6: "cat:fin-group-needs:groc", T8: "cat:fin-group-needs:util", T3: "cat:fin-group-wants:dine" },
      financeRecurring: [{ id: "b1", merchantKey: "verizon wireless", name: "Verizon Wireless", lineItemKey: "", expectedDay: 28, lastAmount: 80, lastSeen: "2026-01-28", active: true }],
      receipts: [{ id: "r-new", storeName: "Kowalski's Market", purchaseDate: todayKey, total: 41.25, source: "scan", lineItems: [{ id: "l1", rawText: "Bread", normalizedName: "Bread", totalPrice: 6.5 }, { id: "l2", rawText: "Coffee", normalizedName: "Coffee", totalPrice: 34.75 }] }],
    });
  }, { todayKey });
  await page.evaluate(() => window.__liveQA.openPageForQa("finance"));
  await page.waitForSelector(".fin-txn-row", { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(500);

  // Tabs
  const tabs = await page.$$eval(".fin-tabbar .fin-tab", (els) => els.map((e) => e.textContent.trim()));
  check(tabs.join("|") === "Transactions|Budget|Accounts", `tabs: ${tabs.join(", ")}`);
  const ind = await page.evaluate(() => { const g = document.getElementById("financePlannerGrid"); const a = g.querySelector(".fin-tab.is-active"); return { l: g.style.getPropertyValue("--fin-tab-l"), w: g.style.getPropertyValue("--fin-tab-w"), al: a.offsetLeft, aw: a.offsetWidth }; });
  check(parseFloat(ind.w) === ind.aw && parseFloat(ind.l) === ind.al, `underline sits under the chosen tab (${JSON.stringify(ind)})`);
  const activeBg = await page.$eval(".fin-tabbar .fin-tab.is-active", (e) => getComputedStyle(e).backgroundColor);
  check(/rgba\(0, 0, 0, 0\)|transparent/.test(activeBg), `no bubble behind the chosen tab (${activeBg})`);

  // Transactions header
  check(!(await page.$(".fin-txns-head, [data-fin-card='txns'] h3")), "no Transactions title");
  const heights = await page.$$eval(".fin-txn-tools > *", (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  check(heights.length === 4 && heights.every((h) => h === heights[0]), `search, add, filter, bell all ${heights[0]}px (${heights.join(",")})`);
  check(!(await page.$(".fin-txn-sort")), "no sort dropdown beside the search");
  check(!(await page.$(".fin-txn-label-pill")), "no category chips on rows");
  check(!(await page.$(".fin-txn-list .fin-txn-dot")), "no red dots on rows");
  const review = await page.$$eval(".fin-txn-row.is-review .fin-txn-name", (els) => els.map((e) => getComputedStyle(e).textDecorationLine));
  check(review.length > 0 && review.every((d) => d.includes("underline")), `charges to review are underlined (${review.length})`);
  const cardBorder = await page.$eval("[data-fin-card='txns']", (e) => getComputedStyle(e).borderTopWidth);
  check(cardBorder === "0px", `no box around the list (${cardBorder})`);
  const receiptRow = await page.$$eval(".fin-txn-row.is-receipt-only .fin-txn-name", (els) => els.map((e) => e.textContent.trim()));
  check(receiptRow.includes("Kowalski's Market"), `receipt with no charge yet is listed (${receiptRow.join(", ")})`);
  const names = await page.$$eval(".fin-txn-list .fin-txn-name", (els) => els.map((e) => e.textContent.trim()));
  check(names.includes("Amazon") && !names.some((n) => /RV1IN47W3/.test(n)), "Amazon.com*RV1IN47W3 reads as Amazon");
  const billsAbove = await page.evaluate(() => { const b = document.querySelector("[data-fin-bills]"); const l = document.querySelector("[data-fin-txn-list]"); return b && l ? b.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING : null; });
  check(Boolean(billsAbove), "upcoming bills sit above the transactions");
  const billsHidden = await page.evaluate(() => { const b = document.querySelector("[data-fin-bills]"); const bar = document.querySelector(".fin-txn-tools"); return b ? b.getBoundingClientRect().bottom <= bar.getBoundingClientRect().bottom + 1 : null; });
  check(billsHidden === true, "bills start scrolled just out of view (scroll up to see them)");
  await shot(page, "finance-txns", tag);

  // Scrolling: pinned bar, tucking tools, pinned date
  const scrollerInfo = async () => page.evaluate(() => {
    let el = document.getElementById("financePlannerGrid").parentElement;
    while (el && el !== document.body) { const oy = getComputedStyle(el).overflowY; if (oy === "auto" || oy === "scroll") break; el = el.parentElement; }
    if (!el || el === document.body) el = document.scrollingElement;
    return { isDoc: el === document.scrollingElement, top: el.scrollTop };
  });
  const scrollBy = async (dy) => {
    await page.evaluate((dy) => {
      let el = document.getElementById("financePlannerGrid").parentElement;
      while (el && el !== document.body) { const oy = getComputedStyle(el).overflowY; if (oy === "auto" || oy === "scroll") break; el = el.parentElement; }
      if (!el || el === document.body) el = document.scrollingElement;
      el.scrollBy(0, dy);
    }, dy);
    await page.waitForTimeout(350);
  };
  await scrollBy(120); await scrollBy(120);
  const after = await page.evaluate(() => {
    const bar = document.querySelector(".fin-tabbar").getBoundingClientRect();
    const tools = document.querySelector(".fin-txn-tools").getBoundingClientRect();
    const win = document.getElementById("financeMainPage").getBoundingClientRect();
    // What's drawn just above the tab labels, inside the window: must be the bar itself.
    const x = bar.left + bar.width / 2;
    const y = Math.max(win.top + 3, bar.top + 2);
    const hit = document.elementFromPoint(x, y);
    const heads = [...document.querySelectorAll(".fin-txn-list .fin-txn-day-head")].map((h) => h.getBoundingClientRect().top);
    return { barTop: bar.top, barBottom: bar.bottom, winTop: win.top, toolsTucked: tools.bottom <= bar.bottom + 1, hitBar: Boolean(hit?.closest(".fin-tabbar")), heads, toolsClass: document.querySelector(".fin-txn-tools").className };
  });
  check(after.hitBar, `nothing shows through above the tabs (bar top ${after.barTop}, window top ${after.winTop})`);
  check(after.toolsTucked, `tools tucked after scrolling down (${after.toolsClass})`);
  check(after.heads.some((t) => Math.abs(t - after.barBottom) <= 2), `a date is pinned under the bar (${after.heads.slice(0, 4).map(Math.round).join(",")} vs ${Math.round(after.barBottom)})`);
  await shot(page, "finance-scrolled", tag);
  await scrollBy(-40);
  const back = await page.evaluate(() => { const bar = document.querySelector(".fin-tabbar").getBoundingClientRect(); const t = document.querySelector(".fin-txn-tools").getBoundingClientRect(); return t.top >= bar.bottom - 1; });
  check(back, "tools slide back on a scroll up");

  // Open a charge
  await page.click('.fin-txn-row[data-id="T1"]');
  await page.waitForTimeout(900);
  const opened = await page.evaluate(() => {
    const row = document.querySelector('.fin-txn-row[data-id="T1"]').getBoundingClientRect();
    const bar = document.querySelector(".fin-tabbar").getBoundingClientRect();
    const head = document.querySelector('.fin-txn-row[data-id="T1"]').closest(".fin-txn-day").querySelector(".fin-txn-day-head").getBoundingClientRect();
    const card = document.querySelector(".fin-txn-card");
    return { rowTop: row.top, below: bar.bottom + head.height, more: Boolean(card.querySelector(".fin-txn-more")), pencil: /✎/.test(card.textContent), x: Boolean(card.querySelector('[data-fin-action="close-txn-detail"]')), select: Boolean(card.querySelector("select")), cat: card.querySelector('[data-fin-action="filter-category"]')?.textContent.trim() || "", noReceiptBtn: Boolean(card.querySelector(".fin-txn-noreceipt .fin-square-btn")) };
  });
  check(Math.abs(opened.rowTop - opened.below) <= 4, `opened charge moved to the top (${Math.round(opened.rowTop)} vs ${Math.round(opened.below)})`);
  check(opened.more && !opened.pencil && !opened.x, "card has ⋯, no ✎ and no ×");
  check(!opened.select && opened.cat === "Groceries", `category reads as text (${opened.cat})`);
  check(opened.noReceiptBtn, "square scan button beside \"No receipt image yet\"");
  await shot(page, "finance-card", tag);
  // ⋯ menu
  await page.click(".fin-txn-card .fin-txn-more");
  const menu = await page.$$eval("#finMoreMenu .fin-txn-menu-option", (els) => els.map((e) => e.textContent.replace(/[›✓]/g, "").trim()));
  check(["Edit", "Split into categories", "Scan receipt"].every((x) => menu.includes(x)), `⋯ menu: ${menu.join(", ")}`);
  await page.click('#finMoreMenu .fin-txn-menu-option:has-text("Edit")');
  await page.waitForTimeout(300);
  const edit = await page.evaluate(() => {
    const card = document.querySelector(".fin-txn-card.is-editing");
    if (!card) return null;
    const r = card.getBoundingClientRect();
    const overflow = [...card.querySelectorAll("*")].some((el) => { const b = el.getBoundingClientRect(); return b.width && (b.right > r.right + 1 || b.left < r.left - 1); });
    return { overflow, fields: card.querySelectorAll(".fin-edit-field").length };
  });
  check(edit && !edit.overflow && edit.fields >= 4, `Edit view lays out inside the card (${JSON.stringify(edit)})`);
  await shot(page, "finance-edit", tag);
  await page.click('[data-fin-action="rename-txn-cancel"]');
  await page.waitForTimeout(200);
  // Tap the category → filtered
  await page.click('.fin-txn-card [data-fin-action="filter-category"]');
  await page.waitForTimeout(300);
  const filtered = await page.$$eval(".fin-txn-list .fin-txn-name", (els) => els.map((e) => e.textContent.trim()));
  const chip = await page.$eval(".fin-scope-chip", (e) => e.textContent.replace("×", "").trim()).catch(() => "");
  check(chip === "Groceries" && filtered.length === 2, `category tap filters to Groceries (${filtered.join(", ")})`);
  await page.click(".fin-scope-chip");
  await page.waitForTimeout(200);
  // Uncategorized card shows the dropdown
  await page.click('.fin-txn-row[data-id="T2"]');
  await page.waitForTimeout(500);
  check(Boolean(await page.$(".fin-txn-card select.fin-txn-label")), "an uncategorized charge shows the category dropdown");
  // Merchant tap
  await page.click(".fin-txn-card .fin-txn-card-merchant");
  await page.waitForTimeout(300);
  const merch = await page.$$eval(".fin-txn-list .fin-txn-name", (els) => els.map((e) => e.textContent.trim()));
  check(merch.length === 1 && merch[0] === "Amazon", `merchant tap filters to Amazon (${merch.join(", ")})`);
  await page.click(".fin-scope-chip");
  // Filter window holds the sort
  await page.click('[data-fin-action="txn-filter-open"]');
  check(Boolean(await page.$('#finFilterOverlay [data-fin-filter="sort"]')), "sort is in the Filter window");
  await page.click("#finFilterOverlay [data-fin-filter-done]");
  // Receipt-only card
  await page.click('.fin-txn-row.is-receipt-only');
  await page.waitForTimeout(400);
  check(Boolean(await page.$('.fin-txn-card [data-fin-action="open-receipt"].fin-link-btn')), "a receipt row's card has a View Receipt link");
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll (Transactions)");

  // Budget
  await page.click('[data-fin-action="fin-tab"][data-tab="budget"]');
  await page.waitForTimeout(500);
  const budget = await page.evaluate(() => ({
    savings: Boolean(document.querySelector(".fin-savings-row")),
    netWorth: Boolean(document.querySelector('[data-fin-card="networth"]')),
    titles: [...document.querySelectorAll(".fin-tab-body .fin-accounts-title")].map((e) => e.textContent.trim()),
  }));
  check(budget.savings && budget.netWorth, "Budget has the savings figures and net worth");
  check(["Cash flow", "Where it went"].every((t) => budget.titles.some((x) => x.startsWith(t))) && !budget.titles.some((t) => /Next 30 days|Notable|^Receipts$|Upcoming bills|Savings goals/.test(t)), `Budget charts: ${budget.titles.join(" · ")}`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll (Budget)");
  await shot(page, "finance-budget", tag);

  // Accounts
  await page.click('[data-fin-action="fin-tab"][data-tab="accounts"]');
  await page.waitForTimeout(500);
  const acct = await page.evaluate(() => ({
    boxes: document.querySelectorAll(".fin-tab-body .fin-card").length,
    pills: document.querySelectorAll(".fin-acct-status").length,
    edits: document.querySelectorAll(".fin-acct-edit-btn, .fin-label-btn").length,
    links: [...document.querySelectorAll(".fin-acct-link")].map((e) => e.textContent.trim()),
    alert: [...document.querySelectorAll(".fin-acct-row")].filter((r) => r.querySelector(".fin-acct-alert")).map((r) => r.querySelector(".fin-acct-name").textContent.trim()),
    banks: Boolean(document.querySelector(".fin-bank-links")),
  }));
  check(acct.boxes === 0 && !acct.banks, `Accounts: just the list (${acct.boxes} boxes)`);
  check(acct.pills === 0 && acct.edits === 0, "no Updated pills, no ✎/＋/✕ while viewing");
  check(acct.links.includes("SoFi — Checking"), `account names open their bank (${acct.links.join(", ")})`);
  check(acct.alert.join() === "U.S. Bank — Visa", `stale account has a red ! (${acct.alert.join(", ")})`);
  await shot(page, "finance-accounts", tag);
  if (acct.links.length) {
    await page.click(".fin-acct-link >> nth=0");
    const o = await page.evaluate(() => window.__opened.splice(0));
    check(o.length === 1 && /sofi\.com/.test(o[0]), `SoFi opens its website (${o.join(", ")})`);
  }
  await page.click('[data-fin-action="acct-more"]');
  await page.click('#finMoreMenu .fin-txn-menu-option:has-text("Edit accounts")');
  await page.waitForTimeout(300);
  check(await page.$$eval(".fin-acct-edit-btn", (e) => e.length) === 2 && Boolean(await page.$(".fin-account-add")), "Edit accounts shows ✎ per account and the add row");
  await page.click('[data-fin-action="acct-edit-done"]');

  // Gear menu
  await page.click("#appMenuBtn");
  const gear = await page.$$eval("#appMenu button:not([hidden])", (els) => els.map((e) => e.textContent.trim()));
  check(gear.includes("Bank Link") && gear.includes("Alerts"), `gear menu: ${gear.join(", ")}`);
  await page.click("#menuFinanceBankLinkBtn");
  await page.waitForTimeout(300);
  const bank = await page.$eval("#finSettingsOverlay", (e) => e.textContent).catch(() => "");
  check(/Refresh/.test(bank) && /Disconnect/.test(bank), "Bank Link window has Refresh / Disconnect");
  await shot(page, "finance-banklink", tag);
  await page.click("#finSettingsOverlay .fin-review-close");
  await page.click("#appMenuBtn");
  await page.click("#menuFinanceAlertsBtn");
  await page.waitForTimeout(300);
  check(await page.$$eval("#finSettingsOverlay .fin-alert-pref", (e) => e.length) > 0, "Alerts window lists the alert switches");
  await page.click("#finSettingsOverlay .fin-review-close");

  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await ctx.close();
}

const browser = await launch();
try {
  await run(browser, { width: 390, height: 844, dark: false });
  await run(browser, { width: 360, height: 740, dark: true });
  await run(browser, { width: 1280, height: 860, dark: false });
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
