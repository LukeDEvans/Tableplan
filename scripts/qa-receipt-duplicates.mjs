// QA for possible duplicate receipts (receipt-duplicates.js; Luke, 2026-11-22).
// Against the dev server (npm run dev:local) in local dev mode, through the real
// import, toast, receipts list and edit view, at 390px and 360px.
// Usage: node scripts/qa-receipt-duplicates.mjs [url]
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

const scan = (id, store, total, date, lineCount) => ({
  id, status: "done", at: new Date().toISOString(),
  receipt: {
    id, source: "scan", storeName: store, purchaseDate: date, subtotal: total, tax: 0, total,
    lineItems: Array.from({ length: lineCount }, (_, i) => ({ id: `${id}-l${i}`, rawText: `ITEM ${i}`, normalizedName: `item ${i}`, totalPrice: i === lineCount - 1 ? +(total - (lineCount - 1)).toFixed(2) : 1, confidenceScore: 0.95 })),
    extraction: { engine: "claude-vision", model: "m", kind: "receipt", rawOutput: "{}", extractedAt: new Date().toISOString(), status: "ok", confidence: 0.9 },
  },
});

async function run(width) {
  console.log(`▸ ${width}px`);
  const k = `${width}${Date.now().toString(36)}`;
  // A letters-only word unique to this run (store names ignore digits).
  const word = (Date.now().toString(26) + width).replace(/\d/g, (d) => "qrstuvwxyz"[d]);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("app-authed") || !document.getElementById("lockDevSignInBtn")?.hidden, { timeout: 30000 });
  if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), { timeout: 15000 });
  await page.waitForTimeout(1200);

  // The same Target receipt read twice (the second read in more detail), then a separate pair.
  // Store names unique to this run, so receipts left by earlier runs aren't twins.
  const shop = `X${word}`;
  const first = scan(`qa-dupA-${k}`, shop, 21.5, "2026-11-20", 1);
  const second = scan(`qa-dupB-${k}`, `${shop.toUpperCase()} T-1234`, 21.5, "2026-11-21", 4);
  await page.evaluate((s) => window.__liveReceiptScan.importResults({ scans: [s], latest: "" }), first);
  await page.evaluate((s) => window.__liveReceiptScan.importResults({ scans: [s], latest: "" }), second);
  const toast = await page.locator("#mailToast").textContent().catch(() => "");
  check("a toast says the new receipt looks like one already there", /looks like one you already have/.test(toast || ""), toast);
  await page.locator("#mailToast .mail-toast-undo").click();
  await page.waitForTimeout(300);
  const banner = page.locator("#editReceiptDuplicateBanner");
  check("Review opens the receipt with the Possible duplicate banner", await banner.isVisible());
  const fits = await page.evaluate(() => { const b = document.getElementById("editReceiptDuplicateBanner"); const v = document.getElementById("shopReceiptsEditView").getBoundingClientRect(); return [...b.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > v.right + 1).length; });
  check("nothing in the banner sticks out sideways", fits === 0, `${fits} elements`);
  await page.screenshot({ path: `/tmp/qa-dup-banner-${width}.png` });

  await page.locator("#shopReceiptEditBackBtn").click();
  await page.waitForTimeout(200);
  const chips = await page.locator("#shopReceiptsList .shop-receipt-source", { hasText: "Possible duplicate" }).count();
  check("both show Possible duplicate in the list", chips >= 2, `${chips}`);

  await page.locator(`#shopReceiptsList [data-receipt-id="${first.id}"]`).click();
  await page.locator("#editReceiptDuplicateBanner [data-dup-merge]").click();
  await page.waitForTimeout(300);
  const left = await page.evaluate(([a, b]) => [...document.querySelectorAll("#shopReceiptsList [data-receipt-id]")].map((e) => e.dataset.receiptId).filter((id) => id === a || id === b), [first.id, second.id]);
  const lineRows = await page.locator("#editReceiptLineList > *").count();
  check("Merge leaves one receipt, with the more detailed read's 4 lines", left.length === 1 && lineRows === 4, `${JSON.stringify(left)} lines=${lineRows}`);
  check("the merged receipt shows no duplicate banner", !(await banner.isVisible()));
  await page.locator("#shopReceiptEditBackBtn").click();

  // Keep both: a second pair is never asked about again.
  const c = scan(`qa-dupC-${k}`, `Z${word}`, 9.99, "2026-11-19", 1);
  const d = scan(`qa-dupD-${k}`, `Z${word}`, 9.99, "2026-11-19", 1);
  await page.evaluate(([x, y]) => window.__liveReceiptScan.importResults({ scans: [x, y], latest: "" }), [c, d]);
  await page.evaluate(() => window.__liveReceiptScan.openReceipts());
  await page.waitForTimeout(200);
  await page.locator(`#shopReceiptsList [data-receipt-id="${c.id}"]`).click();
  await page.locator("#editReceiptDuplicateBanner [data-dup-keep]").click();
  await page.waitForTimeout(200);
  check("Keep both hides the banner", !(await banner.isVisible()));
  await page.locator("#shopReceiptEditBackBtn").click();
  await page.waitForTimeout(200);
  const costcoChips = await page.locator(`#shopReceiptsList [data-receipt-id="${c.id}"] .shop-receipt-source, #shopReceiptsList [data-receipt-id="${d.id}"] .shop-receipt-source`, { hasText: "Possible duplicate" }).count();
  check("…and neither is marked Possible duplicate any more", costcoChips === 0, `${costcoChips}`);
  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
}

for (const w of [390, 360]) await run(w);
console.log(failures.length ? `\n✖ ${failures.length} failed, ${passed} passed` : `\n✔ all ${passed} checks passed`);
process.exit(failures.length ? 1 : 0);
