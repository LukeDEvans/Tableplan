// qa-messaging-ui.mjs — the Messages tab (messaging/ui.js) end to end in Chromium,
// at phone width, against a local stand-in for Supabase: a tiny PostgREST-shaped
// server backed by PGlite with the REAL messaging migration and row security
// (test/messaging-pglite-harness.js). Three separate browser profiles play Luke's
// phone, Luke's laptop browser and Marijane's phone:
//   phone setup → link the browser (code pasted, as with Universal Clipboard) →
//   start a conversation → send → it arrives on her phone and as a copy on his
//   browser → she replies → read receipt → a card → verification numbers match.
// Self-contained (starts Vite and the stand-in). Screenshots go to the given folder.
//   node scripts/qa-messaging-ui.mjs [screenshotDir]
import { createServer as createVite } from "vite";
import { createServer as createHttp } from "node:http";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { createTestDatabase, pgliteTransport, USERS } from "../test/messaging-pglite-harness.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const SHOTS = process.argv[2] || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const check = (ok, name, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ✔" : "  ✖"} ${name}${ok || !detail ? "" : ` — ${detail}`}`); };

// ---- the Supabase stand-in -----------------------------------------------------------
const db = await createTestDatabase();
const api = createHttp(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") { res.end(); return; }
  const uid = (req.headers.authorization || "").replace(/^Bearer /, "");
  const t = pgliteTransport(db, uid);
  const url = new URL(req.url, "http://x");
  const path = url.pathname.replace(/^\/rest\/v1\//, "");
  const query = url.search.slice(1);
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    let out = null;
    if (path.startsWith("rpc/")) out = await t.rpc(path.slice(4), JSON.parse(body || "{}"));
    else if (req.method === "GET") out = await t.select(path, query);
    else if (req.method === "POST") out = await t.insert(path, JSON.parse(body));
    else if (req.method === "PATCH") out = await t.update(path, query, JSON.parse(body));
    else if (req.method === "DELETE") out = await t.remove(path, query);
    res.setHeader("content-type", "application/json");
    res.end(out === null ? "" : JSON.stringify(out));
  } catch (e) {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: String(e.message).replace(/^messaging: 400 /, "") }));
  }
});
await new Promise((r) => api.listen(0, "127.0.0.1", r));
const apiUrl = `http://127.0.0.1:${api.address().port}`;

// ---- the pages -----------------------------------------------------------------------------
// The stand-in is reached through Vite's proxy, so the page calls its own origin
// (Chrome blocks a page from calling another loopback port; the real app calls Supabase).
const vite = await createVite({ root, configFile: false, logLevel: "error", server: { port: 0, host: "127.0.0.1", proxy: { "/rest": apiUrl } } });
await vite.listen();
const appUrl = `http://127.0.0.1:${vite.httpServer.address().port}`;
const ARGS = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
const browser = await chromium.launch({ ...ARGS, channel: "chrome" }).catch(() => chromium.launch(ARGS)).catch(() => chromium.launch({ ...ARGS, executablePath: "/opt/pw-browsers/chromium" }));

async function device(name, userId, { native }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept(page.__promptAnswer || undefined));
  await page.route(`${appUrl}/qa-messages.html`, (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>
    <body style="margin:0;background:var(--bg);font-family:system-ui"><section class="mail-page" style="height:100vh"><div class="messages-pane" id="pane"></div></section></body></html>` }));
  await page.goto(`${appUrl}/qa-messages.html`);
  await page.evaluate(async ({ appUrl, userId, native }) => {
    const { mountMessages } = await import(`${appUrl}/messaging/ui.js`);
    window.__toasts = [];
    window.__cards = [];
    window.__ui = await mountMessages(document.getElementById("pane"), {
      userId, baseUrl: () => appUrl, headers: () => ({ authorization: `Bearer ${userId}`, "content-type": "application/json" }),
      isNative: native, nativeMessagingKeys: () => null, nativeQrScan: () => null,
      toast: (t) => window.__toasts.push(t),
      cardSources: () => ({ recipe: [{ ref: "r_lentil", title: "Lentil soup", subtitle: "45 min" }], event: [], trip: [], shop: [] }),
      openCard: (kind, ref) => { window.__cards.push(`${kind}:${ref}`); return true; },
      onUnreadChange: () => {},
    });
    await window.__ui.show();
  }, { appUrl, userId, native });
  return { name, page, errors, ctx };
}

const shot = async (d, label) => { if (SHOTS) await d.page.screenshot({ path: `${SHOTS}/${d.name}-${label}.png` }); };
const text = (d) => d.page.locator("#pane").innerText();
const click = (d, sel) => d.page.click(sel);
const tick = (d) => d.page.evaluate(() => window.__ui.show());
const noSideScroll = async (d) => d.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
  console.log("Setting up");
  const phone = await device("luke-phone", USERS.luke, { native: true });
  const laptop = await device("luke-browser", USERS.luke, { native: false });
  const wife = await device("wife-phone", USERS.wife, { native: true });
  check((await text(phone)).includes("Set up on this iPhone"), "a phone offers setup");
  check((await text(laptop)).includes("Link this browser"), "a browser offers linking");
  await shot(phone, "1-setup");
  await click(phone, "[data-act=setup-phone]");
  await phone.page.waitForSelector("[data-act=new]");
  check(true, "Luke's phone is set up");
  await click(wife, "[data-act=setup-phone]");
  await wife.page.waitForSelector("[data-act=new]");
  check(true, "Marijane's phone is set up");

  console.log("Linking the laptop browser");
  await click(laptop, "[data-act=start-link]");
  await laptop.page.waitForSelector(".msg-qr svg");
  await shot(laptop, "2-link-qr");
  check(await noSideScroll(laptop), "link screen fits a phone-width window");
  const code = await laptop.page.locator(".msg-code").inputValue();
  check(code.startsWith("LIVEMSG2:"), "the link code is shown to copy");
  await click(phone, "[data-act=devices]");
  phone.page.__promptAnswer = code;
  await phone.page.context().grantPermissions([]).catch(() => {});
  await phone.page.evaluate(() => { navigator.clipboard.readText = () => Promise.reject(new Error("no clipboard")); });
  await click(phone, "[data-act=paste-link]");
  await phone.page.waitForFunction(() => window.__toasts.some((t) => t.startsWith("Linked")), null, { timeout: 15000 });
  check(true, "the phone approves the pasted code");
  await laptop.page.waitForSelector("[data-act=new]", { timeout: 15000 });
  check((await laptop.page.evaluate(() => window.__toasts)).includes("This browser is linked."), "the browser notices it's linked within seconds");
  await shot(phone, "3-devices");
  check((await text(phone)).includes("Browser"), "the phone lists the linked browser");

  console.log("Messaging");
  await click(phone, "[data-act=to-list]");
  await click(phone, "[data-act=new]");
  await phone.page.check(`input[value="${USERS.wife}"]`);
  await click(phone, "[data-form=new] button[type=submit]");
  await phone.page.waitForSelector(".msg-compose textarea");
  await phone.page.fill(".msg-compose textarea", "Can you grab milk? <b>not bold</b>");
  await click(phone, ".msg-compose button[type=submit]");
  await phone.page.waitForSelector(".msg-bubble.is-mine");
  await shot(phone, "4-thread-sent");
  check(await noSideScroll(phone), "thread fits a phone-width window");
  await tick(wife);
  check((await text(wife)).includes("Marijane") === false && (await text(wife)).includes("Luke"), "Marijane's list shows the conversation with Luke", await text(wife));
  await click(wife, "[data-act=open]");
  await wife.page.waitForSelector(".msg-bubble");
  const bubble = await wife.page.locator(".msg-bubble .msg-text").first().innerText();
  check(bubble === "Can you grab milk? <b>not bold</b>", "the message arrives, and markup in it is shown as text", bubble);
  check(await wife.page.locator(".msg-bubble b").count() === 0, "no HTML from a message reaches the page");
  check((await text(wife)).includes("Not verified"), "an unverified conversation shows the Verify prompt");
  await shot(wife, "5-thread-received");
  await tick(laptop);
  await click(laptop, "[data-act=open]");
  await laptop.page.waitForSelector(".msg-bubble.is-mine");
  check((await laptop.page.locator(".msg-bubble.is-mine .msg-text").innerText()).startsWith("Can you grab milk?"), "Luke's browser shows a copy of what he sent from the phone");

  await wife.page.fill(".msg-compose textarea", "Yep, on my way home");
  await click(wife, ".msg-compose button[type=submit]");
  await wife.page.waitForSelector(".msg-bubble.is-mine");
  await tick(phone);
  await phone.page.waitForFunction(() => document.querySelector("#pane").innerText.includes("on my way home"), null, { timeout: 15000 });
  check(true, "her reply reaches Luke's phone");
  check((await text(phone)).includes("Read"), "Luke sees his message was read (receipt)");

  console.log("Cards and verification");
  await click(phone, "[data-act=card-picker]");
  await click(phone, "[data-act=send-card]");
  await phone.page.waitForSelector(".msg-card");
  await tick(wife);
  await wife.page.waitForSelector(".msg-card");
  check((await wife.page.locator(".msg-card").innerText()).includes("Lentil soup"), "a recipe card arrives with its snapshot");
  await click(wife, ".msg-card");
  check((await wife.page.evaluate(() => window.__cards)).includes("recipe:r_lentil"), "tapping a card asks the app to open the real item");
  check(await wife.page.locator(".msg-card img").count() === 0, "no card thumbnail is loaded automatically");
  await click(phone, "[data-act=verify]");
  await phone.page.waitForSelector(".msg-safety");
  await click(wife, "[data-act=verify]");
  await wife.page.waitForSelector(".msg-safety");
  const a = await phone.page.locator(".msg-safety").innerText();
  const b = await wife.page.locator(".msg-safety").innerText();
  check(/^(\d{5} ){11}\d{5}$/.test(a) && a === b, "both phones show the same 60-digit safety number", `${a} | ${b}`);
  await shot(phone, "6-verify");
  check(await noSideScroll(phone), "verification fits a phone-width window");

  console.log("Devices & security");
  await click(phone, "[data-act=to-thread]");
  await click(phone, "[data-act=to-list]");
  await click(phone, "[data-act=devices]");
  await click(phone, "[data-act=selftest]");
  await phone.page.waitForFunction(() => /checks passed|Failed/.test(document.querySelector("#msgSelftest")?.textContent || ""), null, { timeout: 20000 });
  check((await phone.page.locator("#msgSelftest").innerText()).includes("checks passed"), "the crypto check passes in the page", await phone.page.locator("#msgSelftest").innerText());

  console.log("Signing out of the browser");
  const laptopDevice = await laptop.page.evaluate(async (appUrl) => {
    const { createKeystore, idbBackend } = await import(`${appUrl}/messaging/keystore.js`);
    const b = await idbBackend();
    const id = (await createKeystore(b).get("account"))?.deviceId;
    b.close();
    return id;
  }, appUrl);
  await laptop.page.evaluate(async ({ appUrl, userId }) => {
    const { forgetMessagingOnThisDevice } = await import(`${appUrl}/messaging/signout.js`);
    await forgetMessagingOnThisDevice({
      baseUrl: () => appUrl, headers: () => ({ authorization: `Bearer ${userId}`, "content-type": "application/json" }),
      beforeDelete: async () => window.__ui.destroy(),
    });
  }, { appUrl, userId: USERS.luke });
  await db.exec("reset role");
  const revoked = await db.query(`select revoked_at from public.msg_devices where device_id = $1`, [laptopDevice]);
  check(Boolean(laptopDevice) && revoked.rows[0]?.revoked_at, "signing out removes the browser from Luke's devices", String(laptopDevice));
  const left = await laptop.page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  check(!left.includes("live-messaging"), "…and deletes its messages and keys", left.join(","));

  for (const d of [phone, laptop, wife]) check(d.errors.length === 0, `${d.name}: no page errors`, d.errors.join(" | "));
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
