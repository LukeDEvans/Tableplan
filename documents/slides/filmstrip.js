// The filmstrip (SLIDES_DESIGN.md §3, §11): thumbnails of every slide down the left on
// the laptop, along the bottom on the phone. Click to go to a slide; Shift / Cmd-click
// to pick several; drag to reorder (a long press first on touch screens); right-click or
// long-press for the slide menu. Thumbnails are drawn only when a slide changes.

import { mountScaled, fitText } from "./render.js";
import { esc } from "./chrome.js";

export function createFilmstrip({ box, root, model, render, current, selected, editable, phone, onPick, onMove, onMenu, onNew }) {
  const cache = new Map(); // sid → rendered slide element
  let peers = new Map();
  let raf = 0;
  let drag = null;

  box.innerHTML = `<div class="sl-film-list" data-list role="listbox" aria-label="Slides"></div>
    <button type="button" class="sl-film-add" data-film-add aria-label="New slide" title="New slide">+</button>`;
  const list = box.querySelector("[data-list]");

  const thumbWidth = () => (phone() ? 96 : 150);

  function refresh() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  }

  function draw() {
    raf = 0;
    const ids = model.slideIds();
    const [W, H] = model.size();
    const cur = current();
    const sel = new Set(selected());
    const tw = thumbWidth();
    for (const k of [...cache.keys()]) if (!ids.includes(k)) cache.delete(k);
    const existing = new Map([...list.querySelectorAll("[data-sid]")].map((el) => [el.dataset.sid, el]));
    let prev = null;
    ids.forEach((sid, i) => {
      const s = model.slide(sid);
      let row = existing.get(sid);
      if (!row) {
        row = document.createElement("div");
        row.className = "sl-film-row";
        row.dataset.sid = sid;
        row.innerHTML = `<div class="sl-film-section" data-section hidden></div><div class="sl-film-item"><span class="sl-film-num"></span><div class="sl-thumb" data-thumb tabindex="0" role="option"></div></div>`;
      }
      existing.delete(sid);
      const sec = row.querySelector("[data-section]");
      sec.hidden = !s.section;
      sec.textContent = s.section || "";
      row.querySelector(".sl-film-num").textContent = String(i + 1);
      const th = row.querySelector("[data-thumb]");
      th.classList.toggle("is-current", sid === cur);
      th.classList.toggle("is-selected", sel.has(sid) && sel.size > 1);
      th.classList.toggle("is-skipped", !!s.skip);
      th.setAttribute("aria-selected", sid === cur ? "true" : "false");
      th.setAttribute("aria-label", `Slide ${i + 1}${s.skip ? " (skipped)" : ""}`);
      const peer = peers.get(sid);
      th.style.boxShadow = peer ? `0 0 0 3px ${peer}` : "";
      if (!cache.has(sid)) {
        const el = render(sid);
        cache.set(sid, el);
        mountScaled(th, el, W, H, tw);
        requestAnimationFrame(() => fitText(el));
      } else if (th.firstElementChild !== cache.get(sid) || Math.abs(th.getBoundingClientRect().width - tw) > 1) {
        mountScaled(th, cache.get(sid), W, H, tw);
      }
      if (prev ? row.previousElementSibling !== prev : row !== list.firstElementChild) (prev ? prev.after(row) : list.prepend(row));
      prev = row;
    });
    for (const el of existing.values()) el.remove();
    box.querySelector("[data-film-add]").hidden = !editable();
  }

  function setCurrent(sid) {
    for (const th of list.querySelectorAll("[data-thumb]")) {
      const id = th.closest("[data-sid]").dataset.sid;
      th.classList.toggle("is-current", id === sid);
      th.classList.toggle("is-selected", selected().includes(id) && selected().length > 1);
    }
    const el = list.querySelector(`[data-sid="${CSS.escape(sid)}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function invalidate(ids) {
    for (const id of ids) cache.delete(id);
    refresh();
  }

  function markPeers(map) { peers = map; refresh(); }

  // ---- pointer: pick, drag to reorder, long-press for the menu ----------------------------------
  list.addEventListener("pointerdown", (e) => {
    const row = e.target.closest("[data-sid]");
    if (!row || (e.button !== 0 && e.pointerType === "mouse")) return;
    const sid = row.dataset.sid;
    const x0 = e.clientX, y0 = e.clientY;
    const touch = e.pointerType !== "mouse";
    let started = false, longTimer = 0, menuShown = false;
    if (touch) longTimer = setTimeout(() => {
      // a long press without moving: the slide menu; moving after it: drag
      if (!started) { menuShown = true; onMenu(sid, row.querySelector("[data-thumb]")); }
    }, 450);
    const move = (ev) => {
      const d = Math.hypot(ev.clientX - x0, ev.clientY - y0);
      if (!started && d > 6) {
        clearTimeout(longTimer);
        if (!editable() || (touch && !menuShown)) { cleanup(); return; } // a touch scroll, not a drag
        started = true;
        if (menuShown) document.querySelector(".sl-pop")?.remove();
        const ids = selected().includes(sid) ? selected() : [sid];
        drag = { ids, ghost: makeGhost(row, ids.length), at: -1 };
      }
      if (started) {
        ev.preventDefault();
        drag.ghost.style.left = `${ev.clientX + 8}px`;
        drag.ghost.style.top = `${ev.clientY + 8}px`;
        showDrop(ev);
      }
    };
    const up = (ev) => {
      cleanup();
      if (started) {
        const at = drag.at;
        const ids = drag.ids;
        drag.ghost.remove();
        list.querySelector(".sl-drop")?.remove();
        drag = null;
        if (at >= 0) {
          const all = model.slideIds();
          const before = ids.filter((x) => all.indexOf(x) < at).length;
          onMove(ids, at - before);
        }
        return;
      }
      if (menuShown) return;
      onPick(sid, { add: ev.metaKey || ev.ctrlKey, range: ev.shiftKey });
    };
    const cleanup = () => { clearTimeout(longTimer); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); };
    const cancel = () => { cleanup(); drag?.ghost.remove(); list.querySelector(".sl-drop")?.remove(); drag = null; };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  });

  function makeGhost(row, n) {
    const g = document.createElement("div");
    g.className = "sl-film-ghost";
    g.innerHTML = `${row.querySelector("[data-thumb]").innerHTML}${n > 1 ? `<span class="sl-film-count">${n}</span>` : ""}`;
    root.appendChild(g);
    return g;
  }
  function showDrop(ev) {
    const rows = [...list.querySelectorAll("[data-sid]")];
    const horizontal = phone();
    let at = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      const mid = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
      if ((horizontal ? ev.clientX : ev.clientY) < mid) { at = i; break; }
    }
    drag.at = at;
    let line = list.querySelector(".sl-drop");
    if (!line) { line = document.createElement("div"); line.className = "sl-drop"; }
    if (at < rows.length) rows[at].before(line); else list.appendChild(line);
    // scroll near the edges
    const lr = list.getBoundingClientRect();
    if (horizontal) { if (ev.clientX < lr.left + 30) list.scrollLeft -= 12; if (ev.clientX > lr.right - 30) list.scrollLeft += 12; }
    else { if (ev.clientY < lr.top + 30) list.scrollTop -= 12; if (ev.clientY > lr.bottom - 30) list.scrollTop += 12; }
  }

  list.addEventListener("contextmenu", (e) => {
    const row = e.target.closest("[data-sid]");
    if (!row) return;
    e.preventDefault();
    onMenu(row.dataset.sid, row.querySelector("[data-thumb]"));
  });
  list.addEventListener("keydown", (e) => {
    const ids = model.slideIds();
    const i = ids.indexOf(current());
    if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); if (ids[i + 1]) onPick(ids[i + 1], {}); }
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); if (ids[i - 1]) onPick(ids[i - 1], {}); }
  });
  box.querySelector("[data-film-add]").addEventListener("click", () => onNew());

  void esc;
  return { refresh, setCurrent, invalidate, markPeers, clear: () => cache.clear() };
}
