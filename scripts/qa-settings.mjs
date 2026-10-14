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

// Rows that leave the dialog for another dialog, or start a download.
const external = new Set(["weekly-email", "export-data", "backup-health", "restore-backup", "admin-users", "admin-households", "import-ai"]);
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
  await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
}

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

// An old #settings link opens the Settings dialog.
await visit("settings");
const viaHash = await page.evaluate(() => document.getElementById("contextSettingsDialog")?.open);
check(Boolean(viaHash), "#settings opens the Settings dialog");

check(errors.length === 0, "no uncaught page errors", errors.join(" | "));
await browser.close();
if (fails.length) { console.log(`\n✗ ${fails.length} settings check(s) failed`); process.exit(1); }
console.log("\n✔ all settings checks passed");
