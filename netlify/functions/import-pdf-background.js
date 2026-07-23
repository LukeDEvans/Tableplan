// Background function: convert an academic/scientific PDF into a clean, lightly
// condensed reading article and save it into the user's Media section, where it
// reads and listens (with word highlighting) like any other saved article.
//
// The "-background" suffix gives it a 15-minute limit — a full paper takes
// minutes to convert (Claude reads the PDF's layout directly, so two-column
// papers, tables and references come through in order). The caller (Media page
// or the Chrome extension) gets an immediate 202; the article appears in the
// list on the next sync.
//
// Input JSON: { title?, publication?, sourceUrl?, pdfUrl? , pdfData?, mediaType? }
//   pdfUrl   — a link Claude fetches directly (no size limit)
//   pdfData  — base64 PDF bytes (for local files; capped by the request limit)
const { getUserIdFromToken, updateSection } = require("./_state-sections.js");

const SYSTEM = [
  "You convert an academic or scientific PDF into a clean, readable article for reading and listening (text-to-speech).",
  "Return ONLY HTML content — no doctype/html/head/body tags and no markdown code fences.",
  "Begin with an <h1> title, then a <p> listing the authors, then the abstract, then every section with <h2> headings in the paper's original order.",
  "Keep all sections and their key content, findings and arguments, faithfully and in order — never drop a section.",
  "Lightly condense boilerplate to keep it readable: shorten or omit long reference lists (a brief closing note is fine), acknowledgements, funding and competing-interest statements, and repetitive derivations. Keep the substance.",
  "Tables become <table>; genuine lists become <ul>/<li>.",
  "Render mathematics readably as inline words and simple symbols suitable for text-to-speech; never output LaTeX source or raw image data.",
  "DROP running page headers/footers, page numbers, line numbers, and figure image data — but keep each figure's caption as <p><em>Figure N: …</em></p>."
].join("\n");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(json(200, {}));
  if (event.httpMethod !== "POST") return cors(json(405, { error: "Method not allowed" }));

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!serviceKey || !anthropicKey) { console.error("[import-pdf] missing keys"); return cors(json(200, {})); }

  const accessToken = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "").trim();
  const userId = accessToken ? await getUserIdFromToken(accessToken, serviceKey) : null;
  if (!userId) return cors(json(401, { error: "Not authenticated." }));

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return cors(json(400, { error: "Invalid JSON" })); }
  const { title, publication, sourceUrl, pdfUrl, pdfData, mediaType } = body;
  if (!pdfUrl && !pdfData) return cors(json(400, { error: "pdfUrl or pdfData is required." }));

  const source = pdfUrl
    ? { type: "url", url: pdfUrl }
    : { type: "base64", media_type: mediaType || "application/pdf", data: pdfData };

  let html;
  try {
    html = await convertPdf(anthropicKey, source);
  } catch (e) {
    console.error("[import-pdf] conversion failed:", e.message);
    return cors(json(200, { error: "Conversion failed." }));
  }
  if (!html || html.length < 200) { console.error("[import-pdf] conversion produced too little"); return cors(json(200, { error: "Conversion produced no content." })); }

  const id = "pdf-" + crypto.randomUUID();
  const dedupeUrl = sourceUrl || pdfUrl || null;
  let savedId = id;
  try {
    await updateSection(serviceKey, `u-${userId}`, "media", (state) => {
      const articles = Array.isArray(state.savedArticles) ? state.savedArticles : [];
      const existing = dedupeUrl && articles.find((a) => a.url === dedupeUrl);
      if (existing) { savedId = existing.id; return null; }
      return {
        ...state,
        savedArticles: [...articles, {
          id,
          url: dedupeUrl,
          title: title || "Imported PDF",
          publication: publication || "pdf",
          savedAt: new Date().toISOString(),
          author: null,
          date: null,
          text: html
        }]
      };
    });
  } catch (e) {
    console.error("[import-pdf] save failed:", e.message);
    return cors(json(200, { error: "Save failed." }));
  }

  console.log(`[import-pdf] saved "${(title || "Imported PDF").slice(0, 60)}" (${html.length} chars) for ${userId}`);
  return cors(json(200, { ok: true, id: savedId }));
};

// Convert the PDF to HTML in a single call. A lightly-condensed paper fits well
// under the token ceiling, so no continuation is needed (Sonnet doesn't support
// assistant-prefill continuation anyway). max_tokens is set generously so even
// a long paper completes in one pass.
async function convertPdf(apiKey, source) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 32000,
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "document", source },
          { type: "text", text: "Convert this paper to clean reading HTML following the instructions." }
        ]
      }]
    })
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error?.message || `Anthropic API error ${res.status}`);
  }
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return text.replace(/^```html?\s*/i, "").replace(/```\s*$/i, "").trim();
}

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}
function cors(response) {
  return { ...response, headers: { ...(response.headers || {}), "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" } };
}
