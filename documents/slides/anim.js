// Transitions and animations (SLIDES_DESIGN.md §5), drawn with the Web Animations API
// (smooth on the iPhone, no library). Pure planning (buildSteps) is separate from
// playing, so it can be tested without a browser.

export const ENTRANCE = new Set(["appear", "fade-in", "fly-in", "zoom-in"]);
export const EXIT = new Set(["disappear", "fade-out", "fly-out", "zoom-out"]);

// A slide's animations as click steps: steps[0] runs by itself when the slide appears
// (animations before the first "on click"); each later step is one click. Within a
// step, "with previous" starts alongside, "after previous" starts when the one before
// ends. → { steps: [[{ anim, at }]], hidden: Set<itemId> (start hidden) }
export function buildSteps(anims) {
  const steps = [[]];
  let t = 0, lastStart = 0, lastEnd = 0;
  for (const a of anims) {
    if (a.start === "click") { steps.push([]); t = 0; lastStart = 0; lastEnd = 0; }
    const step = steps[steps.length - 1];
    const begin = !step.length ? 0 : a.start === "with" ? lastStart : lastEnd;
    const at = begin + (a.delay || 0);
    step.push({ anim: a, at });
    lastStart = at;
    lastEnd = at + (a.ms || 0);
    t = Math.max(t, lastEnd);
  }
  const hidden = new Set();
  // an item whose first animation is an entrance starts hidden
  const seen = new Set();
  for (const a of anims) {
    if (seen.has(a.item)) continue;
    seen.add(a.item);
    if (ENTRANCE.has(a.effect) && !a.byPara) hidden.add(a.item);
  }
  return { steps, hidden };
}
export const stepDuration = (step) => step.reduce((m, s) => Math.max(m, s.at + (s.anim.ms || 0)), 0);

const fly = (dir, d = 1) => {
  const v = { left: "translateX(-300vw)", right: "translateX(300vw)", top: "translateY(-300vh)", bottom: "translateY(300vh)" }[dir] || "translateX(-300vw)";
  return d > 0 ? v : v;
};

// Keyframes for an effect on an element whose resting transform is `base`.
export function effectFrames(effect, dir, base = "") {
  const b = base || "";
  switch (effect) {
    case "appear": return [{ visibility: "hidden", offset: 0 }, { visibility: "visible", offset: 0.01 }, { visibility: "visible" }];
    case "disappear": return [{ visibility: "visible", offset: 0 }, { visibility: "hidden", offset: 0.99 }, { visibility: "hidden" }];
    case "fade-in": return [{ opacity: 0, visibility: "visible" }, { opacity: 1, visibility: "visible" }];
    case "fade-out": return [{ opacity: 1 }, { opacity: 0 }];
    case "fly-in": return [{ transform: `${fly(dir)} ${b}`, visibility: "visible" }, { transform: `${b}`, visibility: "visible" }];
    case "fly-out": return [{ transform: `${b}` }, { transform: `${fly(dir)} ${b}` }];
    case "zoom-in": return [{ transform: `${b} scale(0.05)`, opacity: 0, visibility: "visible" }, { transform: `${b} scale(1)`, opacity: 1, visibility: "visible" }];
    case "zoom-out": return [{ transform: `${b} scale(1)`, opacity: 1 }, { transform: `${b} scale(0.05)`, opacity: 0 }];
    case "spin": return [{ transform: `${b} rotate(0deg)` }, { transform: `${b} rotate(360deg)` }];
    case "grow": return [{ transform: `${b} scale(1)` }, { transform: `${b} scale(1.25)` }];
    case "shrink": return [{ transform: `${b} scale(1)` }, { transform: `${b} scale(0.8)` }];
    default: return [{}, {}];
  }
}
const finalStyle = (effect) => (EXIT.has(effect) ? { visibility: "hidden" } : ENTRANCE.has(effect) ? { visibility: "visible", opacity: "" } : null);

// The parts an animation moves: the item, or (one paragraph at a time) its paragraphs.
function targetsFor(slideEl, a) {
  const el = slideEl.querySelector(`[data-item="${CSS.escape(a.item)}"]`);
  if (!el) return [];
  if (a.byPara) {
    const t = el.querySelector(".sl-text");
    const paras = t ? [...t.querySelectorAll(":scope > p, :scope > ul > li, :scope > ol > li, :scope > h1, :scope > h2, :scope > h3")] : [];
    if (paras.length) return paras;
  }
  return [el];
}

// Hides what starts hidden (call after the slide is drawn).
export function prepareSlide(slideEl, anims) {
  const { hidden } = buildSteps(anims);
  for (const id of hidden) { const el = slideEl.querySelector(`[data-item="${CSS.escape(id)}"]`); if (el) el.style.visibility = "hidden"; }
  for (const a of anims) {
    if (!a.byPara || !ENTRANCE.has(a.effect)) continue;
    for (const p of targetsFor(slideEl, a)) p.style.visibility = "hidden";
  }
}

// Plays one step; resolves when it ends. instant: jump straight to the end state.
export function playStep(slideEl, step, { instant = false } = {}) {
  const running = [];
  for (const { anim: a, at } of step) {
    const targets = targetsFor(slideEl, a);
    targets.forEach((el, i) => {
      const base = el.classList.contains("sl-item") ? (el.style.transform || "") : "";
      const delay = at + (a.byPara ? i * a.ms : 0);
      if (instant || !el.animate) { Object.assign(el.style, finalStyle(a.effect) || {}); return; }
      const anim = el.animate(effectFrames(a.effect, a.dir, base), { duration: a.ms, delay, easing: a.effect === "appear" || a.effect === "disappear" ? "step-end" : "cubic-bezier(.2,.7,.2,1)", fill: "both" });
      running.push(anim.finished.then(() => {
        const f = finalStyle(a.effect);
        if (f) Object.assign(el.style, f);
        anim.commitStyles?.();
        anim.cancel();
      }).catch(() => {}));
    });
  }
  const longest = step.reduce((m, x) => Math.max(m, x.at + (x.anim.ms || 0) * (x.anim.byPara ? 20 : 1)), 0);
  return { done: Promise.race([Promise.all(running), new Promise((r) => setTimeout(r, longest + 300))]), cancel: () => {} };
}

// ---- transitions ----------------------------------------------------------------------------
// Runs a transition between two slide elements already placed in the same frame (the new
// one on top). Resolves when done. w, h: the frame's size in screen px.
export function runTransition(oldEl, newEl, tr, { w, h, back = false } = {}) {
  if (!tr || tr.kind === "none" || !newEl.animate) return Promise.resolve();
  const ms = tr.ms || 500;
  const ease = "cubic-bezier(.4,0,.2,1)";
  const opts = { duration: ms, easing: ease, fill: "both" };
  const baseNew = newEl.style.transform || "";
  const baseOld = oldEl?.style.transform || "";
  let dir = tr.dir || "right";
  if (back) dir = { left: "right", right: "left", top: "bottom", bottom: "top" }[dir];
  const off = (d, k = 1) => ({ right: `translateX(${w * k}px)`, left: `translateX(${-w * k}px)`, bottom: `translateY(${h * k}px)`, top: `translateY(${-h * k}px)` }[d]);
  const anims = [];
  const frame = newEl.parentElement;
  switch (tr.kind) {
    case "dissolve":
      anims.push(newEl.animate([{ opacity: 0 }, { opacity: 1 }], opts));
      break;
    case "fade":
      if (oldEl) anims.push(oldEl.animate([{ opacity: 1 }, { opacity: 0 }], { ...opts, duration: ms / 2 }));
      anims.push(newEl.animate([{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], opts));
      break;
    case "slide":
      anims.push(newEl.animate([{ transform: `${off(dir)} ${baseNew}` }, { transform: baseNew || "none" }], opts));
      break;
    case "gallery":
      anims.push(newEl.animate([{ transform: `${off(dir)} ${baseNew}` }, { transform: baseNew || "none" }], opts));
      if (oldEl) anims.push(oldEl.animate([{ transform: baseOld || "none" }, { transform: `${off({ right: "left", left: "right", top: "bottom", bottom: "top" }[dir])} ${baseOld}` }], opts));
      break;
    case "zoom":
      anims.push(newEl.animate([{ transform: `${baseNew} scale(0.6)`, opacity: 0, transformOrigin: "0 0" }, { transform: `${baseNew} scale(1)`, opacity: 1 }], opts));
      break;
    case "flip": {
      if (frame) frame.style.perspective = `${w * 2}px`;
      const axis = dir === "top" || dir === "bottom" ? "X" : "Y";
      const sgn = dir === "left" || dir === "top" ? -1 : 1;
      if (oldEl) anims.push(oldEl.animate([{ transform: `translate(${w / 2}px, ${h / 2}px) rotate${axis}(0deg) translate(${-w / 2}px, ${-h / 2}px) ${baseOld}`, backfaceVisibility: "hidden" }, { transform: `translate(${w / 2}px, ${h / 2}px) rotate${axis}(${-90 * sgn}deg) translate(${-w / 2}px, ${-h / 2}px) ${baseOld}`, backfaceVisibility: "hidden" }], { ...opts, duration: ms / 2 }));
      anims.push(newEl.animate([{ transform: `translate(${w / 2}px, ${h / 2}px) rotate${axis}(${90 * sgn}deg) translate(${-w / 2}px, ${-h / 2}px) ${baseNew}`, offset: 0 }, { transform: `translate(${w / 2}px, ${h / 2}px) rotate${axis}(${90 * sgn}deg) translate(${-w / 2}px, ${-h / 2}px) ${baseNew}`, offset: 0.5 }, { transform: `translate(${w / 2}px, ${h / 2}px) rotate${axis}(0deg) translate(${-w / 2}px, ${-h / 2}px) ${baseNew}` }], opts));
      break;
    }
    case "cube": {
      if (frame) frame.style.perspective = `${w * 2.5}px`;
      const horiz = dir === "left" || dir === "right";
      const sgn = dir === "right" || dir === "bottom" ? 1 : -1;
      const depth = (horiz ? w : h) / 2;
      const rot = (deg) => (horiz ? `rotateY(${deg}deg)` : `rotateX(${-deg}deg)`);
      const T = (deg, base) => `translate(${w / 2}px, ${h / 2}px) translateZ(${-depth}px) ${rot(deg)} translateZ(${depth}px) translate(${-w / 2}px, ${-h / 2}px) ${base}`;
      if (oldEl) anims.push(oldEl.animate([{ transform: T(0, baseOld) }, { transform: T(-90 * sgn, baseOld) }], opts));
      anims.push(newEl.animate([{ transform: T(90 * sgn, baseNew) }, { transform: T(0, baseNew) }], opts));
      break;
    }
    default: break;
  }
  // a hidden tab pauses animations; never let a transition hold the show up
  const done = Promise.race([Promise.all(anims.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, ms + 250))]);
  return done.then(() => { for (const a of anims) a.cancel(); if (frame) frame.style.perspective = ""; });
}
