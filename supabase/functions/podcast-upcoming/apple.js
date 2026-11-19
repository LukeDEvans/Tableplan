// The Apple adapter for podcast-upcoming (PODCAST_UPCOMING_DESIGN.md §3).
//
// The ONLY code in Liv that knows Apple's URLs or page format. It turns a show's
// feed URL into [{ title, expectedAt }] — episodes Apple lists that the free feed
// doesn't have yet. Deleting this file (and its entry in index.ts) removes Apple
// from Liv; the series hold then falls back to today's behaviour.
//
// Pure apart from the `fetchFn` passed in, so the tests run it on saved pages.
//
// What Apple's public show page carries (spike, 2026-11-19): a
// <script id="serialized-server-data"> JSON with `LegacyEpisodeLockup` items:
// showAdamId, title, releaseDate, episodeType (full / bonus / trailer),
// entitlementState (free / unentitled), hasFreeVersion.
//
// NOT YET SEEN (no series was in early access on 2026-11-19): how an early-access
// episode and its free date appear. Until it is, an episode counts as upcoming
// only if a date field on it (free/release/available…) is in the future; that
// date is its expected date.
//
// A full episode with no free version is NOT counted: the first run found a
// show whose subscriber-only episodes are already out and never go free (13
// false "Coming soon" rows). Such lockups are returned as `candidates` so the
// job's log shows their shape; when a real early-access episode turns up there,
// tighten this rule to match it.

const PAGE_URL = (id) => `https://podcasts.apple.com/us/podcast/id${encodeURIComponent(id)}`;
const SEARCH_URL = (term) => `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=25&term=${encodeURIComponent(term)}`;
const LOOKUP_URL = (id) => `https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}`;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

export const SOURCE = "apple";

function normFeed(url) {
  return String(url || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

// Find the Apple id whose feed is exactly this one. `title` is the search term.
export async function findAppleId(feedUrl, title, fetchFn = fetch) {
  const want = normFeed(feedUrl);
  if (!want || !title) return null;
  const res = await fetchFn(SEARCH_URL(String(title).slice(0, 120)), { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const data = await res.json();
  const hit = (data?.results || []).find((r) => normFeed(r.feedUrl) === want);
  return hit?.collectionId ? String(hit.collectionId) : null;
}

// Is this cached id still the same feed? (Shows move hosts now and then.)
export async function appleIdStillMatches(appleId, feedUrl, fetchFn = fetch) {
  const res = await fetchFn(LOOKUP_URL(appleId), { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`lookup ${res.status}`);
  const data = await res.json();
  return normFeed(data?.results?.[0]?.feedUrl) === normFeed(feedUrl);
}

export function serializedData(html) {
  const marker = 'id="serialized-server-data">';
  const s = String(html || "").indexOf(marker);
  if (s < 0) return null;
  const end = html.indexOf("</script>", s);
  if (end < 0) return null;
  try { return JSON.parse(html.slice(s + marker.length, end)); } catch { return null; }
}

function episodeLockups(data, appleId) {
  const out = [];
  const seen = new Set();
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const kind = String(o.$kind || "");
    if (/Episode/i.test(kind) && typeof o.title === "string" && String(o.showAdamId || "") === String(appleId)) {
      const key = String(o.id || o.adamId || o.title);
      if (!seen.has(key)) { seen.add(key); out.push(o); }
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(data);
  return out;
}

function plainFields(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === "summary") continue;
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) out[k] = v;
  }
  return out;
}

const DATE_KEY_RE = /(free|avail|release|publish|air|date)/i;

// From one parsed page: { upcoming: [{title, expectedAt}], candidates, lockups }.
export function upcomingFromPage(data, appleId, now = Date.now()) {
  const lockups = episodeLockups(data, appleId);
  const upcoming = [];
  const candidates = [];
  for (const o of lockups) {
    const type = String(o.episodeType || "").toLowerCase();
    if (type === "trailer") continue;
    const futureDates = Object.entries(o)
      .filter(([k, v]) => DATE_KEY_RE.test(k) && typeof v === "string")
      .map(([, v]) => Date.parse(v))
      .filter((t) => t && t > now)
      .sort((a, b) => a - b);
    const noFreeFull = type !== "bonus" && o.hasFreeVersion === false;
    if (futureDates.length) upcoming.push({ title: o.title, expectedAt: new Date(futureDates[0]).toISOString() });
    if (futureDates.length || noFreeFull) candidates.push(plainFields(o));
  }
  return { upcoming, candidates, lockups: lockups.length };
}

// The adapter's one job, for one show.
export async function fetchUpcoming(appleId, fetchFn = fetch, now = Date.now()) {
  const res = await fetchFn(PAGE_URL(appleId), { headers: { "user-agent": UA, "accept-language": "en-US" } });
  if (!res.ok) throw new Error(`page ${res.status}`);
  const data = serializedData(await res.text());
  if (!data) throw new Error("page has no episode data");
  return upcomingFromPage(data, appleId, now);
}
