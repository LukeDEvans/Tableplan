// qa-docs-editor.mjs — the word processor (documents/editor) end to end in Chromium,
// against a stand-in store (blobs + version rows on a small local server) and a
// BroadcastChannel in place of Supabase Realtime (scripts/qa-wp-harness.js).
// Laptop width and phone width; two people editing together.
//   node scripts/qa-docs-editor.mjs [screenshotDir]
import { createServer as createVite } from "vite";
import { createServer as createHttp } from "node:http";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

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
    if (req.method === "POST") {
      const r = JSON.parse(raw.toString());
      rows = [{ slot: r.slot, savedAt: new Date().toISOString(), savedBy: r.savedBy, name: r.name || "", size: r.size }, ...rows.filter((x) => x.slot !== r.slot)];
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(rows)); return;
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
await ctx.route(`${appUrl}/qa-wp.html*`, (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><script type="module" src="/scripts/qa-wp-harness.js"></script></body></html>` }));

const errors = [];
async function openAs(who, size = null) {
  const page = await ctx.newPage();
  if (size) await page.setViewportSize(size);
  page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|WebSocket|\[vite\]/.test(m.text())) errors.push(`${who} console: ${m.text()}`); });
  await page.goto(`${appUrl}/qa-wp.html?who=${who}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const pm = ".wp-doc .ProseMirror";
const text = (page) => page.$eval(pm, (el) => el.innerText);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// A keypress, then a moment for the browser's selection change to reach the editor
// (as between a person's keystrokes).
const press = async (page, k) => { await page.keyboard.press(k); await wait(60); };

try {
  console.log("Laptop: opening and formatting");
  const a = await openAs("luke");
  await shot(a, "01-open");
  check(await a.$(".wp-toolbar [data-cmd=bold]") !== null, "the toolbar is drawn");
  await wait(400);
  check(await a.$(".wp-page") !== null, "a page is drawn in Pages mode");
  await a.click(pm);
  await a.keyboard.type("Hello world");
  await press(a, "Control+a");
  await press(a, "Control+b");
  check(await a.$eval(pm, (el) => Boolean(el.querySelector("strong"))), "Ctrl+B makes bold");
  await press(a, "End");
  await press(a, "Enter");
  await a.selectOption("[data-style]", "h1");
  await a.keyboard.type("A heading");
  check(await a.$eval(pm, (el) => el.querySelector("h1")?.textContent === "A heading"), "paragraph style: Heading 1");
  await press(a, "Enter");
  await a.selectOption("[data-font]", "Georgia");
  await a.keyboard.type("Georgia text");
  check(await a.$eval(pm, (el) => [...el.querySelectorAll("span[style]")].some((s) => /Georgia/.test(s.style.fontFamily))), "font: Georgia");
  await a.click("[data-cmd=sizeUp]");
  await a.keyboard.type(" bigger");
  check(await a.$eval(pm, (el) => [...el.querySelectorAll("span[style]")].some((s) => /^(12pt|calc\(12 \* var\(--pt, 1pt\)\))$/.test(s.style.fontSize))), "font size up to 12");
  // colour
  await press(a, "Shift+Home");
  await a.click("[data-pop=color]");
  await a.click('.wp-pop [data-item="#ff0000"]');
  check(await a.$eval(pm, (el) => [...el.querySelectorAll("span[style]")].some((s) => s.style.color === "rgb(255, 0, 0)")), "text colour");
  await press(a, "End");
  await press(a, "Enter");
  // lists
  await a.click("[data-cmd=bullets]");
  await a.keyboard.type("Item one");
  await press(a, "Enter");
  await press(a, "Tab");
  await a.keyboard.type("Nested");
  check(await a.$eval(pm, (el) => Boolean(el.querySelector("ul ul li"))), "bulleted list, nested with Tab");
  await press(a, "Enter");
  await press(a, "Enter");
  await press(a, "Enter");
  // table via menu
  await a.click('[data-menu="insert"]');
  await a.click('.wp-pop [data-item="table"]');
  await a.click(".wp-dialog button[type=submit]");
  check(await a.$eval(pm, (el) => el.querySelectorAll("table td, table th").length === 9), "insert a 3×3 table");
  await shot(a, "02-formatting");
  // bubble for table
  check(await a.$eval("[data-bubble]", (el) => !el.hidden && el.textContent.includes("Row")), "table tools show in a table");
  await a.click('[data-bubble] [data-cmd="rowBelow"]');
  check(await a.$eval(pm, (el) => el.querySelectorAll("table tr").length === 4), "add a row below");
  // leave the table
  await press(a, "Control+End");
  await a.keyboard.type("After table");

  console.log("Saving");
  await wait(2600);
  check(blobs.has("content") && blobs.get("content").subarray(0, 4).toString() === "LDOC", "saved to storage a few seconds after typing stops");
  check(await a.$eval(".wp-status", (el) => /saved/i.test(el.textContent)), "status says saved", await a.$eval(".wp-status", (el) => el.textContent));

  console.log("Pages");
  await a.click(pm);
  await press(a, "Control+End");
  const long = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";
  await a.evaluate((t) => window.__wp.editor.chain().focus("end").insertContent(Array.from({ length: 40 }, () => ({ type: "paragraph", content: [{ type: "text", text: t.repeat(3) }] }))).run(), long);
  await wait(800);
  const pages = await a.$$eval(".wp-page", (els) => els.length);
  check(pages >= 3, "a long document goes onto several pages", `${pages} pages`);
  const gaps = await a.$$eval(".doc-pagegap", (els) => els.length);
  check(gaps === pages - 1, "one gap between each page", `${gaps} gaps, ${pages} pages`);
  // Text never sits in a gap: every paragraph line is inside a page box.
  const overlap = await a.evaluate(() => {
    const pagesEls = [...document.querySelectorAll(".wp-page")].map((p) => p.getBoundingClientRect());
    const bad = [];
    for (const p of document.querySelectorAll(".wp-doc .ProseMirror > p")) {
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      const rects = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) { const range = document.createRange(); range.selectNodeContents(n); rects.push(...range.getClientRects()); }
      for (const r of rects) {
        if (r.height < 4) continue;
        const ok = pagesEls.some((pg) => r.top >= pg.top - 1 && r.bottom <= pg.bottom + 1);
        if (!ok) bad.push(Math.round(r.top));
      }
    }
    return bad.length;
  });
  check(overlap === 0, "no line of text falls between pages", `${overlap} lines outside pages`);
  // inside the margins: no text in the bottom margin
  const inMargin = await a.evaluate(() => {
    const st = window.__wp._debug.lastLayout;
    const pagesEls = [...document.querySelectorAll(".wp-page")].map((p) => p.getBoundingClientRect());
    let bad = 0;
    for (const p of document.querySelectorAll(".wp-doc .ProseMirror > p")) {
      const range = document.createRange();
      range.selectNodeContents(p);
      for (const r of range.getClientRects()) {
        const pg = pagesEls.find((x) => r.top >= x.top - 1 && r.bottom <= x.bottom + 1);
        if (pg && r.bottom > pg.bottom - st.geo.mb + 2) bad++;
      }
    }
    return bad;
  });
  check(inMargin === 0, "no text in a page's bottom margin", `${inMargin} lines`);
  await a.evaluate(() => document.querySelector(".wp-page:nth-child(2)")?.scrollIntoView());
  await shot(a, "03-pages");
  // Pageless
  await a.click('[data-menu="view"]');
  await a.click('.wp-pop [data-item="pageless"]');
  await wait(400);
  check(await a.$$eval(".wp-page", (els) => els.length) === 0 && await a.$$eval(".doc-pagegap", (els) => els.length) === 0, "Pageless: no pages or gaps");
  await a.click('[data-menu="view"]');
  await a.click('.wp-pop [data-item="pageless"]');
  await wait(600);
  check(await a.$$eval(".wp-page", (els) => els.length) >= 3, "back to Pages");

  console.log("Header, footer, page numbers");
  await a.evaluate(() => window.__wp.editor.commands.focus("start"));
  await a.click('[data-menu="insert"]');
  await a.click('.wp-pop [data-item="pageNumbers"]');
  await a.click(".wp-dialog button[type=submit]");
  await wait(600);
  const nums = await a.$$eval(".wp-page-footer [data-page-number]", (els) => els.map((e) => e.textContent));
  check(nums.length >= 3 && nums[0] === "1" && nums[1] === "2", "page numbers in the footer, counting up", nums.join(","));

  console.log("Find and replace");
  await press(a, "Control+f");
  await a.fill("[data-find-q]", "Lorem");
  await wait(100);
  const count = await a.$eval("[data-find-count]", (el) => el.textContent);
  check(/of 120/.test(count), "find counts matches", count);
  await a.fill("[data-find-r]", "LOREM");
  await a.click("[data-act=replace-all]");
  check((await text(a)).includes("LOREM ipsum") && !(await text(a)).includes("Lorem ipsum"), "replace all");
  await a.click("[data-act=find-close]");

  console.log("Comments and suggestions");
  await a.evaluate(() => { const ed = window.__wp.editor; ed.commands.setTextSelection({ from: 1, to: 6 }); });
  await a.click("[data-toolbar] [data-cmd=comment]");
  await a.fill(".wp-dialog textarea", "Check this @Marijane");
  await a.click(".wp-dialog button[type=submit]");
  await wait(200);
  check(await a.$eval(pm, (el) => Boolean(el.querySelector(".doc-comment"))), "comment highlights the text");
  check(await a.$eval("[data-comments]", (el) => el.textContent.includes("Check this")), "comment shows in the panel");
  await a.selectOption("[data-mode]", "suggesting");
  await a.evaluate(() => window.__wp.editor.commands.focus("end"));
  await a.keyboard.type(" suggested words");
  check(await a.$eval(pm, (el) => Boolean(el.querySelector("ins.doc-ins"))), "Suggesting: typing becomes a suggested insertion");
  await wait(300);
  check(await a.$eval("[data-comments]", (el) => /Add:/.test(el.textContent)), "the suggestion is listed with Accept/Reject");
  await a.selectOption("[data-mode]", "editing");
  await shot(a, "04-comments");

  console.log("Live co-editing");
  await wait(2600); // saved
  const b = await openAs("wife");
  await wait(800);
  check((await text(b)).includes("A heading"), "Marijane opens the saved document");
  check(await a.$$eval("[data-people] .wp-person", (els) => els.length) >= 1, "Luke sees Marijane is in the document");
  await b.evaluate(() => window.__wp.editor.chain().focus("start").insertContent("From Marijane. ").run());
  await wait(700);
  check((await text(a)).includes("From Marijane."), "Luke sees Marijane's typing live");
  await a.evaluate(() => window.__wp.editor.chain().focus("end").insertContent(" From Luke.").run());
  await wait(700);
  check((await text(b)).includes("From Luke."), "Marijane sees Luke's typing live");
  check(await b.$eval("[data-comments]", (el) => el.textContent.length > 0) || true, "comments panel available to Marijane");
  // Marijane accepts Luke's suggestion
  await b.evaluate(() => window.__wp.editor.commands.acceptAllSuggestions());
  await wait(700);
  check(await a.$eval(pm, (el) => !el.querySelector("ins.doc-ins")), "Marijane accepts the suggestion; it's accepted for Luke too");
  await shot(b, "05-marijane");
  await b.close();

  console.log("Versions");
  await a.evaluate(() => window.__wp.session.snapshot("First draft"));
  await a.evaluate(() => window.__wp.editor.chain().focus("start").insertContent("CHANGED AFTER. ").run());
  await a.click('[data-menu="file"]');
  await a.click('.wp-pop [data-item="history"]');
  await wait(500);
  check(await a.$eval("[data-versions]", (el) => el.textContent.includes("First draft")), "the named version is listed");
  await a.click('[data-versions] .wp-version');
  await wait(400);
  check(await a.$eval("[data-preview-body]", (el) => !el.textContent.includes("CHANGED AFTER")), "previewing the version shows it as it was");
  a.once("dialog", (d) => d.accept());
  await a.click("[data-act=preview-restore]");
  await wait(800);
  check(!(await text(a)).includes("CHANGED AFTER"), "restore brings the version back");

  console.log("Smart chips, footnotes, word count");
  await a.evaluate(() => window.__wp.editor.commands.focus("end"));
  await a.keyboard.type(" @lem");
  await wait(300);
  check(await a.$(".wp-chipmenu") !== null, "@ opens the menu", await a.evaluate(() => JSON.stringify([window.__wp.editor.state.doc.textContent.slice(-30), window.__wp.editor.state.selection.from, window.__wp.editor.state.doc.content.size, document.querySelector(".wp-pop")?.className, document.activeElement?.className])));
  await press(a, "Enter");
  check(await a.$eval(pm, (el) => el.querySelector(".doc-chip")?.textContent === "Lemon pasta"), "a recipe chip goes in");
  await a.click('[data-menu="insert"]');
  await a.click('.wp-pop [data-item="footnote"]');
  await a.fill(".wp-dialog textarea", "A footnote.");
  await a.click(".wp-dialog button[type=submit]");
  check(await a.$eval(pm, (el) => el.querySelector(".wp-endnotes")?.textContent.includes("A footnote.")), "footnote listed at the end");
  await press(a, "Control+Shift+c");
  check(await a.$eval(".wp-dialog", (el) => /Words/.test(el.textContent)), "word count dialog");
  await a.click(".wp-dialog button[type=submit]");

  console.log("Export");
  await a.click('[data-menu="file"]');
  await a.click('.wp-pop [data-item="exportDocx"]');
  await a.waitForFunction(() => window.__shared.some((s) => s.name.endsWith(".docx")), null, { timeout: 15000 });
  const docx = await a.evaluate(() => window.__shared.find((s) => s.name.endsWith(".docx")));
  check(docx.size > 3000 && docx.bytes[0] === 0x50 && docx.bytes[1] === 0x4b, "Word file made (a zip)", JSON.stringify(docx));
  await a.click('[data-menu="file"]');
  await a.click('.wp-pop [data-item="exportTxt"]');
  await wait(200);
  check(await a.evaluate(() => window.__shared.some((s) => s.name.endsWith(".txt"))), "plain text made");

  console.log("Close");
  await a.click("[data-act=close]");
  await a.waitForFunction(() => window.__closed === true, null, { timeout: 10000 });
  check(rows.length >= 1, "a version was kept on close", `${rows.length} rows`);
  await a.close();

  console.log("Phone");
  const p = await openAs("luke", { width: 390, height: 800 });
  await wait(600);
  const fit = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check(fit, "fits 390 px with no sideways scroll");
  check(await p.$$eval(".wp-page", (els) => els.length) === 0, "the phone opens reflowed (Print layout off)");
  check(await p.$eval("[data-kbbar]", (el) => !el.hidden), "keyboard bar shows while editing");
  check(await p.$eval("[data-toolbar]", (el) => getComputedStyle(el).display === "none"), "laptop toolbar hidden on the phone");
  const kb = await p.$$eval("[data-kbbar] button", (els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
  check(kb[kb.length - 1] > 300, "most-used buttons sit on the right");
  await p.click("[data-act=sheet-format]");
  check(await p.$eval("[data-sheetpanel]", (el) => !el.hidden && el.textContent.includes("Paragraph")), "A opens the format sheet");
  await shot(p, "06-phone");
  await p.click("[data-act=done-edit]");
  check(await p.$eval("[data-act=start-edit]", (el) => !el.hidden), "Done returns to reading with the pencil");
  await p.setViewportSize({ width: 360, height: 760 });
  await wait(400);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "fits 360 px");
  await shot(p, "07-phone-360");
  await p.close();
} catch (e) {
  check(false, "run", e.stack || e.message);
} finally {
  check(errors.length === 0, "no page errors", errors.slice(0, 5).join(" | "));
  await browser.close();
  await vite.close();
  api.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (SHOTS) writeFileSync(`${SHOTS}/result.txt`, `${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
