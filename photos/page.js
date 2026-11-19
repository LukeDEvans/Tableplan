// photos/page.js — the Photos page (PHOTOS_DESIGN.md §7, step 3). Personal only until
// step 4 (Luke, 2026-11-16).
//
// • Tabs: All · Favourites · Recently deleted.
// • Timeline: newest first under month headings; only the rows on screen are drawn
//   (photos/grid.js), thumbnails come from the device's cache or storage
//   (photos/library.js).
// • Photo view: swipe between photos. On the iPhone that has the photo: full size,
//   video, Share (the share sheet), Favourite, Markup (saved as an edit of the photo,
//   Luke 2026-11-16) and Delete (from Liv and the phone's library; iOS asks first).
//   Elsewhere (the laptop) it shows the thumbnail, and Favourite and Delete work in
//   Liv; a delete reaches the phone the next time Photos opens there.
//
// mountPhotosPage(root, deps) → { show(scope), hide(), destroy() }
// deps: rest, presign, plugin (PhotoLibrary or null), convertFileSrc, putFetch,
//       toast(text), confirm(text) → boolean

import { createPhotoLibrary, viewOf, daysLeft } from "./library.js";
import { createPhotosCache } from "./cache.js";
import { layout, visibleRows, durationText } from "./grid.js";

const TABS = [
  { key: "all", label: "All" },
  { key: "favorites", label: "Favourites" },
  { key: "deleted", label: "Recently deleted" },
];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function longDate(iso) {
  if (!iso) return "No date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "No date";
  return d.toLocaleString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const b64ToBytes = (b64) => { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i); return out; };

export function mountPhotosPage(root, deps) {
  const { rest, presign, plugin = null, convertFileSrc = (p) => p, putFetch, toast = () => {}, confirm = (t) => globalThis.confirm(t) } = deps;
  const cache = createPhotosCache();
  const library = createPhotoLibrary({ rest, presign, store: cache });
  const canPhone = !!(plugin && typeof plugin.image === "function");

  let scope = null;
  let tab = "all";
  let list = [];
  let geo = null;           // layout()
  let drawn = "";           // which rows are on screen, to skip needless redraws
  let deviceKey = null;
  let opening = null;       // AbortController for the pull in progress
  let visible = false;
  let syncSub = null;
  const urls = new Map();   // id → object URL of its thumbnail (newest last)
  let wanted = new Set();   // ids on screen still waiting for a thumbnail
  let thumbTimer = 0;

  root.innerHTML = `
    <div class="photos-page">
      <div class="photos-head">
        <div class="photos-tabs" role="tablist" aria-label="Photos">
          ${TABS.map((t) => `<button type="button" role="tab" data-photos-tab="${t.key}" aria-selected="${t.key === tab}">${esc(t.label)}</button>`).join("")}
        </div>
        <span class="photos-count" aria-live="polite"></span>
      </div>
      ${canPhone ? "" : `<p class="photos-note">Thumbnails here; full size, video, sharing and Markup are on your iPhone.</p>`}
      <div class="photos-scroll"><div class="photos-canvas"></div><div class="photos-empty" hidden></div></div>
    </div>`;
  const scroller = root.querySelector(".photos-scroll");
  const canvas = root.querySelector(".photos-canvas");
  const empty = root.querySelector(".photos-empty");
  const countEl = root.querySelector(".photos-count");

  // ---- thumbnails -------------------------------------------------------------

  function urlFor(id) {
    const u = urls.get(id);
    if (u) { urls.delete(id); urls.set(id, u); } // most recently used last
    return u || "";
  }
  function keepUrl(id, blob) {
    if (urls.has(id)) return urls.get(id);
    const u = URL.createObjectURL(blob);
    urls.set(id, u);
    while (urls.size > 800) { const [old, ou] = urls.entries().next().value; URL.revokeObjectURL(ou); urls.delete(old); }
    return u;
  }
  function forgetUrl(id) {
    const u = urls.get(id);
    if (u) { URL.revokeObjectURL(u); urls.delete(id); }
  }
  function queueThumbs(ids) {
    for (const id of ids) if (!urls.has(id)) wanted.add(id);
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(loadThumbs, 120); // wait for a fast scroll to settle
  }
  async function loadThumbs() {
    const ids = [...wanted].slice(0, 100);
    wanted = new Set([...wanted].slice(100));
    if (!ids.length) return;
    const got = await library.thumbs(ids);
    for (const [id, blob] of got) {
      const u = keepUrl(id, blob);
      canvas.querySelectorAll(`[data-id="${id}"] img`).forEach((img) => { img.src = u; });
    }
    if (wanted.size) loadThumbs();
  }

  // ---- the grid ---------------------------------------------------------------

  // The page scrolls with the window (so a tap on the status bar goes to the top).
  function viewport() {
    const top = canvas.getBoundingClientRect().top;
    return { scrollTop: Math.max(0, -top), height: window.innerHeight };
  }

  function relayout() {
    const width = canvas.clientWidth || scroller.clientWidth || 360;
    geo = layout(list, { width, grouped: tab !== "deleted" });
    canvas.style.height = `${geo.height}px`;
    drawn = "";
    draw();
  }

  function draw() {
    if (!geo || !visible) return;
    const vp = viewport();
    const rows = visibleRows(geo.rows, vp.scrollTop, vp.height);
    const sig = rows.length ? `${rows[0].y}:${rows[rows.length - 1].y}:${list.length}` : "none";
    if (sig === drawn) return;
    drawn = sig;
    const need = [];
    canvas.innerHTML = rows.map((r) => {
      if (r.type === "head") return `<div class="photos-month" style="top:${r.y}px;height:${r.h}px">${esc(r.label)}</div>`;
      let html = "";
      for (let i = r.start; i < r.end; i += 1) {
        const p = list[i];
        const col = i - r.start;
        const u = urlFor(p.id);
        if (!u && p.has_thumb) need.push(p.id);
        const badge = p.kind === "video" ? `<span class="photos-badge">${esc(durationText(p.duration))}</span>`
          : (tab === "deleted" && p.deleted_at ? `<span class="photos-badge">${daysLeft(p.deleted_at)} d</span>` : "");
        html += `<button type="button" class="photos-cell" data-id="${esc(p.id)}" data-index="${i}" style="left:${col * (geo.cell + geo.gap)}px;top:${r.y}px;width:${geo.cell}px;height:${geo.cell}px" aria-label="${esc(p.kind === "video" ? "Video" : "Photo")}, ${esc(longDate(p.taken_at))}">${u ? `<img src="${u}" alt="" draggable="false">` : `<img alt="" draggable="false">`}${p.favorite && tab !== "favorites" ? `<span class="photos-fav" aria-hidden="true">♥</span>` : ""}${badge}</button>`;
      }
      return html;
    }).join("");
    if (need.length) queueThumbs(need);
  }

  let rafPending = false;
  const onScroll = () => {
    if (rafPending || !visible) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; draw(); });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  const resize = new ResizeObserver(() => { if (visible) relayout(); });
  resize.observe(scroller);

  canvas.addEventListener("click", (e) => {
    const cell = e.target.closest(".photos-cell");
    if (cell) openViewer(Number(cell.dataset.index));
  });

  root.querySelector(".photos-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-photos-tab]");
    if (!b || b.dataset.photosTab === tab) return;
    tab = b.dataset.photosTab;
    root.querySelectorAll("[data-photos-tab]").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.photosTab === tab)));
    rebuild();
    const top = root.getBoundingClientRect().top + window.scrollY - 8;
    if (window.scrollY > top) window.scrollTo(0, top);
  });

  function rebuild() {
    list = viewOf(library.items(), tab);
    const all = viewOf(library.items(), "all").length;
    countEl.textContent = tab === "all" ? `${all.toLocaleString("en-US")} photos and videos` : `${list.length.toLocaleString("en-US")}`;
    empty.hidden = list.length > 0;
    if (!list.length) {
      empty.textContent = tab === "deleted" ? "Nothing deleted in the last 30 days."
        : tab === "favorites" ? "No favourites yet. Tap ♡ on a photo to add it."
          : (canPhone ? "No photos yet. Open Settings › Beta › Photos Check and tap Sync now." : "No photos yet. Sync them from the iPhone app: Settings › Beta › Photos Check.");
    }
    relayout();
  }

  // ---- the photo view ---------------------------------------------------------

  let viewer = null;
  let at = -1;
  let viewToken = 0;

  function closeViewer() {
    viewer?.remove();
    viewer = null;
    at = -1;
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (!viewer) return;
    if (e.key === "Escape") closeViewer();
    else if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
  }
  function step(d) {
    const next = at + d;
    if (next >= 0 && next < list.length) showAt(next);
  }

  function openViewer(index) {
    if (!list[index]) return;
    if (!viewer) {
      viewer = document.createElement("div");
      viewer.className = "photos-viewer";
      viewer.setAttribute("role", "dialog");
      viewer.setAttribute("aria-modal", "true");
      viewer.setAttribute("aria-label", "Photo");
      document.body.appendChild(viewer);
      document.addEventListener("keydown", onKey);
      let x0 = null; let y0 = null;
      viewer.addEventListener("touchstart", (e) => { if (e.touches.length === 1) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; } }, { passive: true });
      viewer.addEventListener("touchend", (e) => {
        if (x0 === null) return;
        const dx = e.changedTouches[0].clientX - x0;
        const dy = e.changedTouches[0].clientY - y0;
        x0 = null;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
        else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) closeViewer();
      });
      viewer.addEventListener("click", onViewerClick);
    }
    showAt(index);
  }

  async function showAt(index) {
    at = index;
    const p = list[index];
    const token = ++viewToken;
    const deleted = !!p.deleted_at;
    const thumb = urlFor(p.id);
    viewer.innerHTML = `
      <div class="photos-viewer-top">
        <div class="photos-viewer-when">${esc(longDate(p.taken_at))}${p.kind === "video" ? ` · ${esc(durationText(p.duration))}` : ""}</div>
        <button type="button" class="photos-viewer-close" data-act="close">Done</button>
      </div>
      <div class="photos-viewer-stage">
        <img class="photos-viewer-img" alt="" src="${thumb}" draggable="false">
        ${p.kind === "video" && canPhone ? `<button type="button" class="photos-play" data-act="play" aria-label="Play video">▶</button>` : ""}
      </div>
      <p class="photos-viewer-note" hidden></p>
      <div class="photos-viewer-actions">
        ${deleted
          ? `<span class="photos-viewer-left">${daysLeft(p.deleted_at)} days left</span><button type="button" data-act="restore">Put back</button>`
          : `${canPhone ? `<button type="button" data-act="share">Share</button>` : ""}
             ${canPhone && p.kind === "photo" ? `<button type="button" data-act="markup">Markup</button>` : ""}
             <button type="button" data-act="fav" aria-pressed="${!!p.favorite}" aria-label="${p.favorite ? "Unfavourite" : "Favourite"}">${p.favorite ? "♥" : "♡"}</button>
             <button type="button" data-act="delete" class="is-danger">Delete</button>`}
      </div>`;
    if (!thumb && p.has_thumb) {
      const got = await library.thumbs([p.id]);
      const blob = got.get(p.id);
      if (blob && token === viewToken) viewer.querySelector(".photos-viewer-img").src = keepUrl(p.id, blob);
    }
    if (canPhone && !deleted && p.kind === "photo") {
      const localId = await localIdOf(p.id);
      if (token !== viewToken) return;
      if (!localId) { note("This photo isn't on this iPhone, so it shows small."); return; }
      try {
        const { path } = await plugin.image({ id: localId, size: 2048 });
        if (token === viewToken && viewer) viewer.querySelector(".photos-viewer-img").src = convertFileSrc(path);
      } catch { if (token === viewToken) note("Couldn't open the full photo."); }
    } else if (!canPhone && !deleted) {
      note(p.kind === "video" ? "Videos play on your iPhone." : "Full size is on your iPhone.");
    }
  }

  function note(text) {
    const n = viewer?.querySelector(".photos-viewer-note");
    if (n) { n.textContent = text; n.hidden = false; }
  }

  const localIds = new Map();
  async function localIdOf(id) {
    if (!canPhone) return null;
    if (localIds.has(id)) return localIds.get(id);
    deviceKey ||= (await plugin.deviceKey().catch(() => null))?.key || null;
    const lid = await library.localIdFor(id, deviceKey).catch(() => null);
    localIds.set(id, lid);
    return lid;
  }

  async function onViewerClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b || at < 0) return;
    const p = list[at];
    const act = b.dataset.act;
    if (act === "close") { closeViewer(); return; }
    b.disabled = true;
    try {
      if (act === "play") {
        const lid = await localIdOf(p.id);
        if (!lid) { toast("This video isn't on this iPhone."); return; }
        await plugin.playVideo({ id: lid });
      } else if (act === "share") {
        const lid = await localIdOf(p.id);
        if (!lid) { toast("This photo isn't on this iPhone."); return; }
        await plugin.share({ ids: [lid] });
      } else if (act === "fav") {
        const on = !p.favorite;
        const lid = await localIdOf(p.id);
        if (lid) await plugin.favorite({ id: lid, on });
        await library.update(p.id, { favorite: on });
        refreshAfterChange(p.id);
      } else if (act === "markup") {
        const lid = await localIdOf(p.id);
        if (!lid) { toast("This photo isn't on this iPhone."); return; }
        const { saved } = await plugin.markup({ id: lid });
        if (saved) { await refreshThumb(p.id, lid); showAt(at); }
      } else if (act === "delete") {
        await deletePhoto(p);
      } else if (act === "restore") {
        await library.update(p.id, { deleted_at: null });
        const lid = await localIdOf(p.id);
        toast(canPhone && !lid ? "Put back in Liv. Its original is in the Photos app's Recently Deleted; put it back there too." : "Put back.");
        localIds.delete(p.id);
        afterRemoval();
      }
    } catch (error) {
      const code = String(error?.code || "");
      if (code !== "CANCELLED") toast(code === "DENIED" ? "Photo access is off. Turn it on for Live in iPhone Settings › Privacy › Photos." : "That didn't work. Try again.");
    } finally {
      if (b.isConnected) b.disabled = false;
    }
  }

  // Delete everywhere (decision 11): on the phone that has it, iOS asks and the photo
  // goes to its Recently Deleted; elsewhere it goes now in Liv and from the phone the
  // next time Photos opens there.
  async function deletePhoto(p) {
    const lid = await localIdOf(p.id);
    if (lid) {
      const res = await plugin.deletePhotos({ ids: [lid] }); // rejects CANCELLED if the person says no
      if (!(res?.deleted || []).length && !(res?.missing || []).length) return;
      await library.update(p.id, { deleted_at: new Date().toISOString() });
      await library.markMissing([p.id], deviceKey).catch(() => {});
      localIds.delete(p.id);
    } else {
      const msg = canPhone
        ? "Delete this photo? It isn't on this iPhone; it's removed from the phone that has it the next time Liv opens there."
        : "Delete this photo? It's removed from your iPhone (and iCloud) the next time Photos opens in Liv there.";
      if (!confirm(msg)) return;
      await library.update(p.id, { deleted_at: new Date().toISOString() });
    }
    afterRemoval();
  }

  function afterRemoval() {
    const keep = at;
    rebuild();
    if (!list.length) { closeViewer(); return; }
    showAt(Math.min(keep, list.length - 1));
  }

  function refreshAfterChange(id) {
    const keepId = id;
    rebuild();
    const i = list.findIndex((x) => x.id === keepId);
    if (i >= 0) showAt(i); else if (list.length) showAt(Math.min(at, list.length - 1)); else closeViewer();
  }

  // After Markup: a new thumbnail from the edited photo, uploaded now (the sync would
  // also do it, but only where the server has the change step, §18).
  async function refreshThumb(id, lid) {
    try {
      const shot = await plugin.thumbs({ ids: [lid] });
      const b64 = shot?.items?.[0]?.b64;
      if (!b64) return;
      const bytes = b64ToBytes(b64);
      const [signed] = await presign("put", [{ tier: "photos", fileId: id, part: "thumb", size: bytes.length }]);
      const res = await putFetch(signed.url, { method: "PUT", headers: signed.headers || {}, body: bytes });
      if (!res.ok) return;
      await library.update(id, { has_thumb: true, thumb_bytes: bytes.length });
      await library.dropThumb(id);
      forgetUrl(id);
      drawn = "";
      draw();
    } catch { /* the old thumbnail stays until the next sync */ }
  }

  // Deletes made on the laptop, carried out on this phone (one iOS confirmation). If
  // the person says no here, the photos come back in Liv: nothing is deleted from the
  // phone without its owner choosing it there.
  async function carryOutPhoneDeletes() {
    if (!canPhone || typeof plugin.deletePhotos !== "function") return;
    deviceKey ||= (await plugin.deviceKey().catch(() => null))?.key || null;
    const pending = await library.pendingPhoneDeletes(deviceKey).catch(() => []);
    if (!pending.length) return;
    try {
      const res = await plugin.deletePhotos({ ids: pending.map((x) => x.localId) });
      const done = new Set([...(res?.deleted || []), ...(res?.missing || [])]);
      await library.markMissing(pending.filter((x) => done.has(x.localId)).map((x) => x.id), deviceKey);
    } catch (error) {
      if (String(error?.code || "") === "CANCELLED") {
        for (const x of pending) await library.update(x.id, { deleted_at: null }).catch(() => {});
        toast(`Kept on your iPhone, so ${pending.length === 1 ? "that photo is" : "those photos are"} back in Liv.`);
        rebuild();
      }
    }
  }

  // ---- show / hide --------------------------------------------------------------

  async function show(nextScope) {
    visible = true;
    if (nextScope !== scope) {
      scope = nextScope;
      localIds.clear();
      for (const id of [...urls.keys()]) forgetUrl(id);
    }
    if (!syncSub && plugin && typeof plugin.addListener === "function") {
      syncSub = true;
      try { await plugin.addListener("photoSyncDone", () => { if (visible) library.refresh().then((n) => { if (n) rebuild(); }).catch(() => {}); }); } catch { /* refreshed on the next open */ }
    }
    opening?.abort();
    opening = new AbortController();
    const signal = opening.signal;
    try {
      const { changed } = await library.open(scope, { signal, onCached: (items) => { if (items.length) rebuild(); } });
      if (signal.aborted) return;
      if (changed || !list.length) rebuild();
      carryOutPhoneDeletes();
    } catch {
      if (!list.length) { empty.hidden = false; empty.textContent = "Couldn't load your photos. Check the connection and open Photos again."; }
    }
  }

  function hide() {
    visible = false;
    opening?.abort();
    closeViewer();
  }

  function destroy() {
    hide();
    resize.disconnect();
    window.removeEventListener("scroll", onScroll);
    for (const id of [...urls.keys()]) forgetUrl(id);
    cache.close();
    root.innerHTML = "";
  }

  return { show, hide, destroy };
}
