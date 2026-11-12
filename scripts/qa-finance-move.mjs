#!/usr/bin/env node
// Headless QA for the account move screen (Finance › Accounts, FINANCE_SPLIT_DESIGN.md §8).
// The server (simplefin action moveAccounts) and Supabase are answered here with
// canned responses: this checks the app's side — pick → review → confirm → reload —
// not the move itself (test/finance-move*.test.js and the PGlite check cover that).
//
//   node scripts/qa-finance-move.mjs [url]   (default http://localhost:4174/; needs `npm run dev:local`)
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

const ACCOUNTS = [
  { id: "acc-joint", owner: "Family", name: "Joint Checking", kind: "cash", linkedId: "B-JOINT" },
  { id: "acc-card", owner: "Luke", name: "Luke Card", kind: "credit", linkedId: "B-CARD" },
  { id: "acc-jar", owner: "Luke", name: "Cash Jar", kind: "cash", manualBalance: 40 },
];
const REPORT = {
  direction: "toPersonal", historyDays: 12,
  accounts: [{ id: "acc-card", name: "Luke Card", linked: true, transactions: 212, labels: 180, notes: 3, links: 1, receipts: 2 }],
  counts: {}, copiedCategories: [{ name: "Hobbies" }, { name: "Groceries" }],
  merchants: { movedWithAccounts: 4, copied: 9 },
  problems: [{ kind: "split-link", message: "A return and the purchase it's linked to end up in different views; the link is dropped." }],
};

const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const calls = [];
  let failNext = "";
  let serverMoves = false; // an older server (before the deploy) doesn't offer moves
  await page.route("**/.netlify/functions/simplefin", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    calls.push(body);
    const send = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (body.action === "status") return send({ connected: true, connectedAt: "2026-01-01T00:00:00Z", ...(serverMoves ? { moves: true } : {}) });
    if (body.action === "accounts") return send({ accounts: [{ id: "B-JOINT", name: "Joint", balance: 1000, transactions: [] }], errors: [], cached: true, fetchedAt: new Date().toISOString() });
    if (body.action === "history") return send({ days: {} });
    if (body.action === "receipts") return send({ receipts: [] });
    if (body.action === "moveAccounts") {
      if (failNext) { const error = failNext; failNext = ""; return send({ error }, 409); }
      if (!body.confirm) return send({ ok: true, dryRun: true, report: REPORT });
      return send({ ok: true, dryRun: false, report: REPORT, verified: { accountsLeft: 0, annotationsLeft: 0, storeRowsLeft: 0, cacheAccountsLeft: 0, historyDaysLeft: 0, clean: true } });
    }
    return send({});
  });
  // After the move the app reloads its finance row and its personal-finance flag.
  let rowReads = 0;
  await page.route("**/rest/v1/tableplan_states**", (route) => {
    rowReads++;
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ updated_at: "2026-11-12T12:00:00Z", state: { financeAccounts: ACCOUNTS.filter((a) => a.id !== "acc-card"), financeMovedOut: { epoch: 1, accounts: ["acc-card"], linked: ["B-CARD"], txns: [] } } }]) });
  });
  await page.route("**/rest/v1/live_finance_account_views**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ linked_id: "B-CARD" }]) }));

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), { timeout: 30000 });
  if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => !!window.__liveQA?.viewsReady?.(), { timeout: 20000 });
  await page.evaluate(() => window.__liveQA.viewsAsRole("admin"));
  await page.evaluate(() => window.__liveQA.setViewForQa("household"));

  const openAccounts = async () => {
    await page.evaluate(() => window.__liveQA.openPageForQa("finance"));
    await page.waitForTimeout(700);
    await page.evaluate(() => document.querySelector('[data-fin-action="fin-tab"][data-tab="accounts"]')?.click());
    await page.waitForTimeout(400);
  };
  const text = (sel) => page.evaluate((s) => document.querySelector(s)?.innerText || "", sel);
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  console.log("\nWho sees it");
  await page.evaluate((accounts) => window.__liveQA.financeMoveSeedForQa(accounts), ACCOUNTS);
  await openAccounts();
  check(!(await page.$("[data-fin-move-pick]")), "not shown to someone who can't move accounts");
  await page.evaluate(() => { window.__financeMoveQa = true; });
  await openAccounts();
  check(!(await page.$("[data-fin-move-pick]")), "not shown while the server can't move accounts yet (before its deploy)");
  serverMoves = true;
  await page.evaluate(() => window.__liveQA.financeRecheckLinkForQa());
  await page.waitForTimeout(600);
  await openAccounts();
  check(!!(await page.$("[data-fin-move-pick]")), "shown to the household's admin once the server offers it");
  const pick = await text("[data-fin-move-pick]");
  check(/Joint Checking/.test(pick) && /Luke Card/.test(pick) && /Cash Jar \(manual\)/.test(pick), "lists every account, manual ones marked", pick.slice(0, 120));
  check(await page.evaluate(() => document.querySelector('[data-fin-action="move-review"]').disabled), "Review is off until an account is picked");
  check(await fits(), "fits 390px");

  console.log("\nReview (the dry run)");
  await page.evaluate(() => document.querySelector('[data-fin-edit="move-pick"][data-id="acc-card"]').click());
  await page.waitForTimeout(250);
  check(await page.evaluate(() => document.querySelector('[data-fin-edit="move-pick"][data-id="acc-card"]').checked && !document.querySelector('[data-fin-action="move-review"]').disabled), "picking an account keeps its tick and enables Review");
  failNext = "Only the household's admin can move accounts.";
  await page.evaluate(() => document.querySelector('[data-fin-action="move-review"]').click());
  await page.waitForTimeout(500);
  check(/Couldn't check: Only the household's admin/.test(await text("[data-fin-move-pick]")), "a refusal from the server is shown, and nothing else changes", (await text("[data-fin-move-pick]")).slice(-120));
  await page.evaluate(() => document.querySelector('[data-fin-action="move-review"]').click());
  await page.waitForSelector("[data-fin-move-report]", { timeout: 5000 });
  const dry = calls.filter((c) => c.action === "moveAccounts").at(-1);
  check(dry.confirm === false && dry.direction === "toPersonal" && JSON.stringify(dry.accountIds) === '["acc-card"]', "asks the server for a dry run of the picked account, to Personal", dry);
  const report = await text("[data-fin-move-report]");
  check(/Nothing has changed yet/.test(report), "says nothing has changed yet");
  check(/Luke Card/.test(report) && /212 transactions/.test(report) && /180 labels/.test(report) && /3 notes/.test(report) && /2 receipts/.test(report), "shows what the account carries", report.slice(0, 200));
  check(/12 days of balance history/.test(report) && /Hobbies, Groceries/.test(report) && /blank amounts/.test(report), "history days and the copied budget categories");
  check(/4 merchants seen only on this account/.test(report) && /9 merchants also used elsewhere/.test(report), "merchant rules: moved and copied");
  check(/the link is dropped/.test(report), "lists what can't move cleanly");
  check(await fits(), "the review fits 390px");
  await page.evaluate(() => document.querySelector('[data-fin-action="move-cancel"]').click());
  await page.waitForTimeout(250);
  check(!!(await page.$("[data-fin-move-pick]")) && !(await page.$("[data-fin-move-report]")), "Cancel goes back to the list");
  check(!calls.some((c) => c.action === "moveAccounts" && c.confirm), "nothing was confirmed so far");

  console.log("\nConfirm");
  await page.evaluate(() => document.querySelector('[data-fin-action="move-review"]').click());
  await page.waitForSelector("[data-fin-move-report]", { timeout: 5000 });
  const readsBefore = rowReads;
  await page.evaluate(() => document.querySelector('[data-fin-action="move-confirm"]').click());
  await page.waitForSelector("[data-fin-move-result]", { timeout: 8000 });
  const real = calls.filter((c) => c.action === "moveAccounts").at(-1);
  check(real.confirm === true && JSON.stringify(real.accountIds) === '["acc-card"]', "confirms the same account");
  check(/now show only in your Personal view/.test(await text("[data-fin-move-result]")), "says where the accounts went");
  check(rowReads > readsBefore, "reloads its finance from the server");
  const after = await page.evaluate(() => window.__liveQA.financeAccountsForQa());
  check(JSON.stringify(after.map((a) => a.id)) === '["acc-joint","acc-jar"]', "the moved account is gone from this view's accounts", after.map((a) => a.id));
  check(await page.evaluate(() => window.__liveQA.personalFinanceFlagForQa()) === true, "and this person now has personal finance");

  check(errors.length === 0, "no page errors", errors.slice(0, 3));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
