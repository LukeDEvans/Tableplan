// ── Scores proxy (SPORTS_SCORES_DESIGN.md) ───────────────────────────────────
// The one place the app asks for sports scores. It reads from a chain of data
// providers (_scores-providers.mjs — ESPN first), normalizes everything into the
// app's own model (sports-model.js) and returns plain, trimmed JSON. The browser
// never talks to a provider, so replacing one is a change to an adapter file and
// nothing else.
//
// Like weather.js it holds no user data and touches no database: favorites stay
// on the client, so every response is the same for everyone and the CDN can
// share it. It is origin-restricted and cacheable rather than session-checked.
//
//   GET ?action=scoreboard&date=YYYY-MM-DD&leagues=nfl,nba,…   a day's games
//   GET ?action=teams&league=nfl                               a league's teams
//   GET ?action=schedule&teams=nfl:espn:16,…                   last + next game
//   GET ?action=health                                         does each provider answer?
//
// Env: SCORES_PROVIDERS (order, default "espn,thesportsdb"), THESPORTSDB_KEY
// (switches the standby provider on), SCORES_USER_AGENT (optional).
import { LEAGUES, LEAGUE_BY_KEY, SCORES_MODEL_VERSION, isDateKey, scoreboardCacheSeconds } from "../../sports-model.js";
import { providerChain, leagueScoreboard, leagueTeams, teamLastNext } from "./_scores-providers.mjs";

const ALLOWED_ORIGINS = new Set([
  "https://effervescent-malabi-e0af55.netlify.app",
  "capacitor://localhost", // the iPhone app's web view
  "http://localhost:4174",
  "http://127.0.0.1:4174",
  "http://localhost:5173",
  "http://localhost:5174"
]);

const MAX_LEAGUES = 40;
const MAX_SCHEDULE_TEAMS = 12;
const UPSTREAM_TIMEOUT_MS = 6000;
const HEALTH_LEAGUES = ["nfl", "nba", "premier-league"];
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";

export const handler = async (event, _context, deps = {}) => {
  const env = deps.env || process.env;
  const nowMs = deps.now ? deps.now() : Date.now();
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin);
  const respond = (statusCode, body, cacheSeconds = 0) => ({
    statusCode,
    headers: { "content-type": "application/json", ...headers, ...cacheHeaders(cacheSeconds) },
    body: JSON.stringify(body)
  });
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "GET") return respond(405, { error: "Method not allowed." });

  const q = event.queryStringParameters || {};
  const action = String(q.action || "scoreboard");
  const ctx = { chain: providerChain(env), env, fetchJson: deps.fetchJson || makeFetchJson(env, action === "health" ? String(q.ua || "") : "") };
  const started = Date.now();
  const log = (fields) => console.log(JSON.stringify({ fn: "scores", action, ms: Date.now() - started, ...fields }));

  try {
    if (action === "scoreboard") {
      const date = String(q.date || new Date(nowMs).toISOString().slice(0, 10));
      if (!isDateKey(date)) return respond(400, { error: "date must be YYYY-MM-DD." });
      const leagues = parseLeagues(q.leagues);
      if (!leagues.length) return respond(400, { error: "No known leagues requested." });
      const results = await Promise.all(leagues.map((key) => leagueScoreboard(key, date, ctx)));
      const games = [];
      const status = {};
      results.forEach((r, i) => {
        games.push(...r.games);
        status[leagues[i]] = r.ok ? { ok: true, provider: r.provider, live: r.live, count: r.games.length } : { ok: false, error: r.error };
      });
      const failed = results.filter((r) => !r.ok).length;
      log({ date, leagues: leagues.length, failed, games: games.length, fallbacks: results.filter((r) => r.ok && r.tried.length).length });
      // Nothing answered: an error the CDN must not keep.
      if (failed === results.length) return respond(502, { error: "Scores are unavailable right now.", leagues: status });
      const cache = scoreboardCacheSeconds(games, date, nowMs);
      return respond(200, {
        v: SCORES_MODEL_VERSION,
        date,
        generatedAt: new Date(nowMs).toISOString(),
        games,
        leagues: status
      }, failed ? Math.min(cache, 30) : cache); // a partial answer is retried soon
    }

    if (action === "teams") {
      const league = LEAGUE_BY_KEY[String(q.league || "")];
      if (!league) return respond(400, { error: "Unknown league." });
      const r = await leagueTeams(league.key, ctx);
      log({ league: league.key, ok: r.ok, teams: r.teams.length });
      if (!r.ok) return respond(502, { error: "This league's team list is unavailable right now.", detail: r.error });
      return respond(200, { v: SCORES_MODEL_VERSION, league: league.key, provider: r.provider, teams: r.teams }, 24 * 3600);
    }

    if (action === "schedule") {
      const wanted = parseScheduleTeams(q.teams);
      if (!wanted.length) return respond(400, { error: "teams must be league:provider:id, comma-separated." });
      const results = await Promise.all(wanted.map((w) => teamLastNext(w.league, w.provider, w.ref, ctx, nowMs)));
      const teams = {};
      results.forEach((r, i) => { teams[wanted[i].token] = { last: r.last, next: r.next }; });
      const ok = results.filter((r) => r.ok).length;
      log({ teams: wanted.length, ok });
      if (!ok) return respond(502, { error: "Team schedules are unavailable right now." });
      return respond(200, { v: SCORES_MODEL_VERSION, generatedAt: new Date(nowMs).toISOString(), teams }, ok === results.length ? 900 : 60);
    }

    // One small request to each provider in the chain, with the reason when it
    // fails. For checking a deploy and for telling "ESPN is down" from "ESPN
    // refuses us"; never cached. `ua` (app | browser | none) tries another
    // User-Agent without a redeploy.
    if (action === "health") {
      const date = new Date(nowMs).toISOString().slice(0, 10);
      const providers = await Promise.all(ctx.chain.map(async (p) => {
        const league = HEALTH_LEAGUES.find((k) => p.supports(k));
        const t0 = Date.now();
        if (!league) return { id: p.id, ok: false, error: "No probe league." };
        try {
          const games = await p.scoreboard(league, date, ctx);
          return { id: p.id, ok: true, league, games: games.length, ms: Date.now() - t0 };
        } catch (e) {
          return { id: p.id, ok: false, league, error: String(e?.message || e).slice(0, 200), ms: Date.now() - t0 };
        }
      }));
      log({ providers: providers.map((p) => `${p.id}:${p.ok ? "ok" : p.error}`) });
      return respond(200, { v: SCORES_MODEL_VERSION, checkedAt: new Date(nowMs).toISOString(), providers });
    }

    return respond(400, { error: "Unknown action." });
  } catch (err) {
    log({ error: String(err?.message || err).slice(0, 160) });
    return respond(502, { error: "Scores request failed." });
  }
};

// "nfl,nba" → known league keys, de-duplicated; absent → the catalog defaults.
export function parseLeagues(param) {
  const raw = String(param || "").trim();
  if (!raw) return LEAGUES.filter((l) => l.on).map((l) => l.key);
  return [...new Set(raw.split(",").map((s) => s.trim()))].filter((k) => LEAGUE_BY_KEY[k]).slice(0, MAX_LEAGUES);
}

// "nfl:espn:16,eredivisie:espn:139" → [{ token, league, provider, ref }]
export function parseScheduleTeams(param) {
  const out = [];
  for (const token of [...new Set(String(param || "").split(",").map((s) => s.trim()).filter(Boolean))]) {
    const [league, provider, ref, ...rest] = token.split(":");
    if (rest.length || !LEAGUE_BY_KEY[league] || !/^[a-z0-9-]{1,24}$/.test(provider || "") || !/^[A-Za-z0-9_-]{1,40}$/.test(ref || "")) continue;
    out.push({ token, league, provider, ref });
    if (out.length >= MAX_SCHEDULE_TEAMS) break;
  }
  return out;
}

// One bounded upstream GET. No retry: a provider that fails is skipped for this
// request and the chain moves on.
function makeFetchJson(env, uaMode = "") {
  const configured = String(env.SCORES_USER_AGENT || "").trim() || "LDE Personal App (https://effervescent-malabi-e0af55.netlify.app)";
  const userAgent = uaMode === "browser" ? BROWSER_UA : uaMode === "none" ? "" : configured;
  return async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { accept: "application/json", ...(userAgent ? { "user-agent": userAgent } : {}) }, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
      return await res.json();
    } catch (e) {
      const why = e?.cause?.code || e?.cause?.message; // "fetch failed" hides the reason in `cause`
      throw new Error(e?.name === "AbortError" ? `Timed out reaching ${new URL(url).hostname}` : `${String(e?.message || e)}${why ? ` (${why})` : ""}`);
    } finally {
      clearTimeout(timer);
    }
  };
}

// The browser and Netlify's CDN may both reuse a response for `seconds`; the CDN
// may also serve it a little stale while it fetches a fresh one.
function cacheHeaders(seconds) {
  if (!seconds) return { "cache-control": "no-store" };
  return {
    "cache-control": `public, max-age=${seconds}`,
    "netlify-cdn-cache-control": `public, max-age=${seconds}, stale-while-revalidate=${Math.min(seconds, 60)}`
  };
}

// Same rule as weather.js: other websites' pages are refused; a request with no
// Origin (the iPhone app's native replay, non-browser callers) gets "*".
function corsHeaders(origin) {
  const o = String(origin || "");
  const allowed = !o ? "*" : ALLOWED_ORIGINS.has(o) ? o : "";
  return {
    ...(allowed ? { "access-control-allow-origin": allowed } : {}),
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    vary: "Origin"
  };
}
