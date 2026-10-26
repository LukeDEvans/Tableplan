// Add words (paste from Rosetta Stone) and the word list (LANGUAGE_PRACTICE.md
// §11). Screens mounted by language-ui.js. Context (beyond language-ui-cards.js):
//   ctx.userLessons() / ctx.userWords()   the synced maps (read)
//   ctx.setUser({ lessons?, words? })      replace them (then persist())
//   ctx.openLesson(id)                     go to a lesson's screen
//   ctx.isoNow()                           ISO time for `at` stamps

import {
  parsePaste, upsertUserLesson, addPastedWords, editUserWord, deleteUserWord, deleteUserLesson,
  normalizeUserLessons, normalizeUserWords, userLessonId,
} from "./language-words.js";

const EXAMPLE = "de jongen = boy\nhet meisje = girl\nlopen = to walk\nIk drink water. = I drink water.";

export function createAddWords(ctx) {
  const { escapeHtml, ico } = ctx;
  let root = null;
  let a = null;

  function defaults(lessonId) {
    const lessons = normalizeUserLessons(ctx.userLessons());
    if (lessonId && lessons[lessonId] && !lessons[lessonId].del) {
      const l = lessons[lessonId];
      return { unit: l.unit, lesson: l.lesson, unitTitle: l.unitTitle, title: l.title };
    }
    // The lesson after the last one you added to.
    const live = Object.values(lessons).filter((l) => !l.del).sort((x, y) => (y.at || "").localeCompare(x.at || ""));
    if (!live.length) return { unit: 1, lesson: 1, unitTitle: "", title: "" };
    const last = live[0];
    return { unit: last.unit, lesson: last.lesson, unitTitle: last.unitTitle, title: last.title };
  }

  function start(el, { lessonId } = {}) {
    root = el;
    a = { step: "form", ...defaults(lessonId), text: "", items: [], result: null };
    el.addEventListener("click", onClick);
    el.addEventListener("input", onInput);
    el.addEventListener("submit", onSubmit);
    render();
  }

  function lessonName() {
    return `Unit ${a.unit}${a.unitTitle ? ` (${a.unitTitle})` : ""} · Lesson ${a.lesson}${a.title ? `: ${a.title}` : ""}`;
  }

  function render() {
    if (!root) return;
    if (a.step === "done") { root.innerHTML = doneHtml(); return; }
    const preview = a.step === "preview" ? previewHtml() : "";
    root.innerHTML = `
      <div class="lang-view lang-add">
        <div class="lang-fc-head">
          <button class="secondary-btn compact-btn" type="button" data-wd-back>${ico("back", 16)} Back</button>
        </div>
        <h3 class="lang-start-title">Add words</h3>
        <p class="lang-start-detail">Copy a lesson's vocabulary from Rosetta Stone and paste it here, one per line: <span lang="nl">Dutch</span> = English. Whole sentences work too.</p>
        <form class="lang-add-form" data-wd-form>
          <div class="lang-add-where">
            <label>Unit <input type="number" inputmode="numeric" min="1" max="999" data-wd-field="unit" value="${a.unit}" required /></label>
            <label>Lesson <input type="number" inputmode="numeric" min="1" max="999" data-wd-field="lesson" value="${a.lesson}" required /></label>
          </div>
          <label class="lang-add-title">Unit name <span class="lang-optional">optional</span>
            <input type="text" maxlength="80" data-wd-field="unitTitle" value="${escapeHtml(a.unitTitle)}" placeholder="e.g. Basics" /></label>
          <label class="lang-add-title">Lesson name <span class="lang-optional">optional</span>
            <input type="text" maxlength="80" data-wd-field="title" value="${escapeHtml(a.title)}" placeholder="e.g. Greetings" /></label>
          <label class="lang-add-title">Words
            <textarea rows="8" data-wd-field="text" lang="nl" spellcheck="false" autocapitalize="off" placeholder="${escapeHtml(EXAMPLE)}">${escapeHtml(a.text)}</textarea></label>
          <div class="lang-actions">
            <button class="primary-btn" type="submit" ${a.text.trim() ? "" : "disabled"} data-wd-preview>Preview</button>
          </div>
        </form>
        ${preview}
      </div>`;
  }

  function previewHtml() {
    const ok = a.items.filter((i) => !i.error && !i.drop);
    const bad = a.items.filter((i) => i.error);
    return `
      <section class="lang-preview" aria-label="Preview">
        <h4 class="lang-unit-title">${ok.length} to add to ${escapeHtml(lessonName())}</h4>
        <ul class="lang-preview-list">
          ${a.items.map((it, k) => it.error
            ? `<li class="is-error"><span lang="nl">${escapeHtml(it.text)}</span><span class="lang-preview-why">${it.error === "same" ? "Dutch and English are the same" : "No English found — use “Dutch = English”"}</span></li>`
            : `<li class="${it.drop ? "is-dropped" : ""}">
                <span class="lang-preview-nl" lang="nl">${escapeHtml(it.text)}</span>
                <span class="lang-preview-en">${escapeHtml([it.en, ...(it.alsoEn || [])].join(" · "))}</span>
                <span class="lang-preview-tools">
                  <button class="lang-chip${it.kind === "sentence" ? " is-on" : ""}" type="button" data-wd-kind="${k}" aria-pressed="${it.kind === "sentence"}">${it.kind === "sentence" ? "Sentence" : "Word"}</button>
                  <button class="icon-btn" type="button" data-wd-drop="${k}" aria-label="${it.drop ? "Keep" : "Leave out"} ${escapeHtml(it.text)}">${ico(it.drop ? "add" : "close", 16)}</button>
                </span>
              </li>`).join("")}
        </ul>
        ${bad.length ? `<p class="lang-start-detail">${bad.length} ${bad.length === 1 ? "line" : "lines"} can't be added (shown in red).</p>` : ""}
        <div class="lang-actions">
          <button class="primary-btn" type="button" data-wd-save ${ok.length ? "" : "disabled"}>${ico("add", 16)} Add ${ok.length} ${ok.length === 1 ? "item" : "items"}</button>
        </div>
      </section>`;
  }

  function doneHtml() {
    const r = a.result;
    const dup = r.skipped.filter((x) => x.reason === "duplicate").length;
    return `
      <div class="lang-view lang-summary">
        <p class="lang-kicker">${escapeHtml(lessonName())}</p>
        <h3 class="lang-start-title">${r.added.length ? `Added ${r.added.length}` : "Nothing new"}</h3>
        <p class="lang-start-detail">${dup ? `${dup} ${dup === 1 ? "was" : "were"} already in this lesson. ` : ""}New words join your flashcards in course order${ctx.prefs().newPerDay ? `, ${ctx.prefs().newPerDay} a day` : ""}.</p>
        <div class="lang-actions">
          <button class="primary-btn" type="button" data-wd-open="${escapeHtml(r.lessonId)}">Open the lesson</button>
          <button class="secondary-btn" type="button" data-wd-more>Add more</button>
        </div>
      </div>`;
  }

  function readForm() {
    root.querySelectorAll("[data-wd-field]").forEach((el) => {
      const k = el.dataset.wdField;
      a[k] = k === "unit" || k === "lesson" ? Math.max(1, Math.min(999, Math.floor(Number(el.value) || 1))) : el.value;
    });
  }

  function preview() {
    readForm();
    a.items = parsePaste(a.text);
    a.step = a.items.length ? "preview" : "form";
    render();
    root.querySelector(".lang-preview")?.scrollIntoView?.({ block: "nearest" });
  }

  function save() {
    readForm();
    const at = ctx.isoNow();
    const { lessons, id } = upsertUserLesson(ctx.userLessons(), { unit: a.unit, lesson: a.lesson, unitTitle: a.unitTitle, title: a.title }, at);
    if (!id) return;
    const items = a.items.filter((i) => !i.drop);
    const r = addPastedWords(ctx.userWords(), id, items, { at, rng: ctx.rng, now: ctx.now() });
    ctx.setUser({ lessons, words: r.words });
    ctx.persist();
    a.result = { ...r, lessonId: id };
    a.step = "done";
    render();
  }

  function onInput(ev) {
    if (!ev.target.matches?.("[data-wd-field]")) return;
    const k = ev.target.dataset.wdField;
    if (k === "text") {
      a.text = ev.target.value;
      const btn = root.querySelector("[data-wd-preview]");
      if (btn) btn.disabled = !a.text.trim();
    }
    // Editing the form after a preview invalidates it.
    if (a.step === "preview") {
      a.step = "form";
      root.querySelector(".lang-preview")?.remove();
    }
  }

  function onSubmit(ev) {
    if (!ev.target.matches?.("[data-wd-form]")) return;
    ev.preventDefault();
    preview();
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !root.contains(t)) return;
    if (t.hasAttribute("data-wd-kind")) {
      const it = a.items[Number(t.dataset.wdKind)];
      if (it) { it.kind = it.kind === "sentence" ? "word" : "sentence"; readForm(); render(); }
      return;
    }
    if (t.hasAttribute("data-wd-drop")) {
      const it = a.items[Number(t.dataset.wdDrop)];
      if (it) { it.drop = !it.drop; readForm(); render(); }
      return;
    }
    if (t.hasAttribute("data-wd-save")) { save(); return; }
    if (t.hasAttribute("data-wd-more")) {
      const keep = { unit: a.unit, lesson: a.lesson, unitTitle: a.unitTitle, title: a.title };
      a = { step: "form", ...keep, text: "", items: [], result: null };
      render();
      return;
    }
    if (t.hasAttribute("data-wd-open")) { const id = t.dataset.wdOpen; stop(); ctx.openLesson(id); return; }
    if (t.hasAttribute("data-wd-back")) { stop(); ctx.back(); }
  }

  function stop() {
    root?.removeEventListener("click", onClick);
    root?.removeEventListener("input", onInput);
    root?.removeEventListener("submit", onSubmit);
  }

  return { mount: start, leave() { stop(); root = null; a = null; }, _state: () => a };
}

// ── Word list ─────────────────────────────────────────────────────────────────
export function createWordList(ctx) {
  const { escapeHtml, ico } = ctx;
  let root = null;
  let w = null;

  function start(el, { lessonId = "" } = {}) {
    root = el;
    w = { lessonId, query: "", editing: null, confirmDelete: false };
    el.addEventListener("click", onClick);
    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    el.addEventListener("submit", onSubmit);
    render();
  }

  function lessonOptions() {
    const course = ctx.course();
    const out = [];
    for (const level of course.levels || []) for (const unit of level.units || []) for (const l of unit.lessons || []) {
      out.push({ id: l.id, label: `${level.user ? "" : "Starter · "}${unit.title} · ${l.title}`, user: !!l.user });
    }
    return out;
  }

  function rows() {
    const course = ctx.course();
    const q = w.query.trim().toLowerCase();
    const all = [...course.entries, ...(course.sentences || [])];
    return all.filter((e) => (!w.lessonId || e.lesson === w.lessonId)
      && (!q || e.text.toLowerCase().includes(q) || e.en.toLowerCase().includes(q)));
  }

  function render(keepFocus = false) {
    if (!root) return;
    const opts = lessonOptions();
    const list = rows();
    const sel = opts.find((o) => o.id === w.lessonId);
    const shown = list.slice(0, 300);
    const html = `
      <div class="lang-view lang-wordlist">
        <div class="lang-fc-head">
          <button class="secondary-btn compact-btn" type="button" data-wl-back>${ico("back", 16)} Back</button>
          <span class="lang-fc-left">${list.length} ${list.length === 1 ? "item" : "items"}</span>
        </div>
        <h3 class="lang-start-title">Word list</h3>
        <div class="lang-wl-filters">
          <label class="visually-hidden" for="langWlLesson">Lesson</label>
          <select id="langWlLesson" data-wl-lesson>
            <option value="">All lessons</option>
            ${opts.map((o) => `<option value="${escapeHtml(o.id)}" ${o.id === w.lessonId ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
          </select>
          <label class="visually-hidden" for="langWlSearch">Search</label>
          <input id="langWlSearch" type="search" placeholder="Search Dutch or English" value="${escapeHtml(w.query)}" data-wl-search />
        </div>
        ${sel?.user ? `<div class="lang-actions lang-wl-lessontools">
            <button class="secondary-btn compact-btn" type="button" data-wl-add="${escapeHtml(sel.id)}">${ico("add", 16)} Add words here</button>
            ${w.confirmDelete
              ? `<span class="lang-wl-confirm">Delete this lesson and its words? <button class="danger-btn compact-btn" type="button" data-wl-dellesson-yes>Delete</button> <button class="secondary-btn compact-btn" type="button" data-wl-dellesson-no>Keep</button></span>`
              : `<button class="secondary-btn compact-btn" type="button" data-wl-dellesson>${ico("trash", 16)} Delete lesson</button>`}
          </div>` : ""}
        <ul class="lang-wl-list">
          ${shown.map((e) => rowHtml(e)).join("") || `<li class="empty-state">Nothing here${w.query ? " matches" : " yet"}.</li>`}
        </ul>
        ${list.length > shown.length ? `<p class="lang-start-detail">Showing the first ${shown.length}. Pick a lesson or search to narrow it down.</p>` : ""}
      </div>`;
    root.innerHTML = html;
    if (keepFocus) {
      const s = root.querySelector("[data-wl-search]");
      if (s) { s.focus(); const n = s.value.length; try { s.setSelectionRange(n, n); } catch { /* ignore */ } }
    }
  }

  function rowHtml(e) {
    if (w.editing === e.id && e.user) {
      return `<li class="lang-wl-row is-editing">
        <form class="lang-wl-edit" data-wl-form="${escapeHtml(e.id)}">
          <label>Dutch <input type="text" lang="nl" maxlength="300" value="${escapeHtml(e.text)}" data-wl-text required /></label>
          <label>English <input type="text" maxlength="300" value="${escapeHtml([e.en, ...(e.alsoEn || [])].join("; "))}" data-wl-en required /></label>
          <label>Note <input type="text" maxlength="200" value="${escapeHtml(e.note || "")}" data-wl-note placeholder="optional" /></label>
          <div class="lang-actions">
            <button class="danger-btn compact-btn" type="button" data-wl-delete="${escapeHtml(e.id)}">${ico("trash", 16)} Delete</button>
            <button class="secondary-btn compact-btn" type="button" data-wl-cancel>Cancel</button>
            <button class="primary-btn compact-btn" type="submit">Save</button>
          </div>
        </form>
      </li>`;
    }
    return `<li class="lang-wl-row">
      <button class="lang-wl-item" type="button" ${e.user ? `data-wl-edit="${escapeHtml(e.id)}"` : "disabled"} aria-label="${escapeHtml(`${e.text} — ${e.en}`)}${e.user ? ", edit" : ""}">
        <span class="lang-wl-nl" lang="nl">${escapeHtml(e.text)}</span>
        <span class="lang-wl-en">${escapeHtml(e.en)}</span>
      </button>
      <button class="icon-btn lang-say" type="button" data-wl-say="${escapeHtml(e.text)}" aria-label="Hear ${escapeHtml(e.text)}">${ico("volumeHigh", 18)}</button>
    </li>`;
  }

  function saveEdit(form) {
    const id = form.dataset.wlForm;
    const text = form.querySelector("[data-wl-text]")?.value || "";
    const en = (form.querySelector("[data-wl-en]")?.value || "").split(";").map((x) => x.trim()).filter(Boolean);
    const note = form.querySelector("[data-wl-note]")?.value || "";
    if (!text.trim() || !en.length) return;
    const words = editUserWord(ctx.userWords(), id, { text, en: en[0], alsoEn: en.slice(1), note }, ctx.isoNow());
    ctx.setUser({ words });
    ctx.persist();
    w.editing = null;
    render();
  }

  function onSubmit(ev) {
    const f = ev.target.closest?.("[data-wl-form]");
    if (!f) return;
    ev.preventDefault();
    saveEdit(f);
  }

  function onInput(ev) {
    if (ev.target.matches?.("[data-wl-search]")) { w.query = ev.target.value; render(true); }
  }

  function onChange(ev) {
    if (ev.target.matches?.("[data-wl-lesson]")) { w.lessonId = ev.target.value; w.editing = null; w.confirmDelete = false; render(); }
  }

  function onClick(ev) {
    const t = ev.target.closest("button");
    if (!t || !root.contains(t)) return;
    if (t.hasAttribute("data-wl-say")) { ctx.speech.speak(t.dataset.wlSay, { rate: ctx.prefs().speechRate }); return; }
    if (t.hasAttribute("data-wl-edit")) { w.editing = t.dataset.wlEdit; render(); root.querySelector("[data-wl-text]")?.focus(); return; }
    if (t.hasAttribute("data-wl-cancel")) { w.editing = null; render(); return; }
    if (t.hasAttribute("data-wl-delete")) {
      ctx.setUser({ words: deleteUserWord(ctx.userWords(), t.dataset.wlDelete, ctx.isoNow()) });
      ctx.persist();
      w.editing = null;
      render();
      return;
    }
    if (t.hasAttribute("data-wl-add")) { const id = t.dataset.wlAdd; stop(); ctx.openAddWords(id); return; }
    if (t.hasAttribute("data-wl-dellesson")) { w.confirmDelete = true; render(); return; }
    if (t.hasAttribute("data-wl-dellesson-no")) { w.confirmDelete = false; render(); return; }
    if (t.hasAttribute("data-wl-dellesson-yes")) {
      const out = deleteUserLesson(ctx.userLessons(), ctx.userWords(), w.lessonId, ctx.isoNow());
      ctx.setUser(out);
      ctx.persist();
      w.lessonId = "";
      w.confirmDelete = false;
      render();
      return;
    }
    if (t.hasAttribute("data-wl-back")) { stop(); ctx.back(); }
  }

  function stop() {
    root?.removeEventListener("click", onClick);
    root?.removeEventListener("input", onInput);
    root?.removeEventListener("change", onChange);
    root?.removeEventListener("submit", onSubmit);
  }

  return { mount: start, leave() { stop(); root = null; w = null; }, _state: () => w };
}

export { userLessonId, normalizeUserWords };
