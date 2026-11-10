// qa-slides.mjs — slides (documents/slides) end to end in Chromium, against a
// stand-in store and a BroadcastChannel in place of Supabase Realtime
// (scripts/qa-slides-harness.js). Laptop width, phone widths, two people together.
//   node scripts/qa-slides.mjs [screenshotDir]
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
await ctx.route(`${appUrl}/qa-slides.html*`, (r) => {
  const theme = new URL(r.request().url()).searchParams.get("theme") || "light";
  r.fulfill({ contentType: "text/html", body: `<!doctype html><html data-theme="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body data-theme="${theme}"><script type="module" src="/scripts/qa-slides-harness.js"></script></body></html>` });
});

const errors = [];
async function openAs(who, { size = null, query = "" } = {}) {
  const page = await ctx.newPage();
  if (size) await page.setViewportSize(size);
  page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|WebSocket|\[vite\]/.test(m.text())) errors.push(`${who} console: ${m.text()}`); });
  page.on("dialog", (d) => d.accept(page.__answer ?? ""));
  await page.goto(`${appUrl}/qa-slides.html?who=${who}${query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  return page;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const S = (page, fn, arg) => page.evaluate(fn, arg);
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
// a point on the slide (slide px) → screen px
const at = (page, x, y) => page.evaluate(([x, y]) => { const r = document.querySelector("[data-stage]").getBoundingClientRect(); const s = window.__S.st.scale; return { x: r.left + x * s, y: r.top + y * s }; }, [x, y]);
const itemCenter = (page, id) => page.evaluate((id) => { const r = document.querySelector(`.sl-stage [data-item="${id}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, id);
const items = (page) => S(page, () => window.__S.model.items(window.__S.st.slide));
const textOf = (page, id) => S(page, (id) => { const S = window.__S; const fr = S.model.text(S.st.slide, id); const out = []; const walk = (n) => { if (n.constructor.name === "YXmlText" || n._start !== undefined && n.toDelta) { out.push(n.toString().replace(/<[^>]*>/g, "")); } else n.toArray?.().forEach(walk); }; walk(fr); return out.join(""); }, id);

try {
  console.log("Laptop: opening, the first slide, typing");
  const a = await openAs("luke");
  check(await a.$(".sl-toolbar [data-act=new-slide]") !== null, "the toolbar is drawn");
  check(await S(a, () => window.__S.model.slideIds().length) === 1, "a new presentation has one slide");
  check(await a.$$eval(".sl-stage .sl-item", (els) => els.length) === 2, "the title slide shows its two placeholders");
  check(await a.$eval(".sl-stage .sl-prompt", (el) => el.textContent) === "Click to add title", "empty placeholders show their prompt");
  check(await a.$$eval("[data-film] [data-thumb]", (els) => els.length) === 1, "the filmstrip shows the slide");
  const [title] = await items(a);
  const tc = await itemCenter(a, title.id);
  await a.mouse.dblclick(tc.x, tc.y);
  await wait(120);
  check(await S(a, () => !!window.__S.st.editing), "double-click goes into the title's text");
  await a.keyboard.type("Our trip to Duluth");
  await wait(80);
  check(await textOf(a, title.id) === "Our trip to Duluth", "typing goes into the title", await textOf(a, title.id));
  await a.keyboard.press("Escape");
  await wait(80);
  check(await S(a, () => !window.__S.st.editing && window.__S.st.sel.length === 1), "Escape leaves the text and keeps the box selected");
  check(await a.$eval(".sl-stage [data-item] .sl-text", (el) => el.textContent.includes("Our trip to Duluth")), "the slide shows the typed title");
  await wait(150);
  check(await a.$eval("[data-film] [data-thumb]", (el) => el.textContent.includes("Our trip to Duluth")), "the thumbnail follows");
  await shot(a, "01-title");

  console.log("New slides, layouts");
  await a.click(".sl-toolbar [data-act=new-slide]");
  await wait(120);
  check(await S(a, () => window.__S.model.slideIds().length) === 2, "New slide adds a slide");
  check(await S(a, () => window.__S.model.slide(window.__S.st.slide).layout) === "title-body", "after a title slide comes Title and body");
  await S(a, () => window.__S.runAct("panel", "layout"));
  await wait(80);
  check(await a.$$eval(".sl-layout-card", (els) => els.length) === 11, "the layout panel lists 11 layouts");
  await a.click(".sl-layout-card[data-k=two-col]");
  await wait(80);
  check(await S(a, () => window.__S.model.items(window.__S.st.slide).map((i) => i.role).sort().join()) === "body,body2,title", "picking Two columns adds the second column");

  console.log("Shapes, moving, resizing, rotating");
  await S(a, () => window.__S.runAct("panel", "layout"));
  await a.click(".sl-toolbar [data-act=shape-menu]");
  await a.click(".sl-shape-btn[data-shape=star5]");
  const p0 = await at(a, 200, 200), p1 = await at(a, 500, 500);
  await a.mouse.move(p0.x, p0.y); await a.mouse.down(); await a.mouse.move(p1.x, p1.y, { steps: 5 }); await a.mouse.up();
  await wait(80);
  let star = (await items(a)).find((i) => i.shape === "star5");
  check(!!star && Math.abs(star.w - 300) < 3 && Math.abs(star.h - 300) < 3, "dragging draws a star of that size", JSON.stringify(star && { w: star.w, h: star.h }));
  const sc = await itemCenter(a, star.id);
  const dest = await at(a, star.x + star.w / 2 + 400, star.y + star.h / 2 + 50);
  await a.mouse.move(sc.x, sc.y); await a.mouse.down(); await a.mouse.move(dest.x, dest.y, { steps: 6 }); await a.mouse.up();
  await wait(80);
  star = (await items(a)).find((i) => i.shape === "star5");
  check(Math.abs(star.x - 600) < 12 && Math.abs(star.y - 250) < 12, "dragging moves it", `${star.x},${star.y}`);
  const se = await a.$eval(".sl-sel .sl-handle[data-h=se]", (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const s = await S(a, () => window.__S.st.scale);
  await a.mouse.move(se.x, se.y); await a.mouse.down(); await a.mouse.move(se.x + 100 * s, se.y + 50 * s, { steps: 4 }); await a.mouse.up();
  await wait(80);
  star = (await items(a)).find((i) => i.shape === "star5");
  check(Math.abs(star.w - 400) < 10 && Math.abs(star.h - 350) < 10, "the corner handle resizes it", `${star.w}x${star.h}`);
  const rotH = await a.$eval(".sl-sel .sl-rot", (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const c2 = await itemCenter(a, star.id);
  await a.mouse.move(rotH.x, rotH.y); await a.mouse.down(); await a.mouse.move(c2.x + 200, c2.y, { steps: 6 }); await a.mouse.up();
  await wait(80);
  star = (await items(a)).find((i) => i.shape === "star5");
  check(Math.abs(star.rot - 90) < 1, "the rotate handle turns it (snapping to 90°)", String(star.rot));
  await a.keyboard.press("Control+z"); await wait(80);
  star = (await items(a)).find((i) => i.shape === "star5");
  check(!star.rot, "undo puts the rotation back", String(star.rot));

  console.log("Colours, stacking, grouping, copy/paste");
  await a.click(".sl-toolbar [data-act=fill-color]");
  await a.click(".sl-pop .sl-swatch[data-color='@a2']");
  await wait(60);
  check((await items(a)).find((i) => i.shape === "star5").fill === "@a2", "fill colour from the theme is stored as a theme role");
  await a.keyboard.press("Control+d"); await wait(80);
  check((await items(a)).filter((i) => i.shape === "star5").length === 2, "Ctrl+D duplicates");
  await a.keyboard.press("Control+a"); await wait(30);
  await a.keyboard.press("Control+g"); await wait(60);
  const grps = new Set((await items(a)).map((i) => i.grp));
  check(grps.size === 1 && !grps.has(undefined), "Ctrl+A then Ctrl+G groups everything");
  await a.keyboard.press("Control+Shift+g"); await wait(60);
  check((await items(a)).every((i) => !i.grp), "Ctrl+Shift+G ungroups");
  await a.keyboard.press("Escape");
  await shot(a, "02-shapes");

  console.log("Themes");
  await S(a, () => window.__S.runAct("panel", "theme"));
  await wait(60);
  await a.click(".sl-theme-card[data-k=urbangreens]");
  await wait(120);
  check(await S(a, () => window.__S.model.theme().id) === "urbangreens", "picking Urban Greens changes the theme");
  check(await a.$eval(".sl-stage .sl-slide", (el) => getComputedStyle(el).backgroundColor) === "rgb(255, 255, 255)", "the slide follows the theme");
  await shot(a, "03-theme");
  await S(a, () => window.__S.panels.close());

  console.log("Filmstrip: reorder and delete");
  await S(a, () => window.__S.goSlide(window.__S.model.slideIds()[0]));
  await a.click(".sl-toolbar [data-act=new-slide]"); await wait(80);
  const before = await S(a, () => window.__S.model.slideIds());
  const thumbs = await a.$$("[data-film] [data-thumb]");
  const b0 = await thumbs[0].boundingBox(), b2 = await thumbs[2].boundingBox();
  await a.mouse.move(b0.x + 20, b0.y + 20); await a.mouse.down(); await a.mouse.move(b2.x + 20, b2.y + b2.height - 2, { steps: 8 }); await a.mouse.up();
  await wait(120);
  const after = await S(a, () => window.__S.model.slideIds());
  check(after[after.length - 1] === before[0] || after[1] === before[0], "dragging a thumbnail reorders slides", JSON.stringify([before, after]));

  console.log("Two people");
  const b = await openAs("marijane");
  await wait(600);
  check(await S(b, () => window.__S.model.slideIds().length) === 3, "Marijane sees the three slides");
  await S(a, () => { const S = window.__S; S.goSlide(S.model.slideIds()[0]); });
  await S(b, () => { const S = window.__S; S.goSlide(S.model.slideIds()[0]); });
  const firstTitle = await S(b, () => { const S = window.__S; return S.model.items(S.st.slide).find((i) => i.role === "title")?.id; });
  await S(b, (id) => window.__S.select([id]), firstTitle);
  await wait(400);
  check(await a.$(".sl-peer-sel") !== null, "Luke sees what Marijane has selected");
  await S(a, () => { const S = window.__S; const id = S.model.addItem(S.st.slide, { t: "shape", shape: "heart", x: 100, y: 100, w: 200, h: 200 }); S.renderStage(); return id; });
  await wait(700);
  check(await S(b, () => window.__S.model.items(window.__S.st.slide).some((i) => i.shape === "heart")), "Marijane sees Luke's new heart live");
  check(await b.$(".sl-stage .sl-shape svg path") !== null, "and it's drawn on her slide");
  await b.close();

  console.log("Saving");
  await S(a, () => window.__S.session.save());
  check(await S(a, () => window.__saves > 0), "the presentation is saved");
  await a.close();

  console.log("Phone");
  const p = await openAs("luke", { size: { width: 390, height: 844 }, query: "&view=1" });
  check(await p.$eval(".sl-root", (el) => el.classList.contains("is-viewing")), "the phone opens to view");
  check(await p.$eval("[data-act=start-edit]", (el) => !el.hidden), "the pencil shows");
  const box = await p.$eval("[data-stage]", (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  check(box.w <= 390 && box.w > 300, "the slide fits the phone's width", String(box.w));
  await p.mouse.move(box.x + box.w * 0.8, box.y + box.h / 2); await p.mouse.down(); await p.mouse.move(box.x + box.w * 0.1, box.y + box.h / 2, { steps: 4 }); await p.mouse.up();
  await wait(100);
  check(await S(p, () => window.__S.model.slideIds().indexOf(window.__S.st.slide)) === 1, "a swipe goes to the next slide");
  await shot(p, "04-phone-view");
  await p.click("[data-act=start-edit]"); await wait(80);
  check(await p.$eval("[data-act=insert-menu]", (el) => !el.hidden), "editing shows the + button");
  const widths = await p.evaluate(() => document.documentElement.scrollWidth);
  check(widths <= 390, "nothing sticks out sideways on the phone", String(widths));
  await shot(p, "05-phone-edit");
  await p.close();
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
