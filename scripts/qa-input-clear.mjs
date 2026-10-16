// qa-input-clear.mjs — the app-wide text-box clear button (input-clear.js) in the
// real app at phone width. Needs the dev server (npm run dev:local).
//   node scripts/qa-input-clear.mjs [url] [screenshotDir]
// For every visible clearable text box on a set of pages (and in a modal dialog),
// types into it and checks: the button appears inside the box at its right edge,
// vertically centered, with text kept clear of it; tapping it empties the box,
// fires the page's own input handler, keeps focus, and removes the button. Also
// checks a pre-filled box shows nothing until typed into, and opted-out boxes.
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
const SHOTS = process.argv[3] || "";
if (SHOTS && !existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
const ARGS = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };

async function launch() {
  try { return await chromium.launch({ ...ARGS, channel: "chrome" }); } catch {}
  try { return await chromium.launch(ARGS); } catch {}
  return chromium.launch({ ...ARGS, executablePath: `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium` });
}

let failures = 0, checked = 0;
const fail = (m) => { failures++; console.log(`  ✖ ${m}`); };

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.classList.contains("app-authed") || !document.getElementById("lockDevSignInBtn")?.hidden, { timeout: 20000 });
if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) {
  await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"));
}
await page.waitForTimeout(800);

async function visibleFields() {
  return page.evaluate(() => {
    const types = new Set(["text", "search", "email", "url", "tel"]);
    const out = [];
    document.querySelectorAll("input").forEach((el, i) => {
      if (!types.has(el.type) || el.disabled || el.readOnly) return;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 16 || r.bottom < 0 || r.top > innerHeight || r.right > innerWidth + 1) return;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit !== el) return; // covered by something
      el.dataset.qaClear = String(i);
      out.push({ id: String(i), optOut: !!el.closest("[data-no-clear]"), label: el.id || el.name || el.placeholder || el.className });
    });
    return out;
  });
}

async function checkField(where, f) {
  const sel = `input[data-qa-clear="${f.id}"]`;
  const loc = page.locator(sel);
  await loc.evaluate((el) => { el.value = ""; el.__qaInputs = 0; el.addEventListener("input", () => el.__qaInputs++); });
  await loc.click();
  await page.keyboard.type("Pancakes with blueberries and syrup");
  await page.waitForTimeout(80);
  const st = await loc.evaluate((el) => {
    const b = el.nextElementSibling;
    const isBtn = b?.classList?.contains("live-input-clear");
    const r = el.getBoundingClientRect();
    const br = isBtn ? b.getBoundingClientRect() : null;
    const pr = parseFloat(getComputedStyle(el).paddingRight);
    const cs = isBtn ? getComputedStyle(b) : null;
    const hit = br ? document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2) : null;
    return { isBtn, r: { l: r.left, t: r.top, w: r.width, h: r.height, right: r.right }, br: br && { l: br.left, t: br.top, w: br.width, h: br.height, right: br.right },
      pr, bg: cs?.backgroundColor, onTop: !!hit && (hit === b || b.contains(hit)) };
  });
  checked++;
  const name = `${where} › ${f.label}`.slice(0, 80);
  if (f.optOut) {
    if (st.isBtn) fail(`${name}: opted out but got the button`); else console.log(`  ✓ ${name}: opted out (own clear button)`);
    return;
  }
  if (!st.isBtn) return fail(`${name}: no button after typing`);
  const { r, br } = st;
  const problems = [];
  if (Math.abs(br.w - 20) > 0.5 || Math.abs(br.h - 20) > 0.5) problems.push(`size ${br.w}x${br.h}`);
  if (br.right > r.right - 2 || br.right < r.right - 12) problems.push(`right edge off (btn ${br.right.toFixed(1)} vs box ${r.right.toFixed(1)})`);
  const mid = r.t + r.h / 2, bmid = br.t + br.h / 2;
  if (Math.abs(mid - bmid) > 1.5) problems.push(`not centered (${bmid.toFixed(1)} vs ${mid.toFixed(1)})`);
  if (st.pr < 30) problems.push(`padding-right ${st.pr}`);
  if (!st.onTop) problems.push("covered by something else");
  if (problems.length) fail(`${name}: ${problems.join("; ")}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${where.replace(/\W+/g, "-")}-${f.id}.png`, clip: { x: 0, y: Math.max(0, r.t - 30), width: 390, height: Math.min(100, 844 - Math.max(0, r.t - 30)) } });
  // Tap it (touch).
  await page.touchscreen.tap(br.l + br.w / 2, br.t + br.h / 2);
  await page.waitForTimeout(80);
  const after = await loc.evaluate((el) => ({ value: el.value, focused: document.activeElement === el, inputs: el.__qaInputs, btn: !!el.nextElementSibling?.classList?.contains("live-input-clear"), pr: el.style.paddingRight }));
  const p2 = [];
  if (after.value !== "") p2.push(`value not cleared ("${after.value}")`);
  if (!after.focused) p2.push("focus lost");
  if (!(after.inputs > 35)) p2.push(`page input handler saw ${after.inputs} events`);
  if (after.btn) p2.push("button still there");
  if (p2.length) fail(`${name}: after tap — ${p2.join("; ")}`);
  if (!problems.length && !p2.length) console.log(`  ✓ ${name}`);
  await page.keyboard.press("Escape").catch(() => {});
}

async function home() {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("app-authed") || !document.getElementById("lockDevSignInBtn")?.hidden, { timeout: 20000 });
  if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) {
    await page.click("#lockDevSignInBtn");
    await page.waitForFunction(() => document.body.classList.contains("app-authed"));
  }
  await page.waitForTimeout(600);
}

// Pages are opened the way a person does: from the landing page's menu.
const pages = ["Calendar", "Meal Plan", "Shop", "News", "Watch", "Mail", "Recreate", "Finance"];
for (const name of pages) {
  await home();
  const link = page.getByRole("button", { name, exact: true }).first();
  if (!(await link.waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false))) { console.log(`${name}: not on the landing page here`); continue; }
  await link.click();
  await page.waitForTimeout(1200);
  const fields = await visibleFields();
  console.log(`${name}: ${fields.length} visible text box(es)`);
  for (const f of fields.slice(0, 4)) await checkField(name, f);
}

// A modal dialog (top layer) with a text box, plus the pre-filled case.
console.log("modal dialog");
await page.evaluate(() => {
  const d = document.createElement("dialog");
  d.id = "qaDialog";
  d.innerHTML = `<form method="dialog" class="recipe-form" style="display:grid;gap:8px;width:320px">
    <label>Title <input type="text" id="qaDlgTitle" style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px"></label>
    <label>Prefilled <input type="text" id="qaDlgPre" value="Existing event" style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px"></label>
    <textarea id="qaDlgNotes">notes</textarea></form>`;
  document.body.append(d);
  d.showModal();
});
await page.waitForTimeout(150);
const pre = await page.evaluate(() => !!document.getElementById("qaDlgPre").nextElementSibling?.classList?.contains("live-input-clear"));
checked++;
if (pre) fail("pre-filled box shows the button before typing"); else console.log("  ✓ pre-filled box: no button until typed into");
await page.click("#qaDlgNotes"); await page.keyboard.type(" more");
const ta = await page.evaluate(() => !!document.getElementById("qaDlgNotes").nextElementSibling?.classList?.contains("live-input-clear"));
checked++;
if (ta) fail("textarea got a button"); else console.log("  ✓ textarea: no button");
await page.evaluate(() => { document.getElementById("qaDlgTitle").dataset.qaClear = "dlg"; });
await checkField("dialog", { id: "dlg", label: "qaDlgTitle", optOut: false });
await page.evaluate(() => { const d = document.getElementById("qaDialog"); if (!d.open) d.showModal(); });
await page.waitForTimeout(100);
// Programmatic reset after typing hides the button.
await page.click("#qaDlgPre"); await page.keyboard.type("!");
await page.evaluate(() => { document.getElementById("qaDlgPre").value = ""; });
await page.mouse.click(5, 5);
await page.waitForTimeout(100);
const stale = await page.evaluate(() => !!document.getElementById("qaDlgPre").nextElementSibling?.classList?.contains("live-input-clear"));
checked++;
if (stale) fail("button stayed after the app emptied the box"); else console.log("  ✓ app-emptied box: button goes away");

if (errors.length) fail(`page errors: ${errors.join(" | ")}`);
await browser.close();
console.log(`\n${failures ? "✖" : "✔"} ${checked} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
