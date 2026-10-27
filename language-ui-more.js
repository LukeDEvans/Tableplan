// Verbs, word order, fill in the blank and the news reader
// (LANGUAGE_PRACTICE.md §20–23). Screens mounted by language-ui.js with the
// shared context described in language-ui-cards.js, plus:
//   ctx.verbsFor(entries)        drillable verbs (language-verbs.js)
//   ctx.callReader(body)         POST to the dutch-reader function
//   ctx.addReadingWord(word)     save a word met while reading → { id, existed }
//   ctx.wordStatus(text)         "known" | "learning" | "saved" | ""
//   ctx.storage                  { get(key), set(key, value) } — device cache, may throw
//
// Answers change state in memory; one persist() when a round ends or is left.

import { compareAnswer, weightedPick, shuffle } from "./language-drills.js";
import { conjugate, PERSONS, PERSON_LABEL, TENSE_LABEL, ruleNote } from "./language-verbs.js";
import { WORD_ORDER_ITEMS, WORD_ORDER_RULES } from "./language-nl-wordorder.js";
import { sentenceTokens, checkSentence, displaySentence } from "./language-sentences.js";
import { clozeRound } from "./language-cloze.js";

const VERB_ROUND = 12;
const ORDER_ROUND = 8;
const CLOZE_ROUND = 10;

function headHtml(ctx, back, right) {
  return `<div class="lang-fc-head">
    <button class="secondary-btn compact-btn" type="button" ${back}>${ctx.ico("back", 16)} Done</button>
    <span class="lang-fc-left">${right}</span>
  </div>`;
}

function emptyHtml(ctx, label, title, detail, back) {
  return `<div class="lang-view lang-summary"><p class="lang-kicker">${ctx.escapeHtml(label)}</p>
    <h3 class="lang-start-title">${title}</h3><p class="lang-start-detail">${detail}</p>
    <div class="lang-actions"><button class="secondary-btn" type="button" ${back}>Back</button></div></div>`;
}

function doneHtml(ctx, label, kind, line, again, back) {
  return `<div class="lang-view lang-summary">
    <p class="lang-kicker">${ctx.escapeHtml(label)} · ${kind}</p>
    <h3 class="lang-start-title">Round done</h3>
    <p class="lang-start-detail">${line}</p>
    <div class="lang-actions">
      <button class="primary-btn" type="button" ${again}>${ctx.ico("replay", 16)} Another round</button>
      <button class="secondary-btn" type="button" ${back}>Back</button>
    </div></div>`;
}

// Speech nobody asked for follows "Play Dutch automatically"; buttons always speak.
const autoSay = (ctx, text) => { if (ctx.prefs().autoPlay) ctx.speech.speak(text, { rate: ctx.prefs().speechRate }); };

const bump = (words, id, ok) => {
  const w = words[id] || (words[id] = { seen: 0, c: 0, w: 0 });
  w.seen += 1;
  if (ok) w.c += 1; else w.w += 1;
};

// ── Verbs ────────────────────────────────────────────────────────────────────
export function createVerbs(ctx) {
  const { escapeHtml, ico } = ctx;
  let root = null;
  let v = null;
  let opts = null;
  let tenseChoice = "mixed";

  function start(el, o) {
    root = el;
    opts = o;
    const verbs = ctx.verbsFor(o.entries, { common: o.common });
    const hasPast = verbs.some((x) => x.pastKnown);
    if (!hasPast && tenseChoice !== "present") tenseChoice = "present";
    v = { label: o.label, verbs, hasPast, screen: "start", items: [], i: 0, answer: null, right: 0, words: {}, startedAt: ctx.now() };
    el.addEventListener("click", onClick);
    el.addEventListener("submit", onSubmit);
    render();
  }

  function buildRound() {
    const totals = ctx.wordTotals();
    const tenses = tenseChoice === "mixed" ? ["present", "past", "perfect"] : [tenseChoice];
    const items = [];
    let guard = 0;
    while (items.length < VERB_ROUND && guard++ < 400) {
      const verb = weightedPick(v.verbs.map((x) => ({ ...x, id: `verb:${x.inf}` })), 1, ctx.rng, (id) => totals[id]?.w || 0)[0];
      if (!verb) break;
      const ts = tenses.filter((t) => t === "present" || verb.pastKnown);
      if (!ts.length) continue;
      const tense = ts[Math.floor(ctx.rng() * ts.length)];
      const person = PERSONS[Math.floor(ctx.rng() * PERSONS.length)];
      const form = conjugate(verb, tense, person);
      if (!form) continue;
      const k = `${verb.inf}|${tense}|${person}`;
      if (items.some((x) => x.k === k)) continue;
      items.push({ k, verb, tense, person, form });
    }
    return items;
  }

  const current = () => (v && v.i < v.items.length ? v.items[v.i] : null);

  function render() {
    if (!root) return;
    if (!v.verbs.length) {
      root.innerHTML = emptyHtml(ctx, v.label, "No verbs here", "Verbs show up here when a lesson has them (Dutch infinitive = English “to …”).", "data-vb-back");
      return;
    }
    if (v.screen === "start") { root.innerHTML = startHtml(); return; }
    const it = current();
    if (!it) { root.innerHTML = doneHtml(ctx, v.label, "Verbs", `${v.right} of ${v.items.length} right the first time.`, "data-vb-again", "data-vb-back"); return; }
    const a = v.answer;
    const full = (x) => `${it.person === "hij" ? "hij" : it.person} ${x}`;
    root.innerHTML = `
      <div class="lang-view lang-vb">
        ${headHtml(ctx, "data-vb-back", `${v.i + 1} of ${v.items.length}`)}
        <div class="lang-fc-card">
          <p class="lang-kicker">${TENSE_LABEL[it.tense]}</p>
          <p class="lang-fc-word" lang="nl">${escapeHtml(it.verb.inf)}</p>
          <p class="lang-dh-en">${escapeHtml(it.verb.en || "")}</p>
          <form class="lang-vb-line" data-vb-form>
            <label class="lang-vb-person" for="langVbInput" lang="nl">${escapeHtml(PERSON_LABEL[it.person])}</label>
            <input id="langVbInput" type="text" lang="nl" autocomplete="off" autocapitalize="off" spellcheck="false" ${a ? "disabled" : ""} value="${escapeHtml(a?.value || "")}" placeholder="${it.tense === "perfect" ? "heb/ben + …" : "…"}" data-vb-input data-no-clear />
            ${a ? "" : `<button class="primary-btn" type="submit">Check</button>`}
          </form>
          ${a ? `<p class="lang-dh-result ${a.result === "wrong" ? "is-wrong" : "is-right"}" role="status">${a.result === "exact" ? `${ico("checkmark", 16)} Right` : a.result === "close" ? "Almost —" : "It's"} <b lang="nl">${escapeHtml(full(it.form.answer))}</b>${it.form.alts?.length ? ` <span class="lang-ls-en">(also: ${it.form.alts.map(escapeHtml).join(", ")})</span>` : ""}</p>
            <p class="lang-start-detail">${escapeHtml(ruleNote(it.verb, it.tense))}</p>
            <div class="lang-actions"><button class="primary-btn" type="button" data-vb-next>Next</button></div>` : ""}
        </div>
      </div>`;
    const f = root.querySelector(a ? "[data-vb-next]" : "[data-vb-input]");
    try { f?.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  function startHtml() {
    const chip = (key, label, enabled = true) => `<button class="lang-chip${tenseChoice === key ? " is-on" : ""}" type="button" data-vb-tense="${key}" aria-pressed="${tenseChoice === key}" ${enabled ? "" : "disabled"}>${label}</button>`;
    return `
      <div class="lang-view lang-start">
        <button class="secondary-btn compact-btn lang-back" type="button" data-vb-back>${ico("back", 16)} Back</button>
        <p class="lang-kicker">Verbs</p>
        <h3 class="lang-start-title">${escapeHtml(v.label)}</h3>
        <p class="lang-start-detail">${v.verbs.length} ${v.verbs.length === 1 ? "verb" : "verbs"}. Type the form for the person shown.</p>
        <div class="lang-chips" role="group" aria-label="Tense">
          ${chip("present", "Present")}${chip("past", "Past", v.hasPast)}${chip("perfect", "Perfect", v.hasPast)}${chip("mixed", "Mixed", v.hasPast)}
        </div>
        ${v.hasPast ? "" : `<p class="lang-start-detail">Only the present is offered for these verbs: their past forms aren't in the app's verb list yet.</p>`}
        <button class="primary-btn lang-go" type="button" data-vb-begin>${ico("play", 16)} Start</button>
      </div>`;
  }

  function check() {
    const it = current();
    if (!it || v.answer) return;
    const value = root.querySelector("[data-vb-input]")?.value || "";
    // Accept the answer with or without the pronoun typed in front of it.
    const given = value.trim().replace(new RegExp(`^(${it.person}|zij|ze|het|hij)\\s+`, "i"), "");
    const r = compareAnswer(given, it.form.answer, it.form.alts);
    v.answer = { value, result: r.result };
    if (r.result === "exact") v.right += 1;
    bump(v.words, `verb:${it.verb.inf}`, r.result !== "wrong");
    if (it.verb.entryId && r.result === "wrong") ctx.pull(it.verb.entryId);
    autoSay(ctx, `${it.person === "hij" ? "hij" : it.person} ${it.form.answer}`);
    render();
  }

  function next() {
    v.answer = null;
    v.i += 1;
    if (!current()) finish();
    render();
  }

  function finish() {
    if (!v || v.saved || !Object.keys(v.words).length) return;
    v.saved = true;
    ctx.countWords(v.words);
    ctx.saveSession({ kind: "verbs", label: v.label, startedAt: v.startedAt, correct: v.right, attempts: v.i });
    ctx.persist();
  }

  function begin() {
    v.items = buildRound();
    v.i = 0; v.right = 0; v.answer = null; v.words = {}; v.saved = false; v.startedAt = ctx.now();
    v.screen = "play";
    render();
  }

  function onSubmit(ev) {
    if (!ev.target.matches?.("[data-vb-form]")) return;
    ev.preventDefault();
    check();
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !root.contains(t)) return;
    if (t.hasAttribute("data-vb-tense")) { tenseChoice = t.dataset.vbTense; render(); return; }
    if (t.hasAttribute("data-vb-begin") || t.hasAttribute("data-vb-again")) { finish(); begin(); return; }
    if (t.hasAttribute("data-vb-next")) { next(); return; }
    if (t.hasAttribute("data-vb-back")) { stop(); ctx.back(); }
  }

  function stop() {
    finish();
    root?.removeEventListener("click", onClick);
    root?.removeEventListener("submit", onSubmit);
  }

  return { mount: start, leave() { stop(); root = null; v = null; }, _state: () => v };
}

// ── Word order ───────────────────────────────────────────────────────────────
export function createWordOrder(ctx) {
  const { escapeHtml, ico } = ctx;
  let root = null;
  let w = null;

  function start(el, o) {
    root = el;
    const totals = ctx.wordTotals();
    const items = weightedPick(WORD_ORDER_ITEMS.slice(), ORDER_ROUND, ctx.rng, (id) => totals[`wo:${id}`]?.w || 0);
    w = { label: o.label, items, i: 0, right: 0, done: 0, words: {}, startedAt: ctx.now() };
    load();
    el.addEventListener("click", onClick);
    render();
  }

  const current = () => (w && w.i < w.items.length ? w.items[w.i] : null);

  function load() {
    const it = current();
    if (!it) return;
    const toks = sentenceTokens(it.text);
    // The words already in place keep the sentence's own capital.
    w.fixed = toks.slice(0, it.start).map((t, k) => (k === 0 ? it.text.split(/\s+/)[0].replace(/[,.?!]+$/, "") : t));
    w.tiles = shuffle(toks.slice(it.start).map((text, k) => ({ id: `o${k}`, text })), ctx.rng);
    // A shuffle that happens to be the answer teaches nothing: turn it once more.
    if (w.tiles.length > 1 && w.tiles.map((x) => x.text).join(" ") === toks.slice(it.start).join(" ")) w.tiles.push(w.tiles.shift());
    w.chosen = [];
    w.tries = 0;
    w.result = null;
  }

  const tileText = (id) => w.tiles.find((t) => t.id === id)?.text || "";

  function render() {
    if (!root) return;
    const it = current();
    if (!it) { root.innerHTML = doneHtml(ctx, w.label, "Word order", `${w.right} of ${w.items.length} right the first time.`, "data-wo-again", "data-wo-back"); return; }
    const rule = WORD_ORDER_RULES[it.rule];
    const res = w.result;
    const finished = res && (res.ok || res.shown);
    const fixed = w.fixed.map((t) => `<span class="lang-tile is-fixed" lang="nl">${escapeHtml(t)}</span>`).join("");
    const chosen = w.chosen.map((id, k) => {
      const mark = res && !res.shown && res.marks ? (res.marks[w.fixed.length + k] ? " is-right" : " is-wrong") : "";
      return `<button class="lang-tile is-placed${mark}" type="button" data-wo-unplace="${id}" ${finished ? "disabled" : ""} lang="nl">${escapeHtml(tileText(id))}</button>`;
    }).join("");
    const bank = w.tiles.map((t) => {
      const used = w.chosen.includes(t.id);
      return `<button class="lang-tile${used ? " is-used" : ""}" type="button" data-wo-place="${t.id}" ${used || finished ? "disabled" : ""} lang="nl" ${used ? 'aria-hidden="true"' : ""}>${escapeHtml(t.text)}</button>`;
    }).join("");
    let status = "";
    if (res?.ok) status = `<p class="lang-dh-result is-right" role="status">${ico("checkmark", 16)} <span lang="nl">${escapeHtml(displaySentence(it.text))}</span></p>`;
    else if (res?.shown) status = `<p class="lang-dh-result is-wrong" role="status">Answer: <b lang="nl">${escapeHtml(displaySentence(it.text))}</b></p>`;
    else if (res) status = `<p class="lang-dh-result is-wrong" role="status">Marked words are in the wrong place — move them and check again.</p>`;
    root.innerHTML = `
      <div class="lang-view lang-sb lang-wo">
        ${headHtml(ctx, "data-wo-back", `${w.i + 1} of ${w.items.length}`)}
        <div class="lang-fc-card">
          <p class="lang-kicker">${escapeHtml(rule.title)}</p>
          <p class="lang-sb-en">${escapeHtml(it.en)}</p>
          <div class="lang-sb-line" aria-label="Your sentence">${fixed}${chosen || (fixed ? "" : `<span class="lang-sb-placeholder">Tap the words in order</span>`)}</div>
          <div class="lang-sb-bank" aria-label="Words">${bank}</div>
          ${status}
          ${finished || w.tries ? `<p class="lang-start-detail lang-wo-rule">${escapeHtml(rule.rule)}</p>` : ""}
          <div class="lang-actions">
            ${finished
              ? `<button class="secondary-btn" type="button" data-wo-say>${ico("volumeHigh", 16)} Hear it</button><button class="primary-btn" type="button" data-wo-next>Next</button>`
              : `<button class="secondary-btn" type="button" data-wo-show>Show answer</button><button class="primary-btn" type="button" data-wo-check ${w.chosen.length === w.tiles.length ? "" : "disabled"}>Check</button>`}
          </div>
        </div>
      </div>`;
  }

  function check() {
    const it = current();
    if (!it || w.result?.ok || w.result?.shown || w.chosen.length !== w.tiles.length) return;
    const r = checkSentence([...w.fixed, ...w.chosen.map(tileText)], it);
    w.tries += 1;
    w.result = r;
    if (r.ok) {
      if (w.tries === 1) w.right += 1;
      w.done += 1;
      bump(w.words, `wo:${it.id}`, w.tries === 1);
      autoSay(ctx, it.text);
    }
    render();
  }

  function show() {
    const it = current();
    if (!it || w.result?.ok || w.result?.shown) return;
    w.result = { shown: true };
    w.done += 1;
    bump(w.words, `wo:${it.id}`, false);
    autoSay(ctx, it.text);
    render();
  }

  function finish() {
    if (!w || w.saved || !w.done) return;
    w.saved = true;
    ctx.countWords(w.words);
    ctx.saveSession({ kind: "order", label: w.label, startedAt: w.startedAt, correct: w.right, attempts: w.done });
    ctx.persist();
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !root.contains(t)) return;
    const clearMiss = () => { if (w.result && !w.result.ok && !w.result.shown) w.result = null; };
    if (t.hasAttribute("data-wo-place")) { clearMiss(); w.chosen.push(t.dataset.woPlace); render(); return; }
    if (t.hasAttribute("data-wo-unplace")) { clearMiss(); w.chosen = w.chosen.filter((id) => id !== t.dataset.woUnplace); render(); return; }
    if (t.hasAttribute("data-wo-check")) { check(); return; }
    if (t.hasAttribute("data-wo-show")) { show(); return; }
    if (t.hasAttribute("data-wo-say")) { ctx.speech.speak(current()?.text || "", { rate: ctx.prefs().speechRate }); return; }
    if (t.hasAttribute("data-wo-next")) { w.i += 1; load(); if (!current()) finish(); render(); return; }
    if (t.hasAttribute("data-wo-again")) { const label = w.label; stop(); start(root, { label }); return; }
    if (t.hasAttribute("data-wo-back")) { stop(); ctx.back(); }
  }

  function stop() {
    finish();
    ctx.speech.stop();
    root?.removeEventListener("click", onClick);
  }

  return { mount: start, leave() { stop(); root = null; w = null; }, _state: () => w };
}

// ── Fill in the blank ────────────────────────────────────────────────────────
export function createCloze(ctx) {
  const { escapeHtml, ico } = ctx;
  let root = null;
  let c = null;
  let lastOpts = null;

  function start(el, o) {
    root = el;
    lastOpts = o;
    c = { label: o.label, items: clozeRound(o.sources, o.entries, CLOZE_ROUND, ctx.rng), i: 0, answer: null, hint: false, right: 0, words: {}, startedAt: ctx.now() };
    el.addEventListener("click", onClick);
    el.addEventListener("submit", onSubmit);
    render();
  }

  const current = () => (c && c.i < c.items.length ? c.items[c.i] : null);

  function render() {
    if (!root) return;
    if (!c.items.length) {
      root.innerHTML = emptyHtml(ctx, c.label, "No sentences yet", "Fill in the blank uses whole sentences: paste some from Rosetta Stone in Add words, or save words while reading the news.", "data-cz-back");
      return;
    }
    const it = current();
    if (!it) { root.innerHTML = doneHtml(ctx, c.label, "Fill in", `${c.right} of ${c.items.length} right.`, "data-cz-again", "data-cz-back"); return; }
    const a = c.answer;
    const width = Math.max(4, Math.min(16, it.length + 1));
    const blank = a
      ? `<b class="lang-cz-filled ${a.result === "wrong" ? "is-wrong" : "is-right"}">${escapeHtml(it.answer)}</b>`
      : `<input class="lang-cz-input" type="text" lang="nl" autocomplete="off" autocapitalize="off" spellcheck="false" style="width:${width}ch" aria-label="Missing word" data-cz-input data-no-clear />`;
    const hintLine = it.en ? escapeHtml(it.en) : it.hint ? `The missing word means “${escapeHtml(it.hint)}”.` : "";
    root.innerHTML = `
      <div class="lang-view lang-cz">
        ${headHtml(ctx, "data-cz-back", `${c.i + 1} of ${c.items.length}`)}
        <div class="lang-fc-card">
          <p class="lang-kicker">Fill in the missing word</p>
          <form class="lang-cz-sentence" data-cz-form lang="nl">${escapeHtml(it.before)}${blank}${escapeHtml(it.after)}</form>
          ${hintLine ? `<p class="lang-dh-en">${hintLine}</p>` : ""}
          ${!a && c.hint ? `<p class="lang-start-detail">Starts with “${escapeHtml(it.first)}”, ${it.length} letters.</p>` : ""}
          ${a ? `<p class="lang-dh-result ${a.result === "wrong" ? "is-wrong" : "is-right"}" role="status">${a.result === "exact" ? `${ico("checkmark", 16)} Right` : a.result === "close" ? `Almost — you wrote <span lang="nl">${escapeHtml(a.value)}</span>` : `You wrote <span lang="nl">${escapeHtml(a.value || "—")}</span>`}</p>` : ""}
          <div class="lang-actions">
            ${a
              ? `<button class="secondary-btn" type="button" data-cz-say>${ico("volumeHigh", 16)} Hear it</button><button class="primary-btn" type="button" data-cz-next>Next</button>`
              : `${c.hint ? "" : `<button class="secondary-btn" type="button" data-cz-hint>Hint</button>`}<button class="primary-btn" type="button" data-cz-check>Check</button>`}
          </div>
        </div>
      </div>`;
    const f = root.querySelector(a ? "[data-cz-next]" : "[data-cz-input]");
    try { f?.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  function check() {
    const it = current();
    if (!it || c.answer) return;
    const value = root.querySelector("[data-cz-input]")?.value || "";
    const r = compareAnswer(value, it.answer);
    c.answer = { value, result: r.result };
    if (r.result !== "wrong") c.right += 1;
    if (it.entryId) {
      bump(c.words, it.entryId, r.result !== "wrong");
      if (r.result === "wrong") ctx.pull(it.entryId);
    }
    autoSay(ctx, it.full);
    render();
  }

  function finish() {
    if (!c || c.saved || !c.i && !c.answer) return;
    c.saved = true;
    ctx.countWords(c.words);
    ctx.saveSession({ kind: "cloze", label: c.label, startedAt: c.startedAt, correct: c.right, attempts: c.i + (c.answer ? 1 : 0) });
    ctx.persist();
  }

  function onSubmit(ev) {
    if (!ev.target.matches?.("[data-cz-form]")) return;
    ev.preventDefault();
    check();
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !root.contains(t)) return;
    if (t.hasAttribute("data-cz-check")) { check(); return; }
    if (t.hasAttribute("data-cz-hint")) { c.hint = true; render(); return; }
    if (t.hasAttribute("data-cz-say")) { ctx.speech.speak(current()?.full || "", { rate: ctx.prefs().speechRate }); return; }
    if (t.hasAttribute("data-cz-next")) { c.answer = null; c.hint = false; c.i += 1; if (!current()) finish(); render(); return; }
    if (t.hasAttribute("data-cz-again")) { stop(); start(root, lastOpts); return; }
    if (t.hasAttribute("data-cz-back")) { stop(); ctx.back(); }
  }

  function stop() {
    finish();
    ctx.speech.stop();
    root?.removeEventListener("click", onClick);
    root?.removeEventListener("submit", onSubmit);
  }

  return { mount: start, leave() { stop(); root = null; c = null; }, _state: () => c };
}

// ── Reading: easy Dutch news ─────────────────────────────────────────────────
export const READER_FEEDS = Object.freeze([
  { key: "easy", label: "Easy", source: "NOS Jeugdjournaal", detail: "News written for children: short sentences, everyday words." },
  { key: "nos", label: "Regular", source: "NOS Nieuws", detail: "The regular NOS news. Harder." },
]);
const LIST_CACHE_KEY = "live-dutch-news-v1";
const GLOSS_CACHE_KEY = "live-dutch-gloss-v1";
const LIST_TTL_MS = 20 * 60_000;
const GLOSS_CAP = 400;

// Paragraph → sentences → word tokens, keeping punctuation and spaces so the
// paragraph reads exactly as written. Pure (exported for tests).
export function tokenizeParagraph(p) {
  const sentences = String(p || "").match(/[^.!?…]+[.!?…]*["”’)]*\s*/g) || [];
  return sentences.map((s) => s.split(/(\s+)/).filter((x) => x !== "").map((part) => {
    if (/^\s+$/.test(part)) return { space: part };
    const m = part.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}][\p{L}\p{N}'’-]*[\p{L}\p{N}]|[\p{L}\p{N}])?(.*)$/u);
    if (!m || !m[2]) return { punct: part };
    return { lead: m[1], word: m[2], trail: m[3] };
  }));
}

export function relativeTime(iso, now) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 60) return `${m || 1} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function createReader(ctx) {
  const { escapeHtml, ico } = ctx;
  let root = null;
  let r = null;
  let feed = "easy";
  const articleCache = new Map();

  const readJson = (k) => { try { return JSON.parse(ctx.storage.get(k) || "null"); } catch { return null; } };
  const writeJson = (k, v) => { try { ctx.storage.set(k, JSON.stringify(v)); } catch { /* storage off or full */ } };

  function start(el, o) {
    root = el;
    r = { label: o.label, screen: "list", items: null, error: "", loading: false, article: null, sel: null, gloss: null, glossError: "", translation: null, looked: 0, saved: 0, startedAt: ctx.now() };
    el.addEventListener("click", onClick);
    loadList(false);
  }

  async function loadList(force) {
    const cache = readJson(LIST_CACHE_KEY) || {};
    const hit = cache[feed];
    if (!force && hit && ctx.now() - hit.at < LIST_TTL_MS && Array.isArray(hit.items)) {
      r.items = hit.items; r.error = ""; render(); return;
    }
    r.loading = true; r.error = ""; render();
    const myFeed = feed;
    let res;
    try { res = await ctx.callReader({ action: "list", feed: myFeed }); } catch { res = { error: "No connection." }; }
    if (!r || feed !== myFeed) return;
    r.loading = false;
    if (res?.items) {
      r.items = res.items;
      cache[myFeed] = { at: ctx.now(), items: res.items };
      writeJson(LIST_CACHE_KEY, cache);
    } else {
      r.items = hit?.items || null;
      r.error = res?.error || "Couldn't load the news.";
    }
    render();
  }

  async function openArticle(id) {
    const item = (r.items || []).find((x) => x.id === id);
    if (!item) return;
    r.screen = "article";
    r.sel = null; r.gloss = null; r.translation = null;
    if (item.paragraphs?.length) { r.article = { item, paragraphs: item.paragraphs }; render(); scrollTop(); return; }
    if (articleCache.has(item.url)) { r.article = articleCache.get(item.url); render(); scrollTop(); return; }
    r.article = { item, paragraphs: null, loading: true };
    render();
    let res;
    try { res = await ctx.callReader({ action: "article", url: item.url }); } catch { res = { error: "No connection." }; }
    if (!r || r.article?.item?.id !== id) return;
    r.article = res?.paragraphs?.length ? { item, paragraphs: res.paragraphs } : { item, paragraphs: null, error: res?.error || "Couldn't open the article." };
    if (r.article.paragraphs) articleCache.set(item.url, r.article);
    render();
    scrollTop();
  }

  function scrollTop() { try { root.scrollIntoView({ block: "start" }); } catch { /* ignore */ } }

  function render() {
    if (!root || !r) return;
    root.innerHTML = r.screen === "article" ? articleHtml() : listHtml();
  }

  function listHtml() {
    const f = READER_FEEDS.find((x) => x.key === feed);
    const items = r.items || [];
    return `
      <div class="lang-view lang-rd">
        <div class="lang-fc-head">
          <button class="secondary-btn compact-btn" type="button" data-rd-back>${ico("back", 16)} Back</button>
          <button class="icon-btn" type="button" data-rd-refresh aria-label="Refresh">${ico("refresh", 18)}</button>
        </div>
        <h3 class="lang-start-title">Read the news</h3>
        <div class="lang-chips" role="group" aria-label="Level">
          ${READER_FEEDS.map((x) => `<button class="lang-chip${x.key === feed ? " is-on" : ""}" type="button" data-rd-feed="${x.key}" aria-pressed="${x.key === feed}">${x.label}</button>`).join("")}
        </div>
        <p class="lang-start-detail">${escapeHtml(f.source)} — ${escapeHtml(f.detail)} Tap any word for its meaning; save the ones you want to learn.</p>
        ${r.loading && !items.length ? `<p class="lang-start-detail" role="status">Loading…</p>` : ""}
        ${r.error ? `<p class="lang-note" role="status">${ico("info", 16)}<span>${escapeHtml(r.error)}${items.length ? " Showing the last list." : ""}</span></p>` : ""}
        <ul class="lang-rd-list">
          ${items.map((it) => `<li><button class="lang-rd-item" type="button" data-rd-open="${escapeHtml(it.id)}">
            <span class="lang-rd-title" lang="nl">${escapeHtml(it.title)}</span>
            <span class="lang-rd-meta">${escapeHtml(relativeTime(it.publishedAt, ctx.now()))}</span>
            ${it.summary ? `<span class="lang-rd-sum" lang="nl">${escapeHtml(it.summary)}</span>` : ""}
          </button></li>`).join("")}
        </ul>
      </div>`;
  }

  function wordHtml(tok, pi, si, wi) {
    const status = ctx.wordStatus(tok.word);
    const sel = r.sel && r.sel.pi === pi && r.sel.si === si && r.sel.wi === wi;
    return `${escapeHtml(tok.lead)}<button class="lang-rd-w${status ? ` is-${status}` : ""}${sel ? " is-sel" : ""}" type="button" data-rd-w="${pi}.${si}.${wi}">${escapeHtml(tok.word)}</button>${escapeHtml(tok.trail)}`;
  }

  function articleHtml() {
    const a = r.article;
    const it = a.item;
    let body = "";
    if (a.loading) body = `<p class="lang-start-detail" role="status">Opening the article…</p>`;
    else if (!a.paragraphs) {
      body = `${it.summary ? `<p class="lang-rd-p" lang="nl">${escapeHtml(it.summary)}…</p>` : ""}
        <p class="lang-note" role="status">${ico("info", 16)}<span>${escapeHtml(a.error || "")} You can read it on the NOS site.</span></p>`;
    } else {
      a.tokens = a.tokens || a.paragraphs.map((p) => tokenizeParagraph(p));
      body = a.tokens.map((sents, pi) => `
        <div class="lang-rd-para">
          <button class="icon-btn lang-say" type="button" data-rd-sayp="${pi}" aria-label="Hear this paragraph">${ico("volumeHigh", 18)}</button>
          <p class="lang-rd-p" lang="nl">${sents.map((toks, si) => toks.map((tok, wi) => tok.word ? wordHtml(tok, pi, si, wi) : escapeHtml(tok.space || tok.punct || "")).join("")).join("")}</p>
        </div>`).join("");
    }
    return `
      <div class="lang-view lang-rd lang-rd-article">
        <div class="lang-fc-head">
          <button class="secondary-btn compact-btn" type="button" data-rd-list>${ico("back", 16)} Articles</button>
          <a class="secondary-btn compact-btn" href="${escapeHtml(it.url)}" target="_blank" rel="noopener">Open on NOS</a>
        </div>
        <h3 class="lang-start-title" lang="nl">${escapeHtml(it.title)}</h3>
        <p class="lang-rd-legend"><span class="lang-rd-w is-known">known</span> <span class="lang-rd-w is-learning">learning</span> <span class="lang-rd-w is-saved">saved</span></p>
        ${body}
        ${r.sel ? sheetHtml() : ""}
      </div>`;
  }

  function sheetHtml() {
    const { word, sentence } = r.sel;
    const g = r.gloss;
    const status = ctx.wordStatus(g?.lemma || word) || ctx.wordStatus(word);
    let main = "";
    if (r.glossError) main = `<p class="lang-start-detail">${escapeHtml(r.glossError)}</p>`;
    else if (!g) main = `<p class="lang-start-detail" role="status">Looking up…</p>`;
    else main = `
      <p class="lang-rd-lemma" lang="nl">${escapeHtml(g.lemma)} <span class="lang-rd-pos">${escapeHtml(g.pos === "other" ? "" : g.pos)}</span></p>
      <p class="lang-rd-en">${escapeHtml(g.en)}</p>
      ${g.form ? `<p class="lang-start-detail">Here: ${escapeHtml(g.form)}</p>` : ""}
      ${g.note ? `<p class="lang-start-detail">${escapeHtml(g.note)}</p>` : ""}`;
    return `
      <div class="lang-rd-sheet" role="dialog" aria-label="Word: ${escapeHtml(word)}">
        <div class="lang-rd-sheet-head">
          <p class="lang-kicker" lang="nl">${escapeHtml(word)}</p>
          <button class="icon-btn" type="button" data-rd-close aria-label="Close">${ico("close", 16)}</button>
        </div>
        ${main}
        ${r.translation ? `<p class="lang-rd-trans"><span lang="nl">${escapeHtml(sentence)}</span><br>${escapeHtml(r.translation)}</p>` : ""}
        <div class="lang-actions">
          <button class="secondary-btn compact-btn" type="button" data-rd-hear>${ico("volumeHigh", 16)} Hear</button>
          ${r.translation ? "" : `<button class="secondary-btn compact-btn" type="button" data-rd-translate>Translate sentence</button>`}
          ${g ? (status === "known" || status === "learning" || status === "saved" || r.sel.added
            ? `<span class="lang-rd-in">${ico("checkmark", 14)} In your words</span>`
            : `<button class="primary-btn compact-btn" type="button" data-rd-add>${ico("add", 16)} Add to my words</button>`) : ""}
        </div>
      </div>`;
  }

  // The gloss cache lives on this device only (localStorage), newest kept.
  function cachedGloss(k) { return (readJson(GLOSS_CACHE_KEY) || {})[k] || null; }
  function cacheGloss(k, v) {
    const all = readJson(GLOSS_CACHE_KEY) || {};
    delete all[k];
    all[k] = v;
    const keys = Object.keys(all);
    for (let i = 0; i < keys.length - GLOSS_CAP; i += 1) delete all[keys[i]];
    writeJson(GLOSS_CACHE_KEY, all);
  }

  async function select(pi, si, wi) {
    const toks = r.article.tokens[pi][si];
    const word = toks[wi].word;
    const sentence = toks.map((t) => t.word ? `${t.lead}${t.word}${t.trail}` : t.space || t.punct || "").join("").trim();
    r.sel = { pi, si, wi, word, sentence };
    r.gloss = null; r.glossError = ""; r.translation = null;
    autoSay(ctx, word);
    const k = `${word.toLowerCase()}|${sentence}`;
    const hit = cachedGloss(k);
    if (hit) { r.gloss = hit; render(); focusSheet(); return; }
    render();
    focusSheet();
    r.looked += 1;
    let res;
    try { res = await ctx.callReader({ action: "gloss", word, sentence }); } catch { res = { error: "No connection." }; }
    if (!r || !r.sel || r.sel.word !== word || r.sel.sentence !== sentence) return;
    if (res?.en) { r.gloss = res; cacheGloss(k, res); } else r.glossError = res?.error || "Couldn't look that up.";
    render();
  }

  function focusSheet() {
    const b = root.querySelector(".lang-rd-sheet [data-rd-close]");
    try { root.querySelector(".lang-rd-sheet")?.scrollIntoView({ block: "nearest" }); b?.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  async function translateSel() {
    const sel = r.sel;
    if (!sel) return;
    const k = `t|${sel.sentence}`;
    const hit = cachedGloss(k);
    if (hit) { r.translation = hit.en; render(); return; }
    let res;
    try { res = await ctx.callReader({ action: "translate", sentence: sel.sentence }); } catch { res = { error: "No connection." }; }
    if (!r || r.sel !== sel) return;
    if (res?.en) { r.translation = res.en; cacheGloss(k, { en: res.en }); } else r.glossError = res?.error || "Couldn't translate that.";
    render();
  }

  function add() {
    const { sel, gloss } = r;
    if (!sel || !gloss) return;
    const out = ctx.addReadingWord({ text: gloss.lemma, en: gloss.en, ex: sel.sentence, w: sel.word, src: r.article?.item?.title || "" });
    sel.added = true;
    if (out && !out.existed) r.saved += 1;
    render();
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !root.contains(t)) return;
    if (t.hasAttribute("data-rd-w")) { const [pi, si, wi] = t.dataset.rdW.split(".").map(Number); select(pi, si, wi); return; }
    if (t.hasAttribute("data-rd-close")) { r.sel = null; render(); return; }
    if (t.hasAttribute("data-rd-hear")) { ctx.speech.speak(r.gloss?.lemma || r.sel?.word || "", { rate: ctx.prefs().speechRate }); return; }
    if (t.hasAttribute("data-rd-translate")) { translateSel(); return; }
    if (t.hasAttribute("data-rd-add")) { add(); return; }
    if (t.hasAttribute("data-rd-sayp")) { const p = r.article?.paragraphs?.[Number(t.dataset.rdSayp)]; if (p) ctx.speech.speak(p, { rate: ctx.prefs().speechRate }); return; }
    if (t.hasAttribute("data-rd-open")) { openArticle(t.dataset.rdOpen); return; }
    if (t.hasAttribute("data-rd-list")) { r.screen = "list"; r.article = null; r.sel = null; ctx.speech.stop(); render(); return; }
    if (t.hasAttribute("data-rd-feed")) { if (feed !== t.dataset.rdFeed) { feed = t.dataset.rdFeed; r.items = null; loadList(false); } return; }
    if (t.hasAttribute("data-rd-refresh")) { loadList(true); return; }
    if (t.hasAttribute("data-rd-back")) { stop(); ctx.back(); }
  }

  function stop() {
    if (r && !r.logged && (r.looked || r.saved)) {
      r.logged = true;
      ctx.saveSession({ kind: "read", label: "Reading", startedAt: r.startedAt, correct: r.saved, attempts: r.looked });
      ctx.persist();
    }
    ctx.speech.stop();
    root?.removeEventListener("click", onClick);
  }

  return { mount: start, leave() { stop(); root = null; r = null; }, _state: () => r };
}

