// Video and audio on slides (SLIDES_DESIGN.md §8). Linked videos (YouTube, Vimeo or any
// https video file) use no storage; uploads are compressed on the iPhone (VideoCompress
// plugin, 720p) and kept to 60 MB a clip (audio 20 MB), stored once each by hash as a
// part of the presentation, encrypted in the Safe like everything else.

import { openDialog } from "../editor/panels.js";
import { contentId, sniffType } from "./media.js";
import { esc } from "./chrome.js";

export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const MEDIA_WARN_BYTES = 2 * 1024 * 1024 * 1024; // the design's 2 GB nudge

// A pasted link → { kind: "youtube" | "vimeo" | "file", id?, url, embed, poster? } or null.
export function parseVideoLink(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else { const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/); if (m) id = m[1]; }
  }
  if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) {
    const t = u.searchParams.get("t") || u.searchParams.get("start");
    const start = t ? (/^\d+$/.test(t) ? Number(t) : (Number(t.match(/(\d+)h/)?.[1] || 0) * 3600 + Number(t.match(/(\d+)m/)?.[1] || 0) * 60 + Number(t.match(/(\d+)s/)?.[1] || 0))) : 0;
    return { kind: "youtube", id, url: `https://www.youtube.com/watch?v=${id}`, poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, start };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = u.pathname.match(/(?:\/video)?\/(\d{5,12})/);
    if (m) return { kind: "vimeo", id: m[1], url: `https://vimeo.com/${m[1]}`, poster: null, start: 0 };
  }
  if (/\.(mp4|m4v|webm|mov|mp3|m4a|aac|ogg|wav)(\?|$)/i.test(u.pathname)) return { kind: "file", url: u.href, poster: null, start: 0 };
  return null;
}

export function embedUrl(link, { autoplay = false, mute = false, loop = false, start = 0, end = 0, controls = true } = {}) {
  const p = parseVideoLink(link);
  if (!p) return null;
  if (p.kind === "youtube") {
    const q = new URLSearchParams({ rel: "0", modestbranding: "1", playsinline: "1", autoplay: autoplay ? "1" : "0", mute: mute ? "1" : "0", controls: controls ? "1" : "0" });
    if (start || p.start) q.set("start", String(Math.floor(start || p.start)));
    if (end) q.set("end", String(Math.floor(end)));
    if (loop) { q.set("loop", "1"); q.set("playlist", p.id); }
    return `https://www.youtube-nocookie.com/embed/${p.id}?${q}`;
  }
  if (p.kind === "vimeo") {
    const q = new URLSearchParams({ autoplay: autoplay ? "1" : "0", muted: mute ? "1" : "0", loop: loop ? "1" : "0", playsinline: "1" });
    return `https://player.vimeo.com/video/${p.id}?${q}${start ? `#t=${Math.floor(start)}s` : ""}`;
  }
  return null;
}

const fmtMB = (n) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

// How much uploaded media this presentation holds.
export function mediaBytes(model) {
  let n = 0;
  model.media.forEach((v) => { if (v && (v.kind === "video" || v.kind === "audio") && Number(v.size) > 0) n += Number(v.size); });
  return n;
}

// A poster frame and the length of an uploaded video (laptop and phone browsers).
async function videoInfo(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error("That video couldn't be read.")); setTimeout(() => rej(new Error("That video took too long to read.")), 20000); });
    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    try { v.currentTime = Math.min(1, duration / 3); await new Promise((r) => { v.onseeked = r; setTimeout(r, 2000); }); } catch { /* first frame */ }
    const w = v.videoWidth || 1280, h = v.videoHeight || 720;
    const k = Math.min(1, 1280 / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    const poster = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
    return { duration, w, h, poster: poster ? new Uint8Array(await poster.arrayBuffer()) : null };
  } finally { URL.revokeObjectURL(url); }
}
async function audioInfo(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("audio");
    a.preload = "metadata"; a.src = url;
    await new Promise((res) => { a.onloadedmetadata = res; a.onerror = res; setTimeout(res, 8000); });
    return { duration: Number.isFinite(a.duration) ? a.duration : 0 };
  } finally { URL.revokeObjectURL(url); }
}

export async function addMediaDialog({ root, kind, model, store, media, sid, deps = {}, toast = () => {}, onAdded }) {
  const used = mediaBytes(model);
  const isVideo = kind === "video";
  const { value, form } = await openDialog(root, {
    title: isVideo ? "Insert video" : "Insert audio",
    body: `${isVideo ? `<label>Paste a YouTube or Vimeo link (uses no storage)<input type="url" name="link" placeholder="https://www.youtube.com/watch?v=…" inputmode="url"></label>
      <p class="msg-muted" style="margin:4px 0">or</p>` : `<label>Paste a link to an audio file<input type="url" name="link" placeholder="https://…/song.mp3" inputmode="url"></label><p class="msg-muted" style="margin:4px 0">or</p>`}
      ${isVideo && deps.pickVideo ? `<p class="msg-muted" style="margin:0">Choose a video from your photos. It's compressed to 720p on this phone and kept to 60 MB (about 3 minutes).</p>` : `<label>Upload ${isVideo ? "a video (up to 60 MB, about 3 minutes; MP4, MOV or WebM)" : "an audio file (up to 20 MB)"}<input type="file" name="file" accept="${isVideo ? "video/*" : "audio/*"}"></label>`}
      <p class="msg-muted" style="font-size:.8rem">Media in this presentation so far: ${fmtMB(used)}.</p>`,
    actions: [{ label: "Cancel", value: null }, ...(isVideo && deps.pickVideo ? [{ label: "Choose a video", value: "pick" }] : []), { label: "Insert", value: "ok", primary: true }],
  });
  if (value !== "ok" && value !== "pick") return;
  const link = value === "pick" ? "" : form.link?.value.trim();
  let file = form.file?.files?.[0];
  const [W, H] = model.size();
  try {
    if (link) {
      const p = parseVideoLink(link);
      if (!p) throw new Error(isVideo ? "That link isn't a YouTube, Vimeo or video file link." : "That isn't a link to an audio file.");
      if (!isVideo && p.kind !== "file") throw new Error("That isn't a link to an audio file.");
      const w = isVideo ? Math.round(W * 0.6) : 160, h = isVideo ? Math.round((w * 9) / 16) : 160;
      const id = model.addItem(sid, { t: kind, link: p.url, posterUrl: p.poster || undefined, x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h, play: "click", start: p.start || undefined, controls: true });
      if (deps.isSafe) toast("Linked videos in the Safe let that site know you're watching.");
      onAdded?.(id);
      return;
    }
    if (value === "pick") {
      toast("Compressing the video…");
      file = await deps.pickVideo({ maxBytes: MAX_VIDEO_BYTES }); // the iPhone plugin: 720p H.264/AAC → Blob, or null
    }
    if (!file) return;
    const blob = file;
    const cap = isVideo ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
    if (blob.size > cap) throw new Error(isVideo ? `That video is ${fmtMB(blob.size)} after compression. Clips are kept to 60 MB (about 3 minutes); trim it, or paste a YouTube link instead.` : `That audio is ${fmtMB(blob.size)}; files are kept to 20 MB.`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mime = sniffType(bytes);
    if (isVideo ? !/^video\//.test(mime) : !/^audio\//.test(mime)) throw new Error(isVideo ? "That file isn't a video this can play (MP4, MOV or WebM)." : "That file isn't audio this can play (MP3, M4A, WAV or OGG).");
    if (used + bytes.length > MEDIA_WARN_BYTES) toast("Heads up: this presentation now holds over 2 GB of media.");
    const info = isVideo ? await videoInfo(blob) : await audioInfo(blob);
    const id = await contentId(bytes);
    let posterId = null;
    if (!model.mediaInfo(id)) {
      toast(`Saving the ${kind}…`);
      await store.images.put(id, bytes);
      if (info.poster) { posterId = await contentId(info.poster); await store.images.put(posterId, info.poster); media.put(posterId, info.poster); }
      model.addMedia(id, { kind, mime, size: bytes.length, w: info.w || 0, h: info.h || 0, duration: Math.round(info.duration || 0), poster: posterId });
    } else posterId = model.mediaInfo(id).poster || null;
    media.put(id, bytes);
    const w = isVideo ? Math.round(W * 0.6) : 160;
    const h = isVideo ? Math.round(w * ((info.h || 9) / (info.w || 16))) : 160;
    const iid = model.addItem(sid, { t: kind, media: id, poster: posterId || undefined, x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h, play: "click", controls: true });
    onAdded?.(iid);
  } catch (e) { toast(e?.message || `That ${kind} couldn't be added.`); }
}

// ---- playing while presenting -------------------------------------------------------------------
// Puts real players over a shown slide's video and audio items. → [{ stop() }]
const across = new Map(); // audio set to keep playing on the next slides, by item id
export function liveMedia(slideEl, model, sid, media, { keepAcross = false } = {}) {
  const out = [];
  const keep = new Set();
  for (const it of model.items(sid)) {
    if (it.t !== "video" && it.t !== "audio") continue;
    const box = slideEl.querySelector(`[data-item="${CSS.escape(it.id)}"] .sl-media-box`);
    if (!box) continue;
    const auto = it.play === "auto";
    if (it.link && parseVideoLink(it.link)?.kind !== "file") {
      const src = embedUrl(it.link, { autoplay: auto, mute: !!it.mute, loop: !!it.loop, start: it.start || 0, end: it.end || 0 });
      if (!src) continue;
      const mount = () => {
        const f = document.createElement("iframe");
        f.className = "sl-live-media";
        f.src = src;
        f.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
        f.referrerPolicy = "strict-origin-when-cross-origin";
        f.title = it.alt || "Video";
        box.replaceChildren(f);
      };
      if (auto || it.play === "manual") mount();
      else box.addEventListener("click", (e) => { e.stopPropagation(); mount(); }, { once: true });
      out.push({ stop: () => box.querySelector("iframe")?.remove() });
      continue;
    }
    if (it.t === "audio" && it.acrossSlides && keepAcross && across.has(it.id)) { keep.add(it.id); continue; }
    const url = it.link || media.url(it.media);
    if (!url) continue;
    const el = document.createElement(it.t);
    el.className = "sl-live-media";
    el.src = url;
    el.playsInline = true;
    el.controls = it.controls !== false && it.t === "video";
    el.muted = !!it.mute;
    el.loop = !!it.loop;
    if (it.poster) { const p = media.url(it.poster); if (p) el.poster = p; }
    const start = Number(it.start) || 0, end = Number(it.end) || 0;
    el.addEventListener("loadedmetadata", () => { if (start) el.currentTime = start; });
    if (end) el.addEventListener("timeupdate", () => { if (el.currentTime >= end) { if (it.loop) el.currentTime = start; else el.pause(); } });
    if (it.t === "audio") { el.style.opacity = "0"; box.appendChild(el); } else box.replaceChildren(el);
    const play = () => el.play().catch(() => { el.controls = true; });
    if (auto) play();
    else if (it.play !== "manual") box.addEventListener("click", (e) => { e.stopPropagation(); if (el.paused) play(); else el.pause(); });
    const handle = { stop: () => { el.pause(); el.removeAttribute("src"); el.load?.(); el.remove(); across.delete(it.id); } };
    if (it.t === "audio" && it.acrossSlides && keepAcross) { across.set(it.id, { el, handle, sid }); keep.add(it.id); document.body.appendChild(el); }
    else out.push(handle);
  }
  return out;
}
export function stopAllAcross() { for (const { handle } of across.values()) handle.stop(); across.clear(); }

void esc;
