// Language practice UI (LANGUAGE_PRACTICE.md): the Dutch view on the Leisure
// page. This module is the hub and router — Today, the practice buttons, the
// course (your Rosetta Stone lessons, then the starter set), a lesson's screen,
// settings — and it still runs the timed matching board itself. The other
// exercises are screens in language-ui-cards.js (flashcards, de/het),
// language-ui-drills.js (listen, sentences, speak) and language-ui-words.js
// (add words, word list). Rules and scheduling live in the pure modules.
//
// createLanguageModule(deps) — deps (all injected by app.js):
//   getState()   the live state object (language* keys)
//   persist()    save state (once per finished session or edit, never per tap)
//   escapeHtml, icon(name, opts)
//   accountKey() who is signed in; a game only saves to the account it began in
//   isShowing()  is the Dutch view on screen (Leisure page, Dutch open)?
//   speech       language-speech.js instance (null → a silent stand-in)
//   now, setTimer, clearTimer, setRepeat, clearRepeat — clock seams for tests
//   course       the base course (defaults to the Dutch starter set)

import { DUTCH_COURSE } from "./language-nl-starter.js";
import { STARTER_SENTENCES } from "./language-nl-sentences.js";
import {
  resolveScope, scopeKey, scopeLabel, reviewLessonIds, lessonsInOrder, findLesson, findUnit,
} from "./language-curriculum.js";
import {
  createMatchGame, startGame, select, tick, endGame, pauseGame, resumeGame,
  nextDueAt, remainingMs, gameSummary, pairText, MATCH_DEFAULTS,
} from "./language-match.js";
import {
  applySessionToWordStats, addSession, wordTotals, normalizeSessions, lastSession,
  languagePrefs, NEW_PER_DAY_CHOICES, SPEECH_RATE_CHOICES,
} from "./language-progress.js";
import {
  buildCourse, entriesInCourseOrder, normalizeUserLessons, normalizeUserWords,
} from "./language-words.js";
import {
  normalizeCards, buildSession, deckCounts, pullForward, cardKey, decodeCard, localDay, isKnown,
} from "./language-srs.js";
import { deHetItems, plain } from "./language-drills.js";
import { createFlashcards, createDeHet } from "./language-ui-cards.js";
import { createListen, createSentences, createSpeak } from "./language-ui-drills.js";
import { createAddWords, createWordList } from "./language-ui-words.js";
import { createVerbs, createWordOrder, createCloze, createReader } from "./language-ui-more.js";
import { verbsInEntries, commonVerbs } from "./language-verbs.js";
import { clozeSources } from "./language-cloze.js";
import { problemWordIds } from "./language-srs.js";
import { addReadingWord, READ_LESSON_ID } from "./language-words.js";
import { normalizeNotes, setNote as setNoteIn } from "./language-progress.js";

const MISS_FLASH_MS = 450;
const ALL_POOL_MIN = 12;

export function formatClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatAccuracy(acc) {
  return acc == null ? "—" : `${Math.round(acc * 100)}%`;
}

const SILENT_SPEECH = Object.freeze({
  info: () => ({ speak: false, listen: false, record: false, native: false }),
  voiceName: async () => "",
  hasDutchVoice: () => false,
  speak: async () => {},
  stop: () => {},
  permission: async () => ({ microphone: "denied", speech: "denied" }),
  ask: async () => ({ microphone: "denied", speech: "denied" }),
  listen: async () => ({ transcripts: [], recording: false, error: "unavailable" }),
  stopListening: () => {},
  isListening: () => false,
  hasRecording: () => false,
  playRecording: async () => {},
  discardRecording: () => {},
});

const PRACTICE = [
  ["cards", "Flashcards", "flashcards"],
  ["match", "Match", "pairs"],
  ["dehet", "de / het", "label"],
  ["listen", "Listen", "volumeHigh"],
  ["sentences", "Sentences", "wordTiles"],
  ["speak", "Speak", "mic"],
  ["verbs", "Verbs", "verbs"],
  ["order", "Word order", "sort"],
  ["cloze", "Fill in", "cloze"],
];

// Default device cache for the reader (lists and lookups); may throw.
const LOCAL_STORAGE = {
  get: (k) => globalThis.localStorage?.getItem(k) ?? null,
  set: (k, v) => globalThis.localStorage?.setItem(k, v),
};

export function createLanguageModule(deps) {
  const {
    getState, persist, escapeHtml, icon,
    accountKey = () => "",
    deviceId = () => "device", // this device's counter slot (language-progress.js)
    isShowing = () => true,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    setRepeat = (fn, ms) => setInterval(fn, ms),
    clearRepeat = (id) => clearInterval(id),
    course: baseCourse = DUTCH_COURSE,
    starterSentences = STARTER_SENTENCES,
    speech: speechDep = null,
    callReader = async () => ({ error: "Reading isn't available here." }),
    storage = LOCAL_STORAGE,
    rng,
    gameOptions = () => null, // overrides for local-dev QA (shorter games)
    onChange = () => {},
  } = deps;
  const speech = speechDep || SILENT_SPEECH;
  const random = rng || Math.random;

  let root = null;
  // screen: hub | lesson | start | play | summary | cards | dehet | listen | sentences | speak | add | words
  let view = { screen: "hub", scope: null };
  let game = null;
  let gameAccount = "";
  let saved = false;
  let dueTimer = null;
  let clockTimer = null;
  let screen = null; // the mounted exercise screen (cards, listen…)
  let settingsOpen = false;
  const missTimers = new Map();

  const ico = (name, size = 18) => (icon ? icon(name, { size }) : "");
  const st = () => getState() || {};
  const words = () => wordTotals(st().languageWords);
  const sessions = () => normalizeSessions(st().languageSessions);
  const prefs = () => languagePrefs(st().languagePrefs);
  const cards = () => {
    const s = st();
    if (!s.languageCards || typeof s.languageCards !== "object") s.languageCards = {};
    return s.languageCards;
  };

  // ── The course: starter set + your words, rebuilt only when they change ────
  let memo = { key: "", course: null, byId: null };
  function course() {
    const s = st();
    const lessons = s.languageUserLessons || {};
    const userWords = s.languageUserWords || {};
    const show = prefs().showStarter;
    const key = `${show}|${Object.keys(lessons).length}|${Object.keys(userWords).length}|${JSON.stringify(lessons).length}|${JSON.stringify(userWords).length}`;
    if (memo.key !== key || !memo.course) {
      const c = buildCourse(baseCourse, lessons, userWords, { showStarter: show, starterSentences });
      const byId = new Map();
      for (const e of [...c.entries, ...(c.sentences || [])]) byId.set(e.id, e);
      memo = { key, course: c, byId, ordered: entriesInCourseOrder(c) };
    }
    return memo.course;
  }
  const entryById = (id) => { course(); return memo.byId.get(id) || null; };
  const orderedEntries = () => { course(); return memo.ordered; };

  // ── Scopes ────────────────────────────────────────────────────────────────
  // { kind: "all" } everything · { kind: "due" } what's due or shaky ·
  // lesson / unit / review as before.
  function entriesFor(scope) {
    const c = course();
    if (!scope) return [];
    if (scope.kind === "lesson" || scope.kind === "unit" || scope.kind === "review") return resolveScope(c, scope);
    const ordered = orderedEntries();
    const cs = cards();
    const learned = ordered.filter((e) => cs[cardKey(e.id, "r")]);
    if (scope.kind === "due") {
      const today = localDay(now());
      const totals = words();
      const due = learned.filter((e) => {
        const r = decodeCard(cs[cardKey(e.id, "r")]);
        const p = decodeCard(cs[cardKey(e.id, "p")]);
        return (r && r.due <= today) || (p && p.due <= today) || (totals[e.id]?.w || 0) > (totals[e.id]?.c || 0);
      });
      if (due.length >= ALL_POOL_MIN) return due;
      // Top up with the least-settled learned words.
      const extra = learned.filter((e) => !due.includes(e))
        .sort((a, b) => decodeCard(cs[cardKey(a.id, "r")]).s - decodeCard(cs[cardKey(b.id, "r")]).s);
      const out = [...due, ...extra].slice(0, Math.max(ALL_POOL_MIN, due.length));
      return out.length ? out : ordered.slice(0, ALL_POOL_MIN * 2);
    }
    // all: what you've learned; if that's still small, the next words in order.
    if (learned.length >= ALL_POOL_MIN) return learned;
    const rest = ordered.filter((e) => !cs[cardKey(e.id, "r")]);
    return [...learned, ...rest.slice(0, ALL_POOL_MIN * 2 - learned.length)];
  }

  function sentencesFor(scope) {
    const all = course().sentences || [];
    if (!scope) return [];
    if (scope.kind === "lesson") return all.filter((x) => x.lesson === scope.id);
    if (scope.kind === "unit") return all.filter((x) => x.unit === scope.id);
    if (scope.kind === "review") { const ids = new Set(scope.lessonIds || []); return all.filter((x) => ids.has(x.lesson)); }
    return all;
  }

  function labelFor(scope) {
    if (!scope) return "";
    if (scope.kind === "all") return "Everything";
    if (scope.kind === "due") return "Review due";
    return scopeLabel(course(), scope);
  }

  // ── Shared context for the exercise screens ─────────────────────────────────
  const ctx = {
    escapeHtml, ico, speech, rng: random,
    prefs, course, entryById, now,
    today: () => localDay(now()),
    cards,
    setCard: (key, tuple) => { cards()[key] = tuple; },
    pull: (entryId) => {
      const k = cardKey(entryId, "r");
      const cs = cards();
      if (cs[k]) cs[k] = pullForward(cs[k], now());
    },
    wordTotals: () => words(),
    countWords: (map) => {
      const s = st();
      s.languageWords = applySessionToWordStats(s.languageWords, map, { at: new Date(now()).toISOString(), scope: scopeKey(view.scope), device: deviceId() });
    },
    saveSession: ({ kind, label, startedAt, correct, attempts }) => {
      if (accountKey() !== sessionAccount) return;
      const s = st();
      const end = now();
      s.languageSessions = addSession(s.languageSessions, {
        id: `lang-${kind}-${Number(startedAt).toString(36)}-${Math.floor(random() * 1e9).toString(36)}`,
        kind, lang: baseCourse.lang, scope: scopeKey(view.scope), label,
        startedAt: new Date(startedAt).toISOString(), endedAt: new Date(end).toISOString(),
        durationMs: Math.max(0, end - startedAt), correct, attempts, target: 0, reached: false, endReason: "",
      });
      onChange();
    },
    persist: () => { if (accountKey() === sessionAccount) persist(); },
    back: () => goBack(),
    examplesFor: (e) => examplesFor(e),
    allSentences: () => course().sentences || [],
    userLessons: () => normalizeUserLessons(st().languageUserLessons),
    userWords: () => normalizeUserWords(st().languageUserWords),
    setUser: ({ lessons, words: w }) => {
      const s = st();
      if (lessons) s.languageUserLessons = lessons;
      if (w) s.languageUserWords = w;
      memo.key = ""; // rebuild the course
    },
    openLesson: (id) => openLesson(id),
    openAddWords: (lessonId) => openScreen("add", { lessonId }),
    isoNow: () => new Date(now()).toISOString(),
    // Notes and problem words (§24)
    noteFor: (id) => normalizeNotes(st().languageNotes)[id]?.text || "",
    setNote: (id, text) => {
      const s = st();
      s.languageNotes = setNoteIn(s.languageNotes, id, text, new Date(now()).toISOString());
      persist();
    },
    // Verbs (§20)
    verbsFor: (entries, { common = false } = {}) => {
      const mine = verbsInEntries(entries);
      if (!common) return mine;
      const seen = new Set(mine.map((v) => v.inf));
      return [...mine, ...commonVerbs().filter((v) => !seen.has(v.inf))];
    },
    // Reading (§23)
    callReader: (body) => callReader(body),
    storage,
    addReadingWord: (word) => {
      const s = st();
      const out = addReadingWord(s.languageUserWords, word, { at: new Date(now()).toISOString(), rng: random, now: now() });
      if (!out.existed && out.id) {
        s.languageUserWords = out.words;
        memo.key = "";
        if (accountKey() === sessionAccount) persist();
        onChange();
      }
      return out;
    },
    wordStatus: (text) => wordStatus(text),
  };
  // Answers only save to the account the screen was opened in.
  let sessionAccount = "";

  // A sentence from the same lesson that uses the word (for the back of a card).
  function examplesFor(e) {
    if (e.ex) return [{ text: e.ex, en: "", src: e.src || "" }];
    const word = plain(String(e.text || "").replace(/^(de|het|een)\s+/i, ""));
    if (!word || word.includes(" ") && word.split(" ").length > 2) return [];
    const re = new RegExp(`(^|\\s)${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
    const all = course().sentences || [];
    const same = all.filter((x) => x.lesson === e.lesson && re.test(plain(x.text)));
    return same.length ? same : all.filter((x) => re.test(plain(x.text))).slice(0, 1);
  }

  // How a Dutch word in an article stands with you: known / learning (it has a
  // flashcard) / saved (in your words, not started) / "". Matched on the word
  // as written and on the noun without its article.
  let statusMemo = { key: "", map: null };
  function wordStatus(text) {
    const cs = cards();
    const k = `${memo.key}|${Object.keys(cs).length}|${JSON.stringify(cs).length}`;
    if (statusMemo.key !== k || !statusMemo.map) {
      const map = new Map();
      const rank = { known: 3, learning: 2, saved: 1 };
      const put = (w, v) => { if (w && (rank[v] || 0) > (rank[map.get(w)] || 0)) map.set(w, v); };
      for (const e of course().entries) {
        const r = cs[cardKey(e.id, "r")];
        const v = r ? (isKnown(r) ? "known" : "learning") : e.user ? "saved" : "";
        if (!v) continue;
        const t = plain(e.text);
        put(t, v);
        put(t.replace(/^(de|het|een)\s+/, ""), v);
        if (e.w) put(plain(e.w), v);
      }
      statusMemo = { key: k, map };
    }
    const t = plain(text);
    return statusMemo.map.get(t) || "";
  }

  function problemEntries() {
    return problemWordIds(cards()).map((id) => entryById(id)).filter(Boolean);
  }

  // ── Data for the Leisure row (rendered by app.js) ──────────────────────────
  function todayCounts() {
    const plan = buildSession(cards(), orderedEntries(), now(), { newLimit: prefs().newPerDay });
    return { due: plan.counts.due, fresh: plan.counts.fresh };
  }

  function rowSummary() {
    const { due, fresh } = todayCounts();
    if (due) return `${due} to review${fresh ? ` · ${fresh} new` : ""}`;
    if (!Object.keys(cards()).length && !sessions().length) return fresh ? `${fresh} new words to start` : "Not started";
    return fresh ? `All reviewed · ${fresh} new` : "All caught up";
  }

  function lessonCounts(lessonId) {
    const list = resolveScope(course(), { kind: "lesson", id: lessonId });
    const sents = sentencesFor({ kind: "lesson", id: lessonId });
    return { ...deckCounts(cards(), list, now()), sentences: sents.length };
  }

  function rowLessons() {
    return lessonsInOrder(course()).map((l) => {
      const c = lessonCounts(l.id);
      const learned = c.known + c.learning;
      return { id: l.id, title: l.title, user: !!l.user, sub: learned ? `${c.known} of ${c.total} known` : `${c.total} words` };
    });
  }

  function reviewAvailable() {
    return Object.keys(cards()).length > 0 || reviewLessonIds(course(), words()).length > 0;
  }

  // ── Matching: timers (all guarded by the game they were set for) ──────────
  function stopTimers() {
    if (dueTimer != null) clearTimer(dueTimer);
    if (clockTimer != null) clearRepeat(clockTimer);
    for (const id of missTimers.values()) clearTimer(id);
    missTimers.clear();
    dueTimer = null;
    clockTimer = null;
  }

  function schedule() {
    if (dueTimer != null) clearTimer(dueTimer);
    dueTimer = null;
    if (!game) return;
    const due = nextDueAt(game);
    if (due == null) return;
    const g = game;
    dueTimer = setTimer(() => {
      dueTimer = null;
      if (g !== game) return; // a newer game replaced this one
      advance();
    }, Math.max(0, due - now()));
  }

  function advance() {
    if (!game) return;
    const events = tick(game, now());
    for (const ev of events) {
      if (ev.type === "refill") ev.slots.forEach(({ left, right }) => { paintSlot("left", left, true); paintSlot("right", right, true); });
      if (ev.type === "end") { finish(); return; }
    }
    paintStatus();
    schedule();
  }

  // Runs ~4×/s while a game is on screen: keeps the clock face current and
  // ends the game if the person has left the page. Never touches storage.
  function onClock() {
    if (!game || game.status !== "playing") return;
    if (!root || !root.isConnected || !isShowing()) { leave(); return; }
    if (game.pausedAt == null) advance();
  }

  // ── Matching: session lifecycle ────────────────────────────────────────────
  function beginGame(scope) {
    stopTimers();
    const pool = entriesFor(scope);
    game = createMatchGame(pool, { ...(gameOptions() || {}), ...(rng ? { rng } : {}) });
    game.listen = !!view.listen && speech.info().speak;
    gameAccount = accountKey();
    saved = false;
    view = { ...view, screen: "play", scope };
    startGame(game, now());
    if (game.status === "ended") { finish(); return; }
    render();
    clockTimer = setRepeat(onClock, 250);
    schedule();
  }

  // Save once, to the account the game began in, only if something was tried.
  // Words missed on the board come back in flashcards today.
  function saveResult() {
    if (!game || saved) return;
    saved = true;
    const sum = gameSummary(game, now());
    if (!sum.attempts) return;
    if (accountKey() !== gameAccount) return;
    const s = getState();
    if (!s) return;
    const at = new Date(game.endedAt ?? now()).toISOString();
    const key = scopeKey(view.scope);
    s.languageWords = applySessionToWordStats(s.languageWords, sum.words, { at, scope: key, device: deviceId() });
    for (const [id, w] of Object.entries(sum.words)) if (w.w > 0) ctx.pull(id);
    s.languageSessions = addSession(s.languageSessions, {
      id: `lang-${game.startedAt.toString(36)}-${Math.floor(random() * 1e9).toString(36)}`,
      kind: "match",
      lang: baseCourse.lang,
      scope: key,
      label: labelFor(view.scope),
      startedAt: new Date(game.startedAt).toISOString(),
      endedAt: at,
      durationMs: sum.durationMs,
      correct: sum.correct,
      attempts: sum.attempts,
      target: sum.target,
      reached: sum.reached,
      endReason: sum.endReason || "",
    });
    persist();
    onChange();
  }

  function finish() {
    stopTimers();
    saveResult();
    view = { ...view, screen: "summary" };
    render();
  }

  function quit() {
    if (game && game.status === "playing") endGame(game, now(), "left");
    finish();
  }

  // Leaving the Dutch view: end a running game (counted once, as "left"), close
  // any exercise (saving what was answered), and come back to the hub next time.
  function leave() {
    if (game && game.status === "playing") {
      endGame(game, now(), "left");
      saveResult();
    }
    stopTimers();
    game = null;
    closeScreen();
    speech.stop();
    view = { screen: "hub", scope: null };
    if (root && root.isConnected) render();
  }

  function onVisibility() {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") {
      // An exercise in progress keeps its answers: save them now (one write).
      if (screen && screen.dirty?.()) persist();
      speech.stop();
    }
    if (!game || game.status !== "playing") return;
    if (document.visibilityState === "hidden") {
      pauseGame(game, now());
      if (dueTimer != null) clearTimer(dueTimer);
      dueTimer = null;
      paintStatus();
    }
  }
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  // Closing the app or tab mid-game: record what was played, as "left".
  if (typeof window !== "undefined") window.addEventListener("pagehide", () => { if ((game && game.status === "playing") || screen) leave(); });

  function resume() {
    if (!game) return;
    resumeGame(game, now());
    paintStatus();
    schedule();
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  const mounted = new WeakSet();
  function mount(el) {
    root = el;
    if (!mounted.has(el)) { mounted.add(el); el.addEventListener("click", onClick); el.addEventListener("change", onChange_); }
    render();
  }

  function closeScreen() {
    if (screen) { try { screen.leave(); } catch { /* ignore */ } }
    screen = null;
  }

  // Back from an exercise: to the lesson it came from, else the hub.
  function goBack() {
    closeScreen();
    speech.stop();
    const from = view.from;
    if (from?.screen === "lesson") view = { screen: "lesson", lessonId: from.lessonId, scope: { kind: "lesson", id: from.lessonId } };
    else if (from?.screen === "words") view = { screen: "words", scope: null, lessonId: from.lessonId };
    else view = { screen: "hub", scope: null };
    render();
  }

  function openScreen(name, opts = {}) {
    if (game && game.status === "playing") leave();
    closeScreen();
    const from = view.screen === "lesson" ? { screen: "lesson", lessonId: view.lessonId } : view.screen === "words" ? { screen: "words", lessonId: view.lessonId } : null;
    view = { screen: name, scope: opts.scope || null, from, opts };
    if (root) render();
  }

  function openLesson(id) {
    if (game && game.status === "playing") leave();
    closeScreen();
    view = { screen: "lesson", lessonId: id, scope: { kind: "lesson", id } };
    if (root) render();
  }

  function openStart(scope, extra = {}) {
    if (game && game.status === "playing") leave();
    closeScreen();
    const from = view.screen === "lesson" ? { screen: "lesson", lessonId: view.lessonId } : null;
    view = { screen: "start", scope, from, listen: !!extra.listen };
    if (root) render();
  }

  function practice(kind, scope) {
    sessionAccount = accountKey();
    if (kind === "match") { openStart(scope); return; }
    openScreen(kind, { scope });
  }

  function render() {
    if (!root) return;
    const sc = view.screen;
    if (sc === "play" && game) { root.innerHTML = playHtml(); paintAll(); paintStatus(); return; }
    if (sc === "summary" && game) { root.innerHTML = summaryHtml(); return; }
    if (sc === "start" && view.scope) { root.innerHTML = startHtml(); return; }
    if (sc === "lesson" && findLesson(course(), view.lessonId)) { root.innerHTML = lessonHtml(); return; }
    if (["cards", "problems", "dehet", "listen", "sentences", "speak", "verbs", "order", "cloze", "read", "add", "words"].includes(sc)) { mountScreen(sc); return; }
    view = { screen: "hub", scope: null };
    root.innerHTML = hubHtml();
  }

  function mountScreen(name) {
    if (screen && screen.name === name && screen.el?.isConnected) return; // already on screen
    closeScreen();
    root.innerHTML = `<div class="lang-screen" data-lang-screen="${name}"></div>`;
    const el = root.firstElementChild;
    const scope = view.scope;
    const label = labelFor(scope);
    let s = null;
    if (name === "cards") {
      s = createFlashcards(ctx);
      s.mount(el, { entries: scope?.kind === "all" || scope?.kind === "due" ? orderedEntries() : entriesFor(scope), label: scope?.kind === "all" ? "Today" : label });
    } else if (name === "problems") {
      s = createFlashcards(ctx);
      s.mount(el, { entries: problemEntries(), label: "Problem words", cram: true });
    } else if (name === "verbs") {
      s = createVerbs(ctx);
      const all = !scope || scope.kind === "all" || scope.kind === "due";
      s.mount(el, { entries: all ? orderedEntries() : entriesFor(scope), label: all ? "Verbs" : label, common: all });
    } else if (name === "order") {
      s = createWordOrder(ctx);
      s.mount(el, { label: "Word order" });
    } else if (name === "cloze") {
      s = createCloze(ctx);
      const all = !scope || scope.kind === "all" || scope.kind === "due";
      const entries = all ? orderedEntries() : entriesFor(scope);
      s.mount(el, { sources: clozeSources(sentencesFor(all ? { kind: "all" } : scope), entries), entries: all ? course().entries : entries, label: all ? "Everything" : label });
    } else if (name === "read") {
      s = createReader(ctx);
      s.mount(el, { label: "Reading" });
    } else if (name === "dehet") {
      s = createDeHet(ctx);
      s.mount(el, { entries: scope?.kind === "all" ? orderedEntries() : entriesFor(scope), label });
    } else if (name === "listen") {
      s = createListen(ctx);
      s.mount(el, { entries: entriesFor(scope), label });
    } else if (name === "sentences") {
      s = createSentences(ctx);
      s.mount(el, { sentences: sentencesFor(scope), label });
    } else if (name === "speak") {
      s = createSpeak(ctx);
      s.mount(el, { entries: entriesFor(scope), sentences: sentencesFor(scope), label });
    } else if (name === "add") {
      s = createAddWords(ctx);
      sessionAccount = accountKey();
      s.mount(el, { lessonId: view.opts?.lessonId || "" });
    } else if (name === "words") {
      s = createWordList(ctx);
      sessionAccount = accountKey();
      s.mount(el, { lessonId: view.opts?.lessonId || view.lessonId || "" });
    }
    screen = { name, el, leave: () => s?.leave(), dirty: () => { const x = s?._state?.(); return !!(x && x.reviewed && !x.saved); }, inner: s };
  }

  // ── Hub ────────────────────────────────────────────────────────────────────
  function hubHtml() {
    const c = course();
    const p = prefs();
    const plan = buildSession(cards(), orderedEntries(), now(), { newLimit: p.newPerDay });
    const { due, fresh } = plan.counts;
    const total = deckCounts(cards(), orderedEntries(), now());
    const problems = problemWordIds(cards()).filter((id) => entryById(id)).length;
    const today = due || fresh
      ? `<p class="lang-today-counts"><strong>${due}</strong> to review · <strong>${fresh}</strong> new</p>
         <button class="primary-btn lang-go" type="button" data-lang-today>${ico("play", 16)} Start</button>`
      : `<p class="lang-today-counts">All caught up${total.fresh ? "" : " — every word is learned"}.</p>
         ${total.fresh ? `<button class="secondary-btn" type="button" data-lang-today>${ico("add", 16)} Learn a few more</button>` : ""}`;
    const practiceBtns = PRACTICE.map(([kind, label, ic]) => `
      <button class="lang-practice-btn" type="button" data-lang-practice="${kind}" data-lang-scope="${kind === "match" ? "due" : "all"}">
        ${ico(ic, 22)}<span>${label}</span>
      </button>`).join("");
    return `
      <div class="lang-view lang-hub">
        <section class="lang-today" aria-label="Today">
          <p class="lang-kicker">Today</p>
          ${today}
          <p class="lang-today-known">${total.known} known · ${total.learning} learning · ${total.fresh} not started</p>
          ${problems ? `<button class="lang-linkbtn" type="button" data-lang-practice="problems">${ico("warning", 14)} ${problems} problem ${problems === 1 ? "word" : "words"} — practice ${problems === 1 ? "it" : "them"}</button>` : ""}
        </section>
        <button class="lang-read-card" type="button" data-lang-practice="read">
          ${ico("article", 26)}
          <span><span class="lang-read-title">Read the news</span><span class="lang-read-sub">Easy Dutch from the NOS Jeugdjournaal. Tap a word for its meaning and save it.</span></span>
        </button>
        <section aria-label="Practice">
          <h3 class="lang-level-title">Practice</h3>
          <div class="lang-practice-grid">${practiceBtns}</div>
        </section>
        <section class="lang-course" aria-label="Lessons">
          <div class="lang-unit-head">
            <h3 class="lang-level-title">Lessons</h3>
            <span class="lang-actions">
              <button class="secondary-btn compact-btn" type="button" data-lang-words>Word list</button>
              <button class="primary-btn compact-btn" type="button" data-lang-add>${ico("add", 16)} Add words</button>
            </span>
          </div>
          ${c.hasUserCourse ? "" : `<p class="lang-note" role="note">${ico("info", 16)}<span>Add your Rosetta Stone lessons with <b>Add words</b>: paste a lesson's vocabulary, one per line (<span lang="nl">de hond</span> = dog). Until then you're practicing a starter set of common Dutch.</span></p>`}
          ${levelsHtml(c)}
        </section>
        ${settingsHtml(p, c)}
      </div>`;
  }

  function levelsHtml(c) {
    return (c.levels || []).map((level) => `
      <section class="lang-level" aria-label="${escapeHtml(level.title)}">
        <h4 class="lang-level-sub">${escapeHtml(level.title)}${level.provisional ? ' <span class="lang-tag">Provisional</span>' : ""}</h4>
        ${(level.units || []).map((unit) => `
          <div class="lang-unit">
            <h5 class="lang-unit-title">${escapeHtml(unit.title)}</h5>
            <ul class="lang-lessons">
              ${(unit.lessons || []).map((lesson) => {
                const n = lessonCounts(lesson.id);
                const learned = n.known + n.learning;
                const meta = `${n.total} ${n.total === 1 ? "word" : "words"}${n.sentences ? ` · ${n.sentences} ${n.sentences === 1 ? "sentence" : "sentences"}` : ""}${learned ? ` · ${n.known} known` : ""}${n.due ? ` · ${n.due} due` : ""}`;
                return `<li><button class="lang-lesson" type="button" data-lang-lesson="${escapeHtml(lesson.id)}">
                  <span class="lang-lesson-title">${escapeHtml(lesson.title)}</span>
                  <span class="lang-lesson-meta">${escapeHtml(meta)}</span>
                  ${level.user ? "" : '<span class="lang-lesson-verify">Starter</span>'}
                </button></li>`;
              }).join("")}
            </ul>
          </div>`).join("")}
      </section>`).join("");
  }

  function settingsHtml(p, c) {
    const rateLabel = (r) => (r <= 0.7 ? "Slow" : r < 1 ? "Relaxed" : "Normal");
    return `
      <details class="lang-settings" ${settingsOpen ? "open" : ""} data-lang-settings>
        <summary>${ico("settings", 16)} Practice settings</summary>
        <div class="lang-settings-body">
          <label class="lang-setting">New words a day
            <select data-lang-pref="newPerDay">${NEW_PER_DAY_CHOICES.map((n) => `<option value="${n}" ${n === p.newPerDay ? "selected" : ""}>${n === 0 ? "None (review only)" : n}</option>`).join("")}</select>
          </label>
          <label class="lang-setting">Speaking speed
            <select data-lang-pref="speechRate">${SPEECH_RATE_CHOICES.map((r) => `<option value="${r}" ${r === p.speechRate ? "selected" : ""}>${rateLabel(r)}</option>`).join("")}</select>
          </label>
          <label class="lang-setting lang-setting--toggle">Play Dutch automatically
            <input type="checkbox" class="live-toggle" data-lang-pref="autoPlay" ${p.autoPlay ? "checked" : ""} />
          </label>
          ${c.hasUserCourse ? `<label class="lang-setting lang-setting--toggle">Show the starter set
            <input type="checkbox" class="live-toggle" data-lang-pref="showStarter" ${p.showStarter ? "checked" : ""} />
          </label>` : ""}
          <p class="lang-start-detail" data-lang-voice>${voiceNote()}</p>
        </div>
      </details>`;
  }

  let voiceText = "";
  function voiceNote() {
    const i = speech.info();
    if (!i.speak) return "This device can't speak Dutch aloud.";
    if (!voiceText) {
      speech.voiceName().then((name) => {
        voiceText = name ? `Voice: ${name}.` : "No Dutch voice found on this device.";
        const el = root?.querySelector("[data-lang-voice]");
        if (el) el.textContent = `${voiceText} ${voiceTip(i)}`;
      });
      return voiceTip(i);
    }
    return `${voiceText} ${voiceTip(i)}`;
  }
  const voiceTip = (i) => (i.native
    ? "For a more natural voice, download Dutch (Premium) in iPhone Settings › Accessibility › Spoken Content › Voices."
    : "");

  // ── Lesson screen ──────────────────────────────────────────────────────────
  function lessonHtml() {
    const c = course();
    const lesson = findLesson(c, view.lessonId);
    const unit = findUnit(c, lesson.unitId);
    const n = lessonCounts(lesson.id);
    const lessonEntries = resolveScope(c, { kind: "lesson", id: lesson.id });
    const nouns = deHetItems(lessonEntries).length;
    const verbCount = verbsInEntries(lessonEntries).length;
    const clozeCount = clozeSources(sentencesFor({ kind: "lesson", id: lesson.id }), lessonEntries).length;
    const scope = `data-lang-scope="lesson" data-lang-id="${escapeHtml(lesson.id)}"`;
    const btn = (kind, label, ic, enabled = true, why = "") => `
      <button class="lang-practice-btn" type="button" data-lang-practice="${kind}" ${scope} ${enabled ? "" : "disabled"} ${why ? `title="${escapeHtml(why)}"` : ""}>
        ${ico(ic, 22)}<span>${label}</span>
      </button>`;
    return `
      <div class="lang-view lang-lesson-view">
        <button class="secondary-btn compact-btn lang-back" type="button" data-lang-hub>${ico("back", 16)} All lessons</button>
        <p class="lang-kicker">${escapeHtml(unit?.title || "")}</p>
        <h3 class="lang-start-title">${escapeHtml(lesson.title)}</h3>
        <dl class="lang-facts">
          <div><dt>Words</dt><dd>${n.total}</dd></div>
          <div><dt>Known</dt><dd>${n.known}</dd></div>
          <div><dt>Due</dt><dd>${n.due}</dd></div>
          <div><dt>New</dt><dd>${n.fresh}</dd></div>
        </dl>
        <div class="lang-practice-grid">
          ${btn("cards", "Flashcards", "flashcards", n.total > 0)}
          ${btn("match", "Match", "pairs", n.total > 1)}
          ${btn("dehet", "de / het", "label", nouns > 0, "No nouns with de/het in this lesson")}
          ${btn("listen", "Listen", "volumeHigh", n.total > 0)}
          ${btn("sentences", "Sentences", "wordTiles", n.sentences > 0, "No sentences in this lesson")}
          ${btn("speak", "Speak", "mic", n.total + n.sentences > 0)}
          ${btn("verbs", "Verbs", "verbs", verbCount > 0, "No verbs in this lesson")}
          ${btn("cloze", "Fill in", "cloze", clozeCount > 0, "No sentences in this lesson")}
        </div>
        <div class="lang-actions">
          ${unit ? `<button class="secondary-btn compact-btn" type="button" data-lang-practice="match" data-lang-scope="unit" data-lang-id="${escapeHtml(unit.id)}">Match the whole unit</button>` : ""}
          ${lesson.user && lesson.id !== READ_LESSON_ID ? `<button class="secondary-btn compact-btn" type="button" data-lang-add data-lang-id="${escapeHtml(lesson.id)}">${ico("add", 16)} Add words</button>` : ""}
          <button class="secondary-btn compact-btn" type="button" data-lang-words data-lang-id="${escapeHtml(lesson.id)}">${lesson.user ? "Edit words" : "Word list"}</button>
        </div>
      </div>`;
  }

  // ── Match: start, board, summary ──────────────────────────────────────────
  function scopeForReview() {
    return { kind: "review", lessonIds: reviewLessonIds(course(), words()) };
  }

  function startHtml() {
    const scope = view.scope;
    const pool = entriesFor(scope);
    const label = labelFor(scope);
    const board = Math.min(MATCH_DEFAULTS.boardSize, pool.length);
    const last = lastSession(sessions(), scopeKey(scope), "match");
    const kind = scope.kind === "lesson" ? "Lesson" : scope.kind === "unit" ? "Unit" : scope.kind === "due" ? "Match" : "Review";
    let detail = "";
    if (scope.kind === "review") {
      detail = scope.lessonIds.length
        ? `Words from ${scope.lessonIds.length} practiced ${scope.lessonIds.length === 1 ? "lesson" : "lessons"}: ${scope.lessonIds.map((id) => escapeHtml(scopeLabel(course(), { kind: "lesson", id }))).join(", ")}.`
        : "";
    } else if (scope.kind === "due") {
      detail = "Words that are due or you've missed lately, topped up with recent ones.";
    }
    const canListen = speech.info().speak;
    const body = !pool.length
      ? `<p class="empty-state">${scope.kind === "review" ? "Nothing to review yet. Practice a lesson first, and its words join the review." : "This set has no words yet."}</p>`
      : `
        <dl class="lang-facts">
          <div><dt>Words</dt><dd>${pool.length}</dd></div>
          <div><dt>Goal</dt><dd>${MATCH_DEFAULTS.target} matches</dd></div>
          <div><dt>Time</dt><dd>${formatClock(MATCH_DEFAULTS.durationMs)}</dd></div>
        </dl>
        ${detail ? `<p class="lang-start-detail">${detail}</p>` : ""}
        ${board < MATCH_DEFAULTS.boardSize ? `<p class="lang-start-detail">This set has ${pool.length} ${pool.length === 1 ? "word" : "words"}, so the board shows ${board} ${board === 1 ? "pair" : "pairs"}.</p>` : ""}
        <p class="lang-start-detail">Tap a Dutch word, then its English meaning. Wrong pairs cost nothing; missed words come back in your flashcards.</p>
        ${canListen ? `<label class="lang-setting lang-setting--toggle">Listen mode (the Dutch column plays its word)
          <input type="checkbox" class="live-toggle" data-lang-listen ${view.listen ? "checked" : ""} /></label>` : ""}
        ${last ? `<p class="lang-start-last">Last time: ${last.correct} matched · ${formatAccuracy(last.attempts ? last.correct / last.attempts : null)} accurate</p>` : ""}
        <button class="primary-btn lang-go" type="button" data-lang-begin>${ico("play", 16)} Start</button>`;
    return `
      <div class="lang-view lang-start">
        <button class="secondary-btn compact-btn lang-back" type="button" data-lang-lessons>${ico("back", 16)} ${view.from?.screen === "lesson" ? "Lesson" : "Back"}</button>
        <p class="lang-kicker">${kind}</p>
        <h3 class="lang-start-title">${escapeHtml(label)}</h3>
        ${body}
      </div>`;
  }

  function cardHtml(side, i) {
    return `<button class="lang-card lang-card--${side}" type="button" data-side="${side}" data-slot="${i}"><span class="lang-card-text"></span><span class="lang-card-mark" aria-hidden="true"></span></button>`;
  }

  function playHtml() {
    const n = game.left.length;
    const cardsHtml = (side) => Array.from({ length: n }, (_, i) => cardHtml(side, i)).join("");
    return `
      <div class="lang-view lang-play${game.listen ? " is-listen" : ""}">
        <div class="lang-hud">
          <span class="lang-clock" data-lang-clock role="timer" aria-label="Time left">${ico("clock", 16)}<span data-lang-clock-text>${formatClock(remainingMs(game, now()))}</span></span>
          <div class="lang-progress" aria-label="Matches">
            <span class="lang-progress-text" data-lang-score>0 / ${game.opts.target}</span>
            <span class="lang-progress-bar"><span class="lang-progress-fill" data-lang-fill></span></span>
          </div>
          <button class="secondary-btn compact-btn" type="button" data-lang-quit>End</button>
        </div>
        <div class="lang-board" role="group" aria-label="Match Dutch to English">
          <div class="lang-col" role="group" aria-label="Dutch"><p class="lang-col-head" lang="nl">${game.listen ? "Luister" : "Nederlands"}</p>${cardsHtml("left")}</div>
          <div class="lang-col" role="group" aria-label="English"><p class="lang-col-head">English</p>${cardsHtml("right")}</div>
        </div>
        <div class="lang-paused" data-lang-paused hidden>
          <p>Paused</p>
          <button class="primary-btn" type="button" data-lang-resume>${ico("play", 16)} Resume</button>
        </div>
        <p class="lang-live" aria-live="polite" data-lang-live></p>
      </div>`;
  }

  function paintSlot(side, i, fresh = false) {
    if (!root || !game) return;
    const btn = root.querySelector(`.lang-card[data-side="${side}"][data-slot="${i}"]`);
    const slot = game[side][i];
    if (!btn || !slot) return;
    const pair = slot.pairId ? pairText(game, slot.pairId) : null;
    const text = pair ? (side === "left" ? pair.text : pair.en) : "";
    // Listen mode: the Dutch card shows a speaker until it's matched.
    const hideText = side === "left" && game.listen && slot.state === "active";
    btn.querySelector(".lang-card-text").innerHTML = hideText ? `${ico("volumeHigh", 22)}<span class="visually-hidden">Play word ${i + 1}</span>` : escapeHtml(text);
    if (side === "left") btn.setAttribute("lang", baseCourse.lang); else btn.removeAttribute("lang");
    const selected = game.selected[side] === i;
    btn.classList.toggle("is-selected", selected);
    btn.classList.toggle("is-matched", slot.state === "matched");
    btn.classList.toggle("is-empty", slot.state === "empty");
    btn.classList.remove("is-miss");
    if (fresh) {
      btn.classList.remove("is-new");
      void btn.offsetWidth; // restart the fade-in
      btn.classList.add("is-new");
    }
    btn.setAttribute("aria-pressed", selected ? "true" : "false");
    btn.disabled = slot.state !== "active" || game.status !== "playing";
    btn.querySelector(".lang-card-mark").innerHTML = slot.state === "matched" ? ico("checkmark", 16) : "";
    btn.setAttribute("aria-label", slot.state === "matched" ? `${text}, matched` : slot.state === "empty" ? "Empty" : hideText ? `Play word ${i + 1}` : text);
  }

  function paintAll() {
    if (!game) return;
    for (let i = 0; i < game.left.length; i += 1) { paintSlot("left", i); paintSlot("right", i); }
  }

  function paintStatus() {
    if (!root || !game) return;
    const clock = root.querySelector("[data-lang-clock-text]");
    if (clock) clock.textContent = formatClock(remainingMs(game, now()));
    const score = root.querySelector("[data-lang-score]");
    if (score) score.textContent = `${game.correct} / ${game.opts.target}`;
    const fill = root.querySelector("[data-lang-fill]");
    if (fill) fill.style.width = `${Math.min(100, (game.correct / game.opts.target) * 100)}%`;
    const paused = root.querySelector("[data-lang-paused]");
    if (paused) paused.hidden = game.pausedAt == null;
    root.querySelector(".lang-board")?.classList.toggle("is-paused", game.pausedAt != null);
  }

  function announce(msg) {
    const live = root?.querySelector("[data-lang-live]");
    if (live) live.textContent = msg;
  }

  function flashMiss(side, i) {
    const btn = root?.querySelector(`.lang-card[data-side="${side}"][data-slot="${i}"]`);
    if (!btn) return;
    btn.classList.remove("is-miss");
    void btn.offsetWidth;
    btn.classList.add("is-miss");
    btn.querySelector(".lang-card-mark").innerHTML = ico("close", 16);
    const key = `${side}${i}`;
    if (missTimers.has(key)) clearTimer(missTimers.get(key));
    const g = game;
    missTimers.set(key, setTimer(() => {
      missTimers.delete(key);
      if (g !== game) return;
      btn.classList.remove("is-miss");
      paintSlot(side, i);
    }, MISS_FLASH_MS));
  }

  // Apply anything already due (a replacement, or time up) and draw it before a
  // tap is handled, so the screen never lags the game when a timer fires late.
  function applyDue() {
    for (const ev of tick(game, now())) {
      if (ev.type === "refill") ev.slots.forEach(({ left, right }) => { paintSlot("left", left, true); paintSlot("right", right, true); });
    }
  }

  function onTap(side, i) {
    if (!game) return;
    applyDue();
    if (game.status === "ended") { finish(); return; }
    if (side === "left" && game.listen) {
      const slot = game.left[i];
      const p = slot?.pairId ? pairText(game, slot.pairId) : null;
      if (p && slot.state === "active") speech.speak(p.text, { rate: prefs().speechRate });
    }
    const prev = { ...game.selected };
    const ev = select(game, side, i, now());
    if (ev.type === "ignored") {
      if (game.status === "ended") finish();
      return;
    }
    if (prev.left != null) paintSlot("left", prev.left);
    if (prev.right != null) paintSlot("right", prev.right);
    paintSlot(side, i);
    if (ev.type === "match") {
      paintSlot("left", ev.left);
      paintSlot("right", ev.right);
      const p = pairText(game, ev.pairId);
      announce(p ? `Match: ${p.text} — ${p.en}` : "Match");
    } else if (ev.type === "miss") {
      flashMiss("left", ev.left);
      flashMiss("right", ev.right);
      announce("Not a match. Try again.");
    }
    paintStatus();
    if (game.status === "ended") { finish(); return; }
    schedule();
  }

  function summaryHtml() {
    const sum = gameSummary(game, now());
    const label = labelFor(view.scope);
    const headline = sum.reached ? "Goal reached" : sum.endReason === "left" ? "Session ended" : "Time's up";
    const missed = Object.entries(sum.words).filter(([, w]) => w.w > 0).length;
    return `
      <div class="lang-view lang-summary">
        <p class="lang-kicker">${escapeHtml(label)}</p>
        <h3 class="lang-start-title">${headline}</h3>
        <dl class="lang-facts">
          <div><dt>Matched</dt><dd>${sum.correct}</dd></div>
          <div><dt>Goal</dt><dd>${sum.target}${sum.reached ? ` ${ico("checkmark", 14)}` : ""}</dd></div>
          <div><dt>Accuracy</dt><dd>${formatAccuracy(sum.accuracy)}</dd></div>
          <div><dt>Time</dt><dd>${formatClock(sum.durationMs)}</dd></div>
        </dl>
        <p class="lang-start-detail">${sum.attempts ? `${sum.correct} right out of ${sum.attempts} ${sum.attempts === 1 ? "try" : "tries"}.${missed ? ` ${missed} missed ${missed === 1 ? "word comes" : "words come"} back in today's flashcards.` : ""}` : "No pairs tried, so nothing was saved."}</p>
        <div class="lang-actions">
          <button class="primary-btn" type="button" data-lang-again>${ico("replay", 16)} Play again</button>
          <button class="secondary-btn" type="button" data-lang-lessons>${view.from?.screen === "lesson" ? "Back to the lesson" : "Back"}</button>
        </div>
      </div>`;
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  function scopeFromButton(t) {
    const kind = t.dataset.langScope || "all";
    if (kind === "lesson" || kind === "unit") return { kind, id: t.dataset.langId };
    if (kind === "review") return scopeForReview();
    return { kind };
  }

  function setPref(key, value) {
    const s = st();
    s.languagePrefs = { ...(s.languagePrefs || {}), [key]: value };
    memo.key = "";
    persist();
    onChange();
  }

  function onChange_(e) {
    const t = e.target;
    if (!root || !root.contains(t)) return;
    if (t.matches("[data-lang-pref]")) {
      const k = t.dataset.langPref;
      const v = t.type === "checkbox" ? t.checked : Number(t.value);
      setPref(k, v);
      render();
      return;
    }
    if (t.matches("[data-lang-listen]")) { view = { ...view, listen: t.checked }; }
  }

  function onClick(e) {
    // Exercise screens handle their own buttons.
    if (screen && screen.el?.contains(e.target)) return;
    const sum = e.target.closest("summary");
    if (sum && root.contains(sum) && sum.parentElement?.matches("[data-lang-settings]")) {
      settingsOpen = !sum.parentElement.open; // toggles after this event
      return;
    }
    const t = e.target.closest("button");
    if (!t || !root.contains(t)) return;
    if (t.matches(".lang-card")) { onTap(t.dataset.side, Number(t.dataset.slot)); return; }
    if (t.hasAttribute("data-lang-today")) { practice("cards", { kind: "all" }); return; }
    if (t.hasAttribute("data-lang-practice")) { practice(t.dataset.langPractice, scopeFromButton(t)); return; }
    if (t.hasAttribute("data-lang-lesson")) { openLesson(t.dataset.langLesson); return; }
    if (t.hasAttribute("data-lang-add")) { openScreen("add", { lessonId: t.dataset.langId || "" }); return; }
    if (t.hasAttribute("data-lang-words")) { openScreen("words", { lessonId: t.dataset.langId || "" }); return; }
    if (t.hasAttribute("data-lang-hub")) { view = { screen: "hub", scope: null }; render(); return; }
    if (t.hasAttribute("data-lang-start")) {
      const kind = t.dataset.langStart;
      openStart(kind === "review" ? scopeForReview() : { kind, id: t.dataset.langId });
      return;
    }
    if (t.hasAttribute("data-lang-begin")) { beginGame(view.scope); return; }
    if (t.hasAttribute("data-lang-again")) {
      // A review re-reads the practiced lessons, so newly practiced ones join in.
      beginGame(view.scope.kind === "review" ? scopeForReview() : view.scope);
      return;
    }
    if (t.hasAttribute("data-lang-quit")) { quit(); return; }
    if (t.hasAttribute("data-lang-resume")) { resume(); return; }
    if (t.hasAttribute("data-lang-lessons")) {
      game = null;
      const from = view.from;
      view = from?.screen === "lesson" ? { screen: "lesson", lessonId: from.lessonId, scope: { kind: "lesson", id: from.lessonId } } : { screen: "hub", scope: null };
      render();
    }
  }

  return {
    mount,
    leave,
    isPlaying: () => (!!game && game.status === "playing" && view.screen === "play") || !!screen,
    refresh: () => { if (root && root.isConnected && view.screen !== "play" && !screen) render(); },
    openStart: (scope) => { sessionAccount = accountKey(); openStart(scope); },
    openReview: () => { sessionAccount = accountKey(); openStart(scopeForReview()); },
    openToday: () => practice("cards", { kind: "all" }),
    openLesson,
    openAddWords: () => openScreen("add", {}),
    openReader: () => practice("read", { kind: "all" }),
    rowSummary,
    rowLessons,
    reviewAvailable,
    todayCounts,
    // for tests / QA
    _state: () => ({ view, game, saved, screen: screen?.inner?._state?.() || null }),
    _course: () => course(),
    _entriesFor: (scope) => entriesFor(scope),
  };
}

export { isKnown };
