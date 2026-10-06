// News intake (NEWS_INTAKE_DESIGN.md, NEWS_PAGE_DESIGN.md): every article LINKED
// in an email from NYT / The Economist / the Star Tribune / The Athletic becomes
// one card on the News page, tagged with a newspaper section. Never the same
// article twice (a compact "seen" record), never stale news (3-day cutoff), and
// only from papers Luke is signed in to (the sign-in status row, see Storage).
//
// Storage is two rows of their own (see Storage below), kept apart from
// mailai_<userId> so the recipe bell's reads never carry news data. Only
// service-role functions touch them (no group prefix → no client RLS match).
// Files prefixed with _ are not deployed as individual functions.
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

const DAY_MS = 86400000;
const FRESH_DAYS = 3;          // older articles are never delivered (News keeps 3 days)
const SEEN_DAYS = 30;          // seen-record window (well past FRESH_DAYS)
const PENDING_CAP = 300;
const PER_EMAIL_CAP = 40;      // articles taken from one email
const RESOLVE_CAP = 60;        // click-trackers resolved per email
const META_CONCURRENCY = 6;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15";

// One entry per paper. `key` is the Settings → Mail AI toggle (on by default:
// only an explicit false disables — Luke, 2026-09-29). `paper` is the Media → Publications key.
// Order matters: the first source whose sender matches wins, so The Athletic
// (whose mail can come from nytimes.com) is listed before the NYT.
const NEWS_LINK_SOURCES = [
  {
    key: "athleticNewsLinks",
    paper: "athletic",
    name: "The Athletic",
    // theathletic.com senders, or NYT mail whose display name is The Athletic.
    senderRe: /theathletic\.com|\bthe athletic\b/i,
    // nytimes.com/athletic/<id>/YYYY/MM/DD/<slug> (and the legacy theathletic.com).
    articleRe: /^https?:\/\/(?:www\.)?(?:nytimes\.com\/athletic|theathletic\.com)\/\d{4,}\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+/i,
    trackerRe: /^https?:\/\/(?:nl|email|click|e|links?)\.(?:nytimes|theathletic)\.com\/|^https?:\/\/[^/]*(?:exacttarget|sailthru|cmail\d*|list-manage|sendgrid|braze|bnc\.lt)\.[^/]+\//i,
    titleSuffixRe: /\s*[-–|]\s*(?:The Athletic|The New York Times)\s*$/i
  },
  {
    key: "nytNewsLinks",
    paper: "nyt",
    name: "The New York Times",
    senderRe: /nytimes\.com/i,
    // www.nytimes.com/YYYY/MM/DD/…, plus /interactive/ and /live/ variants.
    // cooking./games/wirecutter/athletic never match (different host or path).
    articleRe: /^https?:\/\/(?:www\.)?nytimes\.com\/(?:interactive\/|live\/)?\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/[^?#\s"']+/i,
    trackerRe: /^https?:\/\/(?:nl|email|click|e|links?)\.nytimes\.com\//i,
    titleSuffixRe: /\s*[-–|]\s*The New York Times\s*$/i
  },
  {
    key: "economistNewsLinks",
    paper: "economist",
    name: "The Economist",
    senderRe: /economist\.com/i,
    articleRe: /^https?:\/\/(?:www\.)?economist\.com\/[a-z0-9-]+\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+/i,
    trackerRe: /^https?:\/\/(?!www\.)[^/]*economist\.com\/|^https?:\/\/[^/]*(?:exacttarget|sailthru|cmail\d*|list-manage|sendgrid|braze|bnc\.lt)\.[^/]+\//i,
    titleSuffixRe: /\s*[-–|]\s*The Economist\s*$/i
  },
  {
    key: "startribuneNewsLinks",
    paper: "startribune",
    name: "Star Tribune",
    senderRe: /startribune\.com/i,
    // startribune.com/<slug>/<numeric id> — no date in the URL.
    articleRe: /^https?:\/\/(?:www\.)?startribune\.com\/[a-z0-9-]+\/\d{6,}(?=[/?#"'\s]|$)/i,
    trackerRe: /^https?:\/\/(?!www\.)[^/]*startribune\.com\/|^https?:\/\/[^/]*(?:exacttarget|sailthru|cmail\d*|list-manage|sendgrid|braze|newsmemory|bnc\.lt)\.[^/]+\//i,
    titleSuffixRe: /\s*[-–|]\s*(?:Star ?Tribune|startribune\.com)\s*$/i
  }
];

function enabledNewsLinkSources(mailAiSettings) {
  return NEWS_LINK_SOURCES.filter((s) => mailAiSettings?.[s.key] !== false);
}

// `signIns` (the sweep passes it): also require a working sign-in for the paper.
// Without it (newsletter conversion) only the Mail AI toggle counts.
function newsLinkSourceForSender(from, mailAiSettings, { signIns } = {}) {
  const source = enabledNewsLinkSources(mailAiSettings).find((s) => s.senderRe.test(from || "")) || null;
  if (source && signIns !== undefined && !paperSignedIn(signIns, source.paper)) return null;
  return source;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/gi, "’");
}

const textOf = (html) => decodeEntities(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// Canonical article URL + identity key. Drops query/hash (smid, utm_*, …) and a
// trailing slash; the key also ignores "www." and the scheme.
function canonicalizeArticleUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return { url: `https://${host}${path}`, key: `${host.replace(/^www\./, "")}${path}` };
}

// Compact, deterministic id for the seen record (FNV-1a, two streams → ~64 bits).
function seenId(key) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  const s = String(key);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

function dateFromUrl(url) {
  const m = String(url || "").match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function isFresh(iso, nowMs) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return true; // unknown date → caller supplies a fallback
  // URL dates are midnight UTC; allow the whole 7th day.
  return nowMs - t <= (FRESH_DAYS + 1) * DAY_MS;
}

function unwrapParamRedirect(raw) {
  let url = String(raw || "");
  for (let i = 0; i < 3; i++) {
    const m = url.match(/[?&](?:url|u|redirect_uri|destination|target)=([^&]+)/i);
    if (!m) break;
    try { url = decodeURIComponent(m[1]); } catch { break; }
  }
  return url;
}

// ESP click-trackers that carry the destination IN the link, base64url-encoded as
// one path segment — e.g. the Star Tribune's (Sailthru) links:
//   https://link.email.startribune.com/click/<id>/<base64url(article url)>/<hash>
// Decoding it locally needs no network round-trip (verified against a real
// Star Tribune newsletter, 2026-09-29). Returns the input unchanged otherwise.
function unwrapEmbeddedUrl(raw) {
  const url = String(raw || "");
  let path;
  try { path = new URL(url).pathname; } catch { return url; }
  for (const seg of path.split("/")) {
    if (seg.length < 16 || !/^[A-Za-z0-9_-]+={0,2}$/.test(seg)) continue;
    let decoded = "";
    try { decoded = Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch { continue; }
    if (/^https?:\/\/[^\s"'<>]+$/i.test(decoded)) return decoded;
  }
  return url;
}

const BOILER_RE = /unsubscrib|view (it )?in (your )?browser|privacy|advertis|manage (your )?(preferences|account|subscription)|sign ?up|log ?in|app store|google play|feedback|help center|terms of|follow us|facebook|twitter|instagram|tiktok|linkedin|youtube|games|crossword|wordle|wirecutter|cooking|gift|subscribe|contact us|forward/i;
const JUNK_TITLE_RE = /^(read|see|view|listen|watch|tap|click|continue|more|full story|share|here|go|open)\b.{0,20}$/i;

// All article links of `source` in an email body, de-duplicated by canonical
// key, with the best anchor text and first image seen for each. Opaque click-
// trackers are resolved (bounded, parallel) via `resolve`.
async function extractNewsLinks(html, source, { resolve } = {}) {
  const anchors = [];
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(String(html || ""))) !== null) anchors.push({ href: decodeEntities(m[1]), inner: m[2], pos: anchors.length });

  const hits = [];       // { url, inner, pos } — pos = the anchor's place in the email
  const candidates = []; // trackers to resolve
  const seenHrefs = new Set();
  for (const { href, inner, pos } of anchors) {
    const embedded = unwrapEmbeddedUrl(href);
    const unwrapped = unwrapParamRedirect(embedded);
    const direct = unwrapped.match(source.articleRe);
    if (direct) { hits.push({ url: direct[0], inner, pos }); continue; }
    if (embedded !== href) continue; // destination decoded and it isn't an article — nothing to resolve
    if (!resolve || !source.trackerRe.test(href) || seenHrefs.has(href)) continue;
    seenHrefs.add(href);
    const text = textOf(inner);
    if (BOILER_RE.test(text)) continue;
    const weight = (/<img\b/i.test(inner) ? 2 : 0) + (text.length >= 20 ? 2 : text.length >= 8 ? 1 : 0);
    candidates.push({ href, inner, weight, pos });
  }
  if (candidates.length) {
    const toResolve = candidates.sort((a, b) => b.weight - a.weight).slice(0, RESOLVE_CAP);
    const resolved = await mapLimit(toResolve, 10, async ({ href, inner, pos }) => {
      const final = unwrapParamRedirect(await resolve(href));
      const hit = final.match(source.articleRe);
      return hit ? { url: hit[0], inner, pos } : null;
    });
    resolved.filter(Boolean).forEach((r) => hits.push(r));
  }
  // Document order (resolved trackers were appended last): the first link is the
  // newsletter's lead story (NEWS_PAGE_DESIGN.md §5).
  hits.sort((a, b) => a.pos - b.pos);

  const byKey = new Map();
  for (const { url, inner } of hits) {
    const c = canonicalizeArticleUrl(url);
    if (!c) continue;
    const text = textOf(inner);
    const goodText = text.length >= 8 && !JUNK_TITLE_RE.test(text) && !BOILER_RE.test(text) ? text : "";
    const img = (inner.match(/<img\b[^>]*\ssrc=["']([^"']+)["']/i) || [])[1] || "";
    const cur = byKey.get(c.key);
    if (!cur) {
      if (byKey.size >= PER_EMAIL_CAP) continue;
      byKey.set(c.key, { url: c.url, key: c.key, anchorText: goodText, emailImage: /^https:\/\//i.test(img) ? decodeEntities(img) : "" });
    } else {
      if (goodText.length > cur.anchorText.length) cur.anchorText = goodText;
      if (!cur.emailImage && /^https:\/\//i.test(img)) cur.emailImage = decodeEntities(img);
    }
  }
  return [...byKey.values()];
}

// <meta> tags of an HTML head → { title, description, image, publishedAt }.
function parseArticleMeta(head) {
  const meta = {};
  const tagRe = /<meta\b[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(String(head || ""))) !== null) {
    const tag = m[0];
    const name = (tag.match(/\b(?:property|name|itemprop)=["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/\bcontent=["']([^"']*)["']/i) || [])[1];
    if (name && content != null && !(name.toLowerCase() in meta)) meta[name.toLowerCase()] = decodeEntities(content).trim();
  }
  const titleTag = textOf((String(head || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const image = meta["og:image"] || meta["twitter:image"] || meta["twitter:image:src"] || "";
  return {
    title: meta["og:title"] || meta["twitter:title"] || titleTag || "",
    description: meta["og:description"] || meta["twitter:description"] || meta["description"] || "",
    image: /^https:\/\//i.test(image) ? image : "",
    publishedAt: meta["article:published_time"] || meta["datepublished"] || meta["article:published"] || meta["pubdate"] || "",
    section: meta["article:section"] || meta["section"] || meta["parsely-section"] || ""
  };
}

function titleFromSlug(url) {
  const segs = String(url || "").replace(/\.html?$/i, "").split("/").filter(Boolean);
  const slug = [...segs].reverse().find((s) => /[a-z]/i.test(s) && s.includes("-")) || "";
  return slug ? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "";
}

// ── Sections (NEWS_PAGE_DESIGN.md §3) ─────────────────────────────────────────
// One shared list across papers; anything unmapped is "more" (never dropped).
const NEWS_SECTIONS = ["world", "us", "politics", "mn", "business", "science", "opinion", "culture", "sports", "more"];

// NYT: the path right after /YYYY/MM/DD/.
const NYT_SECTION_RULES = [
  [/^us\/politics\b|^upshot\b/, "politics"],
  [/^(?:us|nyregion)\b/, "us"],
  [/^world\b/, "world"],
  [/^(?:business|technology|realestate|your-money|dealbook)\b/, "business"],
  [/^(?:science|health|climate|well)\b/, "science"],
  [/^opinion\b/, "opinion"],
  [/^(?:arts|books|movies|style|t-magazine|theater|travel|dining|food|fashion|magazine)\b/, "culture"],
  [/^sports\b/, "sports"]
];
// Economist: the first path segment.
const ECONOMIST_SECTIONS = {
  europe: "world", asia: "world", china: "world", "middle-east-and-africa": "world",
  "the-americas": "world", international: "world", britain: "world",
  "united-states": "us",
  business: "business", "finance-and-economics": "business",
  "science-and-technology": "science",
  leaders: "opinion", letters: "opinion", "by-invitation": "opinion",
  culture: "culture"
};
// A free-text section label (article:section meta — the Star Tribune's only
// source, and the fallback for every paper). Inferred labels; unknown → null.
function sectionFromLabel(label) {
  const l = String(label || "").toLowerCase().trim();
  if (!l) return null;
  if (/\bpolitic/.test(l)) return "politics";
  if (/\b(local|minneapolis|st\.? paul|minnesota|metro|duluth|twin cities)\b/.test(l)) return "mn";
  if (/\b(world|international|europe|asia|africa|middle east|americas)\b/.test(l)) return "world";
  if (/^(u\.?s\.?|nation(al)?|us news)$/.test(l) || /\bnation\b/.test(l)) return "us";
  if (/\b(business|economy|economics|finance|money|tech(nology)?|real estate|markets?)\b/.test(l)) return "business";
  if (/\b(science|health|climate|environment|well(ness)?)\b/.test(l)) return "science";
  if (/\b(opinion|editorial|commentary|letters?|columns?)\b/.test(l)) return "opinion";
  if (/\b(arts?|books?|movies?|style|variety|food|dining|travel|culture|entertainment|theater|music|tv)\b/.test(l)) return "culture";
  if (/\b(sports?|vikings|twins|timberwolves|wild|lynx|gophers|nfl|nba|mlb|nhl)\b/.test(l)) return "sports";
  return null;
}
// The section for one article. Pure.
function sectionFor(url, meta, paper) {
  if (paper === "athletic") return "sports";
  let path = "";
  try { path = new URL(url).pathname.replace(/^\/+/, ""); } catch { /* bad url */ }
  if (paper === "nyt") {
    const after = (path.match(/(?:^|\/)\d{4}\/\d{2}\/\d{2}\/(.+)$/) || [])[1] || "";
    const rule = NYT_SECTION_RULES.find(([re]) => re.test(after));
    if (rule) return rule[1];
  }
  if (paper === "economist") {
    const hit = ECONOMIST_SECTIONS[path.split("/")[0]];
    if (hit) return hit;
  }
  return sectionFromLabel(meta?.section) || "more";
}

// A card from one extracted link + its page meta (meta may be {}), or null if it
// is too old. Pure.
function buildNewsCard(link, meta, source, { emailDate, nowMs }) {
  const urlDate = dateFromUrl(link.url);
  const metaDate = Date.parse(meta?.publishedAt || "");
  const publishedAt = urlDate
    || (!Number.isNaN(metaDate) ? new Date(metaDate).toISOString() : null)
    || (emailDate && !Number.isNaN(Date.parse(emailDate)) ? new Date(emailDate).toISOString() : null);
  if (publishedAt && !isFresh(publishedAt, nowMs)) return null;
  const title = String(meta?.title || "").replace(source.titleSuffixRe, "").trim()
    || link.anchorText || titleFromSlug(link.url);
  if (!title) return null;
  const subtitle = String(meta?.description || "").trim();
  return {
    id: seenId(link.key),
    url: link.url,
    title: title.slice(0, 300),
    subtitle: subtitle && subtitle !== title ? subtitle.slice(0, 500) : "",
    image: meta?.image || link.emailImage || "",
    paper: source.paper,
    source: source.name,
    section: sectionFor(link.url, meta, source.paper),
    publishedAt,
    discoveredAt: new Date(nowMs).toISOString()
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  });
  await Promise.all(workers);
  return out;
}

// Full per-email pipeline: extract → skip seen → cheap URL-date freshness check →
// fetch page meta (bounded, fails soft) → build cards. Returns the new cards
// plus every seen-id considered (including stale ones, so they're never
// re-fetched). `seen` is the current seen map ({ id: dayNumber }).
//
// `lead`: this email is a paper's main newsletter, so its first article is a
// Front page lead. `leadId` is returned even when that article was seen before,
// so the merge can mark the card already on News.
async function collectNewsCards(html, source, { emailDate, seen = {}, nowMs = Date.now(), resolve = followRedirects, fetchMeta = fetchArticleMeta, lead = false } = {}) {
  const links = await extractNewsLinks(html, source, { resolve });
  const leadId = lead && links.length ? seenId(links[0].key) : null;
  const fresh = [];
  const seenIds = [];
  for (const link of links) {
    const id = seenId(link.key);
    if (seen[id] != null) continue;
    seenIds.push(id);
    const urlDate = dateFromUrl(link.url);
    if (urlDate && !isFresh(urlDate, nowMs)) continue; // stale — no fetch needed
    fresh.push(link);
  }
  const metas = await mapLimit(fresh, META_CONCURRENCY, (l) => fetchMeta(l.url).catch(() => ({})));
  const cards = fresh.map((l, i) => buildNewsCard(l, metas[i] || {}, source, { emailDate, nowMs })).filter(Boolean);
  // `found`: article links in the email at all (seen or not) — an email whose
  // articles were all delivered before is still a news email and gets filed.
  return { cards, seenIds, found: links.length, leadId };
}

// Merge a sweep batch's results into the stored row (read fresh just before
// the write). Pure. Prunes the seen record to SEEN_DAYS and pending cards past
// the freshness window. A card already in the stored seen record (e.g. a
// concurrent sweep got there first) is skipped; the same card from two emails
// in one batch is added once.
function mergeNewsResults(row, results, nowMs = Date.now()) {
  const today = Math.floor(nowMs / DAY_MS);
  const seen = {};
  for (const [id, day] of Object.entries(row?.newsSeen || {})) if (today - Number(day) <= SEEN_DAYS) seen[id] = Number(day);
  const storedSeen = new Set(Object.keys(seen));
  const pending = prunePending(row?.newsPending, nowMs).map((c) => ({ ...c }));
  const pendingIds = new Set(pending.map((c) => c.id));
  let added = 0;
  for (const r of results || []) {
    for (const card of r.cards || []) {
      if (pendingIds.has(card.id) || storedSeen.has(card.id)) continue;
      pending.push(card);
      pendingIds.add(card.id);
      added++;
    }
    for (const id of r.seenIds || []) if (seen[id] == null) seen[id] = today;
    if (r.leadId) {
      const card = pending.find((c) => c.id === r.leadId);
      if (card) card.lead = new Date(nowMs).toISOString();
    }
  }
  const ms = (c) => Date.parse(c.publishedAt || c.discoveredAt) || 0;
  pending.sort((a, b) => ms(b) - ms(a));
  return { row: { ...(row || {}), newsPending: pending.slice(0, PENDING_CAP), newsSeen: seen }, added };
}

function prunePending(list, nowMs = Date.now()) {
  return (Array.isArray(list) ? list : []).filter((c) => c && c.id && c.url
    && isFresh(c.publishedAt || c.discoveredAt, nowMs));
}

// ── Sign-in gate (NEWS_PAGE_DESIGN.md §4) ────────────────────────────────────
// A paper feeds News only while Luke is signed in to it. Status per paper:
//   signed-in   the subscriber page answered as signed in
//   unverified  a sign-in is saved but it couldn't be (or can't be) checked
//   expired     the paper answered as signed out
//   none        no sign-in saved
// The Athletic is an NYT product and follows the NYT sign-in.
const SIGNIN_PAPERS = ["nyt", "economist", "startribune"];
const SIGNIN_COOKIE_FIELDS = { nyt: "nytCookie", economist: "economistCookie", startribune: "stribCookie" };
const signInPaperFor = (paper) => (paper === "athletic" ? "nyt" : paper);
const SIGNIN_RECHECK_MS = DAY_MS;

function paperSignedIn(signIns, paper) {
  const st = signIns?.[signInPaperFor(paper)]?.status;
  return st === "signed-in" || st === "unverified";
}

// One check against a paper's subscriber page. Returns "none" | "unverified" |
// "signed-in" | "expired", or null when the answer is inconclusive (network
// error, blocked) — the caller then keeps the previous status. Network injected.
async function checkPaperSignIn(paper, cookie, { fetchImpl = fetch } = {}) {
  const c = String(cookie || "").trim();
  if (!c) return "none";
  if (paper === "startribune") return "unverified"; // no known subscriber page to check yet
  const target = paper === "nyt"
    // Same signed-out markers sync-saved-articles.js uses for this page.
    ? { url: "https://www.nytimes.com/saved", cookie: `NYT-S=${c}`, out: /\/login\?|"isLoggedIn"\s*:\s*false|data-testid="login-button"/i }
    : { url: "https://www.economist.com/for-you/bookmarks", cookie: `blaize_session=${c}`, out: /"isLoggedIn"\s*:\s*false|"loggedIn"\s*:\s*false|myaccount\.economist\.com\/s\/login/i };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetchImpl(target.url, { signal: ctrl.signal, headers: { cookie: target.cookie, "user-agent": UA, accept: "text/html" } });
    clearTimeout(t);
    if (/\/(?:login|signin|sign-in)\b/i.test(res.url || "")) return "expired"; // redirected to a sign-in page
    if (res.status === 401) return "expired";
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 400000);
    return target.out.test(html) ? "expired" : "signed-in";
  } catch { return null; }
}

// Check every paper against the cookies the client sent (its articleSync).
// Returns the new status map. An inconclusive check keeps a previous answer, or
// falls to "unverified" when a cookie is saved but has never been checked.
async function verifySignIns(prev, cookies, { check = checkPaperSignIn, nowMs = Date.now() } = {}) {
  const out = {};
  await Promise.all(SIGNIN_PAPERS.map(async (paper) => {
    const result = await check(paper, cookies?.[SIGNIN_COOKIE_FIELDS[paper]]);
    const before = prev?.[paper]?.status;
    const status = result || (before && before !== "none" ? before : "unverified");
    out[paper] = { status, checkedAt: new Date(nowMs).toISOString() };
  }));
  return out;
}

// The Media savedArticles record for an accepted card (gmail.js resolveNews).
// Mirrored by news-ui.js sentArticleRecord for the optimistic local
// copy — same id, so the two merge into one (savedArticles unions by id).
function acceptedArticleRecord(card, nowIso = new Date().toISOString()) {
  const pub = card.publishedAt ? new Date(card.publishedAt) : null;
  return {
    id: `nl-${card.id}`,
    url: card.url,
    title: card.title,
    subtitle: card.subtitle || "",
    image: card.image || "",
    author: card.source,
    date: pub && !Number.isNaN(pub.getTime()) ? pub.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "",
    publication: card.paper,
    savedAt: nowIso,
    text: null // body fetched on open by the Media reader (subscriber sync when configured)
  };
}

// ── Network ──────────────────────────────────────────────────────────────────

// Resolved tracker hops are cached for the life of the function instance —
// recipe and news extraction often resolve the same NYT click-trackers.
const redirectCache = new Map();
async function followRedirects(url, hops = 3) {
  if (redirectCache.has(url)) return redirectCache.get(url);
  let cur = url;
  for (let i = 0; i < hops; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(cur, { method: "GET", redirect: "manual", signal: ctrl.signal, headers: { "user-agent": UA } });
      clearTimeout(t);
      const loc = res.headers.get("location");
      if (!loc) break;
      cur = new URL(loc, cur).toString();
    } catch { break; }
  }
  if (redirectCache.size > 2000) redirectCache.clear();
  redirectCache.set(url, cur);
  return cur;
}

// An article page's <head> meta. Range-limited, timeout-bounded, fails soft to {}.
async function fetchArticleMeta(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": UA, accept: "text/html", range: "bytes=0-199999" } });
    clearTimeout(t);
    if (!res.ok && res.status !== 206) return {};
    const html = await res.text();
    const end = html.search(/<\/head>/i);
    return parseArticleMeta(end > 0 ? html.slice(0, end) : html.slice(0, 200000));
  } catch { return {}; }
}

// ── Storage ──────────────────────────────────────────────────────────────────
// Two rows so each read carries only what it needs (egress, CLAUDE.md):
//   mailnews_<userId>      { newsPending }  — the bell reads + swipes rewrite this
//   mailnewsseen_<userId>  { newsSeen }     — only the mail sweep touches this

const sbHeaders = (serviceKey) => ({ apikey: serviceKey, authorization: `Bearer ${serviceKey}` });

async function loadRowState(serviceKey, id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.${id}&select=state`, {
    headers: { ...sbHeaders(serviceKey), accept: "application/json" }
  });
  if (!res.ok) throw new Error(`${id.split("_")[0]} row load failed (${res.status})`);
  const rows = await res.json().catch(() => []);
  return rows[0]?.state || {};
}

// Must throw on failure: the sweep files the source emails only after this write.
async function saveRowState(serviceKey, id, state) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: { ...sbHeaders(serviceKey), "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id, state, updated_at: new Date().toISOString() })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${id.split("_")[0]} row save failed (${res.status}): ${detail.slice(0, 200)}`);
  }
}

async function loadNewsSeen(serviceKey, userId) {
  return (await loadRowState(serviceKey, `mailnewsseen_${userId}`)).newsSeen || {};
}

// mailnewssubs_<userId> { papers: { nyt: { status, checkedAt }, … } } — tiny; the
// sweep reads it once per run; the News page reads it and rewrites it on a check.
async function loadNewsSignIns(serviceKey, userId) {
  return (await loadRowState(serviceKey, `mailnewssubs_${userId}`)).papers || {};
}
async function saveNewsSignIns(serviceKey, userId, papers) {
  await saveRowState(serviceKey, `mailnewssubs_${userId}`, { papers });
}

// The sweep's batch write (NEWS_PAGE_DESIGN.md §10): the batch's cards go into
// news_articles (insert, ignore duplicates), newsletter leads are marked, then the
// seen record is updated. Insert first: if the seen write fails the emails are
// retried, and re-inserting is a no-op. Must throw on failure — the sweep files the
// source emails only after this succeeds.
async function saveNewsBatch(serviceKey, userId, results, nowMs = Date.now()) {
  const Store = require("./_news-store.js");
  const cards = (results || []).flatMap((r) => r.cards || []);
  const added = await Store.insertArticles(serviceKey, userId, cards, "email");
  const leadIds = (results || []).map((r) => r.leadId).filter(Boolean);
  if (leadIds.length) await Store.markLeads(serviceKey, userId, leadIds, new Date(nowMs).toISOString());
  const seenState = await loadRowState(serviceKey, `mailnewsseen_${userId}`);
  const merged = mergeNewsResults({ newsSeen: seenState.newsSeen }, results, nowMs);
  await saveRowState(serviceKey, `mailnewsseen_${userId}`, { newsSeen: merged.row.newsSeen });
  return { added };
}

module.exports = {
  NEWS_LINK_SOURCES,
  NEWS_SECTIONS,
  SIGNIN_PAPERS,
  SIGNIN_RECHECK_MS,
  FRESH_DAYS,
  SEEN_DAYS,
  enabledNewsLinkSources,
  newsLinkSourceForSender,
  canonicalizeArticleUrl,
  seenId,
  dateFromUrl,
  isFresh,
  extractNewsLinks,
  parseArticleMeta,
  sectionFor,
  sectionFromLabel,
  buildNewsCard,
  collectNewsCards,
  mergeNewsResults,
  prunePending,
  paperSignedIn,
  checkPaperSignIn,
  verifySignIns,
  acceptedArticleRecord,
  followRedirects,
  fetchArticleMeta,
  loadNewsSeen,
  loadNewsSignIns,
  saveNewsSignIns,
  saveNewsBatch
};
