// The phone as a remote (SLIDES_DESIGN.md §9). While a presentation is playing on one
// device (the laptop), opening it on another (the phone) offers "Control the
// presentation". The phone then shows the current slide's notes, the timer and big
// Back / Next buttons; the laptop follows. It rides the live channel the editors
// already use, only while both are in the presentation: presence carries where the show
// is, and the remote's counts of Next and Back presses (counts, not single commands, so
// quick taps add up even when presence is sent a few times a second). Nothing is stored.

import { renderSlide, mountScaled, fitText } from "./render.js";
import { fragmentHtml } from "./text.js";
import { esc } from "./chrome.js";

// Shows who is presenting, from presence: [{ cid, name, slide, step, n, of }]
export function presentersIn(awareness) {
  const out = [];
  for (const [cid, a] of awareness.getStates()) {
    if (cid === awareness.clientID || !a?.show || a.show.ended === undefined) continue;
    if (!a.show.slide) continue;
    out.push({ cid, name: String(a.user?.name || "Someone").slice(0, 60), ...a.show });
  }
  return out;
}

// On the presenting side: turns a remote's counts into Next / Back presses.
export function remoteFollower(awareness, { next, prev, go, black, end }) {
  const seen = new Map(); // remote cid → { next, prev, go, black, end }
  return function onChange() {
    for (const [cid, a] of awareness.getStates()) {
      const r = a?.remote;
      if (cid === awareness.clientID || !r || r.to !== awareness.clientID) continue;
      const last = seen.get(cid);
      if (!last) { seen.set(cid, { ...r }); continue; } // the first sight sets the baseline
      const dn = Math.max(0, Math.min(20, (r.next | 0) - (last.next | 0)));
      const dp = Math.max(0, Math.min(20, (r.prev | 0) - (last.prev | 0)));
      for (let i = 0; i < dn; i++) next();
      for (let i = 0; i < dp; i++) prev();
      if ((r.go | 0) !== (last.go | 0) && Number.isInteger(r.goTo)) go(r.goTo);
      if ((r.black | 0) !== (last.black | 0)) black();
      if ((r.end | 0) !== (last.end | 0)) end();
      seen.set(cid, { ...r });
    }
  };
}

// The remote screen, on the phone.
export function openRemote({ host, model, media, awareness, target, onClose }) {
  const counts = { next: 0, prev: 0, go: 0, black: 0, end: 0, goTo: 0 };
  const t0 = Date.now();
  const el = document.createElement("div");
  el.className = "sl-remote";
  el.innerHTML = `<div class="sl-pv-top"><strong data-timer>0:00</strong><span class="sl-pv-spacer"></span><span data-count></span><button type="button" data-r="close">Done</button></div>
    <div class="sl-pv-cur"><div data-cur></div></div>
    <div class="sl-pv-notes" data-notes></div>
    <div class="sl-pv-ctrl"><button type="button" data-r="black" aria-label="Black screen">●</button><button type="button" data-r="prev">◀ Back</button><button type="button" class="sl-pv-big" data-r="next">Next ▶</button></div>`;
  host.appendChild(el);
  const [W, H] = model.size();
  const send = () => awareness.setLocalStateField("remote", { to: target, ...counts, seq: Date.now() });
  send();
  let shownSlide = null;
  function draw() {
    const st = awareness.getStates().get(target)?.show;
    if (!st) { el.querySelector("[data-count]").textContent = "The presentation has ended."; return; }
    el.querySelector("[data-count]").textContent = st.ended ? "End" : `Slide ${(st.n | 0) + 1} of ${st.of | 0}`;
    if (st.slide !== shownSlide && model.slide(st.slide)) {
      shownSlide = st.slide;
      const box = el.querySelector("[data-cur]");
      const s = renderSlide(model, st.slide, { mediaUrl: (id) => media.url(id), textHtml: fragmentHtml });
      mountScaled(box, s, W, H, Math.min(window.innerWidth - 28, 520));
      fitText(s);
      const nf = model.notes(st.slide);
      el.querySelector("[data-notes]").innerHTML = (nf && fragmentHtml(nf)) || `<p style="color:#888">No speaker notes.</p>`;
    }
  }
  const tick = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    el.querySelector("[data-timer]").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 500);
  const onAw = () => draw();
  awareness.on("change", onAw);
  draw();
  el.addEventListener("click", (e) => {
    const r = e.target.closest("[data-r]")?.dataset.r;
    if (!r) return;
    if (r === "close") { close(); return; }
    counts[r]++;
    send();
    if (navigator.vibrate) navigator.vibrate(10);
  });
  // swipes too
  let sx = 0;
  el.addEventListener("pointerdown", (e) => { sx = e.clientX; });
  el.addEventListener("pointerup", (e) => {
    const dx = e.clientX - sx;
    if (Math.abs(dx) > 60 && !e.target.closest("button")) { counts[dx < 0 ? "next" : "prev"]++; send(); }
  });
  function close() {
    clearInterval(tick);
    awareness.off("change", onAw);
    awareness.setLocalStateField("remote", null);
    el.remove();
    onClose?.();
  }
  return { close };
}

void esc;
