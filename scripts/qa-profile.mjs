// Headless QA for the Profile window: opens read-only, Edit switches to the form,
// an empty "Add" row jumps to its field, Cancel discards, Save returns to the view,
// a picked photo is resized and shown, and nothing overflows a 360px phone.
// Run against the dev server (npm run dev:local) in local-dev mode, on a fresh
// local state. Screenshots go to $QA_SHOTS when set.
import { chromium } from "playwright";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const URL = process.env.QA_URL || "http://localhost:4174/";
const SHOTS = process.env.QA_SHOTS || "";
const LAUNCH = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
let passed = 0;
const errors = [];
function ok(cond, msg) { if (!cond) { console.error(`  ✗ ${msg}`); process.exitCode = 1; } else { passed++; console.log(`  ✓ ${msg}`); } }

async function launch() {
  try { return await chromium.launch({ ...LAUNCH, channel: "chrome" }); } catch { /* none */ }
  try { return await chromium.launch(LAUNCH); } catch { /* none */ }
  const sandbox = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(sandbox)) return chromium.launch({ ...LAUNCH, executablePath: sandbox });
  throw new Error("No Chromium found");
}

// A 600×400 PNG made in the page, so the test needs no fixture file.
async function makeTestImage(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 600; c.height = 400;
    const x = c.getContext("2d");
    x.fillStyle = "#2a6f97"; x.fillRect(0, 0, 600, 400);
    x.fillStyle = "#f1cc54"; x.beginPath(); x.arc(300, 200, 120, 0, Math.PI * 2); x.fill();
    return c.toDataURL("image/png").split(",")[1];
  });
  const dir = join(tmpdir(), "qa-profile"); mkdirSync(dir, { recursive: true });
  const file = join(dir, "photo.png"); writeFileSync(file, Buffer.from(b64, "base64"));
  return file;
}

const shot = async (page, name) => { if (SHOTS) await page.locator("#profileDialog").screenshot({ path: join(SHOTS, `${name}.png`) }); };
const noOverflow = (page) => page.evaluate(() => {
  const d = document.querySelector("#profileDialog .recipe-form");
  return d.scrollWidth <= d.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1;
});

const browser = await launch();
for (const scheme of ["light", "dark"]) {
  console.log(`▸ Profile (${scheme})`);
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, colorScheme: scheme, timezoneId: "America/Chicago" });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.classList.contains("app-authed") || !document.getElementById("lockDevSignInBtn")?.hidden, null, { timeout: 30000 });
  if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"), null, { timeout: 30000 });
  await page.evaluate(() => { try { localStorage.removeItem("live_avatar_local-dev"); } catch {} });
  // The app follows its own theme setting; pin it so both palettes get checked.
  await page.evaluate((t) => document.body.dataset.theme = t, scheme);
  await page.waitForTimeout(800);

  await page.click("#appMenuBtn");
  await page.click("#menuUserBtn");
  await page.waitForSelector("#profileDialog[open]");
  ok(await page.isVisible("#profileView") && !(await page.isVisible("#profileEdit")), "opens read-only");
  ok(await page.isVisible("#profileEditBtn"), "Edit button is shown");
  ok(!(await page.isVisible("#profileNameInput")), "no input is editable on open");
  ok(await noOverflow(page), "view fits 360px");
  await shot(page, `profile-view-empty-${scheme}`);

  // An empty Birthday row's "Add" jumps straight into the form at that field.
  const addBday = page.locator('#profileViewAbout [data-field="profileDobInput"]');
  if (await addBday.count()) {
    await addBday.click();
    ok(await page.isVisible("#profileEdit"), "Add on an empty row opens the form");
    ok(await page.evaluate(() => document.activeElement?.id === "profileDobInput"), "…focused on that field");
    await page.click("#cancelProfileEditBtn");
  }

  // Cancel discards.
  await page.click("#profileEditBtn");
  ok((await page.textContent("#profileTitle")) === "Edit profile", "title says Edit profile");
  ok(!(await page.isVisible("#profileEditBtn")), "Edit pill hides while editing");
  await page.fill("#profileHomeInput", "Should not stick");
  await page.click("#cancelProfileEditBtn");
  ok(!(await page.textContent("#profileViewAbout")).includes("Should not stick"), "Cancel discards edits");

  // Save: fields + photo.
  await page.click("#profileEditBtn");
  await page.fill("#profileDobInput", "1990-11-02");
  await page.fill("#profileHomeInput", "Minneapolis, MN");
  await page.setInputFiles("#profilePhotoInput", await makeTestImage(page));
  await page.waitForFunction(() => document.querySelector("#profileEditAvatar")?.classList.contains("has-photo"), null, { timeout: 10000 });
  ok((await page.textContent("#profilePhotoPickBtn")) === "Change photo", "picked photo previews, button says Change photo");
  ok(await noOverflow(page), "edit form fits 360px");
  await shot(page, `profile-edit-${scheme}`);
  await page.click("#saveProfileBtn");
  await page.waitForSelector("#profileView:not([hidden])");
  const about = await page.textContent("#profileViewAbout");
  ok(about.includes("November 2, 1990") && about.includes("Minneapolis, MN"), "Save returns to the view with the new values");
  ok(await page.evaluate(() => document.querySelector("#profileViewAvatar").classList.contains("has-photo")), "photo shows in the view");
  const size = await page.evaluate(() => {
    const v = JSON.parse(localStorage.getItem("live_avatar_local-dev") || "{}");
    return new Promise((r) => { const i = new Image(); i.onload = () => r({ w: i.width, h: i.height, kb: Math.round(v.dataUrl.length * 0.75 / 1024) }); i.src = v.dataUrl; });
  });
  ok(size.w === 256 && size.h === 256 && size.kb < 60, `photo stored as 256×256 (${size.kb} KB)`);
  ok(await noOverflow(page), "filled view fits 360px");
  await shot(page, `profile-view-${scheme}`);

  // Remove photo.
  await page.click("#profileEditBtn");
  await page.click("#profilePhotoRemoveBtn");
  await page.click("#saveProfileBtn");
  await page.waitForSelector("#profileView:not([hidden])");
  ok(!(await page.evaluate(() => document.querySelector("#profileViewAvatar").classList.contains("has-photo"))), "Remove photo goes back to initials");
  await context.close();
}
await browser.close();
ok(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
console.log(`\n${process.exitCode ? "✗ FAILED" : "✔ PASSED"} — ${passed} checks`);
