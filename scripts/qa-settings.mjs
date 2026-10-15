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
const expected = ["Display", "Pages", "Household", "Mail AI", "Voice", "Export My Data", "Global Pages", "Users", "Households", "Restore Backup", "API Usage", "Beta"];
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

// Mail AI: no long write-ups in the list; each (i) opens one in a small window.
await openGeneral();
await page.evaluate(() => document.querySelector('#contextSettingsBody [data-context-settings-action="mail-ai"]')?.click());
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
