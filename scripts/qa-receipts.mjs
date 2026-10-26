// QA for scan and go + "does it add up" (RECEIPTS.md). Runs against the dev server
// (npm run dev:local) in local dev mode, through the real receipts list, import and
// edit view, at 390px and 360px. Usage: node scripts/qa-receipts.mjs [url]
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
const LAUNCH_ARGS = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
let passed = 0;
const failures = [];
const check = (label, ok, detail = "") => {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failures.push(label); console.log(`  ✖ ${label}${detail ? ` — ${detail}` : ""}`); }
};

async function launch() {
  try { return await chromium.launch({ ...LAUNCH_ARGS, channel: "chrome" }); } catch { /* no system chrome */ }
  try { return await chromium.launch(LAUNCH_ARGS); } catch { /* no managed chromium */ }
  const sandbox = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(sandbox)) return chromium.launch({ ...LAUNCH_ARGS, executablePath: sandbox });
  throw new Error("No Chromium found.");
}

const lines = (sum, n, prefix) => {
  const cents = Math.round(sum * 100);
  const each = Math.floor(cents / n);
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}-l${i}`, rawText: `${prefix.toUpperCase()} ITEM ${i}`, normalizedName: `${prefix} item ${i}`, totalPrice: (i === n - 1 ? cents - each * (n - 1) : each) / 100, confidenceScore: 0.95 }));
};
const scan = (id, receipt, status) => ({
  id, status: "done", at: new Date().toISOString(),
  receipt: { id, source: "scan", purchaseDate: "2026-10-23", ...receipt, extraction: { engine: "claude-vision", model: "m", kind: "receipt", rawOutput: "{}", extractedAt: new Date().toISOString(), status, confidence: 0.9 } },
});

async function run(width) {
  console.log(`▸ ${width}px`);
  const k = `${width}-${Date.now().toString(36)}`;
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("app-authed") || !document.getElementById("lockDevSignInBtn")?.hidden, { timeout: 30000 });
  if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), { timeout: 15000 });
  await page.waitForTimeout(1200);

  // A failed and a waiting send on this phone's queue.
  await page.evaluate((k) => {
    localStorage.setItem("live-receipt-scans-v1", JSON.stringify({ since: "", items: [
      { id: `qa-failed-${k}`, at: new Date().toISOString(), state: "failed", error: "Too blurry", pages: 2 },
      { id: `qa-sent-${k}`, at: new Date().toISOString(), state: "sent", sentAt: new Date().toISOString(), pages: 1 },
    ] }));
  }, k);

  // Results arrive: Costco adds up (coupon before the subtotal), ALDI is $1.17 short.
  const costco = scan(`qa-costco-${k}`, { storeName: "Costco Wholesale", subtotal: 163.4, tax: 4.09, discounts: 10, total: 167.49, lineItems: lines(173.4, 10, "costco") }, "ok");
  const aldi = scan(`qa-aldi-${k}`, { storeName: "ALDI", subtotal: 97.09, tax: 0, total: 97.09, lineItems: lines(95.92, 8, "aldi") }, "check");
  const res = await page.evaluate(([a, b]) => window.__liveReceiptScan.importResults({ scans: [a, b, { id: b.id.replace("aldi", "sent"), status: "done", at: a.at, receipt: { ...a.receipt, id: b.id.replace("aldi", "sent"), storeName: "Target", total: 30.8, subtotal: 31.29, tax: 1.07, fees: 0.05, discounts: 1.56, lineItems: [{ id: "t1", rawText: "T", totalPrice: 31.24 }] } }], latest: "2026-10-26T18:00:00+00:00" }), [costco, aldi]);
  check("three receipts imported (two from elsewhere, one this phone sent)", res?.added?.length === 3, JSON.stringify(res));
  const queue = await page.evaluate(() => JSON.parse(localStorage.getItem("live-receipt-scans-v1")));
  check("the read that came back left the queue; the failed one stays", queue.items.map((i) => i.id).join() === `qa-failed-${k}`, JSON.stringify(queue.items));
  check("the queue remembers how far it has read", queue.since === "2026-10-26T18:00:00+00:00");
  const again = await page.evaluate((a) => window.__liveReceiptScan.importResults({ scans: [a] }), costco);
  check("a second import of the same read adds nothing", again?.added?.length === 0);

  await page.evaluate(() => window.__liveReceiptScan.openReceipts());
  await page.waitForSelector("#shopReceiptsDialog[open]");
  await page.waitForTimeout(300);
  const list = await page.evaluate((k) => {
    const el = document.getElementById("shopReceiptsList");
    return {
      queueCards: el.querySelectorAll(".receipt-queue-card").length,
      queueText: el.querySelector(".receipt-queue-card")?.textContent.replace(/\s+/g, " ").trim(),
      checks: [...el.querySelectorAll(".shop-receipt-card[data-receipt-id]")].filter((c) => c.dataset.receiptId.endsWith(k) && /Needs a look/.test(c.textContent)).map((c) => c.querySelector(".shop-receipt-store")?.textContent.trim()),
      sideScroll: document.getElementById("shopReceiptsDialog").scrollWidth > document.getElementById("shopReceiptsDialog").clientWidth + 1,
    };
  }, k);
  check("the failed send shows with its reason", list.queueCards === 1 && /Too blurry/.test(list.queueText || ""), list.queueText);
  check("only ALDI is marked 'Needs a look'", list.checks.join() === "ALDI", list.checks.join());
  check("the list fits the width (no sideways scroll)", !list.sideScroll);

  // Remove the failed send.
  await page.click(`[data-receipt-queue-remove='qa-failed-${k}']`);
  await page.waitForTimeout(200);
  check("Remove takes it off the list", (await page.locator(".receipt-queue-card").count()) === 0);

  // ALDI: the edit view says why, and updates as the missing line is added.
  await page.click(`.shop-receipt-card[data-receipt-id='qa-aldi-${k}']`);
  await page.waitForSelector("#shopReceiptsEditView:not([hidden])");
  const banner = () => page.evaluate(() => { const b = document.getElementById("editReceiptReconcileBanner"); return { hidden: b.hidden, cls: b.className, text: b.textContent }; });
  let b = await banner();
  check("ALDI's edit view explains the $1.17 gap", !b.hidden && /is-warn/.test(b.cls) && /\$1\.17 less/.test(b.text), b.text);
  await page.click("#addEditReceiptLineBtn");
  await page.evaluate(() => {
    const rows = document.querySelectorAll("#editReceiptLineList [data-receipt-line-id]");
    const row = rows[rows.length - 1];
    row.querySelector("[data-receipt-name]").value = "Missed item";
    const price = row.querySelector("[data-receipt-price]");
    price.value = "1.17";
    price.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(450);
  b = await banner();
  check("adding the missing $1.17 line turns it to 'Adds up'", /is-ok/.test(b.cls) && /Adds up/.test(b.text), b.text);
  await page.click("#receiptEditForm button[type=submit]");
  await page.waitForTimeout(300);
  const saved = await page.evaluate((k) => {
    const card = document.querySelector(`.shop-receipt-card[data-receipt-id='qa-aldi-${k}']`);
    return card ? /Needs a look/.test(card.textContent) : null;
  }, k);
  check("saved from review, ALDI no longer needs a look", saved === false);

  // Costco: adds up in the edit view.
  await page.click(`.shop-receipt-card[data-receipt-id='qa-costco-${k}']`);
  await page.waitForSelector("#shopReceiptsEditView:not([hidden])");
  b = await banner();
  check("Costco's coupon before the subtotal reads as 'Adds up'", /is-ok/.test(b.cls), b.text);
  const fit = await page.evaluate(() => document.getElementById("shopReceiptsDialog").scrollWidth <= document.getElementById("shopReceiptsDialog").clientWidth + 1);
  check("the edit view fits the width", fit);

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
}

await run(390);
await run(360);
console.log(failures.length ? `\n✖ ${failures.length} failed, ${passed} passed` : `\n✔ ${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
