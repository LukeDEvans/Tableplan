// Flashcards and the de / het drill (LANGUAGE_PRACTICE.md §12, §14). Screens
// mounted by language-ui.js, which passes a shared context:
//
//   ctx = { escapeHtml, ico, speech, prefs(), course(), entryById(id), now(), rng,
//           cards() (state.languageCards, read), setCard(key, tuple),
//           pull(entryId) (pull the recognize card forward), countWords(map),
//           saveSession(summary), persist(), back(), examplesFor(entry) }
//
// Answers change state.languageCards in memory as they happen; language-ui.js
// persists once when a screen finishes or is left (never per tap).

import {
  buildSession, reviewCard, previewIntervals, formatInterval, againGap, GRADES, localDay, decodeCard,
  cardKey, LEECH_LAPSES, lapsesOf,
} from "./language-srs.js";
import { compareAnswer, gradeForTyped, deHetItems, weightedPick } from "./language-drills.js";
import { genderOf } from "./language-words.js";

const GRADE_BUTTONS = [
  [GRADES.AGAIN, "Again", "again"],
  [GRADES.HARD, "Hard", "hard"],
  [GRADES.GOOD, "Good", "good"],
  [GRADES.EASY, "Easy", "easy"],
];

// ── Flashcards ───────────────────────────────────────────────────────────────
export function createFlashcards(ctx) {
  const { escapeHtml, ico } = ctx;
  let root = null;
  let s = null; // the session

  // cram: practice every card of these words now, due or not (problem words).
  function start(el, { entries, label, extraNew = 0, cram = false }) {
    root = el;
    const now = ctx.now();
    const limit = ctx.prefs().newPerDay + extraNew;
    const plan = buildSession(ctx.cards(), entries, now, { newLimit: limit });
    const cs = ctx.cards();
    const queue = cram
      ? entries.flatMap((e) => ["r", "p"].filter((d) => cs[cardKey(e.id, d)]).map((dir) => ({ key: cardKey(e.id, dir), entryId: e.id, dir, isNew: false })))
      : plan.queue.slice();
    s = {
      label,
      entries,
      cram,
      noteOpen: false,
      queue,
      i: 0,
      revealed: false,
      typing: false,
      typed: null, // { value, result }
      reviewed: 0,
      fresh: 0,
      again: 0,
      startedAt: now,
      newRemaining: plan.counts.newRemaining,
      freshAvailable: plan.counts.freshAvailable,
      words: {},
      extraNew,
    };
    el.addEventListener("click", onClick);
    el.addEventListener("keydown", onKey);
    render(true);
  }

  const current = () => (s && s.i < s.queue.length ? s.queue[s.i] : null);

  function render(fresh = false) {
    if (!root) return;
    const item = current();
    root.innerHTML = item ? cardHtml(item) : doneHtml();
    if (item && fresh) maybeAutoPlay(item, false);
    const focus = root.querySelector("[data-fc-input]") || root.querySelector("[data-fc-show]") || root.querySelector("[data-fc-grade='3']");
    if (focus && fresh) { try { focus.focus({ preventScroll: true }); } catch { /* ignore */ } }
  }

  function maybeAutoPlay(item, revealed) {
    if (!ctx.prefs().autoPlay) return;
    const e = ctx.entryById(item.entryId);
    if (!e) return;
    // Recognize: the Dutch is the question. Produce: say it once it's shown.
    if ((item.dir === "r" && !revealed) || (item.dir === "p" && revealed)) ctx.speech.speak(e.text, { rate: ctx.prefs().speechRate });
  }

  function speakBtn(text, label = "Hear it") {
    return `<button class="icon-btn lang-say" type="button" data-fc-say="${escapeHtml(text)}" aria-label="${escapeHtml(label)}">${ico("volumeHigh", 20)}</button>`;
  }

  function genderLine(e) {
    const g = genderOf(e.text);
    return g ? `<span class="lang-gender lang-gender--${g}">${g}-word</span>` : "";
  }

  function cardHtml(item) {
    const e = ctx.entryById(item.entryId);
    if (!e) { s.i += 1; return current() ? cardHtml(current()) : doneHtml(); }
    const left = s.queue.length - s.i;
    const head = `
      <div class="lang-fc-head">
        <button class="secondary-btn compact-btn" type="button" data-fc-back>${ico("back", 16)} Done</button>
        <span class="lang-fc-left" aria-label="${left} cards left">${left} left</span>
      </div>`;
    const tag = item.isNew ? `<span class="lang-fc-tag">New${item.dir === "p" ? " · say it in Dutch" : ""}</span>` : item.dir === "p" ? `<span class="lang-fc-tag">Say it in Dutch</span>` : "";
    const front = item.dir === "r"
      ? `<p class="lang-fc-word" lang="nl">${escapeHtml(e.text)}</p>${speakBtn(e.text)}`
      : `<p class="lang-fc-word">${escapeHtml(e.en)}</p>`;
    let body = "";
    if (!s.revealed) {
      body = item.dir === "p"
        ? `<form class="lang-fc-type" data-fc-form>
             <label class="visually-hidden" for="langFcInput">Type the Dutch</label>
             <input id="langFcInput" type="text" lang="nl" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Type the Dutch (optional)" data-fc-input data-no-clear />
             <div class="lang-actions">
               <button class="secondary-btn" type="submit">Check</button>
               <button class="primary-btn" type="button" data-fc-show>Show answer</button>
             </div>
           </form>`
        : `<div class="lang-actions"><button class="primary-btn lang-fc-show" type="button" data-fc-show>Show answer</button></div>`;
    } else {
      const examples = ctx.examplesFor(e).slice(0, 1);
      const lapses = lapsesOf(ctx.cards(), e.id);
      const note = ctx.noteFor(e.id);
      const problem = lapses >= LEECH_LAPSES;
      const noteBlock = s.noteOpen || (problem && !note)
        ? `<form class="lang-note-edit" data-fc-noteform>
             ${problem ? `<p class="lang-problem">${ico("warning", 16)} Problem word — missed ${lapses} times. A note or memory trick can help it stick.</p>` : ""}
             <label class="visually-hidden" for="langFcNote">Note for ${escapeHtml(e.text)}</label>
             <input id="langFcNote" type="text" maxlength="300" value="${escapeHtml(note)}" placeholder="e.g. “brood” sounds like “bread”" data-fc-note />
             <button class="secondary-btn compact-btn" type="submit">Save note</button>
           </form>`
        : `<p class="lang-fc-usernote">${problem ? `<span class="lang-problem-tag">${ico("warning", 14)} Problem word</span>` : ""}${note ? `<span>${escapeHtml(note)}</span>` : ""}
             <button class="lang-linkbtn" type="button" data-fc-noteopen>${note ? "Edit note" : "Add a note"}</button></p>`;
      const answer = item.dir === "r"
        ? `<p class="lang-fc-answer">${escapeHtml(e.en)}${e.alsoEn?.length ? `<span class="lang-fc-also"> · ${e.alsoEn.map(escapeHtml).join(" · ")}</span>` : ""}</p>`
        : `<p class="lang-fc-answer" lang="nl">${escapeHtml(e.text)} ${speakBtn(e.text)}</p>`;
      const typed = s.typed ? typedHtml(s.typed, e) : "";
      const days = previewIntervals(ctx.cards()[item.key], ctx.now());
      const suggested = s.typed ? gradeForTyped(s.typed.result.result) : null;
      body = `
        <div class="lang-fc-back">
          ${answer}
          ${typed}
          <p class="lang-fc-meta">${genderLine(e)}${e.note ? `<span class="lang-fc-note">${escapeHtml(e.note)}</span>` : ""}</p>
          ${examples.map((x) => `<p class="lang-fc-example"><span lang="nl">${escapeHtml(x.text)}</span> ${speakBtn(x.text, "Hear the sentence")}<br><span class="lang-fc-example-en">${escapeHtml(x.en || (x.src ? `From “${x.src}”` : ""))}</span></p>`).join("")}
          ${noteBlock}
        </div>
        <div class="lang-grades" role="group" aria-label="How well did you know it?">
          ${GRADE_BUTTONS.map(([g, label, cls]) => `
            <button class="lang-grade lang-grade--${cls}${suggested === g ? " is-suggested" : ""}" type="button" data-fc-grade="${g}">
              <span>${label}</span><span class="lang-grade-when">${formatInterval(days[g])}</span>
            </button>`).join("")}
        </div>`;
    }
    return `
      <div class="lang-view lang-fc" data-fc-dir="${item.dir}">
        ${head}
        <div class="lang-fc-card">
          ${tag}
          <div class="lang-fc-front">${front}</div>
          ${body}
        </div>
        <p class="lang-live" aria-live="polite" data-fc-live></p>
      </div>`;
  }

  function typedHtml(t, e) {
    const r = t.result;
    if (r.result === "exact") return `<p class="lang-typed is-right">${ico("checkmark", 16)} ${escapeHtml(t.value)}</p>`;
    if (r.result === "close") {
      const why = r.why === "accent" ? "mind the accent" : r.why === "article" ? `it's <b>${escapeHtml(genderOf(e.text) || "the article")}</b>` : "one letter off";
      return `<p class="lang-typed is-close">Almost — you wrote <span lang="nl">${escapeHtml(t.value)}</span> (${why})</p>`;
    }
    return `<p class="lang-typed is-wrong">You wrote <span lang="nl">${escapeHtml(t.value || "—")}</span></p>`;
  }

  function doneHtml() {
    const total = s.reviewed;
    const today = localDay(ctx.now());
    let tomorrow = 0;
    for (const e of s.entries) {
      for (const dir of ["r", "p"]) {
        const c = decodeCard(ctx.cards()[`${e.id}|${dir}`]);
        if (c && c.due === today + 1) tomorrow += 1;
      }
    }
    // New words still waiting in this set (produce cards unlock tomorrow, so
    // they don't count here).
    const more = !s.cram && buildSession(ctx.cards(), s.entries, ctx.now(), { newLimit: 1e6 }).counts.freshAvailable > 0;
    return `
      <div class="lang-view lang-summary">
        <p class="lang-kicker">${escapeHtml(s.label)}</p>
        <h3 class="lang-start-title">${total ? "Done for now" : "Nothing due"}</h3>
        <p class="lang-start-detail">${total
          ? `${total} ${total === 1 ? "card" : "cards"} reviewed${s.fresh ? `, ${s.fresh} new ${s.fresh === 1 ? "word" : "words"}` : ""}.`
          : "Everything here is scheduled for later."}
          ${tomorrow ? ` ${tomorrow} ${tomorrow === 1 ? "card comes" : "cards come"} back tomorrow.` : ""}</p>
        <div class="lang-actions">
          ${more ? `<button class="primary-btn" type="button" data-fc-more>${ico("add", 16)} Learn 5 more words</button>` : ""}
          <button class="secondary-btn" type="button" data-fc-back>Back</button>
        </div>
      </div>`;
  }

  function reveal() {
    if (!current() || s.revealed) return;
    s.revealed = true;
    render();
    maybeAutoPlay(current(), true);
    const g = root.querySelector(".lang-grade.is-suggested") || root.querySelector("[data-fc-grade='3']");
    try { g?.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  function check() {
    const item = current();
    if (!item) return;
    const input = root.querySelector("[data-fc-input]");
    const value = input ? input.value : "";
    if (!value.trim()) { reveal(); return; }
    const e = ctx.entryById(item.entryId);
    s.typed = { value, result: compareAnswer(value, e.text) };
    reveal();
  }

  function grade(g) {
    const item = current();
    if (!item || !s.revealed) return;
    const now = ctx.now();
    const before = ctx.cards()[item.key];
    ctx.setCard(item.key, reviewCard(before, g, now));
    s.reviewed += 1;
    if (item.isNew && !item.counted) { s.fresh += 1; item.counted = true; }
    const w = s.words[item.entryId] || (s.words[item.entryId] = { seen: 0, c: 0, w: 0 });
    w.seen += 1;
    if (g === GRADES.AGAIN) {
      w.w += 1;
      s.again += 1;
      // Back a few cards later, as a review now (it has a card).
      const gap = againGap(s.queue.length - s.i - 1);
      s.queue.splice(s.i + 1 + gap, 0, { ...item, isNew: false });
    } else w.c += 1;
    s.i += 1;
    s.revealed = false;
    s.typed = null;
    s.noteOpen = false;
    render(true);
    if (!current()) finish();
  }

  function finish() {
    if (!s || s.saved) return;
    s.saved = true;
    if (s.reviewed) {
      ctx.countWords(s.words);
      ctx.saveSession({ kind: "cards", label: s.label, startedAt: s.startedAt, correct: s.reviewed - s.again, attempts: s.reviewed });
    }
    ctx.persist();
  }

  // Leaving mid-session keeps every answer already given.
  function leave() {
    if (s && s.reviewed && !s.saved) finish();
    stopListeners();
  }

  function stopListeners() {
    if (!root) return;
    root.removeEventListener("click", onClick);
    root.removeEventListener("keydown", onKey);
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !root.contains(t)) return;
    if (t.hasAttribute("data-fc-say")) { ctx.speech.speak(t.dataset.fcSay, { rate: ctx.prefs().speechRate }); return; }
    if (t.hasAttribute("data-fc-show")) { reveal(); return; }
    if (t.hasAttribute("data-fc-noteopen")) { s.noteOpen = true; render(); root.querySelector("[data-fc-note]")?.focus(); return; }
    if (t.hasAttribute("data-fc-grade")) { grade(Number(t.dataset.fcGrade)); return; }
    if (t.hasAttribute("data-fc-more")) {
      const { entries, label, extraNew } = s;
      leave();
      start(root, { entries, label, extraNew: extraNew + 5 });
      return;
    }
    if (t.hasAttribute("data-fc-back")) { leave(); ctx.back(); }
  }

  function onKey(ev) {
    if (ev.target.matches?.("[data-fc-note]")) return;
    if (ev.target.matches?.("[data-fc-input]")) {
      if (ev.key === "Enter") { ev.preventDefault(); check(); }
      return;
    }
    if (!current()) return;
    if (!s.revealed && (ev.key === " " || ev.key === "Enter")) { ev.preventDefault(); reveal(); return; }
    if (s.revealed && ["1", "2", "3", "4"].includes(ev.key)) { ev.preventDefault(); grade(Number(ev.key)); }
  }

  // The type-it form submits through here (Enter on a phone keyboard too).
  function onSubmit(ev) {
    if (ev.target.matches?.("[data-fc-noteform]")) {
      ev.preventDefault();
      const item = current();
      if (item) ctx.setNote(item.entryId, root.querySelector("[data-fc-note]")?.value || "");
      s.noteOpen = false;
      render();
      return;
    }
    if (!ev.target.matches?.("[data-fc-form]")) return;
    ev.preventDefault();
    check();
  }

  return {
    mount(el, opts) {
      el.addEventListener("submit", onSubmit);
      start(el, opts);
    },
    leave() {
      root?.removeEventListener("submit", onSubmit);
      leave();
      root = null;
      s = null;
    },
    _state: () => s,
  };
}

// ── de / het ─────────────────────────────────────────────────────────────────
export const DEHET_ROUND = 15;

export function createDeHet(ctx) {
  const { escapeHtml, ico } = ctx;
  let root = null;
  let r = null;
  let lastOpts = null;

  function start(el, opts) {
    const { entries, label } = opts;
    root = el;
    lastOpts = opts;
    const items = deHetItems(entries);
    const totals = ctx.wordTotals();
    const pick = weightedPick(items, Math.min(DEHET_ROUND, items.length), ctx.rng, (id) => totals[id]?.w || 0);
    r = { label, items: pick, i: 0, answer: null, firstTry: 0, missed: new Set(), retry: [], words: {}, startedAt: ctx.now(), total: pick.length };
    el.addEventListener("click", onClick);
    el.addEventListener("keydown", onKey);
    render();
  }

  const current = () => (r && r.i < r.items.length ? r.items[r.i] : null);

  function render() {
    if (!root) return;
    const it = current();
    if (!r.items.length) {
      root.innerHTML = `<div class="lang-view lang-summary"><p class="lang-kicker">${escapeHtml(r.label)}</p><h3 class="lang-start-title">No nouns here</h3>
        <p class="lang-start-detail">de / het practice uses words written with their article, like “de hond” or “het huis”.</p>
        <div class="lang-actions"><button class="secondary-btn" type="button" data-dh-back>Back</button></div></div>`;
      return;
    }
    if (!it) { root.innerHTML = doneHtml(); return; }
    const answered = r.answer != null;
    const right = answered && r.answer === it.article;
    root.innerHTML = `
      <div class="lang-view lang-dh">
        <div class="lang-fc-head">
          <button class="secondary-btn compact-btn" type="button" data-dh-back>${ico("back", 16)} Done</button>
          <span class="lang-fc-left">${Math.min(r.i + 1, r.items.length)} of ${r.items.length}</span>
        </div>
        <div class="lang-fc-card">
          <p class="lang-fc-word" lang="nl">${answered ? `<span class="lang-dh-art lang-gender--${it.article}">${it.article}</span> ` : ""}${escapeHtml(it.noun)}</p>
          <p class="lang-dh-en">${escapeHtml(it.en)}</p>
          <div class="lang-dh-choices" role="group" aria-label="Article">
            ${["de", "het"].map((a) => `<button class="lang-dh-choice${answered && a === it.article ? " is-right" : ""}${answered && a === r.answer && !right ? " is-wrong" : ""}" type="button" data-dh-pick="${a}" ${answered ? "disabled" : ""} lang="nl">${a}</button>`).join("")}
          </div>
          ${answered ? `<p class="lang-dh-result ${right ? "is-right" : "is-wrong"}" role="status">${right ? `${ico("checkmark", 16)} Right` : `It's <b lang="nl">${escapeHtml(it.text)}</b>`}</p>
            <div class="lang-actions"><button class="primary-btn" type="button" data-dh-next>Next</button></div>` : ""}
        </div>
      </div>`;
    const focus = root.querySelector(answered ? "[data-dh-next]" : "[data-dh-pick='de']");
    try { focus?.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  function pick(a) {
    const it = current();
    if (!it || r.answer != null) return;
    r.answer = a;
    const w = r.words[it.id] || (r.words[it.id] = { seen: 0, c: 0, w: 0 });
    w.seen += 1;
    const right = a === it.article;
    if (right) {
      w.c += 1;
      if (!r.missed.has(it.id)) r.firstTry += 1;
    } else {
      w.w += 1;
      if (!r.missed.has(it.id)) { r.missed.add(it.id); r.items.push(it); } // once more at the end
      ctx.pull(it.id);
    }
    ctx.speech.speak(it.text, { rate: ctx.prefs().speechRate });
    render();
  }

  function next() {
    if (r.answer == null) return;
    r.answer = null;
    r.i += 1;
    render();
    if (!current()) finish();
  }

  function doneHtml() {
    return `
      <div class="lang-view lang-summary">
        <p class="lang-kicker">${escapeHtml(r.label)} · de / het</p>
        <h3 class="lang-start-title">Round done</h3>
        <p class="lang-start-detail">${r.firstTry} of ${r.total} right the first time.${r.missed.size ? ` Missed ones come back more often.` : ""}</p>
        <div class="lang-actions">
          <button class="primary-btn" type="button" data-dh-again>${ico("replay", 16)} Another round</button>
          <button class="secondary-btn" type="button" data-dh-back>Back</button>
        </div>
      </div>`;
  }

  function finish() {
    if (!r || r.saved) return;
    r.saved = true;
    const answered = Object.keys(r.words).length; // distinct nouns answered
    if (!answered) return;
    ctx.countWords(r.words);
    ctx.saveSession({ kind: "dehet", label: r.label, startedAt: r.startedAt, correct: r.firstTry, attempts: answered });
    ctx.persist();
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !root.contains(t)) return;
    if (t.hasAttribute("data-dh-pick")) { pick(t.dataset.dhPick); return; }
    if (t.hasAttribute("data-dh-next")) { next(); return; }
    if (t.hasAttribute("data-dh-again")) { stop(); start(root, lastOpts); return; }
    if (t.hasAttribute("data-dh-back")) { stop(); ctx.back(); }
  }

  function onKey(ev) {
    if (ev.key === "d" || ev.key === "1") pick("de");
    else if (ev.key === "h" || ev.key === "2") pick("het");
    else if ((ev.key === "Enter" || ev.key === " ") && r?.answer != null) { ev.preventDefault(); next(); }
  }

  function stop() {
    if (r && !r.saved) finish(); // saves only if something was answered
    root?.removeEventListener("click", onClick);
    root?.removeEventListener("keydown", onKey);
  }

  return {
    mount(el, opts) { start(el, opts); },
    leave() { stop(); root = null; r = null; },
    _state: () => r,
  };
}
