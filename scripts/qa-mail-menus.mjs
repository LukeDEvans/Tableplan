// npm run qa:mail-menus  (dev server running: npm run dev:local)
// Runs the REAL showMailSnoozeMenu / dismiss code (exposed to the page by
// appending one line to app.js as the dev server serves it — test only) and
// checks every way to close the menu, with touch input.
import { chromium } from "playwright";
import { existsSync } from "node:fs";
const URL = process.argv[2] || "http://localhost:4174/";
async function launch() {
  // --no-proxy-server: cloud sandboxes export HTTPS_PROXY, which Chrome would
  // otherwise use even for localhost (scripts/check-boot.mjs).
  const args = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
  try { return await chromium.launch({ ...args, channel: "chrome" }); } catch { /* not here */ }
  try { return await chromium.launch(args); } catch { /* not here */ }
  const sandbox = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(sandbox)) return chromium.launch({ ...args, executablePath: sandbox });
  throw new Error("No Chromium found");
}


const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route(/\/app\.js(\?.*)?$/, async (route) => {
  const res = await route.fetch();
  const body = await res.text();
  await route.fulfill({ response: res, body: body + "\n;window.__mailT = { showMailSnoozeMenu, closeMailMenus, wireMailMenuDismiss };\n" });
});
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.querySelector("#lockDevSignInBtn")?.offsetParent != null), null, { timeout: 60000 });
if (await page.isVisible("#lockDevSignInBtn")) await page.tap("#lockDevSignInBtn");
await page.waitForFunction(() => document.body.classList.contains("app-authed"));
await page.waitForTimeout(600);
await page.evaluate(() => document.getElementById("homeMailBtn").click());
await page.waitForTimeout(800);
const ok = await page.evaluate(() => !!window.__mailT);
console.log("hook installed:", ok);
await page.evaluate(() => {
  document.getElementById("mailConnectView").hidden = true;
  document.getElementById("mailMainView").hidden = false;
  const t = document.getElementById("mailThread"); t.hidden = false;
  t.innerHTML = `<div class="mail-thread-toolbar"><button class="icon-btn mail-action-btn" id="mailSnoozeBtn" type="button">Z</button></div>
    <div class="mail-thread-body"><div class="mail-thread-subject-bar"><h2 class="mail-thread-subject" id="subj">Subject line</h2></div>
    <div class="mail-msg"><div class="mail-msg-body"><iframe id="frame" sandbox="" srcdoc="<p style='height:300px'>email body</p>" style="width:100%;height:300px;border:0"></iframe></div></div></div>`;
  // Same wiring renderMailThread does for the real button
  document.getElementById("mailSnoozeBtn").addEventListener("click", (e) => { e.stopPropagation(); window.__mailT.showMailSnoozeMenu("t1", e.currentTarget); });
});
const isOpen = () => page.evaluate(() => !!document.getElementById("mailSnoozeMenu"));
const menuOpenClass = () => page.evaluate(() => document.body.classList.contains("mail-menu-open"));
const results = [];
const check = (name, cond) => { results.push(`${cond ? "PASS" : "FAIL"}  ${name}`); };

await page.tap("#mailSnoozeBtn"); await page.waitForTimeout(150);
check("tap snooze button opens the menu", await isOpen());
check("email frames ignore taps while open", await menuOpenClass());

// iOS: a tap on a plain area sends pointerdown but no click → simulate exactly that
await page.evaluate(() => { const el = document.getElementById("subj"); const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.left + 5, clientY: r.top + 5, pointerType: "touch" })); });
await page.waitForTimeout(100);
check("pointerdown alone (iOS plain-area tap) closes it", !(await isOpen()));

await page.tap("#mailSnoozeBtn"); await page.waitForTimeout(150);
const fr = await page.$("#frame"); const fb = await fr.boundingBox();
const mb = await (await page.$("#mailSnoozeMenu")).boundingBox();
const ty = Math.max(fb.y + 10, mb.y + mb.height + 10);
console.log("frame", JSON.stringify(fb), "menu", JSON.stringify(mb), "tap y", ty);
const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.id || e.className || e.tagName); }, [fb.x + 40, ty]);
console.log("element under tap:", hit);
await page.touchscreen.tap(fb.x + 40, ty); await page.waitForTimeout(100);
check("tap on the email body (inside its frame) closes it", !(await isOpen()));
await page.waitForTimeout(400);
check("frames take taps again after it closes", !(await menuOpenClass()));

await page.tap("#mailSnoozeBtn"); await page.waitForTimeout(150);
await page.tap("#mailSnoozeBtn"); await page.waitForTimeout(150);
check("tapping the snooze button again closes it (no reopen)", !(await isOpen()));
await page.tap("#mailSnoozeBtn"); await page.waitForTimeout(150);
check("…and a later tap opens it again", await isOpen());

await page.keyboard.press("Escape"); await page.waitForTimeout(100);
check("Escape closes it", !(await isOpen()));

await page.tap("#mailSnoozeBtn"); await page.waitForTimeout(150);
const opt = await page.$("#mailSnoozeMenu [data-snooze-pick]");
await opt.tap(); await page.waitForTimeout(150);
check("tapping inside the menu keeps it open (Pick date & time)", await isOpen());
const cancel = await page.$("#mailSnoozeMenu [data-snooze-cancel]");
await cancel.tap(); await page.waitForTimeout(400);
check("Cancel closes it and frames take taps again", !(await isOpen()) && !(await menuOpenClass()));

console.log(results.join("\n"));
console.log("pageerrors:", errors);
await browser.close();
if (results.some((r) => r.startsWith("FAIL")) || errors.length) process.exit(1);
