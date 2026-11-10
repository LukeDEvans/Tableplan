// Presenting (SLIDES_DESIGN.md §9). Full screen on the laptop (arrows, space, clickers,
// number + Enter, B / W for a black or white screen, Esc to leave), with a presenter view
// in its own window (current slide, next step, notes, timer, thumbnails). On the iPhone,
// Present plays full screen on the phone (swipe or tap), or — connected to a TV — shows
// the slides on the TV and presenter view on the phone (presenter-air.js).
//
// While presenting, this device's live presence carries where the show is
// ({ slide, step }), so your phone can follow and drive it as a remote (remote.js).
// Nothing new is stored and nothing polls.

import { renderSlide, fitText, fitScale, mountScaled } from "./render.js";
import { fragmentHtml } from "./text.js";
import { buildSteps, prepareSlide, playStep, runTransition, stepDuration } from "./anim.js";
import { esc } from "./chrome.js";
import { liveMedia, stopAllAcross } from "./av.js";
import { remoteFollower } from "./remote.js";

const SVG = {
  prev: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  notes: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  exit: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

// The deck: the slides to show (skipped ones left out) and each one's steps.
export function deckOf(model) {
  return model.slideIds().filter((id) => !model.slide(id)?.skip).map((id) => ({ id, ...buildSteps(model.anims(id)) }));
}

// A show: the engine both the full-screen view and the AirPlay screen drive.
export function createShow({ model, media, frame, onChange = () => {}, doc = document }) {
  let deck = deckOf(model);
  let i = 0, step = 0;
  let cur = null;
  let busy = Promise.resolve();
  let autoTimer = 0;
  let playing = [];
  const [W, H] = model.size();

  const mediaUrl = (id) => media.url(id);
  function scale() { const r = frame.getBoundingClientRect(); return fitScale(W, H, r.width, r.height); }
  function place(el) {
    const s = scale();
    el.style.transform = `scale(${s})`;
    el.style.transformOrigin = "0 0";
    el.style.left = `${(frame.clientWidth - W * s) / 2}px`;
    el.style.top = `${(frame.clientHeight - H * s) / 2}px`;
  }
  function draw(idx) {
    const d = deck[idx];
    const el = renderSlide(model, d.id, { mediaUrl, textHtml: fragmentHtml, doc });
    el.classList.add("is-show");
    place(el);
    return el;
  }
  function stopMedia() { for (const p of playing) p.stop(); playing = []; }
  function startMedia(el, d) {
    stopMedia();
    if (show.silent) return; // the TV plays them
    playing = liveMedia(el, model, d.id, media, { keepAcross: true });
  }
  function scheduleAuto() {
    clearTimeout(autoTimer);
    const d = deck[i];
    const s = model.slide(d?.id);
    if (!s?.advance && !show.loopEvery) return;
    const secs = s?.advance || show.loopEvery;
    autoTimer = setTimeout(() => { if (i < deck.length - 1 || step < deck[i].steps.length - 1) next(); else if (show.loop) go(0); }, secs * 1000);
  }

  async function enter(idx, { back = false, instant = false, toEnd = false } = {}) {
    const d = deck[idx];
    if (!d) return;
    const el = draw(idx);
    const anims = model.anims(d.id);
    prepareSlide(el, anims);
    const old = cur;
    frame.appendChild(el);
    fitText(el);
    const tr = model.slide(d.id)?.transition;
    cur = el;
    i = idx;
    step = 0;
    if (!instant && old && !back) await runTransition(old, el, tr, { w: frame.clientWidth, h: frame.clientHeight });
    else if (!instant && old && back) await runTransition(old, el, tr ? { ...tr, kind: tr.kind === "cube" || tr.kind === "slide" || tr.kind === "gallery" || tr.kind === "flip" ? tr.kind : tr.kind } : null, { w: frame.clientWidth, h: frame.clientHeight, back: true });
    old?.remove();
    startMedia(el, d);
    // steps before the first click play by themselves
    if (toEnd) { for (let k = 0; k < d.steps.length; k++) playStep(el, d.steps[k], { instant: true }); step = d.steps.length - 1; }
    else if (d.steps[0].length) { await playStep(el, d.steps[0], { instant }).done; }
    onChange();
    scheduleAuto();
  }

  function queue(fn) { busy = busy.then(fn).catch((e) => console.error("slides show:", e)); return busy; }

  function next() {
    return queue(async () => {
      clearTimeout(autoTimer);
      const d = deck[i];
      if (d && step < d.steps.length - 1) {
        step++;
        onChange();
        await playStep(cur, d.steps[step]).done;
        scheduleAuto();
        return;
      }
      if (i < deck.length - 1) await enter(i + 1);
      else { show.ended = true; onChange(); }
    });
  }
  function prev() {
    return queue(async () => {
      clearTimeout(autoTimer);
      if (show.ended) { show.ended = false; onChange(); return; }
      const d = deck[i];
      if (step > 0) {
        // back one step: redraw the slide and fast-forward to the step before
        const target = step - 1;
        const el = draw(i);
        prepareSlide(el, model.anims(d.id));
        frame.appendChild(el);
        fitText(el);
        for (let k = 0; k <= target; k++) playStep(el, d.steps[k], { instant: true });
        cur?.remove();
        cur = el;
        step = target;
        startMedia(el, d);
        onChange();
        return;
      }
      if (i > 0) await enter(i - 1, { back: true, toEnd: true });
    });
  }
  function go(idx) {
    return queue(async () => {
      clearTimeout(autoTimer);
      show.ended = false;
      await enter(Math.max(0, Math.min(deck.length - 1, idx)), { instant: false });
    });
  }
  function relayout() { if (cur) place(cur); }

  const show = {
    get index() { return i; }, get step() { return step; }, get deck() { return deck; }, get slideId() { return deck[i]?.id; },
    ended: false, loop: false, loopEvery: 0, silent: false,
    start: (idx) => queue(() => enter(Math.max(0, Math.min(deck.length - 1, idx)), { instant: true })),
    next, prev, go, relayout,
    // After an edit (someone skips a slide or changes its animations): rebuild the deck,
    // staying on the same slide, and keep the step within that slide's steps.
    refresh() {
      const id = deck[i]?.id;
      deck = deckOf(model);
      const at = deck.findIndex((d) => d.id === id);
      i = at >= 0 ? at : Math.min(i, Math.max(0, deck.length - 1));
      step = Math.min(step, Math.max(0, (deck[i]?.steps.length || 1) - 1));
    },
    indexOf: (id) => deck.findIndex((d) => d.id === id),
    stop() { clearTimeout(autoTimer); stopMedia(); stopAllAcross(); cur?.remove(); cur = null; },
    stopMedia: () => stopMedia(),
    stepsLeft: () => (deck[i] ? deck[i].steps.length - 1 - step : 0),
    totalSteps: (idx) => (deck[idx]?.steps.length || 1),
    stepDuration,
  };
  return show;
}

export function startPresenting({ model, media, session, me, deps = {}, host = document.body, start = 0, name = "", onEnd = null }) {
  const isNativePhone = !!deps.isNative?.() && window.matchMedia("(max-width: 900px)").matches;
  const root = document.createElement("div");
  root.className = "sl-show";
  root.tabIndex = -1;
  root.innerHTML = `<div class="sl-show-frame" data-frame></div>
    <div class="sl-show-tap is-prev" data-tap="prev" aria-hidden="true"></div><div class="sl-show-tap is-next" data-tap="next" aria-hidden="true"></div>
    <div class="sl-show-black" data-black hidden></div>
    <div class="sl-show-bar" role="toolbar" aria-label="Presenting">
      <button type="button" data-s="prev" aria-label="Previous">${SVG.prev}</button>
      <span data-count></span>
      <button type="button" data-s="next" aria-label="Next">${SVG.next}</button>
      <button type="button" data-s="presenter" aria-label="Presenter view" title="Presenter view (S)">${SVG.notes}</button>
      <button type="button" data-s="full" aria-label="Full screen" title="Full screen (F)">${SVG.full}</button>
      <button type="button" data-s="exit" aria-label="Stop presenting" title="Stop presenting (Esc)">${SVG.exit}</button>
    </div>`;
  host.appendChild(root);
  const frame = root.querySelector("[data-frame]");
  const sizeFrame = () => { frame.style.width = `${window.innerWidth}px`; frame.style.height = `${window.innerHeight}px`; };
  sizeFrame();

  const show = createShow({ model, media, frame, onChange: () => changed() });
  // a co-editor's change during the show: the deck follows (and so do the TV and remote)
  let refreshTimer = 0;
  const onEdit = (_, origin) => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { show.refresh(); changed(); }, 150); void origin; };
  model.ydoc.on("update", onEdit);
  let presenter = null;
  let air = null;
  let ended = false;
  const t0 = Date.now();

  function changed() {
    const d = show.deck;
    root.querySelector("[data-count]").textContent = show.ended ? "End" : `${show.index + 1} / ${d.length}`;
    if (show.ended) showEnd(); else hideEnd();
    presenter?.update();
    air?.update();
    session.awareness.setLocalStateField("show", { slide: show.slideId, step: show.step, ended: show.ended, n: show.index, of: d.length, by: me.id, at: Date.now() });
  }
  function showEnd() {
    if (root.querySelector(".sl-show-end")) return;
    const e = document.createElement("div");
    e.className = "sl-show-end";
    e.style.cssText = "position:absolute;inset:0;display:grid;place-items:center;background:#000;color:#bbb;font:18px system-ui;z-index:8";
    e.textContent = "End of presentation. Click or press Esc to leave.";
    root.appendChild(e);
  }
  function hideEnd() { root.querySelector(".sl-show-end")?.remove(); }

  // ---- input ------------------------------------------------------------------------------------
  let typed = "";
  function onKey(e) {
    if (e.target.closest?.("input, textarea")) return;
    const k = e.key;
    const black = root.querySelector("[data-black]");
    if (!black.hidden && !["b", "B", ".", "w", "W", ","].includes(k)) { black.hidden = true; e.preventDefault(); return; }
    if (k === "Escape") { e.preventDefault(); end(); return; }
    if (/^\d$/.test(k)) { typed += k; return; }
    if (k === "Enter" && typed) { e.preventDefault(); show.go(Number(typed) - 1); typed = ""; return; }
    typed = "";
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n", "N"].includes(k)) { e.preventDefault(); if (show.ended) end(); else show.next(); return; }
    if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p", "P"].includes(k)) { e.preventDefault(); show.prev(); return; }
    if (k === "Home") { e.preventDefault(); show.go(0); return; }
    if (k === "End") { e.preventDefault(); show.go(show.deck.length - 1); return; }
    if (k === "b" || k === "B" || k === ".") { black.style.background = "#000"; black.hidden = !black.hidden; air?.black(black.hidden ? null : "black"); return; }
    if (k === "w" || k === "W" || k === ",") { black.style.background = "#fff"; black.hidden = !black.hidden; air?.black(black.hidden ? null : "white"); return; }
    if (k === "s" || k === "S") { openPresenter(); return; }
    if (k === "f" || k === "F") { toggleFull(); return; }
  }
  document.addEventListener("keydown", onKey, true);

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-s]");
    if (b) {
      const a = b.dataset.s;
      if (a === "prev") show.prev();
      if (a === "next") show.next();
      if (a === "presenter") openPresenter();
      if (a === "full") toggleFull();
      if (a === "exit") end();
      return;
    }
    if (e.target.closest("video, audio, iframe, .sl-live-media")) return;
    const tap = e.target.closest("[data-tap]")?.dataset.tap;
    if (show.ended) { end(); return; }
    if (tap === "prev") show.prev(); else show.next();
  });
  // swipes on touch screens
  let sx = 0, sy = 0;
  root.addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; });
  root.addEventListener("pointerup", (e) => {
    if (e.pointerType === "mouse") return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { e.preventDefault(); if (dx < 0) show.next(); else show.prev(); root.dataset.swiped = "1"; setTimeout(() => delete root.dataset.swiped, 300); }
  });
  root.addEventListener("click", (e) => { if (root.dataset.swiped) e.stopImmediatePropagation(); }, true);
  // the bar and the pointer show when the mouse moves
  let hideTimer = 0;
  root.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    root.classList.add("show-cursor");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => root.classList.remove("show-cursor"), 2500);
  });
  const onResize = () => { sizeFrame(); show.relayout(); };
  window.addEventListener("resize", onResize);

  // ---- full screen ------------------------------------------------------------------------------
  function toggleFull() {
    const d = document;
    if (d.fullscreenElement) d.exitFullscreen?.().catch(() => {});
    else root.requestFullscreen?.().catch(() => {});
  }
  const onFs = () => { if (!document.fullscreenElement && fsWas && !presenter) { /* leaving full screen doesn't stop the show */ } fsWas = !!document.fullscreenElement; };
  let fsWas = false;
  document.addEventListener("fullscreenchange", onFs);
  if (!isNativePhone) root.requestFullscreen?.().catch(() => {});

  // ---- presenter view ---------------------------------------------------------------------------
  function openPresenter() {
    if (presenter) { presenter.focus(); return; }
    if (isNativePhone) return; // the phone's presenter view comes with AirPlay
    presenter = openPresenterWindow({ model, media, show, name, t0, onClose: () => { presenter = null; } });
  }

  // ---- AirPlay / an external screen (iPhone) -----------------------------------------------------
  if (deps.presentScreen) {
    import("./presenter-air.js").then(({ connectAirPlay }) => {
      if (ended) return;
      air = connectAirPlay({ plugin: deps.presentScreen, model, media, show, root, name, t0, onScreen: (on) => { root.classList.toggle("is-airplay", on); show.silent = on; if (on) show.stopMedia(); } });
    }).catch(() => {});
  }

  // ---- remote: Next / Back from a phone in the same presentation (remote.js) ----------------
  const toggleBlack = () => { const b = root.querySelector("[data-black]"); b.style.background = "#000"; b.hidden = !b.hidden; air?.black(b.hidden ? null : "black"); };
  const onAware = remoteFollower(session.awareness, { next: () => show.next(), prev: () => show.prev(), go: (n) => show.go(n), black: toggleBlack, end: () => end() });
  session.awareness.on("change", onAware);

  // ---- start and end --------------------------------------------------------------------------------
  show.start(start);
  root.focus();

  function end() {
    if (ended) return;
    ended = true;
    const last = show.slideId;
    show.stop();
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("fullscreenchange", onFs);
    window.removeEventListener("resize", onResize);
    session.awareness.off("change", onAware);
    model.ydoc.off("update", onEdit);
    clearTimeout(refreshTimer);
    session.awareness.setLocalStateField("show", null);
    presenter?.close();
    air?.close();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    root.remove();
    onEnd?.(last);
  }
  return { end, show, openPresenter };
}

// ---- presenter view in its own window --------------------------------------------------------------
export function openPresenterWindow({ model, media, show, name, t0, onClose }) {
  const win = window.open("", "live-slides-presenter", "width=1100,height=720");
  if (!win) return null;
  const d = win.document;
  d.title = `Presenter view — ${name}`;
  d.head.innerHTML = "";
  for (const n of document.querySelectorAll('link[rel=stylesheet], style')) d.head.appendChild(n.cloneNode(true));
  d.body.innerHTML = presenterHtml();
  d.body.style.margin = "0";
  return mountPresenter({ doc: d, win, model, media, show, t0, onClose, closeWin: () => win.close() });
}

export function presenterHtml() {
  return `<div class="sl-presenter" data-pv>
    <div class="sl-pv-top"><strong data-timer>0:00</strong><button type="button" data-pv-act="pause">Pause</button><button type="button" data-pv-act="reset">Reset</button><span class="sl-pv-clock" data-clock></span><span class="sl-pv-spacer"></span><span data-pv-count></span><button type="button" data-pv-act="smaller" aria-label="Smaller notes">A−</button><button type="button" data-pv-act="bigger" aria-label="Bigger notes">A+</button><button type="button" data-pv-act="end">End</button></div>
    <div class="sl-pv-cur"><span class="sl-pv-label">Now</span><div data-cur></div></div>
    <div class="sl-pv-side"><div class="sl-pv-next"><span class="sl-pv-label" data-next-label>Next</span><div data-next></div></div><div class="sl-pv-notes" data-notes></div></div>
    <div class="sl-pv-ctrl"><button type="button" data-pv-act="prev">◀ Back</button><button type="button" class="sl-pv-big" data-pv-act="next">Next ▶</button></div>
  </div>`;
}

// Fills a presenter view (a window, or the phone's screen under AirPlay).
export function mountPresenter({ doc, win, model, media, show, t0, onClose, closeWin, onEnd = null }) {
  const $ = (s) => doc.querySelector(s);
  const [W, H] = model.size();
  let paused = 0, pausedAt = 0, start = t0;
  let notesSize = 1.15;
  const mediaUrl = (id) => media.url(id);
  const box = (sel) => $(sel);
  function thumb(host, sid, width, height) {
    if (!sid) { host.innerHTML = `<div style="color:#888;padding:20px">End of presentation</div>`; host.style.width = `${width}px`; return; }
    const el = renderSlide(model, sid, { mediaUrl, textHtml: fragmentHtml, doc });
    mountScaled(host, el, W, H, width, height);
    fitText(el);
  }
  function update() {
    const deck = show.deck;
    const i = show.index;
    const cur = deck[i];
    const curBox = box("[data-cur]"), nextBox = box("[data-next]");
    const cw = curBox.parentElement.clientWidth || 600;
    const ch = Math.max(120, (curBox.parentElement.clientHeight || 400) - 20);
    thumb(curBox, cur?.id, cw, ch);
    const moreSteps = show.stepsLeft() > 0;
    $("[data-next-label]").textContent = moreSteps ? `Next: ${show.stepsLeft()} more step${show.stepsLeft() === 1 ? "" : "s"} on this slide` : "Next slide";
    thumb(nextBox, moreSteps ? cur?.id : deck[i + 1]?.id, Math.min(nextBox.parentElement.clientWidth || 320, 420));
    const nf = cur && model.notes(cur.id);
    const html = nf ? fragmentHtml(nf) : "";
    $("[data-notes]").innerHTML = html || `<p style="color:#888">No speaker notes.</p>`;
    $("[data-notes]").style.setProperty("--pv-notes", `${notesSize}rem`);
    $("[data-pv-count]").textContent = show.ended ? "End" : `Slide ${i + 1} of ${deck.length}`;
  }
  const tick = () => {
    const ms = (pausedAt || Date.now()) - start - paused;
    const s = Math.max(0, Math.floor(ms / 1000));
    $("[data-timer]").textContent = `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ""}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
    $("[data-clock]").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };
  const timer = (win || window).setInterval(tick, 500);
  tick();
  doc.addEventListener("click", (e) => {
    const a = e.target.closest("[data-pv-act]")?.dataset.pvAct;
    if (a === "next") show.next();
    if (a === "prev") show.prev();
    if (a === "pause") { if (pausedAt) { paused += Date.now() - pausedAt; pausedAt = 0; e.target.textContent = "Pause"; } else { pausedAt = Date.now(); e.target.textContent = "Resume"; } }
    if (a === "reset") { start = Date.now(); paused = 0; pausedAt = pausedAt ? Date.now() : 0; tick(); }
    if (a === "bigger") { notesSize = Math.min(3, notesSize + 0.15); update(); }
    if (a === "smaller") { notesSize = Math.max(0.8, notesSize - 0.15); update(); }
    if (a === "end") (onEnd || (() => win?.opener?.document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))))();
  });
  doc.addEventListener("keydown", (e) => {
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); show.next(); }
    if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); show.prev(); }
  });
  win?.addEventListener("resize", update);
  win?.addEventListener("beforeunload", () => { (win || window).clearInterval(timer); onClose?.(); });
  update();
  return {
    update,
    focus: () => win?.focus(),
    close() { (win || window).clearInterval(timer); closeWin?.(); },
  };
}

// ---- previewing a transition or the animations on the editor's stage ---------------------------------
export async function previewOnStage({ root, model, sid, media, transitionOnly = false }) {
  const stage = root.querySelector("[data-stage]");
  if (!stage) return;
  const r = stage.getBoundingClientRect();
  const host = document.createElement("div");
  host.className = "sl-show-frame";
  host.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:2400;background:#000;overflow:hidden`;
  document.body.appendChild(host);
  const [W, H] = model.size();
  const s = r.width / W;
  const mk = (id) => { const el = renderSlide(model, id, { mediaUrl: (m) => media.url(m), textHtml: fragmentHtml }); el.style.transform = `scale(${s})`; el.style.transformOrigin = "0 0"; return el; };
  const ids = model.slideIds();
  const prevId = ids[ids.indexOf(sid) - 1];
  let old = null;
  if (prevId) { old = mk(prevId); host.appendChild(old); fitText(old); }
  const el = mk(sid);
  const anims = model.anims(sid);
  if (!transitionOnly) prepareSlide(el, anims);
  host.appendChild(el);
  fitText(el);
  await runTransition(old, el, model.slide(sid)?.transition || { kind: "dissolve", ms: 300 }, { w: r.width, h: r.height });
  old?.remove();
  if (!transitionOnly) {
    const { steps } = buildSteps(anims);
    for (const st of steps) { await playStep(el, st).done; await new Promise((res) => setTimeout(res, 350)); }
  }
  await new Promise((res) => setTimeout(res, 500));
  host.remove();
}

void esc;
