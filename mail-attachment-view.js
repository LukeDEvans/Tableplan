// mail-attachment-view.js — opening an email attachment inside the app.
//
// Before (2026-07): tapping a chip downloaded the file through the gmail
// function and window.open()-ed a blob: URL. In the iPhone app's web view that
// does nothing (WKWebView can't hand an in-memory blob to Safari), so
// attachments looked dead there; on the web it left the app for a new tab.
//
// Now:
//   • iPhone app — the AttachmentPreview native plugin downloads the file itself
//     (URLSession, straight from gmail-attachment) and shows it in Quick Look:
//     PDF, images, Word/Excel/PowerPoint, Pages/Numbers/Keynote, text, CSV,
//     audio/video… with a Share button for Files/AirDrop.
//   • Web — an in-app viewer (`#mailAttachmentViewer`, built by
//     mail-attachment-viewers.js): PDFs, bitmap images and plain text show inline;
//     a CSV shows as a table, a calendar invite as its events (Add to Calendar), a
//     contact card as its contacts (Add to Contacts), audio and video play in
//     place; anything else gets a Download button.
//
// Bytes come from `gmail-attachment` (streamed raw, up to ATTACHMENT_MAX_BYTES).
// Until that function is deployed it 404s, and the app falls back to the gmail
// function's older base64 `attachment` action, which stops at
// ATTACHMENT_LEGACY_MAX_BYTES (its ~6MB buffered limit counts base64's ×1.33).
//
// SECURITY: the sender controls an attachment's declared type, and a blob: URL
// runs with this app's origin. Only inert types are ever rendered in the page:
// bitmap images, PDF, audio/video in a media element, and text — plain text, CSV
// cells, invite and contact fields all go in as textContent, never as markup.
// HTML, SVG and everything else are never rendered here: Quick Look shows them
// outside the web view on the iPhone; the web offers a download as
// application/octet-stream.

export const ATTACHMENT_MAX_BYTES = 19_500_000;         // gmail-attachment (streamed)
export const ATTACHMENT_LEGACY_MAX_BYTES = 3_500_000;   // gmail `attachment` action (base64 JSON)
export const ATTACHMENT_TEXT_PREVIEW_MAX = 1_000_000;   // characters shown in the text viewer
export const ATTACHMENT_ENDPOINT = "/.netlify/functions/gmail-attachment";

export const ATTACHMENT_TABLE_MAX_ROWS = 5000;          // rows shown in the CSV table
export const ATTACHMENT_TABLE_MAX_COLS = 100;           // columns shown in the CSV table

const IMAGE_RE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;
const EXT_KIND = {
  pdf: "pdf",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", avif: "image", bmp: "image",
  txt: "text", text: "text", log: "text", md: "text",
  csv: "csv", tsv: "csv",
  ics: "invite", ical: "invite",
  vcf: "contact", vcard: "contact",
  mp3: "audio", m4a: "audio", aac: "audio", wav: "audio", oga: "audio", ogg: "audio", flac: "audio",
  mp4: "video", m4v: "video", mov: "video", webm: "video"
};
const EXT_MIME = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", oga: "audio/ogg", ogg: "audio/ogg", flac: "audio/flac",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm"
};
// Declared media types the viewer plays, each mapped to the fixed type its blob gets.
const MEDIA_MIME = {
  "audio/mpeg": "audio/mpeg", "audio/mp3": "audio/mpeg", "audio/mp4": "audio/mp4", "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4",
  "audio/aac": "audio/aac", "audio/wav": "audio/wav", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav",
  "audio/ogg": "audio/ogg", "audio/flac": "audio/flac", "audio/x-flac": "audio/flac", "audio/webm": "audio/webm",
  "video/mp4": "video/mp4", "video/x-m4v": "video/mp4", "video/quicktime": "video/quicktime", "video/webm": "video/webm"
};
const TEXT_MIME_KIND = {
  "text/plain": "text",
  "text/csv": "csv", "text/tab-separated-values": "csv",
  "text/calendar": "invite", "application/ics": "invite",
  "text/vcard": "contact", "text/x-vcard": "contact", "text/directory": "contact"
};
// Kinds a text/plain (or generic) label may be upgraded to by the filename. All of
// them are shown as text, so a wrong guess can only look odd, never run anything.
const TEXT_KINDS = new Set(["text", "csv", "invite", "contact"]);

function extOf(name) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}

// How the web viewer can show an attachment:
//   "pdf" | "image" | "text" | "csv" | "invite" | "contact" | "audio" | "video" | "none".
// Many senders label files application/octet-stream, so the extension decides
// when the declared type is generic — but a declared HTML/SVG/XML type never
// becomes viewable, whatever the name says. A file labelled text/plain may still
// be a CSV, an invite or a contact card by its name (Outlook and others do this).
export function attachmentViewKind(mimeType, filename) {
  const mime = String(mimeType || "").toLowerCase().split(";")[0].trim();
  if (/html|svg|xml|javascript|ecmascript/.test(mime)) return "none";
  if (mime === "application/pdf") return "pdf";
  if (IMAGE_RE.test(mime)) return "image";
  if (MEDIA_MIME[mime]) return mime.startsWith("audio/") ? "audio" : "video";
  const byExt = EXT_KIND[extOf(filename)] || "none";
  if (mime === "text/plain") return TEXT_KINDS.has(byExt) ? byExt : "text";
  if (TEXT_MIME_KIND[mime]) return TEXT_MIME_KIND[mime];
  if (!mime || mime === "application/octet-stream" || mime === "binary/octet-stream" || mime === "application/x-download") {
    return byExt;
  }
  return "none";
}

// The type a viewable blob is created with. Never the sender's raw type.
export function attachmentBlobType(kind, mimeType, filename) {
  if (kind === "pdf") return "application/pdf";
  if (kind === "image") {
    const mime = String(mimeType || "").toLowerCase();
    return IMAGE_RE.test(mime) ? mime.replace("image/jpg", "image/jpeg") : (EXT_MIME[extOf(filename)] || "image/png");
  }
  if (kind === "audio" || kind === "video") {
    const fixed = MEDIA_MIME[String(mimeType || "").toLowerCase().split(";")[0].trim()] || EXT_MIME[extOf(filename)] || "";
    return fixed.startsWith(`${kind}/`) ? fixed : (kind === "audio" ? "audio/mpeg" : "video/mp4");
  }
  if (TEXT_KINDS.has(kind)) return "text/plain;charset=utf-8";
  return "application/octet-stream";
}

// Attachment bytes as text: UTF-8 (BOM dropped), or UTF-16 when the file starts
// with that byte-order mark (Excel's "Unicode text" export).
export function attachmentText(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const enc = b[0] === 0xff && b[1] === 0xfe ? "utf-16le" : b[0] === 0xfe && b[1] === 0xff ? "utf-16be" : "utf-8";
  return new TextDecoder(enc, { fatal: false }).decode(b).replace(/^\uFEFF/, "");
}

// The delimiter of a CSV-like file: a tab for .tsv, else whichever of , ; tab
// appears most in the first line outside quotes.
export function sniffDelimiter(text, filename = "") {
  if (extOf(filename) === "tsv") return "\t";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of String(text || "").slice(0, 20000)) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  return counts["\t"] > counts[","] && counts["\t"] >= counts[";"] ? "\t" : counts[";"] > counts[","] ? ";" : ",";
}

// Rows of a CSV-like text (RFC 4180: quoted fields, "" for a quote, line breaks
// inside quotes). Stops at maxRows / maxCols; `more` says something was left out.
// → { rows: string[][], cols, more }
export function parseDelimited(text, { delimiter = ",", maxRows = ATTACHMENT_TABLE_MAX_ROWS, maxCols = ATTACHMENT_TABLE_MAX_COLS } = {}) {
  const src = String(text || "");
  const rows = [];
  let row = [], field = "", quoted = false, more = false, i = 0;
  const endField = () => { if (row.length < maxCols) row.push(field); else more = true; field = ""; };
  const endRow = () => { endField(); if (row.length > 1 || row[0] !== "") rows.push(row); row = []; };
  for (; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) endField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
      if (rows.length >= maxRows) { more = more || /\S/.test(src.slice(i + 1, i + 2000)); break; }
    } else field += ch;
  }
  if (i >= src.length && (field !== "" || row.length)) endRow();
  const cols = rows.reduce((n, r) => Math.max(n, r.length), 0);
  return { rows, cols, more };
}

// "app" — open it here; "gmail" — too big for any path, deep-link to Gmail.
// `legacyOnly` is true once gmail-attachment has answered 404 (not deployed).
export function chooseAttachmentRoute({ size, hasId, legacyOnly = false }) {
  if (!hasId) return "gmail";
  const cap = legacyOnly ? ATTACHMENT_LEGACY_MAX_BYTES : ATTACHMENT_MAX_BYTES;
  return Number(size) > cap ? "gmail" : "app";
}

export function gmailThreadUrl(threadOrMessageId) {
  return `https://mail.google.com/mail/#all/${encodeURIComponent(String(threadOrMessageId || ""))}`;
}

export function base64UrlToBytes(data) {
  const b64 = String(data || "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Fetches an attachment's bytes for the web viewer.
// → { ok: true, bytes } | { ok: false, reason: "notDeployed" | "tooLarge" | "error", error }
export async function fetchAttachmentBytes({ messageId, attachmentId, filename, token, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(ATTACHMENT_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ messageId, attachmentId, filename })
    });
    if (res.status === 404) return { ok: false, reason: "notDeployed" };
    if (res.status === 413) return { ok: false, reason: "tooLarge" };
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, reason: "error", error: data.error || `Server error (${res.status}).` };
    }
    return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()) };
  } catch (e) {
    return { ok: false, reason: "error", error: e?.message || "Network error." };
  }
}
