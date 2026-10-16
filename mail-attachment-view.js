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
//   • Web — an in-app viewer (`#mailAttachmentViewer`): PDFs, bitmap images and
//     plain text show inline; anything else gets a Download button.
//
// Bytes come from `gmail-attachment` (streamed raw, up to ATTACHMENT_MAX_BYTES).
// Until that function is deployed it 404s, and the app falls back to the gmail
// function's older base64 `attachment` action, which stops at
// ATTACHMENT_LEGACY_MAX_BYTES (its ~6MB buffered limit counts base64's ×1.33).
//
// SECURITY: the sender controls an attachment's declared type, and a blob: URL
// runs with this app's origin. Only inert types are ever rendered in the page
// (bitmap images, PDF, plain text — text goes in as textContent). HTML, SVG and
// everything else are never rendered here: Quick Look shows them outside the web
// view on the iPhone; the web offers a download as application/octet-stream.

export const ATTACHMENT_MAX_BYTES = 19_500_000;         // gmail-attachment (streamed)
export const ATTACHMENT_LEGACY_MAX_BYTES = 3_500_000;   // gmail `attachment` action (base64 JSON)
export const ATTACHMENT_TEXT_PREVIEW_MAX = 1_000_000;   // characters shown in the text viewer
export const ATTACHMENT_ENDPOINT = "/.netlify/functions/gmail-attachment";

const IMAGE_RE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;
const EXT_KIND = {
  pdf: "pdf",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", avif: "image", bmp: "image",
  txt: "text", text: "text", log: "text", csv: "text", tsv: "text", md: "text"
};
const EXT_MIME = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp"
};

function extOf(name) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}

// How the web viewer can show an attachment: "pdf" | "image" | "text" | "none".
// Many senders label files application/octet-stream, so the extension decides
// when the declared type is generic — but a declared HTML/SVG/XML type never
// becomes viewable, whatever the name says.
export function attachmentViewKind(mimeType, filename) {
  const mime = String(mimeType || "").toLowerCase().split(";")[0].trim();
  if (/html|svg|xml|javascript|ecmascript/.test(mime)) return "none";
  if (mime === "application/pdf") return "pdf";
  if (IMAGE_RE.test(mime)) return "image";
  if (mime === "text/plain" || mime === "text/csv" || mime === "text/tab-separated-values") return "text";
  if (!mime || mime === "application/octet-stream" || mime === "binary/octet-stream" || mime === "application/x-download") {
    return EXT_KIND[extOf(filename)] || "none";
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
  if (kind === "text") return "text/plain;charset=utf-8";
  return "application/octet-stream";
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
