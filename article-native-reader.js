// article-native-reader.js — full-text articles from subscriber papers on the
// iPhone app.
//
// The server-side fetch (netlify/functions/fetch-article.js) reads pages as an
// anonymous visitor from a cloud IP, so NYT / The Economist / Star Tribune give it
// a teaser or block it outright. In the iPhone app, the ArticleReader plugin
// (ios/App/App/ArticleReaderPlugin.swift) instead:
//   • login(): opens the paper's site in an in-app browser so Luke signs in once;
//     the session cookies persist on the phone (never sent to our server).
//   • extract(): loads the article in an invisible web view with those cookies,
//     then runs ARTICLE_DOM_EXTRACTOR_SOURCE in the rendered page.
// This file holds the pure parts (paper registry, extractor, result choice) so
// they are testable without a device. app.js wires them into the reader.

export const SUBSCRIBER_PAPERS = [
  {
    key: "nyt",
    name: "The New York Times",
    hostRe: /(^|\.)nytimes\.com$/i,
    cookieDomain: "nytimes.com",
    loginUrl: "https://myaccount.nytimes.com/auth/login"
  },
  {
    key: "economist",
    name: "The Economist",
    hostRe: /(^|\.)economist\.com$/i,
    cookieDomain: "economist.com",
    loginUrl: "https://www.economist.com/"
  },
  {
    key: "startribune",
    name: "Star Tribune",
    hostRe: /(^|\.)startribune\.com$/i,
    cookieDomain: "startribune.com",
    loginUrl: "https://www.startribune.com/"
  }
];

// The subscriber paper an article belongs to (by URL host, then by its
// publication key), or null for anything else.
export function subscriberPaperFor(article) {
  let host = "";
  try { host = new URL(String(article?.url || "")).hostname; } catch { /* not a URL */ }
  if (host) {
    const byHost = SUBSCRIBER_PAPERS.find((p) => p.hostRe.test(host));
    if (byHost) return byHost;
  }
  const pub = String(article?.publication || "").toLowerCase();
  return SUBSCRIBER_PAPERS.find((p) => p.key === pub) || null;
}

// Character count of an HTML body's text (tags and entities stripped).
export function bodyTextLength(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

// Below this, a news article is almost certainly a paywall teaser. The papers'
// teasers run ~1–3 paragraphs; a full piece is several thousand characters.
export const TEASER_MAX_CHARS = 2500;

export function looksLikeTeaser(html) {
  const n = bodyTextLength(html);
  return n > 0 && n < TEASER_MAX_CHARS;
}

// Pick the better of two extraction results ({ text, ... } or null): the one
// with more body text. Returns null when neither has text.
export function chooseLongerResult(a, b) {
  const la = a?.text ? bodyTextLength(a.text) : 0;
  const lb = b?.text ? bodyTextLength(b.text) : 0;
  if (!la && !lb) return null;
  return la >= lb ? a : b;
}

// Parse what the native extract() call returned: { json } holding the
// extractor's JSON (or "null"), plus finalUrl. Returns { title, author, date,
// text, finalUrl } or null.
export function parseNativeExtractResult(res) {
  if (!res || typeof res.json !== "string") return null;
  let data;
  try { data = JSON.parse(res.json); } catch { return null; }
  if (!data || typeof data.text !== "string" || !data.text.trim()) return null;
  return {
    title: typeof data.title === "string" ? data.title : "",
    author: typeof data.author === "string" ? data.author : "",
    date: typeof data.date === "string" ? data.date : "",
    text: data.text,
    finalUrl: typeof res.finalUrl === "string" ? res.finalUrl : ""
  };
}

// Runs INSIDE the publisher's page (evaluated by the native web view), so it must
// be self-contained: no imports, no closure over this module. Returns a JSON
// string of { title, author, date, text } (text = <p>/<h3> HTML), or "null".
// Adapted from the Chrome extension's extractArticleTextFromDOM
// (chrome-extension/background.js), plus selectors for the three papers.
export function articleDomExtractor() {
  function esc(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function getMeta(name) {
    const el = document.querySelector('meta[property="' + name + '"]') || document.querySelector('meta[name="' + name + '"]');
    return (el && el.getAttribute("content")) || "";
  }
  function textOf(el) {
    return String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  }
  const timeEl = document.querySelector("time[datetime]");
  const title = getMeta("og:title") || document.title || "";
  const author = getMeta("author") || getMeta("article:author") || getMeta("byl") || "";
  const date = getMeta("article:published_time") || getMeta("date") || (timeEl && timeEl.getAttribute("datetime")) || "";

  const SELECTORS = [
    // The Economist
    '[data-component="paragraph"]',
    '[class*="article__body-text"]',
    '[data-test-id="Article Body"]',
    // NYT
    'section[name="articleBody"]',
    '[data-testid="article-body"]',
    '[class*="StoryBodyCompanionColumn"]',
    // Star Tribune + generic
    '[class*="article-body"]',
    '[class*="articleBody"]',
    '[class*="article__body"]',
    '[class*="story-body"]',
    '[class*="entry-content"]',
    "article",
    "main"
  ];
  const SKIP_RE = /^(subscribe|sign in|log in|advertisement|share|follow|newsletter|cookies|more from|read more|listen|related)/i;

  // Many sites split one body across several same-class nodes (or make each
  // paragraph its own match), so collect from ALL matches.
  function collectBlocks(containers) {
    const seen = new Set();
    const blocks = [];
    let totalLen = 0;
    containers.forEach(function (container) {
      const els = /^(P|H2|H3|H4|BLOCKQUOTE)$/.test(container.tagName)
        ? [container]
        : Array.from(container.querySelectorAll("p, h2, h3, h4, blockquote"));
      els.forEach(function (el) {
        if (el.closest("nav, aside, footer, [aria-hidden='true']")) return;
        const cls = (el.getAttribute("class") || "") + " " + ((el.parentElement && el.parentElement.getAttribute("class")) || "");
        if (/promo|newsletter|ad[-_]|related|recommend|paywall/i.test(cls)) return;
        const text = textOf(el);
        if (text.length < 12 || seen.has(text)) return;
        if (text.length < 120 && SKIP_RE.test(text)) return;
        seen.add(text);
        const tag = el.tagName.toLowerCase();
        blocks.push(tag === "p" || tag === "blockquote" ? "<p>" + esc(text) + "</p>" : "<h3>" + esc(text) + "</h3>");
        totalLen += text.length;
      });
    });
    return { blocks: blocks, totalLen: totalLen };
  }

  let best = null;
  for (let i = 0; i < SELECTORS.length; i++) {
    try {
      const els = Array.from(document.querySelectorAll(SELECTORS[i]));
      if (!els.length) continue;
      const cand = collectBlocks(els);
      if (cand.blocks.length >= 3) { best = cand; break; }
    } catch (e) { /* skip bad selector */ }
  }
  // If the page's <article>/<main> yields much more, the specific selector only
  // caught a fragment.
  const broadRoot = document.querySelector("article") || document.querySelector("main");
  if (broadRoot) {
    const broad = collectBlocks([broadRoot]);
    if (broad.blocks.length >= 3 && (!best || broad.totalLen > best.totalLen * 1.6)) best = broad;
  }
  if (!best || best.blocks.length < 3) return "null";
  return JSON.stringify({ title: title.trim(), author: author.trim(), date: date.trim(), text: best.blocks.join("\n") });
}

// The script string handed to the native side.
export const ARTICLE_DOM_EXTRACTOR_SOURCE = "(" + articleDomExtractor.toString() + ")()";
