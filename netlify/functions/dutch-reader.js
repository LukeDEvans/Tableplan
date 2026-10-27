// dutch-reader — easy Dutch news for Dutch practice (LANGUAGE_PRACTICE.md §23).
//
// POST /.netlify/functions/dutch-reader, signed in. Actions:
//   { action: "list", feed: "easy" | "nos" }
//       → { items: [{ id, title, url, publishedAt, summary, paragraphs? }] }
//       easy = NOS Jeugdjournaal (news written for children: short, simple
//       Dutch); nos = NOS Nieuws (regular news, harder).
//   { action: "article", url }   (nos.nl / jeugdjournaal.nl only)
//       → { title, paragraphs: [string] } or { error } (soft, HTTP 200)
//   { action: "gloss", word, sentence }
//       → { lemma, en, pos, form, note }   (Claude, in context)
//   { action: "translate", sentence } → { en }
//
// Nothing is stored in Supabase. Feeds and articles are cached in this
// function's memory (warm instances) and on the device; lookups are cached on
// the device. The AI calls use the app's existing ANTHROPIC_API_KEY.

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const crypto = require("crypto");
const { XMLParser } = require("fast-xml-parser");
const { safeFetch } = require("./_import-fetch.js");
const { extractArticleFromHtml } = require("./_article-extract.js");
const { claudeCall } = require("./_claude.js");

const FEEDS = {
  easy: { url: "https://feeds.nos.nl/jeugdjournaal", label: "NOS Jeugdjournaal" },
  nos: { url: "https://feeds.nos.nl/nosnieuwsalgemeen", label: "NOS Nieuws" },
};
const ARTICLE_HOSTS = new Set(["nos.nl", "www.nos.nl", "jeugdjournaal.nl", "www.jeugdjournaal.nl"]);
const LIST_TTL_MS = 15 * 60_000;
const ARTICLE_TTL_MS = 6 * 60 * 60_000;
const MAX_ITEMS = 25;
// Below this much text the feed only carries a summary; the article is fetched.
const FULL_TEXT_MIN = 600;

const listCache = new Map(); // feed → { at, items }
const articleCache = new Map(); // url → { at, value }
const glossCache = new Map(); // key → value (bounded)

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", trimValues: true, cdataPropName: false });
const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const textOf = (x) => (x == null ? "" : typeof x === "object" ? String(x["#text"] ?? "") : String(x));

function decode(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCharCode(parseInt(c, 16)));
}

// HTML (a feed description or article body) → paragraphs of plain text.
function htmlToParagraphs(html) {
  const s = String(html || "")
    .replace(/<(script|style|figure|figcaption|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|blockquote|div)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ");
  return decode(s)
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 1 && !/^(lees ook|bekijk|kijk hier|meer over)\b/i.test(p));
}

function textToParagraphs(text) {
  return String(text || "").split(/\n+/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length > 1);
}

const idOf = (url) => crypto.createHash("sha1").update(String(url)).digest("hex").slice(0, 16);

// RSS → items. Pure (exported for tests).
function parseNosFeed(xml) {
  let doc;
  try { doc = parser.parse(String(xml || "")); } catch { return []; }
  return arr(doc?.rss?.channel?.item).map((it) => {
    const url = textOf(it.link) || textOf(it.guid);
    const rawDesc = textOf(it.description) || textOf(it["content:encoded"]);
    const paragraphs = htmlToParagraphs(rawDesc);
    const fullText = paragraphs.join(" ");
    const t = Date.parse(textOf(it.pubDate));
    return {
      id: idOf(url),
      title: decode(textOf(it.title)).replace(/\s+/g, " ").trim(),
      url,
      publishedAt: Number.isNaN(t) ? "" : new Date(t).toISOString(),
      summary: fullText.slice(0, 220),
      ...(fullText.length >= FULL_TEXT_MIN ? { paragraphs: paragraphs.slice(0, 60) } : {}),
    };
  }).filter((x) => x.url && x.title).slice(0, MAX_ITEMS);
}

async function fetchText(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; LiveDutchReader/1.0)", accept: "application/rss+xml, application/xml, text/xml" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(timer); }
}

async function listFeed(feedKey, now = Date.now()) {
  const feed = FEEDS[feedKey];
  if (!feed) return { error: "Unknown feed." };
  const hit = listCache.get(feedKey);
  if (hit && now - hit.at < LIST_TTL_MS) return { items: hit.items, source: feed.label };
  try {
    const items = parseNosFeed(await fetchText(feed.url));
    listCache.set(feedKey, { at: now, items });
    return { items, source: feed.label };
  } catch (e) {
    if (hit) return { items: hit.items, source: feed.label, stale: true };
    return { error: `Couldn't load ${feed.label} (${e.message || "network"}).` };
  }
}

function allowedArticleUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ARTICLE_HOSTS.has(u.hostname);
  } catch { return false; }
}

async function getArticle(url, now = Date.now()) {
  if (!allowedArticleUrl(url)) return { error: "Only NOS articles can be opened here." };
  const hit = articleCache.get(url);
  if (hit && now - hit.at < ARTICLE_TTL_MS) return hit.value;
  try {
    const fetched = await safeFetch(url);
    if (!fetched.ok) return { error: `Couldn't open the article (HTTP ${fetched.status}).` };
    const r = extractArticleFromHtml(fetched.body, "nos");
    const paragraphs = textToParagraphs(r.text).slice(0, 60);
    if (!paragraphs.length) return { error: "Couldn't read this article's text." };
    const value = { title: r.title || "", paragraphs };
    articleCache.set(url, { at: now, value });
    if (articleCache.size > 200) articleCache.delete(articleCache.keys().next().value);
    return value;
  } catch (e) {
    return { error: e.message || "Couldn't open the article." };
  }
}

const GLOSS_SYSTEM = `You help an English-speaking beginner read Dutch news. You get one Dutch word and the sentence it appears in. Return ONLY a JSON object, no markdown:
{"lemma": the dictionary form — for a noun include its article ("de hond", "het huis"), for a verb the infinitive ("lopen"), otherwise the base word,
 "en": its English meaning in this sentence, at most 6 words (for verbs start with "to "),
 "pos": one of noun, verb, adjective, adverb, pronoun, preposition, conjunction, article, number, name, other,
 "form": if the word in the sentence is not the dictionary form, a few English words saying which form (e.g. "past tense", "plural", "part of opstaan"), else "",
 "note": a short tip for a learner only if really useful (separable verb, idiom, false friend), else ""}`;

const TRANSLATE_SYSTEM = `Translate the Dutch sentence into natural English for a learner. Return ONLY a JSON object: {"en": "..."}`;

const POS = new Set(["noun", "verb", "adjective", "adverb", "pronoun", "preposition", "conjunction", "article", "number", "name", "other"]);
const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

function parseJsonObject(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// Pure (exported for tests): the model's reply → a safe gloss, or null.
function cleanGloss(obj, word) {
  if (!obj || typeof obj !== "object") return null;
  const en = clip(obj.en, 80);
  if (!en) return null;
  return {
    lemma: clip(obj.lemma, 60) || clip(word, 40),
    en,
    pos: POS.has(obj.pos) ? obj.pos : "other",
    form: clip(obj.form, 60),
    note: clip(obj.note, 160),
  };
}

async function gloss(apiKey, word, sentence) {
  const w = clip(word, 40);
  const s = clip(sentence, 400);
  if (!w || !/[\p{L}]/u.test(w)) return { error: "No word." };
  const k = `g|${w.toLowerCase()}|${s}`;
  if (glossCache.has(k)) return glossCache.get(k);
  const reply = await claudeCall(apiKey, { system: GLOSS_SYSTEM, user: `Word: ${w}\nSentence: ${s || w}`, maxTokens: 200 });
  const g = cleanGloss(parseJsonObject(reply), w);
  if (!g) return { error: "Couldn't look that up." };
  remember(k, g);
  return g;
}

async function translate(apiKey, sentence) {
  const s = clip(sentence, 600);
  if (!s) return { error: "No sentence." };
  const k = `t|${s}`;
  if (glossCache.has(k)) return glossCache.get(k);
  const reply = await claudeCall(apiKey, { system: TRANSLATE_SYSTEM, user: s, maxTokens: 300 });
  const en = clip(parseJsonObject(reply)?.en, 800);
  if (!en) return { error: "Couldn't translate that." };
  remember(k, { en });
  return { en };
}

function remember(k, v) {
  glossCache.set(k, v);
  if (glossCache.size > 2000) glossCache.delete(glossCache.keys().next().value);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(json(200, {}));
  if (event.httpMethod !== "POST") return cors(json(405, { error: "Method not allowed" }));
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return cors(json(401, { error: "Not authenticated." }));
  if (!(await getUserId(accessToken, serviceKey))) return cors(json(401, { error: "Invalid session." }));

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return cors(json(400, { error: "Invalid JSON." })); }
  try {
    switch (body.action) {
      case "list": return cors(json(200, await listFeed(body.feed === "nos" ? "nos" : "easy")));
      case "article": return cors(json(200, await getArticle(String(body.url || ""))));
      case "gloss":
      case "translate": {
        const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
        if (!apiKey) return cors(json(503, { error: "Lookups aren't set up on the server." }));
        const r = body.action === "gloss" ? await gloss(apiKey, body.word, body.sentence) : await translate(apiKey, body.sentence);
        return cors(json(200, r));
      }
      default: return cors(json(400, { error: "Unknown action." }));
    }
  } catch (e) {
    return cors(json(200, { error: e.message || "Something went wrong." }));
  }
};

async function getUserId(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const user = await res.json();
    return user.id || null;
  } catch { return null; }
}

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}

function cors(response) {
  return { ...response, headers: { ...(response.headers || {}), "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" } };
}

exports._test = { parseNosFeed, htmlToParagraphs, cleanGloss, parseJsonObject, allowedArticleUrl, FULL_TEXT_MIN };
