// News story titles (NEWS_TITLES_DESIGN.md): telling a real headline from the
// words a newsletter happened to link ("your most pressing questions", "and
// here"), and finding a better one. Pure, except `repairTitles`, which takes its
// network through injected functions.
//
// Where bad titles came from (live data, 2026-10-28):
//   - Email intake: when the article page can't be read from Netlify, the card
//     fell back to the link's own words, often a fragment of a sentence.
//   - NYT live blogs: the feed titles every update "Here’s the latest."
//   - Feed titles with inline markup (<em>…</em>) lost part of their text.
//
// Egress: the hourly repair reads ~60 short rows a user (id, url, title,
// subtitle, origin) and PATCHes only rows it improves. No tableplan_states.

const GENERIC_RE = /^(?:here[’']s the latest|the latest|latest(?: updates?)?|live(?: updates?)?|what to know|what we know|updates?)[.!:]?$/i;
const DANGLING_END_RE = /\b(?:here|there|this|that|below|above|link|form|story|more|it|them)[.!]?$/i;
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "over", "the", "to", "vs", "with"]);
const ACRONYMS = { faq: "FAQ", nfl: "NFL", nba: "NBA", nhl: "NHL", mlb: "MLB", wnba: "WNBA", gop: "GOP", ice: "ICE", fbi: "FBI", cia: "CIA", ai: "AI", un: "U.N.", eu: "E.U.", us: "U.S.", uk: "U.K.", nato: "NATO", ceo: "CEO", mn: "MN" };
const BYLINE_RE = /\s+By\s+[A-Z][\w.'’-]*(?:\s+[A-Z][\w.'’-]*){0,3}(?:(?:,\s*|\s+and\s+)[A-Z][\w.'’-]*(?:\s+[A-Z][\w.'’-]*){0,3})*\s*$/;
const MAX_TITLE = 150;

const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean);
const squash = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");

function decode(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/gi, "’")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}
const textOf = (html) => decode(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// A URL slug as a title: "kamala-harris-is-sitting-out-minnesota-for-now" →
// "Kamala Harris Is Sitting Out Minnesota for Now". The last slug-like segment
// (has a letter and a hyphen) wins; .html and numeric ids are ignored.
function slugTitle(url, { segment } = {}) {
  let path = "";
  try { path = new URL(String(url || "")).pathname; } catch { path = String(url || ""); }
  const segs = path.replace(/\.html?$/i, "").split("/").filter(Boolean);
  const slug = segment || [...segs].reverse().find((s) => /[a-z]/i.test(s) && s.includes("-")) || "";
  return titleCaseWords(slug.split("-").filter(Boolean));
}

function titleCaseWords(list) {
  return list.map((w, i) => {
    const lw = w.toLowerCase();
    if (ACRONYMS[lw]) return ACRONYMS[lw];
    if (i > 0 && SMALL_WORDS.has(lw)) return lw;
    return lw.charAt(0).toUpperCase() + lw.slice(1);
  }).join(" ");
}

// The slug-derived title compared loosely: "Israels Future" matches the slug
// "israels-future" however it was cased.
function isSlugTitle(title, url) {
  const s = squash(slugTitle(url));
  return !!s && squash(title) === s;
}

const isGeneric = (title) => GENERIC_RE.test(String(title || "").trim());

// Starts lower-case, unless it's a lower-case brand ("iPhone", "eBay").
const startsLower = (t) => /^[a-z]/.test(t) && !/^[a-z]{1,2}[A-Z]/.test(t);

// Whether `title` reads as a real headline. `origin` "email" adds the checks for
// link text (short fragments, dangling "here", a slug stand-in, a glued byline);
// feed titles are the paper's own, so only generic and lower-case ones count.
function isWeakTitle(title, { url = "", origin = "rss" } = {}) {
  const t = String(title || "").trim();
  if (!t) return true;
  if (isGeneric(t)) return true;
  if (startsLower(t)) return true;
  if (origin !== "email") return false;
  if (words(t).length < 3) return true;
  if (DANGLING_END_RE.test(t)) return true;
  if (t.length > MAX_TITLE) return true;
  if (BYLINE_RE.test(t) && t.length > 40) return true;
  if (url && isSlugTitle(t, url)) return true;
  return false;
}

// The text of a newsletter link, split into its headline and the line under it.
// Newsletters often wrap a whole card in one link: headline, summary and byline.
// Block breaks (<br>, </p>, </h2>, </div>, …) separate them; a trailing byline is
// cut. → { headline, dek }
function splitAnchor(innerHtml) {
  const marked = String(innerHtml || "")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|td|tr|table|section|header|figure|figcaption|blockquote)>/gi, "\n")
    .replace(/<(?:p|div|h[1-6]|li|td|tr|table|section|header|figure|figcaption|blockquote)\b[^>]*>/gi, "\n");
  const segs = marked.split(/\n+/).map(textOf).filter(Boolean);
  const isByline = (s) => /^By\s+[A-Z]/.test(s);
  const content = segs.filter((s) => !isByline(s));
  const pick = content.findIndex((s) => words(s).length >= 2);
  let headline = pick >= 0 ? content[pick] : (content[0] || "");
  const dek = pick >= 0 ? (content.slice(pick + 1).find((s) => words(s).length >= 4) || "") : "";
  headline = headline.replace(BYLINE_RE, "").trim();
  return { headline, dek: dek.replace(BYLINE_RE, "").trim() };
}

// The best title for an email card. `meta` is the article page's head (may be {}),
// `anchor` the link's headline text. → { title, from: "meta" | "anchor" | "slug" }
function chooseEmailTitle({ metaTitle = "", anchor = "", url = "" } = {}) {
  const meta = String(metaTitle || "").trim();
  if (meta && !isGeneric(meta) && !startsLower(meta)) return { title: meta, from: "meta" };
  const slug = slugTitle(url);
  const a = String(anchor || "").trim();
  // Link text that spells the slug keeps its own casing ("Vikings win opener").
  if (a && slug && squash(a) === squash(slug) && !startsLower(a)) return { title: a, from: "anchor" };
  if (a && !isWeakTitle(a, { url, origin: "email" })) {
    const n = words(a).length;
    // A short link text loses to a much longer slug (slugs are usually the
    // paper's own headline, hyphenated): "Newly retired" vs "Jessie Diggins …".
    if (n >= 5 || !slug || words(slug).length <= n + 2) return { title: a, from: "anchor" };
  }
  if (slug) return { title: slug, from: "slug" };
  return { title: a || meta, from: a ? "anchor" : "meta" };
}

// NYT live blog: /live/YYYY/MM/DD/<section>/<blog>[/<entry>]. → { key, blogSlug, isMain } | null
function liveBlogOf(url) {
  let path = "";
  try { path = new URL(String(url || "")).pathname; } catch { return null; }
  const m = path.match(/^\/live\/(\d{4}\/\d{2}\/\d{2})\/([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!m) return null;
  return { key: `${m[1]}/${m[2]}/${m[3]}`, blogSlug: m[3], isMain: !m[4] };
}

const firstSentence = (s) => {
  const t = String(s || "").trim();
  const m = t.match(/^(.{20,140}?[.!?])(?:\s|$)/);
  return (m ? m[1] : t.slice(0, 140)).trim();
};

// A feed item's title, fixed when it's a generic stand-in: a live-blog update
// becomes "Live: <blog name>", anything else generic takes its summary's first
// sentence. → { title, subtitle }
function fixFeedTitle({ title = "", subtitle = "", url = "" } = {}) {
  const t = String(title || "").trim();
  if (!isGeneric(t)) return { title: t, subtitle };
  const live = liveBlogOf(url);
  if (live && live.blogSlug.includes("-")) return { title: `Live: ${slugTitle("", { segment: live.blogSlug })}`, subtitle };
  if (subtitle && words(subtitle).length >= 4) {
    const s = firstSentence(subtitle);
    const rest = String(subtitle).trim().slice(s.length).trim();
    return { title: s, subtitle: rest };
  }
  return { title: t, subtitle };
}

// A live blog's headline without its own "Live Updates:" label, for "Live: …":
// "Israel Election Results Live Updates: Exit Polls Show No Clear Winner" →
// "Israel Election Results: Exit Polls Show No Clear Winner".
function blogName(title) {
  const t = String(title || "").trim();
  return t.replace(/^live(?:\s+updates?)?\s*:\s*/i, "").replace(/\s+live(?:\s+updates?)?\s*:\s*/i, ": ").trim() || t;
}

// ── Hourly repair ────────────────────────────────────────────────────────────
// Given one user's recent candidate rows, what to change. `rssById`: this run's
// feed cards by id (their titles are the paper's own). `metas`: id → article
// head meta, fetched by the caller for the rows `wantsMeta` names. Pure.
function planRepairs(rows, { rssById = new Map(), metas = new Map() } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  // Live blogs: the main page's own title (from the email intake's page read),
  // shared with its updates.
  const blogTitles = new Map();
  for (const r of list) {
    const live = liveBlogOf(r.url);
    if (live?.isMain && r.title && !isWeakTitle(r.title, { url: r.url, origin: r.origin }) && !/^Live:/.test(r.title)) blogTitles.set(live.key, r.title);
  }
  const out = [];
  for (const r of list) {
    const origin = r.origin || "rss";
    const live = liveBlogOf(r.url);
    const weak = isWeakTitle(r.title, { url: r.url, origin });
    let next = null;
    const rss = rssById.get(r.id);
    if (weak && rss?.title && !isWeakTitle(rss.title, { url: r.url, origin: "rss" }) && rss.title !== r.title) {
      next = { title: rss.title, subtitle: r.subtitle ? null : (rss.subtitle || null), from: "feed" };
    }
    if (!next && live && !live.isMain && (weak || /^Live:/.test(r.title || "")) && blogTitles.has(live.key)) {
      const t = `Live: ${blogName(blogTitles.get(live.key))}`;
      if (t !== r.title) next = { title: t, subtitle: null, from: "blog" };
    }
    const meta = metas.get(r.id);
    if (!next && weak && meta?.title) {
      const t = String(meta.title).trim();
      if (!isWeakTitle(t, { url: r.url, origin: "rss" }) && t !== r.title) next = { title: t.slice(0, 300), subtitle: r.subtitle ? null : (meta.description || null), from: "page" };
    }
    if (!next && weak && origin === "rss") {
      const fixed = fixFeedTitle({ title: r.title, subtitle: r.subtitle || "", url: r.url });
      if (fixed.title !== r.title && !isGeneric(fixed.title)) next = { title: fixed.title, subtitle: fixed.subtitle !== (r.subtitle || "") ? (fixed.subtitle || "") : null, from: "feed-fix" };
    }
    // Last resort: the URL slug beats a sentence fragment or "Here’s the latest."
    if (!next && weak && (startsLower(r.title || "") || isGeneric(r.title))) {
      const slug = slugTitle(r.url);
      if (slug && words(slug).length >= 3 && !isGeneric(slug) && !/^heres the latest$/i.test(slug)) next = { title: slug, subtitle: null, from: "slug" };
    }
    if (next) out.push({ id: r.id, title: next.title.slice(0, 300), ...(next.subtitle != null ? { subtitle: String(next.subtitle).slice(0, 500) || null } : {}), from: next.from });
  }
  return out;
}

// The rows whose article page is worth reading again: email rows still weak and
// not fixable from the feed. Newest first, capped by the caller.
function wantsMeta(rows, { rssById = new Map(), nowMs = Date.now(), windowMs = 36 * 3_600_000 } = {}) {
  return (rows || []).filter((r) => (r.origin === "email" || isGeneric(r.title))
    && isWeakTitle(r.title, { url: r.url, origin: r.origin || "rss" })
    && !(liveBlogOf(r.url) && !liveBlogOf(r.url).isMain)
    && !rssById.has(r.id)
    && nowMs - (Date.parse(r.discovered_at || "") || 0) <= windowMs)
    .sort((a, b) => (Date.parse(b.discovered_at) || 0) - (Date.parse(a.discovered_at) || 0));
}

// One user's repair: read candidates, read up to `metaCap` article pages, patch.
// Network injected: getRows(query) → rows, patchRow(id, body), fetchMeta(url) → meta.
const REPAIR_COLUMNS = "id,url,title,subtitle,origin,discovered_at";
function repairQuery(userId, { nowMs = Date.now(), days = 3 } = {}) {
  const since = new Date(nowMs - days * 86_400_000).toISOString();
  return `user_id=eq.${encodeURIComponent(userId)}&discovered_at=gte.${encodeURIComponent(since)}`
    + `&or=${encodeURIComponent("(origin.eq.email,url.like.*/live/*,title.ilike.here*)")}`
    + `&select=${REPAIR_COLUMNS}&order=discovered_at.desc&limit=200`;
}

async function repairTitles({ userId, rssById = new Map(), getRows, patchRow, fetchMeta, metaCap = 8, deadlineMs = Infinity, nowMs = Date.now() }) {
  const rows = await getRows(repairQuery(userId, { nowMs }));
  const want = Date.now() < deadlineMs - 7000 ? wantsMeta(rows, { rssById, nowMs }).slice(0, metaCap) : [];
  const metas = new Map();
  await Promise.all(want.map(async (r) => {
    const meta = await fetchMeta(r.url).catch(() => ({}));
    if (meta?.title) metas.set(r.id, meta);
  }));
  const plan = planRepairs(rows, { rssById, metas });
  let fixed = 0;
  for (const p of plan) {
    if (Date.now() > deadlineMs) break;
    const body = { title: p.title, ...(p.subtitle !== undefined ? { subtitle: p.subtitle } : {}) };
    try { await patchRow(p.id, body); fixed++; } catch { /* next run tries again */ }
  }
  return { candidates: rows.length, pagesRead: want.length, pagesFound: metas.size, fixed, from: plan.reduce((m, p) => ({ ...m, [p.from]: (m[p.from] || 0) + 1 }), {}) };
}

module.exports = {
  isWeakTitle, isGeneric, isSlugTitle, slugTitle, splitAnchor, chooseEmailTitle,
  liveBlogOf, blogName, fixFeedTitle, planRepairs, wantsMeta, repairQuery, repairTitles, textOf
};
