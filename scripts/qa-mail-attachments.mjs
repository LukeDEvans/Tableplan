// npm run qa:mail-attachments  (dev server running: npm run dev:local)
// Drives the REAL attachment chips → openMailAttachment → in-app viewer at phone
// width, against faked Gmail endpoints (no network, no Supabase). The hook line
// appended to app.js as the dev server serves it is test-only. Covers:
//   • gmail-attachment deployed: PDF / image / text render inside the app, a .docx
//     gets Download + Open in Gmail, an HTML attachment is never rendered
//   • gmail-attachment not deployed (404): falls back to the base64 action
//   • over-cap files go to Gmail; the viewer fits a 360px phone; closing cleans up
import { chromium } from "playwright";
import { existsSync } from "node:fs";
const URL = process.argv[2] || "http://localhost:4174/";
async function launch() {
  const args = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
  try { return await chromium.launch({ ...args, channel: "chrome" }); } catch { /* not here */ }
  try { return await chromium.launch(args); } catch { /* not here */ }
  const sandbox = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(sandbox)) return chromium.launch({ ...args, executablePath: sandbox });
  throw new Error("No Chromium found");
}

// A tiny real PDF and PNG, so the viewer has something genuine to render.
const PDF = Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
trailer<</Root 1 0 R>>
%%EOF`);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const FILES = {
  pdf: { filename: "schedule.pdf", mimeType: "application/pdf", bytes: PDF },
  png: { filename: "photo.png", mimeType: "image/png", bytes: PNG },
  txt: { filename: "notes.txt", mimeType: "text/plain", bytes: Buffer.from("Line one\nLine two <b>not bold</b>") },
  docx: { filename: "Contract.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: Buffer.from("PK\x03\x04fake") },
  html: { filename: "invoice.html", mimeType: "text/html", bytes: Buffer.from("<script>window.parent.__pwned=1</script><h1>hi</h1>") },
  big: { filename: "huge.pdf", mimeType: "application/pdf", bytes: Buffer.from("x"), size: 25_000_000 },
  mid: { filename: "medium.pdf", mimeType: "application/pdf", bytes: PDF, size: 5_000_000 }
};

const results = [];
const check = (name, cond, extra = "") => results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);

async function run({ deployed }) {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, hasTouch: true, isMobile: true, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  const calls = { stream: 0, legacy: 0 };
  const popups = [];
  page.on("pageerror", (e) => errors.push(e.message));
  ctx.on("page", (p) => popups.push(p.url()));
  await page.addInitScript(() => { window.open = (u) => { (window.__opened ||= []).push(String(u)); return null; }; });
  await page.route(/\/app\.js(\?.*)?$/, async (route) => {
    const res = await route.fetch();
    const body = await res.text();
    await route.fulfill({ response: res, body: body + `
;mailSessionToken = async () => "tok"; callGmailApi = async (body) => { const r = await fetch("/.netlify/functions/gmail", { method: "POST", body: JSON.stringify(body) }); return r.ok ? r.json() : null; };
window.__att = { renderMailMessage, openMailAttachment };
` });
  });
  await page.route("**/.netlify/functions/gmail-attachment", async (route) => {
    calls.stream++;
    if (!deployed) return route.fulfill({ status: 404, body: "Not found" });
    const { attachmentId } = JSON.parse(route.request().postData() || "{}");
    const f = FILES[attachmentId];
    if (route.request().headers().authorization !== "Bearer tok") return route.fulfill({ status: 401, body: "{}" });
    return route.fulfill({ status: 200, contentType: "application/octet-stream", body: f.bytes });
  });
  await page.route("**/.netlify/functions/gmail", async (route) => {
    const a = JSON.parse(route.request().postData() || "{}");
    if (a.action === "attachment") {
      calls.legacy++;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: FILES[a.attachmentId].bytes.toString("base64url") }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.querySelector("#lockDevSignInBtn")?.offsetParent != null), null, { timeout: 60000 });
  if (await page.isVisible("#lockDevSignInBtn")) await page.tap("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"));
  await page.waitForTimeout(500);
  check(`[${deployed ? "deployed" : "not deployed"}] hook installed`, await page.evaluate(() => !!window.__att));

  // Render the real chips for one message and wire them the way renderMailThread does.
  await page.evaluate((files) => {
    const msg = { id: "m1", threadId: "t1", from: "A <a@x.com>", snippet: "s", date: new Date().toUTCString(),
      attachments: Object.entries(files).map(([id, f]) => ({ attachmentId: id, filename: f.filename, mimeType: f.mimeType, size: f.size || f.len, inline: false })) };
    const host = document.createElement("div");
    host.id = "qaMail";
    host.innerHTML = window.__att.renderMailMessage(msg, 0);
    document.body.appendChild(host);
    host.querySelectorAll(".mail-attachment-chip").forEach((chip) => chip.addEventListener("click", (e) => { e.stopPropagation(); window.__att.openMailAttachment(chip); }));
  }, Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, { filename: f.filename, mimeType: f.mimeType, size: f.size, len: f.bytes.length }])));

  const tag = deployed ? "deployed" : "fallback";
  const open = async (id) => {
    await page.evaluate((id) => document.querySelector(`#qaMail [data-att-id="${id}"]`).click(), id);
    await page.waitForTimeout(500);
  };
  const viewer = () => page.evaluate(() => {
    const d = document.getElementById("mailAttachmentViewer");
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return {
      open: d.open, name: d.querySelector(".mail-att-viewer-name")?.textContent,
      pdf: d.querySelector("iframe.mail-att-viewer-pdf")?.src || "", img: d.querySelector("img")?.naturalWidth ?? null,
      text: d.querySelector("pre")?.textContent || "", empty: !!d.querySelector(".mail-att-viewer-empty"),
      anyFrameOrScript: d.querySelectorAll("iframe:not(.mail-att-viewer-pdf), script, object, embed").length,
      fits: r.width <= window.innerWidth && document.documentElement.scrollWidth <= window.innerWidth
    };
  });
  const close = () => page.evaluate(() => document.querySelector("#mailAttachmentViewer .mail-att-viewer-close")?.click());

  await open("pdf");
  let v = await viewer();
  check(`[${tag}] PDF opens in the in-app viewer`, v?.open && v.pdf.startsWith("blob:") && v.name === "schedule.pdf", JSON.stringify(v));
  check(`[${tag}] viewer fits a 360px phone`, v?.fits);
  const pdfType = await page.evaluate(async () => { const f = document.querySelector("iframe.mail-att-viewer-pdf"); return f ? (await (await fetch(f.src)).blob()).type : "no frame"; });
  check(`[${tag}] PDF blob is application/pdf`, pdfType === "application/pdf", pdfType);
  await close(); await page.waitForTimeout(150);
  check(`[${tag}] closing removes the viewer`, (await viewer()) === null);

  await open("png");
  v = await viewer();
  if (process.env.QA_SHOT_DIR) await page.screenshot({ path: `${process.env.QA_SHOT_DIR}/att-png-${tag}.png` });
  check(`[${tag}] image renders`, v?.img === 1, JSON.stringify(v));
  await close(); await page.waitForTimeout(100);

  await open("txt");
  v = await viewer();
  check(`[${tag}] text shows as text (no HTML parsed)`, v?.text.includes("<b>not bold</b>") && v.text.startsWith("Line one"), v?.text);
  await close(); await page.waitForTimeout(100);

  await open("docx");
  v = await viewer();
  check(`[${tag}] Word file offers Download + Open in Gmail`, v?.empty === true);
  if (process.env.QA_SHOT_DIR) await page.screenshot({ path: `${process.env.QA_SHOT_DIR}/att-docx-${tag}.png` });
  const dl = page.waitForEvent("download", { timeout: 3000 }).catch(() => null);
  await page.evaluate(() => document.querySelector("#mailAttachmentViewer [data-att-download]").click());
  const d = await dl;
  check(`[${tag}] Download saves with its filename`, d?.suggestedFilename() === "Contract.docx", d?.suggestedFilename());
  await close(); await page.waitForTimeout(100);

  await open("html");
  v = await viewer();
  const pwned = await page.evaluate(() => window.__pwned === 1);
  check(`[${tag}] HTML attachment is never rendered`, v?.empty === true && v.anyFrameOrScript === 0 && !pwned);
  await close(); await page.waitForTimeout(100);

  await open("big");
  const opened = await page.evaluate(() => window.__opened || []);
  check(`[${tag}] over-cap file opens Gmail, not a download`, opened.some((u) => u.startsWith("https://mail.google.com/")) && (await viewer()) === null, opened.join(","));

  await page.evaluate(() => { window.__opened = []; });
  await open("mid");
  const midOpened = await page.evaluate(() => window.__opened || []);
  const mv = await viewer();
  if (deployed) check(`[${tag}] a 5MB file (over the old 3.5MB cap) opens in the app`, mv?.open === true && midOpened.length === 0);
  else check(`[${tag}] a 5MB file goes to Gmail while only the old action exists`, midOpened.length === 1 && mv === null);
  await close();

  if (deployed) check(`[${tag}] streamed endpoint used, legacy action not`, calls.stream >= 5 && calls.legacy === 0, JSON.stringify(calls));
  else check(`[${tag}] after one 404, the base64 action serves the rest`, calls.stream === 1 && calls.legacy >= 4, JSON.stringify(calls));
  check(`[${tag}] no new tabs/windows`, popups.length === 0, popups.join(","));
  check(`[${tag}] no uncaught errors`, errors.length === 0, errors.join(" | "));
  await browser.close();
}

await run({ deployed: true });
await run({ deployed: false });
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(failed ? `\n✖ ${failed} check(s) failed` : `\n✓ ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
