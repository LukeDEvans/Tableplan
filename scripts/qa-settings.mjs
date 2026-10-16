#!/usr/bin/env node
// Settings smoke check (SETTINGS_AUDIT.md). Opens the Settings dialog, walks every
// panel reachable from it and from each page's gear menu, and fails on any
// uncaught page error, a panel that renders empty, or a #settings link that no
// longer opens Settings.
//
//   node scripts/qa-settings.mjs [url]   (default http://localhost:4174/; needs `npm run dev:local`)
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
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

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.dismiss());

// Hash routes are read at boot, so each page visit is a fresh load.
const base = URL.replace(/#.*$/, "");
async function visit(hash = "") {
  await page.goto("about:blank");
  await page.goto(hash ? `${base}#${hash}` : base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), { timeout: 20000 });
  if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), { timeout: 10000 });
  await page.waitForTimeout(1200);
}

console.log(`▸ Settings QA against ${URL}`);
await visit();
// View Settings as a household admin with a few members (local dev has no group).
const asAdmin = () => page.evaluate(() => window.__liveQA.settingsAsAdmin());
await asAdmin();

const openGeneral = async () => {
  await page.evaluate(() => {
    document.getElementById("contextSettingsDialog")?.close();
    document.getElementById("generalSettingsMenuBtn")?.click();
  });
  await page.waitForTimeout(150);
};

await openGeneral();
const actions = await page.evaluate(() => [...document.querySelectorAll("#contextSettingsBody [data-context-settings-action]")].map((b) => ({ action: b.dataset.contextSettingsAction, label: b.textContent.trim() })));
check(actions.length > 5, `Settings lists its rows (${actions.length})`);

// The list Luke asked for (2026-10-14): exactly these rows, in this order.
const labels = actions.map((a) => a.label);
const expected = ["Display", "Pages", "Household", "Voice", "Export My Data", "Global Pages", "Users", "Households", "Restore Backup", "API Usage", "Beta"];
check(JSON.stringify(labels) === JSON.stringify(expected), "Settings shows exactly the agreed rows", JSON.stringify(labels));
const adminLabels = await page.evaluate(() => [...document.querySelectorAll(".settings-admin-section [data-context-settings-action]")].map((b) => b.textContent.trim()));
check(adminLabels.includes("API Usage") && adminLabels.includes("Beta"), "API Usage and Beta sit under Admin", JSON.stringify(adminLabels));
const menuUser = await page.evaluate(() => document.getElementById("menuUserBtn")?.textContent.trim());
check(menuUser === "User Profile", "gear menu says 'User Profile'", menuUser);

// Rows that leave the dialog for another window (with a back arrow), or start a download.
const external = new Set(["export-data", "restore-backup", "admin-users", "admin-households"]);
const withBack = { "restore-backup": "restoreDialog", "admin-users": "adminUsersDialog", "admin-households": "adminHouseholdsDialog" };
for (const { action, label } of actions) {
  await openGeneral();
  const before = errors.length;
  await page.evaluate((a) => document.querySelector(`#contextSettingsBody [data-context-settings-action="${a}"]`)?.click(), action);
  await page.waitForTimeout(250);
  const state = await page.evaluate(() => ({
    open: document.getElementById("contextSettingsDialog")?.open,
    title: document.getElementById("contextSettingsTitle")?.textContent || "",
    body: (document.getElementById("contextSettingsBody")?.innerText || "").trim().length,
    anyDialog: [...document.querySelectorAll("dialog")].some((d) => d.open),
  }));
  const ok = errors.length === before && (external.has(action) ? true : state.open && state.body > 0);
  check(ok, `Settings › ${label}`, JSON.stringify({ ...state, error: errors.slice(before) }));
  // Every subsection has a back arrow to the Settings list.
  if (withBack[action]) {
    const back = await page.evaluate((id) => { const b = document.querySelector(`#${id} [data-settings-back]`); return b && !b.hidden && b.getBoundingClientRect().width > 0; }, withBack[action]);
    check(back, `Settings › ${label} has a back arrow`);
    await page.evaluate((id) => document.querySelector(`#${id} [data-settings-back]`)?.click(), withBack[action]);
    await page.waitForTimeout(200);
    const backTo = await page.evaluate(() => document.getElementById("contextSettingsDialog")?.open && document.getElementById("contextSettingsTitle")?.textContent);
    check(backTo === "Settings", `Settings › ${label} back arrow returns to the list`, String(backTo));
  } else if (!external.has(action)) {
    const back = await page.evaluate(() => { const b = document.getElementById("contextSettingsBackBtn"); return b && !b.hidden && b.getBoundingClientRect().width > 0; });
    check(back, `Settings › ${label} has a back arrow`);
  }
  await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
}

// Beta: Assistant and AI Action Log, each with a back arrow to Beta.
for (const label of ["Assistant", "AI Action Log"]) {
  await openGeneral();
  await page.evaluate(() => document.querySelector('#contextSettingsBody [data-context-settings-action="beta"]')?.click());
  await page.waitForTimeout(150);
  const before = errors.length;
  await page.evaluate((l) => [...document.querySelectorAll("#contextSettingsBody [data-context-settings-action]")].find((b) => b.textContent.trim() === l)?.click(), label);
  await page.waitForTimeout(250);
  const t = await page.evaluate(() => document.getElementById("contextSettingsTitle")?.textContent);
  check(t === label && errors.length === before, `Settings › Beta › ${label}`, t);
  await page.evaluate(() => document.getElementById("contextSettingsBackBtn")?.click());
  await page.waitForTimeout(150);
  const back = await page.evaluate(() => document.getElementById("contextSettingsTitle")?.textContent);
  check(back === "Beta", `Beta › ${label} back arrow returns to Beta`, back);
}

// Mail › Automation (was Settings › Mail AI): opens from Mail's gear menu; no long
// write-ups in the list; each (i) opens one in a small window.
await visit("mail");
await page.evaluate(() => { document.getElementById("appMenuBtn")?.click(); document.getElementById("menuMailAutomationBtn")?.click(); });
await page.waitForTimeout(250);
const autoTitle = await page.evaluate(() => document.getElementById("contextSettingsDialog")?.open && document.getElementById("contextSettingsTitle")?.textContent);
check(autoTitle === "Automation", "Mail gear › Automation opens the Mail AI switches", String(autoTitle));
await asAdmin(); // visiting Mail reloaded the page
await page.waitForTimeout(200);
const mailAi = await page.evaluate(() => {
  const body = document.getElementById("contextSettingsBody");
  const rows = body.querySelectorAll(".mail-ai-feature-row").length;
  const infos = body.querySelectorAll("[data-settings-info]");
  const visibleDesc = [...body.querySelectorAll(".settings-info-pop")].filter((p) => !p.hidden).length;
  infos[1]?.click();
  const open1 = [...body.querySelectorAll(".settings-info-pop")].filter((p) => !p.hidden).map((p) => p.textContent.length);
  infos[2]?.click();
  const open2 = [...body.querySelectorAll(".settings-info-pop")].filter((p) => !p.hidden).length;
  infos[2]?.click();
  const open3 = [...body.querySelectorAll(".settings-info-pop")].filter((p) => !p.hidden).length;
  return { rows, infos: infos.length, visibleDesc, open1, open2, open3 };
});
check(mailAi.rows > 3 && mailAi.infos === mailAi.rows && mailAi.visibleDesc === 0, "Mail AI: every row has an (i) and no write-up shows by default", JSON.stringify(mailAi));
check(mailAi.open1.length === 1 && mailAi.open1[0] > 40 && mailAi.open2 === 1 && mailAi.open3 === 0, "Mail AI: (i) opens one write-up at a time and closes it again", JSON.stringify(mailAi));

// Household: read-only until Edit; no App Name; accurate page list; nothing scrolls sideways.
await openGeneral();
await page.evaluate(() => document.querySelector('#contextSettingsBody [data-context-settings-action="family"]')?.click());
await page.waitForTimeout(200);
const hh = await page.evaluate(() => {
  const body = document.getElementById("contextSettingsBody");
  return {
    inputs: body.querySelectorAll(".household-list input").length,
    names: [...body.querySelectorAll(".household-member-name")].map((n) => n.textContent),
    appName: /App Name/.test(body.innerText) || !!body.querySelector("#contextAppNameInput"),
    edit: !!body.querySelector('[data-context-settings-action="edit-family"]'),
    overflow: body.scrollWidth - body.clientWidth,
  };
});
check(hh.inputs === 0 && hh.names.length > 0 && hh.edit, "Household opens read-only with an Edit button", JSON.stringify(hh));
check(!hh.appName, "Household has no App Name", JSON.stringify(hh));
check(hh.overflow <= 1, "Household doesn't scroll sideways", String(hh.overflow));
await page.evaluate(() => document.querySelector('#contextSettingsBody [data-context-settings-action="edit-family"]')?.click());
await page.waitForTimeout(150);
const hhEdit = await page.evaluate(() => {
  const body = document.getElementById("contextSettingsBody");
  return { rows: body.querySelectorAll("[data-member-row]").length, save: !!body.querySelector('[data-context-settings-action="save-family-members"]'), overflow: body.scrollWidth - body.clientWidth };
});
check(hhEdit.rows > 0 && hhEdit.save && hhEdit.overflow <= 1, "Household › Edit shows editable rows with Save, no sideways scroll", JSON.stringify(hhEdit));
await page.evaluate(() => document.querySelector('#contextSettingsBody [data-context-settings-action="cancel-family-edit"]')?.click());
await page.waitForTimeout(150);
const hhBack = await page.evaluate(() => document.querySelectorAll("#contextSettingsBody .household-list input").length === 0 && !!document.querySelector("#contextSettingsBody .household-list"));
check(hhBack, "Household › Cancel returns to the read-only list");

// Pages and Global Pages list only real pages; one switch covers a page's features.
const realPages = ["Calendar", "Finance", "Listen", "Mail", "Meal Plan", "News", "Recreate", "Shop", "Watch"];
for (const [action, label] of [["pages", "Pages"], ["admin-pages", "Global Pages"]]) {
  await openGeneral();
  await page.evaluate((a) => document.querySelector(`#contextSettingsBody [data-context-settings-action="${a}"]`)?.click(), action);
  await page.waitForTimeout(150);
  const names = await page.evaluate(() => [...document.querySelectorAll("#contextSettingsBody .page-access-name")].map((n) => n.textContent.trim()));
  check(JSON.stringify(names) === JSON.stringify(realPages), `${label} lists only the real pages`, JSON.stringify(names));
}
const groupKeys = await page.evaluate(() => [...document.querySelectorAll("#contextSettingsBody [data-admin-page-visibility]")].map((i) => i.dataset.adminPageVisibility));
check(groupKeys.includes("plan,do") && groupKeys.includes("mail,contacts") && groupKeys.includes("recreate,play,explore"), "Tasks, Contacts, Exercise and Explore follow their page's switch", JSON.stringify(groupKeys));

// Every page's gear-menu items open something without errors.
const pages = ["eat", "shop", "inventory", "plan", "news", "media", "watch", "recreate", "sweat", "finance", "contacts"];
for (const p of pages) {
  await visit(p);
  await page.evaluate(() => document.getElementById("appMenuBtn")?.click());
  await page.waitForTimeout(100);
  const items = await page.evaluate(() => [...document.querySelectorAll("#appMenu > button")].filter((b) => !b.hidden).map((b) => ({ id: b.id, label: b.textContent.trim() })));
  await page.evaluate(() => document.getElementById("appMenuBtn")?.click());
  for (const { id, label } of items) {
    if (["menuUserBtn", "generalSettingsMenuBtn", "menuContactsExportBtn", "menuContactsImportBtn"].includes(id)) continue;
    const before = errors.length;
    await page.evaluate(() => document.getElementById("appMenuBtn")?.click());
    await page.waitForTimeout(80);
    await page.evaluate((i) => document.getElementById(i)?.click(), id);
    await page.waitForTimeout(300);
    const opened = await page.evaluate(() => [...document.querySelectorAll("dialog")].some((d) => d.open) || Boolean(document.querySelector(".modal-backdrop, .publications-modal, [role='dialog']:not([hidden])")));
    check(errors.length === before && opened, `#${p} menu › ${label}`, JSON.stringify(errors.slice(before)));
    await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
    await page.keyboard.press("Escape");
  }
}

// Page gear menus (Luke, 2026-10-14): Finance and Recreate have none; Shop splits
// Receipts and Price History and drops Checklist; News keeps only Sync Settings.
const menuFor = async (p) => {
  await visit(p);
  await page.evaluate(() => document.getElementById("appMenuBtn")?.click());
  await page.waitForTimeout(100);
  const items = await page.evaluate(() => [...document.querySelectorAll("#appMenu > button")].filter((b) => !b.hidden).map((b) => b.textContent.trim()).filter((t) => !["User Profile", "Settings"].includes(t)));
  await page.evaluate(() => document.getElementById("appMenuBtn")?.click());
  return items;
};
const expectMenus = { finance: [], recreate: [], shop: ["Preferred Stores", "Receipts", "Price History"], news: ["Sync Settings"], mail: ["Automation"], watch: ["Streaming Services", "Theaters"] };
for (const [p, want] of Object.entries(expectMenus)) {
  const got = await menuFor(p);
  check(JSON.stringify(got) === JSON.stringify(want), `#${p} gear menu is ${want.length ? want.join(", ") : "empty"}`, JSON.stringify(got));
}

// Shop › Receipts has the Scan receipt button; Price History doesn't.
await visit("shop");
const shopSplit = await page.evaluate(() => {
  document.getElementById("menuShopReceiptsBtn")?.click();
  const receipts = document.getElementById("shopReceiptsDialog");
  const scanInReceipts = !!receipts?.open && !!receipts.querySelector("#openReceiptScanBtn");
  receipts?.close();
  document.getElementById("menuGroceryPricingBtn")?.click();
  const pricing = document.getElementById("groceryPricingDialog");
  const r = { scanInReceipts, pricingOpen: !!pricing?.open, scanInPricing: !!pricing?.querySelector("#openReceiptScanBtn"), pricingTitle: pricing?.querySelector("h2")?.textContent };
  pricing?.close();
  return r;
});
check(shopSplit.scanInReceipts && shopSplit.pricingOpen && !shopSplit.scanInPricing && shopSplit.pricingTitle === "Price History", "Shop: Receipts opens the receipts list with Scan receipt; Price History opens prices", JSON.stringify(shopSplit));

// Finance › Accounts tab: Emergency savings months and the Alerts card live here now.
await visit("finance");
await page.evaluate(() => window.__liveQA.financeSeedAccount());
await page.evaluate(() => document.getElementById("fin-tab-accounts")?.click());
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('.fin-savings-emergency .fin-savings-caret')?.click());
await page.waitForTimeout(300);
const fin = await page.evaluate(() => ({
  months: !!document.querySelector('.fin-savings-emergency [data-fin-edit="emergency-months"]'),
  settingsText: /Settings › Finance/.test(document.getElementById("fin-tabpanel")?.innerText || ""),
  alerts: [...document.querySelectorAll('.fin-alerts-card [data-fin-edit="alert"]')].length,
  accounts: !!document.querySelector(".fin-accounts-card"),
}));
check(fin.months, "Finance: Emergency savings card has the months field", JSON.stringify(fin));
check(fin.alerts > 0 && fin.accounts && !fin.settingsText, "Finance: Accounts tab has Accounts and Alerts, no 'Settings › Finance' pointers", JSON.stringify(fin));
const finBefore = errors.length;
await page.evaluate(() => {
  const input = document.querySelector('.fin-savings-emergency [data-fin-edit="emergency-months"]');
  input.value = "6"; input.dispatchEvent(new Event("change", { bubbles: true }));
  const t = document.querySelector('.fin-alerts-card [data-fin-edit="alert"]');
  t.click();
});
await page.waitForTimeout(300);
const finAfter = await page.evaluate(() => ({
  months: document.querySelector('.fin-savings-emergency [data-fin-edit="emergency-months"]')?.value,
  alertOn: document.querySelector('.fin-alerts-card [data-fin-edit="alert"]')?.checked,
}));
check(errors.length === finBefore && finAfter.months === "6" && finAfter.alertOn === false, "Finance: months and alert switch save", JSON.stringify(finAfter));

// News › Sync Settings: no subscriber cookies.
await openGeneral();
await page.evaluate(() => { document.getElementById("contextSettingsDialog").close(); });
await visit("news");
await page.evaluate(() => { document.getElementById("appMenuBtn")?.click(); document.getElementById("menuReadSyncBtn")?.click(); });
await page.waitForTimeout(300);
const sync = await page.evaluate(() => { const b = document.getElementById("contextSettingsBody"); return { cookies: b.querySelectorAll("input[type=password]").length, text: b.innerText.trim() }; });
check(sync.cookies === 0 && !/cookie/i.test(sync.text) && sync.text.length > 0, "News › Sync Settings has no subscriber cookies", JSON.stringify(sync));
await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));

// Watch (2026-10-15): Streaming Services looks like Sync Settings (rows, status,
// one button, (i)); Theaters has a search box and "+", no Watch Tabs, no URL box.
await visit("watch");
await page.evaluate(() => { document.getElementById("appMenuBtn")?.click(); document.getElementById("menuWatchServicesBtn")?.click(); });
await page.waitForTimeout(250);
const svc = await page.evaluate(() => {
  const b = document.getElementById("contextSettingsBody");
  const first = b.querySelector("[data-watch-service]");
  const before = first?.textContent.trim();
  first?.click();
  const after = b.querySelector(`[data-watch-service="${first?.dataset.watchService}"]`)?.textContent.trim();
  b.querySelector(`[data-watch-service="${first?.dataset.watchService}"]`)?.click();
  return { title: document.getElementById("contextSettingsTitle")?.textContent, rows: b.querySelectorAll(".sync-context-field").length, info: !!b.querySelector("[data-settings-info]"), before, after };
});
check(svc.title === "Streaming Services" && svc.rows > 5 && svc.info && svc.before !== svc.after, "Watch › Streaming Services: Sync-Settings rows with an (i), Add/Remove toggles", JSON.stringify(svc));
await page.evaluate(() => { document.getElementById("contextSettingsDialog").close(); document.getElementById("appMenuBtn")?.click(); document.getElementById("menuWatchTheatersBtn")?.click(); });
await page.waitForTimeout(250);
const th = await page.evaluate(() => {
  const b = document.getElementById("contextSettingsBody");
  return { title: document.getElementById("contextSettingsTitle")?.textContent, text: b.innerText, url: !!b.querySelector('input[type="url"]'), plus: b.querySelector(".watch-theater-add")?.textContent.trim(), search: !!b.querySelector("#watchTheaterNameInput") };
});
check(th.title === "Theaters" && !/Watch Tabs|showtime links/i.test(th.text) && !th.url && th.plus === "+" && th.search, "Watch › Theaters: search box and +, no tabs, hint or URL box", JSON.stringify({ ...th, text: th.text.slice(0, 80) }));
const thAdd = await page.evaluate(() => {
  const b = document.getElementById("contextSettingsBody");
  b.querySelector("#watchTheaterNameInput").value = "QA Cinema";
  b.querySelector("#watchTheaterAddForm").requestSubmit();
  return [...document.querySelectorAll("#contextSettingsBody .sync-context-label")].map((l) => l.textContent);
});
check(thAdd.includes("QA Cinema"), "Watch › Theaters: + adds a typed theater", JSON.stringify(thAdd));
await page.evaluate(() => document.querySelector("#contextSettingsBody [data-delete-theater]")?.click());
await page.evaluate(() => document.getElementById("contextSettingsDialog").close());
// Watch sidebar: three-bar button, Archive at the bottom, no Archive button in the tab bar.
const ws = await page.evaluate(() => {
  const sb = document.getElementById("watchSidebar");
  const tabs = [...(sb?.querySelectorAll("[data-watch-side]") || [])].map((t) => t.dataset.watchSide);
  sb?.querySelector('[data-watch-side="archive"]')?.click();
  const archiveOpen = document.getElementById("watchArchiveDialog")?.open;
  document.getElementById("watchArchiveDialog")?.close();
  return { toggle: !!document.getElementById("watchSidebarToggle"), tabs, archiveOpen, oldBtn: !!document.querySelector("[data-open-watch-archive]") };
});
check(ws.toggle && ws.tabs.at(-1) === "archive" && ws.archiveOpen && !ws.oldBtn, "Watch: three-bar menu with Archive at the bottom; old Archive button gone", JSON.stringify(ws));

// Calendar month view spells the month out.
await visit("plan");
await page.evaluate(() => document.getElementById("titlePlanBtn")?.click()); // local dev may land on Home
await page.waitForTimeout(800);
const monthLabel = await page.evaluate(() => document.querySelector("#weekLabel .plan-label-short")?.textContent || document.getElementById("weekLabel")?.textContent || "");
check(/^[A-Z][a-z]+ \d{4}$/.test(monthLabel.trim()) && monthLabel.trim().split(" ")[0].length > 3, "Calendar month view title spells the month out", monthLabel);

// News: no gear or refresh button by the search box; Front page has no Briefings
// block; pulling down at the top refreshes.
await visit("news");
const news = await page.evaluate(() => ({ gear: !!document.getElementById("newsSettingsBtn"), refresh: !!document.getElementById("newsRefreshBtn"), briefs: !!document.querySelector("#newsContent .news-briefs, #newsContent .news-brief-title"), hint: !!document.querySelector("#newsMainPage .news-pull-hint") }));
check(!news.gear && !news.refresh && !news.briefs && news.hint, "News: no gear/refresh buttons, no Briefings on Front page, pull-to-refresh wired", JSON.stringify(news));

// Shop: no Receipts / + under the list; the urgent toggle is a warning triangle.
await visit("shop");
const shop = await page.evaluate(() => ({ bottom: !!document.querySelector(".shop-page-actions, #openShopReceiptsBtn, #shopScanDirectBtn"), triangle: !!document.querySelector('#groceryNextStopToggle path[d^="M10.29 3.86"]') }));
check(!shop.bottom && shop.triangle, "Shop: no Receipts/+ under the list; urgent toggle is a warning triangle", JSON.stringify(shop));

// Shop list rows (Luke, 2026-10-15): name on one line at phone width; where it came
// from, prep and recipes sit behind an (i) instead of under the name.
await page.fill("#groceryInput", "toothbrush head replacement");
await page.press("#groceryInput", "Enter");
await page.waitForTimeout(500);
const rowCheck = await page.evaluate(() => {
  const wrap = [...document.querySelectorAll("#groceryList .grocery-item-wrap")].find((w) => /Toothbrush/i.test(w.textContent));
  const name = wrap?.querySelector(".grocery-name");
  const range = document.createRange(); if (name) range.selectNodeContents(name);
  const btn = wrap?.querySelector("[data-grocery-info]");
  const box = wrap?.querySelector("input[type=checkbox]");
  btn?.click();
  const pop = wrap?.querySelector("[data-grocery-info-pop]");
  return { lines: name ? range.getClientRects().length : 0, oldLines: wrap?.querySelectorAll(".grocery-name small").length ?? -1, open: pop && !pop.hidden, text: pop?.innerText || "", ticked: box?.checked };
});
check(rowCheck.lines === 1 && rowCheck.oldLines === 0, "Shop: 'Toothbrush Head Replacement' fits on one line with no small print under it", JSON.stringify(rowCheck));
check(rowCheck.open && /Manual/.test(rowCheck.text) && rowCheck.ticked === false, "Shop: (i) opens 'From Manual' without ticking the item", JSON.stringify(rowCheck));
const mealInfo = await page.evaluate(() => window.__liveQA.groceryInfoFor({ notes: ["chopped"] }));
check(mealInfo.some(([k, v]) => k === "From" && v === "Meal Plan") && mealInfo.some(([k]) => /^Recipes?$/.test(k)) && mealInfo.some(([k, v]) => k === "Prep" && v === "chopped"), "Shop: a meal-plan item's (i) lists its recipes and prep", JSON.stringify(mealInfo));

// Recipe Box › Recently deleted: shows the last 30 days, purges older entries on open,
// and restores a recipe.
await visit("eat");
const day = 24 * 60 * 60 * 1000;
await page.evaluate((d) => window.__liveQA.trashSeed([
  { id: "trash-new", deletedAt: new Date(Date.now() - 2 * d).toISOString(), recipe: { id: "qa-rd-1", name: "QA Soup" } },
  { id: "trash-old", deletedAt: new Date(Date.now() - 45 * d).toISOString(), recipe: { id: "qa-rd-2", name: "QA Old Stew" } },
]), day);
await page.evaluate(() => window.__liveQA.openRecipeBox());
await page.waitForTimeout(400);
const link = await page.evaluate(() => { const b = document.getElementById("recentlyDeletedRecipesBtn"); return { hidden: b?.hidden, text: b?.textContent }; });
check(link.hidden === false && link.text === "Recently deleted (1)", "Recipe Box shows 'Recently deleted (1)' (the 45-day-old one is past 30 days)", JSON.stringify(link));
await page.evaluate(() => document.getElementById("recentlyDeletedRecipesBtn")?.click());
await page.waitForTimeout(300);
const view = await page.evaluate(() => ({ open: document.getElementById("trashDialog")?.open, text: document.getElementById("trashList")?.innerText || "" }));
check(view.open && /QA Soup/.test(view.text) && !/QA Old Stew/.test(view.text), "Recently deleted lists only the last 30 days", JSON.stringify(view));
const left = await page.evaluate(() => window.__liveQA.trashIds());
check(JSON.stringify(left) === JSON.stringify(["trash-new"]), "opening it purges entries older than 30 days", JSON.stringify(left));
await page.evaluate(() => document.querySelector('[data-restore-trash="trash-new"]')?.click());
await page.waitForTimeout(400);
const after = await page.evaluate(() => ({ ids: window.__liveQA.trashIds(), empty: /No recently deleted/.test(document.getElementById("trashList")?.innerText || ""), linkHidden: document.getElementById("recentlyDeletedRecipesBtn")?.hidden }));
check(after.ids.length === 0 && after.empty && after.linkHidden, "restoring empties the view and hides the link", JSON.stringify(after));
await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));

// An old #settings link opens the Settings dialog.
await visit("settings");
const viaHash = await page.evaluate(() => document.getElementById("contextSettingsDialog")?.open);
check(Boolean(viaHash), "#settings opens the Settings dialog");

check(errors.length === 0, "no uncaught page errors", errors.join(" | "));
await browser.close();
if (fails.length) { console.log(`\n✗ ${fails.length} settings check(s) failed`); process.exit(1); }
console.log("\n✔ all settings checks passed");
