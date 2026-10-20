// Language practice UI (LANGUAGE_PRACTICE.md): the Dutch row's full view on the
// Leisure page — lessons, the start screen, the matching board and the summary.
// The game rules live in language-match.js (pure); this module only draws,
// turns taps into select() calls and asks tick() when something is due.
//
// createLanguageModule(deps) — deps (all injected by app.js):
//   getState()   the live state object (languageWords / languageSessions)
//   persist()    save state (called once per finished session)
//   escapeHtml, icon(name, opts)
//   accountKey() who is signed in; a game only saves to the account it began in
//   isShowing()  is the Dutch view on screen (Leisure page, Dutch open)?
//   now, setTimer, clearTimer, setRepeat, clearRepeat — clock seams for tests
//   course       defaults to the Dutch course

import { DUTCH_COURSE } from "./language-nl-starter.js";
import {
  resolveScope, scopeKey, scopeLabel, reviewLessonIds, lessonStatus, lessonsInOrder,
  entriesForLesson,
} from "./language-curriculum.js";
import {
  createMatchGame, startGame, select, tick, endGame, pauseGame, resumeGame,
  nextDueAt, remainingMs, gameSummary, pairText, MATCH_DEFAULTS,
} from "./language-match.js";
import {
  applySessionToWordStats, addSession, wordTotals, normalizeSessions, lastSession,
} from "./language-progress.js";

const MISS_FLASH_MS = 450;

export function formatClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatAccuracy(acc) {
  return acc == null ? "—" : `${Math.round(acc * 100)}%`;
}

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
    course = DUTCH_COURSE,
    rng,
    gameOptions = () => null, // overrides for local-dev QA (shorter games)
    onChange = () => {},
  } = deps;

  let root = null;
  // screen: lessons | start | play | summary
  let view = { screen: "lessons", scope: null };
  let game = null;
  let gameAccount = "";
  let saved = false;
  let dueTimer = null;
  let clockTimer = null;
  const missTimers = new Map();

  const ico = (name, size = 18) => (icon ? icon(name, { size }) : "");
  const words = () => wordTotals(getState()?.languageWords);
  const sessions = () => normalizeSessions(getState()?.languageSessions);

  // ── Data for the Leisure row (rendered by app.js) ──────────────────────────
  function rowSummary() {
    const last = sessions()[0];
    if (!last) return "Not practiced yet";
    const when = last.endedAt ? new Date(last.endedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
    return `Last ${last.correct} matched${when ? ` · ${when}` : ""}`;
  }

  function rowLessons() {
    const stats = words();
    return lessonsInOrder(course).map((l) => {
      const s = lessonStatus(course, l.id, stats);
      return { id: l.id, title: l.title, sub: s.seen ? `${s.matched}/${s.total} matched` : `${s.total} words` };
    });
  }

  function reviewAvailable() {
    return reviewLessonIds(course, words()).length > 0;
  }

  // ── Timers (all guarded by the game they were set for) ─────────────────────
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

  // ── Session lifecycle ───────────────────────────────────────────────────────
  function beginGame(scope) {
    stopTimers();
    const pool = resolveScope(course, scope);
    game = createMatchGame(pool, { ...(gameOptions() || {}), ...(rng ? { rng } : {}) });
    gameAccount = accountKey();
    saved = false;
    view = { screen: "play", scope };
    startGame(game, now());
    if (game.status === "ended") { finish(); return; }
    render();
    clockTimer = setRepeat(onClock, 250);
    schedule();
  }

  // Save once, to the account the game began in, only if something was tried.
  function saveResult() {
    if (!game || saved) return;
    saved = true;
    const sum = gameSummary(game, now());
    if (!sum.attempts) return;
    if (accountKey() !== gameAccount) return;
    const st = getState();
    if (!st) return;
    const at = new Date(game.endedAt ?? now()).toISOString();
    const key = scopeKey(view.scope);
    st.languageWords = applySessionToWordStats(st.languageWords, sum.words, { at, scope: key, device: deviceId() });
    st.languageSessions = addSession(st.languageSessions, {
      id: `lang-${game.startedAt.toString(36)}-${Math.floor((rng || Math.random)() * 1e9).toString(36)}`,
      lang: course.lang,
      scope: key,
      label: scopeLabel(course, view.scope),
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

  // Leaving the Dutch view mid-game: end it (counted once, as "left") and
  // forget it, so coming back never resumes a stale clock.
  function leave() {
    if (game && game.status === "playing") {
      endGame(game, now(), "left");
      saveResult();
    }
    stopTimers();
    game = null;
    view = { screen: "lessons", scope: null };
    if (root && root.isConnected) render();
  }

  function onVisibility() {
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
  if (typeof window !== "undefined") window.addEventListener("pagehide", () => { if (game && game.status === "playing") leave(); });

  function resume() {
    if (!game) return;
    resumeGame(game, now());
    paintStatus();
    schedule();
  }

  // ── Rendering ───────────────────────────────────────────────────────────────
  const mounted = new WeakSet();
  function mount(el) {
    root = el;
    if (!mounted.has(el)) { mounted.add(el); el.addEventListener("click", onClick); }
    render();
  }

  function openStart(scope) {
    if (game && game.status === "playing") leave();
    view = { screen: "start", scope };
    if (root) render();
  }

  function render() {
    if (!root) return;
    if (view.screen === "play" && game) root.innerHTML = playHtml();
    else if (view.screen === "summary" && game) root.innerHTML = summaryHtml();
    else if (view.screen === "start" && view.scope) root.innerHTML = startHtml();
    else root.innerHTML = lessonsHtml();
    if (view.screen === "play") { paintAll(); paintStatus(); }
  }

  function provisionalNote() {
    return `<p class="lang-note" role="note">${ico("info", 16)}<span>Starter set — not yet matched to your Rosetta Stone lessons. Words are common beginner Dutch; each one is marked <em>provisional</em> until checked against your course list.</span></p>`;
  }

  function lessonsHtml() {
    const stats = words();
    const reviewIds = reviewLessonIds(course, stats);
    const levels = (course.levels || []).map((level) => `
      <section class="lang-level" aria-label="${escapeHtml(level.title)}">
        <h3 class="lang-level-title">${escapeHtml(level.title)}${level.provisional ? ' <span class="lang-tag">Provisional</span>' : ""}</h3>
        ${(level.units || []).map((unit) => {
          const unitWords = resolveScope(course, { kind: "unit", id: unit.id }).length;
          return `
          <div class="lang-unit">
            <div class="lang-unit-head">
              <h4 class="lang-unit-title">${escapeHtml(unit.title)}</h4>
              <button class="secondary-btn compact-btn" type="button" data-lang-start="unit" data-lang-id="${escapeHtml(unit.id)}" aria-label="Practice all of ${escapeHtml(unit.title)} (${unitWords} words)">Whole unit</button>
            </div>
            <ul class="lang-lessons">
              ${(unit.lessons || []).map((lesson) => {
                const s = lessonStatus(course, lesson.id, stats);
                const status = !s.seen ? "Not started" : `${s.matched} of ${s.total} matched${s.last ? ` · ${new Date(s.last).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}`;
                return `<li><button class="lang-lesson" type="button" data-lang-start="lesson" data-lang-id="${escapeHtml(lesson.id)}">
                  <span class="lang-lesson-title">${escapeHtml(lesson.title)}</span>
                  <span class="lang-lesson-meta">${s.total} words · ${escapeHtml(status)}</span>
                  <span class="lang-lesson-verify ${s.verified ? "is-verified" : ""}">${s.verified ? `${ico("verified", 14)} Verified` : "Provisional"}</span>
                </button></li>`;
              }).join("")}
            </ul>
          </div>`;
        }).join("")}
      </section>`).join("");
    return `
      <div class="lang-view">
        <div class="lang-toolbar">
          <button class="primary-btn" type="button" data-lang-start="review" ${reviewIds.length ? "" : "disabled"}>${ico("replay", 16)} Review practiced lessons</button>
          <span class="lang-toolbar-hint">${reviewIds.length ? `${reviewIds.length} ${reviewIds.length === 1 ? "lesson" : "lessons"} practiced` : "Practice a lesson to unlock review"}</span>
        </div>
        ${provisionalNote()}
        ${levels}
      </div>`;
  }

  function scopeForReview() {
    return { kind: "review", lessonIds: reviewLessonIds(course, words()) };
  }

  function startHtml() {
    const scope = view.scope;
    const pool = resolveScope(course, scope);
    const label = scopeLabel(course, scope);
    const board = Math.min(MATCH_DEFAULTS.boardSize, pool.length);
    const last = lastSession(sessions(), scopeKey(scope));
    const kind = scope.kind === "lesson" ? "Lesson" : scope.kind === "unit" ? "Unit" : "Review";
    let detail = "";
    if (scope.kind === "review") {
      detail = scope.lessonIds.length
        ? `Words from ${scope.lessonIds.length} practiced ${scope.lessonIds.length === 1 ? "lesson" : "lessons"}: ${scope.lessonIds.map((id) => escapeHtml(scopeLabel(course, { kind: "lesson", id }))).join(", ")}.`
        : "";
    }
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
        <p class="lang-start-detail">Tap a Dutch word, then its English meaning. Wrong pairs cost nothing.</p>
        ${last ? `<p class="lang-start-last">Last time: ${last.correct} matched · ${formatAccuracy(last.attempts ? last.correct / last.attempts : null)} accurate</p>` : ""}
        <button class="primary-btn lang-go" type="button" data-lang-begin>${ico("play", 16)} Start</button>`;
    return `
      <div class="lang-view lang-start">
        <button class="secondary-btn compact-btn lang-back" type="button" data-lang-lessons>${ico("back", 16)} Lessons</button>
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
    const cards = (side) => Array.from({ length: n }, (_, i) => cardHtml(side, i)).join("");
    return `
      <div class="lang-view lang-play">
        <div class="lang-hud">
          <span class="lang-clock" data-lang-clock role="timer" aria-label="Time left">${ico("clock", 16)}<span data-lang-clock-text>${formatClock(remainingMs(game, now()))}</span></span>
          <div class="lang-progress" aria-label="Matches">
            <span class="lang-progress-text" data-lang-score>0 / ${game.opts.target}</span>
            <span class="lang-progress-bar"><span class="lang-progress-fill" data-lang-fill></span></span>
          </div>
          <button class="secondary-btn compact-btn" type="button" data-lang-quit>End</button>
        </div>
        <div class="lang-board" role="group" aria-label="Match Dutch to English">
          <div class="lang-col" role="group" aria-label="Dutch"><p class="lang-col-head" lang="nl">Nederlands</p>${cards("left")}</div>
          <div class="lang-col" role="group" aria-label="English"><p class="lang-col-head">English</p>${cards("right")}</div>
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
    btn.querySelector(".lang-card-text").textContent = text;
    if (side === "left") btn.setAttribute("lang", course.lang); else btn.removeAttribute("lang");
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
    btn.setAttribute("aria-label", slot.state === "matched" ? `${text}, matched` : slot.state === "empty" ? "Empty" : text);
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
    const label = scopeLabel(course, view.scope);
    const headline = sum.reached ? "Goal reached" : sum.endReason === "left" ? "Session ended" : "Time's up";
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
        <p class="lang-start-detail">${sum.attempts ? `${sum.correct} right out of ${sum.attempts} ${sum.attempts === 1 ? "try" : "tries"}.` : "No pairs tried, so nothing was saved."}</p>
        <div class="lang-actions">
          <button class="primary-btn" type="button" data-lang-again>${ico("replay", 16)} Play again</button>
          <button class="secondary-btn" type="button" data-lang-lessons>Back to lessons</button>
        </div>
      </div>`;
  }

  function onClick(e) {
    const t = e.target.closest("button");
    if (!t || !root.contains(t)) return;
    if (t.matches(".lang-card")) { onTap(t.dataset.side, Number(t.dataset.slot)); return; }
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
    if (t.hasAttribute("data-lang-lessons")) { game = null; view = { screen: "lessons", scope: null }; render(); }
  }

  return {
    mount,
    leave,
    isPlaying: () => !!game && game.status === "playing" && view.screen === "play",
    refresh: () => { if (root && root.isConnected && view.screen !== "play") render(); },
    openStart,
    openReview: () => openStart(scopeForReview()),
    rowSummary,
    rowLessons,
    reviewAvailable,
    // for tests
    _state: () => ({ view, game, saved }),
    _entriesForLesson: (id) => entriesForLesson(course, id),
  };
}
