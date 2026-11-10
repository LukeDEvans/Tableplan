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
  // positions come from the layout drawn on the next frame (after a filter or row change)
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
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

  console.log("Filters");
  await a.evaluate(() => {
    const S = window.__S, t = S.st.tab;
    [["Name", "Dept", "Pay"], ["Ann", "Ops", "50"], ["Bob", "IT", "70"], ["Cy", "Ops", "55"], ["Dee", "IT", "90"], ["Eve", "HR", "40"], ["Gus", "IT", "80"]]
      .forEach((row, i) => row.forEach((x, j) => S.model.setInput(t, 40 + i, j, x)));
    S.select(41, 0);
  });
  await a.click(".sh-toolbar [data-act=filter]");
  await wait(80);
  const fb = await a.evaluate(() => { const S = window.__S; const f = S.model.filterOf(S.st.tab, "filter"); return f && S.fx.head(); });
  check(fb && fb.r === 40 && fb.r2 === 46 && fb.c1 === 0 && fb.c2 === 2, "Create a filter finds the table around the cell", JSON.stringify(fb));
  await a.evaluate(() => window.__S.select(40, 1));
  await wait(40);
  const hb = await center(a, 40, 1);
  await a.mouse.click(hb.right - 8, hb.y);
  await wait(80);
  check(await a.$(".sh-filter") !== null, "the header button opens the filter panel");
  check(await a.$eval(".sh-filter [data-f-list]", (el) => el.textContent.replace(/\s+/g, " ")).then((t) => /HR\s*1/.test(t) && /IT\s*3/.test(t) && /Ops\s*2/.test(t)), "the panel lists the column's values with counts");
  await a.click(".sh-filter [data-f-list] label:has-text('IT') input");
  await shot(a, "04-filter-panel");
  await a.click(".sh-filter [data-f=ok]");
  await wait(120);
  const shownRows = () => a.evaluate(() => [40, 41, 42, 43, 44, 45, 46].filter((r) => window.__S.rowShown(r)));
  check(JSON.stringify(await shownRows()) === "[40,41,43,45]", "unticking IT hides the IT rows", JSON.stringify(await shownRows()));
  await shot(a, "04-filter");
  const mj = await openAs("marijane");
  await mj.waitForFunction(() => !window.__S.rowShown(42) && window.__S.rowShown(41), null, { timeout: 8000 }).then(() => check(true, "the tab's filter is the same for Marijane")).catch(() => check(false, "the tab's filter is the same for Marijane"));
  await a.bringToFront(); // drawing runs in the page in front, as on a real screen
  await a.evaluate(() => window.__S.fx.newView());
  await wait(80);
  check(await a.$eval(".sh-viewbar", (el) => !el.hidden && el.textContent.includes("Filter 1")), "a filter view shows its bar");
  await a.evaluate(() => { const S = window.__S, t = S.st.tab; S.model.setCriteria(t, S.fx.view, S.model.colIds(t)[1], { hide: ["IT", "Ops"] }); S.select(0, 0); });
  await wait(150);
  check(JSON.stringify(await shownRows()) === "[40,45]", "in my filter view I hide Ops too", JSON.stringify(await shownRows()));
  await wait(600);
  check(await mj.evaluate(() => window.__S.rowShown(41) && window.__S.rowShown(43) && !window.__S.rowShown(42)), "my filter view doesn't change what Marijane sees");
  await shot(a, "05-filter-view");
  await a.evaluate(() => window.__S.fx.openPanel(1));
  await wait(60);
  check(await a.$(".sh-filter") !== null && await a.$(".sh-filter [data-f=asc]") === null, "inside a filter view there's no Sort (it would reorder everyone's rows)");
  await a.keyboard.press("Escape");
  await a.click(".sh-viewbar [data-vb=exit]");
  await wait(100);
  check(JSON.stringify(await shownRows()) === "[40,41,43,45]" && await a.$eval(".sh-viewbar", (el) => el.hidden), "closing the view goes back to the tab's filter");
  await clickCell(a, 41, 0);
  await a.keyboard.press("ArrowDown");
  check(await a.$eval("[data-namebox]", (el) => el.value) === "A44", "arrow keys skip filtered-out rows", await a.$eval("[data-namebox]", (el) => el.value));
  await mj.close();

  console.log("Rules on cells");
  await a.evaluate(() => { const S = window.__S, t = S.st.tab; ["10", "40", "20", "30"].forEach((x, i) => S.model.setInput(t, 50 + i, 0, x)); S.select(50, 0, 53, 0); });
  await a.evaluate(() => document.querySelector("[data-menu=format]").click());
  await a.click(".sh-menu button:has-text('Conditional formatting')");
  await wait(80);
  check(await a.$eval(".sh-rules [data-rx-range]", (el) => el.value) === "A51:A54", "the formatting panel starts from the selection", await a.$eval(".sh-rules [data-rx-range]", (el) => el.value));
  await a.selectOption(".sh-rules [data-rx-op]", "gt");
  await a.fill(".sh-rules [data-rx-a]", "25");
  await a.click(".sh-rules [data-rx=done]");
  await wait(120);
  const fmt = (r) => a.evaluate((r) => { const S = window.__S; const d = S.rules(); const v = S.engine.valueAt(S.st.tab, r, 0); return d?.formatAt(r, 0, { value: v, text: String(v) }) || null; }, r);
  check((await fmt(51))?.fill === "#b7e1cd" && (await fmt(50)) === null, "Greater than 25 colours 40 and 30, not 10", JSON.stringify([await fmt(50), await fmt(51)]));
  await a.click(".sh-rules [data-rx=add]");
  await a.selectOption(".sh-rules [data-rx-op]", "formula");
  await a.fill(".sh-rules [data-rx-a]", "=A51=MAX($A$51:$A$54)");
  await a.click(".sh-rules [data-rx-style=bold]");
  await a.click(".sh-rules [data-rx-color=fill][data-c='']");
  await a.click(".sh-rules [data-rx-up]:not([disabled])").catch(() => {});
  await a.click(".sh-rules [data-rx=done]");
  await wait(80);
  await a.evaluate(() => window.__S.idle());
  await a.click(".sh-rules .sh-rx-item:nth-child(2) [data-rx-up]");
  await wait(150);
  check((await fmt(51))?.bold === true && !(await fmt(52))?.bold, "a custom formula rule, moved to the top, bolds the largest", JSON.stringify([await fmt(51), await fmt(52)]));
  check(await a.$$eval(".sh-rules .sh-rx-item", (els) => els.length) === 2, "both rules are listed");
  await shot(a, "06-conditional");
  await a.click(".sh-rules [data-rx=close]");
  await a.evaluate(() => window.__S.select(50, 2, 52, 2));
  await a.evaluate(() => document.querySelector("[data-menu=data]").click());
  await a.click(".sh-menu button:has-text('Data validation')");
  await wait(80);
  await a.fill(".sh-rules [data-rx-items]", "Yes\nNo");
  await a.check(".sh-rules [data-rx-reject='1']");
  await a.click(".sh-rules [data-rx=done]");
  await wait(120);
  await typeIn(a, 50, 2, "Maybe");
  check(await input(a, 50, 2) === "" && (await a.evaluate(() => window.__toasts.at(-1) || "")).startsWith("Not entered"), "a value not on the list is refused", await input(a, 50, 2));
  await typeIn(a, 50, 2, "Yes"); // straight after: the second click on the cell is a double-click, which edits it
  check(await input(a, 50, 2) === "Yes", "a value on the list is taken (and typing after a double-click goes into the cell)", await input(a, 50, 2));
  await a.evaluate(() => window.__S.select(0, 0));
  await a.evaluate(() => window.__S.select(51, 2));
  await wait(60);
  const dd = await center(a, 51, 2);
  await a.mouse.click(dd.right - 6, dd.y);
  await wait(80);
  check(await a.$(".sh-menu button:has-text('No')") !== null, "the dropdown arrow lists the items");
  await a.click(".sh-menu button:has-text('No')");
  await wait(60);
  check(await input(a, 51, 2) === "No", "picking from the dropdown fills the cell");
  await a.evaluate(() => { const S = window.__S, t = S.st.tab, rows = S.model.rowIds(t), cols = S.model.colIds(t); S.model.setRule(t, null, { kind: "valid", type: "checkbox", ranges: [{ top: rows[50], bottom: rows[51], left: cols[3], right: cols[3] }] }); S.select(50, 3); });
  await wait(150);
  const cb = await center(a, 50, 3);
  await a.mouse.click(cb.x, cb.y);
  await wait(80);
  check(await val(a, 50, 3) === true, "clicking the checkbox ticks it");
  await a.mouse.click(cb.x, cb.y);
  await wait(80);
  check(await val(a, 50, 3) === false, "clicking again unticks it");
  await clickCell(a, 51, 3);
  await a.keyboard.press(" ");
  await wait(80);
  check(await val(a, 51, 3) === true, "space ticks the checkbox");
  await a.evaluate(() => { const S = window.__S, t = S.st.tab, rows = S.model.rowIds(t), cols = S.model.colIds(t); S.model.setRule(t, null, { kind: "valid", type: "number", op: "gt", a: "0", help: "A positive number", ranges: [{ top: rows[52], bottom: rows[52], left: cols[3], right: cols[3] }] }); S.model.setInput(t, 52, 3, "-5"); });
  await clickCell(a, 52, 3);
  await wait(80);
  check(await a.$eval(".sh-hint", (el) => !el.hidden && el.textContent.includes("A positive number") && el.classList.contains("is-bad")), "a warned value shows the help text as invalid");
  await shot(a, "07-validation");

  console.log("Charts");
  await a.evaluate(() => { const S = window.__S, t = S.st.tab; [["Month", "Food", "Fuel"], ["Jan", "420", "90"], ["Feb", "380", "110"], ["Mar", "455", "105"], ["Apr", "510", "98"]].forEach((row, i) => row.forEach((x, j) => S.model.setInput(t, 60 + i, j, x))); });
  await clickCell(a, 61, 1);
  await a.evaluate(() => window.__S.idle());
  await a.evaluate(() => document.querySelector("[data-menu=insert]").click());
  await a.click(".sh-menu button:has-text('Chart')");
  await wait(200);
  const chartSpec = () => a.evaluate(() => { const S = window.__S; return S.model.chartsOf(S.st.tab)[0] || null; });
  let cs = await chartSpec();
  check(cs && cs.type === "column" && await a.$(".sh-chart svg") !== null, "Insert → Chart draws a column chart of the table", JSON.stringify(cs && { type: cs.type }));
  check(await a.$eval(".sh-chart svg", (el) => el.textContent.includes("Food") && el.textContent.includes("Fuel") && el.textContent.includes("Feb")), "it reads the headers as series and the first column as labels");
  check(await a.$(".sh-chart-editor") !== null, "the chart editor opens beside it");
  await a.selectOption(".sh-chart-editor [data-ce-type]", "line");
  await a.fill(".sh-chart-editor [data-ce-text=title]", "Spending");
  await a.press(".sh-chart-editor [data-ce-text=title]", "Enter");
  await wait(150);
  cs = await chartSpec();
  check(cs.type === "line" && cs.title === "Spending" && await a.$eval(".sh-chart svg", (el) => el.textContent.includes("Spending")), "changing the type and title redraws it", JSON.stringify({ type: cs.type, title: cs.title }));
  await shot(a, "08-chart");
  check(await a.evaluate(() => getComputedStyle(document.querySelector(".sh-chart svg text")).stroke === "none"), "the app's icon styling doesn't outline chart text");
  await a.click(".sh-chart-editor [data-ce=close]");
  await a.evaluate(() => { const S = window.__S; S.model.setInput(S.st.tab, 62, 1, "999"); });
  await a.evaluate(() => window.__S.idle());
  await wait(120);
  check(await a.$eval(".sh-chart svg", (el) => el.innerHTML.includes("Food: 999")), "the chart follows its data");
  const box0 = await a.$eval(".sh-chart", (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await a.mouse.move(box0.x + 40, box0.y + 60); await a.mouse.down(); await a.mouse.move(box0.x + 140, box0.y + 100, { steps: 5 }); await a.mouse.up();
  await wait(120);
  const box1 = await a.$eval(".sh-chart", (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  check(Math.abs(box1.x - box0.x - 100) < 3 && Math.abs(box1.y - box0.y - 40) < 3, "dragging moves the chart", JSON.stringify([box0, box1]));
  await a.mouse.move(box1.x + box1.w - 5, box1.y + box1.h - 5); await a.mouse.down(); await a.mouse.move(box1.x + box1.w + 55, box1.y + box1.h + 25, { steps: 5 }); await a.mouse.up();
  await wait(120);
  cs = await chartSpec();
  check(Math.abs(cs.pos.w - box1.w - 60) < 4 && Math.abs(cs.pos.h - box1.h - 30) < 4, "the corner handle resizes it", JSON.stringify(cs.pos));
  await a.hover(".sh-chart");
  await a.click(".sh-chart .sh-chart-more");
  await a.click(".sh-menu button:has-text('Download as PNG')");
  await wait(400);
  check(await a.evaluate(() => window.__shared.some((x) => x.mime === "image/png" && x.name.endsWith(".png"))), "the chart downloads as a PNG");
  const tipText = await a.evaluate(() => { const r = document.querySelector(".sh-chart [data-tip]"); if (!r) return ""; const b = r.getBoundingClientRect(); r.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 })); return document.querySelector(".sh-chart-tip").hidden ? "" : document.querySelector(".sh-chart-tip").textContent; });
  check(/Food: /.test(tipText), "hovering shows the values", tipText);
  await a.evaluate(() => { const S = window.__S; S.model.sortRows(S.st.tab, 61, 64, [{ col: 1, asc: true }], (r, c) => S.engine.valueAt(S.st.tab, r, c), (x, y) => x - y); });
  await wait(150);
  cs = await chartSpec();
  check(await a.evaluate((c) => { const S = window.__S; const rows = S.model.rowIds(S.st.tab); return rows.indexOf(c.range.top) === 60 && rows.indexOf(c.range.bottom) === 64; }, cs), "sorting the table keeps the chart's range");
  await a.click(".sh-chart");
  await a.keyboard.press("Delete");
  await wait(120);
  check(await chartSpec() === null && await a.$(".sh-chart") === null, "Delete removes the selected chart");
  await a.evaluate(() => { const S = window.__S; S.select(61, 1); });

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
    await p.evaluate(() => { const S = window.__S; S.select(40, 0); if (!S.model.filterOf(S.st.tab, "filter")) S.fx.toggle(); });
    await wait(80);
    await p.evaluate(() => window.__S.fx.openPanel(1));
    await wait(80);
    check(await p.evaluate(() => { const el = document.querySelector(".sh-filter.is-sheet"); if (!el) return false; const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1; }), "the filter panel is a sheet from the bottom that fits");
    await shot(p, `04-phone-${width}-filter`);
    await p.keyboard.press("Escape");
    await wait(40);
    check(await p.$(".sh-filter") === null, "Escape closes the filter panel");
    const chartFit = await p.evaluate(async () => { const S = window.__S; S.st.viewing = false; S.select(61, 0); const id = S.cx.insert(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const el = document.querySelector(".sh-chart"); const r = el?.getBoundingClientRect(); const ok = !!el && r.width <= window.innerWidth - 20 && !!el.querySelector("svg"); S.model.removeChart(S.st.tab, id); S.st.viewing = true; return ok; });
    check(chartFit, "a chart made on the phone fits the screen");
    await p.evaluate(() => window.__S.rx.openValidation());
    await wait(80);
    check(await p.evaluate(() => { const el = document.querySelector(".sh-rules.is-sheet"); if (!el) return false; const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1; }), "the validation panel is a sheet that fits");
    await shot(p, `04-phone-${width}-rules`);
    await p.evaluate(() => window.__S.rx.close());
    const before = await val(p, 50, 3);
    await p.evaluate(() => window.__S.select(50, 3));
    await wait(80);
    const box = await center(p, 50, 3);
    await p.mouse.click(box.x, box.y);
    await wait(80);
    check(await val(p, 50, 3) === before, "in view mode a tap on a checkbox doesn't tick it", String(await val(p, 50, 3)));
    await p.evaluate(() => window.__S.select(0, 0));
    await wait(60);
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
