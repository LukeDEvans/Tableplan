#!/usr/bin/env node
// Headless QA for Dutch practice (LANGUAGE_PRACTICE.md) through the real app.
// Part 1, matching: the Leisure row, a lesson's screen, the board (wrong pairs
// cost nothing, a right pair scores once, replacements arrive, scope stays inside
// the lesson), the goal, time running out, pausing when hidden, leaving mid-game,
// saved progress, phone widths, dark mode, reduced motion and the keyboard.
// Part 2, the learning build: Add words (paste), your course first, flashcards
// (grades, Again comes back, type-it on produce cards, saved schedule survives a
// reload), de/het, Listen, Sentences, Speak (fake mic + stubbed recognizer),
// settings, the word list, and every screen fitting 390/360 px.
// Speech is stubbed (window.speechSynthesis / webkitSpeechRecognition) so the
// run doesn't depend on voices the headless browser lacks.
//
//   node scripts/qa-language.mjs [url]   (default http://localhost:4174/; needs `npm run dev:local`)
//   Delete data/tableplan-state.json first (local dev keeps one state file across runs).
//   QA_LANG_SHOT=/path/prefix → also saves screenshots
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { DUTCH_COURSE } from "../language-nl-starter.js";
import { conjugate, verbFor } from "../language-verbs.js";
import { WORD_ORDER_ITEMS } from "../language-nl-wordorder.js";
import { sentenceTokens } from "../language-sentences.js";
import { STARTER_SENTENCES } from "../language-nl-sentences.js";

const URL = process.argv[2] || "http://localhost:4174/";
const SHOT = process.env.QA_LANG_SHOT || "";
const LAUNCH = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] };
const results = [];
const check = (cond, name, detail) => {
  results.push([cond ? "PASS" : "FAIL", name]);
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
};

async function launch() {
  try { return await chromium.launch({ ...LAUNCH, channel: "chrome" }); } catch { /* none */ }
  try { return await chromium.launch(LAUNCH); } catch { /* none */ }
  for (const p of [`${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`, "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"]) {
    if (existsSync(p)) { try { return await chromium.launch({ ...LAUNCH, executablePath: p }); } catch { /* next */ } }
  }
  throw new Error("No Chromium available");
}

const LESSON = "nl-s1-1";
const lessonEntries = DUTCH_COURSE.entries.filter((e) => e.lesson === LESSON);
const enOf = new Map(lessonEntries.map((e) => [e.text, e.en]));

const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, timezoneId: "America/Chicago", permissions: ["microphone"] });
  await context.addInitScript(() => {
    // Speech stubs: every spoken text is recorded; the recognizer "hears"
    // window.__nextHeard (default: whatever is asked).
    window.__spoken = [];
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    const synth = {
      speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 20); },
      cancel() {}, getVoices() { return [{ name: "Xander", lang: "nl-NL", localService: true }]; }, addEventListener() {},
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    window.__nextHeard = null;
    class Rec {
      start() {
        setTimeout(() => {
          const heard = window.__nextHeard || [""];
          const res = Object.assign(heard.map((t) => ({ transcript: t })), { isFinal: true });
          this.onresult && this.onresult({ results: [res] });
          this.onend && this.onend();
        }, 400);
      }
      stop() {}
    }
    window.webkitSpeechRecognition = Rec;
    window.SpeechRecognition = Rec;
  });
  await context.addInitScript((list) => { window.__qaStarterSentences = list; }, STARTER_SENTENCES.map((x) => x.text));
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
    await page.waitForSelector(".lang-lesson-view");
    await page.click('.lang-lesson-view [data-lang-practice="match"]');
    await page.waitForSelector(".lang-start [data-lang-begin]");
  };


  // ── Part 2: the learning build ────────────────────────────────────────────
  async function part2() {
    const spoken = () => page.evaluate(() => window.__spoken.slice());
    const clearSpoken = () => page.evaluate(() => { window.__spoken.length = 0; });
    const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent.replace(/\s+/g, " ").trim() || "", sel);

    console.log("Add words");
    await page.click(".lang-hub [data-lang-add]");
    await page.waitForSelector("[data-wd-form]");
    check(await fits(), "Add words fits 390px");
    await page.fill('[data-wd-field="unit"]', "1");
    await page.fill('[data-wd-field="lesson"]', "2");
    await page.fill('[data-wd-field="unitTitle"]', "Basics");
    await page.fill('[data-wd-field="title"]', "Food");
    await page.fill('[data-wd-field="text"]', [
      "het brood = bread", "de appel = apple", "de kaas — cheese", "het water\twater", "drinken = to drink; to have a drink",
      "de melk = milk", "het ei = egg", "Ik eet een appel. = I'm eating an apple.", "De jongen drinkt water. = The boy drinks water.",
      "zomaar",
    ].join("\n"));
    await page.click("[data-wd-preview]");
    await page.waitForSelector(".lang-preview");
    const pv = await page.evaluate(() => ({
      rows: document.querySelectorAll(".lang-preview-list li").length,
      errors: document.querySelectorAll(".lang-preview-list li.is-error").length,
      sentences: [...document.querySelectorAll(".lang-chip")].filter((c) => c.textContent.trim() === "Sentence").length,
      head: document.querySelector(".lang-preview h4")?.textContent || "",
    }));
    check(pv.rows === 10 && pv.errors === 1, "preview lists every line and flags the one without English", JSON.stringify(pv));
    check(pv.sentences === 2, "whole sentences are filed as sentences", pv.sentences);
    check(/9 to add to Unit 1 \(Basics\) · Lesson 2: Food/.test(pv.head), "preview names the unit and lesson", pv.head);
    check(await fits(), "preview fits 390px");
    await shot("add-preview");
    // Leave one out, then save.
    await page.click('[data-wd-drop="6"]');
    await page.click("[data-wd-save]");
    await page.waitForSelector("[data-wd-open]");
    const added = await text(".lang-summary");
    check(/Added 8/.test(added), "saving adds what was kept", added);
    let st = await stored();
    const userWords = Object.values(st.userWords || {});
    check(userWords.length === 8 && userWords.filter((w) => w.kind === "sentence").length === 2, "8 items saved, 2 of them sentences", userWords.length);
    check(userWords.find((w) => w.text === "drinken")?.alsoEn?.[0] === "to have a drink", "a second English meaning is kept");
    check(st.userLessons?.["nl-u1-2"]?.title === "Food", "the lesson is saved with its title");
    // Paste the same again: duplicates are skipped.
    await page.click("[data-wd-more]");
    await page.fill('[data-wd-field="text"]', "het brood = bread\nde boter = butter");
    await page.click("[data-wd-preview]");
    await page.click("[data-wd-save]");
    await page.waitForSelector("[data-wd-open]");
    const again = await text(".lang-summary");
    check(/Added 1/.test(again) && /1 was already in this lesson/.test(again), "a word already in the lesson is skipped", again);
    await page.click("[data-wd-open]");
    await page.waitForSelector(".lang-lesson-view");
    const lv = await text(".lang-lesson-view");
    check(/Unit 1: Basics/.test(lv) && /Lesson 2: Food/.test(lv) && /Words\s*7/.test(lv), "the lesson screen shows your lesson", lv);
    check(await fits(), "lesson screen fits 390px");
    await shot("lesson");
    await page.click("[data-lang-hub]");
    await page.waitForSelector(".lang-hub");
    const firstLevel = await text(".lang-level .lang-level-sub");
    check(/Your course/.test(firstLevel), "Your course is listed first", firstLevel);
    check(!(await page.$(".lang-hub .lang-note")), "the starter note goes once you have lessons");

    console.log("Flashcards");
    await page.click('.lang-lesson[data-lang-lesson="nl-u1-2"]');
    await page.click('.lang-lesson-view [data-lang-practice="cards"]');
    await page.waitForSelector(".lang-fc");
    await page.waitForTimeout(150);
    const front = await text(".lang-fc-word");
    check(front === "het brood", "the first new word is the first one pasted", front);
    check((await spoken()).includes("het brood"), "the Dutch is played automatically");
    check(!(await page.$("[data-fc-grade]")), "no grades before the answer is shown");
    check(await fits(), "flashcard fits 390px");
    await page.click("[data-fc-show]");
    const back = await text(".lang-fc-card");
    check(/bread/.test(back) && /het-word/.test(back), "the back shows the English and the gender", back);
    const grades = await page.evaluate(() => [...document.querySelectorAll("[data-fc-grade]")].map((b) => [...b.children].map((c) => c.textContent.trim()).join(" ")));
    check(grades.join("|") === "Again 1d|Hard 1d|Good 4d|Easy 2w", "grades show when the card comes back", grades.join("|"));
    await shot("card-back");
    await page.click("[data-fc-grade='1']"); // Again: comes back later in the session
    const leftAfterAgain = await text(".lang-fc-left");
    check(/7 left/.test(leftAfterAgain), "Again puts the card back in the session", leftAfterAgain);
    const seenFronts = [front];
    for (let n = 0; n < 12; n += 1) {
      if (!(await page.$("[data-fc-show]"))) break;
      seenFronts.push(await text(".lang-fc-word"));
      await page.keyboard.press(" ");
      await page.keyboard.press("3");
    }
    check(seenFronts.filter((f) => f === "het brood").length === 2, "the missed card was shown again", seenFronts.join(", "));
    await page.waitForSelector(".lang-summary");
    const done = await text(".lang-summary");
    check(/Done for now/.test(done) && /8 cards reviewed, 7 new words/.test(done), "the session ends with a plain summary", done);
    check(!/Learn 5 more/.test(done), "no 'more words' offer when the lesson has none left");
    st = await stored();
    const keys = Object.keys(st.cards || {});
    check(keys.length === 7 && keys.every((k) => k.endsWith("|r")), "seven recognize cards scheduled (the 7 words, not the sentences)", keys.join(","));
    check(st.sessions[0].kind === "cards" && st.sessions[0].attempts === 8 && st.sessions[0].correct === 7, "one flashcard session saved", JSON.stringify(st.sessions[0]));
    await page.click("[data-fc-back]");

    console.log("Saved across a reload; produce cards next day");
    await boot("#leisure");
    st = await stored();
    check(Object.keys(st.cards || {}).length === 7 && Object.keys(st.userWords || {}).length === 9, "cards and words survive a reload", `${Object.keys(st.cards || {}).length} / ${Object.keys(st.userWords || {}).length}`);
    // Pretend the cards were answered yesterday: the produce side unlocks.
    const yesterday = Date.now() - 86_400_000;
    const day = (ms) => Math.floor((ms - new Date(ms).getTimezoneOffset() * 60_000) / 86_400_000);
    const seeded = {};
    for (const k of Object.keys(st.cards)) seeded[k] = [4, 5, day(yesterday) + 4, yesterday, 1, 0, day(yesterday)];
    await page.evaluate((c) => window.__liveQA.languageCardsForQa(c), seeded);
    await page.click('[data-open-hobby="dutch"]');
    await page.click('.lang-lesson[data-lang-lesson="nl-u1-2"]');
    await page.click('.lang-lesson-view [data-lang-practice="cards"]');
    await page.waitForSelector(".lang-fc");
    const dir = await page.evaluate(() => document.querySelector(".lang-fc")?.dataset.fcDir);
    check(dir === "p", "the produce card (English → Dutch) comes up", dir);
    const en = await text(".lang-fc-word");
    const nlOf = { bread: "het brood", apple: "de appel", cheese: "de kaas", water: "het water", "to drink": "drinken", milk: "de melk", butter: "de boter" };
    await page.fill("[data-fc-input]", (nlOf[en] || "").replace(/^(de|het) /, ""));
    await page.keyboard.press("Enter");
    const typed = await text(".lang-typed");
    const suggested = await page.evaluate(() => document.querySelector(".lang-grade.is-suggested")?.dataset.fcGrade);
    check(/Almost/.test(typed) && suggested === "2", "a missing article is 'almost' and suggests Hard", `${typed} / ${suggested}`);
    await shot("card-typed");
    await page.click("[data-fc-grade='2']");
    // Type one exactly.
    const en2 = await text(".lang-fc-word");
    if (nlOf[en2]) {
      await page.fill("[data-fc-input]", nlOf[en2]);
      await page.keyboard.press("Enter");
      const g2 = await page.evaluate(() => document.querySelector(".lang-grade.is-suggested")?.dataset.fcGrade);
      check(g2 === "3", "an exact answer suggests Good", g2);
    }
    await page.click("[data-fc-back]");
    st = await stored();
    check(Object.keys(st.cards).some((k) => k.endsWith("|p")), "leaving mid-session keeps the answers given");

    console.log("de / het");
    await page.waitForSelector(".lang-lesson-view");
    await page.click('.lang-lesson-view [data-lang-practice="dehet"]');
    await page.waitForSelector(".lang-dh");
    const nouns = new Map([["brood", "het"], ["appel", "de"], ["kaas", "de"], ["water", "het"], ["melk", "de"], ["boter", "de"]]);
    let firstWrong = "";
    for (let n = 0; n < 20; n += 1) {
      if (await page.$(".lang-summary")) break;
      const noun = (await text(".lang-dh .lang-fc-word")).trim();
      const art = nouns.get(noun);
      const pickArt = !firstWrong ? (art === "de" ? "het" : "de") : art; // miss the first one
      if (!firstWrong) firstWrong = noun;
      await clearSpoken();
      await page.click(`[data-dh-pick="${pickArt}"]`);
      if (n === 0) {
        const res = await text(".lang-dh-result");
        check(new RegExp(`It's ${art} ${noun}`).test(res), "a wrong article shows the right one", res);
        check((await spoken()).includes(`${art} ${noun}`), "and says it");
        await shot("dehet");
      }
      await page.click("[data-dh-next]");
    }
    const dh = await text(".lang-summary");
    check(/5 of 6 right the first time/.test(dh), "the missed noun came back; summary counts first tries", dh);
    await page.click("[data-dh-back]");

    console.log("Listen");
    await page.click('.lang-lesson-view [data-lang-practice="listen"]');
    await page.waitForSelector(".lang-ls");
    await page.waitForTimeout(100);
    check((await spoken()).length > 0, "a question plays as it opens");
    check(await fits(), "listen fits 390px");
    let lsRight = 0;
    for (let n = 0; n < 12; n += 1) {
      if (await page.$(".lang-summary")) break;
      const said = (await spoken()).slice(-1)[0];
      if (await page.$("[data-ls-input]")) {
        await page.fill("[data-ls-input]", said);
        await page.click(".lang-ls [type=submit]");
      } else {
        const k = await page.evaluate((t) => [...document.querySelectorAll("[data-ls-pick]")].findIndex((b) => b.querySelector("[lang=nl]").textContent === t), said);
        await page.click(`[data-ls-pick="${k}"]`);
      }
      if (/Right/.test(await text(".lang-dh-result"))) lsRight += 1;
      await clearSpoken();
      await page.click("[data-ls-next]");
      await page.waitForTimeout(60);
    }
    const ls = await text(".lang-summary");
    check(/Round done/.test(ls) && lsRight >= 7, "answering what was heard gets them right", `${ls} (${lsRight})`);
    await page.click("[data-ls-back]");

    console.log("Sentences");
    await page.click('.lang-lesson-view [data-lang-practice="sentences"]');
    await page.waitForSelector(".lang-sb");
    const target = { "I'm eating an apple.": ["ik", "eet", "een", "appel"], "The boy drinks water.": ["de", "jongen", "drinkt", "water"] };
    for (let n = 0; n < 3; n += 1) {
      if (await page.$(".lang-summary")) break;
      if (await page.$("[data-sb-hint]")) await page.click("[data-sb-hint]");
      const en = await text(".lang-sb-en");
      for (const w of target[en] || []) {
        await page.evaluate((word) => [...document.querySelectorAll(".lang-sb-bank .lang-tile:not([disabled])")].find((b) => b.textContent.toLowerCase() === word)?.click(), w);
      }
      await page.click("[data-sb-check]");
      const r = await text(".lang-dh-result");
      check(/Ik eet een appel\.|De jongen drinkt water\./.test(r), `built "${en}" right`, r);
      if (n === 0) { check(await fits(), "sentences fit 390px"); await shot("sentence"); }
      await page.click("[data-sb-next]");
    }
    const sb = await text(".lang-summary");
    check(/2 of 2 built right/.test(sb), "sentence summary", sb);
    st = await stored();
    check(Object.keys(st.cards).filter((k) => k.endsWith("|s")).length === 2, "built sentences are scheduled too");
    await page.click("[data-sb-back]");

    console.log("Speak");
    await page.click('.lang-lesson-view [data-lang-practice="speak"]');
    await page.waitForSelector(".lang-sp");
    const say1 = await text(".lang-sp .lang-fc-word");
    await page.evaluate((t) => { window.__nextHeard = [t.toLowerCase()]; }, say1);
    await page.click("[data-sp-mic]");
    await page.waitForSelector(".lang-mic.is-listening");
    check(true, "the mic shows it's listening");
    await page.waitForSelector(".lang-sp .lang-dh-result", { timeout: 5000 });
    const r1 = await text(".lang-sp .lang-dh-result");
    check(/Understood/.test(r1), "saying the word is understood", r1);
    const mine = await page.evaluate(() => !document.querySelector("[data-sp-mine]")?.disabled);
    check(mine, "your recording can be played back");
    check(await fits(), "speak fits 390px");
    await shot("speak");
    await page.click("[data-sp-next]");
    await page.evaluate(() => { window.__nextHeard = ["helemaal iets anders"]; });
    await page.click("[data-sp-mic]");
    await page.waitForSelector(".lang-sp .lang-dh-result", { timeout: 5000 });
    const r2 = await text(".lang-sp .lang-dh-result");
    check(/^Heard: helemaal iets anders/.test(r2), "something else is shown as heard, not understood", r2);
    await page.click("[data-sp-back]");
    st = await stored();
    check(st.sessions.some((x) => x.kind === "speak" && x.attempts === 2 && x.correct === 1), "a speak session is saved", JSON.stringify(st.sessions.filter((x) => x.kind === "speak")));

    console.log("Word list, settings");
    await page.click('.lang-lesson-view [data-lang-words]');
    await page.waitForSelector(".lang-wordlist");
    check((await page.$$(".lang-wl-row")).length === 9, "the word list shows the lesson's 9 items");
    await page.fill("[data-wl-search]", "kaas");
    check((await page.$$(".lang-wl-row")).length === 1, "search narrows the list");
    await page.click("[data-wl-edit]");
    await page.fill("[data-wl-en]", "cheese; a cheese");
    await page.click(".lang-wl-edit [type=submit]");
    st = await stored();
    check(Object.values(st.userWords).find((w) => w.text === "de kaas")?.alsoEn?.[0] === "a cheese", "editing a word saves it");
    await page.click("[data-wl-edit]");
    await page.click("[data-wl-delete]");
    st = await stored();
    check(Object.values(st.userWords).find((w) => w.text === "" && w.del) && !Object.values(st.userWords).some((w) => w.text === "de kaas"), "deleting leaves a tombstone");
    check(await fits(), "word list fits 390px");
    await page.click("[data-wl-back]");
    await page.click("[data-lang-hub]");
    await page.waitForSelector(".lang-hub");
    await page.click(".lang-settings summary");
    await page.selectOption('[data-lang-pref="newPerDay"]', "5");
    st = await stored();
    check(st.prefs?.newPerDay === 5, "the daily new-word setting is saved");
    const today2 = await text(".lang-today-counts");
    // Limit 5; one produce card was introduced today (sentences don't count).
    // The de/het miss is due again unless the missed noun was the one deleted
    // above (the round's order is random), so 0 or 1 to review.
    check(/[01] to review · 4 new/.test(today2), "and Today follows it", today2);
    await page.click('[data-lang-pref="showStarter"]');
    const starterGone = await page.evaluate(() => ![...document.querySelectorAll(".lang-level-sub")].some((h) => /Starter/.test(h.textContent)));
    check(starterGone, "the starter set can be hidden");
    await page.click(".lang-settings summary"); // closed again on re-render? reopen to toggle back
    if (!(await page.$('.lang-settings[open]'))) await page.click(".lang-settings summary");
    await page.click('[data-lang-pref="showStarter"]');

    console.log("360px");
    await page.setViewportSize({ width: 360, height: 740 });
    check(await fits(), "hub fits 360px");
    await page.click('.lang-lesson[data-lang-lesson="nl-u1-2"]');
    check(await fits(), "lesson fits 360px");
    await page.click('.lang-lesson-view [data-lang-practice="sentences"]');
    await page.waitForSelector(".lang-sb");
    check(await fits(), "sentences fit 360px");
    await page.click("[data-sb-back]");
    await page.click('.lang-lesson-view [data-lang-practice="cards"]');
    await page.waitForSelector(".lang-fc, .lang-summary");
    check(await fits(), "flashcards fit 360px");
    await page.click("[data-fc-back]");
  }

  // ── Part 3: verbs, word order, fill in, problem words, reading (§20–24) ───
  async function part3() {
    const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent.replace(/\s+/g, " ").trim() || "", sel);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click("[data-recreate-back]"); // back to the Leisure rows
    await page.waitForSelector('[data-open-hobby="dutch"]');
    const rowRead = await page.$('[data-leisure-read]');
    check(!!rowRead, "the Dutch row has a Read the news card");
    await page.click('[data-open-hobby="dutch"]');
    await page.waitForSelector(".lang-hub");
    const tiles = await page.evaluate(() => [...document.querySelectorAll(".lang-hub .lang-practice-btn")].map((b) => b.textContent.trim()));
    check(["Verbs", "Word order", "Fill in"].every((t) => tiles.includes(t)), "Verbs, Word order and Fill in are on the hub", tiles.join("|"));
    check(!!(await page.$(".lang-read-card")), "the hub has a Read the news card");
    check(await fits(), "hub fits 390px");

    console.log("Verbs");
    await page.click('.lang-hub [data-lang-practice="verbs"]');
    await page.waitForSelector("[data-vb-begin]");
    const vbStart = await text(".lang-start");
    check(/verbs\. Type the form/.test(vbStart), "the verb drill opens on its start screen", vbStart);
    await page.click('[data-vb-tense="mixed"]');
    await page.click("[data-vb-begin]");
    let vbRight = 0;
    for (let n = 0; n < 12; n += 1) {
      if (await page.$(".lang-summary")) break;
      const inf = await text(".lang-vb .lang-fc-word");
      const tense = (await text(".lang-vb .lang-kicker")).toLowerCase();
      const personLabel = await text(".lang-vb-person");
      const person = personLabel.startsWith("hij") ? "hij" : personLabel.startsWith("zij") ? "zij" : personLabel;
      const f = conjugate(verbFor(inf), tense, person);
      await page.fill("[data-vb-input]", n === 0 ? "xxx" : f.answer);
      await page.keyboard.press("Enter");
      const res = await text(".lang-vb .lang-dh-result");
      if (n === 0) {
        check(/^It's/.test(res) && res.includes(f.answer), "a wrong form shows the right one", res);
        check((await text(".lang-vb .lang-start-detail")).length > 10, "and the rule behind it");
        check(await fits(), "verbs fit 390px");
        await shot("verbs");
      } else if (/Right/.test(res)) vbRight += 1;
      await page.click("[data-vb-next]");
    }
    check(vbRight === 11, "typing the right form is marked right every time", vbRight);
    const vbDone = await text(".lang-summary");
    check(/11 of 12 right/.test(vbDone), "verb summary", vbDone);
    let st = await stored();
    check(st.sessions.some((x) => x.kind === "verbs" && x.attempts === 12), "a verbs session is saved");
    check(Object.keys(st.words).some((k) => k.startsWith("verb:")), "verb misses are counted for weighting");
    await page.click("[data-vb-back]");

    console.log("Word order");
    await page.click('.lang-hub [data-lang-practice="order"]');
    await page.waitForSelector(".lang-wo");
    const placeAll = async (wrong = false) => {
      const en = await text(".lang-wo .lang-sb-en");
      const item = WORD_ORDER_ITEMS.find((x) => x.en === en);
      const rest = sentenceTokens(item.text).slice(item.start);
      const order = wrong ? [...rest].reverse() : rest;
      for (const word of order) {
        await page.evaluate((w) => [...document.querySelectorAll(".lang-wo .lang-sb-bank .lang-tile:not([disabled])")].find((b) => b.textContent === w)?.click(), word);
      }
      return item;
    };
    const first = await placeAll(true);
    await page.click("[data-wo-check]");
    const woWrong = await text(".lang-wo .lang-dh-result");
    check(/wrong place/.test(woWrong) || /✓/.test(woWrong), "a wrong order is marked", woWrong);
    check(/(verb|helping)/i.test(await text(".lang-wo-rule")), "the rule is explained after a try");
    await shot("word-order");
    await page.click("[data-wo-show]");
    await page.click("[data-wo-next]");
    for (let n = 1; n < 8; n += 1) {
      await placeAll(false);
      await page.click("[data-wo-check]");
      const r = await text(".lang-wo .lang-dh-result");
      if (n === 1) check(/\./.test(r) && !/wrong/.test(r), "the right order is accepted", r);
      await page.click("[data-wo-next]");
    }
    const woDone = await text(".lang-summary");
    check(/7 of 8 right/.test(woDone), "word order summary", `${woDone} (first: ${first.id})`);
    await page.click("[data-wo-back]");

    console.log("Fill in");
    await page.click('.lang-hub [data-lang-practice="cloze"]');
    await page.waitForSelector(".lang-cz");
    const fullOf = async () => page.evaluate(() => {
      const f = document.querySelector(".lang-cz-sentence");
      return { before: f.childNodes[0]?.textContent || "", after: f.lastChild?.textContent || "" };
    });
    const allSentences = await page.evaluate(() => [...(window.__liveQA.languageForQa() ? [] : [])]);
    void allSentences;
    let czRight = 0;
    for (let n = 0; n < 10; n += 1) {
      if (await page.$(".lang-summary")) break;
      if (n === 0) { await page.click("[data-cz-hint]"); check(/Starts with/.test(await text(".lang-cz")), "a hint gives the first letter and length"); }
      const { before, after } = await fullOf();
      // The answer is whatever word sits between before and after in one of the known sentences.
      const answer = await page.evaluate(([b, a]) => {
        const st = window.__liveQA.languageForQa();
        const pool = [...Object.values(st.userWords || {}).map((w) => w.text), ...(window.__qaStarterSentences || [])];
        for (const t of pool) if (t.startsWith(b) && t.endsWith(a) && t.length > b.length + a.length) return t.slice(b.length, t.length - a.length);
        return "";
      }, [before, after]);
      await page.fill("[data-cz-input]", answer || "zzz");
      await page.keyboard.press("Enter");
      if (/Right/.test(await text(".lang-cz .lang-dh-result"))) czRight += 1;
      if (n === 0) { check(await fits(), "fill in fits 390px"); await shot("cloze"); }
      await page.click("[data-cz-next]");
    }
    check(czRight >= 9, "typing the missing word is marked right", czRight);
    await page.click("[data-cz-back]");

    console.log("Problem words");
    st = await stored();
    const someId = Object.keys(st.cards).find((k) => k.endsWith("|r")).split("|")[0];
    const now = Date.now();
    const day = (ms) => Math.floor((ms - new Date(ms).getTimezoneOffset() * 60_000) / 86_400_000);
    await page.evaluate((c) => window.__liveQA.languageCardsForQa(c), { [`${someId}|r`]: [1.2, 8, day(now) + 3, now - 3600_000, 9, 5, day(now) - 20] });
    await page.click('[data-recreate-back]');
    await page.click('[data-open-hobby="dutch"]');
    await page.waitForSelector(".lang-hub");
    const plink = await text('.lang-hub [data-lang-practice="problems"]');
    check(/1 problem word/.test(plink), "the hub flags a word missed 5 times", plink);
    await page.click('.lang-hub [data-lang-practice="problems"]');
    await page.waitForSelector(".lang-fc");
    const pl = await text(".lang-fc-left");
    check(/^[12] left$/.test(pl), "problem-word practice shows its cards even though they aren't due", pl);
    await page.click("[data-fc-show]");
    check(/Problem word — missed 5 times/.test(await text(".lang-fc-card")), "the card says it's a problem word");
    await page.fill("[data-fc-note]", "brood klinkt als bread");
    await page.click(".lang-note-edit [type=submit]");
    st = await stored();
    check(st.notes?.[someId]?.text === "brood klinkt als bread", "the note is saved");
    check(/brood klinkt als bread/.test(await text(".lang-fc-usernote")), "and shown on the card");
    await shot("problem-word");
    await page.click("[data-fc-grade='3']");
    await page.click("[data-fc-back]");

    console.log("Reading");
    const longPara = "De kinderen van groep 8 bakken vandaag taarten voor de hele school. Ze lopen naar de keuken. ";
    await page.route("**/.netlify/functions/dutch-reader", async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      let out = { error: "?" };
      if (body.action === "list") out = { items: [
        { id: "a1", title: "Groep 8 bakt taarten", url: "https://jeugdjournaal.nl/artikel/1", publishedAt: new Date(Date.now() - 3600_000).toISOString(), summary: "De kinderen bakken.", paragraphs: [longPara.repeat(2).trim(), "Het brood is lekker."] },
        { id: "a2", title: "Een ander verhaal", url: "https://jeugdjournaal.nl/artikel/2", publishedAt: new Date().toISOString(), summary: "Kort." },
      ] };
      if (body.action === "article") out = { title: "Een ander verhaal", paragraphs: ["Dit is de tekst van het artikel."] };
      if (body.action === "gloss") out = body.word === "lopen" || body.word === "lopen" ? {} : { lemma: body.word === "kinderen" ? "het kind" : body.word.toLowerCase(), en: body.word === "kinderen" ? "child" : "word", pos: "noun", form: body.word === "kinderen" ? "plural" : "", note: "" };
      if (body.action === "translate") out = { en: "The children of group 8 bake cakes for the whole school today." };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
    });
    await page.click(".lang-read-card");
    await page.waitForSelector(".lang-rd-item");
    check((await page.$$(".lang-rd-item")).length === 2, "the article list loads");
    check(await fits(), "reader list fits 390px");
    await shot("reader-list");
    await page.click('[data-rd-open="a1"]');
    await page.waitForSelector(".lang-rd-w");
    const known = await page.evaluate(() => [...document.querySelectorAll(".lang-rd-w.is-learning, .lang-rd-w.is-known")].map((b) => b.textContent));
    check(known.includes("brood"), "words you're learning are underlined", known.join(","));
    await page.evaluate(() => [...document.querySelectorAll(".lang-rd-w")].find((b) => b.textContent === "kinderen").click());
    await page.waitForSelector(".lang-rd-lemma");
    const sheet = await text(".lang-rd-sheet");
    check(/het kind/.test(sheet) && /child/.test(sheet) && /plural/.test(sheet), "tapping a word shows its meaning in context", sheet);
    await page.click("[data-rd-translate]");
    await page.waitForSelector(".lang-rd-trans");
    check(/whole school/.test(await text(".lang-rd-trans")), "the sentence can be translated");
    check(await fits(), "article fits 390px");
    await shot("reader-word");
    await page.click("[data-rd-add]");
    check(/In your words/.test(await text(".lang-rd-sheet")), "the word is added");
    st = await stored();
    const saved = Object.values(st.userWords).find((w) => w.lesson === "nl-read");
    check(saved?.text === "het kind" && saved?.w === "kinderen" && /kinderen van groep 8/.test(saved?.ex || "") && saved?.src === "Groep 8 bakt taarten", "it's saved with its sentence, form and article", JSON.stringify(saved));
    const cached = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("live-dutch-gloss-v1") || "{}")).length);
    check(cached >= 2, "lookups are cached on the device", cached);
    // The same word again comes from the cache: no new request.
    let calls = 0;
    page.on("request", (r) => { if (r.url().includes("dutch-reader")) calls += 1; });
    await page.click("[data-rd-close]");
    await page.evaluate(() => [...document.querySelectorAll(".lang-rd-w")].find((b) => b.textContent === "kinderen").click());
    await page.waitForSelector(".lang-rd-lemma");
    check(calls === 0, "a word looked up before needs no new request", calls);
    await page.click("[data-rd-list]");
    await page.click('[data-rd-open="a2"]');
    await page.waitForSelector(".lang-rd-p");
    check(/tekst van het artikel/.test(await text(".lang-rd-article")), "an article without full text in the feed is fetched");
    await page.click("[data-rd-list]");
    await page.click("[data-rd-back]");
    await page.waitForSelector(".lang-hub");
    const levels = await page.evaluate(() => [...document.querySelectorAll(".lang-level-sub")].map((h) => h.textContent.trim()));
    check(levels.includes("From your reading"), "saved words get their own lesson", levels.join("|"));
    st = await stored();
    check(st.sessions.some((x) => x.kind === "read" && x.correct === 1), "a reading session is saved (1 word saved)");
    await page.unroute("**/.netlify/functions/dutch-reader");

    await page.setViewportSize({ width: 360, height: 740 });
    check(await fits(), "hub fits 360px with the new tiles");
    await page.click('.lang-hub [data-lang-practice="order"]');
    await page.waitForSelector(".lang-wo");
    check(await fits(), "word order fits 360px");
    await page.click("[data-wo-back]");
  }

  await boot("#leisure");

  console.log("Leisure row");
  const row = await page.evaluate(() => {
    const sec = document.querySelector('[data-recreate-section="dutch"]');
    return sec ? {
      title: sec.querySelector(".recreate-section-title")?.textContent,
      lessons: sec.querySelectorAll("[data-leisure-lesson]").length,
      review: sec.querySelector("[data-leisure-review] .workout-pool-last")?.textContent,
      add: !!sec.querySelector("[data-leisure-add-words]"),
      emoji: /\p{Extended_Pictographic}/u.test(sec.textContent),
    } : null;
  });
  check(row?.title === "Dutch", "Leisure has a Dutch row", JSON.stringify(row));
  check(row?.lessons === 12, "the row shows the first 12 lessons", row?.lessons);
  check(row?.review === "10 new today", "the Flashcards card says what's new today", row?.review);
  check(row?.add, "the row ends with Add words");
  check(row && !row.emoji, "no emoji in the row (house pictograms only)");
  check(await fits(), "Leisure fits 390px");
  await shot("row");

  console.log("Hub");
  await page.click('[data-open-hobby="dutch"]');
  await page.waitForSelector(".lang-hub");
  const hub = await page.evaluate(() => ({
    count: document.querySelectorAll(".lang-lesson").length,
    starterTags: [...document.querySelectorAll(".lang-lesson-verify")].filter((t) => t.textContent.trim() === "Starter").length,
    note: document.querySelector(".lang-note")?.textContent || "",
    today: document.querySelector(".lang-today-counts")?.textContent.replace(/\s+/g, " ") || "",
    practice: [...document.querySelectorAll(".lang-hub .lang-practice-btn")].map((b) => b.textContent.trim()),
    xp: /\b(xp|streak|hearts?|lives)\b/i.test(document.querySelector(".lang-hub").textContent),
  }));
  const totalLessons = DUTCH_COURSE.levels.flatMap((l) => l.units.flatMap((u) => u.lessons)).length;
  check(hub.count === totalLessons, `all ${totalLessons} starter lessons listed`, hub.count);
  check(hub.starterTags === totalLessons, "every starter lesson is labeled Starter");
  check(/Add words/.test(hub.note) && /Rosetta Stone/.test(hub.note), "the hub explains adding your Rosetta Stone lessons");
  check(/0 to review · 10 new/.test(hub.today), "Today: nothing to review, 10 new", hub.today);
  check(hub.practice.join("|") === "Flashcards|Match|de / het|Listen|Sentences|Speak|Verbs|Word order|Fill in", "nine practice buttons", hub.practice.join("|"));
  check(!hub.xp, "no XP, streaks or hearts anywhere");
  check(await fits(), "hub fits 390px");
  await shot("hub");
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
  check(saved.sessions.length === 1 && saved.sessions[0].kind === "match" && saved.sessions[0].reached && saved.sessions[0].correct === 6 && saved.sessions[0].attempts === 7, "the session is saved once", JSON.stringify(saved.sessions));
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
  await page.waitForSelector(".lang-hub");
  check(!(await page.$(".lang-card")), "coming back opens the hub, not a stale game");
  await page.click('.lang-hub [data-lang-practice="match"]');
  const rv = await page.evaluate(() => document.querySelector(".lang-start")?.textContent.replace(/\s+/g, " "));
  check(/Review due/.test(rv) && /missed lately/.test(rv), "the hub's Match draws from due and missed words", rv);

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
  await page.click('.lang-lesson[data-lang-lesson="nl-s2-2"]'); // the longest phrases
  await page.click('.lang-lesson-view [data-lang-practice="match"]');
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
  await page.evaluate(() => { document.body.dataset.theme = "light"; });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("[data-lang-lessons]"); // back to the lesson
  await page.click("[data-lang-hub]");
  await page.waitForSelector(".lang-hub");

  await part2();
  await part3();

  check(errors.length === 0, "no page errors", errors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter(([r]) => r === "FAIL").length;
console.log(`\n${failed ? "✗" : "✔"} Dutch practice QA: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
