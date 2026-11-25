// Upcoming podcast episodes and the series hold (PODCAST_UPCOMING_DESIGN.md).
//
// Pure: no DOM, no network, no state. app.js feeds it the saved shows and the
// rows of the shared `podcast_upcoming` table (filled once a day on the server
// from Apple's public catalog) and gets back what to show and what to hold.
//
// Nothing here knows Apple is involved: rows are keyed by the show's feed URL
// and carry only { feed_url, title, expected_at, fetched_at, first_seen_at }.
//
// Decisions (Luke, 2026-11-19):
// - Upcoming episodes show only in the show's episode panel, with their date.
// - The hold applies to every show, and only while the upcoming list names a
//   part of the same series still to come. Hand-added episodes are never held.
// - If the upcoming data is stale (no fetch for more than 3 days), nothing is
//   held: a broken lookup must never hide episodes.

export const UPCOMING_STALE_MS = 3 * 24 * 60 * 60 * 1000;
// A row whose date has passed by this much is dropped (the episode should be in
// the feed by now; if it isn't, the date was wrong).
export const UPCOMING_PAST_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
// A row with no date is trusted for this long after it was first seen, so a
// subscriber-only episode that never goes free can't hold a series forever.
export const UPCOMING_UNDATED_MAX_MS = 21 * 24 * 60 * 60 * 1000;

// "… (Part 3)", "Part 3 of 6", "Pt. 3/6"
const SERIES_PART_RE = /\b(?:part|pt\.?)\s*(\d{1,3})\b(?:\s*(?:of|\/)\s*(\d{1,3}))?/i;
const BRACKETED_PART_RE = /[([]\s*(?:part|pt\.?)\s*\d{1,3}\s*(?:(?:of|\/)\s*\d{1,3})?\s*[)\]]/i;
const EDGE_PUNCT_RE = /^[\s:–—\-|,]+|[\s:–—\-|,]+$/g;

// Feeds often number their titles and Apple doesn't: the feed's
// "725. The Death of Captain Cook: At World's End (Part 1)" is Apple's
// "The Death of Captain Cook: …" (seen 2026-11-25). Drop a leading episode
// number written "725. ", "#725 ", "Ep 725:", "Episode 725 -". A bare year with
// a colon ("1066: …") is part of the title and stays.
const EPISODE_NUMBER_RE = /^\s*(?:#\s*\d{1,5}\s*[.:\-–—|]?|(?:ep(?:isode)?\.?)\s*\d{1,5}\s*[.:\-–—|]|\d{1,5}\.)\s+/i;
export function stripEpisodeNumber(title) {
  return String(title || "").replace(EPISODE_NUMBER_RE, "");
}

// Feed URLs as stored by different code paths differ in scheme, case and a
// trailing slash; compare them in one form.
export function normalizeFeedUrl(url) {
  return String(url || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

// Titles from Apple and from the feed can differ in quotes, dashes and spacing.
export function normalizeTitle(title) {
  return stripEpisodeNumber(String(title || "").normalize("NFKC"))
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// { seriesName, part, total } for a multi-part title, else null.
//
// seriesName is the part before the first colon once the part clause is gone:
// "The Charge of the Light Brigade: Outbreak of The Crimean War (Part 1)" and
// "…: The Tsar's Terrible Siege (Part 2)" are the same series. (The old hold
// used the whole remaining title, so every part with its own subtitle counted
// as a series of its own and nothing was ever grouped.)
export function parseSeriesPart(title) {
  if (!title) return null;
  const s = stripEpisodeNumber(title);
  const m = s.match(SERIES_PART_RE);
  if (!m) return null;
  const part = parseInt(m[1], 10);
  if (!part) return null;
  const total = m[2] ? parseInt(m[2], 10) : null;
  const rest = s.replace(BRACKETED_PART_RE, " ").replace(SERIES_PART_RE, " ");
  const segments = rest.split(":").map((x) => x.replace(EDGE_PUNCT_RE, "").trim()).filter(Boolean);
  const seriesName = (segments[0] || s.replace(EDGE_PUNCT_RE, "").trim()).replace(/\s+/g, " ");
  return { seriesName, part, total };
}

// A short label for an upcoming row: "Part 3 · Crushing the Russians" for a
// multi-part title (the series name is already shown on the panel), else the title.
export function upcomingLabel(title) {
  const info = parseSeriesPart(title);
  if (!info) return String(title || "");
  const rest = stripEpisodeNumber(title).replace(BRACKETED_PART_RE, " ").replace(SERIES_PART_RE, " ");
  const subtitle = rest.split(":").slice(1).join(":").replace(EDGE_PUNCT_RE, "").replace(/\s+/g, " ").trim();
  return `Part ${info.part}${subtitle ? ` · ${subtitle}` : ` · ${info.seriesName}`}`;
}

// The comparable key for a series name (case, quotes and spacing ignored).
export function seriesKey(seriesName) {
  return normalizeTitle(seriesName);
}

// The id used for a series' "Release now" override: show id + series key.
export function seriesIdFor(showId, seriesName) {
  return `${showId}::${seriesKey(seriesName)}`;
}

// feed (normalised) → rows for that feed.
export function groupUpcomingByFeed(rows) {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.feed_url || !r.title) continue;
    const k = normalizeFeedUrl(r.feed_url);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
}

// Was this show's upcoming list refreshed recently enough to act on?
export function upcomingIsFresh(rows, now = Date.now()) {
  let newest = 0;
  for (const r of rows || []) newest = Math.max(newest, Date.parse(r.fetched_at) || 0);
  return newest > 0 && now - newest <= UPCOMING_STALE_MS;
}

// The rows still worth showing for one show: fresh, not already in the feed,
// not long past their date, and (if undated) not too old.
export function activeUpcoming(rows, episodes, now = Date.now()) {
  if (!rows?.length || !upcomingIsFresh(rows, now)) return [];
  const released = new Set((episodes || []).map((e) => normalizeTitle(e.title)));
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const t = normalizeTitle(r.title);
    if (!t || released.has(t) || seen.has(t)) continue;
    const at = Date.parse(r.expected_at) || 0;
    if (at && now - at > UPCOMING_PAST_GRACE_MS) continue;
    if (!at) {
      const first = Date.parse(r.first_seen_at) || Date.parse(r.fetched_at) || 0;
      if (first && now - first > UPCOMING_UNDATED_MAX_MS) continue;
    }
    seen.add(t);
    out.push({ title: String(r.title), expectedAt: at ? new Date(at).toISOString() : null });
  }
  // Soonest first; undated last.
  return out.sort((a, b) => (Date.parse(a.expectedAt) || Infinity) - (Date.parse(b.expectedAt) || Infinity));
}

// Series of one show still waiting on a part: key → { name, coming: [titles] }.
//
// Apple lists only the NEXT part ahead of time (seen 2026-11-25: Part 2 of
// Captain Cook, a day before it went free), not the whole series. So when that
// part reaches the feed, the list has nothing left for the series until the next
// daily check shows whether Part 3 is announced. Until then the series stays
// held: a row whose episode arrived AFTER the row was fetched still counts
// (`coming` stays empty for it, so the panel shows nothing extra).
export function seriesStillComing(rows, episodes, now = Date.now()) {
  const out = new Map();
  const add = (title, u) => {
    const info = parseSeriesPart(title);
    if (!info) return;
    const k = seriesKey(info.seriesName);
    if (!out.has(k)) out.set(k, { name: info.seriesName, coming: [] });
    if (u) out.get(k).coming.push(u);
  };
  for (const u of activeUpcoming(rows, episodes, now)) add(u.title, u);
  if (rows?.length && upcomingIsFresh(rows, now)) {
    const arrived = new Map((episodes || []).map((e) => [normalizeTitle(e.title), Date.parse(e.pubDate) || 0]));
    for (const r of rows) {
      const pub = arrived.get(normalizeTitle(r.title));
      if (pub && pub > (Date.parse(r.fetched_at) || 0)) add(r.title, null);
    }
  }
  return out;
}

// Held series for one show: [{ seriesId, name, eps: [{id, part, title}], coming }].
// `released` is the "Release now" map (seriesId → true).
export function heldSeriesForShow(show, rows, { now = Date.now(), released = {} } = {}) {
  if (!show) return [];
  const coming = seriesStillComing(rows, show.episodes, now);
  if (!coming.size) return [];
  const groups = new Map();
  for (const ep of show.episodes || []) {
    const info = parseSeriesPart(ep.title);
    if (!info) continue;
    const k = seriesKey(info.seriesName);
    const c = coming.get(k);
    if (!c) continue;
    const seriesId = seriesIdFor(show.id, info.seriesName);
    if (released[seriesId]) continue;
    if (!groups.has(k)) groups.set(k, { seriesId, name: c.name, eps: [], coming: c.coming });
    groups.get(k).eps.push({ id: ep.id, part: info.part, title: ep.title });
  }
  return [...groups.values()].map((g) => ({ ...g, eps: g.eps.sort((a, b) => a.part - b.part) }));
}

// Every episode id to keep out of the automatic queue.
export function heldEpisodeIds(shows, rowsByFeed, { now = Date.now(), released = {} } = {}) {
  const held = new Set();
  if (!rowsByFeed || !rowsByFeed.size) return held;
  for (const show of shows || []) {
    const rows = rowsByFeed.get(normalizeFeedUrl(show?.url));
    if (!rows) continue;
    for (const g of heldSeriesForShow(show, rows, { now, released })) for (const e of g.eps) held.add(e.id);
  }
  return held;
}
