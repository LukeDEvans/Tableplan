#!/usr/bin/env node
// Headless QA for the Listen bell's music shows (AMPLIFIER_DESIGN.md): the badge,
// the notifications window (rows, Read, ×, closing itself when emptied, the empty
// bell's toast), the queue leaving shows out, and fitting a 360px phone. Drives
// the real app against the dev server. In a browser there's no native player, so
// Play opens the show to read (the iPhone flow is covered by unit tests with a
// fake plugin, and on the phone).
//
//   node scripts/qa-music-shows.mjs [url]   (default http://localhost:4174/; needs `npm run dev:local`)
//   QA_SHOWS_SHOT=/path/prefix → also saves screenshots
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
const SHOT = process.env.QA_SHOWS_SHOT || "";
const LAUNCH = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
const results = [];
const check = (cond, name, detail) => {
  results.push([cond ? "PASS" : "FAIL", name]);
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
};

async function launch() {
  try { return await chromium.launch({ ...LAUNCH, channel: "chrome" }); } catch { /* none */ }
  try { return await chromium.launch(LAUNCH); } catch { /* none */ }
  const p = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(p)) return chromium.launch({ ...LAUNCH, executablePath: p });
  throw new Error("No Chromium available");
}

const show = (id, title, savedAt) => ({
  id, url: null, title, author: "The Amplifier · NYT", publication: "email", savedAt, date: "Oct 27, 2026",
  text: "<p>Dear listeners,</p><h2>1. The First Band: “Opening Song”</h2><p>A song.</p>",
  musicShow: {
    v: 1, source: "amplifierToListen", title, author: "Pat Writer", durationText: "3 songs · 11 min 2 sec", image: "",
    intro: "Dear listeners,\n\nA playlist about two cities.",
    songs: [
      { n: 1, artist: "The First Band", title: "Opening Song", text: "A song.", appleMusicId: "111", appleMusicUrl: "" },
      { n: 2, artist: "Second Artist", title: "Rock’n Song", text: "A classic.", appleMusicId: null, appleMusicUrl: "" },
      { n: 3, artist: "The Quintet", title: "Mercy, Mercy (Live)", text: "Live.", appleMusicId: "333", appleMusicUrl: "" },
    ],
  },
});

const browser = await launch();
try {
  for (const width of [390, 360]) {
    console.log(`▸ ${width}px`);
    const context = await browser.newContext({ viewport: { width, height: 800 }, timezoneId: "America/Chicago" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    // No Gmail here: the one-time import just fails quietly.
    await page.route("**/.netlify/functions/gmail**", (r) => r.fulfill({ status: 400, json: { error: "Gmail not connected." } }));
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), { timeout: 20000 });
    if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
    await page.waitForFunction(() => !!window.__liveQA?.musicShowsSeedForQa, { timeout: 20000 });
    await page.waitForTimeout(600);

    // Fresh ids per run: the local server keeps state, and a show once dismissed
    // (read) rightly never comes back.
    const A = `show-a${width}-${Date.now()}`, B = `show-b${width}-${Date.now()}`;
    await page.evaluate((list) => window.__liveQA.musicShowsSeedForQa(list), [
      show(A, "Two Cities: a Ballpark Playlist", "2026-10-27T19:26:19.000Z"),
      show(B, "Great Live Albums", "2026-10-20T19:00:00.000Z"),
      { id: "news-x", url: null, title: "The Morning", text: "<p>news</p>", publication: "email", savedAt: "2026-10-28T10:00:00.000Z" },
    ]);
    const area = await page.evaluate(() => window.__liveQA.openPageForQa("media"));
    await page.waitForTimeout(800);
    check(area === "media", "Listen opens", area);

    const badge = await page.evaluate(() => { const b = document.getElementById("mediaNotifBadge"); return b && !b.hidden ? b.textContent : null; });
    // (Shows left over from an earlier run on the same local server count too.)
    const before = Number(badge);
    check(before >= 2, "bell badge counts the shows", `badge ${badge}`);

    await page.click("#mediaNotificationsBtn");
    await page.waitForTimeout(300);
    const rows = await page.evaluate(() => [...document.querySelectorAll(".music-show-dialog .music-show-row")].map((r) => ({ id: r.dataset.showId, title: r.querySelector(".music-show-title")?.textContent, sub: r.querySelector(".music-show-sub")?.textContent })));
    const mine = rows.filter((r) => r.id === A || r.id === B);
    check(mine.length === 2 && mine[0].id === A && rows.length === before, "window lists the shows, newest first", JSON.stringify(rows));
    check(mine[0]?.sub === "Pat Writer · 3 songs · 11 min 2 sec", "row shows author and length", mine[0]?.sub);
    const fit = await page.evaluate(() => {
      const d = document.querySelector(".music-show-dialog");
      const r = d.getBoundingClientRect();
      const overflow = [...d.querySelectorAll("*")].some((el) => el.getBoundingClientRect().right > window.innerWidth + 1);
      return { inside: r.right <= window.innerWidth + 1 && r.left >= -1, overflow, page: document.documentElement.scrollWidth <= window.innerWidth + 1 };
    });
    check(fit.inside && !fit.overflow && fit.page, "window fits the screen, nothing sideways", JSON.stringify(fit));
    if (SHOT) await page.screenshot({ path: `${SHOT}-${width}-bell.png` });

    // × on the older show: it leaves, the window stays for the other.
    await page.click(`.music-show-row[data-show-id="${B}"] [data-show-dismiss]`);
    await page.waitForTimeout(250);
    const after = await page.evaluate((ids) => ({ b: !!document.querySelector(`[data-show-id="${ids.B}"]`), a: !!document.querySelector(`[data-show-id="${ids.A}"]`), open: !!document.querySelector(".music-show-dialog[open]"), badge: document.getElementById("mediaNotifBadge")?.textContent }), { A, B });
    check(!after.b && after.a && after.open && after.badge === String(before - 1), "dismissing one leaves the rest, badge goes down", JSON.stringify(after));

    // Play in a browser: no native player → opens the show to read.
    await page.click(`.music-show-row[data-show-id="${A}"] [data-show-play]`);
    await page.waitForTimeout(800);
    const reading = await page.evaluate(() => ({ dialog: !!document.querySelector(".music-show-dialog"), reader: document.body.innerText.includes("Opening Song") }));
    check(!reading.dialog && reading.reader, "Play outside the iPhone app opens the show to read", JSON.stringify(reading));

    // Queue leaves shows out, keeps the newsletter briefing.
    await page.evaluate(() => window.__liveQA.openPageForQa("media"));
    await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('[data-media-tab="queue"]')?.click());
    await page.waitForTimeout(500);
    const queueText = await page.evaluate(() => document.getElementById("mediaMainPage")?.innerText || "");
    check(!queueText.includes("Two Cities: a Ballpark Playlist"), "the queue doesn't list the show");

    // Dismiss the last one → the window closes itself; the empty bell only toasts.
    await page.click("#mediaNotificationsBtn");
    await page.waitForTimeout(300);
    for (let i = 0; i < 10 && await page.$(".music-show-dialog [data-show-dismiss]"); i++) {
      await page.click(".music-show-dialog [data-show-dismiss]");
      await page.waitForTimeout(250);
    }
    const closed = await page.evaluate(() => ({ dialog: !!document.querySelector(".music-show-dialog"), badgeHidden: document.getElementById("mediaNotifBadge")?.hidden }));
    check(!closed.dialog && closed.badgeHidden, "last one dismissed: window closes, badge hides", JSON.stringify(closed));
    await page.click("#mediaNotificationsBtn");
    await page.waitForTimeout(300);
    const empty = await page.evaluate(() => ({ dialog: !!document.querySelector(".music-show-dialog"), text: document.body.innerText.includes("You're all caught up.") }));
    check(!empty.dialog && empty.text, "empty bell: toast, no window", JSON.stringify(empty));

    check(errors.length === 0, "no page errors", errors.join(" | "));
    await context.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(failed ? `\n✗ ${failed} of ${results.length} checks failed` : `\n✔ all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
