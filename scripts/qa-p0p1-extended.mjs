// Extended P0/P1 checklist runner — the harder-to-automate items the base
// qa-p0p1.mjs left manual. Unlike the base runner (which needs your dev:local up
// and seeds your real data file), this one is FULLY SELF-CONTAINED and ISOLATED:
// it spawns its own guarded backend (server.js with QA_STATE_GUARD=1 on an alt
// port + a throwaway data dir) and its own Vite (alt port, proxying to it), runs
// the checks against real browser contexts, then tears the stack down. It never
// touches your running session, your data/tableplan-state.json, or your backups.
//
//   npm run qa:p0p1-extended
//
// Items covered here (see the per-item report at the end):
//   • fin-cat-2dev / fin-txn-2dev — multi-writer stale-tab stomp (two contexts +
//     the local empty-never-erases guard that replicates the prod DB trigger)
//   • fin-guard-api — direct-API teeth check that the guard (not luck) held
//   • mp-autogen — boot-empty regenerate-default-rules-with-new-ids dedupe-by-
//     signature protection, asserted deterministically through the seam
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API_PORT = 4176;
const VITE_PORT = 4189;
const ROOT = process.cwd();
const TMP = mkdtempSync(join(tmpdir(), "qa-ext-"));
const DATA_DIR = join(TMP, "data");
const BACKUP_DIR = join(TMP, "backups");
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(BACKUP_DIR, { recursive: true });
const STATE_FILE = join(DATA_DIR, "tableplan-state.json");
const BASE_URL = `http://localhost:${VITE_PORT}/`;

const results = [];
const rec = (id, status, detail) => { results.push({ id, status, detail }); console.log(`  [${status}] ${id} — ${detail}`); };
const readState = () => { try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return {}; } };

// ---- build an isolated seed state (finance markers + empty auto-rules) ----
// Base it on the real fixture's SHAPE (read-only) so normalizers see a plausible
// state, then overlay distinctive finance markers a stale writer must not wipe.
let base = {};
try { base = JSON.parse(readFileSync(join(ROOT, "data/tableplan-state.json"), "utf8")); } catch { /* fresh */ }
const seed = {
  ...base,
  stateUpdatedAt: new Date().toISOString(),
  financeBudgetGroups: [
    { id: "fin-group-needs", label: "Needs", idealPct: 50, categories: [{ id: "cat-seed", name: "SEED-CAT", activeItemId: "", items: [] }] },
    { id: "fin-group-wants", label: "Wants", idealPct: 30, categories: [] },
    { id: "fin-group-savings", label: "Savings", idealPct: 20, categories: [] },
  ],
  financeAccounts: [{ id: "acct-seed", name: "SEED-CHK", kind: "checking", manualBalance: 1000 }],
  financeCashAccountIds: ["acct-seed"],
  financeManualTxns: [{ id: "txn-seed", description: "SEED-TXN", amount: -25, posted: "2026-09-05", account: "acct-seed" }],
  financeTxnLabels: { "txn-seed": "cat-seed" },
  financeMerchantNames: { "txn-seed": "SEED-MERCHANT" },
  financeRecurring: [{ id: "rec-seed", name: "SEED-BILL", amount: 40, dayOfMonth: 15, lastAmount: 40 }],
  autoGenerateRules: [], // force each fresh context to regenerate defaults (mp-autogen)
};
writeFileSync(STATE_FILE, JSON.stringify(seed, null, 2) + "\n");

// ---- spawn the isolated, guarded stack ----
const children = [];
function spawnProc(cmd, args, env) {
  const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, detached: true, stdio: "ignore" });
  children.push(child);
  return child;
}
async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not become ready at ${url}`);
}
function teardown() {
  for (const c of children) { try { process.kill(-c.pid, "SIGKILL"); } catch { try { c.kill("SIGKILL"); } catch {} } }
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
}

const BENIGN = [/failed to load resource/i, /\b(400|401|403|404|429|500|502|503)\b/i, /supabase|net::err|networkerror/i, /manifest|favicon/i];
async function settleBoot(page) {
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), { timeout: 45000 });
  await page.waitForTimeout(1200);
  await page.waitForFunction(() => { const o = document.getElementById("hydrationOverlay"); return !o || o.hidden || o.offsetParent === null; }, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1200);
}
async function newDevContext(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Cold Vite dev-compile of the ~42k-line app.js + module graph can take well over
  // the 30s default on a loaded machine; be generous (subsequent loads are cached/fast).
  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(120000);
  page.on("pageerror", (e) => pageErrs.push(String(e.message || e)));
  page.on("console", (m) => { if (m.type() === "error" && !BENIGN.some((re) => re.test(m.text()))) consoleErrs.push(m.text()); });
  await context.addInitScript(() => { try { localStorage.setItem("live_local_dev", "1"); } catch {} });
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  await settleBoot(page);
  return { context, page };
}
const pageErrs = [];
const consoleErrs = [];

let browser;
try {
  spawnProc("node", ["server.js"], { PORT: String(API_PORT), EAT_DATA_DIR: DATA_DIR, EAT_BACKUP_DIR: BACKUP_DIR, QA_STATE_GUARD: "1" });
  spawnProc("npx", ["vite", "--port", String(VITE_PORT), "--strictPort"], { API_PORT: String(API_PORT) });
  await waitFor(`http://localhost:${API_PORT}/api/state`, "guarded API");
  await waitFor(BASE_URL, "Vite");

  browser = await chromium.launch({ channel: "chrome", headless: true });

  // ========== fin-cat-2dev / fin-txn-2dev — multi-writer stale-tab stomp ==========
  // Context A holds the good finance and adds a distinctive marker; Context B is a
  // stale/never-hydrated tab that blind-writes empty finance. The empty-never-erases
  // guard (prod DB-trigger analog, QA_STATE_GUARD=1) must stop B from wiping A.
  {
    const A = await newDevContext(browser);
    // A adds a marker through the real persist path.
    await A.page.evaluate(() => window.__liveQA.addFinanceCategory("fin-group-needs", "cat-A", "MARKER-A"));
    await A.page.waitForTimeout(400);
    const B = await newDevContext(browser);
    // B simulates a stale/never-hydrated finance tab and blind-writes it.
    await B.page.evaluate(async () => { window.__liveQA.emptyFinanceInMemory(); await window.__liveQA.persistNow(); });
    await B.page.waitForTimeout(400);
    const f = readState();
    const catNames = (f.financeBudgetGroups || []).flatMap((g) => (g.categories || []).map((c) => c.name));
    const catSurvived = catNames.includes("MARKER-A") && catNames.includes("SEED-CAT");
    const txnSurvived = f.financeTxnLabels?.["txn-seed"] === "cat-seed" && f.financeMerchantNames?.["txn-seed"] === "SEED-MERCHANT";
    rec("fin-cat-2dev", catSurvived ? "PASS" : "FAIL",
      `two contexts, one stale/empty writer: A's budget category (MARKER-A) + seed category SURVIVED B's blind empty-finance write (categories=${JSON.stringify(catNames)}). Empty-never-erases guard (prod DB-trigger analog) held.`);
    rec("fin-txn-2dev", txnSurvived ? "PASS" : "FAIL",
      `same stale-writer scenario: txn label + merchant-rename SURVIVED (label kept=${f.financeTxnLabels?.["txn-seed"] === "cat-seed"}, merchant kept=${f.financeMerchantNames?.["txn-seed"] === "SEED-MERCHANT"}).`);
    await A.context.close();
    await B.context.close();
  }

  // Direct-API teeth check: prove the guard (not luck) is what held — a raw PUT of
  // empty finance straight to the guarded backend must be refused the erase.
  {
    const cur = readState();
    await fetch(`http://localhost:${API_PORT}/api/state`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: { ...cur, financeBudgetGroups: [], financeTxnLabels: {} } }),
    });
    const after = readState();
    const held = (after.financeBudgetGroups || []).length > 0 && Object.keys(after.financeTxnLabels || {}).length > 0;
    rec("fin-guard-api", held ? "PASS" : "FAIL",
      `direct empty-finance PUT to the guarded backend was refused the erase (groups kept=${(after.financeBudgetGroups || []).length > 0}, labels kept=${Object.keys(after.financeTxnLabels || {}).length > 0}) — confirms the guard has teeth, not luck.`);
  }

  // ========== mp-autogen — boot-empty regenerate-default-rules dedup protection ==========
  // The vector: a boot-empty client regenerates the DEFAULT auto-rules with NEW ids
  // (normalizeAutoGenerateRules([]) → defaultAutoGenerateRules()), then merges the
  // cloud's copy. The protection is mergeStates → dedupeAutoGenerateRules, which
  // collapses rules by SIGNATURE (slot+action), so the reissued ids don't double the
  // set. The end-to-end regen is hard to force reliably (meals derive from config
  // members, rebuilt on a boot-order-sensitive path), so we assert the actual
  // protection deterministically through the seam: two rules identical but for id
  // must collapse to one; a genuinely different rule must NOT.
  {
    const P = await newDevContext(browser);
    const r = await P.page.evaluate(() => {
      const cloud = { id: "cloud-1", dayIds: ["friday-start"], meal: "Luke Dinner", index: 0, action: "skip" };
      const regen = { ...cloud, id: "regen-1" };            // same signature, NEW id (the reissue)
      const different = { ...cloud, id: "regen-2", action: "prep" }; // different action → different signature
      return {
        sameSig: window.__liveQA.autoRuleSig(cloud) === window.__liveQA.autoRuleSig(regen),
        diffSig: window.__liveQA.autoRuleSig(cloud) !== window.__liveQA.autoRuleSig(different),
        dedupReissue: window.__liveQA.dedupeAutoRules([cloud, regen]).length,   // must collapse to 1
        keepDistinct: window.__liveQA.dedupeAutoRules([cloud, different]).length, // must stay 2
        sig: window.__liveQA.autoRuleSig(cloud),
      };
    });
    const ok = r.sameSig && r.diffSig && r.dedupReissue === 1 && r.keepDistinct === 2 && !!r.sig;
    rec("mp-autogen", ok ? "PASS" : "FAIL",
      `regenerate-default-with-new-ids protection: a rule + its id-reissue share a signature (${r.sameSig}) and dedupe to ${r.dedupReissue} (want 1); a genuinely different rule keeps its own signature (${r.diffSig}) and survives as ${r.keepDistinct} (want 2). This is the exact mergeStates dedupe that stops the boot-empty regen from doubling the rule set.`);
    await P.context.close();
  }

  rec("no-js-errors", pageErrs.length === 0 ? "PASS" : "FAIL", `uncaught page errors across the extended run: ${pageErrs.length}${pageErrs.length ? " → " + pageErrs.slice(0, 3).join(" | ") : ""}`);
  if (consoleErrs.length) console.log(`  (note: ${consoleErrs.length} non-benign console.error — ${consoleErrs.slice(0, 2).join(" | ")})`);
} finally {
  if (browser) await browser.close();
  teardown();
  console.log("\n(isolated stack torn down; your data + session untouched)");
}

console.log("\n============== EXTENDED SUMMARY ==============");
for (const r of results) console.log(`  ${r.status === "PASS" ? "✓" : r.status === "PARTIAL" ? "~" : "✗"} ${r.id}: ${r.status}`);
const failed = results.filter((r) => r.status === "FAIL");
console.log(`\n${failed.length ? "❌ " + failed.length + " FAILED" : "✅ ALL EXTENDED CHECKS PASSED"} (${results.length} checks)`);
process.exit(failed.length ? 1 : 0);
