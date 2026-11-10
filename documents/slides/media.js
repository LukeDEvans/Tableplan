// Images, video and audio for slides (SLIDES_DESIGN.md §8). Images are resized on the
// device (2560 px on the long side at most) and saved once each as their own part,
// found again by hash if the same picture is added twice.

export const MAX_IMAGE_PX = 2560;
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

export function sniffType(b) {
  if (!b || b.length < 12) return "application/octet-stream";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return "image/webp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (/^M4A/.test(brand)) return "audio/mp4";
    if (/^qt/.test(brand)) return "video/quicktime";
    return "video/mp4";
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  if ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67) return "audio/ogg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x41) return "audio/wav";
  if (String.fromCharCode(...b.slice(0, 5)).toLowerCase().startsWith("<svg") || String.fromCharCode(...b.slice(0, 5)) === "<?xml") return "image/svg+xml";
  return "application/octet-stream";
}

export const hexId = (n = 16) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => x.toString(16).padStart(2, "0")).join("");

// A media id (the part name the stores accept, 32 hex characters). Everyday: the first
// 16 bytes of SHA-256, so the same picture is stored once. The Safe: random, because the
// part name is visible to the server and a hash of the plain file would let it tell
// whether a known picture is in someone's Safe.
export async function mediaId(store, bytes) {
  return store?.kind === "safe" ? hexId(16) : contentId(bytes);
}
export async function contentId(bytes) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(h.slice(0, 16), (x) => x.toString(16).padStart(2, "0")).join("");
}

// → { bytes, w, h, mime }
export async function prepareImage(file) {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") throw new Error("Only photos and pictures (JPEG, PNG, GIF, WebP, HEIC) can be added here.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("That image is larger than 30 MB.");
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error("That image couldn't be read."); }
  const w0 = bmp.width, h0 = bmp.height;
  const scale = Math.min(1, MAX_IMAGE_PX / Math.max(w0, h0));
  const keep = scale === 1 && ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type) && file.size < 5 * 1024 * 1024;
  if (keep) { bmp.close?.(); return { bytes: new Uint8Array(await file.arrayBuffer()), w: w0, h: h0, mime: file.type }; }
  const c = document.createElement("canvas");
  c.width = Math.round(w0 * scale);
  c.height = Math.round(h0 * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const png = file.type === "image/png" && c.width * c.height < 1_500_000;
  const blob = await new Promise((r) => c.toBlob(r, png ? "image/png" : "image/jpeg", 0.86));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height, mime: png ? "image/png" : "image/jpeg" };
}

// Blob URLs for a presentation's media, loaded once each from the store.
export function mediaCache(store, { onLoad = () => {} } = {}) {
  const urls = new Map();
  const pending = new Map();
  const failed = new Set();
  function url(id) {
    if (!id || typeof id !== "string") return null;
    if (urls.has(id)) return urls.get(id);
    if (!pending.has(id) && !failed.has(id) && /^[0-9a-f]{32}$/.test(id)) {
      pending.set(id, store.images.get(id).then((bytes) => {
        const u = URL.createObjectURL(new Blob([bytes], { type: sniffType(bytes) }));
        urls.set(id, u);
        pending.delete(id);
        onLoad(id);
        return u;
      }).catch(() => { pending.delete(id); failed.add(id); }));
    }
    return null;
  }
  return {
    url,
    load: async (id) => { url(id); await pending.get(id); return urls.get(id) || null; },
    put(id, bytes) { if (!urls.has(id)) urls.set(id, URL.createObjectURL(new Blob([bytes], { type: sniffType(bytes) }))); return urls.get(id); },
    bytes: (id) => store.images.get(id),
    close() { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); },
  };
}
