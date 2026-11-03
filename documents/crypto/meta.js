// A document's metadata (DOCUMENTS_DESIGN.md §4): name, type, pages, tags and the
// date on the document. Encrypted as the file's "meta" part and kept in the
// database row, so the server never sees a name. It stays small (a list of files
// is a few hundred bytes a row); the text read for search is its own "text" part,
// stored with the file in R2 (encryptText / decryptText).
//
// parseMeta rebuilds a clean object from known fields only (unknown fields are
// dropped, prototype keys can't ride along) and is used on both encrypt and
// decrypt, so a hostile or newer client can't hand this device a surprise shape.

import { utf8, fromUtf8 } from "../../messaging/crypto/bytes.js";
import { pad, unpad } from "../../messaging/crypto/padding.js";
import { encryptBlob, decryptBlob } from "./file.js";

export const META_VERSION = 1;
export const LIMITS = Object.freeze({ name: 200, mime: 100, text: 256 * 1024, tags: 20, tag: 40 });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  const name = str(m.name, LIMITS.name, "name", { required: true }).trim();
  if (!name) throw new Error("meta: name is required");
  const tagsIn = m.tags == null ? [] : m.tags;
  if (!Array.isArray(tagsIn) || tagsIn.length > LIMITS.tags) throw new Error("meta: too many tags");
  const tags = [...new Set(tagsIn.map((t) => str(t, LIMITS.tag, "tag").trim()).filter(Boolean))];
  const documentDate = m.documentDate == null || m.documentDate === "" ? null : m.documentDate;
  if (documentDate !== null && (typeof documentDate !== "string" || !validDate(documentDate))) throw new Error("meta: documentDate must be YYYY-MM-DD");
  return {
    v: META_VERSION,
    name,
    originalName: str(m.originalName, LIMITS.name, "originalName"),
    mime: str(m.mime, LIMITS.mime, "mime", { required: true }),
    pages: count(m.pages, "pages"),
    size: count(m.size, "size"),
    tags,
    documentDate,
  };
}

export function encryptMeta(fileKey, fileId, meta) {
  return encryptBlob(fileKey, fileId, "meta", pad(utf8(JSON.stringify(parseMeta(meta)))));
}

export function decryptMeta(fileKey, fileId, blob) {
  return parseMeta(JSON.parse(fromUtf8(unpad(decryptBlob(fileKey, fileId, "meta", blob)))));
}

// The text read from the document on the device (VisionKit / PDF text), for search.
export function encryptText(fileKey, fileId, text) {
  return encryptBlob(fileKey, fileId, "text", utf8(str(text, LIMITS.text, "text")));
}

export function decryptText(fileKey, fileId, blob) {
  return str(fromUtf8(decryptBlob(fileKey, fileId, "text", blob)), LIMITS.text, "text");
}
