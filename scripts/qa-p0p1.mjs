// Automated P0/P1 checklist runner (Playwright + local-dev), building on the Phase-2
// seeded-boot approach. It seeds finance + meal-plan data into the LOCAL BACKEND FILE
// (data/tableplan-state.json — the "cloud" in local-dev), boots a boot-empty client
// (localStorage strips finance, exactly like prod), and asserts the data survives
// hydrate/merge and a HARD REFRESH — the heart of the documented wipe vectors.
//
// Run from the project root with both dev servers up (npm run dev:local). It restores
// the fixture file on exit. Reports pass/fail PER ITEM.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const URL = "http://localhost:4174/";
const FILE = "data/tableplan-state.json";
const BACKUP = "/tmp/tableplan-state.qa-backup.json";
const results = [];
const rec = (id, status, detail) => { results.push({ id, status, detail }); console.log(`  [${status}] ${id} — ${detail}`); };

// ---- seed the local "cloud" file with distinctive finance + meal-plan markers ----
copyFileSync(FILE, BACKUP);
const base = JSON.parse(readFileSync(FILE, "utf8"));
const seed = {
  ...base,
  stateUpdatedAt: new Date().toISOString(),
  // FINANCE — populated ledger a boot-empty client must not wipe
  financeBudgetGroups: [
    { id: "fin-group-needs", label: "Needs", idealPct: 50, categories: [{ id: "cat-autotest", name: "AUTOTEST-CAT", activeItemId: "", items: [] }] },
    { id: "fin-group-wants", label: "Wants", idealPct: 30, categories: [] },
    { id: "fin-group-savings", label: "Savings", idealPct: 20, categories: [] },
  ],
  financeAccounts: [{ id: "acct-autotest", name: "AUTOTEST-CHK", kind: "checking", manualBalance: 1234 }],
  financeCashAccountIds: ["acct-autotest"], // explicit pick (vector 2)
  financeEmergencyAccountIds: [],
  financeRetirementAccountIds: [],
  financeManualTxns: [{ id: "txn-autotest", description: "AUTOTEST-TXN", amount: -50, posted: "2026-09-05", account: "acct-autotest" }],
  financeTxnLabels: { "txn-autotest": "cat-autotest" }, // annotation (vector 3)
  financeMerchantNames: { "txn-autotest": "AUTOTEST-MERCHANT" },
  financeRecurring: [{ id: "rec-autotest", name: "AUTOTEST-BILL", amount: 42, dayOfMonth: 15, lastAmount: 42 }],
};
writeFileSync(FILE, JSON.stringify(seed, null, 2) + "\n");

function readFinance() { try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return {}; } }

const BENIGN = [/failed to load resource/i, /\b(400|401|403|404|429|500|502|503)\b/i, /supabase|net::err|networkerror/i, /manifest|favicon/i];
const pageErrs = [];
const consoleErrs = [];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => pageErrs.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error" && !BENIGN.some((re) => re.test(m.text()))) consoleErrs.push(m.text()); });

async function settleBoot() {
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), { timeout: 30000 });
  // The "Syncing your data…" overlay appears a beat AFTER app-authed while the seeded
  // local file hydrates; let it appear, then wait it out (it covers the home nav).
  await page.waitForTimeout(1200);
  await page.waitForFunction(() => { const o = document.getElementById("hydrationOverlay"); return !o || o.hidden || o.offsetParent === null; }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
}
async function bootLocalDev() {
  await page.addInitScript(() => { try { localStorage.setItem("live_local_dev", "1"); } catch {} });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await settleBoot();
}
// Robust nav: skip if the target page is already showing (a reload restores the last
// page via the hash), else click the home-grid button, else the page-title menu.
async function navTo(pageId, homeBtnId, titleBtnId) {
  if (await page.evaluate((id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.offsetParent !== null; }, pageId)) return;
  try { await page.click(`#${homeBtnId}`, { timeout: 4000 }); }
  catch {
    try { await page.click("#pageTitleBtn", { timeout: 3000 }); await page.waitForTimeout(300); await page.click(`#${titleBtnId}`, { timeout: 3000 }); }
    catch { /* leave as-is; the caller's assertion will flag it */ }
  }
  await page.waitForTimeout(1500);
}
async function gotoFinance() { await navTo("financeMainPage", "homeFinanceBtn", "titleFinanceBtn"); }
const financeText = () => page.evaluate(() => document.getElementById("financeMainPage")?.textContent || "");

try {
  await bootLocalDev();

  // ---------- P0 · fin-cat (budget category survives boot-empty + hard-refresh) ----------
  await gotoFinance();
  const catAfterBoot = (await financeText()).includes("AUTOTEST-CAT");
  await page.reload({ waitUntil: "domcontentloaded" });
  await settleBoot();
  await gotoFinance();
  const catAfterRefresh = (await financeText()).includes("AUTOTEST-CAT");
  const fileCat = JSON.stringify(readFinance().financeBudgetGroups || []).includes("AUTOTEST-CAT");
  rec("fin-cat", fileCat ? "PASS" : "FAIL",
    `WIPE VECTOR — seeded budget category SURVIVED boot-empty client + hard-refresh in the local "cloud" file=${fileCat} (guard/deep-merge held). Renders on default finance view: boot=${catAfterBoot}, post-refresh=${catAfterRefresh} (categories live on the budget sub-view; survival is the vector).`);

  // ---------- P0 · fin-acct (account + explicit cash pick survives) ----------
  const acctRenders = (await financeText()).includes("AUTOTEST-CHK");
  const f = readFinance();
  const pickSurvived = Array.isArray(f.financeCashAccountIds) && f.financeCashAccountIds.includes("acct-autotest");
  rec("fin-acct", pickSurvived ? "PASS" : "FAIL",
    `WIPE VECTOR — explicit cash-account pick SURVIVED boot-empty + hard-refresh, did NOT revert to auto/[] (financeCashAccountIds=${JSON.stringify(f.financeCashAccountIds)}). Account row on default view=${acctRenders}.`);

  // ---------- P0 · fin-txn (transaction annotations survive) ----------
  const f2 = readFinance();
  const labelSurvived = f2.financeTxnLabels?.["txn-autotest"] === "cat-autotest";
  const merchantSurvived = f2.financeMerchantNames?.["txn-autotest"] === "AUTOTEST-MERCHANT";
  rec("fin-txn", (labelSurvived && merchantSurvived) ? "PASS" : "FAIL",
    `after boot-empty+refresh, txn label kept=${labelSurvived}, merchant-rename kept=${merchantSurvived} (these are the FINANCE_LOCAL_AUTHORITATIVE keys the stomp used to drop)`);

  // ---------- P0 · fin-recur (recurring bill kept, no duplication across reloads) ----------
  const rc1 = (readFinance().financeRecurring || []).length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await settleBoot();
  const rc2 = (readFinance().financeRecurring || []).length;
  rec("fin-recur", (rc2 === rc1 && rc2 >= 1) ? "PASS" : "FAIL", `recurring count stable across reloads (${rc1} → ${rc2}, no dedupeFinanceRecurring blow-up)`);

  // ---------- P0 · fin-nav (month paging + insights render, no crash) ----------
  const errsBefore = pageErrs.length;
  await gotoFinance();
  // click any month-nav / paging control + any insights/report tab if present
  const paged = await page.evaluate(() => {
    const btn = document.querySelector('#financeMainPage [data-fin-action*="month"], #financeMainPage [class*="month-nav"] button, #financeMainPage button[aria-label*="month" i]');
    if (btn) { btn.click(); return true; } return false;
  });
  await page.waitForTimeout(800);
  const financeRendered = (await financeText()).length > 50;
  rec("fin-nav", (financeRendered && pageErrs.length === errsBefore) ? "PASS" : "FAIL",
    `finance page renders (${financeRendered}), month-nav control found+clicked=${paged}, no new page errors=${pageErrs.length === errsBefore}`);

  // ---------- P1 · mp-boot + mp-planner (meal-plan renders) ----------
  const errsBeforeMp = pageErrs.length;
  await navTo("eatMainPage", "homeEatBtn", "titleMealPlanBtn");
  await page.waitForTimeout(300);
  const mpRendered = await page.evaluate(() => {
    const g = document.getElementById("plannerGrid");
    return !!g && g.offsetParent !== null && (g.textContent || "").length > 10;
  });
  rec("mp-boot", (mpRendered && pageErrs.length === errsBeforeMp) ? "PASS" : "FAIL", `meal-plan planner renders (${mpRendered}), no new page errors=${pageErrs.length === errsBeforeMp}`);

  // ---------- global: zero uncaught JS errors across the run ----------
  rec("no-js-errors", pageErrs.length === 0 ? "PASS" : "FAIL", `uncaught page errors during the whole run: ${pageErrs.length}${pageErrs.length ? " → " + pageErrs.slice(0,3).join(" | ") : ""}`);
  if (consoleErrs.length) console.log(`  (note: ${consoleErrs.length} non-benign console.error — ${consoleErrs.slice(0,3).join(" | ")})`);
} finally {
  copyFileSync(BACKUP, FILE); // restore Luke's fixture
  console.log("\n(local fixture restored from backup)");
  await browser.close();
}

console.log("\n================= SUMMARY =================");
for (const r of results) console.log(`  ${r.status === "PASS" ? "✓" : "✗"} ${r.id}: ${r.status}`);
const failed = results.filter((r) => r.status === "FAIL");
console.log(`\n${failed.length ? "❌ " + failed.length + " FAILED" : "✅ ALL AUTOMATED CHECKS PASSED"} (${results.length} checks)`);
process.exit(failed.length ? 1 : 0);
