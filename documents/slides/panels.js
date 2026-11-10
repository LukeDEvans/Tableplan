// Side panels (SLIDES_DESIGN.md §4, §5, §7, §11): Format options, Theme, Layout,
// Background, Transition, Animate, Comments, Versions and (phone) Speaker notes. On the
// laptop they open on the right; on the phone as a sheet from the bottom.

import * as Y from "yjs";
import { THEMES, LAYOUTS, ROLES, ROLE_LABELS, themeById, cleanTheme, resolveColor, backgroundCss, decoSvg, sizeOf } from "./themes.js";
import { SHAPES, ARROWS } from "./shapes.js";
import { TRANSITIONS, EFFECTS, DIRS, STARTS, createSlidesModel } from "./model.js";
import { FONTS, fontStack } from "../editor/fonts.js";
import { addThread, replyTo, setResolved, listThreads, deleteReply, mentionsIn, docFromContent } from "../editor/doc-model.js";
import { colorFor } from "../editor/live.js";
import { timeAgo, promptText, openDialog } from "../editor/panels.js";
import { IC } from "../editor/icons.js";
import { colorPicker, esc } from "./chrome.js";
import { renderSlide, mountScaled, fitText } from "./render.js";
import { fragmentHtml } from "./text.js";

const TITLES = { format: "Format options", theme: "Themes", layout: "Layout", background: "Background", transition: "Transition", animate: "Animations", comments: "Comments", versions: "Version history", notes: "Speaker notes" };
const EFFECT_LABELS = { appear: "Appear", disappear: "Disappear", "fade-in": "Fade in", "fade-out": "Fade out", "fly-in": "Fly in", "fly-out": "Fly out", "zoom-in": "Zoom in", "zoom-out": "Zoom out", spin: "Spin", grow: "Grow", shrink: "Shrink" };
const TRANSITION_LABELS = { none: "None", dissolve: "Dissolve", fade: "Fade", slide: "Slide", flip: "Flip", cube: "Cube", gallery: "Gallery", zoom: "Zoom" };
const START_LABELS = { click: "On click", with: "With previous", after: "After previous" };
const DIR_LABELS = { left: "From left", right: "From right", top: "From top", bottom: "From bottom" };
const opts = (list, cur, labels = {}) => list.map((v) => `<option value="${esc(v)}"${String(cur) === String(v) ? " selected" : ""}>${esc(labels[v] ?? v)}</option>`).join("");

export function createPanels({ box, sheet, root, app }) {
  let open = null;      // panel name
  let previewing = null;

  function shell() {
    const phone = app.phone();
    const host = phone ? sheet : box;
    (phone ? box : sheet).hidden = true;
    host.hidden = !open;
    if (!open) return null;
    if (!host.querySelector("[data-pbody]") || host.dataset.panel !== open) {
      host.dataset.panel = open;
      host.innerHTML = `<header class="sl-panel-head"><h3>${esc(TITLES[open] || "")}</h3><button type="button" class="sl-icon" data-pact="close" aria-label="Close">${IC.close}</button></header><div class="sl-panel-body" data-pbody></div>`;
    }
    return host.querySelector("[data-pbody]");
  }

  function openPanel(name) {
    if (open === name && !app.phone()) { closePanel(); return; }
    open = name;
    draw();
    app.onOpen?.();
  }
  function closePanel() {
    open = null;
    stopPreview();
    box.hidden = true; sheet.hidden = true;
    box.innerHTML = ""; sheet.innerHTML = "";
    app.onClose?.();
  }

  function refresh({ soft = false } = {}) {
    if (!open) return;
    // don't redraw under someone's typing in the panel
    const host = app.phone() ? sheet : box;
    if (soft && host.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    draw();
  }

  function draw() {
    const body = shell();
    if (!body) return;
    const fn = { format, theme, layout, background, transition, animate, comments, versions, notes }[open];
    fn?.(body);
  }

  // ---- Format options ------------------------------------------------------------------------
  function format(body) {
    const list = app.selItems();
    if (!list.length) { body.innerHTML = `<p class="sl-muted">Select something on the slide to format it.</p>`; return; }
    const it = list[0];
    const one = list.length === 1;
    const num = (k, label, v, { min = -10000, max = 10000, step = 1 } = {}) => `<label>${esc(label)}<input type="number" data-f="${k}" value="${Math.round(Number(v) * 10) / 10}" min="${min}" max="${max}" step="${step}"></label>`;
    const sw = (k, label, c) => `<button type="button" class="sl-colorbtn" data-pact="color" data-k="${k}"><span class="sl-chip" style="background:${resolveColor(c, app.model.theme()) || "transparent"}"></span>${esc(label)}</button>`;
    let html = "";
    if (one) {
      html += `<details open><summary>Size and rotation</summary><div class="sl-grid2">${num("w", "Width", it.w, { min: 1 })}${num("h", "Height", it.h, { min: 1 })}${num("x", "X", it.x)}${num("y", "Y", it.y)}${num("rot", "Rotation°", it.rot || 0, { min: 0, max: 359 })}</div>
        <div class="sl-row"><button type="button" class="sl-btn" data-pact="flip" data-k="h">Flip horizontally</button><button type="button" class="sl-btn" data-pact="flip" data-k="v">Flip vertically</button></div></details>`;
    }
    if (it.t === "text" || it.t === "shape" || it.t === "table") {
      html += `<details open><summary>Text</summary>
        <div class="sl-grid2"><label>Inset (px)<input type="number" data-f="pad" value="${it.pad ?? 12}" min="0" max="200"></label>
        <label>Vertical align<select data-f="valign">${opts(["top", "middle", "bottom"], it.valign || "top", { top: "Top", middle: "Middle", bottom: "Bottom" })}</select></label></div>
        <label class="sl-check"><input type="checkbox" data-f="autofit"${it.autofit === "shrink" ? " checked" : ""}> Shrink text on overflow</label></details>`;
    }
    if (it.t === "shape" || it.t === "text" || it.t === "table") {
      html += `<details open><summary>Fill and border</summary><div class="sl-row">${sw("fill", "Fill", it.fill ?? (it.t === "shape" ? "@a1" : null))}${sw("stroke", "Border", it.stroke)}</div>
        <div class="sl-grid2"><label>Border weight<input type="number" data-f="sw" value="${it.sw ?? 0}" min="0" max="60"></label><label>Dash<select data-f="dash">${opts(["", "dot", "dash", "long-dash", "dash-dot"], it.dash || "", { "": "Solid", dot: "Dotted", dash: "Dashed", "long-dash": "Long dash", "dash-dot": "Dash dot" })}</select></label></div>
        ${it.t === "shape" ? `<label>Shape<select data-f="shape">${Object.values(SHAPES).map((s) => `<option value="${s.id}"${s.id === it.shape ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>${SHAPES[it.shape]?.k !== undefined ? `<label>Adjust<input type="range" data-f="radius" min="0" max="0.5" step="0.01" value="${it.radius ?? SHAPES[it.shape].k}"></label>` : ""}` : ""}
        <label>Transparency<input type="range" data-f="opacity" min="0" max="1" step="0.05" value="${1 - (it.opacity ?? 1)}" data-invert></label>
        <label class="sl-check"><input type="checkbox" data-f="shadow"${it.shadow ? " checked" : ""}> Drop shadow</label></details>`;
    }
    if (it.t === "line") {
      html += `<details open><summary>Line</summary><div class="sl-row">${sw("stroke", "Colour", it.stroke || "@dk1")}</div>
        <div class="sl-grid2"><label>Weight<input type="number" data-f="sw" value="${it.sw ?? 3}" min="1" max="60"></label><label>Dash<select data-f="dash">${opts(["", "dot", "dash", "long-dash", "dash-dot"], it.dash || "", { "": "Solid", dot: "Dotted", dash: "Dashed", "long-dash": "Long dash", "dash-dot": "Dash dot" })}</select></label>
        <label>Start<select data-f="a1">${opts(ARROWS, it.a1 || "none", { none: "None", arrow: "Arrow", open: "Open arrow", circle: "Circle", diamond: "Diamond", bar: "Bar" })}</select></label><label>End<select data-f="a2">${opts(ARROWS, it.a2 || "none", { none: "None", arrow: "Arrow", open: "Open arrow", circle: "Circle", diamond: "Diamond", bar: "Bar" })}</select></label>
        <label>Kind<select data-f="kind">${opts(["straight", "elbow", "curve"], it.kind || "straight", { straight: "Straight", elbow: "Elbow", curve: "Curved" })}</select></label></div></details>`;
    }
    if (it.t === "image" && one) {
      const c = it.crop || {};
      const pct = (k) => Math.round((c[k] || 0) * 100);
      html += `<details open><summary>Crop and mask</summary><div class="sl-grid2">${["l", "r", "t", "b"].map((k) => `<label>${{ l: "Left", r: "Right", t: "Top", b: "Bottom" }[k]} %<input type="range" data-crop="${k}" min="0" max="45" value="${pct(k)}"></label>`).join("")}</div>
        <label>Mask<select data-f="mask"><option value="">None</option>${["ellipse", "round-rect", "triangle", "diamond", "hexagon", "heart", "star5", "callout-round"].map((s) => `<option value="${s}"${it.mask === s ? " selected" : ""}>${esc(SHAPES[s].name)}</option>`).join("")}</select></label>
        <div class="sl-row"><button type="button" class="sl-btn" data-pact="crop-reset">Reset crop</button><button type="button" class="sl-btn" data-pact="replace-image">Replace image</button></div></details>
        <details open><summary>Adjust</summary><label>Recolour<select data-f="recolor">${opts(["", "gray", "sepia", "dim"], it.recolor || "", { "": "None", gray: "Greyscale", sepia: "Sepia", dim: "Darker" })}</select></label>
        <label>Transparency<input type="range" data-f="opacity" min="0" max="1" step="0.05" value="${1 - (it.opacity ?? 1)}" data-invert></label>
        <div class="sl-row">${sw("stroke", "Border", it.stroke)}</div>
        <label>Alt text (read aloud by screen readers)<textarea data-f="alt" rows="2" maxlength="1000">${esc(it.alt || "")}</textarea></label></details>`;
    }
    if ((it.t === "video" || it.t === "audio") && one) {
      html += `<details open><summary>${it.t === "video" ? "Video" : "Audio"} playback</summary>
        <div class="sl-grid2"><label>Start at (seconds)<input type="number" data-f="start" min="0" step="1" value="${it.start || 0}"></label><label>End at (seconds, 0 = the end)<input type="number" data-f="end" min="0" step="1" value="${it.end || 0}"></label></div>
        <label>Play<select data-f="play">${opts(["click", "auto", "manual"], it.play || "click", { click: "On click", auto: "Automatically", manual: "Only with the controls" })}</select></label>
        <label class="sl-check"><input type="checkbox" data-f="mute"${it.mute ? " checked" : ""}> Mute</label>
        <label class="sl-check"><input type="checkbox" data-f="loop"${it.loop ? " checked" : ""}> Loop</label>
        ${it.t === "audio" ? `<label class="sl-check"><input type="checkbox" data-f="acrossSlides"${it.acrossSlides ? " checked" : ""}> Keep playing on the next slides</label>` : ""}</details>`;
    }
    body.innerHTML = html;
  }

  // ---- Theme ---------------------------------------------------------------------------------
  function themePreview(th, W = 160, H = 90) {
    const t = cleanTheme(th);
    return `<div class="sl-theme-prev" style="${esc(`background:${backgroundCss(null, t)};font-family:${fontStack(t.fonts.heading)}`)}"><svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" aria-hidden="true">${decoSvg(t, W, H)}</svg><span style="color:${t.colors.dk1}">${esc(t.name)}</span><i style="background:${t.colors.a1}"></i><i style="background:${t.colors.a2}"></i><i style="background:${t.colors.a3}"></i></div>`;
  }
  function theme(body) {
    const cur = app.model.theme();
    const card = (th) => `<button type="button" class="sl-theme-card${th.id === cur.id ? " is-on" : ""}" data-pact="theme" data-k="${th.id}" aria-label="${esc(th.name)}">${themePreview(th)}</button>`;
    body.innerHTML = `<div class="sl-pop-label">Live's colours</div><div class="sl-theme-grid">${THEMES.filter((t) => t.app).map(card).join("")}</div>
      <div class="sl-pop-label">Themes</div><div class="sl-theme-grid">${THEMES.filter((t) => !t.app).map(card).join("")}</div>
      <details><summary>Customise this presentation's theme</summary>
        <div class="sl-role-grid">${ROLES.map((r) => `<button type="button" class="sl-colorbtn" data-pact="role" data-k="${r}"><span class="sl-chip" style="background:${cur.colors[r]}"></span>${esc(ROLE_LABELS[r])}</button>`).join("")}</div>
        <div class="sl-grid2"><label>Heading font<select data-theme-font="heading">${FONTS.map((f) => `<option${f.name === cur.fonts.heading ? " selected" : ""}>${esc(f.name)}</option>`).join("")}</select></label>
        <label>Body font<select data-theme-font="body">${FONTS.map((f) => `<option${f.name === cur.fonts.body ? " selected" : ""}>${esc(f.name)}</option>`).join("")}</select></label></div>
        <button type="button" class="sl-btn" data-pact="theme-reset">Back to ${esc(themeById(cur.id).name)}'s own colours</button>
      </details>`;
  }

  // ---- Layout --------------------------------------------------------------------------------
  function layout(body) {
    const cur = app.model.slide(app.slide)?.layout;
    const [W, H] = app.model.size();
    body.innerHTML = `<div class="sl-layout-grid">${LAYOUTS.map((L) => `<button type="button" class="sl-layout-card${L.id === cur ? " is-on" : ""}" data-pact="layout" data-k="${L.id}">
      <svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><rect width="${W}" height="${H}" fill="var(--surface)" stroke="var(--line)" stroke-width="8"/>${L.ph.map((p) => `<rect x="${p.box[0] * W}" y="${p.box[1] * H}" width="${p.box[2] * W}" height="${p.box[3] * H}" rx="12" fill="color-mix(in srgb, var(--accent) ${p.role === "title" || p.role === "number" ? 30 : 14}%, transparent)"/>`).join("")}</svg>
      <span>${esc(L.name)}</span></button>`).join("")}</div>
      <p class="sl-muted">Applies to the selected slides. Text you've typed in a placeholder moves with it.</p>`;
  }

  // ---- Background ----------------------------------------------------------------------------
  function background(body) {
    const s = app.model.slide(app.slide);
    const bg = s?.bg;
    const th = app.model.theme();
    const kind = bg?.kind || "theme";
    body.innerHTML = `<label>Background<select data-bg="kind">${opts(["theme", "solid", "gradient", "image"], kind, { theme: "The theme's", solid: "Colour", gradient: "Gradient", image: "Picture" })}</select></label>
      ${kind === "solid" ? `<button type="button" class="sl-colorbtn" data-pact="bg-color" data-k="color"><span class="sl-chip" style="background:${resolveColor(bg.color, th) || "#fff"}"></span>Colour</button>` : ""}
      ${kind === "gradient" ? `<div class="sl-row"><button type="button" class="sl-colorbtn" data-pact="bg-color" data-k="from"><span class="sl-chip" style="background:${resolveColor(bg.from?.[0] === "#" ? bg.from : `@${bg.from}`, th)}"></span>From</button><button type="button" class="sl-colorbtn" data-pact="bg-color" data-k="to"><span class="sl-chip" style="background:${resolveColor(bg.to?.[0] === "#" ? bg.to : `@${bg.to}`, th)}"></span>To</button></div><label>Angle<input type="range" data-bg="angle" min="0" max="360" step="5" value="${bg.angle || 0}"></label>` : ""}
      ${kind === "image" ? `<div class="sl-row"><button type="button" class="sl-btn" data-pact="bg-image">Choose a picture…</button></div><label>Fit<select data-bg="fit">${opts(["cover", "contain"], bg.fit || "cover", { cover: "Fill the slide", contain: "Fit inside" })}</select></label>` : ""}
      <div class="sl-row"><button type="button" class="sl-btn" data-pact="bg-all">Apply to all slides</button><button type="button" class="sl-btn" data-pact="bg-reset">Reset to theme</button></div>`;
  }

  // ---- Transition ----------------------------------------------------------------------------
  function transition(body) {
    const s = app.model.slide(app.slide);
    const tr = s?.transition || { kind: "none", dir: "right", ms: 500 };
    body.innerHTML = `<label>Transition<select data-tr="kind">${opts(TRANSITIONS, tr.kind, TRANSITION_LABELS)}</select></label>
      ${["slide", "gallery", "cube", "flip"].includes(tr.kind) ? `<label>Direction<select data-tr="dir">${opts(DIRS, tr.dir, DIR_LABELS)}</select></label>` : ""}
      ${tr.kind !== "none" ? `<label>Speed <small>${(tr.ms / 1000).toFixed(1)} s</small><input type="range" data-tr="ms" min="100" max="3000" step="100" value="${tr.ms}"></label>` : ""}
      <label>Move to the next slide by itself after (seconds, 0 = on click)<input type="number" data-tr="advance" min="0" max="3600" step="1" value="${s?.advance || 0}"></label>
      <div class="sl-row"><button type="button" class="sl-btn" data-pact="tr-all">Apply to all slides</button><button type="button" class="sl-btn" data-pact="tr-play">Play</button></div>`;
  }

  // ---- Animate -------------------------------------------------------------------------------
  function animate(body) {
    const list = app.model.anims(app.slide);
    const items = new Map(app.model.items(app.slide).map((it) => [it.id, it]));
    const label = (iid) => {
      const it = items.get(iid);
      if (!it) return "(removed)";
      const fr = app.model.text(app.slide, iid);
      const t = fr ? fr.toString().replace(/<[^>]*>/g, "").trim().slice(0, 30) : "";
      return t || it.name || { text: "Text box", shape: SHAPES[it.shape]?.name || "Shape", line: "Line", image: "Image", table: "Table", video: "Video", audio: "Audio" }[it.t] || "Item";
    };
    const sel = app.sel;
    body.innerHTML = `${sel.length ? `<button type="button" class="sl-btn sl-wide" data-pact="anim-add">+ Animate the selection</button>` : `<p class="sl-muted">Select something on the slide, then add an animation.</p>`}
      <ol class="sl-anims">${list.map((a, i) => `<li data-anim="${esc(a.id)}">
        <div class="sl-anim-head"><strong>${i + 1}. ${esc(label(a.item))}</strong>
          <button type="button" class="sl-icon" data-pact="anim-up" aria-label="Move up"${i ? "" : " disabled"}>↑</button>
          <button type="button" class="sl-icon" data-pact="anim-down" aria-label="Move down"${i < list.length - 1 ? "" : " disabled"}>↓</button>
          <button type="button" class="sl-icon" data-pact="anim-del" aria-label="Remove">${IC.trash}</button></div>
        <div class="sl-grid2"><label>Effect<select data-an="effect">${opts(EFFECTS, a.effect, EFFECT_LABELS)}</select></label>
          <label>Start<select data-an="start">${opts(STARTS, a.start, START_LABELS)}</select></label>
          ${["fly-in", "fly-out"].includes(a.effect) ? `<label>Direction<select data-an="dir">${opts(DIRS, a.dir, DIR_LABELS)}</select></label>` : ""}
          <label>Duration (s)<input type="number" data-an="ms" min="0.05" max="10" step="0.1" value="${a.ms / 1000}"></label>
          <label>Delay (s)<input type="number" data-an="delay" min="0" max="60" step="0.1" value="${a.delay / 1000}"></label></div>
        ${items.get(a.item)?.t === "text" || items.get(a.item)?.t === "shape" ? `<label class="sl-check"><input type="checkbox" data-an="byPara"${a.byPara ? " checked" : ""}> One paragraph at a time</label>` : ""}
      </li>`).join("")}</ol>
      ${list.length ? `<button type="button" class="sl-btn sl-wide" data-pact="anim-play">Play</button>` : ""}`;
  }

  // ---- Comments ------------------------------------------------------------------------------
  const ui = { showResolved: false };
  function comments(body) {
    const ydoc = app.model.ydoc;
    const ids = app.model.slideIds();
    const threadsMap = ydoc.getMap("comments");
    const threads = listThreads(ydoc).filter((t) => ui.showResolved || !t.resolved).map((t) => ({ ...t, slide: threadsMap.get(t.id)?.get("slide") || null, item: threadsMap.get(t.id)?.get("item") || null }));
    threads.sort((a, b) => (ids.indexOf(a.slide) - ids.indexOf(b.slide)) || a.createdAt - b.createdAt);
    const people = app.people();
    const nameOf = (id, fb) => (id === app.me.id ? "You" : people.find((p) => p.id === id)?.name || fb || "Someone");
    const canEdit = app.editingAllowed();
    body.innerHTML = `${canEdit ? `<form class="sl-comment-new" data-newc><textarea name="t" rows="2" placeholder="Comment on this slide${app.sel.length ? " (and what's selected)" : ""}… (@ to mention)"></textarea><button type="submit" class="sl-btn">Comment</button></form>` : ""}
      ${threads.map((t) => `<div class="sl-thread${t.resolved ? " is-resolved" : ""}${t.slide === app.slide ? " is-here" : ""}" data-thread="${esc(t.id)}">
        <button type="button" class="sl-thread-where" data-pact="goto-thread" data-k="${esc(t.slide || "")}">${t.slide && ids.includes(t.slide) ? `Slide ${ids.indexOf(t.slide) + 1}` : "Slide removed"}</button>
        ${t.replies.map((r) => `<div class="sl-reply"><span class="sl-person" style="background:${colorFor(r.by)}">${esc(String(r.name || "?")[0] || "?").toUpperCase()}</span><div><div class="sl-reply-who">${esc(nameOf(r.by, r.name))} <small>${esc(timeAgo(r.at))}</small></div><div class="sl-reply-text">${esc(r.text)}</div>${r.by === app.me.id ? `<button type="button" class="sl-link" data-pact="del-reply" data-k="${esc(r.id)}">Delete</button>` : ""}</div></div>`).join("")}
        ${canEdit ? `<textarea data-reply rows="1" placeholder="Reply…"></textarea><div class="sl-row"><button type="button" class="sl-btn" data-pact="reply">Reply</button><button type="button" class="sl-btn" data-pact="${t.resolved ? "reopen" : "resolve"}">${t.resolved ? "Reopen" : "Resolve"}</button></div>` : ""}
      </div>`).join("") || `<p class="sl-muted">No comments${ui.showResolved ? "" : " open"}.</p>`}
      <label class="sl-check"><input type="checkbox" data-pact="show-resolved"${ui.showResolved ? " checked" : ""}> Show resolved</label>`;
  }

  // ---- Versions ------------------------------------------------------------------------------
  let versionList = null;
  async function versions(body) {
    if (!versionList) {
      body.innerHTML = `<p class="sl-muted">Loading versions…</p>`;
      try { versionList = await app.session.versions(); } catch (e) { body.innerHTML = `<p class="sl-error">${esc(e?.message || "Versions couldn't be loaded.")}</p>`; return; }
      if (open !== "versions") return;
    }
    const people = app.people();
    const nameOf = (id) => (id === app.me.id ? "You" : people.find((p) => p.id === id)?.name || "");
    let html = `<button type="button" class="sl-btn sl-wide" data-pact="name-version">Name the current version</button><p class="sl-muted">Kept: every hour for a day, every day for a month, every week for a year, and named versions for good.</p>`;
    let lastDay = "";
    for (const v of versionList) {
      const d = new Date(v.savedAt);
      const day = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
      if (day !== lastDay) { html += `<div class="sl-pop-label">${esc(day)}</div>`; lastDay = day; }
      html += `<button type="button" class="sl-version${previewing?.slot === v.slot ? " is-on" : ""}" data-pact="version" data-k="${esc(v.slot)}"><strong>${esc(v.name || d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</strong><small>${v.name ? `${esc(d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))} · ` : ""}${esc(nameOf(v.savedBy))}</small></button>`;
    }
    if (!versionList.length) html += `<p class="sl-muted">No versions yet. One is kept every 15 minutes of editing and when you close the presentation.</p>`;
    body.innerHTML = html;
  }
  async function previewVersion(slot) {
    stopPreview();
    const v = versionList.find((x) => x.slot === slot);
    let vdoc;
    try { vdoc = await app.session.loadVersion(slot); } catch (e) { app.toast(e?.message || "That version couldn't be opened."); return; }
    const vm = createSlidesModel(vdoc);
    const cur = app.model;
    const [W, H] = vm.size();
    const changed = new Set();
    const curIds = new Set(cur.slideIds());
    for (const sid of vm.slideIds()) {
      if (!curIds.has(sid)) { changed.add(sid); continue; }
      const a = JSON.stringify(vm.exportSlides([sid])[0]), b = JSON.stringify(cur.exportSlides([sid])[0]);
      if (a !== b) changed.add(sid);
    }
    const ov = document.createElement("div");
    ov.className = "sl-version-view";
    ov.innerHTML = `<header><strong>${esc(v?.name || new Date(v?.savedAt).toLocaleString())}</strong><span class="sl-muted">${changed.size ? `${changed.size} slide${changed.size === 1 ? "" : "s"} differ from now (marked)` : "Same slides as now"}</span><button type="button" class="sl-btn" data-v="restore">Restore this version</button><button type="button" class="sl-icon" data-v="close" aria-label="Close">${IC.close}</button></header><div class="sl-version-slides" data-vs></div>`;
    root.appendChild(ov);
    const grid = ov.querySelector("[data-vs]");
    for (const sid of vm.slideIds()) {
      const cell = document.createElement("div");
      cell.className = `sl-version-slide${changed.has(sid) ? " is-changed" : ""}`;
      const th = document.createElement("div");
      cell.appendChild(th);
      grid.appendChild(cell);
      const el = renderSlide(vm, sid, { mediaUrl: (id) => app.media.url(id), textHtml: fragmentHtml });
      mountScaled(th, el, W, H, 260);
      requestAnimationFrame(() => fitText(el));
    }
    ov.addEventListener("click", async (e) => {
      const a = e.target.closest("[data-v]")?.dataset.v;
      if (a === "close") stopPreview();
      if (a === "restore") {
        const { value } = await openDialog(root, { title: "Restore this version?", body: `<p>The presentation goes back to how it was then. What it is now is kept as a named version first, so you can come back to it.</p>`, actions: [{ label: "Cancel", value: null }, { label: "Restore", value: "ok", primary: true }] });
        if (value !== "ok") return;
        await restoreFrom(vm);
        stopPreview();
        versionList = null;
        if (open === "versions") draw();
      }
    });
    previewing = { slot, el: ov };
    draw();
  }
  async function restoreFrom(vm) {
    const stamp = new Date().toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    await app.session.snapshot(`Before restoring ${stamp}`).catch(() => {});
    const m = app.model;
    const data = vm.exportSlides(vm.slideIds());
    m.transact(() => {
      m.meta.set("theme", vm.meta.get("theme") || m.meta.get("theme"));
      for (const k of ["size", "w", "h"]) { if (vm.meta.has(k)) m.meta.set(k, vm.meta.get(k)); else m.meta.delete(k); }
      vm.media.forEach((v, k) => { if (!m.media.has(k)) m.media.set(k, v); });
      m.deleteSlides(m.slideIds());
      m.importSlides(data, 0, { keepIds: true });
    });
    app.invalidateAll();
    app.goSlide(m.slideIds()[0]);
    await app.session.save();
    app.toast("Restored.");
  }
  function stopPreview() { previewing?.el.remove(); previewing = null; }

  // ---- Notes (phone) -------------------------------------------------------------------------
  function notes(body) {
    const fr = app.model.notes(app.slide);
    body.innerHTML = `<div class="sl-notes-sheet">${fr ? fragmentHtml(fr) || `<p class="sl-muted">No speaker notes on this slide.</p>` : ""}</div>${app.editingAllowed() ? `<button type="button" class="sl-btn" data-pact="edit-notes">Edit notes</button>` : ""}`;
  }

  // ---- events --------------------------------------------------------------------------------
  const onClick = async (e) => {
    const b = e.target.closest("[data-pact]");
    if (!b) return;
    const a = b.dataset.pact, k = b.dataset.k;
    const m = app.model;
    switch (a) {
      case "close": return closePanel();
      case "color": return colorPicker(root, b, { theme: m.theme(), current: app.selItems()[0]?.[k], onPick: (c) => {
        if (k === "stroke") app.setItems(c ? { stroke: c, sw: app.selItems()[0]?.sw || 2 } : { stroke: null, sw: 0 });
        else app.setItems({ [k]: c || "none" });
        draw();
      } });
      case "flip": { const it = app.selItems()[0]; app.setItems(k === "h" ? { flipH: it.flipH ? null : true } : { flipV: it.flipV ? null : true }); return; }
      case "crop-reset": return app.setItems({ crop: null });
      case "replace-image": return app.pickImages({ replace: app.sel[0] });
      case "theme": m.setTheme({ ...themeById(k) }); app.invalidateAll(); app.renderStage(); return draw();
      case "theme-reset": m.setTheme({ ...themeById(m.theme().id) }); app.invalidateAll(); app.renderStage(); return draw();
      case "role": return colorPicker(root, b, { theme: m.theme(), current: m.theme().colors[k], allowNone: false, roles: false, onPick: (c) => { const t = m.theme(); m.setTheme({ ...t, colors: { ...t.colors, [k]: c } }); app.invalidateAll(); app.renderStage(); draw(); } });
      case "layout": {
        const ids = app.slideSel?.length > 1 ? app.slideSel : [app.slide];
        m.transact(() => { for (const sid of ids) m.setLayout(sid, k); });
        app.renderStage(); return draw();
      }
      case "bg-color": {
        const s = m.slide(app.slide), bg = s.bg || {};
        return colorPicker(root, b, { theme: m.theme(), current: bg[k], allowNone: false, onPick: (c) => {
          const next = k === "color" ? { kind: "solid", color: c } : { ...bg, kind: "gradient", [k]: c?.[0] === "@" ? c.slice(1) : c };
          m.setSlide(app.slide, { bg: next }); app.renderStage(); draw();
        } });
      }
      case "bg-image": {
        const input = document.createElement("input");
        input.type = "file"; input.accept = "image/*";
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) return;
          try { const img = await app.storeImage(f); m.setSlide(app.slide, { bg: { kind: "image", media: img.id, fit: m.slide(app.slide).bg?.fit || "cover" } }); app.renderStage(); draw(); } catch (err) { app.toast(err?.message || "That picture couldn't be used."); }
        };
        return input.click();
      }
      case "bg-all": { const bg = m.slide(app.slide)?.bg || null; m.setSlide(m.slideIds(), { bg }); app.invalidateAll(); return app.renderStage(); }
      case "bg-reset": m.setSlide(app.slide, { bg: null }); app.renderStage(); return draw();
      case "tr-all": { const s = m.slide(app.slide); m.setSlide(m.slideIds(), { transition: s.transition, advance: s.advance || null }); app.toast("Applied to every slide."); return app.film().refresh(); }
      case "tr-play": case "anim-play": {
        const { previewOnStage } = await import("./present.js");
        return previewOnStage({ root, model: m, sid: app.slide, media: app.media, transitionOnly: a === "tr-play" });
      }
      case "anim-add": {
        const list = m.anims(app.slide);
        const add = app.sel.filter((iid) => !list.some((x) => x.item === iid)).map((iid) => ({ item: iid, effect: "fade-in", start: "click" }));
        if (!add.length) { app.toast("Already animated — change its effect below."); return; }
        m.setAnims(app.slide, [...list, ...add]);
        return draw();
      }
      case "anim-up": case "anim-down": case "anim-del": {
        const id = b.closest("[data-anim]").dataset.anim;
        const list = m.anims(app.slide);
        const i = list.findIndex((x) => x.id === id);
        if (a === "anim-del") list.splice(i, 1);
        else { const j = a === "anim-up" ? i - 1 : i + 1; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; }
        m.setAnims(app.slide, list);
        return draw();
      }
      case "goto-thread": if (k) app.goSlide(k); return;
      case "reply": case "resolve": case "reopen": {
        const tid = b.closest("[data-thread]").dataset.thread;
        if (a === "reply") {
          const ta = b.closest("[data-thread]").querySelector("[data-reply]");
          const text = ta.value.trim();
          if (!text) return;
          m.transact(() => replyTo(m.ydoc, tid, { text, user: app.me }));
          notify(text);
        } else m.transact(() => setResolved(m.ydoc, tid, a === "resolve"));
        return draw();
      }
      case "del-reply": { const tid = b.closest("[data-thread]").dataset.thread; m.transact(() => deleteReply(m.ydoc, tid, k, app.me.id)); return draw(); }
      case "show-resolved": ui.showResolved = b.checked; return draw();
      case "name-version": {
        const v = await promptText(root, "Name this version", { placeholder: "e.g. Final for Sunday" });
        if (!v?.trim()) return;
        try { await app.session.snapshot(v.trim().slice(0, 120)); versionList = null; draw(); } catch (err) { app.toast(err?.message || "That didn't work."); }
        return;
      }
      case "version": return previewVersion(k);
      case "edit-notes": closePanel(); root.querySelector("[data-notes-ed] .ProseMirror")?.focus(); root.classList.add("show-notes"); return;
      default: return;
    }
  };
  function notify(text) {
    const ids = mentionsIn(text, app.people()).filter((id) => id !== app.me.id);
    if (ids.length) app.deps.notifyMention?.({ to: ids, kind: "slides" });
  }
  box.addEventListener("click", onClick);
  sheet.addEventListener("click", onClick);

  const onSubmit = (e) => {
    const f = e.target.closest("[data-newc]");
    if (!f) return;
    e.preventDefault();
    const text = f.t.value.trim();
    if (!text) return;
    const m = app.model;
    const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const n = m.slideIds().indexOf(app.slide) + 1;
    m.transact(() => {
      addThread(m.ydoc, { id, quote: `Slide ${n}`, text, user: app.me });
      const t = m.ydoc.getMap("comments").get(id);
      t.set("slide", app.slide);
      if (app.sel[0]) t.set("item", app.sel[0]);
    });
    notify(text);
    draw();
  };
  box.addEventListener("submit", onSubmit);
  sheet.addEventListener("submit", onSubmit);

  const onChange = (e) => {
    const t = e.target;
    const m = app.model;
    if (t.dataset.f) {
      const k = t.dataset.f;
      let v = t.type === "checkbox" ? t.checked : t.type === "number" || t.type === "range" ? Number(t.value) : t.value;
      if (t.dataset.invert) v = Math.round((1 - v) * 100) / 100;
      if (k === "autofit") v = v ? "shrink" : null;
      else if (t.type === "checkbox") v = v || null;
      if (k === "opacity" && v >= 1) v = null;
      if ((k === "dash" || k === "mask" || k === "recolor") && !v) v = null;
      if (k === "rot") v = ((v % 360) + 360) % 360;
      if (k === "w" || k === "h") v = Math.max(1, v);
      app.setItems({ [k]: v });
      return;
    }
    if (t.dataset.crop) {
      const it = app.selItems()[0];
      const c = { l: 0, r: 0, t: 0, b: 0, ...(it.crop || {}) };
      c[t.dataset.crop] = Number(t.value) / 100;
      app.setItems({ crop: c });
      return;
    }
    if (t.dataset.themeFont) {
      const th = m.theme();
      m.setTheme({ ...th, fonts: { ...th.fonts, [t.dataset.themeFont]: t.value } });
      app.invalidateAll(); app.renderStage();
      return;
    }
    if (t.dataset.bg) {
      const s = m.slide(app.slide);
      const bg = s.bg || {};
      const k = t.dataset.bg;
      if (k === "kind") {
        const v = t.value;
        const th = m.theme();
        const next = v === "theme" ? null : v === "solid" ? { kind: "solid", color: `@${th.bg.role || "lt1"}` } : v === "gradient" ? { kind: "gradient", from: "lt1", to: "a1", angle: 135 } : { kind: "image", media: bg.media || null, fit: "cover" };
        if (v === "image" && !next.media) { draw(); onClick({ target: Object.assign(document.createElement("button"), { dataset: { pact: "bg-image" } }) }); return; }
        m.setSlide(app.slide, { bg: next });
      } else if (k === "angle") m.setSlide(app.slide, { bg: { ...bg, angle: Number(t.value) } });
      else if (k === "fit") m.setSlide(app.slide, { bg: { ...bg, fit: t.value } });
      app.renderStage(); draw();
      return;
    }
    if (t.dataset.tr) {
      const s = m.slide(app.slide);
      const tr = s.transition || { kind: "none", dir: "right", ms: 500 };
      const k = t.dataset.tr;
      if (k === "advance") m.setSlide(app.slide, { advance: Math.max(0, Number(t.value) || 0) || null });
      else m.setSlide(app.slide, { transition: { ...tr, [k]: k === "ms" ? Number(t.value) : t.value } });
      app.film().refresh();
      draw();
      return;
    }
    if (t.dataset.an) {
      const id = t.closest("[data-anim]").dataset.anim;
      const k = t.dataset.an;
      const list = m.anims(app.slide);
      const a = list.find((x) => x.id === id);
      if (!a) return;
      a[k] = k === "ms" || k === "delay" ? Math.round(Number(t.value) * 1000) : k === "byPara" ? t.checked : t.value;
      m.setAnims(app.slide, list);
      if (k === "effect") draw();
    }
  };
  box.addEventListener("change", onChange);
  sheet.addEventListener("change", onChange);
  const onInput = (e) => { if (e.target.type === "range") onChange(e); };
  box.addEventListener("input", onInput);
  sheet.addEventListener("input", onInput);

  void Y; void docFromContent; void sizeOf;
  return { open: openPanel, close: closePanel, refresh, get current() { return open; } };
}
