// _article-extract.js — pure, deterministic server-side article extraction.
//
// Moved verbatim from fetch-article.js so the extraction is reusable and
// fixture-testable, independent of Netlify request handling, auth, and HTTP
// formatting. Behavior is intentionally unchanged.
//
// This is the SERVER path (fetched HTML). The Chrome extension keeps its own
// rendered-DOM extractor for logged-in/JS-rendered pages — unifying the two is a
// later phase (see CONTENT_IMPORT.md), NOT part of this change.
//
// Deterministic order (no AI):
//   1. metadata (og:title / author / published_time / JSON-LD fields)
//   2. JSON-LD articleBody
//   3. __NEXT_DATA__ paragraph walker (Next.js apps)
//   4. semantic-HTML block extraction
//
// extractArticleFromHtml(html, publication) → { title, author, date, text }

function extractArticleFromHtml(html, publication) {
  const title = extractFirstMatch(html, [
    /property="og:title"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+property="og:title"/i,
    /name="title"\s+content="([^"]+)"/i,
    /<title>([^<|]+)/i
  ]);

  const author = extractFirstMatch(html, [
    /name="author"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+name="author"/i,
    /"author"\s*:\s*\{\s*"(?:@type|type)"[^}]*"name"\s*:\s*"([^"]+)"/i,
    /"author"\s*:\s*"([^"]+)"/i,
    /property="article:author"\s+content="([^"]+)"/i
  ]);

  const date = extractFirstMatch(html, [
    /property="article:published_time"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+property="article:published_time"/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /name="date"\s+content="([^"]+)"/i,
    /"publishDate"\s*:\s*"([^"]+)"/i
  ]);

  // Strategy 1: JSON-LD articleBody (most reliable for many publications)
  let text = extractFromJsonLd(html);
  // Strategy 2: __NEXT_DATA__ paragraph walker (Next.js apps: NYT, etc.)
  if (!text) text = extractFromNextData(html);
  // Strategy 3: Generic semantic HTML extraction
  if (!text) text = extractFromSemanticHtml(html);

  return {
    title: decodeEntities(title?.trim() || null),
    author: decodeEntities(author?.trim() || null),
    date: date?.trim() || null,
    text
  };
}

// ── Strategy 1: JSON-LD ──────────────────────────────────────────────────────
function extractFromJsonLd(html) {
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const schema = JSON.parse(m[1]);
      const items = Array.isArray(schema) ? schema : [schema];
      for (const item of items) {
        const body = item.articleBody || item.text || item.description;
        if (typeof body === "string" && body.length > 300) {
          const paras = body
            .split(/\n{2,}/)
            .map(p => p.replace(/\n/g, " ").trim())
            .filter(p => p.length > 30);
          if (paras.length >= 3) return paras.map(p => `<p>${escHtml(p)}</p>`).join("\n");
        }
      }
    } catch { /* malformed JSON-LD */ }
  }
  return null;
}

// ── Strategy 2: __NEXT_DATA__ walker ─────────────────────────────────────────
function extractFromNextData(html) {
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]);
    const blocks = [];
    walkNextDataNode(data, blocks, 0);
    if (blocks.length >= 3) {
      return blocks.map(b => b.type === "h" ? `<h3>${escHtml(b.text)}</h3>` : `<p>${escHtml(b.text)}</p>`).join("\n");
    }
  } catch { /* malformed JSON */ }
  return null;
}

function walkNextDataNode(node, blocks, depth) {
  if (depth > 30 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkNextDataNode(child, blocks, depth + 1);
    return;
  }
  const typeName = (typeof node.__typename === "string" ? node.__typename : "").toLowerCase();

  if (typeName.includes("paragraph") || typeName === "bodyparagraph") {
    const text = extractTextFromNode(node);
    if (text && text.length > 15) { blocks.push({ type: "p", text }); return; }
  }
  if (typeName.includes("heading") && !typeName.includes("image")) {
    const text = extractTextFromNode(node);
    if (text) { blocks.push({ type: "h", text }); return; }
  }
  if (
    typeof node.text === "string" &&
    node.text.length > 80 &&
    !/^https?:\/\//.test(node.text) &&
    !node.url && !node.src && !node.href
  ) {
    blocks.push({ type: "p", text: node.text.trim() });
  }

  for (const val of Object.values(node)) {
    if (val && typeof val === "object") walkNextDataNode(val, blocks, depth + 1);
  }
}

function extractTextFromNode(node) {
  if (typeof node.text === "string") return node.text.trim();
  if (Array.isArray(node.textNodes)) return node.textNodes.map(n => String(n.text || "")).join("").trim();
  if (Array.isArray(node.content)) {
    return node.content.map(n => {
      if (typeof n.text === "string") return n.text;
      if (Array.isArray(n.textNodes)) return n.textNodes.map(x => x.text || "").join("");
      return "";
    }).join("").trim();
  }
  return "";
}

// ── Strategy 3: Semantic HTML ─────────────────────────────────────────────────
function extractFromSemanticHtml(html) {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const CONTENT_RE = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]+class="[^"]*(?:article[-_]body|article[-_]content|story[-_]body|post[-_]body|entry[-_]content|content[-_]body)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+itemprop="articleBody"[^>]*>([\s\S]*?)<\/div>/i
  ];

  let contentHtml = stripped;
  for (const re of CONTENT_RE) {
    const match = stripped.match(re);
    if (match) { contentHtml = match[1]; break; }
  }

  const blocks = [];
  const BLOCK_RE = /<(p|h[2-4]|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = BLOCK_RE.exec(contentHtml)) !== null) {
    const tag = m[1].toLowerCase();
    const inner = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const text = decodeEntities(inner);
    if (text.length < 40) continue;
    if (/^(?:subscribe|sign in|log in|advertisement|share|follow|newsletter|cookies|more from)/i.test(text)) continue;
    if (tag === "p") blocks.push(`<p>${escHtml(text)}</p>`);
    else if (tag === "blockquote") blocks.push(`<blockquote><p>${escHtml(text)}</p></blockquote>`);
    else blocks.push(`<h3>${escHtml(text)}</h3>`);
  }

  if (blocks.length < 3) return null;
  return blocks.join("\n");
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function extractFirstMatch(html, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]?.trim()) return m[1];
  }
  return null;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  extractArticleFromHtml,
  extractFromJsonLd,
  extractFromNextData,
  extractFromSemanticHtml,
  decodeEntities,
  escHtml,
};
