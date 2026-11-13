// npm run qa:mail-attachments  (dev server running: npm run dev:local)
// Drives the REAL attachment chips → openMailAttachment → in-app viewer at phone
// width, against faked Gmail endpoints (no network, no Supabase). The hook line
// appended to app.js as the dev server serves it is test-only. Covers:
//   • gmail-attachment deployed: PDF / image / text render inside the app, a .docx
//     gets Download + Open in Gmail, an HTML attachment is never rendered
//   • a CSV shows as a table, an invite as its event (Add to Calendar fills the event
//     editor), a contact card as its contact (Add to Contacts imports it), audio
//     gets a player; markup inside any of them stays text
//   • gmail-attachment not deployed (404): falls back to the base64 action
//   • over-cap files go to Gmail; the viewer fits a 360px phone; closing cleans up
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
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
// A small real Word file: a heading, a paragraph with bold text, and text that
// looks like markup (it must come out as text).
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const REAL_DOCX = Buffer.from(zipSync({
  "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  "_rels/.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  "word/document.xml": strToU8(`<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Lease summary</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Rent is due on the </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>first</w:t></w:r><w:r><w:t xml:space="preserve"> of the month. &lt;img src=x onerror=window.__pwned=1&gt;</w:t></w:r></w:p></w:body></w:document>`)
}));
const FILES = {
  pdf: { filename: "schedule.pdf", mimeType: "application/pdf", bytes: PDF },
  png: { filename: "photo.png", mimeType: "image/png", bytes: PNG },
  txt: { filename: "notes.txt", mimeType: "text/plain", bytes: Buffer.from("Line one\nLine two <b>not bold</b>") },
  docx: { filename: "Contract.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: Buffer.from("PK\x03\x04fake") },
  html: { filename: "invoice.html", mimeType: "text/html", bytes: Buffer.from("<script>window.parent.__pwned=1</script><h1>hi</h1>") },
  word: { filename: "Lease summary.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes: REAL_DOCX },
  csv: { filename: "roster.csv", mimeType: "text/csv", bytes: Buffer.from('Name,Note\r\n"Evans, Luke","<img src=x onerror=window.__pwned=1>"\r\nSam,ok\r\n') },
  ics: { filename: "invite.ics", mimeType: "text/calendar", bytes: Buffer.from(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:qa-1", "SUMMARY:Dentist <b>x</b>", "DTSTART:20261120T140000", "DTEND:20261120T150000", "LOCATION:12 Main St", "DESCRIPTION:Bring the form", "END:VEVENT", "END:VCALENDAR"].join("\r\n")) },
  vcf: { filename: "Sam.vcf", mimeType: "text/plain", bytes: Buffer.from(["BEGIN:VCARD", "VERSION:3.0", "FN:Sam Qa-Tester", "TEL;TYPE=CELL:555-0100", "EMAIL:sam@example.com", "PHOTO;VALUE=URI:https://tracker.example/p.png", "END:VCARD"].join("\r\n")) },
  mp3: { filename: "memo.mp3", mimeType: "audio/mpeg", bytes: Buffer.from("ID3\x03\x00\x00\x00\x00\x00\x00") },
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
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (e) => errors.push(e.message));
  ctx.on("page", (p) => popups.push(p.url()));
  await page.addInitScript(() => { window.open = (u) => { (window.__opened ||= []).push(String(u)); return null; }; });
  await page.route(/\/app\.js(\?.*)?$/, async (route) => {
    const res = await route.fetch();
    const body = await res.text();
    await route.fulfill({ response: res, body: body + `
;mailSessionToken = async () => "tok"; callGmailApi = async (body) => { const r = await fetch("/.netlify/functions/gmail", { method: "POST", body: JSON.stringify(body) }); return r.ok ? r.json() : null; };
window.__att = { renderMailMessage, openMailAttachment, contactCount: () => (state.contacts || []).length, hasContact: (n) => (state.contacts || []).some((c) => c.name === n), dropContact: (n) => { state.contacts = (state.contacts || []).filter((c) => c.name !== n); } };
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
      text: d.querySelector("pre")?.textContent || "", empty: !!d.querySelector(".mail-att-viewer-empty"), emptyText: d.querySelector(".mail-att-viewer-empty p")?.textContent || "", kind: d.dataset.kind,
      cells: [...d.querySelectorAll(".mail-att-table th, .mail-att-table td")].map((c) => c.textContent),
      cardTitle: d.querySelector(".mail-att-card-title")?.textContent || "", fields: [...d.querySelectorAll(".mail-att-field")].map((f) => f.textContent),
      audio: d.querySelector("audio")?.src || "", imgs: d.querySelectorAll(".mail-att-viewer-body img").length, innerEls: d.querySelectorAll(".mail-att-viewer-body b, .mail-att-table img").length,
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
  check(`[${tag}] a Word file that can't be read offers Download + Open in Gmail, with the reason`, v?.empty === true && /Word/.test(v.emptyText), v?.emptyText);
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

  // A real Word file opens in the word processor, view only.
  const netBefore = requests.length;
  await open("word");
  await page.waitForSelector(".wp-root.is-preview .ProseMirror", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  const wp = await page.evaluate(() => {
    const r = document.querySelector(".wp-root.is-preview");
    if (!r) return null;
    const pm = r.querySelector("[data-doc] .ProseMirror");
    const shown = (sel) => { const e = r.querySelector(sel); return !!e && getComputedStyle(e).display !== "none"; };
    return {
      text: pm?.textContent || "", h1: pm?.querySelector("h1")?.textContent || "", bold: pm?.querySelector("strong")?.textContent || "",
      editable: pm?.getAttribute("contenteditable"), imgs: pm?.querySelectorAll("img").length, name: r.querySelector(".wp-title input")?.value, nameReadOnly: r.querySelector(".wp-title input")?.readOnly,
      status: r.querySelector(".wp-status")?.textContent, toolbar: shown("[data-toolbar]"), menubar: shown("[data-menubar]"), mode: shown("[data-mode]"), keep: !!r.querySelector("[data-act=keep]"),
      fits: document.documentElement.scrollWidth <= window.innerWidth, mailViewer: !!document.getElementById("mailAttachmentViewer")
    };
  });
  if (process.env.QA_SHOT_DIR) await page.screenshot({ path: `${process.env.QA_SHOT_DIR}/att-word-${tag}.png` });
  check(`[${tag}] Word file opens in the word processor`, wp?.text.startsWith("Lease summary") && wp.bold === "first" && wp.text.includes("Rent is due on the first of the month.") && wp.name === "Lease summary" && !wp.mailViewer, JSON.stringify(wp));
  check(`[${tag}] it is view only (no editing, no toolbar, name locked)`, wp?.editable === "false" && !wp.toolbar && !wp.menubar && !wp.mode && wp.nameReadOnly === true && /view only/i.test(wp.status || ""), JSON.stringify(wp));
  check(`[${tag}] markup in the Word file stays text`, wp?.imgs === 0 && wp.text.includes("<img src=x onerror=window.__pwned=1>") && !(await page.evaluate(() => window.__pwned === 1)));
  check(`[${tag}] word processor preview fits a 360px phone`, wp?.fits);
  await page.evaluate(() => { const pm = document.querySelector(".wp-root.is-preview [data-doc] .ProseMirror"); pm?.focus(); });
  await page.keyboard.type("zzz");
  await page.waitForTimeout(200);
  check(`[${tag}] typing changes nothing`, !(await page.evaluate(() => document.querySelector(".wp-root.is-preview [data-doc] .ProseMirror")?.textContent.includes("zzz"))));
  await page.evaluate(() => document.querySelector(".wp-root.is-preview [data-act=close]").click());
  await page.waitForTimeout(500);
  const wrote = requests.slice(netBefore).filter((u) => !/gmail|localhost:4174\/(?!\.netlify)|^blob:|^data:/.test(u));
  check(`[${tag}] closing removes it, and nothing was sent or stored`, !(await page.evaluate(() => !!document.querySelector(".wp-root"))) && wrote.length === 0, wrote.join(","));
  const kept = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => /doc/i.test(n || "")));
  check(`[${tag}] no device copy of the preview`, kept.every((n) => !/preview/i.test(n)), kept.join(","));

  await open("csv");
  v = await viewer();
  if (process.env.QA_SHOT_DIR) await page.screenshot({ path: `${process.env.QA_SHOT_DIR}/att-csv-${tag}.png` });
  check(`[${tag}] CSV shows as a table`, v?.kind === "csv" && v.cells.join("|") === "Name|Note|Evans, Luke|<img src=x onerror=window.__pwned=1>|Sam|ok", JSON.stringify(v?.cells));
  check(`[${tag}] markup in a CSV cell stays text`, v?.innerEls === 0 && !(await page.evaluate(() => window.__pwned === 1)));
  check(`[${tag}] table viewer fits a 360px phone`, v?.fits);
  await close(); await page.waitForTimeout(100);

  await open("ics");
  v = await viewer();
  if (process.env.QA_SHOT_DIR) await page.screenshot({ path: `${process.env.QA_SHOT_DIR}/att-ics-${tag}.png` });
  check(`[${tag}] invite shows its event`, v?.kind === "invite" && v.cardTitle === "Dentist <b>x</b>" && v.fields.some((f) => f.includes("12 Main St")) && v.fields.some((f) => /Nov 20, 2026/.test(f)), JSON.stringify(v));
  check(`[${tag}] invite viewer fits a 360px phone`, v?.fits && v.innerEls === 0);
  await page.evaluate(() => document.querySelector("#mailAttachmentViewer .mail-att-card-action").click());
  await page.waitForTimeout(400);
  const ed = await page.evaluate(() => ({
    open: document.getElementById("planEventDialog")?.open, title: document.getElementById("planEventTitle")?.value, date: document.getElementById("planEventDate")?.value,
    allDay: document.getElementById("planEventAllDay")?.checked, notes: document.getElementById("planEventNotes")?.value, place: document.getElementById("planEventLocation")?.value,
    viewerGone: !document.getElementById("mailAttachmentViewer")
  }));
  check(`[${tag}] Add to Calendar opens the event editor filled in`, ed.open && ed.viewerGone && ed.title === "Dentist <b>x</b>" && ed.date === "2026-11-20" && ed.allDay === false && ed.notes === "Bring the form" && ed.place === "12 Main St", JSON.stringify(ed));
  await page.evaluate(() => document.getElementById("planEventDialog")?.close());
  await page.waitForTimeout(100);

  await open("vcf");
  v = await viewer();
  if (process.env.QA_SHOT_DIR) await page.screenshot({ path: `${process.env.QA_SHOT_DIR}/att-vcf-${tag}.png` });
  check(`[${tag}] contact card shows its contact (labelled text/plain)`, v?.kind === "contact" && v.cardTitle === "Sam Qa-Tester" && v.fields.some((f) => f.includes("555-0100")) && v.fields.some((f) => f.includes("sam@example.com")), JSON.stringify(v));
  check(`[${tag}] a contact's remote photo is never loaded`, v?.imgs === 0);
  const before = await page.evaluate(() => { window.__att.dropContact("Sam Qa-Tester"); return window.__att.contactCount(); }); // a dev-state leftover would ask merge / skip
  await page.evaluate(() => document.querySelector("#mailAttachmentViewer .mail-att-cards-action").click());
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ n: window.__att.contactCount(), has: window.__att.hasContact("Sam Qa-Tester"), viewerGone: !document.getElementById("mailAttachmentViewer") }));
  check(`[${tag}] Add to Contacts imports it`, after.n === before + 1 && after.has && after.viewerGone, JSON.stringify({ before, after }));

  await open("mp3");
  v = await viewer();
  const audioType = await page.evaluate(async () => { const a = document.querySelector("#mailAttachmentViewer audio"); return a ? (await (await fetch(a.src)).blob()).type : "no player"; });
  check(`[${tag}] audio gets a player with a fixed type`, v?.kind === "audio" && v.audio.startsWith("blob:") && audioType === "audio/mpeg", audioType);
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

  if (deployed) check(`[${tag}] streamed endpoint used, legacy action not`, calls.stream >= 10 && calls.legacy === 0, JSON.stringify(calls));
  else check(`[${tag}] after one 404, the base64 action serves the rest`, calls.stream === 1 && calls.legacy >= 9, JSON.stringify(calls));
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
