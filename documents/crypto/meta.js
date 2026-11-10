// A document's metadata (DOCUMENTS_DESIGN.md §4): name, type, pages, tags and the
// date on the document. Encrypted as the file's "meta" part and kept in the
// database row, so the server never sees a name. It stays small (a list of files
// is a few hundred bytes a row); the text read for search is its own "text" part,
// stored with the file in R2 (encryptText / decryptText).
//
// parseMeta rebuilds a clean object from known fields only (unknown fields are
// dropped, prototype keys can't ride along) and is used on both encrypt and
// decrypt, so a hostile or newer client can't hand this device a surprise shape.
//
// - mime is one of a fixed list (MIME_TYPES): no HTML, SVG or XML, which could run
//   script if a viewer ever opened them in the app's own page.
// - rev counts edits (1, 2, …) and folderId names the folder the file is in. Both
//   are inside the encryption, so the app can refuse an older copy of the
//   metadata (keep the highest rev seen) and a row whose folder_id disagrees.
// - Names and tags lose control and formatting characters (direction overrides,
//   zero-width spaces, line breaks), so "invoice\u202Efdp.exe" can't pose as a PDF.

import { utf8, fromUtf8 } from "../../messaging/crypto/bytes.js";
import { pad, unpad } from "../../messaging/crypto/padding.js";
import { requireId } from "../../messaging/crypto/keys.js";
import { encryptBlob, decryptBlob } from "./file.js";

export const META_VERSION = 1;
export const LIMITS = Object.freeze({ name: 200, text: 256 * 1024, tags: 20, tag: 40, metaBlob: 16 * 1024 });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MIME_TYPES = Object.freeze([
  "application/vnd.live.doc", // a Live document (the word processor; WORD_PROCESSOR_DESIGN.md §12)
  "application/vnd.live.sheet", // a Live spreadsheet (SPREADSHEET_DESIGN.md §9)
  "application/vnd.live.slides", // a Live presentation (SLIDES_DESIGN.md §1)
  "application/pdf",
  "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "image/gif",
  "text/plain", "text/csv",
  "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

// Control (Cc) and format (Cf) characters out, except the zero-width joiner that
// emoji sequences need; whitespace runs become one space.
export function cleanName(v) {
  if (typeof v !== "string") return v;
  return v.normalize("NFC").replace(/[\p{Cc}]/gu, " ").replace(/(?!\u200D)\p{Cf}/gu, "").replace(/\s+/gu, " ").trim();
}

const str = (v, max, name, { required = false } = {}) => {
  if (v == null || v === "") {
    if (required) throw new Error(`meta: ${name} is required`);
    return "";
  }
  if (typeof v !== "string") throw new Error(`meta: ${name} must be text`);
  const s = v.normalize("NFC");
  if ([...s].length > max) throw new Error(`meta: ${name} is too long`);
  return s;
};

const count = (v, name) => {
  if (v == null) return 0;
  if (!Number.isInteger(v) || v < 0 || v > Number.MAX_SAFE_INTEGER) throw new Error(`meta: ${name} must be a whole number`);
  return v;
};

function validDate(d) {
  if (!DATE_RE.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

export function parseMeta(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error("meta: must be an object");
  if (m.v !== META_VERSION) throw new Error("meta: unknown version");
  const name = str(cleanName(m.name), LIMITS.name, "name", { required: true });
  if (!name) throw new Error("meta: name is required");
  if (!Number.isInteger(m.rev) || m.rev < 1 || m.rev > 0xffffffff) throw new Error("meta: rev must be a whole number from 1");
  const folderId = m.folderId == null || m.folderId === "" ? null : m.folderId;
  if (folderId !== null) requireId("folderId", folderId);
  const mime = typeof m.mime === "string" ? m.mime.toLowerCase() : m.mime;
  if (!MIME_TYPES.includes(mime)) throw new Error("meta: file type not allowed");
  const tagsIn = m.tags == null ? [] : m.tags;
  if (!Array.isArray(tagsIn) || tagsIn.length > LIMITS.tags) throw new Error("meta: too many tags");
  const tags = [...new Set(tagsIn.map((t) => str(cleanName(t), LIMITS.tag, "tag")).filter(Boolean))];
  const documentDate = m.documentDate == null || m.documentDate === "" ? null : m.documentDate;
  if (documentDate !== null && (typeof documentDate !== "string" || !validDate(documentDate))) throw new Error("meta: documentDate must be YYYY-MM-DD");
  return {
    v: META_VERSION,
    rev: m.rev,
    folderId,
    name,
    originalName: str(cleanName(m.originalName), LIMITS.name, "originalName"),
    mime,
    pages: count(m.pages, "pages"),
    size: count(m.size, "size"),
    tags,
    documentDate,
  };
}

export function encryptMeta(fileKey, fileId, meta) {
  const plain = pad(utf8(JSON.stringify(parseMeta(meta))));
  if (plain.length > LIMITS.metaBlob) throw new Error("meta: too large");
  return encryptBlob(fileKey, fileId, "meta", plain);
}

export function decryptMeta(fileKey, fileId, blob) {
  return parseMeta(JSON.parse(fromUtf8(unpad(decryptBlob(fileKey, fileId, "meta", blob, { maxPlaintext: LIMITS.metaBlob })))));
}

// The text read from the document on the device (VisionKit / PDF text), for search.
// Padded to 1 KB steps so the stored size only hints at how much text there is.
const TEXT_BLOCK = 1024;
function padText(b) {
  const out = new Uint8Array((Math.floor(b.length / TEXT_BLOCK) + 1) * TEXT_BLOCK);
  out.set(b);
  out[b.length] = 0x80;
  return out;
}
function unpadText(b) {
  if (!b.length || b.length % TEXT_BLOCK) throw new Error("meta: bad text padding");
  let i = b.length - 1;
  while (i >= 0 && b[i] === 0) i--;
  if (i < 0 || b[i] !== 0x80 || b.length - i > TEXT_BLOCK) throw new Error("meta: bad text padding");
  return b.subarray(0, i);
}

export function encryptText(fileKey, fileId, text) {
  return encryptBlob(fileKey, fileId, "text", padText(utf8(str(text, LIMITS.text, "text"))));
}

export function decryptText(fileKey, fileId, blob) {
  const max = (Math.floor((LIMITS.text * 4) / TEXT_BLOCK) + 1) * TEXT_BLOCK; // 4 UTF-8 bytes per character at most
  return str(fromUtf8(unpadText(decryptBlob(fileKey, fileId, "text", blob, { maxPlaintext: max }))), LIMITS.text, "text");
}
