// local-text-detect.js — optional ON-DEVICE text recognition via the browser Shape
// Detection API (window.TextDetector). Best-effort + capability-gated: present in
// Chromium/Android, ABSENT in iOS Safari and Firefox, and it returns RAW TEXT with
// no layout model — so it is an OFFLINE / fast path for CLEAN PRINTED PAGES
// (articles), never a replacement for the cloud vision extractor on messy receipts.
// This fills the `local-ocr` capability slot (platform-capabilities.js) behind the
// document-scan seam, keeping cloud vision the accurate default.
//
// Pure over an injected detector factory + window, so it unit-tests with no browser.

export function hasLocalTextDetection(win = (typeof window !== "undefined" ? window : undefined)) {
  return !!(win && typeof win.TextDetector === "function");
}

// Detect text from an image source (Blob / ImageBitmap / HTMLImageElement / canvas).
// Returns { ok, text, lines } — or { ok:false, reason } when unsupported/failed.
// Never throws (a caller falls back to the cloud path or manual entry).
export async function detectText(imageSource, { detectorFactory, win } = {}) {
  const w = win || (typeof window !== "undefined" ? window : undefined);
  const factory = detectorFactory || (w && typeof w.TextDetector === "function" ? () => new w.TextDetector() : null);
  if (!factory) return { ok: false, reason: "unsupported", text: "", lines: [] };
  try {
    const detector = factory();
    const detectable = await toDetectable(imageSource);
    const blocks = await detector.detect(detectable);
    const lines = (Array.isArray(blocks) ? blocks : [])
      .map((block) => String(block?.rawValue || "").trim())
      .filter(Boolean);
    return { ok: lines.length > 0, text: lines.join("\n"), lines };
  } catch (error) {
    return { ok: false, reason: (error && error.message) || "error", text: "", lines: [] };
  }
}

async function toDetectable(src) {
  if (typeof createImageBitmap === "function" && typeof Blob !== "undefined" && src instanceof Blob) {
    return createImageBitmap(src);
  }
  return src; // ImageBitmap / HTMLImageElement / canvas pass through
}

// Turn detected lines into a rough article shape (matching the cloud article-scan
// output): first non-empty line = title, the rest = body paragraphs. Deliberately
// minimal — local OCR has no layout model, so the user reviews/edits before saving.
export function linesToArticle(lines) {
  const clean = (Array.isArray(lines) ? lines : []).map((l) => String(l || "").trim()).filter(Boolean);
  return { title: clean[0] || "", author: "", date: "", publication: "", paragraphs: clean.slice(1) };
}
