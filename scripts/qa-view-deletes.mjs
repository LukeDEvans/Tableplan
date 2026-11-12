#!/usr/bin/env node
// Headless QA for per-view delete lists (Luke, 2026-11-11): removing something
// from the household's list must not remove the same id from Personal, and the
// other way round. Drives the real app's delete and its real merge (mergeStates)
// with the same Watch title, same id, held in both views.
//
//   node scripts/qa-view-deletes.mjs [url]   (default http://localhost:4174/; needs `npm run dev:local`)
//   Delete data/tableplan-state.json first for a clean run. Nothing leaves the machine.
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
const LAUNCH = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
const results = [];
const check = (cond, name, detail) => {
  results.push(!!cond);
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}${detail !== undefined ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
};

async function launch() {
  try { return await chromium.launch({ ...LAUNCH, channel: "chrome" }); } catch { /* none */ }
  try { return await chromium.launch(LAUNCH); } catch { /* none */ }
  const p = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(p)) return chromium.launch({ ...LAUNCH, executablePath: p });
  throw new Error("No Chromium available");
}

// Fresh ids each run: a removal in an earlier run stays recorded.
const RUN = String(Date.now() % 1000000);
const BOTH = `qa-both-${RUN}`, MINE = `qa-mine-${RUN}`, OURS = `qa-ours-${RUN}`, OLD = `qa-old-${RUN}`;
const item = (id, title) => ({ id, type: "movie", title, createdAt: "2026-11-01T00:00:00Z" });

const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), { timeout: 30000 });
  if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => !!window.__liveQA?.viewsReady?.(), { timeout: 20000 });
  await page.evaluate(() => window.__liveQA.viewsAsRole("admin"));

  const toView = async (view) => {
    await page.evaluate((v) => window.__liveQA.setViewForQa(v), view);
    await page.waitForFunction((v) => window.__liveQA.scopes().watch === v, view, { timeout: 10000 });
    await page.waitForTimeout(250);
  };
  const ids = () => page.evaluate(() => window.__liveQA.watchItemsForQa().map((i) => i.id));
  const dead = () => page.evaluate(() => window.__liveQA.watchTombstonesForQa());
  const stored = () => page.evaluate(() => window.__liveQA.tombstonesForQa());
  // What the app's merge makes of this device's list meeting another device's stale copy.
  const mergeWithStale = (stale) => page.evaluate((stale) => {
    const local = { watchItems: window.__liveQA.watchItemsForQa(), tombstones: window.__liveQA.tombstonesForQa() };
    return window.__liveQA.mergeForQa(local, { watchItems: stale }).watchItems.map((i) => i.id);
  }, stale);

  console.log("\nThe same title in both views");
  await toView("personal");
  await page.evaluate((items) => window.__liveQA.watchSeedForQa(items), [item(BOTH, "In both lists"), item(MINE, "Only mine")]);
  await toView("household");
  await page.evaluate((items) => window.__liveQA.watchSeedForQa(items), [item(BOTH, "In both lists"), item(OURS, "Only ours")]);
  check((await ids()).includes(BOTH), "Household holds the shared title");

  console.log("\nRemove it from Household");
  await page.evaluate((id) => window.__liveQA.watchDeleteForQa(id), BOTH);
  check(!(await ids()).includes(BOTH), "it is gone from Household");
  check((await dead()).includes(BOTH), "Household records the delete");
  const t = await stored();
  const ownedKeys = Object.keys(t).filter((k) => k.startsWith("watchItems@"));
  check((t.watchItems || []).includes(BOTH), "the delete is under the plain key too (older builds read it)");
  check(ownedKeys.length === 1 && t[ownedKeys[0]].includes(BOTH), "and under Household's own key", ownedKeys);
  check(!(await mergeWithStale([item(BOTH, "In both lists"), item(OURS, "Only ours")])).includes(BOTH), "another device's old copy can't bring it back to Household");

  console.log("\nPersonal keeps it");
  await toView("personal");
  check((await ids()).includes(BOTH), "the title is still on the Personal list", await ids());
  check(!(await dead()).includes(BOTH), "Personal has no delete for it", await dead());
  const mergedMine = await mergeWithStale([item(BOTH, "In both lists"), item(MINE, "Only mine")]);
  check(mergedMine.includes(BOTH) && mergedMine.includes(MINE), "and a merge leaves it there", mergedMine);

  console.log("\nA delete from before this change still applies everywhere");
  const legacy = await page.evaluate(({ OLD }) => {
    const out = window.__liveQA.mergeForQa({ watchItems: [], tombstones: { watchItems: [OLD] } }, { watchItems: [{ id: OLD, type: "movie", title: "Old" }] });
    return out.watchItems.map((i) => i.id);
  }, { OLD });
  check(!legacy.includes(OLD), "an old plain delete removes the title in Personal");

  console.log("\nRemove it from Personal as well");
  await page.evaluate((id) => window.__liveQA.watchDeleteForQa(id), BOTH);
  check(!(await ids()).includes(BOTH) && (await ids()).includes(MINE), "gone from Personal; the other title stays");
  check(!(await mergeWithStale([item(BOTH, "In both lists")])).includes(BOTH), "and it can't come back to Personal");
  await toView("household");
  check(!(await ids()).includes(BOTH) && (await ids()).includes(OURS), "Household is as it was: shared title gone, its own title there");
  check(!(await mergeWithStale([item(BOTH, "In both lists")])).includes(BOTH), "still deleted in Household");

  check(errors.length === 0, "no page errors", errors.slice(0, 3));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
