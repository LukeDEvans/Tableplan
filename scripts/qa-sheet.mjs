// qa-sheet.mjs — the spreadsheet (documents/sheet) end to end in Chromium, against a
// stand-in store and a BroadcastChannel in place of Supabase Realtime
// (scripts/qa-sheet-harness.js). Laptop width, phone widths, two people together.
//   node scripts/qa-sheet.mjs [screenshotDir]
import { createServer as createVite } from "vite";
import { createServer as createHttp } from "node:http";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const root = fileURLToPath(new URL("..", import.meta.url));
const SHOTS = process.argv[2] || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const check = (ok, name, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ✔" : "  ✖"} ${name}${ok || !detail ? "" : ` — ${detail}`}`); };

const blobs = new Map();
let rows = [];
const api = createHttp(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  if (url.pathname.startsWith("/qa-blob/")) {
    const key = url.pathname.slice(9);
    if (req.method === "PUT") { blobs.set(key, raw); res.end(); return; }
    if (!blobs.has(key)) { res.statusCode = 404; res.end(); return; }
    res.end(blobs.get(key)); return;
  }
  if (url.pathname === "/qa-rows") {
    if (req.method === "POST") { const r = JSON.parse(raw.toString()); rows = [{ slot: r.slot, savedAt: new Date().toISOString(), savedBy: r.savedBy, name: r.name || "", size: r.size }, ...rows.filter((x) => x.slot !== r.slot)]; }
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(rows)); return;
  }
  res.statusCode = 404; res.end();
});
await new Promise((r) => api.listen(0, "127.0.0.1", r));
const apiUrl = `http://127.0.0.1:${api.address().port}`;
const vite = await createVite({ root, configFile: false, logLevel: "error", server: { port: 0, host: "127.0.0.1", hmr: false, proxy: { "/qa-blob": apiUrl, "/qa-rows": apiUrl } } });
await vite.listen();
const appUrl = `http://127.0.0.1:${vite.httpServer.address().port}`;
const ARGS = { headless: true, args: ["--no-sandbox"] };
const browser = await chromium.launch({ ...ARGS, channel: "chrome" }).catch(() => chromium.launch(ARGS));
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: appUrl }).catch(() => {});
await ctx.route(`${appUrl}/qa-sheet.html*`, (r) => {
  const theme = new URL(r.request().url()).searchParams.get("theme") || "light";
  r.fulfill({ contentType: "text/html", body: `<!doctype html><html data-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body data-theme="${theme}"><script type="module" src="/scripts/qa-sheet-harness.js"></script></body></html>` });
});

const errors = [];
async function openAs(who, { size = null, query = "" } = {}) {
  const page = await ctx.newPage();
  if (size) await page.setViewportSize(size);
  page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|WebSocket|\[vite\]/.test(m.text())) errors.push(`${who} console: ${m.text()}`); });
  page.on("dialog", (d) => d.accept(page.__answer ?? ""));
  await page.goto(`${appUrl}/qa-sheet.html?who=${who}${query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const center = (page, r, c) => page.evaluate(([r, c]) => window.__S.cellCenter(r, c), [r, c]);
const clickCell = async (page, r, c, opts = {}) => {
  // bring the cell on screen first (as a person scrolls to it), unless a formula is being typed
  await page.evaluate(([r, c]) => { const S = window.__S; if (!S.st.editing) S.select(r, c); }, [r, c]);
  await wait(30);
  const p = await center(page, r, c); await page.mouse.click(p.x, p.y, opts); await wait(30); };
const val = (page, r, c) => page.evaluate(async ([r, c]) => { await window.__S.idle?.(); const v = window.__S.engine.valueAt(window.__S.st.tab, r, c); return v && v.code ? v.code : v; }, [r, c]);
const shown = (page, r, c) => page.evaluate(([r, c]) => window.__S.shown(r, c), [r, c]);
const input = (page, r, c) => page.evaluate(([r, c]) => window.__S.model.inputText(window.__S.st.tab, r, c), [r, c]);
const typeIn = async (page, r, c, text) => { await clickCell(page, r, c); await page.keyboard.type(text); await page.keyboard.press("Enter"); await wait(40); };

try {
  console.log("Laptop: opening, typing, formulas");
  const a = await openAs("luke");
  check(await a.$(".sh-toolbar [data-act=bold]") !== null, "the toolbar is drawn");
  check(await a.$eval(".sh-tab.is-on", (el) => el.textContent) === "Sheet1", "one tab, Sheet1");
  check(await a.evaluate(() => { const c = document.querySelector(".sh-canvas"); return c.width > 300 && c.height > 300; }), "the grid canvas is drawn");
  await typeIn(a, 1, 1, "12");
  await typeIn(a, 2, 1, "30");
  await typeIn(a, 3, 1, "=SUM(B2:B3)");
  check(await val(a, 3, 1) === 42, "=SUM(B2:B3) is 42", String(await val(a, 3, 1)));
  check(await a.$eval("[data-namebox]", (el) => el.value) === "B5", "Enter moves down; the name box follows", await a.$eval("[data-namebox]", (el) => el.value));
  await clickCell(a, 3, 1);
  check(await a.$eval("[data-formula]", (el) => el.value) === "=SUM(B2:B3)", "the formula bar shows the formula");
  // a reference by clicking while typing a formula
  await clickCell(a, 1, 2);
  await a.keyboard.type("=");
  await clickCell(a, 1, 1);
  await a.keyboard.type("*2");
  await a.keyboard.press("Enter");
  await wait(40);
  check(await input(a, 1, 2) === "=B2*2" && await val(a, 1, 2) === 24, "clicking a cell while typing puts its reference in", await input(a, 1, 2));
  // arrow keys pick references too
  await clickCell(a, 2, 2);
  await a.keyboard.type("=");
  await a.keyboard.press("ArrowLeft");
  await a.keyboard.press("Enter");
  await wait(40);
  check(await input(a, 2, 2) === "=B3", "arrow keys after = pick a reference", await input(a, 2, 2));
  // suggestions
  await clickCell(a, 6, 1);
  await a.keyboard.type("=AVERA");
  await wait(50);
  check(await a.$eval("[data-suggest]", (el) => !el.hidden && el.textContent.includes("AVERAGE")), "function names are suggested while typing");
  await a.keyboard.press("Tab");
  await a.keyboard.type("B2:B3)");
  await a.keyboard.press("Enter");
  await wait(40);
  check(await val(a, 6, 1) === 21, "Tab takes the suggestion: =AVERAGE(B2:B3) is 21", String(await val(a, 6, 1)));
  await typeIn(a, 7, 1, "=1/0");
  check(await shown(a, 7, 1) === "#DIV/0!", "errors are shown");
  await typeIn(a, 8, 1, "=SUM(");
  check(await shown(a, 8, 1) === "#ERROR!" && await input(a, 8, 1) === "=SUM(", "a broken formula keeps what was typed and shows #ERROR!");

  console.log("Formatting");
  await clickCell(a, 1, 1);
  await a.keyboard.press("Control+b");
  await a.click("[data-act=fmt-currency]");
  await wait(50);
  check(await shown(a, 1, 1) === "$12.00", "currency format", await shown(a, 1, 1));
  check(await a.evaluate(() => window.__S.model.style(window.__S.model.cellAt(window.__S.st.tab, 1, 1).s).bold === true), "Ctrl+B makes the cell bold");
  await a.click("[data-act=dec-more]");
  check(await shown(a, 1, 1) === "$12.000", "more decimals", await shown(a, 1, 1));
  await typeIn(a, 10, 1, "25%");
  check(await shown(a, 10, 1) === "25.00%" && await val(a, 10, 1) === 0.25, "typing 25% stores 0.25 shown as a percent", await shown(a, 10, 1));
  await typeIn(a, 11, 1, "11/9/2026");
  check(await shown(a, 11, 1) === "11/9/2026" && await val(a, 11, 1) === 46335, "typing a date stores its serial", await shown(a, 11, 1));
  await typeIn(a, 12, 1, "=TODAY()");
  check(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(await shown(a, 12, 1)), "=TODAY() shows as a date", await shown(a, 12, 1));
  await shot(a, "01-laptop");

  console.log("Undo, rows, copy and paste, fill");
  await typeIn(a, 0, 0, "first");
  await a.keyboard.press("Control+z");
  await wait(40);
  check(await val(a, 0, 0) === null, "undo removes the last typing");
  await a.keyboard.press("Control+Shift+z");
  await wait(40);
  check(await val(a, 0, 0) === "first", "redo puts it back");
  await a.evaluate(() => window.__S.model.insertRows(window.__S.st.tab, 1, 2));
  await wait(60);
  check(await input(a, 5, 1) === "=SUM(B4:B5)" && await val(a, 5, 1) === 42, "inserting rows above keeps formulas on their cells", await input(a, 5, 1));
  await clickCell(a, 5, 1);
  await a.keyboard.press("Control+c");
  await clickCell(a, 5, 3);
  await a.keyboard.press("Control+v");
  await wait(80);
  check(await input(a, 5, 3) === "=SUM(D4:D5)", "copy and paste move a formula's references", await input(a, 5, 3));
  await typeIn(a, 20, 0, "1");
  await typeIn(a, 21, 0, "2");
  await a.evaluate(() => window.__S.select(20, 0, 21, 0));
  const h = await center(a, 21, 0);
  const end = await center(a, 24, 0);
  await a.mouse.move(h.right - 1, h.bottom - 1);
  await a.mouse.down();
  await a.mouse.move(end.x, end.y, { steps: 4 });
  await a.mouse.up();
  await wait(60);
  check(JSON.stringify([await val(a, 22, 0), await val(a, 23, 0), await val(a, 24, 0)]) === "[3,4,5]", "dragging the fill handle continues 1, 2 → 3, 4, 5");

  console.log("Tabs and saving");
  a.__answer = "Budget";
  await a.click("[data-act=add-tab]");
  await wait(80);
  check(await a.$$eval(".sh-tab", (els) => els.length) === 2, "a second tab");
  await a.dblclick(".sh-tab.is-on");
  await wait(80);
  check(await a.$eval(".sh-tab.is-on", (el) => el.textContent) === "Budget", "renaming a tab");
  await typeIn(a, 0, 0, "=Sheet1!B6+1");
  check(await val(a, 0, 0) === 43, "a formula reads another tab", String(await val(a, 0, 0)));
  await a.click(".sh-tab:not(.is-on)");
  await wait(50);
  await a.waitForFunction(() => (window.__saves || 0) > 0, null, { timeout: 15000 });
  check(true, "saved to storage");
  await a.evaluate(() => window.__S.session.save());

  console.log("Two people");
  const b = await openAs("marijane");
  check(await val(b, 5, 1) === 42, "Marijane opens what Luke made");
  check(await b.evaluate(() => window.__S.engine.inWorker), "formulas are computed in the worker");
  await wait(600);
  await a.bringToFront(); // keyboard focus goes to the page in front, as on a real screen
  await typeIn(a, 30, 4, "hello from Luke");
  await b.waitForFunction(() => window.__S.engine.valueAt(window.__S.st.tab, 30, 4) === "hello from Luke", null, { timeout: 8000 }).then(() => check(true, "Luke's typing reaches Marijane live")).catch(async () => check(false, "Luke's typing reaches Marijane live", JSON.stringify({ luke: await val(a, 30, 4), lukeTab: await a.evaluate(() => window.__S.st.tab), mjTab: await b.evaluate(() => window.__S.st.tab), mj: await val(b, 30, 4), peersA: await a.evaluate(() => window.__S.session.state.peers.length) })));
  await b.bringToFront();
  await b.evaluate(() => window.__S.model.insertRows(window.__S.st.tab, 0, 1));
  await a.waitForFunction(() => window.__S.model.inputText(window.__S.st.tab, 6, 1) === "=SUM(B5:B6)", null, { timeout: 8000 }).then(() => check(true, "Marijane's inserted row moves Luke's formulas the same way")).catch(async () => check(false, "Marijane's inserted row moves Luke's formulas the same way", await input(a, 6, 1)));
  await clickCell(b, 3, 3);
  await a.waitForFunction(() => [...window.__S.session.awareness.getStates().values()].some((s) => s.user?.name === "Marijane" && s.sheet), null, { timeout: 8000 }).then(() => check(true, "Luke sees where Marijane is")).catch(() => check(false, "Luke sees where Marijane is"));
  await shot(a, "02-two-people");
  await b.close();

  console.log("CSV out");
  await a.evaluate(() => document.querySelector("[data-menu=file]").click());
  await a.click(".sh-menu button:has-text('Download as CSV')");
  await wait(150);
  const csv = await a.evaluate(() => window.__shared[0]?.text || "");
  check(csv.includes("$12.000") && csv.includes("42"), "Download as CSV writes what's shown", csv.slice(0, 80));

  console.log("Dark theme");
  const dk = await openAs("luke", { query: "&theme=dark" });
  await shot(dk, "03-dark");
  const bg = await dk.evaluate(() => getComputedStyle(document.querySelector(".sh-root")).getPropertyValue("--sheet-bg").trim());
  check(Boolean(bg), "the grid follows the theme", bg);
  await dk.close();
  await a.close();

  for (const width of [390, 360]) {
    console.log(`Phone ${width}px`);
    const p = await openAs("luke", { size: { width, height: 800 }, query: "&view=1" });
    const fit = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check(fit, `nothing runs off the side at ${width}px`);
    check(await p.$eval("[data-act=start-edit]", (el) => !el.hidden), "opens to view with the pencil showing");
    check(await p.$eval(".sh-toolbar", (el) => getComputedStyle(el).display === "none"), "no laptop toolbar on the phone");
    await shot(p, `04-phone-${width}-view`);
    await p.click("[data-act=start-edit]");
    await wait(60);
    const c = await center(p, 2, 2);
    await p.mouse.click(c.x, c.y); await wait(60); await p.mouse.click(c.x, c.y); await wait(80);
    check(await p.evaluate(() => window.__S.st.editing), "a second tap edits the cell");
    check(await p.$eval("[data-keys]", (el) => !el.hidden), "the key row shows while editing");
    await p.click("[data-key='=']");
    const d = await center(p, 5, 1);
    await p.mouse.click(d.x, d.y);
    await p.click("[data-act=commit]");
    await wait(60);
    check(await input(p, 2, 2) === "=B6", "tapping a cell while typing a formula puts its reference in", await input(p, 2, 2));
    await shot(p, `05-phone-${width}-edit`);
    await p.close();
  }
} catch (e) {
  check(false, "the run finished", e.stack || String(e));
} finally {
  check(errors.length === 0, "no page errors", errors.slice(0, 5).join(" | "));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  await vite.close();
  api.close();
  process.exit(fail ? 1 : 0);
}
