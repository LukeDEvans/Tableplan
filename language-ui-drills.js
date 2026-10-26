// Listening, sentence building and speaking (LANGUAGE_PRACTICE.md §15–16).
// Screens mounted by language-ui.js with the shared context described in
// language-ui-cards.js, plus:
//   ctx.allSentences()      — every sentence in the course (tile distractors come from these)
//   ctx.today()             — today's local day number (language-srs.js localDay)
//
// Like the other screens, answers change state in memory; one persist() when a
// round ends or is left.

import {
  compareAnswer, speechMatches, listeningChoices, MINIMAL_PAIRS, soundQuestion, shuffle,
} from "./language-drills.js";
import { buildTiles, checkSentence, displaySentence } from "./language-sentences.js";
import { reviewCard, GRADES, cardKey } from "./language-srs.js";

const LISTEN_ROUND = 10;
const SENTENCE_ROUND = 8;
const SPEAK_ROUND = 8;

function noVoiceHtml(escapeHtml, label, back) {
  return `<div class="lang-view lang-summary"><p class="lang-kicker">${escapeHtml(label)}</p>
    <h3 class="lang-start-title">No Dutch voice</h3>
    <p class="lang-start-detail">This device has no voice that speaks Dutch, so there's nothing to listen to. On an iPhone or Mac, add a Dutch voice in Settings › Accessibility › Spoken Content › Voices.</p>
    <div class="lang-actions"><button class="secondary-btn" type="button" ${back}>Back</button></div></div>`;
}

// ── Listening ────────────────────────────────────────────────────────────────
export function createListen(ctx) {
  const { escapeHtml, ico } = ctx;
  let root = null;
  let q = null;
  let lastOpts = null;

  function buildRound(entries) {
    const rng = ctx.rng;
    const words = entries.filter((e) => e.text && e.en);
    const picks = shuffle(words, rng).slice(0, LISTEN_ROUND - 2);
    const out = picks.map((e, i) => {
      if (i % 3 === 2) return { kind: "type", entry: e };
      return { kind: "choose", entry: e, choices: listeningChoices(e, words, 4, rng) };
    });
    // Two Sounds questions (minimal pairs) mixed in.
    for (const pair of shuffle(MINIMAL_PAIRS.slice(), rng).slice(0, 2)) {
      out.splice(Math.floor(rng() * (out.length + 1)), 0, { kind: "sound", ...soundQuestion(pair, rng) });
    }
    return out;
  }

  function start(el, opts) {
    root = el;
    lastOpts = opts;
    q = { label: opts.label, items: buildRound(opts.entries), i: 0, answer: null, right: 0, words: {}, startedAt: ctx.now(), slow: false };
    el.addEventListener("click", onClick);
    el.addEventListener("submit", onSubmit);
    render(true);
  }

  const current = () => (q && q.i < q.items.length ? q.items[q.i] : null);
  const spokenText = (it) => (it.kind === "sound" ? it.spoken.text : it.entry.text);

  function play(slow = false) {
    const it = current();
    if (it) ctx.speech.speak(spokenText(it), { rate: slow ? 0.65 : ctx.prefs().speechRate });
  }

  function render(fresh = false) {
    if (!root) return;
    if (!ctx.speech.info().speak) { root.innerHTML = noVoiceHtml(escapeHtml, q.label, "data-ls-back"); return; }
    const it = current();
    if (!it) { root.innerHTML = doneHtml(); return; }
    const answered = q.answer != null;
    const prompt = it.kind === "type" ? "Type what you hear" : it.kind === "sound" ? `Which did you hear? <span class="lang-ls-sound">${escapeHtml(it.pair.sound)}</span>` : "Which did you hear?";
    let body = "";
    if (it.kind === "type") {
      body = answered
        ? resultHtml(q.answer.ok, q.answer.close, it.entry.text, it.entry.en, q.answer.value)
        : `<form class="lang-fc-type" data-ls-form>
             <label class="visually-hidden" for="langLsInput">What you heard</label>
             <input id="langLsInput" type="text" lang="nl" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Type the Dutch" data-ls-input data-no-clear />
             <div class="lang-actions"><button class="primary-btn" type="submit">Check</button></div>
           </form>`;
    } else {
      const choices = it.choices;
      const correct = it.kind === "sound" ? it.spoken.text : it.entry.text;
      body = `<div class="lang-ls-choices" role="group" aria-label="Choices">
        ${choices.map((c, k) => {
          const text = c.text;
          const isRight = text === correct;
          const cls = answered ? (isRight ? " is-right" : q.answer.pick === k ? " is-wrong" : "") : "";
          return `<button class="lang-ls-choice${cls}" type="button" data-ls-pick="${k}" ${answered ? "disabled" : ""}><span lang="nl">${escapeHtml(text)}</span>${answered || it.kind === "sound" ? `<span class="lang-ls-en">${escapeHtml(c.en)}</span>` : ""}</button>`;
        }).join("")}
      </div>
      ${answered ? `<p class="lang-dh-result ${q.answer.ok ? "is-right" : "is-wrong"}" role="status">${q.answer.ok ? `${ico("checkmark", 16)} Right` : `It was <b lang="nl">${escapeHtml(correct)}</b>`}</p>` : ""}`;
    }
    root.innerHTML = `
      <div class="lang-view lang-ls">
        <div class="lang-fc-head">
          <button class="secondary-btn compact-btn" type="button" data-ls-back>${ico("back", 16)} Done</button>
          <span class="lang-fc-left">${q.i + 1} of ${q.items.length}</span>
        </div>
        <div class="lang-fc-card">
          <p class="lang-kicker">${prompt}</p>
          <div class="lang-ls-play">
            <button class="primary-btn lang-ls-playbtn" type="button" data-ls-play aria-label="Play">${ico("volumeHigh", 22)} Play</button>
            <button class="secondary-btn" type="button" data-ls-slow aria-label="Play slowly">Slower</button>
          </div>
          ${body}
          ${answered ? `<div class="lang-actions"><button class="primary-btn" type="button" data-ls-next>Next</button></div>` : ""}
        </div>
      </div>`;
    if (fresh) play();
    const focus = root.querySelector(answered ? "[data-ls-next]" : "[data-ls-input]");
    try { focus?.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  function resultHtml(ok, close, text, en, value) {
    return `<p class="lang-dh-result ${ok ? "is-right" : "is-wrong"}" role="status">${ok ? `${ico("checkmark", 16)} ${close ? "Almost — " : "Right — "}` : `You wrote <span lang="nl">${escapeHtml(value || "—")}</span>. It was `}<b lang="nl">${escapeHtml(text)}</b> <span class="lang-ls-en">${escapeHtml(en)}</span></p>`;
  }

  function record(entryId, ok) {
    if (!entryId) return;
    const w = q.words[entryId] || (q.words[entryId] = { seen: 0, c: 0, w: 0 });
    w.seen += 1;
    if (ok) w.c += 1; else { w.w += 1; ctx.pull(entryId); }
  }

  function pickChoice(k) {
    const it = current();
    if (!it || q.answer != null || it.kind === "type") return;
    const correct = it.kind === "sound" ? it.spoken.text : it.entry.text;
    const ok = it.choices[k]?.text === correct;
    q.answer = { pick: k, ok };
    if (ok) q.right += 1;
    if (it.kind !== "sound") record(it.entry.id, ok);
    render();
  }

  function submitTyped() {
    const it = current();
    if (!it || q.answer != null || it.kind !== "type") return;
    const value = root.querySelector("[data-ls-input]")?.value || "";
    const r = compareAnswer(value, it.entry.text);
    const ok = r.result !== "wrong";
    q.answer = { value, ok, close: r.result === "close" };
    if (ok) q.right += 1;
    record(it.entry.id, ok);
    render();
  }

  function next() {
    if (q.answer == null) return;
    q.answer = null;
    q.i += 1;
    if (!current()) finish();
    render(true);
  }

  function doneHtml() {
    return `
      <div class="lang-view lang-summary">
        <p class="lang-kicker">${escapeHtml(q.label)} · Listen</p>
        <h3 class="lang-start-title">Round done</h3>
        <p class="lang-start-detail">${q.right} of ${q.items.length} right.</p>
        <div class="lang-actions">
          <button class="primary-btn" type="button" data-ls-again>${ico("replay", 16)} Another round</button>
          <button class="secondary-btn" type="button" data-ls-back>Back</button>
        </div>
      </div>`;
  }

  function finish() {
    if (!q || q.saved) return;
    q.saved = true;
    const tried = q.i;
    if (!tried) return;
    ctx.countWords(q.words);
    ctx.saveSession({ kind: "listen", label: q.label, startedAt: q.startedAt, correct: q.right, attempts: tried });
    ctx.persist();
  }

  function onSubmit(ev) {
    if (!ev.target.matches?.("[data-ls-form]")) return;
    ev.preventDefault();
    submitTyped();
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !root.contains(t)) return;
    if (t.hasAttribute("data-ls-play")) { play(false); return; }
    if (t.hasAttribute("data-ls-slow")) { play(true); return; }
    if (t.hasAttribute("data-ls-pick")) { pickChoice(Number(t.dataset.lsPick)); return; }
    if (t.hasAttribute("data-ls-next")) { next(); return; }
    if (t.hasAttribute("data-ls-again")) { stop(); start(root, lastOpts); return; }
    if (t.hasAttribute("data-ls-back")) { stop(); ctx.back(); }
  }

  function stop() {
    if (q && !q.saved && q.i > 0) finish();
    ctx.speech.stop();
    root?.removeEventListener("click", onClick);
    root?.removeEventListener("submit", onSubmit);
  }

  return { mount: start, leave() { stop(); root = null; q = null; }, _state: () => q };
}

// ── Sentences ────────────────────────────────────────────────────────────────
export function createSentences(ctx) {
  const { escapeHtml, ico } = ctx;
  let root = null;
  let s = null;
  let lastOpts = null;

  // Due sentences first, then ones never built, then the rest (most of a
  // lesson's are few, so a round is often the whole lesson).
  function pickRound(sentences) {
    const usable = sentences.filter((x) => x.text && x.en && x.text.trim().split(/\s+/).length >= 2);
    const cards = ctx.cards();
    const due = [];
    const fresh = [];
    const rest = [];
    const nowDay = ctx.today();
    for (const x of usable) {
      const t = cards[cardKey(x.id, "s")];
      if (!t) fresh.push(x);
      else if (t[2] <= nowDay) due.push(x);
      else rest.push(x);
    }
    return [...due, ...fresh, ...shuffle(rest, ctx.rng)].slice(0, SENTENCE_ROUND);
  }

  function start(el, opts) {
    root = el;
    lastOpts = opts;
    const list = pickRound(opts.sentences || []);
    s = { label: opts.label, items: list, i: 0, startedAt: ctx.now(), right: 0, done: 0 };
    loadItem();
    el.addEventListener("click", onClick);
    render(true);
  }

  const current = () => (s && s.i < s.items.length ? s.items[s.i] : null);

  function loadItem() {
    const it = current();
    if (!it) return;
    s.mode = ctx.speech.info().speak && ctx.rng() < 0.3 ? "listen" : "read";
    s.tiles = buildTiles(it, ctx.allSentences(), { extra: 2, rng: ctx.rng });
    s.chosen = []; // tile ids, in order
    s.tries = 0;
    s.result = null; // null | { ok, marks } | { shown: true }
    s.hint = false;
  }

  function tileText(id) {
    return s.tiles.find((t) => t.id === id)?.text || "";
  }

  function render(fresh = false) {
    if (!root) return;
    const it = current();
    if (!s.items.length) {
      root.innerHTML = `<div class="lang-view lang-summary"><p class="lang-kicker">${escapeHtml(s.label)}</p><h3 class="lang-start-title">No sentences yet</h3>
        <p class="lang-start-detail">Paste whole sentences from your Rosetta Stone lesson in Add words (one per line, Dutch = English) and they'll show up here.</p>
        <div class="lang-actions"><button class="secondary-btn" type="button" data-sb-back>Back</button></div></div>`;
      return;
    }
    if (!it) { root.innerHTML = doneHtml(); return; }
    const res = s.result;
    const finished = res && (res.ok || res.shown);
    const chosen = s.chosen.map((id, k) => {
      const mark = res && !res.shown && res.marks ? (res.marks[k] ? " is-right" : " is-wrong") : "";
      return `<button class="lang-tile is-placed${mark}" type="button" data-sb-unplace="${id}" ${finished ? "disabled" : ""} lang="nl">${escapeHtml(tileText(id))}</button>`;
    }).join("");
    const bank = s.tiles.map((t) => {
      const used = s.chosen.includes(t.id);
      return `<button class="lang-tile${used ? " is-used" : ""}" type="button" data-sb-place="${t.id}" ${used || finished ? "disabled" : ""} lang="nl" ${used ? 'aria-hidden="true"' : ""}>${escapeHtml(t.text)}</button>`;
    }).join("");
    const prompt = s.mode === "listen"
      ? `<p class="lang-kicker">Build what you hear</p>
         <div class="lang-ls-play"><button class="primary-btn" type="button" data-sb-play>${ico("volumeHigh", 20)} Play</button>
         <button class="secondary-btn" type="button" data-sb-slow>Slower</button>
         ${s.hint || finished ? "" : `<button class="secondary-btn" type="button" data-sb-hint>English</button>`}</div>
         ${s.hint || finished ? `<p class="lang-sb-en">${escapeHtml(it.en)}</p>` : ""}`
      : `<p class="lang-kicker">Say it in Dutch</p><p class="lang-sb-en">${escapeHtml(it.en)}</p>`;
    let status = "";
    if (res?.ok) status = `<p class="lang-dh-result is-right" role="status">${ico("checkmark", 16)} <span lang="nl">${escapeHtml(displaySentence(it.text))}</span></p>`;
    else if (res?.shown) status = `<p class="lang-dh-result is-wrong" role="status">Answer: <b lang="nl">${escapeHtml(displaySentence(it.text))}</b></p>`;
    else if (res) status = `<p class="lang-dh-result is-wrong" role="status">${res.missing ? `${res.missing} more ${res.missing === 1 ? "word" : "words"} needed. ` : ""}Marked words are off — fix them and check again.</p>`;
    root.innerHTML = `
      <div class="lang-view lang-sb">
        <div class="lang-fc-head">
          <button class="secondary-btn compact-btn" type="button" data-sb-back>${ico("back", 16)} Done</button>
          <span class="lang-fc-left">${s.i + 1} of ${s.items.length}</span>
        </div>
        <div class="lang-fc-card">
          ${prompt}
          <div class="lang-sb-line" aria-label="Your sentence">${chosen || `<span class="lang-sb-placeholder">Tap the words in order</span>`}</div>
          <div class="lang-sb-bank" aria-label="Words">${bank}</div>
          ${status}
          <div class="lang-actions">
            ${finished
              ? `<button class="secondary-btn" type="button" data-sb-say aria-label="Hear it">${ico("volumeHigh", 16)} Hear it</button><button class="primary-btn" type="button" data-sb-next>Next</button>`
              : `<button class="secondary-btn" type="button" data-sb-show>Show answer</button><button class="primary-btn" type="button" data-sb-check ${s.chosen.length ? "" : "disabled"}>Check</button>`}
          </div>
        </div>
      </div>`;
    if (fresh && s.mode === "listen") speak();
  }

  function speak(slow = false) {
    const it = current();
    if (it) ctx.speech.speak(it.text, { rate: slow ? 0.65 : ctx.prefs().speechRate });
  }

  function grade(g) {
    const it = current();
    ctx.setCard(cardKey(it.id, "s"), reviewCard(ctx.cards()[cardKey(it.id, "s")], g, ctx.now()));
    s.done += 1;
  }

  function check() {
    const it = current();
    if (!it || !s.chosen.length || s.result?.ok || s.result?.shown) return;
    const r = checkSentence(s.chosen.map(tileText), it);
    s.tries += 1;
    s.result = r;
    if (r.ok) {
      s.right += s.tries === 1 ? 1 : 0;
      grade(s.tries === 1 ? GRADES.GOOD : GRADES.HARD);
      speak();
    }
    render();
  }

  function show() {
    const it = current();
    if (!it || s.result?.ok || s.result?.shown) return;
    s.result = { shown: true };
    grade(GRADES.AGAIN);
    speak();
    render();
  }

  function next() {
    s.i += 1;
    loadItem();
    if (!current()) finish();
    render(true);
  }

  function doneHtml() {
    return `
      <div class="lang-view lang-summary">
        <p class="lang-kicker">${escapeHtml(s.label)} · Sentences</p>
        <h3 class="lang-start-title">Round done</h3>
        <p class="lang-start-detail">${s.right} of ${s.items.length} built right the first time.</p>
        <div class="lang-actions">
          <button class="primary-btn" type="button" data-sb-again>${ico("replay", 16)} Another round</button>
          <button class="secondary-btn" type="button" data-sb-back>Back</button>
        </div>
      </div>`;
  }

  function finish() {
    if (!s || s.saved) return;
    s.saved = true;
    if (!s.done) return;
    ctx.saveSession({ kind: "sentences", label: s.label, startedAt: s.startedAt, correct: s.right, attempts: s.done });
    ctx.persist();
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !root.contains(t)) return;
    if (t.hasAttribute("data-sb-place")) {
      if (s.result && !s.result.ok && !s.result.shown) s.result = null;
      s.chosen.push(t.dataset.sbPlace);
      render();
      return;
    }
    if (t.hasAttribute("data-sb-unplace")) {
      if (s.result && !s.result.ok && !s.result.shown) s.result = null;
      s.chosen = s.chosen.filter((id) => id !== t.dataset.sbUnplace);
      render();
      return;
    }
    if (t.hasAttribute("data-sb-check")) { check(); return; }
    if (t.hasAttribute("data-sb-show")) { show(); return; }
    if (t.hasAttribute("data-sb-next")) { next(); return; }
    if (t.hasAttribute("data-sb-play")) { speak(false); return; }
    if (t.hasAttribute("data-sb-slow")) { speak(true); return; }
    if (t.hasAttribute("data-sb-say")) { speak(false); return; }
    if (t.hasAttribute("data-sb-hint")) { s.hint = true; render(); return; }
    if (t.hasAttribute("data-sb-again")) { stop(); start(root, lastOpts); return; }
    if (t.hasAttribute("data-sb-back")) { stop(); ctx.back(); }
  }

  function stop() {
    if (s && !s.saved) finish();
    ctx.speech.stop();
    root?.removeEventListener("click", onClick);
  }

  return { mount: start, leave() { stop(); root = null; s = null; }, _state: () => s };
}

// ── Speaking ─────────────────────────────────────────────────────────────────
export function createSpeak(ctx) {
  const { escapeHtml, ico } = ctx;
  let root = null;
  let p = null;
  let lastOpts = null;

  function start(el, opts) {
    root = el;
    lastOpts = opts;
    const words = shuffle(opts.entries.filter((e) => e.text), ctx.rng).slice(0, SPEAK_ROUND - 2);
    const sentences = shuffle((opts.sentences || []).filter((x) => x.text), ctx.rng).slice(0, 2);
    p = {
      label: opts.label,
      items: shuffle([...words, ...sentences], ctx.rng).slice(0, SPEAK_ROUND),
      i: 0, state: "idle", partial: "", result: null, ok: 0, tried: 0, okItems: new Set(), triedItems: new Set(), startedAt: ctx.now(), perm: null,
    };
    el.addEventListener("click", onClick);
    render();
    ctx.speech.permission().then((perm) => { if (p) { p.perm = perm; render(); } });
  }

  const current = () => (p && p.i < p.items.length ? p.items[p.i] : null);
  const can = () => ctx.speech.info();

  function permNote() {
    const perm = p.perm;
    if (!perm) return "";
    if (perm.microphone === "denied" || (can().listen && perm.speech === "denied" && can().native)) {
      return `<p class="lang-note" role="note">${ico("info", 16)}<span>${can().native
        ? "Microphone or speech recognition is turned off for Live. Turn them on in iPhone Settings › Apps › Live."
        : "The microphone is blocked for this site. Allow it in the browser's site settings."}</span></p>`;
    }
    return "";
  }

  function render() {
    if (!root) return;
    const it = current();
    const c = can();
    if (!c.listen && !c.record) {
      root.innerHTML = `<div class="lang-view lang-summary"><p class="lang-kicker">${escapeHtml(p.label)}</p><h3 class="lang-start-title">Speaking isn't available here</h3>
        <p class="lang-start-detail">This browser can't use the microphone for practice. Use the iPhone app, or Chrome on the laptop.</p>
        <div class="lang-actions"><button class="secondary-btn" type="button" data-sp-back>Back</button></div></div>`;
      return;
    }
    if (!p.items.length) {
      root.innerHTML = `<div class="lang-view lang-summary"><p class="lang-kicker">${escapeHtml(p.label)}</p><h3 class="lang-start-title">Nothing to say yet</h3>
        <div class="lang-actions"><button class="secondary-btn" type="button" data-sp-back>Back</button></div></div>`;
      return;
    }
    if (!it) { root.innerHTML = doneHtml(); return; }
    const listening = p.state === "listening";
    const r = p.result;
    let status = "";
    if (listening) status = `<p class="lang-sp-heard" aria-live="polite">${p.partial ? `<span lang="nl">${escapeHtml(p.partial)}</span>` : "Listening…"}</p>`;
    else if (r) {
      if (r.error === "permission") status = `<p class="lang-dh-result is-wrong" role="status">The microphone isn't allowed.</p>`;
      else if (r.error === "unavailable") status = `<p class="lang-dh-result is-wrong" role="status">Dutch speech recognition isn't available right now (it may need a connection). You can still record yourself.</p>`;
      else if (!c.listen) status = r.recording ? `<p class="lang-dh-result" role="status">Recorded. Play yours, then the model.</p>` : "";
      else if (!r.heard) status = `<p class="lang-dh-result is-wrong" role="status">Didn't catch that. Try again, a little closer to the mic.</p>`;
      else status = `<p class="lang-dh-result ${r.ok ? "is-right" : "is-wrong"}" role="status">${r.ok ? `${ico("checkmark", 16)} Understood: ` : "Heard: "}<span lang="nl">${escapeHtml(r.heard)}</span></p>`;
    }
    const hasRec = ctx.speech.hasRecording() && r?.recording;
    root.innerHTML = `
      <div class="lang-view lang-sp">
        <div class="lang-fc-head">
          <button class="secondary-btn compact-btn" type="button" data-sp-back>${ico("back", 16)} Done</button>
          <span class="lang-fc-left">${p.i + 1} of ${p.items.length}</span>
        </div>
        <div class="lang-fc-card">
          <p class="lang-kicker">${c.listen ? "Say it" : "Shadow it"}</p>
          <p class="lang-fc-word" lang="nl">${escapeHtml(it.text)}</p>
          <p class="lang-dh-en">${escapeHtml(it.en)}</p>
          <div class="lang-sp-controls">
            <button class="secondary-btn" type="button" data-sp-hear ${listening ? "disabled" : ""}>${ico("volumeHigh", 18)} Hear it</button>
            <button class="lang-mic${listening ? " is-listening" : ""}" type="button" data-sp-mic aria-pressed="${listening}" aria-label="${listening ? "Stop" : c.listen ? "Say it" : "Record"}">${ico("mic", 28)}</button>
            <button class="secondary-btn" type="button" data-sp-mine ${hasRec && !listening ? "" : "disabled"}>${ico("play", 16)} Yours</button>
          </div>
          ${hasRec && !listening ? `<div class="lang-actions"><button class="secondary-btn compact-btn" type="button" data-sp-both>${ico("replay", 16)} Yours, then the model</button></div>` : ""}
          ${status}
          ${permNote()}
          <div class="lang-actions">
            <button class="primary-btn" type="button" data-sp-next ${listening ? "disabled" : ""}>${p.i + 1 < p.items.length ? "Next" : "Finish"}</button>
          </div>
        </div>
        ${p.i === 0 && !r && !listening ? `<p class="lang-start-detail lang-sp-privacy">${c.native ? "Speech is recognized on your iPhone where it can be; recordings stay on the phone and are replaced by the next one." : "Your browser's speech recognizer may send audio to its maker (Chrome: Google). Recordings stay in this tab."}</p>` : ""}
      </div>`;
  }

  async function mic() {
    const it = current();
    if (!it) return;
    if (p.state === "listening") { ctx.speech.stopListening(); return; }
    let perm = await ctx.speech.permission();
    if (perm.microphone !== "granted" || (ctx.speech.info().native && perm.speech !== "granted")) {
      perm = await ctx.speech.ask();
      p.perm = perm;
      if (perm.microphone !== "granted") { p.result = { error: "permission" }; render(); return; }
    }
    p.state = "listening";
    p.partial = "";
    p.result = null;
    render();
    const target = it.text;
    const res = await ctx.speech.listen({
      record: true,
      maxSeconds: Math.min(15, 4 + target.split(/\s+/).length),
      onPartial: (text) => { if (p && p.state === "listening") { p.partial = text; const el = root?.querySelector(".lang-sp-heard"); if (el) el.textContent = text || "Listening…"; } },
    });
    if (!p || current() !== it) return;
    p.state = "idle";
    const m = speechMatches(res.transcripts, target);
    p.result = { ...m, heard: m.heard, recording: res.recording, error: res.error === "permission" || res.error === "unavailable" ? res.error : "" };
    // Counted once per item: tried if anything was heard or recorded, understood
    // if any attempt at it was.
    if (res.transcripts.length || res.recording) p.triedItems.add(p.i);
    if (m.ok) p.okItems.add(p.i);
    p.tried = p.triedItems.size;
    p.ok = p.okItems.size;
    render();
  }

  async function both() {
    await ctx.speech.playRecording();
    const it = current();
    if (it) await ctx.speech.speak(it.text, { rate: ctx.prefs().speechRate });
  }

  function next() {
    ctx.speech.discardRecording();
    p.i += 1;
    p.result = null;
    p.partial = "";
    p.state = "idle";
    if (!current()) finish();
    render();
  }

  function doneHtml() {
    return `
      <div class="lang-view lang-summary">
        <p class="lang-kicker">${escapeHtml(p.label)} · Speak</p>
        <h3 class="lang-start-title">Round done</h3>
        <p class="lang-start-detail">${can().listen ? `Understood ${p.ok} of ${p.tried} you said.` : `${p.tried} recorded.`}</p>
        <div class="lang-actions">
          <button class="primary-btn" type="button" data-sp-again>${ico("replay", 16)} Another round</button>
          <button class="secondary-btn" type="button" data-sp-back>Back</button>
        </div>
      </div>`;
  }

  function finish() {
    if (!p || p.saved) return;
    p.saved = true;
    if (!p.tried) return;
    ctx.saveSession({ kind: "speak", label: p.label, startedAt: p.startedAt, correct: p.ok, attempts: p.tried });
    ctx.persist();
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !root.contains(t)) return;
    if (t.hasAttribute("data-sp-mic")) { mic(); return; }
    if (t.hasAttribute("data-sp-hear")) { const it = current(); if (it) ctx.speech.speak(it.text, { rate: ctx.prefs().speechRate }); return; }
    if (t.hasAttribute("data-sp-mine")) { ctx.speech.playRecording(); return; }
    if (t.hasAttribute("data-sp-both")) { both(); return; }
    if (t.hasAttribute("data-sp-next")) { next(); return; }
    if (t.hasAttribute("data-sp-again")) { stop(); start(root, lastOpts); return; }
    if (t.hasAttribute("data-sp-back")) { stop(); ctx.back(); }
  }

  function stop() {
    ctx.speech.stopListening();
    ctx.speech.stop();
    ctx.speech.discardRecording();
    if (p && !p.saved) finish();
    root?.removeEventListener("click", onClick);
  }

  return { mount: start, leave() { stop(); root = null; p = null; }, _state: () => p };
}
