// The editor's side panels and dialogs (WORD_PROCESSOR_DESIGN.md §6, §7, §8, §13):
// comments and suggestions, version history, the outline, and a small dialog helper.
// Everything a person typed is put in as text (textContent / escaped), never markup.

import { DOMSerializer } from "@tiptap/pm/model";
import { yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import { listThreads, addThread, replyTo, editReply, deleteReply, setResolved, mentionsIn } from "./doc-model.js";
import { listSuggestions } from "./suggest.js";
import { headings } from "./nodeviews.js";
import { colorFor } from "./live.js";
import { IC } from "./icons.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function timeAgo(ms, now = Date.now()) {
  if (!ms) return "";
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  const d = new Date(ms);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

// ---- dialog --------------------------------------------------------------------------------

// openDialog(host, { title, body (HTML built by the caller with esc), actions:
// [{ label, value, primary?, danger? }], init?(box) }) → Promise<{ value, form }>.
export function openDialog(host, { title, body = "", actions = [{ label: "Cancel", value: null }, { label: "OK", value: "ok", primary: true }], init = null }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "wp-dialog";
    wrap.innerHTML = `<form class="wp-dialog-box" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3>${body}
      <div class="wp-dialog-actions">${actions.map((a, i) => `<button type="${a.primary ? "submit" : "button"}" class="${a.primary ? "primary-btn" : a.danger ? "danger-btn" : "secondary-btn"}" data-i="${i}">${esc(a.label)}</button>`).join("")}</div>
    </form>`;
    host.appendChild(wrap);
    const form = wrap.querySelector("form");
    const done = (value) => { wrap.remove(); document.removeEventListener("keydown", onKey, true); resolve({ value, form }); };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); done(null); } };
    document.addEventListener("keydown", onKey, true);
    form.addEventListener("submit", (e) => { e.preventDefault(); const a = actions.find((x) => x.primary); done(a ? a.value : "ok"); });
    form.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-i]");
      if (b && b.type !== "submit") done(actions[Number(b.dataset.i)].value);
    });
    wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) done(null); });
    init?.(form);
    setTimeout(() => (form.querySelector("input, textarea, select") || form.querySelector("button[type=submit]"))?.focus(), 30);
  });
}

export async function promptText(host, title, { value = "", label = "", placeholder = "", multiline = false } = {}) {
  const { value: v, form } = await openDialog(host, {
    title,
    body: `<label>${esc(label)}${multiline ? `<textarea name="v" rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input type="text" name="v" value="${esc(value)}" placeholder="${esc(placeholder)}">`}</label>`,
  });
  return v ? form.v.value : null;
}

// ---- outline ---------------------------------------------------------------------------------

export function renderOutline(box, editor) {
  const hs = headings(editor.state.doc);
  box.innerHTML = hs.length
    ? `<nav class="wp-outline">${hs.map((h) => `<a href="#" data-pos="${h.pos}" style="padding-left:${6 + Math.max(0, h.level - 1) * 12}px">${esc(h.text)}</a>`).join("")}</nav>`
    : `<p class="msg-muted">Headings you add appear here.</p>`;
}

// ---- comments & suggestions ---------------------------------------------------------------------

// Where each thread's text starts in the document (null when its text was deleted).
function anchors(doc) {
  const at = new Map();
  doc.descendants((n, pos) => {
    if (!n.isInline) return true;
    for (const m of n.marks) if (m.type.name === "comment" && m.attrs.id && !at.has(m.attrs.id)) at.set(m.attrs.id, pos);
    return false;
  });
  return at;
}

export function commentsPanel({ box, editor, ydoc, me, people, mode, onNotify, host }) {
  const ui = { active: null, showResolved: false, editing: null };
  const nameOf = (id, fallback) => (id === me.id ? "You" : people.find((p) => p.id === id)?.name || fallback || "Someone");
  const avatar = (id, name) => `<span class="wp-person" style="background:${colorFor(id)};margin-left:0;width:24px;height:24px;font-size:.7rem">${esc(String(name || "?").trim()[0] || "?").toUpperCase()}</span>`;

  function draw() {
    const at = anchors(editor.state.doc);
    const threads = listThreads(ydoc)
      .filter((t) => ui.showResolved || !t.resolved)
      .map((t) => ({ ...t, pos: at.has(t.id) ? at.get(t.id) : null }))
      .sort((a, b) => (a.pos ?? 1e12) - (b.pos ?? 1e12) || a.createdAt - b.createdAt);
    const sugs = listSuggestions(editor.state.doc);
    const canResolve = mode() !== "viewing";
    let html = "";
    if (sugs.length && canResolve) {
      html += `<div class="wp-card-actions"><button type="button" data-act="accept-all">Accept all (${sugs.length})</button><button type="button" data-act="reject-all">Reject all</button></div>`;
    }
    for (const s of sugs) {
      const what = s.deleted && s.inserted ? `Replace: <span class="wp-sug-del">${esc(s.deleted.slice(0, 120))}</span> with <span class="wp-sug-ins">${esc(s.inserted.slice(0, 120))}</span>`
        : s.inserted ? `Add: <span class="wp-sug-ins">${esc(s.inserted.slice(0, 160))}</span>` : `Delete: <span class="wp-sug-del">${esc(s.deleted.slice(0, 160))}</span>`;
      html += `<div class="wp-card${ui.active === `s:${s.id}` ? " is-active" : ""}" data-sug="${esc(s.id)}" data-pos="${s.from}">
        <div class="wp-card-who">${avatar(s.author, s.name)}${esc(nameOf(s.author, s.name))} <small>${esc(timeAgo(s.at))}</small></div>
        <div class="wp-card-text">${what}</div>
        ${canResolve ? `<div class="wp-card-actions"><button type="button" data-act="accept" data-id="${esc(s.id)}">Accept</button><button type="button" data-act="reject" data-id="${esc(s.id)}">Reject</button></div>` : ""}
      </div>`;
    }
    for (const t of threads) {
      html += `<div class="wp-card${ui.active === t.id ? " is-active" : ""}${t.resolved ? " is-resolved" : ""}" data-thread="${esc(t.id)}" ${t.pos != null ? `data-pos="${t.pos}"` : ""}>
        <div class="wp-card-quote">${t.pos == null ? "<em>The text this was on was deleted.</em> " : ""}${esc(t.quote)}</div>
        ${t.replies.map((r) => `<div>
          <div class="wp-card-who">${avatar(r.by, r.name)}${esc(nameOf(r.by, r.name))} <small>${esc(timeAgo(r.at))}${r.edited ? " · edited" : ""}</small></div>
          ${ui.editing === r.id
            ? `<textarea data-edit-text="${esc(r.id)}">${esc(r.text)}</textarea><div class="wp-card-actions"><button type="button" data-act="save-edit" data-thread="${esc(t.id)}" data-id="${esc(r.id)}">Save</button><button type="button" data-act="cancel-edit">Cancel</button></div>`
            : `<div class="wp-card-text">${esc(r.text)}</div>${r.by === me.id ? `<div class="wp-card-actions"><button type="button" data-act="edit" data-id="${esc(r.id)}">Edit</button><button type="button" data-act="delete" data-thread="${esc(t.id)}" data-id="${esc(r.id)}">Delete</button></div>` : ""}`}
        </div>`).join("")}
        <textarea data-reply="${esc(t.id)}" placeholder="Reply… (@ to mention)" rows="2"></textarea>
        <div class="wp-card-actions"><button type="button" data-act="reply" data-thread="${esc(t.id)}">Reply</button>
        <button type="button" data-act="${t.resolved ? "reopen" : "resolve"}" data-thread="${esc(t.id)}">${t.resolved ? "Reopen" : "Resolve"}</button></div>
      </div>`;
    }
    if (!sugs.length && !threads.length) html += `<p class="msg-muted">No comments${ui.showResolved ? "" : " open"}. Select text and choose Comment to add one.</p>`;
    html += `<label class="is-row" style="font-size:.82rem;display:flex;gap:6px;align-items:center"><input type="checkbox" data-act="show-resolved"${ui.showResolved ? " checked" : ""}> Show resolved</label>`;
    box.innerHTML = html;
  }

  function focusAnchor(pos) {
    if (pos == null || Number.isNaN(pos)) return;
    editor.chain().setTextSelection(pos + 1).scrollIntoView().run();
  }

  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    const act = b?.dataset.act;
    if (!act) {
      const card = e.target.closest(".wp-card");
      if (card && !e.target.closest("textarea")) {
        ui.active = card.dataset.thread || `s:${card.dataset.sug}`;
        focusAnchor(Number(card.dataset.pos));
        draw();
        highlightActive(editor, card.dataset.thread || null);
      }
      return;
    }
    if (act === "accept") editor.commands.acceptSuggestion(b.dataset.id);
    else if (act === "reject") editor.commands.rejectSuggestion(b.dataset.id);
    else if (act === "accept-all") editor.commands.acceptAllSuggestions();
    else if (act === "reject-all") editor.commands.rejectAllSuggestions();
    else if (act === "resolve" || act === "reopen") setResolved(ydoc, b.dataset.thread, act === "resolve");
    else if (act === "reply") {
      const ta = box.querySelector(`textarea[data-reply="${CSS.escape(b.dataset.thread)}"]`);
      const text = ta?.value.trim();
      if (!text) return;
      replyTo(ydoc, b.dataset.thread, { text, user: me });
      const ids = mentionsIn(text, people).filter((id) => id !== me.id);
      if (ids.length) onNotify?.(ids, text);
    } else if (act === "edit") { ui.editing = b.dataset.id; draw(); return; }
    else if (act === "cancel-edit") { ui.editing = null; draw(); return; }
    else if (act === "save-edit") {
      const ta = box.querySelector(`textarea[data-edit-text="${CSS.escape(b.dataset.id)}"]`);
      if (ta?.value.trim()) editReply(ydoc, b.dataset.thread, b.dataset.id, ta.value.trim(), me.id);
      ui.editing = null;
    } else if (act === "delete") {
      if (!window.confirm("Delete this comment?")) return;
      if (deleteReply(ydoc, b.dataset.thread, b.dataset.id, me.id) === "thread") removeCommentMark(editor, b.dataset.thread);
    }
    draw();
  });
  box.addEventListener("change", (e) => { if (e.target.matches("[data-act=show-resolved]")) { ui.showResolved = e.target.checked; draw(); } });

  const observer = () => draw();
  ydoc.getMap("comments").observeDeep(observer);
  let t = null;
  const onUpdate = () => { clearTimeout(t); t = setTimeout(() => { if (!box.contains(document.activeElement)) draw(); }, 250); };
  editor.on("update", onUpdate);
  draw();
  return {
    draw,
    focus(id) { ui.active = id; draw(); box.querySelector(`[data-thread="${CSS.escape(id)}"] textarea[data-reply]`)?.focus(); },
    async add() {
      const { from, to, empty } = editor.state.selection;
      if (empty) return false;
      const quote = editor.state.doc.textBetween(from, to, " ").slice(0, 300);
      const text = await promptText(host, "Add a comment", { multiline: true, placeholder: "Comment… (@ to mention)" });
      if (!text?.trim()) return false;
      const id = (crypto.getRandomValues(new Uint8Array(8))).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
      ydoc.transact(() => {
        addThread(ydoc, { id, quote, text: text.trim(), user: me });
      });
      editor.chain().setTextSelection({ from, to }).setMark("comment", { id }).run();
      const ids = mentionsIn(text, people).filter((x) => x !== me.id);
      if (ids.length) onNotify?.(ids, text);
      ui.active = id;
      draw();
      return true;
    },
    destroy() { ydoc.getMap("comments").unobserveDeep(observer); editor.off("update", onUpdate); clearTimeout(t); },
  };
}

function removeCommentMark(editor, id) {
  const { state } = editor;
  const tr = state.tr;
  state.doc.descendants((n, pos) => {
    if (!n.isInline) return true;
    const m = n.marks.find((x) => x.type.name === "comment" && x.attrs.id === id);
    if (m) tr.removeMark(pos, pos + n.nodeSize, m);
    return false;
  });
  if (tr.docChanged) editor.view.dispatch(tr.setMeta("suggest-skip", true));
}

export function highlightActive(editor, id) {
  for (const el of editor.view.dom.querySelectorAll(".doc-comment.is-active")) el.classList.remove("is-active");
  if (!id) return;
  for (const el of editor.view.dom.querySelectorAll(`.doc-comment[data-comment-id="${CSS.escape(id)}"]`)) el.classList.add("is-active");
}

// ---- version history ------------------------------------------------------------------------------

export function versionsPanel({ box, session, schema, people, me, onPreview, host }) {
  let list = [];
  let active = null;
  const nameOf = (id) => (id === me.id ? "You" : people.find((p) => p.id === id)?.name || "");
  async function load() {
    box.innerHTML = `<p class="msg-muted">Loading versions…</p>`;
    try { list = await session.versions(); } catch (e) { box.innerHTML = `<p class="msg-error">${esc(e?.message || "Versions couldn't be loaded.")}</p>`; return; }
    draw();
  }
  function draw() {
    let html = `<div class="wp-card-actions"><button type="button" data-act="name-now">Name the current version</button></div>
      <p class="msg-muted" style="font-size:.8rem;margin:0">Kept: every hour for a day, every day for a month, every week for a year, and named versions for good.</p>`;
    let lastDay = "";
    for (const v of list) {
      const d = new Date(v.savedAt);
      const day = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
      if (day !== lastDay) { html += `<div class="wp-day">${esc(day)}</div>`; lastDay = day; }
      html += `<button type="button" class="wp-version${active === v.slot ? " is-active" : ""}" data-slot="${esc(v.slot)}">
        <strong>${esc(v.name || d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</strong>
        <small>${v.name ? `${esc(d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))} · ` : ""}${esc(nameOf(v.savedBy) || "")}</small></button>`;
    }
    if (!list.length) html += `<p class="msg-muted">No versions yet. One is kept every 15 minutes of editing and when you close the document.</p>`;
    box.innerHTML = html;
  }
  box.addEventListener("click", async (e) => {
    if (e.target.closest("[data-act=name-now]")) {
      const name = await promptText(host, "Name this version", { placeholder: "e.g. Signed copy" });
      if (!name?.trim()) return;
      try { await session.snapshot(name.trim().slice(0, 120)); await load(); } catch (err) { window.alert(err?.message || "That didn't work."); }
      return;
    }
    const b = e.target.closest("[data-slot]");
    if (!b) return;
    active = b.dataset.slot;
    draw();
    const v = list.find((x) => x.slot === active);
    try {
      const vdoc = await session.loadVersion(active);
      onPreview({ version: v, html: versionHtml(vdoc, schema) });
    } catch (err) { window.alert(err?.message || "That version couldn't be opened."); }
  });
  load();
  return { reload: load, clear() { active = null; draw(); } };
}

// A version's body as HTML, through the schema's own renderers (all attributes checked there).
export function versionHtml(vdoc, schema) {
  const node = yXmlFragmentToProseMirrorRootNode(vdoc.getXmlFragment("default"), schema);
  const div = document.createElement("div");
  div.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(node.content));
  return div;
}

export { IC };
