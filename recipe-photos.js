// recipe-photos.js — pure helpers for recipe photos (RECIPE_PHOTOS_DESIGN.md).
//
// A recipe has ONE photo field, `photoUrl` (decision 2026-10-16), and its value
// says what kind of photo it is:
//   • a storage path ("<user>/<recipe>/recipe-<ts>.jpg") → Luke's own photo, in the
//     PUBLIC `recipe-photos` bucket, served from its stable public URL (decision:
//     public-by-unguessable-path) so each device downloads it once and caches it;
//   • an https URL that isn't Supabase → the recipe website's photo, hotlinked;
//   • "" → no photo.
// Older values are full Supabase public or signed URLs; they still resolve to
// their storage path. No image bytes ever go into state or rows — only this
// string.

export const RECIPE_PHOTO_BUCKET = "recipe-photos";
export const RECIPE_PHOTO_THUMB_SUFFIX = "-thumb";

const PUBLIC_MARKER = `/storage/v1/object/public/${RECIPE_PHOTO_BUCKET}/`;
const SIGNED_MARKER = `/storage/v1/object/sign/${RECIPE_PHOTO_BUCKET}/`;
const AUTH_MARKER = `/storage/v1/object/authenticated/${RECIPE_PHOTO_BUCKET}/`;

function isSupabaseUrl(value) {
  return /^https?:\/\/[^/]*\.supabase\.co\//i.test(value);
}

// The storage path for an own photo, or "" for a website photo / nothing.
export function recipePhotoStoragePath(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) {
    if (!isSupabaseUrl(v)) return "";
    for (const marker of [PUBLIC_MARKER, SIGNED_MARKER, AUTH_MARKER]) {
      const at = v.indexOf(marker);
      if (at !== -1) return safeDecode(v.slice(at + marker.length).split(/[?#]/)[0]);
    }
    return "";
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return ""; // data:, blob:, capacitor: … never a stored path
  return v.replace(/^\/+/, "");
}

export function recipePhotoKind(value) {
  const v = String(value || "").trim();
  if (!v) return "none";
  if (recipePhotoStoragePath(v)) return "own";
  return /^https?:\/\//i.test(v) ? "web" : "none";
}

// "<dir>/recipe-123.jpg" → "<dir>/recipe-123-thumb.jpg"
export function recipePhotoThumbPath(path) {
  const p = String(path || "");
  if (!p) return "";
  const dot = p.lastIndexOf(".");
  const slash = p.lastIndexOf("/");
  if (dot <= slash) return p + RECIPE_PHOTO_THUMB_SUFFIX;
  return p.slice(0, dot) + RECIPE_PHOTO_THUMB_SUFFIX + p.slice(dot);
}

export function recipePhotoPublicUrl(path, supabaseUrl) {
  const base = String(supabaseUrl || "").replace(/\/+$/, "");
  const p = String(path || "").replace(/^\/+/, "");
  if (!base || !p) return "";
  return base + PUBLIC_MARKER + p.split("/").map(encodeURIComponent).join("/");
}

// What an <img> should load. Own photos → stable public URL (thumbnail variant on
// request); website photos → as stored; anything else → "".
export function recipePhotoDisplayUrl(value, { supabaseUrl = "", thumb = false } = {}) {
  const kind = recipePhotoKind(value);
  if (kind === "web") return String(value).trim();
  if (kind !== "own") return "";
  const path = recipePhotoStoragePath(value);
  return recipePhotoPublicUrl(thumb ? recipePhotoThumbPath(path) : path, supabaseUrl);
}

// True for a recipe-photos public URL — the service worker caches these cache-first.
export function isRecipePhotoPublicUrl(url) {
  return typeof url === "string" && isSupabaseUrl(url) && url.includes(PUBLIC_MARKER);
}

// JSON-LD `image`: "url" | ["url", …] | {url} | {contentUrl} | [{url}, …].
// Twin of pickImageUrl in netlify/functions/_recipe-photo.js (same tests).
export function pickImageUrl(value, pageUrl = "") {
  const list = Array.isArray(value) ? value : [value];
  for (const item of list) {
    const raw = typeof item === "string"
      ? item
      : (item && typeof item === "object" ? (item.url || item.contentUrl || item["@id"] || "") : "");
    const url = absoluteHttpsUrl(Array.isArray(raw) ? raw[0] : raw, pageUrl);
    if (url) return url;
  }
  return "";
}

export function absoluteHttpsUrl(raw, pageUrl = "") {
  const value = String(raw || "").trim();
  if (!value || value.length > 2000 || /^data:/i.test(value)) return "";
  let url;
  try { url = pageUrl ? new URL(value, pageUrl) : new URL(value); } catch { return ""; }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") return "";
  return url.toString();
}

// The one-time backfill: recipes that have a website link and no photo. Distinct
// source URLs, in recipe order.
export function recipesNeedingWebsitePhoto(recipes) {
  const out = [];
  for (const recipe of recipes || []) {
    if (!recipe || recipe.photoUrl) continue;
    const sourceUrl = String(recipe.sourceUrl || "").trim();
    if (!/^https?:\/\//i.test(sourceUrl)) continue;
    out.push({ id: recipe.id, sourceUrl });
  }
  return out;
}

// Apply looked-up photos: only to recipes that STILL have no photo (an upload or
// another device may have got there first) and only a real https URL.
// Returns the ids changed.
export function applyWebsitePhotos(recipes, photosBySourceUrl) {
  const changed = [];
  for (const recipe of recipes || []) {
    if (!recipe || recipe.photoUrl) continue;
    const photo = photosBySourceUrl?.[String(recipe.sourceUrl || "").trim()];
    if (typeof photo !== "string" || recipePhotoKind(photo) !== "web") continue;
    recipe.photoUrl = photo;
    changed.push(recipe.id);
  }
  return changed;
}

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}
