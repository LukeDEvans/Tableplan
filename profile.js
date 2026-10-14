// Profile — pure helpers for the Profile window plus the profile photo client.
//
// The photo is kept tiny and off the synced state on purpose (Supabase egress):
//   • the device resizes it to a 256px square JPEG (~15–25 KB) before upload;
//   • it lives in the public `avatars` Storage bucket at `<userId>/avatar.jpg`
//     (migrations/2026-10-13-profile-avatars.sql), never in tableplan_states;
//   • its version is a tiny number in the user's auth metadata (`avatar_v`);
//   • each device keeps a data-URL copy in localStorage and downloads the image
//     again only when that version changes — so ~one small fetch per device per
//     photo change, and nothing on a timer.

const AVATAR_SIZE = 256;
const AVATAR_QUALITY = 0.85;
export const AVATAR_BUCKET = "avatars";
const CACHE_PREFIX = "live_avatar_";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Up to two initials from a display name ("Luke Evans" → "LE", "luke" → "L").
export function profileInitials(name) {
  return String(name || "").trim().split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).slice(0, 2).join("");
}

// Parse a YYYY-MM-DD birthday. Returns null when it isn't a real date.
export function parseDob(dob) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || "").trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return { y, mo, d };
}

// What the Profile shows for a birthday: the date, and a friendly line about the
// next one. `now` is injectable for tests. Feb 29 birthdays fall on Feb 28 in
// non-leap years.
export function birthdaySummary(dob, now = new Date()) {
  const p = parseDob(dob);
  if (!p) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const onYear = (yr) => {
    const leap = (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
    const day = p.mo === 2 && p.d === 29 && !leap ? 28 : p.d;
    return new Date(yr, p.mo - 1, day);
  };
  let next = onYear(today.getFullYear());
  if (next < today) next = onYear(today.getFullYear() + 1);
  const days = Math.round((next - today) / 86400000);
  const turning = next.getFullYear() - p.y;
  const dateLabel = `${MONTHS[p.mo - 1]} ${p.d}, ${p.y}`;
  if (turning <= 0) return { dateLabel, detail: "", age: null, daysUntil: days };
  const age = days === 0 ? turning : turning - 1;
  let detail;
  if (days === 0) detail = `Happy birthday — ${turning} today`;
  else if (days === 1) detail = `Turns ${turning} tomorrow`;
  else if (days < 60) detail = `Turns ${turning} in ${days} days`;
  else detail = `${age} years old`;
  return { dateLabel, detail, age, daysUntil: days };
}

// ── Photo cache (per device) ──────────────────────────────────────────────────

function cacheKey(userId) { return CACHE_PREFIX + String(userId || ""); }

export function readCachedAvatar(userId, storage = globalThis.localStorage) {
  if (!userId) return null;
  try {
    const raw = storage?.getItem(cacheKey(userId));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return (v && typeof v.dataUrl === "string" && v.dataUrl.startsWith("data:image/")) ? v : null;
  } catch { return null; }
}

export function writeCachedAvatar(userId, version, dataUrl, storage = globalThis.localStorage) {
  if (!userId) return;
  try {
    if (!dataUrl) storage?.removeItem(cacheKey(userId));
    else storage?.setItem(cacheKey(userId), JSON.stringify({ v: String(version || ""), dataUrl }));
  } catch { /* storage full or private mode — the photo just reloads next time */ }
}

// Decide what to do for a user's photo given the version in their auth metadata
// and the device copy. Pure, so the "download only on change" rule is testable.
//   → { action: "none" }            no photo set
//   → { action: "cached", dataUrl } device copy is current
//   → { action: "fetch" }           version changed (or no copy yet)
export function avatarPlan(version, cached) {
  const v = version == null ? "" : String(version);
  if (!v) return { action: "none" };
  if (cached && cached.v === v) return { action: "cached", dataUrl: cached.dataUrl };
  return { action: "fetch" };
}

export function avatarObjectPath(userId) { return `${userId}/avatar.jpg`; }

export function avatarPublicUrl(baseUrl, userId, version) {
  return `${String(baseUrl).replace(/\/$/, "")}/storage/v1/object/public/${AVATAR_BUCKET}/${avatarObjectPath(userId)}?v=${encodeURIComponent(version)}`;
}

// ── Browser-only helpers ──────────────────────────────────────────────────────

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

// Centre-crop a picked image to a square and shrink it to AVATAR_SIZE. Decodes
// through an <img> (not createImageBitmap) so iPhone HEIC photos work in WebKit.
export async function resizeImageToAvatar(file, size = AVATAR_SIZE) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file isn't an image this device can read."));
      el.src = url;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error("That image is empty.");
    const side = Math.min(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", AVATAR_QUALITY));
    if (!blob) throw new Error("Couldn't prepare that photo.");
    return { blob, dataUrl: await blobToDataUrl(blob) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Upload (or replace) the user's photo, then stamp the new version on their auth
// metadata so their other devices pick it up. Returns the new version.
export async function uploadAvatar({ supabaseClient, userId, blob }) {
  if (!supabaseClient || !userId) throw new Error("Sign in to add a photo.");
  const { error } = await supabaseClient.storage.from(AVATAR_BUCKET).upload(avatarObjectPath(userId), blob, {
    upsert: true, contentType: "image/jpeg", cacheControl: "31536000",
  });
  if (error) throw new Error(error.message || "Upload failed");
  const version = String(Date.now());
  const { error: metaErr } = await supabaseClient.auth.updateUser({ data: { avatar_v: version } });
  if (metaErr) throw new Error(metaErr.message || "Couldn't save the photo");
  return version;
}

export async function removeAvatar({ supabaseClient, userId }) {
  if (!supabaseClient || !userId) return;
  await supabaseClient.storage.from(AVATAR_BUCKET).remove([avatarObjectPath(userId)]).catch(() => {});
  const { error } = await supabaseClient.auth.updateUser({ data: { avatar_v: null } });
  if (error) throw new Error(error.message || "Couldn't remove the photo");
}

// Resolve the user's photo to a data URL, downloading only when the version
// changed. Never throws; returns "" when there's no photo or it can't load.
export async function loadAvatar({ baseUrl, userId, version, fetchImpl = globalThis.fetch }) {
  const plan = avatarPlan(version, readCachedAvatar(userId));
  if (plan.action === "none") { writeCachedAvatar(userId, "", ""); return ""; }
  if (plan.action === "cached") return plan.dataUrl;
  try {
    const res = await fetchImpl(avatarPublicUrl(baseUrl, userId, version));
    if (!res.ok) return "";
    const dataUrl = await blobToDataUrl(await res.blob());
    if (!dataUrl.startsWith("data:image/")) return "";
    writeCachedAvatar(userId, version, dataUrl);
    return dataUrl;
  } catch { return ""; }
}
