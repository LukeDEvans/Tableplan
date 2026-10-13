// QA for the Shop "List" tab: tab label, no "Drop items here" placeholder on an
// empty store, touch long-press on a store heading → menu → "Skip this week",
// and the skipped store's items redistributing (next-ranked store, else Other).
//
// Run from the project root with both dev servers up (npm run dev:local). Seeds the
// local backend file and restores it on exit.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";

async function launchChromium() {
  const args = ["--no-proxy-server", "--proxy-bypass-list=*"];
  try { return await chromium.launch({ channel: "chrome", headless: true, args }); } catch { /* not installed */ }
  try { return await chromium.launch({ headless: true, args }); } catch { /* not installed */ }
  const sandboxChrome = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(sandboxChrome)) return await chromium.launch({ headless: true, args, executablePath: sandboxChrome });
  throw new Error("No usable Chromium found.");
}

const URL = "http://localhost:4174/";
const FILE = "data/tableplan-state.json";
const BACKUP = "/tmp/tableplan-state.qa-shop-skip.json";
const hadFile = existsSync(FILE);
if (hadFile) copyFileSync(FILE, BACKUP);
const base = hadFile ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const sec = (id, name) => [{ id: `${id}-s1`, name: "Produce" }, { id: `${id}-s2`, name: "Other" }];
writeFileSync(FILE, JSON.stringify({
  ...base,
  stateUpdatedAt: new Date().toISOString(),
  groceryStores: [
    { id: "qa-aldi", name: "QA Aldi", sections: sec("qa-aldi") },
    { id: "qa-costco", name: "QA Costco", sections: sec("qa-costco") },
    { id: "qa-empty", name: "QA Empty Mart", sections: sec("qa-empty") },
  ],
  persistentManualGroceries: ["zzqapple", "zzqbread"],
  groceryItemLocations: {
    zzqapple: { storeId: "qa-aldi", storeRank: ["qa-aldi", "qa-costco"], order: 0 },
    zzqbread: { storeId: "qa-aldi", storeRank: ["qa-aldi"], order: 1 },
  },
  grocerySkippedStores: {},
}, null, 2) + "\n");

const results = [];
const rec = (id, ok, detail) => { results.push({ id, ok }); console.log(`  [${ok ? "PASS" : "FAIL"}] ${id} — ${detail}`); };
const pageErrs = [];

const browser = await launchChromium();
try {
  const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 400, height: 860 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrs.push(String(e.message || e)));
  await page.addInitScript(() => { try { localStorage.setItem("live_local_dev", "1"); } catch {} });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.waitForFunction(() => { const o = document.getElementById("hydrationOverlay"); return !o || o.hidden || o.offsetParent === null; }, { timeout: 30000 }).catch(() => {});
  await page.click("#homeShopBtn", { timeout: 8000 }).catch(async () => { await page.click("#titleShopBtn"); });
  await page.waitForSelector("[data-shop-space]", { timeout: 15000 });
  await page.click('[data-shop-space="shop"]');
  await page.waitForSelector('[data-grocery-store-section="qa-aldi"]', { timeout: 15000 });

  const tabLabels = await page.$$eval("[data-shop-space]", (b) => b.map((x) => x.textContent.trim()));
  rec("tab-label", tabLabels.includes("List") && !tabLabels.includes("Shop"), `space tabs: ${JSON.stringify(tabLabels)}`);

  const emptyInfo = await page.evaluate(() => {
    const sec = document.querySelector('[data-grocery-store-section="qa-empty"]');
    return { exists: !!sec, text: sec?.querySelector("[data-grocery-store-list]")?.textContent.trim(), placeholders: document.querySelectorAll(".grocery-store-empty").length, any: document.body.innerText.includes("Drop items here") };
  });
  rec("no-placeholder", emptyInfo.exists && !emptyInfo.text && !emptyInfo.placeholders && !emptyInfo.any, JSON.stringify(emptyInfo));

  const where = () => page.evaluate(() => {
    const out = {};
    document.querySelectorAll("[data-grocery-store-section]").forEach((s) => {
      out[s.dataset.groceryStoreSection || "Other"] = [...s.querySelectorAll("[data-grocery-row-key]")].map((r) => r.dataset.groceryRowKey);
    });
    return out;
  });
  const before = await where();
  rec("seed-routing", before["qa-aldi"]?.includes("zzqapple") && before["qa-aldi"]?.includes("zzqbread"), `before: ${JSON.stringify(before)}`);

  // Touch long-press on the Aldi heading.
  const headSel = '[data-grocery-store-section="qa-aldi"] .grocery-store-heading';
  const box = await page.locator(headSel).boundingBox();
  const cx = box.x + 30, cy = box.y + box.height / 2;
  const fire = (type) => page.evaluate(([sel, t, x, y]) => {
    const el = document.querySelector(sel).querySelector("span") || document.querySelector(sel);
    el.dispatchEvent(new PointerEvent(t, { pointerType: "touch", clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true }));
  }, [headSel, type, cx, cy]);
  await fire("pointerdown");
  await page.waitForTimeout(650);
  const menuItems = await page.$$eval(".grocery-store-context-menu button", (b) => b.map((x) => x.textContent.trim())).catch(() => []);
  rec("longpress-menu", menuItems.includes("Skip this week"), `menu after 650ms hold: ${JSON.stringify(menuItems)}`);
  await fire("pointerup");
  // The release click must not collapse the store.
  await page.evaluate((sel) => document.querySelector(sel).querySelector("button").click(), headSel);
  const collapsed = await page.evaluate(() => document.querySelector('[data-grocery-store-section="qa-aldi"]').classList.contains("is-collapsed"));
  rec("release-click-swallowed", !collapsed, `collapsed after release click = ${collapsed}`);

  // Short tap must NOT open the menu.
  await page.evaluate(() => document.querySelectorAll(".grocery-store-context-menu").forEach((m) => m.remove()));
  await fire("pointerdown"); await page.waitForTimeout(150); await fire("pointerup"); await page.waitForTimeout(500);
  const shortMenu = await page.$(".grocery-store-context-menu");
  rec("short-tap-no-menu", !shortMenu, `menu after 150ms tap: ${!!shortMenu}`);
  // That tap's click is a normal collapse toggle — undo it for a clean state.
  const c2 = await page.evaluate(() => document.querySelector('[data-grocery-store-section="qa-aldi"]').classList.contains("is-collapsed"));
  if (c2) await page.click(`${headSel} button`);

  // Long-press again and choose Skip this week.
  await fire("pointerdown"); await page.waitForTimeout(650); await fire("pointerup");
  await page.click(".grocery-store-context-menu [data-skip-grocery-store]");
  await page.waitForTimeout(500);
  const after = await where();
  const strip = await page.$eval(".grocery-skipped-strip", (e) => e.textContent.replace(/\s+/g, " ").trim()).catch(() => "");
  rec("aldi-hidden", !after["qa-aldi"], `sections after skip: ${JSON.stringify(after)}`);
  rec("apple-to-next-ranked", after["qa-costco"]?.includes("zzqapple"), "zzqapple → QA Costco (its 2nd-ranked store)");
  rec("bread-to-other", (after["Other"] || []).includes("zzqbread"), "zzqbread (Aldi-only) → Other");
  rec("skipped-strip", /QA Aldi skipped this week/.test(strip), `strip: "${strip}"`);

  // Tab bar: long-press on a store tab (single-store tab view) also opens the menu; Aldi gone from tabs.
  const tabs = await page.$$eval("#groceryStoreTabBar [data-grocery-tab]", (b) => b.map((x) => x.textContent.trim()));
  rec("tabs-exclude-skipped", !tabs.includes("QA Aldi"), `store tabs: ${JSON.stringify(tabs)}`);

  // Unskip restores routing.
  await page.click("[data-unskip-grocery-store]");
  await page.waitForTimeout(500);
  const restored = await where();
  rec("unskip-restores", restored["qa-aldi"]?.includes("zzqapple") && restored["qa-aldi"]?.includes("zzqbread"), JSON.stringify(restored));

  rec("no-page-errors", !pageErrs.length, pageErrs.join(" | ") || "none");
} finally {
  await browser.close();
  if (hadFile) copyFileSync(BACKUP, FILE);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
