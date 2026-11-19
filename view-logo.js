// A view's own logo (Luke, 2026-11-04) — Settings › Display, per view.
//
// Replaces the sailboat on the landing page for one view (Household, Personal,
// Business), like a profile photo replaces the initials, and follows the same
// egress rules as the photo (profile.js):
//   • the device shrinks the picture before upload — longest side LOGO_MAX px,
//     a PNG so a logo's transparent background stays transparent;
//   • it lives in the public `avatars` Storage bucket at
//     `<userId>/logo-<view>.png` (migrations/2026-11-04-view-logos.sql lets that
//     bucket take PNGs), never in tableplan_states;
//   • its version is a tiny stamp per view in the user's auth metadata
//     (`logo_v: { household: "…" }`);
//   • each device keeps a data-URL copy and downloads again only when that
//     version changes — nothing on a timer.
// Logos are per person: the name and look of each view are the person's own.

import { AVATAR_BUCKET } from "./profile.js";

export const LOGO_MAX = 640;          // px, longest side
export const LOGO_MAX_BYTES = 480_000; // the bucket takes up to 512 KB
const CACHE_PREFIX = "live_view_logo_";
const VIEW_RE = /^[a-z]+$/;

function cacheKey(userId, view) { return `${CACHE_PREFIX}${userId}_${view}`; }

export function logoObjectPath(userId, view) {
  if (!VIEW_RE.test(String(view || ""))) throw new Error("Unknown view");
  return `${userId}/logo-${view}.png`;
}
export function logoPublicUrl(baseUrl, userId, view, version) {
  return `${String(baseUrl).replace(/\/$/, "")}/storage/v1/object/public/${AVATAR_BUCKET}/${logoObjectPath(userId, view)}?v=${encodeURIComponent(version)}`;
}

// The version stamp for one view out of the user's auth metadata ("" = none).
export function logoVersion(metadata, view) {
  const all = metadata?.logo_v;
  const v = all && typeof all === "object" ? all[view] : "";
  return v == null ? "" : String(v);
}

export function readCachedLogo(userId, view, storage = globalThis.localStorage) {
  if (!userId || !view) return null;
  try {
    const raw = storage?.getItem(cacheKey(userId, view));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return (v && typeof v.dataUrl === "string" && v.dataUrl.startsWith("data:image/")) ? v : null;
  } catch { return null; }
}
export function writeCachedLogo(userId, view, version, dataUrl, storage = globalThis.localStorage) {
  if (!userId || !view) return;
  try {
    if (!dataUrl) storage?.removeItem(cacheKey(userId, view));
    else storage?.setItem(cacheKey(userId, view), JSON.stringify({ v: String(version || ""), dataUrl }));
  } catch { /* storage full or private mode — the logo just reloads next time */ }
}

// The "download only on change" rule, pure for tests.
export function logoPlan(version, cached) {
  const v = version == null ? "" : String(version);
  if (!v) return { action: "none" };
  if (cached && cached.v === v) return { action: "cached", dataUrl: cached.dataUrl };
  return { action: "fetch" };
}

// Fit (w, h) inside max × max, never enlarging.
export function fitWithin(w, h, max = LOGO_MAX) {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

// Shrink a picked image to a PNG no bigger than LOGO_MAX on its longest side,
// keeping its shape and any transparency. Steps down if the PNG is still too
// heavy (a photo makes a big PNG). Decodes through an <img> so iPhone HEIC works.
export async function resizeImageToLogo(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file isn't an image this device can read."));
      el.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error("That image is empty.");
    for (const max of [LOGO_MAX, 480, 360, 256]) {
      const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, max);
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, width, height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Couldn't prepare that picture.");
      if (blob.size <= LOGO_MAX_BYTES) return { blob, dataUrl: await blobToDataUrl(blob) };
    }
    throw new Error("That picture is too detailed to use as a logo. Try a simpler image.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Upload (or replace) one view's logo, then stamp its version on the auth
// metadata so the person's other devices pick it up. Returns the new version.
export async function uploadLogo({ supabaseClient, userId, view, blob, metadata }) {
  if (!supabaseClient || !userId) throw new Error("Sign in to add a logo.");
  const { error } = await supabaseClient.storage.from(AVATAR_BUCKET).upload(logoObjectPath(userId, view), blob, {
    upsert: true, contentType: "image/png", cacheControl: "31536000",
  });
  if (error) {
    const msg = String(error.message || "");
    if (/mime|type/i.test(msg)) throw new Error("Logos can't be saved yet: the storage update hasn't been applied (migrations/2026-11-04-view-logos.sql).");
    throw new Error(msg || "Upload failed");
  }
  const version = String(Date.now());
  const logo_v = { ...(metadata?.logo_v && typeof metadata.logo_v === "object" ? metadata.logo_v : {}), [view]: version };
  const { error: metaErr } = await supabaseClient.auth.updateUser({ data: { logo_v } });
  if (metaErr) throw new Error(metaErr.message || "Couldn't save the logo");
  return { version, logo_v };
}

export async function removeLogo({ supabaseClient, userId, view, metadata }) {
  if (!supabaseClient || !userId) return { logo_v: {} };
  await supabaseClient.storage.from(AVATAR_BUCKET).remove([logoObjectPath(userId, view)]).catch(() => {});
  const logo_v = { ...(metadata?.logo_v && typeof metadata.logo_v === "object" ? metadata.logo_v : {}) };
  delete logo_v[view];
  const { error } = await supabaseClient.auth.updateUser({ data: { logo_v } });
  if (error) throw new Error(error.message || "Couldn't remove the logo");
  return { logo_v };
}

// One view's logo as a data URL, downloading only when its version changed.
// Never throws; "" when there's none or it can't load.
export async function loadLogo({ baseUrl, userId, view, version, fetchImpl = globalThis.fetch }) {
  const plan = logoPlan(version, readCachedLogo(userId, view));
  if (plan.action === "none") { writeCachedLogo(userId, view, "", ""); return ""; }
  if (plan.action === "cached") return plan.dataUrl;
  try {
    const res = await fetchImpl(logoPublicUrl(baseUrl, userId, view, version));
    if (!res.ok) return "";
    const dataUrl = await blobToDataUrl(await res.blob());
    if (!dataUrl.startsWith("data:image/")) return "";
    writeCachedLogo(userId, view, version, dataUrl);
    return dataUrl;
  } catch { return ""; }
}
