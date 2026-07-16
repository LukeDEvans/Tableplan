// "News email → listenable article" Mail AI features. Daily newsletters
// (NYT "The Morning", Economist "The world in brief") are converted to clean
// reader-mode articles saved into the Media page, then the email is filed
// away. Conversion uses Claude so the article reads well aloud; hyperlinks in
// the newsletter body are preserved as clickable <a> tags.
// Files prefixed with _ are not deployed as individual functions.
const { claudeCall } = require("./_claude");
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

// One entry per newsletter. `key` doubles as the settings toggle in
// state.mailAiSettings (Settings → Mail AI).
const NEWS_SOURCES = [
  {
    key: "nytMorningToArticle",
    name: "The Morning (NYT)",
    senderRe: /nytimes\.com/i,
    subjectRe: /^the morning\b/i,
    publication: "The Morning · NYT"
  },
  {
    key: "economistBriefToArticle",
    name: "The world in brief (Economist)",
    senderRe: /economist\.com/i,
    subjectRe: /^the world in brief/i,
    publication: "The Economist"
  },
];

function newsSourceForMessage(from, subject, mailAiSettings) {
  // Features default ON: only an explicit false (user toggled off) disables.
  return NEWS_SOURCES.find((s) =>
    mailAiSettings?.[s.key] !== false && s.senderRe.test(from || "") && s.subjectRe.test((subject || "").trim())
  ) || null;
}

// Reduce newsletter HTML to plain text with inline [text](url) link markers —
// small enough for Claude, rich enough to reconstruct hyperlinks.
function simplifyNewsletterHtml(html) {
  let s = String(html || "")
    .replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<img[^>]*>/gi, " ");
  s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => {
    const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!text || /^https?:\/\//i.test(text)) return ` ${text} `;
    if (/^(unsubscribe|view in browser|privacy|advert)/i.test(text)) return " ";
    return ` [${text}](${href}) `;
  });
  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;|&rsquo;/gi, "’")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s.slice(0, 60000);
}

// Claude turns the simplified newsletter into clean article HTML.
async function convertNewsEmailToArticle(anthropicKey, source, { subject, date, html }) {
  const text = simplifyNewsletterHtml(html);
  if (text.length < 400) throw new Error("Newsletter body too short after simplification");

  const system = [
    "You convert an email newsletter into a clean article for reading and listening (text-to-speech).",
    "Return ONLY HTML content (no doctype/html/head/body tags, no markdown fences).",
    "Use <h2> for section headings, <p> for prose, <ul>/<li> for genuine lists.",
    'Links appear in the input as [text](url). Reproduce them inline as <a href="url" target="_blank" rel="noopener noreferrer">text</a> within the surrounding sentence.',
    "KEEP: all of the newsletter's actual editorial content — every story, brief, and section, in order.",
    "DROP: greetings/sign-offs by the newsletter staff, subscription and app promotions, 'read more online' footers, sharing links, event ads, games/crossword sections, and legal boilerplate.",
    "Do not summarize or shorten the editorial content. Do not add commentary."
  ].join("\n");

  const out = await claudeCall(anthropicKey, {
    system,
    user: `Newsletter subject: ${subject}\nDate: ${date}\n\n${text}`,
    maxTokens: 8000,
    model: "claude-haiku-4-5-20251001"
  });
  const cleaned = out.replace(/^```html?\s*/i, "").replace(/```\s*$/i, "").trim();
  if (cleaned.length < 400) throw new Error("Conversion produced too little content");
  return cleaned;
}

// ── Saving into the media state section (optimistically locked) ──────────────

async function getUserGroupId(serviceKey, userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/live_group_members?user_id=eq.${encodeURIComponent(userId)}&select=group_id&limit=1`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json" }
  });
  const rows = await res.json().catch(() => []);
  return rows[0]?.group_id || null;
}

// Appends an article to savedArticles in the USER'S PERSONAL media section
// (articles converted from someone's Gmail belong to that member, not the
// household). Optimistically locked via the shared helper; the personal row
// is created on first write.
async function saveArticleToMediaSection(serviceKey, userId, article) {
  const { updateSection } = require("./_state-sections.js");
  let duplicate = false;
  await updateSection(serviceKey, `u-${userId}`, "media", (state) => {
    const articles = Array.isArray(state.savedArticles) ? state.savedArticles : [];
    if (articles.some((a) => a?.id === article.id)) { duplicate = true; return null; }
    return { ...state, savedArticles: [...articles, article] };
  });
  return { ok: true, duplicate };
}

module.exports = { NEWS_SOURCES, newsSourceForMessage, simplifyNewsletterHtml, convertNewsEmailToArticle, saveArticleToMediaSection };
