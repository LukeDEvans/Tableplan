#!/usr/bin/env node
// Recipe photos QA (RECIPE_PHOTOS_DESIGN.md). Drives the real recipe view and
// editor in local dev with Supabase Storage and website images mocked:
//   • your own photo loads from its stable public Storage URL — never the old
//     recipe-photo proxy, never with a token in the URL;
//   • a small spot asks for the -thumb file, and falls back to the full photo
//     when the thumbnail doesn't exist (photos from before thumbnails);
//   • a website photo is hotlinked; one that fails to load is hidden, not broken;
//   • the editor labels a website photo, and removing YOUR photo from a recipe
//     with a website says the website's photo will be used.
//
//   node scripts/qa-recipe-photos.mjs [url]   (default http://localhost:4174/; needs `npm run dev:local`)
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
const fails = [];
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) fails.push(label);
};

async function launch() {
  const args = { headless: true };
  try { return await chromium.launch({ ...args, channel: "chrome" }); } catch { /* not here */ }
  try { return await chromium.launch(args); } catch { /* not here */ }
  const sandbox = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(sandbox)) return chromium.launch({ ...args, executablePath: sandbox, args: ["--no-sandbox"] });
  throw new Error("No Chromium found");
}

// 1×1 JPEG
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

const OWN = "qa-user/qa-own/recipe-1790000000000.jpg";
const OWN_NO_THUMB = "qa-user/qa-old/cook-1780000000000.jpg";
const WEB_OK = "https://images.qa-cooking.test/soup.jpg";
const WEB_BROKEN = "https://images.qa-cooking.test/gone.jpg";

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
const requests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.dismiss());
page.on("request", (r) => requests.push(r.url()));

await page.route(/\.supabase\.co\/storage\/v1\/object\/public\/recipe-photos\//, (route) => {
  const url = route.request().url();
  if (url.includes("cook-1780000000000-thumb")) return route.fulfill({ status: 404, body: "not found" });
  return route.fulfill({ status: 200, contentType: "image/jpeg", body: JPEG, headers: { "access-control-allow-origin": "*", "cache-control": "max-age=31536000" } });
});
await page.route(/images\.qa-cooking\.test/, (route) =>
  route.request().url() === WEB_BROKEN
    ? route.fulfill({ status: 403, body: "hotlinking not allowed" })
    : route.fulfill({ status: 200, contentType: "image/jpeg", body: JPEG }));

console.log(`▸ Recipe photos QA against ${URL}`);
await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), { timeout: 20000 });
if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
await page.waitForFunction(() => document.body.classList.contains("app-authed"), { timeout: 10000 });
await page.waitForTimeout(800);

const seeded = await page.evaluate(({ OWN, OWN_NO_THUMB, WEB_OK, WEB_BROKEN }) => window.__liveQA.recipesSeed([
  { id: "qa-own", name: "QA Own Photo", sourceUrl: "https://qa-cooking.test/own", photoUrl: OWN, ingredients: [], steps: "" },
  { id: "qa-old", name: "QA Old Photo", photoUrl: OWN_NO_THUMB, ingredients: [], steps: "" },
  { id: "qa-web", name: "QA Website Photo", sourceUrl: "https://qa-cooking.test/web", photoUrl: WEB_OK, ingredients: [], steps: "" },
  { id: "qa-broken", name: "QA Broken Photo", sourceUrl: "https://qa-cooking.test/broken", photoUrl: WEB_BROKEN, ingredients: [], steps: "" },
]), { OWN, OWN_NO_THUMB, WEB_OK, WEB_BROKEN });
check(seeded === true, "seeded recipes (local dev QA hook)");

const viewPhoto = async (id) => {
  await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
  await page.evaluate((rid) => window.__liveQA.openRecipeViewForQa(rid), id);
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const img = document.querySelector("img.recipe-view-photo");
    return img ? { src: img.getAttribute("src"), hidden: img.hidden, loaded: img.complete && img.naturalWidth > 0 } : null;
  });
};

const own = await viewPhoto("qa-own");
check(Boolean(own?.src?.includes("/storage/v1/object/public/recipe-photos/" + OWN)), "own photo uses its public Storage URL", JSON.stringify(own));
check(Boolean(own?.loaded), "own photo loaded");
check(!requests.some((u) => u.includes("/.netlify/functions/recipe-photo")), "no request to the old recipe-photo proxy");
check(!requests.some((u) => /recipe-photos\/.*[?&](_token|token)=/.test(u)), "no token in any photo URL");

const web = await viewPhoto("qa-web");
check(web?.src === WEB_OK && web.loaded, "website photo is hotlinked as stored", JSON.stringify(web));

const broken = await viewPhoto("qa-broken");
check(!broken || broken.hidden, "a website photo that fails to load is hidden, not shown broken", JSON.stringify(broken));

// Small spots use the thumbnail; a missing thumbnail falls back to the full photo.
const thumbResult = await page.evaluate(async ({ OWN, OWN_NO_THUMB }) => {
  const html = window.__liveQA.recipePhotoImgForQa([OWN, OWN_NO_THUMB]);
  if (!html) return null;
  const box = document.createElement("div");
  box.innerHTML = html;
  document.body.appendChild(box);
  await new Promise((r) => setTimeout(r, 1200));
  return [...box.querySelectorAll("img")].map((img) => ({ src: img.getAttribute("src"), loaded: img.complete && img.naturalWidth > 0, hidden: img.hidden }));
}, { OWN, OWN_NO_THUMB });
check(Boolean(thumbResult?.[0]?.src?.endsWith("recipe-1790000000000-thumb.jpg") && thumbResult[0].loaded), "small spots load the -thumb file", JSON.stringify(thumbResult?.[0]));
check(Boolean(thumbResult?.[1]?.src?.endsWith("cook-1780000000000.jpg") && thumbResult[1].loaded && !thumbResult[1].hidden), "missing thumbnail falls back to the full photo", JSON.stringify(thumbResult?.[1]));

// Editor: website photo is labelled; removing your own photo says what happens.
await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
await page.evaluate(() => window.__liveQA.openRecipeEditorForQa("qa-web"));
await page.waitForTimeout(500);
const webNote = await page.evaluate(() => document.querySelector("#recipePhotoPreview .recipe-photo-source-note")?.textContent || "");
check(/website/i.test(webNote), "editor labels a website photo", webNote);

await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
await page.evaluate(() => window.__liveQA.openRecipeEditorForQa("qa-own"));
await page.waitForTimeout(400);
await page.click("#removeRecipePhotoBtn");
const removeNote = await page.evaluate(() => document.getElementById("recipePhotoPreview")?.textContent || "");
check(/website's photo will be used/i.test(removeNote), "removing your photo says the website's photo will be used", removeNote);

await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
await page.evaluate(() => window.__liveQA.openRecipeEditorForQa("qa-old"));
await page.waitForTimeout(400);
await page.click("#removeRecipePhotoBtn");
const plainRemove = await page.evaluate(() => document.getElementById("recipePhotoPreview")?.textContent || "");
check(/No photo selected/i.test(plainRemove), "removing a photo from a recipe with no website just clears it", plainRemove);

// Fits a phone: no sideways scroll with the editor open.
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 1, "no horizontal overflow at 390px", String(overflow));

check(errors.length === 0, "no uncaught page errors", errors.join(" | "));

await browser.close();
if (fails.length) {
  console.log(`\n✗ RECIPE PHOTOS QA FAILED (${fails.length})`);
  process.exit(1);
}
console.log("\n✔ RECIPE PHOTOS QA PASSED");
