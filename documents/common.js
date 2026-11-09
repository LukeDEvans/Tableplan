// Shared by the Document page's two parts (DOCUMENTS_DESIGN.md §25): everyday
// documents (documents/page.js) and the Safe (documents/ui.js). Nothing here loads
// the encryption library, so everyday documents open without it.

// The kinds of file Document keeps and shows: no HTML, SVG or XML, which could run
// script if opened in the page. The Safe's own list is documents/crypto/meta.js
// MIME_TYPES; a test keeps the two the same.
export const MIME_TYPES = Object.freeze([
  "application/vnd.live.doc", // a Live document (the word processor; WORD_PROCESSOR_DESIGN.md)
  "application/vnd.live.sheet", // a Live spreadsheet (SPREADSHEET_DESIGN.md)
  "application/pdf",
  "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "image/gif",
  "text/plain", "text/csv",
  "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export const MAX_FILE_BYTES = 60 * 1024 * 1024;
export const SCAN_TEXT_MAX = 100000; // characters of page text kept for search
export const QUICKLOOK_MAX = 40 * 1000 * 1000; // AttachmentPreviewPlugin's cap for Documents' files
const THUMB_PX = 320;

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const EXT_MIME = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif",
  webp: "image/webp", gif: "image/gif", txt: "text/plain", csv: "text/csv", doc: "application/msword",
  xls: "application/vnd.ms-excel", ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

// The file's type from the list Documents allows, or null. The browser's guess
// first (normalised), then the extension.
export function mimeForFile(name, type) {
  const t = String(type || "").toLowerCase().replace("image/jpg", "image/jpeg");
  if (MIME_TYPES.includes(t)) return t;
  const ext = String(name || "").toLowerCase().split(".").pop();
  return EXT_MIME[ext] || null;
}

// A name for the list: the file name without its extension.
export function displayName(fileName) {
  const base = String(fileName || "").replace(/\.[A-Za-z0-9]{1,5}$/, "").trim();
  return (base || "Document").slice(0, 200);
}

// Pages in a PDF, roughly (page objects in the file); 1 when it can't tell.
export function pdfPageCount(bytes) {
  try {
    const text = new TextDecoder("latin1").decode(bytes.length > 30 * 1024 * 1024 ? bytes.subarray(0, 30 * 1024 * 1024) : bytes);
    const n = (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
    return Math.max(1, Math.min(n, 9999));
  } catch { return 1; }
}

export function sizeLabel(n) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function dateLabel(iso) {
  if (!iso) return "";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export const ICON = {
  all: '<svg class="article-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>',
  folder: '<svg class="article-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>',
  receipt: '<svg class="article-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  trash: '<svg class="article-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  plus: '<svg class="article-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  add: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  scan: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/></svg>',
};
export const FILE_GLYPH = { "application/pdf": "PDF", "text/plain": "TXT", "text/csv": "CSV" };
export const glyphFor = (mime) => FILE_GLYPH[mime] || (mime.startsWith("image/") ? "IMG" : mime.includes("sheet") || mime.includes("excel") ? "XLS" : mime.includes("presentation") || mime.includes("powerpoint") ? "PPT" : "DOC");

export async function makeThumb(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, THUMB_PX / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const out = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.72));
    return out ? new Uint8Array(await out.arrayBuffer()) : null;
  } catch { return null; } // HEIC in a browser that can't draw it, or a broken image
}
