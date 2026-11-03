// qa-documents-ui.mjs — the Documents pages (documents/ui.js) end to end in Chromium,
// at phone width, against local stand-ins: a PostgREST-shaped server on PGlite with
// the REAL messaging + Documents migrations and row security, and an in-memory
// object store behind a stand-in for the doc-storage function (same request shape,
// same doc_can_access / doc_blob_deletable checks as the real one).
//
// Three browser profiles: Luke's phone, Luke's laptop browser, Marijane's phone.
//   no messaging yet → set up → Household and Personal vaults, starting folders,
//   recovery code → add an image, a PDF and a text file → view, edit, move, search,
//   Recently deleted → Marijane waits until they verify each other → she gets the
//   key and opens Luke's file → the laptop is linked, gets the key, takes a drop.
// Self-contained (starts Vite and the stand-ins). Screenshots go to the given folder.
//   node scripts/qa-documents-ui.mjs [screenshotDir]
import { createServer as createVite } from "vite";
import { createServer as createHttp } from "node:http";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { createDocumentsDatabase, pgliteTransport, USERS, GROUP } from "../test/documents-pglite-harness.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const SHOTS = process.argv[2] || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const check = (ok, name, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ✔" : "  ✖"} ${name}${ok || !detail ? "" : ` — ${detail}`}`); };

// ---- stand-ins: PostgREST, doc-storage and the object store ------------------------------
const db = await createDocumentsDatabase();
const blobs = new Map();
let appUrl = "";
const UUID_RE = /^[0-9a-f-]{36}$/i;

async function docStorage(uid, body) {
  const t = pgliteTransport(db, uid);
  const { op, items } = JSON.parse(body || "{}");
  if (!["put", "get", "delete"].includes(op) || !Array.isArray(items) || !items.length || items.length > 25) return [400, { error: "request" }];
  for (const s of new Set(items.map((i) => i.scope))) if ((await t.rpc("doc_can_access", { p_scope: s })) !== true) return [403, { error: "scope" }];
  if (op === "delete") for (const i of items) if ((await t.rpc("doc_blob_deletable", { p_scope: i.scope, p_file: i.fileId })) !== true) return [403, { error: "not deletable yet" }];
  return [200, { urls: items.map((i) => ({ url: `${appUrl}/blob/${i.scope}/${i.fileId}/${i.part}?op=${op}`, headers: {} })) }];
}

const api = createHttp(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") { res.end(); return; }
  const uid = (req.headers.authorization || "").replace(/^Bearer /, "");
  const url = new URL(req.url, "http://x");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  try {
    if (url.pathname.startsWith("/blob/")) {
      const key = url.pathname.slice(6);
      const op = url.searchParams.get("op");
      if (req.method === "PUT" && op === "put") { blobs.set(key, raw); res.statusCode = 200; res.end(); return; }
      if (req.method === "GET" && op === "get") { if (!blobs.has(key)) { res.statusCode = 404; res.end(); return; } res.end(blobs.get(key)); return; }
      if (req.method === "DELETE" && op === "delete") { blobs.delete(key); res.statusCode = 204; res.end(); return; }
      res.statusCode = 403; res.end(); return;
    }
    if (url.pathname === "/functions/v1/doc-storage") {
      if (!UUID_RE.test(uid)) { res.statusCode = 401; res.end(JSON.stringify({ error: "sign in" })); return; }
      const [status, out] = await docStorage(uid, raw.toString());
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(out));
      return;
    }
    const t = pgliteTransport(db, uid);
    const path = url.pathname.replace(/^\/rest\/v1\//, "");
    const query = url.search.slice(1);
    const body = raw.toString();
    let out = null;
    if (path.startsWith("rpc/")) out = await t.rpc(path.slice(4), JSON.parse(body || "{}"));
    else if (req.method === "GET") out = await t.select(path, query);
    else if (req.method === "POST") out = await t.insert(path, JSON.parse(body));
    else if (req.method === "PATCH") out = await t.update(path, query, JSON.parse(body));
    else if (req.method === "DELETE") out = await t.remove(path, query);
    res.setHeader("content-type", "application/json");
    res.end(out === null || out === undefined ? "" : JSON.stringify(out));
  } catch (e) {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: String(e.message) }));
  }
});
await new Promise((r) => api.listen(0, "127.0.0.1", r));
const apiUrl = `http://127.0.0.1:${api.address().port}`;

const vite = await createVite({ root, configFile: false, logLevel: "error", server: { port: 0, host: "127.0.0.1", proxy: { "/rest": apiUrl, "/functions": apiUrl, "/blob": apiUrl } } });
await vite.listen();
appUrl = `http://127.0.0.1:${vite.httpServer.address().port}`;
const ARGS = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
const browser = await chromium.launch({ ...ARGS, channel: "chrome" }).catch(() => chromium.launch(ARGS)).catch(() => chromium.launch({ ...ARGS, executablePath: "/opt/pw-browsers/chromium" }));

const MEMBERS = [{ user_id: USERS.luke, display_name: "Luke" }, { user_id: USERS.wife, display_name: "Marijane" }];
const PERSONAL = `u-${USERS.luke}`;

async function device(name, userId, { native, width = 390 }) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => { const a = page.__answers?.shift(); d.accept(a); });
  await page.route(`${appUrl}/qa-documents.html`, (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>
    <body style="margin:0;background:var(--bg);font-family:system-ui"><section class="planner-column do-column documents-page" id="documentsMainPage" style="height:100vh;display:flex;flex-direction:column"><div class="article-page-inner" id="documentsRoot" style="flex:1;min-height:0;display:flex;flex-direction:column"></div></section></body></html>` }));
  await page.goto(`${appUrl}/qa-documents.html`);
  await page.evaluate(async ({ appUrl, userId, native, members, personal }) => {
    const headers = () => ({ authorization: `Bearer ${userId}`, "content-type": "application/json" });
    const { createKeystore, idbBackend } = await import(`${appUrl}/messaging/keystore.js`);
    const { createMessagingServer, createRestTransport } = await import(`${appUrl}/messaging/server.js`);
    const { createMessagingAccount } = await import(`${appUrl}/messaging/account.js`);
    const { loadSodium } = await import(`${appUrl}/messaging/crypto/index.js`);
    await loadSodium();
    // Messaging's setup, linking and verification are Messages' screens (tested by
    // qa-messaging-ui); here they're driven directly on the same keystore.
    window.__msg = createMessagingAccount({ server: createMessagingServer(createRestTransport({ baseUrl: () => appUrl, headers })), store: createKeystore(await idbBackend()), userId });
    window.__toasts = [];
    window.__opened = [];
    const { mountDocuments } = await import(`${appUrl}/documents/ui.js`);
    window.__ui = await mountDocuments(document.getElementById("documentsRoot"), {
      userId, baseUrl: () => appUrl, headers, functionsUrl: () => `${appUrl}/functions/v1`, getToken: async () => userId,
      isNative: native, nativeMessagingKeys: () => null,
      household: () => ({ scope: "7aa1feaf-4c11-4b20-a1b4-234082e90c97", members }),
      personalScope: () => personal,
      toast: (t) => window.__toasts.push(t),
      openMessages: () => window.__opened.push("messages"),
    });
  }, { appUrl, userId, native, members: MEMBERS, personal: userId === USERS.luke ? PERSONAL : null });
  return { name, page, errors, ctx };
}

const shot = async (d, label) => { if (SHOTS) await d.page.screenshot({ path: `${SHOTS}/${d.name}-${label}.png` }); };
const text = (d) => d.page.locator("#documentsRoot").innerText();
const show = (d, scope, kind) => d.page.evaluate(({ scope, kind }) => window.__ui.show(scope, { kind, title: kind === "personal" ? "Personal Documents" : "Household Documents" }), { scope, kind });
const household = (d) => show(d, GROUP, "household");
const personal = (d) => show(d, PERSONAL, "personal");
const idle = (d) => d.page.waitForFunction(() => !document.querySelector("#documentsRoot [role=status]"), null, { timeout: 20000 });
const noSideScroll = (d) => d.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const fileNames = (d) => d.page.locator(".docs-file-name").allInnerTexts();
// On a phone the folders are a drawer behind the ☰ button (as on Watch).
async function pick(d, selector) {
  if ((await d.page.evaluate(() => window.innerWidth)) <= 680) await d.page.click("[data-act=toggle-sidebar]");
  await d.page.click(selector);
}
const folderTabs = (d) => d.page.locator(".docs-sidebar .article-sidebar-tab span").allInnerTexts();

// Files made in the page: a real PNG from a canvas, a two-page PDF, and a text file
// with markup in it. `how` is "input" (the + button's picker) or "drop".
async function addFiles(d, how) {
  await d.page.evaluate(async (how) => {
    const c = document.createElement("canvas"); c.width = 600; c.height = 800;
    const g = c.getContext("2d"); g.fillStyle = "#2a6"; g.fillRect(0, 0, 600, 800); g.fillStyle = "#fff"; g.fillRect(60, 60, 480, 120);
    const png = await new Promise((r) => c.toBlob(r, "image/png"));
    const pdf = "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n4 0 obj << /Type /Page /Parent 2 0 R >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF";
    const dt = new DataTransfer();
    dt.items.add(new File([png], "Car title.png", { type: "image/png" }));
    dt.items.add(new File([pdf], "Home insurance 2026.pdf", { type: "application/pdf" }));
    dt.items.add(new File(["Notes <b>not bold</b><img src=x onerror=alert(1)>"], "notes.txt", { type: "text/plain" }));
    dt.items.add(new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "logo.svg", { type: "image/svg+xml" }));
    if (how === "drop") {
      document.querySelector("[data-drop]").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    } else {
      const input = document.querySelector("[data-file-input]");
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, how);
  await d.page.waitForFunction(() => window.__toasts.some((t) => t.startsWith("Added")), null, { timeout: 30000 });
  await idle(d);
}

try {
  console.log("Before messaging is set up");
  const phone = await device("luke-phone", USERS.luke, { native: true });
  const wife = await device("wife-phone", USERS.wife, { native: true });
  await household(phone);
  check((await text(phone)).includes("Open Messages"), "with no messaging keys, the page sends you to Messages first");
  await phone.page.click("[data-act=open-messages]");
  check((await phone.page.evaluate(() => window.__opened)).includes("messages"), "…and the button opens Messages");

  console.log("Setting up on Luke's phone");
  for (const d of [phone, wife]) await d.page.evaluate(() => window.__msg.setupPhone());
  await household(phone);
  check((await text(phone)).includes("Set up Household Documents"), "the phone offers to set up Household Documents");
  check((await text(phone)).includes("Marijane"), "…and says who can open them");
  await shot(phone, "1-setup");
  await phone.page.click("[data-act=create]");
  await phone.page.waitForSelector(".docs-sidebar", { timeout: 20000 });
  const tabs = await folderTabs(phone);
  check(JSON.stringify(tabs) === JSON.stringify(["All documents", "Receipts", "IDs & Records", "Home", "Vehicles", "Insurance", "Medical", "New folder", "Recently deleted"]), "Household starts with Receipts first, then the five folders", tabs.join(", "));
  check((await text(phone)).includes("verified Marijane"), "an unverified household member is flagged, with a way to Messages");
  await shot(phone, "2-household-empty");
  check(await noSideScroll(phone), "the empty page fits a phone-width window");

  console.log("Personal and the recovery code");
  await personal(phone);
  await phone.page.click("[data-act=create]");
  await phone.page.waitForSelector("[data-recovery-code]", { timeout: 30000 });
  const code = await phone.page.locator("[data-recovery-code]").innerText();
  check(/^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/.test(code.trim()), "Personal setup shows a recovery code in 8 groups of 4", code);
  await shot(phone, "3-recovery-code");
  check(await noSideScroll(phone), "the recovery screen fits a phone-width window");
  await phone.page.click("[data-act=code-done]");
  await phone.page.waitForSelector(".docs-sidebar");
  const ptabs = await folderTabs(phone);
  check(JSON.stringify(ptabs) === JSON.stringify(["All documents", "Work", "Personal", "New folder", "Recently deleted"]), "Personal starts with Work and Personal, no Receipts", ptabs.join(", "));
  check(!(await text(phone)).includes("Make your recovery code"), "with a code made, no reminder to make one");

  console.log("Adding documents");
  await household(phone);
  await phone.page.waitForSelector(".docs-sidebar");
  await addFiles(phone, "input");
  const names = await fileNames(phone);
  check(names.includes("Car title") && names.includes("Home insurance 2026") && names.includes("notes"), "three files are added, listed by name", names.join(", "));
  check(!names.includes("logo") && (await text(phone)).includes("logo.svg"), "an SVG is refused, with the reason shown");
  check((await text(phone)).includes("2 pages"), "the PDF's page count is shown");
  await phone.page.waitForSelector(".docs-thumb img", { timeout: 10000 });
  check(true, "the image gets a thumbnail");
  await shot(phone, "4-list");
  check(await noSideScroll(phone), "the list fits a phone-width window");
  const stored = [...blobs.values()].map((b) => b.toString("latin1"));
  check(stored.length >= 4 && !stored.some((s) => s.includes("Home insurance") || s.includes("not bold") || s.includes("%PDF")), "the object store holds only ciphertext", `${stored.length} blobs`);
  await db.exec("reset role");
  const rows = await db.query(`select enc_meta from public.doc_files`);
  check(rows.rows.length === 3 && !rows.rows.some((r) => Buffer.from(r.enc_meta, "base64").toString("latin1").includes("insurance")), "the database holds no readable names");

  console.log("Viewing and editing");
  await phone.page.click(".docs-file:has-text('Car title')");
  await phone.page.waitForSelector(".docs-view-img", { timeout: 15000 });
  check(await phone.page.locator(".docs-view-img").evaluate((i) => i.complete && i.naturalWidth === 600), "the image opens, decrypted");
  await shot(phone, "5-viewer");
  check(await noSideScroll(phone), "the viewer fits a phone-width window");
  await phone.page.fill("[data-form=edit] [name=name]", "Car title — Honda");
  const vehicles = await phone.page.locator("[data-form=edit] [name=folder] option", { hasText: "Vehicles" }).getAttribute("value");
  await phone.page.selectOption("[data-form=edit] [name=folder]", vehicles);
  await phone.page.fill("[data-form=edit] [name=tags]", "car, title");
  await phone.page.click("[data-form=edit] button[type=submit]");
  await phone.page.waitForFunction(() => window.__toasts.includes("Saved."), null, { timeout: 15000 });
  await phone.page.click("[data-act=close-viewer]");
  await pick(phone, `[data-folder="${vehicles}"]`);
  check(JSON.stringify(await fileNames(phone)) === JSON.stringify(["Car title — Honda"]), "renamed and moved: Vehicles shows it");
  await pick(phone, `[data-folder=all]`);
  await phone.page.fill("[data-search]", "car");
  check(JSON.stringify(await fileNames(phone)) === JSON.stringify(["Car title — Honda"]), "search finds it by tag");
  await phone.page.fill("[data-search]", "");
  await phone.page.click(".docs-file:has-text('notes')");
  await phone.page.waitForSelector(".docs-view-text", { timeout: 15000 });
  check((await phone.page.locator(".docs-view-text").innerText()).includes("<b>not bold</b>") && await phone.page.locator(".docs-viewer b, .docs-viewer-body img").count() === 0, "a text file is shown as text, never as markup");
  await phone.page.click("[data-act=close-viewer]");
  await phone.page.click(".docs-file:has-text('Home insurance')");
  await phone.page.waitForSelector(".docs-view-pdf", { timeout: 15000 });
  check((await phone.page.locator(".docs-view-pdf").getAttribute("src")).startsWith("blob:"), "the PDF opens in a frame from a local, decrypted copy");
  await phone.page.click("[data-act=trash-file]");
  await phone.page.waitForFunction(() => window.__toasts.some((t) => t.startsWith("Moved to Recently deleted")), null, { timeout: 15000 });
  check(!(await fileNames(phone)).includes("Home insurance 2026"), "deleting takes it out of the list");
  await pick(phone, "[data-folder=trash]");
  check((await fileNames(phone)).includes("Home insurance 2026"), "…into Recently deleted");
  await phone.page.click(".docs-file:has-text('Home insurance')");
  await phone.page.click("[data-act=restore-file]");
  await idle(phone);
  await pick(phone, "[data-folder=all]");
  check((await fileNames(phone)).includes("Home insurance 2026"), "Put back returns it");

  console.log("Folders");
  phone.page.__answers = ["Taxes"];
  await pick(phone, "[data-act=new-folder]");
  await idle(phone);
  check((await folderTabs(phone)).includes("Taxes"), "a new folder can be added");
  await pick(phone, ".docs-sidebar .article-sidebar-tab:has-text('Receipts')");
  check(await phone.page.locator("[data-act=delete-folder]").count() === 0, "Receipts has no Remove button");
  await pick(phone, ".docs-sidebar .article-sidebar-tab:has-text('Taxes')");
  phone.page.__answers = [undefined];
  await phone.page.click("[data-act=delete-folder]");
  await idle(phone);
  check(!(await folderTabs(phone)).includes("Taxes"), "…and removed");

  console.log("Marijane");
  await household(wife);
  check((await text(wife)).includes("waiting for the key") && (await text(wife)).includes("verify each other"), "before verifying, Marijane waits and is told to verify", await text(wife));
  await shot(wife, "6-waiting");
  for (const [a, b] of [[phone, USERS.wife], [wife, USERS.luke]]) await a.page.evaluate(async (other) => { await window.__msg.resolveDevices([other]); await window.__msg.markVerified(other); }, b);
  await household(phone); // opening the page hands the key to waiting, trusted devices
  await idle(phone);
  await wife.page.click("[data-act=reload]");
  await wife.page.waitForSelector(".docs-sidebar", { timeout: 20000 });
  const herNames = await fileNames(wife);
  check(herNames.includes("Car title — Honda") && herNames.includes("Home insurance 2026"), "after verifying, Marijane sees Luke's documents", herNames.join(", "));
  check((await text(wife)).includes("added by Luke"), "…marked as added by Luke");
  await wife.page.click(".docs-file:has-text('Car title')");
  await wife.page.waitForSelector(".docs-view-img", { timeout: 15000 });
  check(await wife.page.locator(".docs-view-img").evaluate((i) => i.complete && i.naturalWidth === 600), "…and can open them");
  await wife.page.click("[data-act=close-viewer]");
  check(!(await text(wife)).includes("hasn't verified"), "no verify note once verified");
  const herPersonal = await wife.page.evaluate(async (scope) => {
    const r = await fetch(`/functions/v1/doc-storage`, { method: "POST", headers: { authorization: "Bearer 22222222-2222-2222-2222-222222222222" }, body: JSON.stringify({ op: "get", items: [{ scope, fileId: "00000000-0000-4000-8000-000000000000", part: "content" }] }) });
    return r.status;
  }, PERSONAL);
  check(herPersonal === 403, "Marijane can't get links to Luke's Personal documents");

  console.log("Luke's laptop browser");
  const laptop = await device("luke-browser", USERS.luke, { native: false, width: 1280 });
  const link = await laptop.page.evaluate(() => window.__msg.startLink({ label: "Laptop" }));
  await phone.page.evaluate((c) => window.__msg.approveLink(c), link);
  await laptop.page.evaluate(() => window.__msg.finishLink());
  await household(laptop);
  check((await text(laptop)).includes("waiting for the key"), "a newly linked browser waits for the key");
  await household(phone);
  await idle(phone);
  await laptop.page.click("[data-act=reload]");
  await laptop.page.waitForSelector(".docs-sidebar", { timeout: 20000 });
  check((await fileNames(laptop)).includes("Car title — Honda"), "after the phone opens the page, the browser has the documents");
  await laptop.page.evaluate(() => { window.__toasts = []; });
  await addFiles(laptop, "drop");
  check((await fileNames(laptop)).filter((n) => n === "notes").length === 2, "files dropped on the laptop page are added");
  await shot(laptop, "7-laptop");
  await personal(laptop);
  await personal(phone);
  await idle(phone);
  await laptop.page.click("[data-act=reload]").catch(() => {});
  await laptop.page.waitForSelector(".docs-sidebar", { timeout: 20000 });
  check((await folderTabs(laptop)).includes("Work"), "Personal reaches Luke's browser too");

  console.log("Narrow phones");
  await phone.page.setViewportSize({ width: 360, height: 740 });
  await household(phone);
  await idle(phone);
  check(await noSideScroll(phone), "the list fits a 360 px phone");
  await phone.page.click("[data-act=settings]");
  await phone.page.waitForFunction(() => document.querySelector(".docs-settings") && !document.querySelector(".docs-settings").innerText.includes("Loading…"), null, { timeout: 15000 });
  check((await phone.page.locator(".docs-settings").innerText()).includes("Laptop"), "settings list Luke's devices");
  await shot(phone, "8-settings");
  check(await noSideScroll(phone), "settings fit a 360 px phone");

  for (const d of [phone, wife, laptop]) check(d.errors.length === 0, `${d.name}: no page errors`, d.errors.join(" | "));
} catch (e) {
  fail++;
  console.log(`  ✖ ${e.message}`);
} finally {
  await browser.close();
  await vite.close();
  api.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
