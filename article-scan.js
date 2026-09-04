// article-scan.js — article/printed-page domain adapter over the shared
// document-scan seam. The third parser on the same "Document → Text → Specialized
// Parser" foundation as receipts and recipes: photograph a printed article, a
// magazine page, or a clipping → a canonical article shape the app can save.
//
// This is the EXTRACTION half (prompt + normalizer + endpoint), the reuse the
// audit's Phase 7 calls for and the natural iOS ingestion path (iOS Safari has no
// Web Share Target, so URL import can't reach it — camera scan can). The
// review/persistence UI is a deliberate, separately-specced product step; this
// adapter is what it will call.
const { scanDocument, parseJsonFromText } = require("./document-scan");

async function scanArticleFromImages(images, options = {}) {
  const { rawText, model } = await scanDocument({
    items: images,
    prompt: articleScanPrompt(),
    options: {
      ...options,
      maxItems: 6,
      noun: "page",
      label: "Article scan",
      envModelVar: "ANTHROPIC_ARTICLE_SCAN_MODEL",
      missingKeyMessage: "Article scanning needs ANTHROPIC_API_KEY set on the server.",
    },
  });
  return { article: normalizeScannedArticle(parseJsonFromText(rawText, "The article scan did not return text.")), rawText, model };
}

function articleScanPrompt() {
  return [
    "Extract the article from these photographed page(s).",
    "Return only valid JSON without markdown.",
    "Combine multiple pages into one continuous article in reading order.",
    "Keep the article body as clean paragraphs; drop page furniture (headers, footers, page numbers, ads, pull quotes that repeat body text).",
    "If a field is not visible, use an empty string.",
    "Use this JSON shape exactly:",
    JSON.stringify({
      title: "",
      author: "",
      date: "",
      publication: "",
      paragraphs: [""]
    })
  ].join("\n");
}

// Normalize to the app's article shape. Body is assembled from paragraphs into HTML
// (the reader renders HTML), matching the manual/RSS article body convention.
function normalizeScannedArticle(article) {
  const text = (value) => String(value == null ? "" : value).trim();
  const paragraphs = Array.isArray(article?.paragraphs)
    ? article.paragraphs.map(text).filter(Boolean)
    : text(article?.body || article?.text).split(/\n{2,}/).map(text).filter(Boolean);
  return {
    title: text(article?.title),
    author: text(article?.author),
    date: text(article?.date),
    publication: text(article?.publication),
    text: paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join(""),
    provenance: { origin: "imported", source: "scan" },
  };
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

module.exports = { scanArticleFromImages, articleScanPrompt, normalizeScannedArticle };
