#!/usr/bin/env node
// Headless QA for Dutch practice (LANGUAGE_PRACTICE.md) through the real app:
// the Leisure row, a lesson's start screen, the matching board (wrong pairs cost
// nothing, a right pair scores once, replacements arrive, scope stays inside the
// lesson), reaching the goal, time running out, pausing when hidden, leaving
// mid-game, review unlocking, saved progress, phone widths, dark mode, reduced
// motion and the keyboard.
//
//   node scripts/qa-language.mjs [url]   (default http://localhost:4174/; needs `npm run dev:local`)
//   Delete data/tableplan-state.json first (local dev keeps one state file across runs).
//   QA_LANG_SHOT=/path/prefix → also saves screenshots
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { DUTCH_COURSE } from "../language-nl-starter.js";

const URL = process.argv[2] || "http://localhost:4174/";
const SHOT = process.env.QA_LANG_SHOT || "";
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

const LESSON = "nl-s1-1";
const lessonEntries = DUTCH_COURSE.entries.filter((e) => e.lesson === LESSON);
const enOf = new Map(lessonEntries.map((e) => [e.text, e.en]));

const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, timezoneId: "America/Chicago" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const boot = async (path = "") => {
    await page.goto("about:blank");
    await page.goto(URL + path, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.classList.contains("app-authed") || (document.getElementById("lockDevSignInBtn") && !document.getElementById("lockDevSignInBtn").hidden), { timeout: 20000 });
    if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
    await page.waitForFunction(() => !!window.__liveQA?.viewsReady?.(), { timeout: 20000 });
    await page.waitForTimeout(500);
  };
  const shot = async (name) => { if (!SHOT) return; await page.waitForTimeout(250); await page.screenshot({ path: `${SHOT}-${name}.png`, fullPage: true }); };
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const stored = () => page.evaluate(() => window.__liveQA.languageForQa());
  const shorten = (opts) => page.evaluate((o) => window.__liveQA.languageGameForQa(o), opts);
  const board = () => page.evaluate(() => {
    const read = (side) => [...document.querySelectorAll(`.lang-card[data-side="${side}"]`)].map((b) => ({
      text: b.querySelector(".lang-card-text").textContent, disabled: b.disabled,
      matched: b.classList.contains("is-matched"), miss: b.classList.contains("is-miss"),
      pressed: b.getAttribute("aria-pressed") === "true", visible: getComputedStyle(b).visibility !== "hidden",
    }));
    return { left: read("left"), right: read("right"), score: document.querySelector("[data-lang-score]")?.textContent || "" };
  });
  const tap = (side, i) => page.click(`.lang-card[data-side="${side}"][data-slot="${i}"]`);
  // Match one live pair: returns [leftIndex, rightIndex] or null.
  const findPair = async () => {
    const b = await board();
    for (let i = 0; i < b.left.length; i += 1) {
      if (b.left[i].disabled) continue;
      const j = b.right.findIndex((r) => !r.disabled && r.text === enOf.get(b.left[i].text));
      if (j >= 0) return [i, j];
    }
    return null;
  };
  const openLesson = async () => {
    await page.click(`[data-leisure-lesson="${LESSON}"]`);
    await page.waitForSelector(".lang-start [data-lang-begin]");
  };

  await boot("#leisure");

  console.log("Leisure row");
  const row = await page.evaluate(() => {
    const sec = document.querySelector('[data-recreate-section="dutch"]');
    return sec ? {
      title: sec.querySelector(".recreate-section-title")?.textContent,
      lessons: sec.querySelectorAll("[data-leisure-lesson]").length,
      review: sec.querySelector("[data-leisure-review] .workout-pool-last")?.textContent,
      emoji: /\p{Extended_Pictographic}/u.test(sec.textContent),
    } : null;
  });
  check(row?.title === "Dutch", "Leisure has a Dutch row", JSON.stringify(row));
  check(row?.lessons === 12, "the row shows the first 12 lessons", row?.lessons);
  check(row?.review === "Practice a lesson first", "Review waits for a practiced lesson", row?.review);
  check(row && !row.emoji, "no emoji in the row (house pictograms only)");
  check(await fits(), "Leisure fits 390px");
  await shot("row");

  console.log("Lessons screen");
  await page.click('[data-open-hobby="dutch"]');
  await page.waitForSelector(".lang-lesson");
  const lessons = await page.evaluate(() => ({
    count: document.querySelectorAll(".lang-lesson").length,
    provisionalTags: [...document.querySelectorAll(".lang-lesson-verify")].filter((t) => t.textContent.trim() === "Provisional").length,
    note: document.querySelector(".lang-note")?.textContent || "",
    reviewDisabled: document.querySelector('[data-lang-start="review"]')?.disabled,
  }));
  const totalLessons = DUTCH_COURSE.levels.flatMap((l) => l.units.flatMap((u) => u.lessons)).length;
  check(lessons.count === totalLessons, `all ${totalLessons} lessons listed`, lessons.count);
  check(lessons.provisionalTags === totalLessons, "every lesson is labeled Provisional");
  check(/not yet matched to your Rosetta Stone/.test(lessons.note), "the starter-set note says it isn't the Rosetta Stone list");
  check(lessons.reviewDisabled === true, "Review is off until a lesson is practiced");
  check(await fits(), "lessons fit 390px");
  await shot("lessons");
  await page.click('[data-recreate-back]');
  await page.waitForSelector('[data-recreate-section="dutch"]');

  console.log("Start and board");
  await openLesson();
  const start = await page.evaluate(() => document.querySelector(".lang-start")?.textContent.replace(/\s+/g, " "));
  check(/People and animals/.test(start) && /Words\s*10/.test(start) && /30 matches/.test(start) && /2:00/.test(start), "start screen shows the lesson, words, goal and time", start);
  await shot("start");
  await shorten({ target: 6, durationMs: 60_000 });
  await page.click("[data-lang-begin]");
  await page.waitForSelector(".lang-card");
  let b = await board();
  check(b.left.length === 5 && b.right.length === 5, "five cards a side");
  check(new Set(b.left.map((c) => c.text)).size === 5 && new Set(b.right.map((c) => c.text)).size === 5, "no card twice on a side");
  check(b.left.every((c) => enOf.has(c.text)), "only this lesson's Dutch words");
  check(b.left.every((c) => b.right.some((r) => r.text === enOf.get(c.text))), "every Dutch card's answer is on the board");
  check(b.score === "0 / 6", "score starts at 0", b.score);
  check(await fits(), "board fits 390px");
  await shot("board");

  // Same-side reselect
  await tap("left", 0);
  await tap("left", 1);
  b = await board();
  check(!b.left[0].pressed && b.left[1].pressed, "a second Dutch tap moves the selection");
  await tap("left", 1);
  b = await board();
  check(!b.left[1].pressed, "tapping the selected card clears it");

  // Wrong pair
  const wrongRight = b.right.findIndex((r) => r.text !== enOf.get(b.left[0].text));
  const beforeTexts = JSON.stringify([b.left.map((c) => c.text), b.right.map((c) => c.text)]);
  await tap("left", 0);
  await tap("right", wrongRight);
  b = await board();
  check(b.score === "0 / 6", "a wrong pair scores nothing", b.score);
  check(b.left[0].miss && b.right[wrongRight].miss, "a wrong pair flashes both cards");
  check(!b.left[0].disabled && !b.right[wrongRight].disabled, "wrong cards stay in play");
  check(JSON.stringify([b.left.map((c) => c.text), b.right.map((c) => c.text)]) === beforeTexts, "nothing moves after a wrong pair");
  const missMark = await page.evaluate(() => !!document.querySelector(".lang-card.is-miss .lang-card-mark svg"));
  check(missMark, "a miss shows a mark, not just a color");

  // Right pair + double tap
  let [li, ri] = await findPair();
  const matchedText = b.left[li].text;
  await page.evaluate(([l, r]) => {
    const L = document.querySelector(`.lang-card[data-side="left"][data-slot="${l}"]`);
    const R = document.querySelector(`.lang-card[data-side="right"][data-slot="${r}"]`);
    L.click(); R.click(); R.click(); L.click(); R.click(); // a frantic burst
  }, [li, ri]);
  b = await board();
  check(b.score === "1 / 6", "a right pair counts once, even with rapid extra taps", b.score);
  check(b.left[li].matched && b.left[li].disabled && b.right[ri].matched, "matched cards are marked and can't be picked");
  await page.waitForTimeout(1700);
  b = await board();
  check(!b.left[li].disabled && b.left[li].text !== matchedText, "a new pair replaces it within 1.5 s", b.left[li].text);
  check(b.left.every((c) => b.right.some((r) => r.text === enOf.get(c.text))), "the board stays answerable after a replacement");

  // A late timer: the replacement is due but its timer hasn't run when the next
  // tap arrives. The tap must draw the replacement, not leave a dead card.
  [li, ri] = await findPair();
  await tap("left", li);
  await tap("right", ri);
  const lateSlot = li;
  const late = await page.evaluate((slot) => {
    const until = Date.now() + 1700;
    while (Date.now() < until) { /* hold the main thread past the refill time */ }
    const other = [...document.querySelectorAll('.lang-card[data-side="left"]')].find((b) => !b.disabled && b.dataset.slot !== String(slot));
    other.click(); // runs before any timer callback can
    const b = document.querySelector(`.lang-card[data-side="left"][data-slot="${slot}"]`);
    return { disabled: b.disabled, matched: b.classList.contains("is-matched"), text: b.querySelector(".lang-card-text").textContent };
  }, lateSlot);
  check(!late.disabled && !late.matched && late.text, "a tap after a late timer still draws the replacement", JSON.stringify(late));
  await page.waitForTimeout(100);
  { const bb = await board(); const sel = bb.left.findIndex((c) => c.pressed); if (sel >= 0) await tap("left", sel); }

  // Keyboard: Enter on a focused card selects it
  await page.focus('.lang-card[data-side="left"][data-slot="0"]');
  await page.keyboard.press("Enter");
  b = await board();
  check(b.left[0].pressed, "Enter on a focused card selects it");
  await page.keyboard.press("Enter");

  // Play to the goal
  for (let n = 0; n < 40; n += 1) {
    if (await page.$(".lang-summary")) break;
    const p = await findPair();
    if (!p) { await page.waitForTimeout(300); continue; }
    await tap("left", p[0]);
    await tap("right", p[1]);
  }
  await page.waitForSelector(".lang-summary", { timeout: 15000 });
  const summary = await page.evaluate(() => document.querySelector(".lang-summary").textContent.replace(/\s+/g, " "));
  check(/Goal reached/.test(summary) && /Matched\s*6/.test(summary), "reaching the goal ends the game", summary);
  check(/Accuracy\s*86%/.test(summary), "accuracy = 6 right of 7 tries", summary);
  await shot("summary");
  let saved = await stored();
  check(saved.sessions.length === 1 && saved.sessions[0].reached && saved.sessions[0].correct === 6 && saved.sessions[0].attempts === 7, "the session is saved once", JSON.stringify(saved.sessions));
  const touched = Object.keys(saved.words);
  check(touched.length >= 6 && touched.every((id) => id.startsWith(`${LESSON}-`)), "progress only for this lesson's words", touched.join(","));

  console.log("Play again, leave mid-game");
  await shorten({ target: 6, durationMs: 60_000 });
  await page.click("[data-lang-again]");
  await page.waitForSelector(".lang-card");
  b = await board();
  check(b.score === "0 / 6" && b.left.every((c) => !c.pressed && !c.matched), "Play again starts clean");
  const w = b.right.findIndex((r) => r.text !== enOf.get(b.left[0].text));
  await tap("left", 0);
  await tap("right", w);
  await page.evaluate(() => window.__liveQA.goHome()); // leave through the app's own navigation
  await page.waitForTimeout(800);
  saved = await stored();
  check(saved.sessions.length === 2 && saved.sessions[0].endReason === "left" && saved.sessions[0].attempts === 1, "leaving mid-game saves it once, as left", JSON.stringify(saved.sessions[0]));
  await page.waitForTimeout(600);
  saved = await stored();
  check(saved.sessions.length === 2, "and never twice");
  await page.evaluate(() => {
    // Open the Recreate group on the landing page, then Leisure.
    const btn = document.getElementById("homeLeisureBtn");
    btn.closest(".page-group")?.querySelector(".page-group-head")?.click();
  });
  await page.waitForTimeout(300);
  await page.click("#homeLeisureBtn");
  await page.waitForSelector('[data-open-hobby="dutch"]');
  await page.click('[data-open-hobby="dutch"]');
  await page.waitForSelector(".lang-lesson");
  check(!(await page.$(".lang-card")), "coming back opens the lessons, not a stale game");
  const reviewOn = await page.evaluate(() => document.querySelector('[data-lang-start="review"]')?.disabled === false);
  check(reviewOn, "Review is on after practicing");
  await page.click('[data-lang-start="review"]');
  const rv = await page.evaluate(() => document.querySelector(".lang-start")?.textContent.replace(/\s+/g, " "));
  check(/1 practiced lesson: People and animals/.test(rv) && /Words\s*10/.test(rv), "Review draws from the practiced lesson only", rv);

  console.log("Time, pause");
  await shorten({ target: 30, durationMs: 3000 });
  await page.click("[data-lang-begin]");
  await page.waitForSelector(".lang-card");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(3500);
  const paused = await page.evaluate(() => !document.querySelector("[data-lang-paused]")?.hidden && !document.querySelector(".lang-summary"));
  check(paused, "hiding the app pauses the clock");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.click("[data-lang-resume]");
  await page.waitForSelector(".lang-summary", { timeout: 6000 });
  const timeUp = await page.evaluate(() => document.querySelector(".lang-summary").textContent.replace(/\s+/g, " "));
  check(/Time's up/.test(timeUp) && /No pairs tried, so nothing was saved/.test(timeUp) && /Accuracy\s*—/.test(timeUp), "time runs out; no tries → accuracy — and nothing saved", timeUp);
  saved = await stored();
  check(saved.sessions.length === 2, "an untouched game isn't saved");

  console.log("Phones, dark mode, reduced motion");
  await page.setViewportSize({ width: 360, height: 740 });
  await shorten({ target: 30, durationMs: 60_000 });
  await page.click("[data-lang-lessons]");
  await page.click('[data-lang-start="lesson"][data-lang-id="nl-s2-2"]'); // the longest phrases
  await page.click("[data-lang-begin]");
  await page.waitForSelector(".lang-card");
  check(await fits(), "the phrases board fits 360px");
  const clipped = await page.evaluate(() => [...document.querySelectorAll(".lang-card")].some((c) => c.scrollWidth > c.clientWidth + 1));
  check(!clipped, "no card text is cut off at 360px");
  const tall = await page.evaluate(() => Math.min(...[...document.querySelectorAll(".lang-card")].map((c) => c.getBoundingClientRect().height)));
  check(tall >= 44, "cards are at least 44px tall to tap", tall);
  // The whole board is above the dock, so nothing needs scrolling mid-game.
  const above = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".lang-card")];
    const bottom = Math.max(...cards.map((c) => c.getBoundingClientRect().bottom));
    const dock = [...document.querySelectorAll(".mini-player, #miniPlayer, .dock, #appDock")].map((d) => d.getBoundingClientRect()).filter((r) => r.height > 0);
    const limit = dock.length ? Math.min(...dock.map((r) => r.top)) : window.innerHeight;
    return { bottom, limit, ok: bottom <= limit };
  });
  check(above.ok, "the whole board sits above the dock at 360×740", JSON.stringify(above));
  await shot("board-360");
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Mode is a per-person setting (theme.js); CSS only sees body[data-theme].
  await page.evaluate(() => { document.body.dataset.theme = "dark"; });
  await page.waitForTimeout(400);
  const dark = await page.evaluate(() => {
    const lum = (rgb) => {
      const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const c = document.querySelector(".lang-card");
    const cs = getComputedStyle(c);
    const L1 = lum(cs.color), L2 = lum(cs.backgroundColor);
    return { fg: cs.color, bg: cs.backgroundColor, bgDark: L2 < 0.2, ratio: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) };
  });
  check(dark.bgDark && dark.ratio >= 4.5, "dark mode: dark cards, text at 4.5:1 or better", JSON.stringify(dark));
  await shot("board-dark");
  const p2 = (await board()).right.findIndex((r, j, all) => j > 0);
  await tap("left", 0);
  await tap("right", p2 === 0 ? 1 : p2);
  const anim = await page.evaluate(() => {
    const m = document.querySelector(".lang-card.is-miss");
    return m ? getComputedStyle(m).animationName : "no-miss";
  });
  check(anim === "none" || anim === "no-miss", "reduced motion turns the shake off", anim);
  await page.click("[data-lang-quit]");
  await page.waitForSelector(".lang-summary");

  check(errors.length === 0, "no page errors", errors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter(([r]) => r === "FAIL").length;
console.log(`\n${failed ? "✗" : "✔"} Dutch practice QA: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
