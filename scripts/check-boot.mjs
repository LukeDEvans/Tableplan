// Headless browser boot + smoke check for the Live/Tableplan PWA.
//
// Why this exists: app.js is a ~42k-line ESM shell whose module body only runs in a real
// browser (it needs a DOM + the sign-in gate). Several boot-order crashes (PLAN_COLORS TDZ,
// migrateLegacyRecipeOrganization TDZ, the recomputeMealPlanLayout sign-in hang) shipped
// silently because nothing in the unit suite executes that module body. This launches real
// Chromium against the dev server, watches the sign-in gate actually lift, and fails loudly —
// with the exact console/page-error output — if boot throws or hangs. It would have caught
// tonight's PLAN_COLORS / migrateLegacyRecipeOrganization bugs directly.
//
// Usage:  node scripts/check-boot.mjs [url]
//   url defaults to http://localhost:4174/ . The dev server must already be running
//   (npm run dev:local / dev.sh). Exit code 0 = pass, non-zero = fail.

import { chromium } from "playwright";

const URL = process.argv[2] || "http://localhost:4174/";
const BOOT_TIMEOUT_MS = 30000;
const NAV_SETTLE_MS = 1500;

// Console noise that is EXPECTED when booting against a dev server with no real Supabase
// session / offline backends. These are not boot bugs; everything else counts.
const BENIGN = [
  /state load failed with status/i,
  /shared storage unavailable/i,
  /local file storage unavailable/i,
  /failed to fetch/i,
  /networkerror|net::err|err_connection|err_internet/i,
  /the user aborted a request|aborterror/i,
  /\b(401|403|404|429|500|502|503)\b/,
  /supabase|auth session|no session|not authenticated/i,
  /favicon|manifest|service ?worker|serviceworker/i,
  /googleapis\.com|gstatic\.com|fonts?\b/i,
  /download the (react|vue) devtools/i,
];
const isBenign = (t) => BENIGN.some((re) => re.test(t));

// A page error (uncaught exception) is ALWAYS a failure — this is where a TDZ /
// ReferenceError lands ("Cannot access 'X' before initialization", "X is not defined").
const pageErrors = [];
const consoleErrors = []; // non-benign console.error / console.warn(level=error)
const allConsole = []; // full transcript, printed on failure

function fail(msg) {
  console.error(`\n✖ BOOT CHECK FAILED: ${msg}`);
  if (pageErrors.length) {
    console.error(`\n── Uncaught page errors (${pageErrors.length}) ──`);
    for (const e of pageErrors) console.error("  " + e.split("\n").slice(0, 4).join("\n  "));
  }
  if (consoleErrors.length) {
    console.error(`\n── Non-benign console errors (${consoleErrors.length}) ──`);
    for (const e of consoleErrors) console.error("  " + e);
  }
  console.error(`\n── Full console transcript (${allConsole.length} messages) ──`);
  for (const e of allConsole) console.error("  " + e);
  process.exit(1);
}

async function preflight() {
  // Fail fast with a clear message if the dev server isn't up.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`\n✖ Dev server not reachable at ${URL} (${e.message}).`);
    console.error(`  Start it first:  npm run dev:local   (or ./dev.sh)  — serves 4174 + the API on 4175.`);
    process.exit(2);
  } finally {
    clearTimeout(t);
  }
}

async function launch() {
  // Prefer the system Chrome (no bundled-Chromium download needed on this machine);
  // fall back to Playwright's bundled Chromium if it's installed.
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

// Boot is "done" when the gate lifts: either the app authed, or the gate finished its
// session check and revealed its action buttons. Still showing only "Checking sign-in…"
// with no buttons after the timeout == the hang bug. We poll so we can fail FAST the moment a
// fatal module-load pageerror (TDZ / ReferenceError) lands, instead of waiting out the timeout.
async function waitForBootToSettle(page) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  for (;;) {
    if (pageErrors.length) {
      fail(`uncaught exception during module load — the gate logic never got to run. This is the boot-crash signature.`);
    }
    const settled = await page.evaluate(() => {
      const authed = document.body.classList.contains("app-authed");
      const btnReady = (id) => { const b = document.getElementById(id); return b && !b.hidden && b.offsetParent !== null; };
      return authed || btnReady("lockDevSignInBtn") || btnReady("lockSignInBtn");
    }).catch(() => false);
    if (settled) return;
    if (Date.now() > deadline) {
      const status = await page.evaluate(() => document.getElementById("lockStatus")?.textContent?.trim() || "(no #lockStatus)").catch(() => "(unavailable)");
      fail(`sign-in gate never lifted within ${BOOT_TIMEOUT_MS}ms — still showing "${status}". This is the boot-hang signature (a module-load throw before the gate logic runs).`);
    }
    await page.waitForTimeout(250);
  }
}

async function enterLocalDev(page) {
  const authed = await page.evaluate(() => document.body.classList.contains("app-authed"));
  if (authed) return;
  const hasDevBtn = await page.evaluate(() => {
    const b = document.getElementById("lockDevSignInBtn");
    return b && !b.hidden && b.offsetParent !== null;
  });
  if (!hasDevBtn) fail("gate lifted but no 'Continue in local dev mode' button appeared — cannot enter the app to smoke-test domains.");
  await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), { timeout: 10000 })
    .catch(() => fail("clicked 'Continue in local dev mode' but body.app-authed never applied — local-dev sign-in path threw."));
}

// Visit a domain within the single booted session (no re-auth). `navigate` drives the real UI
// controls; we then assert the domain's page container actually became visible (the show* fns
// bounce Home if a page is disabled) and that no new errors were emitted since the last domain.
async function visitDomain(page, label, containerId, navigate) {
  const before = consoleErrors.length + pageErrors.length;
  try {
    await navigate();
  } catch (e) {
    fail(`smoke: could not navigate to ${label}: ${e.message.split("\n")[0]}`);
  }
  await page.waitForFunction(
    (id) => { const e = document.getElementById(id); return e && !e.hidden; },
    containerId,
    { timeout: 10000 },
  ).catch(() => fail(`smoke: ${label} did not render — page #${containerId} never became visible (routed Home? page disabled? render threw?).`));
  await page.waitForTimeout(NAV_SETTLE_MS);
  const after = consoleErrors.length + pageErrors.length;
  if (after > before) fail(`smoke: rendering ${label} produced ${after - before} new error(s).`);
  console.log(`  ✓ ${label} rendered with no console errors`);
}

async function main() {
  await preflight();
  const browser = await launch();
  const page = await browser.newPage();

  page.on("pageerror", (err) => {
    pageErrors.push(err.stack || err.message || String(err));
    allConsole.push(`[pageerror] ${err.message || err}`);
  });
  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    allConsole.push(`[${type}] ${text}`);
    if ((type === "error" || type === "warning") && !isBenign(text)) {
      // warnings that look like real errors (Uncaught, ReferenceError…) still count
      if (type === "error" || /uncaught|referenceerror|typeerror|before initialization|is not defined|is not a function/i.test(text)) {
        consoleErrors.push(`[${type}] ${text}`);
      }
    }
  });

  console.log(`▸ Boot check against ${URL}`);
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 15000 })
    .catch((e) => fail(`page.goto failed: ${e.message}`));

  await waitForBootToSettle(page);
  console.log("  ✓ sign-in gate lifted (no boot hang)");

  await enterLocalDev(page);
  console.log("  ✓ entered app (local dev mode)");
  await page.waitForTimeout(NAV_SETTLE_MS);

  // Smoke: visit a couple of extracted domains and confirm no console errors. We're on Home
  // after local-dev entry; Weather is a home-grid button, Contacts via the page-title menu
  // (reachable from any page) — exercising two different nav paths into extracted modules.
  await visitDomain(page, "Weather", "weatherMainPage", () => page.click("#homeWeatherBtn"));
  await visitDomain(page, "Contacts", "contactsMainPage", async () => {
    await page.click("#pageTitleBtn");
    await page.waitForTimeout(300);
    await page.click("#titleContactsBtn");
  });

  // Any errors accumulated across the whole run?
  if (pageErrors.length || consoleErrors.length) {
    fail(`${pageErrors.length} page error(s) + ${consoleErrors.length} console error(s) during boot/smoke.`);
  }

  await browser.close();
  console.log(`\n✔ BOOT CHECK PASSED — booted, gate lifted, Weather + Contacts rendered clean.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("check-boot.mjs crashed:", e.stack || e);
  process.exit(1);
});
