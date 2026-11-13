#!/usr/bin/env node
// Headless QA for one Listen queue per person (LISTEN_QUEUE_DESIGN.md): the
// 2026-11-13 bug (an episode finished while Household was on screen stayed in
// Personal's queue) and the rules that fix it — the queue fills from Personal's
// shows in every view, a finished episode leaves it everywhere, a Household
// episode added by hand stays in it back in Personal, and all of it survives a
// reload.
//
//   node scripts/qa-listen-queue.mjs [url]   (default http://localhost:4174/; needs `npm run dev:local`)
//   Start from a clean local state (delete data/tableplan-state.json first).
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
const LAUNCH = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
const results = [];
const check = (cond, name, detail) => {
  results.push(cond);
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
};

async function launch() {
  try { return await chromium.launch({ ...LAUNCH, channel: "chrome" }); } catch { /* none */ }
  try { return await chromium.launch(LAUNCH); } catch { /* none */ }
  const p = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(p)) return chromium.launch({ ...LAUNCH, executablePath: p });
  throw new Error("No Chromium available");
}

const recent = new Date(Date.now() - 2 * 864e5).toISOString();
const older = new Date(Date.now() - 3 * 864e5).toISOString();
const personalShows = [{ id: "pshow", title: "Personal show", art: "", episodes: [
  { id: "p1", title: "Personal 1", pubDate: older, audioUrl: "https://example.invalid/p1.mp3" },
  { id: "p2", title: "Personal 2", pubDate: recent, audioUrl: "https://example.invalid/p2.mp3" },
] }];
const householdShows = [{ id: "hshow", title: "Household show", art: "", episodes: [
  { id: "h1", title: "Household 1", pubDate: recent, audioUrl: "https://example.invalid/h1.mp3" },
] }];

const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, timezoneId: "America/Chicago" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const boot = async () => {
    await page.goto("about:blank");
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), { timeout: 20000 });
    if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
    await page.waitForFunction(() => !!window.__liveQA?.viewsReady?.(), { timeout: 20000 });
    await page.waitForTimeout(400);
  };
  const qa = (fn, arg) => page.evaluate(({ fn, arg }) => window.__liveQA[fn](arg), { fn, arg });
  const setView = async (v) => {
    await qa("setViewForQa", v);
    await page.waitForFunction((v) => window.__liveQA.listenScopeForQa().media === (v === "household" ? "household" : "personal"), v, { timeout: 10000 });
    await page.waitForTimeout(300);
  };

  await boot();
  await setView("personal");
  await qa("listenSeedForQa", { podcasts: personalShows, books: [] });
  await setView("household");
  await qa("listenSeedForQa", { podcasts: householdShows, books: [] });

  const sc = await qa("listenScopeForQa");
  check(sc.listen === "personal" && sc.home === "personal", "the queue's row and library are the person's own", JSON.stringify(sc));

  let q = await qa("listenQueueForQa");
  check(JSON.stringify(q) === JSON.stringify(["p1", "p2"]), "in Household, the queue is Personal's shows (not Household's)", JSON.stringify(q));

  // The bug: finish an episode while Household is on screen.
  await qa("listenPlayedForQa", "p1");
  await qa("listenAddForQa", "h1"); // and add a Household episode by hand
  q = await qa("listenQueueForQa");
  check(JSON.stringify(q) === JSON.stringify(["p2", "h1"]), "in Household: p1 left the queue, h1 joined at the end", JSON.stringify(q));

  await setView("personal");
  q = await qa("listenQueueForQa");
  check(JSON.stringify(q) === JSON.stringify(["p2", "h1"]), "back in Personal: the same queue (p1 gone, h1 kept)", JSON.stringify(q));
  const prog = await qa("listenProgressForQa");
  check(prog?.p1?.played === true, "p1 is finished for the person in Personal", JSON.stringify(prog?.p1));

  await page.waitForTimeout(6500); // past the save debounce
  await boot();
  q = await qa("listenQueueForQa");
  check(JSON.stringify(q) === JSON.stringify(["p2", "h1"]), "after a reload: the same queue", JSON.stringify(q));
  await setView("household");
  q = await qa("listenQueueForQa");
  check(JSON.stringify(q) === JSON.stringify(["p2", "h1"]), "after a reload, in Household: the same queue", JSON.stringify(q));

  check(errors.length === 0, "no page errors", errors.join(" | "));
} finally {
  await browser.close();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
