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
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, openSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Same robust launch as scripts/check-boot.mjs (see PAPERCUTS.md 2026-09-20): a
// pinned Playwright version's own managed-Chromium resolution can miss a cloud
// sandbox's pre-staged browser (different revision, reachable only via the
// stable $PLAYWRIGHT_BROWSERS_PATH/chromium symlink), and Chromium there can
// inherit an HTTPS_PROXY env var that breaks even localhost navigation.
async function launchChromium() {
  const args = ["--no-proxy-server", "--proxy-bypass-list=*"];
  try { return await chromium.launch({ channel: "chrome", headless: true, args }); } catch { /* not installed here */ }
  try { return await chromium.launch({ headless: true, args }); } catch { /* not installed for this Playwright version */ }
  const sandboxChrome = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(sandboxChrome)) return await chromium.launch({ headless: true, args, executablePath: sandboxChrome });
  throw new Error(`No usable Chromium found (tried system Chrome, Playwright-managed Chromium, and ${sandboxChrome}).`);
}

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
  // A members-bearing meal-plan config so the planner renders real slots
  // (recomputeMealPlanLayout builds meal keys as `${member.label} ${type.label}`).
  // Without a member, meals=[] → an empty planner with no controls (the vacuous trap).
  mealPlanConfig: {
    members: [{ id: "member-qa", label: "QA", dob: "", linkedUserId: null }],
    mealTypes: [
      { id: "mealtype-breakfast", label: "Breakfast" },
      { id: "mealtype-lunch", label: "Lunch" },
      { id: "mealtype-dinner", label: "Dinner" },
    ],
    notifView: "list",
  },
  plans: {}, // fresh weeks so entry counts start from zero
  // A recipe with a distinctive ingredient (NOT in the grocery catalog), so a
  // recipe-backed meal entry opens a recipe view with a servings adjuster (mp-serving) and shows up
  // in the plan→grocery derivation (mp-grocery). Recipes read from state.recipes.
  recipes: [{
    id: "recipe-qa", name: "QA Test Recipe", servings: 2,
    ingredients: [{ item: "QA-INGREDIENT-XYZ", quantity: "1", amount: "cup", prep: "" }],
  }],
};
writeFileSync(STATE_FILE, JSON.stringify(seed, null, 2) + "\n");

// ---- spawn the isolated, guarded stack ----
const children = [];
function freePorts() {
  for (const p of [API_PORT, VITE_PORT]) { try { execSync(`lsof -ti:${p} | xargs -r kill -9`, { stdio: "ignore" }); } catch { /* none / no lsof */ } }
}
function spawnProc(cmd, args, env, logName) {
  const fd = openSync(join(TMP, logName), "a"); // capture stdout+stderr for diagnosis
  const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", fd, fd] });
  children.push(child);
  return child;
}
// Require the URL to respond OK several times IN A ROW before declaring readiness —
// a single hit can catch a dying previous-run server, after which strictPort Vite
// fails to bind and the browser gets ECONNREFUSED.
async function waitFor(url, label, tries = 220) { // ~110s; Vite cold-start can be ~40s under load
  let streak = 0;
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) { if (++streak >= 4) return true; } else streak = 0; }
    catch { streak = 0; }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not become ready at ${url} (see ${TMP})`);
}
function teardown() {
  for (const c of children) { try { process.kill(-c.pid, "SIGKILL"); } catch { try { c.kill("SIGKILL"); } catch {} } }
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
}

const BENIGN = [/failed to load resource/i, /\b(400|401|403|404|429|500|502|503)\b/i, /supabase|net::err|networkerror/i, /manifest|favicon/i];
async function settleBoot(page) {
  // Generous: the first boot pays the cold Vite compile of the ~42k-line app.js,
  // which under machine load can take a couple of minutes.
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), { timeout: 180000 });
  await page.waitForTimeout(1200);
  await page.waitForFunction(() => { const o = document.getElementById("hydrationOverlay"); return !o || o.hidden || o.offsetParent === null; }, { timeout: 45000 }).catch(() => {});
  // setupDiagnostics (which installs window.__liveQA) can run a beat after app-authed;
  // every check uses the seam, so wait for it before returning.
  await page.waitForFunction(() => !!window.__liveQA, { timeout: 60000 });
  await page.waitForTimeout(1200);
}
// Pay the cold Vite dev-compile cost ONCE up front so the real check contexts boot
// fast and none of them races a compile-under-load timeout.
async function warmVite(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(180000);
  try {
    await page.goto(BASE_URL, { waitUntil: "load", timeout: 180000 });
    await page.waitForFunction(() => !!(window.__liveQA) || document.body.classList.contains("app-authed"), { timeout: 180000 }).catch(() => {});
  } catch { /* warmup is best-effort — the real contexts retry goto */ } finally { await ctx.close(); }
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
  for (let attempt = 0; ; attempt++) {
    try { await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 120000 }); break; }
    catch (e) { if (attempt >= 3) throw e; await new Promise((r) => setTimeout(r, 3000)); } // ECONNREFUSED race under load
  }
  await settleBoot(page);
  return { context, page };
}
const pageErrs = [];
const consoleErrs = [];

let browser;
try {
  freePorts(); // clear any lingering server/vite from a prior run so strictPort can bind
  spawnProc("node", ["server.js"], { PORT: String(API_PORT), EAT_DATA_DIR: DATA_DIR, EAT_BACKUP_DIR: BACKUP_DIR, QA_STATE_GUARD: "1" }, "server.log");
  spawnProc("npx", ["vite", "--port", String(VITE_PORT), "--strictPort"], { API_PORT: String(API_PORT) }, "vite.log");
  await waitFor(`http://localhost:${API_PORT}/api/state`, "guarded API");
  await waitFor(BASE_URL, "Vite");

  browser = await launchChromium();
  await warmVite(browser); // absorb the cold-compile cost once, before the real checks

  // ========== fin-cat-2dev / fin-txn-2dev — multi-writer stale-tab stomp ==========
  // Context A holds the good finance and adds a distinctive marker; Context B is a
  // stale/never-hydrated tab that blind-writes empty finance. The empty-never-erases
  // guard (prod DB-trigger analog, QA_STATE_GUARD=1) must stop B from wiping A.
  {
    const A = await newDevContext(browser);
    // Wait until the seeded category is actually present in A's in-memory finance
    // (the financeSectionHydrated flag can flip true a beat before the merge lands,
    // so poll the real value) — else A would append its marker over an empty set and
    // drop SEED-CAT. Then add the marker and FORCE the write before B's stale write.
    await A.page.waitForFunction(() => (window.__liveQA.financeMarkers()?.categoryNames || []).includes("SEED-CAT"), { timeout: 30000 }).catch(() => {});
    const aMem = await A.page.evaluate(async () => {
      window.__liveQA.addFinanceCategory("fin-group-needs", "cat-A", "MARKER-A");
      const mem = window.__liveQA.financeMarkers().categoryNames;
      await window.__liveQA.persistNow();
      return mem;
    });
    await A.page.waitForTimeout(600);
    const aFile = (readState().financeBudgetGroups || []).flatMap((g) => (g.categories || []).map((c) => c.name));
    const B = await newDevContext(browser);
    // Let B fully hydrate first (so its later boot-hydrate persist can't race), THEN
    // it simulates a stale/never-hydrated finance tab that blind-writes empty finance.
    await B.page.waitForFunction(() => (window.__liveQA.financeMarkers()?.categoryNames || []).includes("SEED-CAT"), { timeout: 30000 }).catch(() => {});
    await B.page.evaluate(async () => { window.__liveQA.emptyFinanceInMemory(); await window.__liveQA.persistNow(); });
    await B.page.waitForTimeout(600);
    const f = readState();
    const catNames = (f.financeBudgetGroups || []).flatMap((g) => (g.categories || []).map((c) => c.name));
    const catSurvived = catNames.includes("MARKER-A") && catNames.includes("SEED-CAT");
    const txnSurvived = f.financeTxnLabels?.["txn-seed"] === "cat-seed" && f.financeMerchantNames?.["txn-seed"] === "SEED-MERCHANT";
    rec("fin-cat-2dev", catSurvived ? "PASS" : "FAIL",
      `two contexts, one stale/empty writer: A+seed categories SURVIVED B's blind empty-finance write. [A-mem-after-add=${JSON.stringify(aMem)}, A-file=${JSON.stringify(aFile)}, final=${JSON.stringify(catNames)}]`);
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

  // ========== meal-plan end-to-end flows (members-seeded planner) ==========
  // The fixture seeds a member ("QA") so recomputeMealPlanLayout renders real slots.
  // Each flow is driven through the REAL DOM handlers and asserted via __liveQA.mpState.
  // Anything that can't find its control / doesn't actually move state is reported as
  // NOT automated (not shipped as a vacuous pass).
  {
    const M = await newDevContext(browser);
    // A fresh Playwright context boots with empty localStorage → boot-empty config
    // with no members → empty planner. Inject a member deterministically via the
    // seam (real recomputeMealPlanLayout + persist), THEN open the planner.
    await M.page.evaluate(() => window.__liveQA.ensureMealMember());
    await M.page.waitForTimeout(400);
    await M.page.evaluate(() => { try { document.getElementById("homeEatBtn")?.click(); } catch {} });
    await M.page.waitForTimeout(2000);
    const diag = await M.page.evaluate(() => {
      const grid = document.getElementById("plannerGrid");
      const eat = document.getElementById("eatMainPage");
      return {
        eatHidden: eat ? String(eat.hidden) : "no-eatMainPage",
        gridVisible: !!grid && grid.offsetParent !== null,
        gridHtmlLen: grid ? grid.innerHTML.length : 0,
        slotCards: document.querySelectorAll("#plannerGrid .slot-card").length,
        mealSlots: document.querySelectorAll("#plannerGrid [data-meal-slot]").length,
        st: window.__liveQA.mpState(),
      };
    });
    const boot = { slots: await M.page.evaluate(() => document.querySelectorAll("#plannerGrid [data-meal-input]").length), st: diag.st };

    // ----- mp-settings: independent of planner slots (uses the settings dialog) -----
    {
      const setRes = await M.page.evaluate(() => {
        const before = window.__liveQA.mpState().mealKeys.length;
        document.getElementById("openMealPlanSettingsBtn")?.click();
        return { before, dialogOpen: !!document.getElementById("mealPlanSettingsDialog")?.open };
      });
      await M.page.waitForTimeout(400);
      if (!setRes.dialogOpen) {
        rec("mp-settings", "SKIP", `#openMealPlanSettingsBtn did not open the settings dialog headless — NOT automated (not shipped vacuous).`);
      } else {
        await M.page.evaluate(() => {
          document.getElementById("addMealTypeBtn")?.click();
          const rows = document.querySelectorAll("#mealPlanSettingsDialog [data-mealtype-row]");
          const input = rows[rows.length - 1]?.querySelector("input");
          if (input) { input.value = "QA-Snack"; input.dispatchEvent(new Event("input", { bubbles: true })); }
          document.getElementById("saveMealTypesBtn")?.click();
        });
        await M.page.waitForTimeout(700);
        const afterSet = await M.page.evaluate(() => window.__liveQA.mpState().mealKeys.length);
        rec("mp-settings", afterSet > setRes.before ? "PASS" : "SKIP",
          afterSet > setRes.before
            ? `added a meal type ("QA-Snack") + saved via the settings dialog → mealKeys ${setRes.before} → ${afterSet} (saveMealPlanMealTypes → recomputeMealPlanLayout).`
            : `settings dialog opened but the add+save didn't grow mealKeys (${setRes.before} → ${afterSet}) — pulled rather than pass vacuously.`);
      }
    }

    if (!diag.mealSlots) {
      rec("mp-add", "FAIL", `planner rendered NO meal slots headless — eatHidden=${diag.eatHidden}, gridVisible=${diag.gridVisible}, gridHtmlLen=${diag.gridHtmlLen}, slotCards=${diag.slotCards}, members=${JSON.stringify(diag.st?.members)}, mealKeys=${diag.st?.mealKeys?.length ?? "?"}. Pulled rather than pass vacuously.`);
    } else {
      // --- mp-add: an empty slot's add affordance is the pick-group (recipe / ingredient
      // / Out / Leftovers), NOT a text input. Click "Leftovers" (adds a special-meal
      // entry directly, no recipe fixture needed) → setSpecialMealEntry → entry committed.
      const before = boot.st.entryCount;
      const add = await M.page.evaluate(() => {
        const btn = document.querySelector('#plannerGrid [data-special-meal-choice="leftovers"]');
        if (!btn) return { found: false };
        btn.click();
        return { found: true, day: btn.dataset.day, meal: btn.dataset.meal };
      });
      await M.page.waitForTimeout(600);
      const afterAdd = await M.page.evaluate(() => window.__liveQA.mpState());
      if (!add.found) {
        rec("mp-add", "FAIL", `no [data-special-meal-choice] add affordance in the rendered slots — pulled.`);
      } else {
        rec("mp-add", afterAdd.entryCount > before ? "PASS" : "FAIL",
          `clicked "Leftovers" on a real empty planner slot (${add.day}/${add.meal}) → entryCount ${before} → ${afterAdd.entryCount} (setSpecialMealEntry).`);
      }

      // Place a RECIPE-backed entry (seeded recipe "recipe-qa" with a distinctive
      // ingredient) into the first slot, so recipe-only affordances light up.
      const placed = await M.page.evaluate(() => {
        const slot = document.querySelector("#plannerGrid [data-meal-slot]");
        if (!slot) return null;
        const r = window.__liveQA.mpAddRecipeEntry(slot.dataset.day, slot.dataset.meal, "recipe-qa");
        return r && { ...r, day: slot.dataset.day, meal: slot.dataset.meal };
      });
      await M.page.waitForTimeout(800);

      // --- mp-serving (2026-09-26, per Luke): servings are NOT shown on meal-plan
      // cards any more -- they're adjusted inside the recipe view opened from the
      // meal, which writes back to the entry's plannedServings via
      // updateMealPlannedServingsFromContext. Assert both halves: (1) the card has
      // no servings text/input, (2) the recipe view's [data-serving-adjuster] starts
      // at the recipe default and changing it moves the STATE (mpPlannedServings
      // reads the raw entry back), not just the redisplayed value.
      const servCard = await M.page.evaluate(() => {
        const btn = document.querySelector("#plannerGrid [data-view-recipe][data-day]");
        const entry = btn?.closest("[data-meal-entry]");
        return btn && {
          day: btn.dataset.day, meal: btn.dataset.meal, index: Number(btn.dataset.index),
          cardShowsServings: !!entry && (/serving/i.test(entry.textContent) || !!entry.querySelector("input[type=number]")),
        };
      });
      if (!servCard) {
        rec("mp-serving", "FAIL", `recipe entry placed=${!!placed} but no [data-view-recipe] meal-entry button rendered -- pulled rather than pass vacuously.`);
      } else {
        await M.page.click(`#plannerGrid [data-view-recipe][data-day="${servCard.day}"][data-meal="${servCard.meal}"][data-index="${servCard.index}"]`);
        await M.page.waitForSelector("#recipeViewHeaderActions [data-serving-adjuster]", { timeout: 3000 }).catch(() => {});
        const changed = await M.page.evaluate((sb) => {
          const input = document.querySelector("#recipeViewHeaderActions [data-serving-adjuster]");
          if (!input) return { found: false };
          const before = { value: input.value, state: window.__liveQA.mpPlannedServings(sb.day, sb.meal, sb.index) };
          input.value = "4";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          const after = window.__liveQA.mpPlannedServings(sb.day, sb.meal, sb.index);
          document.querySelector("#recipeViewDialog")?.close();
          return { found: true, before, after };
        }, servCard);
        const noCardServings = !servCard.cardShowsServings;
        const defaultOk = changed.found && changed.before.value === "2" && changed.before.state === 2; // recipe-qa servings=2
        const scaledOk = changed.found && changed.after === 4;
        rec("mp-serving", noCardServings && defaultOk && scaledOk ? "PASS" : "FAIL",
          `card shows servings=${servCard.cardShowsServings} (want false). Recipe view adjuster found=${changed.found}, initial "${changed.before?.value}"/state=${changed.before?.state} (want "2"/2) -- ${defaultOk ? "matched" : "MISMATCH"}; set to 4 → state=${changed.after} (want 4) -- ${scaledOk ? "matched" : "MISMATCH"}.`);
      }

      // --- mp-grocery: the seeded recipe's ingredient must appear in the plan→grocery
      // derivation. buildRawGroceryRows normalizes/title-cases the item name, so match
      // the distinctive token rather than the raw seed string.
      const groc = await M.page.evaluate(() => window.__liveQA.mpUnlistedGroceryItems());
      const grocOk = Array.isArray(groc) && groc.some((g) => /xyz/i.test(g));
      rec("mp-grocery", grocOk ? "PASS" : (placed ? "FAIL" : "SKIP"),
        `plan→grocery derivation (unlistedGroceryItemsForWeek → buildRawGroceryRows) surfaced the planned recipe's ingredient: ${JSON.stringify(groc)} (distinctive token present=${grocOk}).`);

      // --- mp-drag: synthetic pointer-drag the recipe entry to another meal slot ---
      const dragRes = await M.page.evaluate(async () => {
        const row = document.querySelector("#plannerGrid [data-meal-entry]");
        const slots = [...document.querySelectorAll("#plannerGrid [data-meal-slot]")];
        const target = slots.find((s) => row && (s.dataset.meal !== row.dataset.meal || s.dataset.day !== row.dataset.day));
        if (!row || !target) return { found: false };
        const srcMeal = row.dataset.meal, srcDay = row.dataset.day;
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
        const rb = row.getBoundingClientRect(), tb = target.getBoundingClientRect();
        // Interpolate CENTER-to-CENTER throughout -- the original code interpolated
        // toward the target's top-left corner (tb.x/tb.y) for every intermediate move
        // but only the final pointerup used the center (tb.x+width/2, tb.y+height/2).
        // The corner often lands on the slot's header/label/button chrome rather than
        // its open content area, so elementFromPoint kept resolving back to whatever
        // was under that edge instead of the target slot's own empty drop area.
        const rcx = rb.x + rb.width / 2, rcy = rb.y + rb.height / 2;
        const tcx = tb.x + tb.width / 2, tcy = tb.y + tb.height / 2;
        // pointerType MUST be "mouse" -- sortable.js's gesture classifier
        // (preActivationOutcome, sortable-core.js) branches on it: anything
        // other than "mouse"/"pen" is treated as a TOUCH gesture with only a
        // 9px tolerance before canceling as a scroll, vs. a 5px mouse-drag
        // activation threshold. A bare PointerEvent defaults pointerType to
        // "", which silently fell into the touch/cancel branch on the very
        // first move -- this is why the drag "never crossed the threshold".
        const fire = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0 }));
        const raf = () => new Promise((r) => requestAnimationFrame(r));
        fire(row, "pointerdown", rcx, rcy);
        // sortable.js's actual reorder (reorderToPointer, setting g.reordered) runs
        // from a requestAnimationFrame loop started by activate() on the FIRST move
        // past threshold -- not synchronously inside the pointermove handler. Firing
        // all moves back-to-back in one synchronous burst (the original code) never
        // let that rAF loop run even once before pointerup tore the drag down, so
        // g.reordered stayed false and the drop was silently a no-op. Yield a real
        // animation frame after each move so the loop actually processes the position.
        for (let i = 1; i <= 8; i++) {
          fire(document, "pointermove", rcx + (tcx - rcx) * i / 8, rcy + (tcy - rcy) * i / 8);
          await raf();
        }
        await raf(); // one more frame at the final position before releasing
        fire(target, "pointerup", tcx, tcy);
        await new Promise((r) => setTimeout(r, 60));
        return { found: true, srcDay, srcMeal, dstDay: target.dataset.day, dstMeal: target.dataset.meal };
      });
      await M.page.waitForTimeout(500);
      if (!dragRes.found) {
        rec("mp-drag", "SKIP", `no draggable entry + distinct target slot available — NOT automated here.`);
      } else {
        const moved = await M.page.evaluate(() => {
          const row = document.querySelector("#plannerGrid [data-meal-entry]");
          return { nowDay: row?.dataset.day, nowMeal: row?.dataset.meal, entryCount: window.__liveQA.mpState().entryCount };
        });
        const didMove = moved.nowMeal !== dragRes.srcMeal || moved.nowDay !== dragRes.srcDay;
        rec("mp-drag", didMove ? "PASS" : "SKIP",
          didMove
            ? `synthetic pointer-drag moved the entry ${dragRes.srcDay}/${dragRes.srcMeal} → ${moved.nowDay}/${moved.nowMeal} (onGroupedDrop → moveMealEntryToSlot).`
            : `synthetic pointer-drag did NOT cross the custom makeSortable threshold headless (entry still at ${moved.nowDay}/${moved.nowMeal}) — pulled rather than pass vacuously; the move logic (reorderMealEntry/moveMealEntryToSlot) is a factory-closure handler not reachable via the seam.`);
      }

      // --- mp-publish: REMOVED, not skipped. toggleMealPlanView (the only writer of
      // mealPlanView="published" from a live user action) had zero call sites and no
      // DOM trigger anywhere -- confirmed dead code, deleted 2026-09-20 along with its
      // exclusive helper archivePublishedWeek. The backup-restore path
      // (mergeMissingPublishedWeeksFromRestore) is untouched: a restored week can still
      // carry mealPlanView="published" and still renders read-only correctly via
      // isPublishedMealPlanView/the readOnly template branches, which are NOT dead (they
      // serve that restore path) and were deliberately left alone. There is no longer a
      // "publish" action for this item to check -- see ISSUES.md history for the audit trail.

      // --- mp-cards: the meal-plan recipe SUGGESTION deck (getMealPlanRecipes) is
      // normally populated by warmMealPlanRecipes() fetching Gmail's "pendingRecipes"
      // over the network. The backing `let mealPlanRecipes` (app.js:1499) turned out to
      // be a plain app.js-scope variable, not buried in the mealplan factory closure as
      // first assumed -- getMealPlanRecipes/setMealPlanRecipes themselves are just
      // inline arrow-function VALUES inside the deps object passed to
      // createMealplanModule, not standalone callable functions, so __liveQA.mpSetSuggestions
      // (app.js) assigns the variable directly, the same shortcut mpAddRecipeEntry
      // already takes for a picked recipe, then the real bell-click + dismiss-click flow is driven.
      const cardsRes = await M.page.evaluate(() => {
        const count = window.__liveQA.mpSetSuggestions([
          { url: "https://example.com/qa-recipe-1", title: "QA Suggested Recipe One", source: "example.com" },
          { url: "https://example.com/qa-recipe-2", title: "QA Suggested Recipe Two", source: "example.com" },
        ]);
        return { count };
      });
      await M.page.waitForTimeout(300);
      const bellFound = await M.page.evaluate(() => !!document.querySelector("[data-eat-notif-toggle]"));
      if (bellFound) await M.page.click("[data-eat-notif-toggle]");
      await M.page.waitForTimeout(400);
      const deckState = await M.page.evaluate(() => ({
        cardCount: document.querySelectorAll(".eat-swipe-card").length,
        firstTitle: document.querySelector(".eat-swipe-title")?.textContent || null,
      }));
      let dismissedCount = null;
      if (deckState.cardCount) {
        // CSS.escape is a browser API -- build + click the selector inside the page,
        // not in this Node script's own scope.
        const dismissed = await M.page.evaluate(() => {
          const btn = document.querySelector(".eat-swipe-card [data-eat-notif-dismiss]");
          if (!btn) return false;
          btn.click();
          return true;
        });
        if (dismissed) {
          await M.page.waitForTimeout(300);
          dismissedCount = await M.page.evaluate(() => document.querySelectorAll(".eat-swipe-card").length);
        }
      }
      if (!bellFound || !deckState.cardCount) {
        rec("mp-cards", "FAIL", `seeded ${cardsRes.count} suggestions via __liveQA.mpSetSuggestions but the deck didn't render — bellFound=${bellFound}, cardCount=${deckState.cardCount}. Pulled rather than pass vacuously.`);
      } else {
        const dismissOk = dismissedCount === 1; // started at 2, one dismissed
        rec("mp-cards", dismissOk ? "PASS" : "PARTIAL",
          `seeded 2 suggestions (__liveQA.mpSetSuggestions), opened the bell (data-eat-notif-toggle) → ${deckState.cardCount} cards rendered (first title="${deckState.firstTitle}"), dismissed one → ${dismissedCount} remaining (dismissMealPlanRecipe). ${dismissOk ? "" : "Dismiss count unexpected — investigate before trusting this path."}`);
      }
    }
    await M.context.close();
  }

  rec("no-js-errors", pageErrs.length === 0 ? "PASS" : "FAIL", `uncaught page errors across the extended run: ${pageErrs.length}${pageErrs.length ? " → " + pageErrs.slice(0, 3).join(" | ") : ""}`);
  if (consoleErrs.length) console.log(`  (note: ${consoleErrs.length} non-benign console.error — ${consoleErrs.slice(0, 2).join(" | ")})`);
} finally {
  if (browser) await browser.close();
  teardown();
  console.log("\n(isolated stack torn down; your data + session untouched)");
}

const sym = (s) => (s === "PASS" ? "✓" : s === "SKIP" ? "–" : s === "PARTIAL" ? "~" : "✗");
console.log("\n============== EXTENDED SUMMARY ==============");
for (const r of results) console.log(`  ${sym(r.status)} ${r.id}: ${r.status}`);
const failed = results.filter((r) => r.status === "FAIL");
const skipped = results.filter((r) => r.status === "SKIP");
console.log(`\n${failed.length ? "❌ " + failed.length + " FAILED" : "✅ ALL EXTENDED CHECKS PASSED"} (${results.filter((r) => r.status === "PASS").length} passed, ${skipped.length} not-automated/skipped, ${results.length} total)`);
process.exit(failed.length ? 1 : 0);
