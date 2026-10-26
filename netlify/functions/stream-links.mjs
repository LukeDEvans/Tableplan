// ── Stream links (STREAMING_HANDOFF_DESIGN.md §4.2) ──────────────────────────
// Exact links for a title on each streaming service — the title's page and, for
// TV, each episode — so tapping "Netflix" opens the Netflix app ON that show
// rather than on its search page. Data: Movie of the Night's Streaming
// Availability API (free plan, 1,000 requests a month).
//
// Holds no user data and touches no database. Every answer is the same for
// everyone, so the CDN keeps it a week and both people's devices share one
// upstream lookup per title per week. Like scores.mjs it's origin-restricted and
// cacheable rather than session-checked (a session check would stop the CDN
// sharing it); the worst a stranger can do is use up the month's free requests,
// and then the app quietly falls back to today's search links.
//
//   GET ?type=movie|tv&id=<tmdb id>   → { links: { <providerId>: { title, video, episodes } } | null }
//
// Env: STREAMING_AVAILABILITY_KEY (unset = off: every answer is { links: null }),
// STREAMING_AVAILABILITY_HOST (default the RapidAPI host), STREAM_LINKS_DISABLED=1
// (kill switch).

const DEFAULT_HOST = "streaming-availability.p.rapidapi.com";
const WEEK_S = 7 * 24 * 60 * 60;
const MISS_S = 6 * 60 * 60; // "nothing found" / off: re-ask sooner
const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_EPISODES = 600;   // keeps a long-running show's answer small

const ALLOWED_ORIGINS = new Set([
  "https://effervescent-malabi-e0af55.netlify.app",
  "capacitor://localhost", // the iPhone app's web view
  "http://localhost:4174",
  "http://127.0.0.1:4174",
  "http://localhost:5173",
  "http://localhost:5174"
]);

// Their service ids → ours (media-availability.js / link-out.js). Others pass through.
const SERVICE_TO_PROVIDER = { hbo: "max", apple: "appletv", prime: "prime", disney: "disney", netflix: "netflix",
  hulu: "hulu", peacock: "peacock", paramount: "paramount" };
// Subscription and free first; rent/buy only when nothing else has the service.
const TYPE_RANK = { subscription: 0, free: 1, addon: 2, rent: 3, buy: 4 };

const isHttps = (u) => typeof u === "string" && /^https:\/\//i.test(u) && u.length < 600;

function optionsByProvider(list) {
  const best = new Map();
  for (const o of Array.isArray(list) ? list : []) {
    const sid = String(o?.service?.id || "").toLowerCase();
    if (!sid || o?.addon) continue; // an add-on opens through its host app; skip it
    const pid = SERVICE_TO_PROVIDER[sid] || sid;
    const rank = TYPE_RANK[o?.type] ?? 9;
    const cur = best.get(pid);
    if (!cur || rank < cur.rank) best.set(pid, { rank, link: isHttps(o.link) ? o.link : "", video: isHttps(o.videoLink) ? o.videoLink : "" });
  }
  return best;
}

/** Their show → { providerId: { title, video, episodes: { "2": { "5": url } } } } or null. Pure. */
export function trimShow(show, country = "us") {
  if (!show || typeof show !== "object") return null;
  const out = {};
  for (const [pid, o] of optionsByProvider(show.streamingOptions?.[country])) {
    if (o.link || o.video) out[pid] = { title: o.link || o.video, video: o.video || "" };
  }
  let count = 0;
  const seasons = Array.isArray(show.seasons) ? show.seasons : [];
  seasons.forEach((season, si) => {
    const sn = String(Number.isInteger(season?.seasonNumber) ? season.seasonNumber : si + 1);
    (Array.isArray(season?.episodes) ? season.episodes : []).forEach((ep, ei) => {
      if (count >= MAX_EPISODES) return;
      const en = String(Number.isInteger(ep?.episodeNumber) ? ep.episodeNumber : ei + 1);
      for (const [pid, o] of optionsByProvider(ep?.streamingOptions?.[country])) {
        const url = o.video || o.link;
        if (!url) continue;
        const p = out[pid] || (out[pid] = { title: "", video: "" });
        ((p.episodes || (p.episodes = {}))[sn] || (p.episodes[sn] = {}))[en] = url;
        count += 1;
      }
    });
  });
  return Object.keys(out).length ? out : null;
}

export const handler = async (event, _context, deps = {}) => {
  const env = deps.env || process.env;
  const origin = String(event.headers?.origin || event.headers?.Origin || "");
  const allowed = !origin ? "*" : ALLOWED_ORIGINS.has(origin) ? origin : "";
  const headers = { ...(allowed ? { "access-control-allow-origin": allowed } : {}), "access-control-allow-methods": "GET, OPTIONS", vary: "Origin" };
  const respond = (statusCode, body, seconds = 0) => ({
    statusCode,
    headers: {
      "content-type": "application/json", ...headers,
      ...(seconds ? { "cache-control": "public, max-age=3600", "netlify-cdn-cache-control": `public, durable, max-age=${seconds}` } : { "cache-control": "no-store" }),
    },
    body: JSON.stringify(body),
  });
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "GET") return respond(405, { error: "Method not allowed." });
  if (origin && !allowed) return respond(403, { error: "Not allowed." });

  const q = event.queryStringParameters || {};
  const type = String(q.type || "");
  const id = String(q.id || "");
  if (!["movie", "tv"].includes(type) || !/^\d{1,9}$/.test(id)) return respond(400, { error: "Missing or invalid type/id." });

  const key = String(env.STREAMING_AVAILABILITY_KEY || "").trim();
  if (!key || env.STREAM_LINKS_DISABLED === "1") return respond(200, { links: null, off: true }, MISS_S);

  const host = String(env.STREAMING_AVAILABILITY_HOST || DEFAULT_HOST).trim();
  const url = `https://${host}/shows/${type}/${id}?country=us&series_granularity=episode&output_language=en`;
  const started = Date.now();
  const doFetch = deps.fetch || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await doFetch(url, { headers: { accept: "application/json", "x-rapidapi-key": key, "x-rapidapi-host": host }, signal: controller.signal });
    // One log line per upstream call, so the month's count shows in Netlify logs.
    console.log(JSON.stringify({ fn: "stream-links", upstream: true, type, id, status: res.status, ms: Date.now() - started }));
    if (res.status === 404) return respond(200, { links: null }, MISS_S);
    if (!res.ok) return respond(200, { links: null, error: `upstream ${res.status}` }); // 429 / 5xx: don't cache
    const links = trimShow(await res.json());
    return respond(200, { links }, links ? WEEK_S : MISS_S);
  } catch (e) {
    console.log(JSON.stringify({ fn: "stream-links", upstream: true, type, id, error: String(e?.message || e) }));
    return respond(200, { links: null, error: "unreachable" });
  } finally {
    clearTimeout(timer);
  }
};
