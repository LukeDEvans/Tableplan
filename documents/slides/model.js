// A presentation's shared data on Yjs (SLIDES_DESIGN.md §2). No DOM. Every edit goes
// through here, inside one transaction with the LOCAL origin, so undo only ever undoes
// your own edits and co-editing merges cleanly.
//
//   "meta"     Map    format version, size ("16:9" | "4:3" | … or w/h), theme (checked object)
//   "order"    Array  slide ids, in order
//   "slides"   Map    slideId → Map { layout, bg, hidden, skip, section, transition, advance,
//                                       items: Map itemId → Map {…item, text?: XmlFragment},
//                                       notes: XmlFragment, anims: Array<{…}> }
//   "media"    Map    mediaId → { kind, part?, link?, mime, size, w, h, duration, poster }
//   "comments" Map    threads, as the word processor (anchored to a slide, optionally an item)
//
// Everything a slide holds lives inside its own map, so deleting a slide removes all of
// it, and duplicating one is a deep copy.

import * as Y from "yjs";
import { keyBetween, keysBetween, byZ, isKey } from "./zorder.js";
import { cleanTheme, layoutFor, sizeOf, DEFAULT_THEME, themeById } from "./themes.js";

export const SLIDES_MIME = "application/vnd.live.slides";
export const FORMAT = 1;
export const LOCAL = "slides-local";
export const MAX_SLIDES = 1000;
export const MAX_ITEMS = 400;
export const ITEM_TYPES = Object.freeze(["text", "shape", "line", "image", "table", "video", "audio", "chart"]);
const TEXT_TYPES = new Set(["text", "shape"]);

const rid = () => {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(b, (x) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[x % 62]).join("");
};
export const newId = rid;

// Plain fields an item may carry. Anything else is ignored on read.
const NUM = new Set(["x", "y", "w", "h", "rot", "sw", "opacity", "size", "lineH", "radius", "pad", "rows", "cols", "start", "end", "volume"]);
const STR = new Set(["t", "z", "grp", "role", "name", "fill", "stroke", "dash", "shape", "font", "color", "align", "valign", "autofit", "media", "alt", "mask", "a1", "a2", "kind", "link", "play", "fit", "recolor", "poster", "posterUrl"]);
const BOOL = new Set(["flipH", "flipV", "lock", "bold", "italic", "shadow", "loop", "mute", "controls", "acrossSlides"]);
const OBJ = new Set(["crop", "colW", "rowH", "cells", "conn", "src", "cache"]); // src/cache: linked charts and tables (linked.js)
export const ITEM_KEYS = Object.freeze([...NUM, ...STR, ...BOOL, ...OBJ]);

const clampNum = (k, v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  if (k === "opacity") return Math.min(1, Math.max(0, n));
  if (k === "rot") return ((n % 360) + 360) % 360;
  if (k === "size") return Math.min(400, Math.max(1, n));
  if (k === "w" || k === "h") return Math.min(20000, Math.max(0, n));
  return Math.min(1e6, Math.max(-1e6, n));
};

export function cleanItem(v, id = v?.id) {
  const out = { id };
  if (!v || typeof v !== "object") return out;
  for (const [k, raw] of Object.entries(v)) {
    if (NUM.has(k)) { const n = clampNum(k, raw); if (n !== undefined) out[k] = n; }
    else if (STR.has(k)) { if (typeof raw === "string" && raw.length <= 2000) out[k] = raw; }
    else if (BOOL.has(k)) { if (typeof raw === "boolean") out[k] = raw; }
    else if (OBJ.has(k)) { if (raw && typeof raw === "object") out[k] = JSON.parse(JSON.stringify(raw)); }
  }
  if (!ITEM_TYPES.includes(out.t)) out.t = "shape";
  if (out.font !== undefined && !/^@(heading|body)$|^[A-Za-z0-9 ]{1,60}$/.test(out.font)) delete out.font; // a font is a name, never CSS
  if (!isKey(out.z)) out.z = "a0";
  for (const k of ["x", "y"]) if (out[k] === undefined) out[k] = 0;
  for (const k of ["w", "h"]) if (out[k] === undefined) out[k] = 100;
  return out;
}

const plainOf = (ymap) => {
  const o = {};
  ymap.forEach((v, k) => { if (!(v instanceof Y.AbstractType)) o[k] = v; });
  const t = tableData(ymap);
  if (t) Object.assign(o, t);
  return o;
};

// Tables keep row and column identities (as the spreadsheet does), so two people adding
// rows and typing in cells at once merge cleanly. Cells are keyed "<rowId>.<colId>".
export const MAX_ROWS = 30, MAX_COLS = 12;
function tableData(im) {
  const r = im.get("rowIds"), c = im.get("colIds"), cm = im.get("cellmap");
  if (!(r instanceof Y.Array) || !(c instanceof Y.Array) || !(cm instanceof Y.Map)) return null;
  const rows = r.toArray(), cols = c.toArray();
  const cells = {};
  rows.forEach((rid, i) => cols.forEach((cid, j) => { const v = cm.get(`${rid}.${cid}`); if (v && typeof v === "object") cells[`${i}.${j}`] = v; }));
  return { rows: rows.length, cols: cols.length, cells };
}
const cleanCell = (v) => {
  if (!v || typeof v !== "object") return null;
  const o = {};
  if (typeof v.text === "string") o.text = v.text.slice(0, 5000);
  for (const k of ["fill", "color", "align"]) if (typeof v[k] === "string" && v[k].length < 40) o[k] = v[k];
  if (v.bold === true) o.bold = true;
  if (v.italic === true) o.italic = true;
  for (const k of ["rs", "cs"]) if (Number.isInteger(v[k]) && v[k] > 1 && v[k] <= 30) o[k] = v[k];
  return Object.keys(o).length ? o : null;
};
function buildTable(im, rows, cols, cells = {}) {
  const r = new Y.Array(), c = new Y.Array(), cm = new Y.Map();
  const rids = Array.from({ length: Math.max(1, Math.min(MAX_ROWS, rows)) }, rid);
  const cids = Array.from({ length: Math.max(1, Math.min(MAX_COLS, cols)) }, rid);
  r.push(rids); c.push(cids);
  for (const [k, v] of Object.entries(cells || {})) {
    const [i, j] = k.split(".").map(Number);
    const cell = cleanCell(v);
    if (cell && rids[i] && cids[j]) cm.set(`${rids[i]}.${cids[j]}`, cell);
  }
  im.set("rowIds", r); im.set("colIds", c); im.set("cellmap", cm);
}

export const TRANSITIONS = Object.freeze(["none", "dissolve", "fade", "slide", "flip", "cube", "gallery", "zoom"]);
export const EFFECTS = Object.freeze(["appear", "disappear", "fade-in", "fade-out", "fly-in", "fly-out", "zoom-in", "zoom-out", "spin", "grow", "shrink"]);
export const DIRS = Object.freeze(["left", "right", "top", "bottom"]);
export const STARTS = Object.freeze(["click", "with", "after"]);

export function cleanTransition(v) {
  if (!v || !TRANSITIONS.includes(v.kind) || v.kind === "none") return null;
  return { kind: v.kind, dir: DIRS.includes(v.dir) ? v.dir : "right", ms: Math.min(5000, Math.max(100, Number(v.ms) || 500)) };
}
export function cleanAnim(v) {
  if (!v || typeof v.item !== "string" || !EFFECTS.includes(v.effect)) return null;
  return {
    id: typeof v.id === "string" ? v.id.slice(0, 20) : rid(), item: v.item.slice(0, 20), effect: v.effect,
    start: STARTS.includes(v.start) ? v.start : "click", dir: DIRS.includes(v.dir) ? v.dir : "left",
    ms: Math.min(10000, Math.max(50, Number(v.ms) || 500)), delay: Math.min(60000, Math.max(0, Number(v.delay) || 0)),
    byPara: !!v.byPara,
  };
}

export function createSlidesModel(ydoc) {
  const meta = ydoc.getMap("meta");
  const order = ydoc.getArray("order");
  const slides = ydoc.getMap("slides");
  const media = ydoc.getMap("media");
  const tx = (fn) => { let r; ydoc.transact(() => { r = fn(); }, LOCAL); return r; };

  const slideMap = (id) => slides.get(id) || null;
  const itemsOf = (sid) => slideMap(sid)?.get("items") || null;
  const itemMap = (sid, iid) => itemsOf(sid)?.get(iid) || null;

  function theme() { return cleanTheme(meta.get("theme") || { id: DEFAULT_THEME }); }
  function size() { return sizeOf({ size: meta.get("size"), w: meta.get("w"), h: meta.get("h") }); }

  function slideIds() {
    // unique, existing, in order (a concurrent move can leave a duplicate; tidy() fixes it)
    const seen = new Set();
    return order.toArray().filter((id) => typeof id === "string" && !seen.has(id) && seen.add(id) && slides.has(id));
  }

  function slide(id) {
    const m = slideMap(id);
    if (!m) return null;
    return {
      id, layout: m.get("layout") || "blank", bg: m.get("bg") || null, hidden: !!m.get("hidden"), skip: !!m.get("skip"),
      section: typeof m.get("section") === "string" ? m.get("section").slice(0, 200) : "",
      transition: cleanTransition(m.get("transition")), advance: Math.max(0, Number(m.get("advance")) || 0),
    };
  }

  function items(sid) {
    const m = itemsOf(sid);
    if (!m) return [];
    const out = [];
    m.forEach((im, id) => { if (im instanceof Y.Map) out.push(cleanItem(plainOf(im), id)); });
    return out.sort(byZ);
  }
  const item = (sid, iid) => { const m = itemMap(sid, iid); return m ? cleanItem(plainOf(m), iid) : null; };
  const text = (sid, iid) => itemMap(sid, iid)?.get("text") || null;
  const notes = (sid) => slideMap(sid)?.get("notes") || null;
  const anims = (sid) => (slideMap(sid)?.get("anims")?.toArray() || []).map(cleanAnim).filter(Boolean);

  // ---- building blocks -----------------------------------------------------------------------
  function makeItemMap(fields) {
    const im = new Y.Map();
    for (const [k, v] of Object.entries(fields)) if (k !== "id" && v !== undefined) im.set(k, v);
    if (TEXT_TYPES.has(fields.t)) im.set("text", new Y.XmlFragment());
    if (fields.t === "table") { im.delete("cells"); im.delete("rows"); im.delete("cols"); buildTable(im, fields.rows || 2, fields.cols || 2, fields.cells); }
    return im;
  }

  function placeholderFields(ph, [W, H]) {
    const [fx, fy, fw, fh] = ph.box;
    return { t: "text", role: ph.role, x: Math.round(fx * W), y: Math.round(fy * H), w: Math.round(fw * W), h: Math.round(fh * H), ...ph.style };
  }

  function makeSlideMap(layoutId) {
    const sm = new Y.Map();
    sm.set("layout", layoutFor(layoutId).id);
    sm.set("items", new Y.Map());
    sm.set("notes", new Y.XmlFragment());
    sm.set("anims", new Y.Array());
    return sm;
  }

  function fillPlaceholders(sm, layoutId) {
    const L = layoutFor(layoutId);
    const zs = keysBetween(null, null, L.ph.length);
    const map = sm.get("items");
    L.ph.forEach((ph, i) => map.set(rid(), makeItemMap({ ...placeholderFields(ph, size()), z: zs[i] })));
  }

  // ---- presentation -------------------------------------------------------------------------
  function init({ themeId = DEFAULT_THEME, size: sz = "16:9", firstLayout = "title" } = {}) {
    return tx(() => {
      meta.set("format", FORMAT);
      meta.set("size", sz);
      meta.set("theme", cleanTheme({ ...themeById(themeId) }));
      if (!order.length) {
        const id = rid();
        const sm = makeSlideMap(firstLayout);
        slides.set(id, sm);
        fillPlaceholders(sm, firstLayout);
        order.push([id]);
      }
    });
  }

  function setTheme(v) { tx(() => meta.set("theme", cleanTheme(v))); }
  function setSize(sz, w = null, h = null) {
    tx(() => {
      const [W0, H0] = size();
      if (w && h) { meta.set("size", "custom"); meta.set("w", w); meta.set("h", h); } else { meta.set("size", sz); meta.delete("w"); meta.delete("h"); }
      const [W1, H1] = size();
      if (W0 === W1 && H0 === H1) return;
      // keep everything in the same place relative to the slide
      const sx = W1 / W0, sy = H1 / H0;
      slides.forEach((sm) => sm.get("items")?.forEach((im) => {
        im.set("x", Math.round((im.get("x") || 0) * sx)); im.set("w", Math.round((im.get("w") || 0) * sx));
        im.set("y", Math.round((im.get("y") || 0) * sy)); im.set("h", Math.round((im.get("h") || 0) * sy));
      }));
    });
  }

  // ---- slides --------------------------------------------------------------------------------
  function addSlide({ layout = "title-body", after = null, index = null } = {}) {
    if (order.length >= MAX_SLIDES) throw new Error(`A presentation can hold up to ${MAX_SLIDES} slides.`);
    return tx(() => {
      const id = rid();
      const sm = makeSlideMap(layout);
      slides.set(id, sm);
      fillPlaceholders(sm, layout);
      const ids = slideIds();
      let at = index ?? (after ? ids.indexOf(after) + 1 : ids.length);
      if (at < 0 || at > order.length) at = order.length;
      order.insert(rawIndex(at), [id]);
      return id;
    });
  }

  // order may hold stray entries; map a position among real slides to the array index
  function rawIndex(at) {
    const ids = slideIds();
    if (at >= ids.length) return order.length;
    return order.toArray().indexOf(ids[at]);
  }

  function duplicateSlides(ids) {
    return tx(() => {
      const out = [];
      const all = slideIds();
      const sorted = [...ids].filter((id) => slides.has(id)).sort((a, b) => all.indexOf(a) - all.indexOf(b));
      for (const id of sorted) {
        const src = slideMap(id);
        const copy = new Y.Map();
        src.forEach((v, k) => { if (!(v instanceof Y.AbstractType)) copy.set(k, v); });
        copy.set("notes", xmlFromJson(xmlToJson(src.get("notes")), new Y.XmlFragment()));
        // items get new ids; a grouped set stays grouped under a new group id; the
        // animation list points at the new ids
        const renamed = new Map();
        const groups = new Map();
        const itemsCopy = new Y.Map();
        src.get("items")?.forEach((im, iid) => {
          const nid = rid();
          renamed.set(iid, nid);
          const data = itemToJson(im);
          if (data.fields.grp) { if (!groups.has(data.fields.grp)) groups.set(data.fields.grp, rid()); data.fields.grp = groups.get(data.fields.grp); }
          itemsCopy.set(nid, itemFromJson(data));
        });
        copy.set("items", itemsCopy);
        const an = new Y.Array();
        an.push((src.get("anims")?.toArray() || []).map((a) => ({ ...a, id: rid(), item: renamed.get(a.item) || a.item })));
        copy.set("anims", an);
        const nid = rid();
        slides.set(nid, copy);
        order.insert(rawIndex(slideIds().indexOf(id) + 1), [nid]); // right after its original
        out.push(nid);
      }
      return out;
    });
  }

  function deleteSlides(ids) {
    tx(() => {
      const kill = new Set(ids);
      for (let i = order.length - 1; i >= 0; i--) if (kill.has(order.get(i))) order.delete(i, 1);
      for (const id of kill) slides.delete(id);
    });
  }

  // Moves the given slides (kept in their current relative order) so the first lands at
  // position `to` among the slides that remain.
  function moveSlides(ids, to) {
    tx(() => {
      const all = slideIds();
      const moving = all.filter((id) => ids.includes(id));
      if (!moving.length) return;
      for (let i = order.length - 1; i >= 0; i--) if (moving.includes(order.get(i))) order.delete(i, 1);
      const at = Math.max(0, Math.min(to, slideIds().length));
      order.insert(rawIndex(at), moving);
    });
  }

  const SLIDE_FIELDS = new Set(["bg", "hidden", "skip", "section", "transition", "advance"]);
  function setSlide(ids, patch) {
    tx(() => {
      for (const id of [].concat(ids)) {
        const sm = slideMap(id);
        if (!sm) continue;
        for (const [k, v] of Object.entries(patch)) {
          if (!SLIDE_FIELDS.has(k)) continue;
          if (v === null || v === undefined || v === false || v === "") sm.delete(k);
          else if (k === "transition") { const c = cleanTransition(v); if (c) sm.set(k, c); else sm.delete(k); }
          else sm.set(k, v);
        }
      }
    });
  }

  // Changing layout moves and restyles placeholders by role; an empty placeholder whose
  // role the new layout lacks is removed; one with text stays where it is.
  function setLayout(sid, layoutId) {
    tx(() => {
      const sm = slideMap(sid);
      if (!sm) return;
      const L = layoutFor(layoutId);
      sm.set("layout", L.id);
      const map = sm.get("items");
      const byRole = new Map();
      map.forEach((im, iid) => { const r = im.get("role"); if (r && !byRole.has(r)) byRole.set(r, [iid, im]); });
      const used = new Set();
      for (const ph of L.ph) {
        const f = placeholderFields(ph, size());
        const hit = byRole.get(ph.role);
        if (hit) {
          used.add(hit[0]);
          for (const [k, v] of Object.entries(f)) if (k !== "t" && k !== "role") hit[1].set(k, v);
        } else {
          const z = keyBetween(maxZ(sid), null);
          map.set(rid(), makeItemMap({ ...f, z }));
        }
      }
      for (const [r, [iid, im]] of byRole) {
        if (used.has(iid)) continue;
        if (!fragmentHasText(im.get("text"))) map.delete(iid);
        else im.delete("role"); // keeps its text as an ordinary box
        void r;
      }
    });
  }

  // ---- items ---------------------------------------------------------------------------------
  function maxZ(sid) { const list = items(sid); return list.length ? list[list.length - 1].z : null; }

  function addItem(sid, fields) {
    const map = itemsOf(sid);
    if (!map) return null;
    if (map.size >= MAX_ITEMS) throw new Error(`A slide can hold up to ${MAX_ITEMS} things.`);
    return tx(() => {
      const id = rid();
      const f = cleanItem({ ...fields, z: keyBetween(maxZ(sid), null) }, id);
      map.set(id, makeItemMap(f));
      return id;
    });
  }

  // fields: { key: value | null } — null removes the field (back to its default)
  function updateItems(sid, ids, patch) {
    tx(() => {
      for (const iid of [].concat(ids)) {
        const im = itemMap(sid, iid);
        if (!im) continue;
        const p = typeof patch === "function" ? patch(cleanItem(plainOf(im), iid)) : patch;
        for (const [k, v] of Object.entries(p || {})) {
          if (!ITEM_KEYS.includes(k) || k === "t") continue;
          if (v === null || v === undefined) im.delete(k);
          else {
            const c = cleanItem({ t: "shape", [k]: v })[k];
            if (c !== undefined && JSON.stringify(im.get(k)) !== JSON.stringify(c)) im.set(k, c);
          }
        }
      }
    });
  }

  function deleteItems(sid, ids) {
    tx(() => {
      const map = itemsOf(sid);
      if (!map) return;
      const kill = new Set([].concat(ids));
      for (const id of kill) map.delete(id);
      const an = slideMap(sid).get("anims");
      if (an) for (let i = an.length - 1; i >= 0; i--) if (kill.has(an.get(i)?.item)) an.delete(i, 1);
    });
  }

  // Copying: items as plain JSON (fields + text), so they can go through the clipboard,
  // into another presentation, and be pasted more than once.
  function copyItems(sid, ids) {
    const out = [];
    for (const iid of [].concat(ids)) { const im = itemMap(sid, iid); if (im) out.push(itemToJson(im)); }
    return out;
  }
  function pasteItems(sid, list, { dx = 0, dy = 0 } = {}) {
    const map = itemsOf(sid);
    if (!map || !list?.length) return [];
    if (map.size + list.length > MAX_ITEMS) throw new Error(`A slide can hold up to ${MAX_ITEMS} things.`);
    return tx(() => {
      const zs = keysBetween(maxZ(sid), null, list.length);
      const groups = new Map();
      return list.map((data, i) => {
        const f = { ...cleanItem(data.fields || {}), z: zs[i] };
        f.x = (f.x || 0) + dx; f.y = (f.y || 0) + dy;
        delete f.role;
        if (f.grp) { if (!groups.has(f.grp)) groups.set(f.grp, rid()); f.grp = groups.get(f.grp); }
        const id = rid();
        map.set(id, itemFromJson({ fields: f, text: data.text || null }));
        return id;
      });
    });
  }

  // Whole slides as JSON (copying slides between presentations, templates).
  function exportSlides(ids) {
    return [].concat(ids).filter((id) => slides.has(id)).map((id) => {
      const sm = slideMap(id);
      const fields = {};
      sm.forEach((v, k) => { if (!(v instanceof Y.AbstractType)) fields[k] = v; });
      const its = [];
      const idMap = {};
      sm.get("items")?.forEach((im, iid) => { idMap[iid] = its.length; its.push({ ...itemToJson(im), iid }); });
      return { id, fields, items: its, notes: xmlToJson(sm.get("notes")), anims: (sm.get("anims")?.toArray() || []).map((a) => ({ ...a, item: idMap[a.item] })) };
    });
  }
  // keepIds (restoring a version): slides and items keep their ids, so comments and
  // anything else that points at them still find them.
  function importSlides(list, at = null, { keepIds = false } = {}) {
    if (order.length + list.length > MAX_SLIDES) throw new Error(`A presentation can hold up to ${MAX_SLIDES} slides.`);
    return tx(() => {
      const ids = [];
      let pos = at ?? slideIds().length;
      for (const s of list) {
        const sm = new Y.Map();
        for (const k of ["layout", "bg", "hidden", "skip", "section", "transition", "advance"]) if (s.fields?.[k] !== undefined) sm.set(k, k === "transition" ? cleanTransition(s.fields[k]) : s.fields[k]);
        if (!sm.get("layout")) sm.set("layout", "blank");
        const itemsMap = new Y.Map();
        const newIds = [];
        const groups = new Map();
        for (const data of (s.items || []).slice(0, MAX_ITEMS)) {
          const f = cleanItem(data.fields || {});
          if (f.grp) { if (!groups.has(f.grp)) groups.set(f.grp, rid()); f.grp = groups.get(f.grp); }
          const nid = keepIds && typeof data.iid === "string" && /^[A-Za-z0-9]{1,20}$/.test(data.iid) && !itemsMap.has(data.iid) ? data.iid : rid();
          newIds.push(nid);
          itemsMap.set(nid, itemFromJson({ fields: f, text: data.text }));
        }
        sm.set("items", itemsMap);
        sm.set("notes", xmlFromJson(s.notes, new Y.XmlFragment()));
        const an = new Y.Array();
        an.push((s.anims || []).map((a) => cleanAnim({ ...a, id: rid(), item: newIds[a.item] })).filter(Boolean));
        sm.set("anims", an);
        const id = keepIds && typeof s.id === "string" && /^[A-Za-z0-9]{1,20}$/.test(s.id) && !slides.has(s.id) ? s.id : rid();
        slides.set(id, sm);
        order.insert(rawIndex(pos), [id]);
        pos++;
        ids.push(id);
      }
      return ids;
    });
  }

  // Stacking: "front" | "back" | "forward" | "backward". Only the moved items' keys change.
  function restack(sid, ids, how) {
    tx(() => {
      const list = items(sid);
      const moving = list.filter((x) => ids.includes(x.id));
      if (!moving.length) return;
      const rest = list.filter((x) => !ids.includes(x.id));
      let lo = null, hi = null;
      if (how === "front") lo = rest.length ? rest[rest.length - 1].z : null;
      else if (how === "back") hi = rest.length ? rest[0].z : null;
      else {
        const firstIdx = list.indexOf(moving[0]);
        const lastIdx = list.indexOf(moving[moving.length - 1]);
        if (how === "forward") {
          const next = list.slice(lastIdx + 1).find((x) => !ids.includes(x.id));
          if (!next) return;
          const after = list.slice(list.indexOf(next) + 1).find((x) => !ids.includes(x.id));
          lo = next.z; hi = after ? after.z : null;
        } else {
          const prev = list.slice(0, firstIdx).reverse().find((x) => !ids.includes(x.id));
          if (!prev) return;
          const before = list.slice(0, list.indexOf(prev)).reverse().find((x) => !ids.includes(x.id));
          lo = before ? before.z : null; hi = prev.z;
        }
      }
      if (lo !== null && hi !== null && lo >= hi) return; // a tie from a concurrent edit
      const ks = keysBetween(lo, hi, moving.length);
      moving.forEach((x, i) => itemMap(sid, x.id).set("z", ks[i]));
    });
  }

  function group(sid, ids) {
    if (ids.length < 2) return null;
    const g = rid();
    updateItems(sid, ids, { grp: g });
    return g;
  }
  function ungroup(sid, ids) { updateItems(sid, ids, { grp: null }); }
  // An item's whole group (or itself).
  function groupOf(sid, iid) {
    const it = item(sid, iid);
    if (!it?.grp) return [iid];
    return items(sid).filter((x) => x.grp === it.grp).map((x) => x.id);
  }

  // ---- tables --------------------------------------------------------------------------------
  function tableCell(sid, iid, r, c, patch) {
    const im = itemMap(sid, iid);
    const rid2 = im?.get("rowIds")?.get(r), cid = im?.get("colIds")?.get(c);
    if (!rid2 || !cid) return;
    tx(() => {
      const cm = im.get("cellmap");
      const key = `${rid2}.${cid}`;
      const next = cleanCell({ ...(cm.get(key) || {}), ...patch });
      for (const [k, v] of Object.entries(patch)) if (v === null) delete next?.[k];
      if (next && Object.keys(next).length) cm.set(key, next); else cm.delete(key);
    });
  }
  // axis "row" | "col"; at = index to insert before
  function tableInsert(sid, iid, axis, at) {
    const im = itemMap(sid, iid);
    const arr = im?.get(axis === "row" ? "rowIds" : "colIds");
    if (!arr || arr.length >= (axis === "row" ? MAX_ROWS : MAX_COLS)) return false;
    tx(() => {
      arr.insert(Math.max(0, Math.min(at, arr.length)), [rid()]);
      if (axis === "col") { const w = im.get("colW"); if (Array.isArray(w)) { const n = [...w]; n.splice(at, 0, 1); im.set("colW", n); } }
      else im.set("h", (im.get("h") || 0) + Math.round((im.get("h") || 0) / Math.max(1, arr.length - 1)));
    });
    return true;
  }
  // A linked table's cells from its spreadsheet (linked.js): the table takes the range's
  // size and text; formatting typed on the slide is replaced by the spreadsheet's.
  // → true if anything changed.
  function setTableText(sid, iid, grid) {
    const im = itemMap(sid, iid);
    if (!im?.get("rowIds")) return false;
    const rows = Math.max(1, Math.min(MAX_ROWS, grid.length)), cols = Math.max(1, Math.min(MAX_COLS, Math.max(1, ...grid.map((r) => r.length))));
    const before = JSON.stringify(tableData(im));
    tx(() => {
      const ra = im.get("rowIds"), ca = im.get("colIds"), cm = im.get("cellmap");
      while (ra.length < rows) ra.push([rid()]);
      if (ra.length > rows) ra.delete(rows, ra.length - rows);
      while (ca.length < cols) ca.push([rid()]);
      if (ca.length > cols) ca.delete(cols, ca.length - cols);
      const rIds = ra.toArray(), cIds = ca.toArray();
      const want = new Map();
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const cell = cleanCell(grid[r]?.[c]); if (cell) want.set(`${rIds[r]}.${cIds[c]}`, cell); }
      for (const k of [...cm.keys()]) if (!want.has(k)) cm.delete(k);
      for (const [k, v] of want) if (JSON.stringify(cm.get(k)) !== JSON.stringify(v)) cm.set(k, v);
      const w = im.get("colW");
      if (Array.isArray(w) && w.length !== cols) im.delete("colW");
    });
    return JSON.stringify(tableData(im)) !== before;
  }

  function tableDelete(sid, iid, axis, at) {
    const im = itemMap(sid, iid);
    const arr = im?.get(axis === "row" ? "rowIds" : "colIds");
    if (!arr || arr.length <= 1 || at < 0 || at >= arr.length) return false;
    tx(() => {
      const gone = arr.get(at);
      arr.delete(at, 1);
      const cm = im.get("cellmap");
      for (const k of [...cm.keys()]) if (axis === "row" ? k.startsWith(`${gone}.`) : k.endsWith(`.${gone}`)) cm.delete(k);
      if (axis === "col") { const w = im.get("colW"); if (Array.isArray(w)) { const n = [...w]; n.splice(at, 1); im.set("colW", n); } }
      else im.set("h", Math.max(20, Math.round((im.get("h") || 0) * (arr.length / (arr.length + 1)))));
    });
    return true;
  }

  // ---- animations ----------------------------------------------------------------------------
  function setAnims(sid, list) {
    tx(() => {
      const an = slideMap(sid)?.get("anims");
      if (!an) return;
      an.delete(0, an.length);
      an.push(list.map(cleanAnim).filter(Boolean));
    });
  }

  // ---- media ---------------------------------------------------------------------------------
  function addMedia(id, info) { tx(() => media.set(id, info)); }
  const mediaInfo = (id) => media.get(id) || null;
  // media ids any slide still uses
  function usedMedia() {
    const used = new Set();
    slides.forEach((sm) => {
      const bg = sm.get("bg");
      if (bg?.media) used.add(bg.media);
      sm.get("items")?.forEach((im) => { const m = im.get("media"); if (m) used.add(m); const p = im.get("poster"); if (p) used.add(p); });
    });
    return used;
  }

  // ---- housekeeping --------------------------------------------------------------------------
  // After a merge: drop duplicate / dangling ids from the order, add slides that lost
  // their place (a concurrent move and delete), and make sure there is a slide.
  function tidy() {
    const arr = order.toArray();
    const seen = new Set();
    const drop = [];
    arr.forEach((id, i) => { if (typeof id !== "string" || seen.has(id) || !slides.has(id)) drop.push(i); else seen.add(id); });
    const missing = [];
    slides.forEach((_, id) => { if (!seen.has(id)) missing.push(id); });
    if (!drop.length && !missing.length) return false;
    ydoc.transact(() => {
      for (let i = drop.length - 1; i >= 0; i--) order.delete(drop[i], 1);
      if (missing.length) order.push(missing.sort());
    }, "tidy");
    return true;
  }

  function searchText(max = 200_000, textOf = fragmentText) {
    const parts = [];
    let n = 0;
    for (const sid of slideIds()) {
      for (const it of items(sid)) {
        const fr = text(sid, it.id);
        if (fr) { const s = textOf(fr); if (s) { parts.push(s); n += s.length; } }
        if (it.t === "table") for (const c of Object.values(it.cells || {})) if (c?.text) { parts.push(String(c.text)); n += String(c.text).length; }
        if (n > max) break;
      }
      const nf = notes(sid);
      if (nf) { const s = textOf(nf); if (s) { parts.push(s); n += s.length; } }
      if (n > max) break;
    }
    return parts.join("\n").slice(0, max);
  }

  return {
    ydoc, meta, order, slides, media,
    init, theme, setTheme, size, setSize,
    slideIds, slide, items, item, text, notes, anims, slideMap, itemMap,
    addSlide, duplicateSlides, deleteSlides, moveSlides, setSlide, setLayout,
    addItem, updateItems, deleteItems, copyItems, pasteItems, exportSlides, importSlides, restack, group, ungroup, groupOf,
    setAnims, addMedia, mediaInfo, usedMedia, tableCell, tableInsert, tableDelete, setTableText,
    tidy, searchText,
    transact: tx,
  };
}

// The plain text in a Y.XmlFragment (paragraphs on their own lines).
export function fragmentText(fr) {
  const out = [];
  const walk = (node) => {
    if (node instanceof Y.XmlText) { out.push(node.toString().replace(/<[^>]*>/g, "")); return; }
    if (node instanceof Y.XmlElement || node instanceof Y.XmlFragment) {
      node.toArray().forEach(walk);
      if (node instanceof Y.XmlElement && /^(paragraph|heading|listItem|tableCell)$/.test(node.nodeName)) out.push("\n");
    }
  };
  walk(fr);
  return out.join("").replace(/\n{2,}/g, "\n").trim();
}
export const fragmentHasText = (fr) => !!fr && fragmentText(fr).length > 0;

// ---- Y.Xml ⇄ JSON (copying text between slides and presentations) ---------------------------
// { n: nodeName, a: attrs, c: [children] } | { d: delta } for text. Bounded so a pasted
// blob can't make a huge tree.
const MAX_NODES = 20000;
export function xmlToJson(node) {
  let count = 0;
  const walk = (x) => {
    if (++count > MAX_NODES) return null;
    if (x instanceof Y.XmlText) return { d: x.toDelta().map((op) => ({ insert: typeof op.insert === "string" ? op.insert : "", ...(op.attributes ? { attributes: op.attributes } : {}) })) };
    if (x instanceof Y.XmlElement) return { n: x.nodeName, a: x.getAttributes(), c: x.toArray().map(walk).filter(Boolean) };
    if (x instanceof Y.XmlFragment) return { c: x.toArray().map(walk).filter(Boolean) };
    return null;
  };
  return node ? walk(node) : { c: [] };
}
export function xmlFromJson(json, target = new Y.XmlFragment()) {
  let count = 0;
  const build = (j) => {
    if (!j || typeof j !== "object" || ++count > MAX_NODES) return null;
    if (Array.isArray(j.d)) {
      const t = new Y.XmlText();
      t.applyDelta(j.d.filter((op) => typeof op?.insert === "string").map((op) => ({ insert: op.insert.slice(0, 100000), ...(op.attributes && typeof op.attributes === "object" ? { attributes: op.attributes } : {}) })));
      return t;
    }
    if (typeof j.n !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(j.n)) return null;
    const el = new Y.XmlElement(j.n);
    for (const [k, v] of Object.entries(j.a || {})) if (/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(k) && (v === null || ["string", "number", "boolean"].includes(typeof v) || typeof v === "object")) el.setAttribute(k, v);
    const kids = (j.c || []).map(build).filter(Boolean);
    if (kids.length) el.insert(0, kids);
    return el;
  };
  const kids = (json?.c || []).map(build).filter(Boolean);
  if (kids.length) target.insert(target.length, kids);
  return target;
}
export function itemToJson(im) {
  const fields = {};
  im.forEach((v, k) => { if (!(v instanceof Y.AbstractType)) fields[k] = v; });
  const t = tableData(im);
  if (t) Object.assign(fields, t);
  const fr = im.get("text");
  return { fields, text: fr instanceof Y.XmlFragment ? xmlToJson(fr) : null };
}
export function itemFromJson({ fields, text }) {
  const im = new Y.Map();
  const table = fields?.t === "table";
  for (const [k, v] of Object.entries(fields || {})) if (k !== "id" && v !== undefined && !(table && ["cells", "rows", "cols"].includes(k))) im.set(k, v);
  if (TEXT_TYPES.has(fields?.t)) im.set("text", text ? xmlFromJson(text, new Y.XmlFragment()) : new Y.XmlFragment());
  if (table) buildTable(im, fields.rows || 2, fields.cols || 2, fields.cells);
  return im;
}
