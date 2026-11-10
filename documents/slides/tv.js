// The TV side of presenting from the iPhone (slides-tv.html, SLIDES_DESIGN.md §9). Runs
// in the second web view the PresentScreen plugin puts on the TV. It holds a copy of the
// presentation (sent by the phone), draws it full screen and follows the phone's show.

import "./slides.css";
import * as Y from "yjs";
import { createSlidesModel } from "./model.js";
import { createShow } from "./present.js";
import { sniffType } from "./media.js";
import { decode, encode, fromB64, chunkJoiner } from "./tv-protocol.js";

export function startTv({ post = (s) => window.webkit?.messageHandlers?.tv?.postMessage(s), doc = document } = {}) {
  doc.body.style.cssText = "margin:0;background:#000;overflow:hidden";
  const root = doc.createElement("div");
  root.className = "sl-show";
  root.style.cursor = "none";
  root.innerHTML = `<div class="sl-show-frame" data-frame></div><div class="sl-show-black" data-black hidden></div>`;
  doc.body.appendChild(root);
  const frame = root.querySelector("[data-frame]");
  const size = () => { frame.style.width = `${window.innerWidth}px`; frame.style.height = `${window.innerHeight}px`; };
  size();

  const ydoc = new Y.Doc();
  const model = createSlidesModel(ydoc);
  const urls = new Map();
  const asked = new Set();
  const media = {
    url(id) {
      if (!id) return null;
      if (urls.has(id)) return urls.get(id);
      if (!asked.has(id) && /^[0-9a-f]{32}$/.test(id)) { asked.add(id); post(encode({ t: "need", id })); }
      return null;
    },
  };
  const joiner = chunkJoiner();
  let show = null;
  let at = { idx: 0, step: 0 };
  const send = () => post(encode({ t: "state", idx: show?.index ?? 0, step: show?.step ?? 0 }));

  // Follows the phone by slide id (the index can differ for a moment while an edit
  // reaches both); never loops past the steps a slide has.
  async function follow(slideId, idx0, step) {
    if (!show) return;
    show.refresh();
    const found = slideId ? show.indexOf(slideId) : -1;
    const idx = found >= 0 ? found : Math.min(idx0, show.deck.length - 1);
    step = Math.min(step, show.totalSteps(idx) - 1);
    if (idx === show.index && step === show.step + 1) await show.next();
    else if (idx === show.index + 1 && step === 0 && show.step === show.totalSteps(show.index) - 1) await show.next();
    else if (idx === show.index && step === show.step - 1) await show.prev();
    else if (idx !== show.index || step !== show.step) {
      await show.go(idx);
      for (let k = 0; k < 50 && show.index === idx && show.step < step; k++) await show.next();
    }
  }

  window.__tv = async (s) => {
    const m = decode(s);
    if (!m) return;
    if (m.t === "doc" || m.t === "upd") {
      Y.applyUpdate(ydoc, fromB64(m.u), "phone");
      if (m.t === "doc" && !show) {
        show = createShow({ model, media, frame, onChange: send, doc });
        const f = show.indexOf(at.slide);
        await show.start(f >= 0 ? f : at.idx);
        await follow(at.slide, at.idx, at.step);
      }
      return;
    }
    if (m.t === "media") {
      const done = joiner.add(m);
      if (done) {
        urls.set(done.id, URL.createObjectURL(new Blob([done.bytes], { type: sniffType(done.bytes) })));
        if (show) { const idx = show.index, st = show.step; await show.go(idx); for (let k = 0; k < 50 && show.index === idx && show.step < st; k++) await show.next(); }
      }
      return;
    }
    if (m.t === "show") {
      at = { slide: typeof m.slide === "string" ? m.slide.slice(0, 40) : null, idx: Math.max(0, Number(m.idx) || 0), step: Math.max(0, Number(m.step) || 0) };
      const black = root.querySelector("[data-black]");
      black.hidden = !m.black;
      black.style.background = m.black === "white" ? "#fff" : "#000";
      if (m.ended) { frame.style.visibility = "hidden"; return; }
      frame.style.visibility = "";
      await follow(at.slide, at.idx, at.step);
    }
  };
  window.addEventListener("resize", () => { size(); show?.relayout(); });
  post(encode({ t: "ready" }));
  return { model, get show() { return show; } };
}
