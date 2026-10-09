// Headless browser check for the mail reading frame (mail-frame.js).
//
// Why this exists: the frame's behavior — when it becomes readable, which
// images it fetches — only exists in a real browser, so the unit suite can't
// see it. This serves the real, un-bundled mail-frame.js to Chromium next to a
// local "sender" whose images are deliberately slow, builds frames exactly as
// app.js does, and checks what was requested and when.
//
// Usage:  node scripts/check-mail-frame.mjs        (npm run check:mail-frame)
// Self-contained: starts its own server on a free port. Exit 0 = pass.

import { chromium } from "playwright";
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE_DELAY_MS = 2500;   // every remote image takes this long to arrive
const READY_BUDGET_MS = 1000;  // the email must be readable well inside that

// 1×1 transparent GIF; the "sender" answers every image request with it.
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const requested = []; // image paths the browser actually asked the sender for

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/sender/")) {
    requested.push(url.pathname + url.search);
    setTimeout(() => { res.writeHead(200, { "content-type": "image/gif", "cache-control": "no-store" }); res.end(GIF); }, IMAGE_DELAY_MS);
    return;
  }
  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><meta charset="utf-8"><style>
      body{margin:0} #pane{width:380px;height:700px;overflow:auto}
      .mail-msg-frame{display:block;width:100%;border:0;min-height:40px}</style>
      <div id="pane"></div>
      <script type="module">
        import * as mf from "/mail-frame.js";
        window.mf = mf;
        // Mounts one email the way app.js does and resolves when it is readable.
        window.mount = (html, opts = {}) => new Promise((resolve) => {
          const pane = document.getElementById("pane");
          pane.innerHTML = ""; pane.scrollTop = 0;
          const t0 = performance.now();
          const frame = mf.buildMailBodyFrame(html, {
            showImages: opts.showImages !== false,
            inlineImages: opts.inlineImages,
            onReady: (iframe, doc) => {
              // two frames later the first fit has been applied and painted
              requestAnimationFrame(() => requestAnimationFrame(() => resolve({
                readyMs: Math.round(performance.now() - t0),
                height: iframe.getBoundingClientRect().height,
                bodyText: doc.body.textContent.replace(/\\s+/g, " ").trim().slice(0, 60),
                styleBlocks: doc.body.querySelectorAll("style").length,
              })));
            },
          });
          window.frame = frame;
          pane.appendChild(frame);
        });
        window.harnessReady = true;
      </script>`);
    return;
  }
  const file = path.join(ROOT, path.normalize(url.pathname));
  if (!file.startsWith(ROOT) || !/\.(m?js)$/.test(file) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": "text/javascript" });
  res.end(readFileSync(file));
});

const LAUNCH_ARGS = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
async function launch() {
  try { return await chromium.launch({ ...LAUNCH_ARGS, channel: "chrome" }); } catch {}
  try { return await chromium.launch(LAUNCH_ARGS); } catch {}
  // Cloud sandbox: one pre-provisioned Chromium at a version-independent path
  // (see scripts/check-boot.mjs for the full story). Never `playwright install`.
  const sandboxChrome = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(sandboxChrome)) return await chromium.launch({ ...LAUNCH_ARGS, executablePath: sandboxChrome });
  throw new Error("No Chromium available for the mail frame check.");
}

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✖"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const img = (name, attrs = "") => `<img src="${base}/sender/${name}" ${attrs}>`;
const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(base + "/");
  await page.waitForFunction(() => window.harnessReady === true);
  const asked = (re) => requested.filter((p) => re.test(p)).length;

  // ── 1. A newsletter with 30 slow images is readable before any arrives ──
  requested.length = 0;
  const newsletter =
    `<html><head><style>@media (max-width:600px){.w{width:100%!important}}</style></head><body>
      <table class="w" width="600"><tr><td><h1>Weekly digest</h1><p>${"Body text. ".repeat(60)}</p>
      ${Array.from({ length: 30 }, (_, i) => img(`photo-${i}.gif`, 'width="560" height="200"')).join("")}
      </td></tr></table></body></html>`;
  const r1 = await page.evaluate((h) => window.mount(h), newsletter);
  check("email is readable before its images arrive", r1.readyMs < READY_BUDGET_MS,
    `ready in ${r1.readyMs}ms with every image delayed ${IMAGE_DELAY_MS}ms`);
  check("frame is sized to the email, not left at its minimum height", r1.height > 400, `${Math.round(r1.height)}px`);
  check("the email's own stylesheet is kept", r1.styleBlocks >= 1);

  // ── 2. Which images are fetched (few enough that none queue in the browser) ──
  requested.length = 0;
  const mixed = `<p>Hello.</p>${img("photo.gif", 'width="300" height="100"')}
      ${img("pixel-attr.gif", 'width="1" height="1"')}
      ${img("pixel-style.gif", 'style="width:1px;height:1px"')}
      ${img("track/open.php?u=abc")}
      ${img("hidden.gif", 'style="display:none" width="300" height="100"')}
      <picture><source srcset="${base}/sender/picture-source.gif"><img src="${base}/sender/picture-img.gif" width="300" height="100"></picture>`;
  await page.evaluate((h) => window.mount(h), mixed);
  await page.waitForTimeout(700);
  check("a visible image is requested", asked(/photo\.gif/) === 1);
  check("a <picture> image is requested through its source", asked(/picture-source\.gif/) === 1);
  check("1×1 pixels are never requested", asked(/pixel-(attr|style)\.gif/) === 0);
  check("known open-tracking URLs are never requested", asked(/track\/open/) === 0);
  check("an image the email hides is never requested", asked(/hidden\.gif/) === 0);
  const trackersRemoved = await page.evaluate(() => Number(window.frame.dataset.trackersRemoved));
  check("tracker count is reported on the frame", trackersRemoved === 3, `removed ${trackersRemoved}`);
  // (a request the previous email had already queued can still arrive; it isn't this email's)
  const mine = requested.filter((p) => !/photo-\d+\.gif/.test(p));
  check("nothing else was requested", mine.length === 2, mine.join(", "));

  // ── 2b. Images far below the screen wait until scrolled near ──
  for (const [label, wrapOpen, wrapClose] of [
    ["", "", ""],
    // a fixed 900px layout in a 380px pane: the frame zooms it down to fit
    [" (zoomed-down email)", '<div style="width:900px;min-width:900px">', "</div>"],
  ]) {
    requested.length = 0;
    const tall = `${wrapOpen}<p>Top of a long email.</p>${img("top.gif", 'width="300" height="100"')}
      <div style="height:14000px">spacer</div>${img("bottom.gif", 'width="300" height="100"')}${wrapClose}`;
    await page.evaluate((h) => window.mount(h), tall);
    await page.waitForTimeout(500);
    const zoom = await page.evaluate(() => window.frame.contentDocument.body.style.zoom || "1");
    check(`an image at the top loads right away${label}`, asked(/top\.gif/) === 1, `zoom ${zoom}`);
    if (label) check("that email really is zoomed down", Number(zoom) < 0.6, `zoom ${zoom}`);
    check(`an image far below is not loaded yet${label}`, asked(/bottom\.gif/) === 0);
    // scroll to just short of it: still more than a screen away
    await page.evaluate(() => { const p = document.getElementById("pane"); p.scrollTop = (p.scrollHeight - p.clientHeight) / 2; });
    await page.waitForTimeout(400);
    check(`still not loaded half way down${label}`, asked(/bottom\.gif/) === 0);
    await page.evaluate(() => { const p = document.getElementById("pane"); p.scrollTop = p.scrollHeight; });
    await page.waitForTimeout(600);
    check(`it loads once scrolled to${label}`, asked(/bottom\.gif/) === 1);
  }

  // ── 3. The frame keeps growing as images settle ──
  const grow = `<p>Short.</p>${img("big.gif", 'style="width:300px;height:900px"')}`;
  await page.evaluate((h) => window.mount(h), grow);
  const hGrow = await page.evaluate(() => window.frame.getBoundingClientRect().height);
  check("frame height covers an image's reserved space", hGrow >= 900, `${Math.round(hGrow)}px`);
  const unsized = `<p>Short.</p>${img("late.gif", 'class="late"')}<style>.late{display:block}</style>`;
  await page.evaluate((h) => window.mount(h), unsized);
  const hBefore = await page.evaluate(() => window.frame.getBoundingClientRect().height);
  // Stand in for a tall picture finishing: give the loaded image real height.
  await page.waitForTimeout(IMAGE_DELAY_MS + 400);
  await page.evaluate(() => { window.frame.contentDocument.querySelector(".late").style.cssText = "display:block;width:200px;height:700px"; });
  await page.waitForTimeout(300);
  const hAfter = await page.evaluate(() => window.frame.getBoundingClientRect().height);
  check("frame re-fits when content grows after it was first shown", hAfter >= 700 && hAfter > hBefore, `${Math.round(hBefore)}px → ${Math.round(hAfter)}px`);

  // ── 4. Blocking mode fetches nothing ──
  requested.length = 0;
  const r4 = await page.evaluate((h) => window.mount(h, { showImages: false }), newsletter);
  await page.waitForTimeout(600);
  const blocked = await page.evaluate(() => Number(window.frame.dataset.blockedImages));
  check("with images blocked, nothing is requested", requested.length === 0, `${requested.length} requests`);
  check("blocked count drives the Display images menu item", blocked >= 30, `${blocked} blocked`);
  check("blocked email is readable just as fast", r4.readyMs < READY_BUDGET_MS, `${r4.readyMs}ms`);

  // ── 5. Embedded (cid:) images are filled from the message's attachments ──
  const cidResult = await page.evaluate(async (gifB64) => {
    const calls = [];
    const b64url = gifB64.replace(/\+/g, "-").replace(/\//g, "_");
    const atts = [
      { attachmentId: "A1", contentId: "logo@x", mimeType: "image/gif", size: 43, inline: true },
      { attachmentId: "A2", contentId: "vector@x", mimeType: "image/svg+xml", size: 100, inline: true },
      { attachmentId: "A3", contentId: "huge@x", mimeType: "image/png", size: 9000000, inline: true },
    ];
    const html = `<p>Hi</p><img src="cid:logo@x" width="50" height="50"><img src="CID:LOGO@X"><img src="cid:vector@x"><img src="cid:huge@x"><img src="cid:missing@x">`;
    await window.mount(html, { inlineImages: { attachments: atts, load: async (a) => { calls.push(a.attachmentId); return b64url; } } });
    await new Promise((r) => setTimeout(r, 300));
    const imgs = [...window.frame.contentDocument.querySelectorAll("img")];
    return {
      calls,
      srcs: imgs.map((i) => (i.getAttribute("src") || "").slice(0, 22)),
      shown: imgs.map((i) => i.getBoundingClientRect().width > 0),
    };
  }, GIF.toString("base64"));
  check("an embedded image is fetched once and shown", cidResult.calls.join() === "A1" && cidResult.srcs[0] === "data:image/gif;base64," && cidResult.shown[0],
    `attachment calls: ${cidResult.calls.join(",") || "none"}`);
  check("a second reference to the same image reuses it", cidResult.srcs[1] === "data:image/gif;base64,");
  check("SVG, oversized and unknown embedded images are left out, with no broken-image box",
    cidResult.srcs.slice(2).every((s) => s === "") && cidResult.shown.slice(2).every((v) => v === false));

  const capResult = await page.evaluate(async (gifB64) => {
    let calls = 0;
    const atts = Array.from({ length: 20 }, (_, i) => ({ attachmentId: `B${i}`, contentId: `c${i}@x`, mimeType: "image/png", size: 10, inline: true }));
    const html = atts.map((a) => `<img src="cid:${a.contentId}">`).join("");
    await window.mount(html, { inlineImages: { attachments: atts, load: async () => { calls++; return gifB64; } } });
    await new Promise((r) => setTimeout(r, 300));
    return { calls, max: window.mf.MAIL_EMBEDDED_IMAGE_MAX };
  }, GIF.toString("base64"));
  check("attachment calls per email are capped", capResult.calls === capResult.max, `${capResult.calls} calls for 20 embedded images`);

  check("no uncaught errors in the page", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\n✖ MAIL FRAME CHECK FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log("\n✓ mail frame check passed");
