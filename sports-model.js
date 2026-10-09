// sports-model.js — the app's own sports model (SPORTS_SCORES_DESIGN.md).
//
// This file is the seam that keeps the Scores view independent of any one data
// vendor. Everything outside a provider adapter (netlify/functions/_scores-*.mjs)
// speaks ONLY the shapes defined here:
//
//   League   — an entry in LEAGUES, addressed by our own key ("nfl", "eredivisie").
//   Team     — { key, scope, name, short, abbr, logo, logoDark, color, refs }.
//              `refs` holds each provider's id for the team ({ espn: "16" }); the
//              team's identity is scope + name, so a favorite survives a provider
//              swap (see sameTeam).
//   Game     — one fixture: league, start, state, the two sides and their scores.
//
// Pure and DOM-free. Imported by the browser (scores-ui.js) and by the scores
// function (netlify/functions/scores.mjs), so both validate the same shape.

export const SCORES_MODEL_VERSION = 1;

// ── League catalog ───────────────────────────────────────────────────────────
// `scope` is the namespace a team's identity lives in. A soccer club or national
// side is one team across every competition ("soccer"); a college is one school
// across football, basketball and hockey ("college"); the pro leagues are their
// own. `on` is the default for a user who hasn't chosen.
export const LEAGUES = Object.freeze([
  { key: "nfl", label: "NFL", short: "NFL", sport: "football", scope: "nfl", group: "pro", on: true },
  { key: "nba", label: "NBA", short: "NBA", sport: "basketball", scope: "nba", group: "pro", on: true },
  { key: "nhl", label: "NHL", short: "NHL", sport: "hockey", scope: "nhl", group: "pro", on: true },
  { key: "mls", label: "MLS", short: "MLS", sport: "soccer", scope: "soccer", group: "club", on: true },
  { key: "eredivisie", label: "Eredivisie", short: "Eredivisie", sport: "soccer", scope: "soccer", group: "club", on: true },
  { key: "ncaaf", label: "College Football", short: "NCAAF", sport: "football", scope: "college", group: "college", college: true, on: true },
  { key: "ncaam", label: "Men's College Basketball", short: "NCAAM", sport: "basketball", scope: "college", group: "college", college: true, on: true },
  { key: "ncaah", label: "Men's College Hockey", short: "NCAAH", sport: "hockey", scope: "college", group: "college", college: true, on: true },
  { key: "nations-league", label: "UEFA Nations League", short: "Nations League", sport: "soccer", scope: "soccer", group: "intl", on: true },
  { key: "world-cup", label: "FIFA World Cup", short: "World Cup", sport: "soccer", scope: "soccer", group: "intl", on: true },
  { key: "wcq-uefa", label: "World Cup Qualifying (UEFA)", short: "WCQ UEFA", sport: "soccer", scope: "soccer", group: "intl", on: true },
  { key: "wcq-concacaf", label: "World Cup Qualifying (Concacaf)", short: "WCQ Concacaf", sport: "soccer", scope: "soccer", group: "intl", on: true },
  { key: "euro", label: "UEFA European Championship", short: "Euro", sport: "soccer", scope: "soccer", group: "intl", on: true },
  { key: "concacaf-nations", label: "Concacaf Nations League", short: "Concacaf NL", sport: "soccer", scope: "soccer", group: "intl", on: true },
  { key: "gold-cup", label: "Concacaf Gold Cup", short: "Gold Cup", sport: "soccer", scope: "soccer", group: "intl", on: true },
  { key: "copa-america", label: "Copa América", short: "Copa América", sport: "soccer", scope: "soccer", group: "intl", on: true },
  { key: "friendlies", label: "International Friendlies", short: "Friendlies", sport: "soccer", scope: "soccer", group: "intl", on: true },
  // Off until switched on in Leagues.
  { key: "champions-league", label: "UEFA Champions League", short: "Champions League", sport: "soccer", scope: "soccer", group: "club", on: false },
  { key: "europa-league", label: "UEFA Europa League", short: "Europa League", sport: "soccer", scope: "soccer", group: "club", on: false },
  { key: "premier-league", label: "Premier League", short: "Premier League", sport: "soccer", scope: "soccer", group: "club", on: false },
  { key: "la-liga", label: "La Liga", short: "La Liga", sport: "soccer", scope: "soccer", group: "club", on: false },
  { key: "bundesliga", label: "Bundesliga", short: "Bundesliga", sport: "soccer", scope: "soccer", group: "club", on: false },
  { key: "serie-a", label: "Serie A", short: "Serie A", sport: "soccer", scope: "soccer", group: "club", on: false },
  { key: "ligue-1", label: "Ligue 1", short: "Ligue 1", sport: "soccer", scope: "soccer", group: "club", on: false },
  { key: "knvb-beker", label: "KNVB Beker", short: "KNVB Beker", sport: "soccer", scope: "soccer", group: "club", on: false },
  { key: "liga-mx", label: "Liga MX", short: "Liga MX", sport: "soccer", scope: "soccer", group: "club", on: false },
  { key: "nwsl", label: "NWSL", short: "NWSL", sport: "soccer", scope: "soccer-w", group: "club", on: false },
  { key: "womens-world-cup", label: "FIFA Women's World Cup", short: "Women's World Cup", sport: "soccer", scope: "soccer-w", group: "intl", on: false },
  { key: "mlb", label: "MLB", short: "MLB", sport: "baseball", scope: "mlb", group: "pro", on: false },
  { key: "wnba", label: "WNBA", short: "WNBA", sport: "basketball", scope: "wnba", group: "pro", on: false },
  { key: "ncaaw", label: "Women's College Basketball", short: "NCAAW", sport: "basketball", scope: "college-w", group: "college", college: true, on: false },
].map(Object.freeze));

export const LEAGUE_BY_KEY = Object.freeze(Object.fromEntries(LEAGUES.map((l) => [l.key, l])));
export const LEAGUE_GROUPS = Object.freeze([
  { key: "pro", label: "Pro" },
  { key: "college", label: "College" },
  { key: "club", label: "Club soccer" },
  { key: "intl", label: "International soccer" },
]);
export const GAME_STATES = Object.freeze(["pre", "live", "final", "postponed", "canceled", "delayed"]);
export const COLLEGE_SCOPES = Object.freeze(["ranked", "all"]);
export const MAX_FAVORITE_TEAMS = 60;
export const TOP_RANK = 25;

// ── Small pure utilities ─────────────────────────────────────────────────────
const str = (v, max = 120) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "");
const httpsUrl = (v) => { const s = str(v, 600); return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : ""; };
const hexColor = (v) => { const s = str(v, 9).replace(/^#/, ""); return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toLowerCase()}` : ""; };
const intOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

// "São Paulo F.C." → "sao paulo f c": the form two providers' spellings of one
// team are compared in.
export function normName(name) {
  return String(name || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

// ── Team ─────────────────────────────────────────────────────────────────────
export function cleanTeam(raw, scope) {
  const name = str(raw?.name, 80);
  const sc = str(scope || raw?.scope, 24);
  if (!name || !sc) return null;
  const refs = {};
  for (const [provider, id] of Object.entries(raw?.refs && typeof raw.refs === "object" ? raw.refs : {})) {
    const p = str(provider, 24), v = str(id, 40);
    if (/^[a-z0-9-]+$/.test(p) && v) refs[p] = v;
  }
  return {
    key: `${sc}:${normName(name).replace(/ /g, "-")}`,
    scope: sc,
    name,
    short: str(raw?.short, 40) || name,
    abbr: str(raw?.abbr, 8).toUpperCase(),
    logo: httpsUrl(raw?.logo),
    logoDark: httpsUrl(raw?.logoDark),
    color: hexColor(raw?.color),
    refs,
  };
}

// Are these the same team? Same scope, and then: where both carry an id from the
// same provider, the ids decide (two different schools can share a short name);
// otherwise the names do. The name fallback is what keeps a saved favorite
// matching after the provider changes and its old id means nothing.
export function sameTeam(a, b) {
  if (!a || !b || a.scope !== b.scope) return false;
  let shared = false;
  for (const p of Object.keys(a.refs || {})) {
    if (b.refs?.[p] === undefined) continue;
    shared = true;
    if (String(a.refs[p]) === String(b.refs[p])) return true;
  }
  if (shared) return false;
  const names = (t) => [t.name, t.short].map(normName).filter(Boolean);
  const bn = new Set(names(b));
  return names(a).some((n) => bn.has(n));
}

// ── Game ─────────────────────────────────────────────────────────────────────
function cleanSide(raw, scope) {
  const team = cleanTeam(raw?.team, scope);
  if (!team) return null;
  const rank = intOrNull(raw?.rank);
  return {
    team,
    score: intOrNull(raw?.score),
    pens: intOrNull(raw?.pens),            // shootout goals, when one decided it
    record: str(raw?.record, 16),
    rank: rank && rank >= 1 && rank <= 99 ? rank : null,
    winner: raw?.winner === true,
  };
}

// Validate and trim one game to the canonical shape; null when it can't be used.
// Adapters run their output through this, and so does the client on receipt.
export function cleanGame(raw) {
  const league = LEAGUE_BY_KEY[str(raw?.league, 32)];
  const id = str(raw?.id, 80);
  const startMs = Date.parse(raw?.start || "");
  if (!league || !id || Number.isNaN(startMs)) return null;
  const home = cleanSide(raw.home, league.scope);
  const away = cleanSide(raw.away, league.scope);
  if (!home || !away) return null;
  const state = GAME_STATES.includes(raw.state) ? raw.state : "pre";
  if (state === "pre" || state === "postponed" || state === "canceled") {
    for (const side of [home, away]) { side.score = null; side.pens = null; side.winner = false; }
  }
  return {
    id,
    league: league.key,
    sport: league.sport,
    start: new Date(startMs).toISOString(),
    state,
    detail: str(raw.detail, 40),           // "Final/OT", "3rd 5:32", "HT", "67'"
    note: str(raw.note, 80),               // "Group A1", "Game 3"
    venue: str(raw.venue, 80),
    broadcasts: (Array.isArray(raw.broadcasts) ? raw.broadcasts : []).map((b) => str(b, 24)).filter(Boolean).slice(0, 4),
    situation: str(raw.situation, 60),     // "2nd & 7 at MIN 34"
    possession: raw.possession === "home" || raw.possession === "away" ? raw.possession : "",
    neutral: raw.neutral === true,
    link: httpsUrl(raw.link),
    home,
    away,
  };
}

export function cleanGames(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const g = cleanGame(raw);
    if (g && !seen.has(g.id)) { seen.add(g.id); out.push(g); }
  }
  return out;
}

const STATE_ORDER = { live: 0, delayed: 0, pre: 1, final: 2, postponed: 3, canceled: 3 };
export const isLive = (g) => g?.state === "live" || g?.state === "delayed";

// Live first, then upcoming by start, then finished, then called-off.
export function compareGames(a, b) {
  return (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9)
    || Date.parse(a.start) - Date.parse(b.start)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// ── Per-user preferences (state.sportsPrefs) ─────────────────────────────────
// { teams, leagues, leagueOrder, collegeScope } — each top-level field is one
// setting with its own sync stamp (settings-sync.js, "fields").
//   teams        favorite teams, in the order they were added
//   leagues      { [leagueKey]: boolean } — only the leagues the user switched;
//                anything absent follows the catalog default, so a league added
//                to the catalog later shows up without a migration
//   leagueOrder  league keys in the user's order; the rest follow in catalog order
//   collegeScope "ranked" (Top 25 + favorites) or "all"
export function cleanFavorite(raw) {
  const team = cleanTeam(raw, raw?.scope);
  if (!team) return null;
  const league = LEAGUE_BY_KEY[str(raw.league, 32)];
  return { ...team, league: league && league.scope === team.scope ? league.key : "", addedAt: str(raw.addedAt, 40) };
}

export function normalizeSportsPrefs(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const teams = [];
  for (const t of Array.isArray(p.teams) ? p.teams : []) {
    const fav = cleanFavorite(t);
    if (fav && !teams.some((x) => sameTeam(x, fav)) && teams.length < MAX_FAVORITE_TEAMS) teams.push(fav);
  }
  const leagues = {};
  for (const [k, v] of Object.entries(p.leagues && typeof p.leagues === "object" ? p.leagues : {})) {
    if (LEAGUE_BY_KEY[k] && typeof v === "boolean") leagues[k] = v;
  }
  const leagueOrder = [...new Set((Array.isArray(p.leagueOrder) ? p.leagueOrder : []).filter((k) => LEAGUE_BY_KEY[k]))];
  return { teams, leagues, leagueOrder, collegeScope: COLLEGE_SCOPES.includes(p.collegeScope) ? p.collegeScope : "ranked" };
}

export const isLeagueOn = (prefs, key) => (typeof prefs?.leagues?.[key] === "boolean" ? prefs.leagues[key] : !!LEAGUE_BY_KEY[key]?.on);

// Every catalog league in the user's display order.
export function orderedLeagueKeys(prefs) {
  const order = (prefs?.leagueOrder || []).filter((k) => LEAGUE_BY_KEY[k]);
  const rest = LEAGUES.map((l) => l.key).filter((k) => !order.includes(k));
  return [...order, ...rest];
}
export const enabledLeagueKeys = (prefs) => orderedLeagueKeys(prefs).filter((k) => isLeagueOn(prefs, k));

// The leagues a scoreboard request needs: the ones switched on, plus each
// favorite's home league even when it's off (the team still shows in My Teams).
export function leaguesToRequest(prefs) {
  const keys = enabledLeagueKeys(prefs);
  for (const t of prefs?.teams || []) if (t.league && !keys.includes(t.league)) keys.push(t.league);
  return keys;
}

export const findFavorite = (prefs, team) => (prefs?.teams || []).find((t) => sameTeam(t, team)) || null;
export const isFavorite = (prefs, team) => !!findFavorite(prefs, team);

export function addFavorite(prefs, team, leagueKey, nowIso = new Date().toISOString()) {
  const base = normalizeSportsPrefs(prefs);
  const fav = cleanFavorite({ ...team, league: leagueKey, addedAt: nowIso });
  if (!fav || base.teams.some((t) => sameTeam(t, fav)) || base.teams.length >= MAX_FAVORITE_TEAMS) return base;
  return { ...base, teams: [...base.teams, fav] };
}
export function removeFavorite(prefs, team) {
  const base = normalizeSportsPrefs(prefs);
  return { ...base, teams: base.teams.filter((t) => !sameTeam(t, team)) };
}
export function setLeagueOn(prefs, key, on) {
  const base = normalizeSportsPrefs(prefs);
  if (!LEAGUE_BY_KEY[key]) return base;
  return { ...base, leagues: { ...base.leagues, [key]: !!on } };
}
// Move a league one step up (-1) or down (+1) among the leagues switched on.
export function moveLeague(prefs, key, delta) {
  const base = normalizeSportsPrefs(prefs);
  const on = enabledLeagueKeys(base);
  const at = on.indexOf(key);
  const other = on[at + (delta < 0 ? -1 : 1)];
  if (at < 0 || !other) return base;
  const order = orderedLeagueKeys(base);
  const i = order.indexOf(key), j = order.indexOf(other);
  [order[i], order[j]] = [order[j], order[i]];
  return { ...base, leagueOrder: order };
}

// ── Arranging a day's games (the Scores view) ────────────────────────────────
// { myTeams, idle, sections, liveCount }
//   myTeams   every game with a favorite in it
//   idle      favorites with no game in this set (the view shows their next game)
//   sections  one per switched-on league that has games, in the user's order;
//             college leagues show ranked teams and favorites unless the user
//             chose all (in Leagues, or `showAll` for one league for now), with
//             `hidden` counting the rest
export function arrangeScores(games, prefs, { showAll = [] } = {}) {
  const p = normalizeSportsPrefs(prefs);
  const everything = new Set(showAll); // leagues the viewer expanded for now
  const list = [...(games || [])].sort(compareGames);
  const favSides = (g) => ({ home: isFavorite(p, g.home.team), away: isFavorite(p, g.away.team) });
  const tagged = list.map((g) => ({ game: g, fav: favSides(g) }));
  const mine = tagged.filter((t) => t.fav.home || t.fav.away);
  const idle = p.teams.filter((t) => !mine.some(({ game }) => sameTeam(t, game.home.team) || sameTeam(t, game.away.team)));
  const sections = [];
  for (const key of enabledLeagueKeys(p)) {
    const league = LEAGUE_BY_KEY[key];
    const all = tagged.filter((t) => t.game.league === key);
    if (!all.length) continue;
    const rankedOnly = league.college && p.collegeScope !== "all" && !everything.has(key);
    const shown = rankedOnly
      ? all.filter(({ game, fav }) => fav.home || fav.away || isRanked(game.home) || isRanked(game.away))
      : all;
    sections.push({ league, games: shown, hidden: all.length - shown.length, live: all.filter((t) => isLive(t.game)).length });
  }
  return { myTeams: mine, idle, sections, liveCount: list.filter(isLive).length };
}
const isRanked = (side) => !!side.rank && side.rank <= TOP_RANK;

// ── Dates (calendar days as "YYYY-MM-DD", the viewer's local day) ────────────
const pad2 = (n) => String(n).padStart(2, "0");
export const isDateKey = (key) => /^\d{4}-\d{2}-\d{2}$/.test(String(key || "")) && !Number.isNaN(Date.parse(`${key}T00:00:00Z`));
export const dateKeyOf = (date = new Date()) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
export function shiftDateKey(key, days) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const dateStrip = (centerKey, before = 3, after = 3) => {
  const out = [];
  for (let i = -before; i <= after; i++) out.push(shiftDateKey(centerKey, i));
  return out;
};
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dayLabel(key, todayKey) {
  const d = new Date(`${key}T00:00:00Z`);
  const diff = Math.round((d - new Date(`${todayKey}T00:00:00Z`)) / 86_400_000);
  return {
    dow: diff === 0 ? "Today" : DOW[d.getUTCDay()],
    date: `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`,
    long: diff === 0 ? "Today" : diff === -1 ? "Yesterday" : diff === 1 ? "Tomorrow" : `${DOW[d.getUTCDay()]}, ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`,
  };
}

// A game's start for display: the time today, otherwise the day too.
export function formatStart(iso, { now = new Date(), timeZone, locale = "en-US", withDay = false } = {}) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const opt = (o) => new Intl.DateTimeFormat(locale, { ...o, ...(timeZone ? { timeZone } : {}) });
  const day = (x) => opt({ year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const time = opt({ hour: "numeric", minute: "2-digit" }).format(d);
  if (!withDay && day(d) === day(now)) return time;
  return `${opt({ weekday: "short", month: "short", day: "numeric" }).format(d)}, ${time}`;
}

// The status column of a game row.
export function statusText(game, fmt = {}) {
  if (game.state === "pre") return game.detail || formatStart(game.start, fmt); // detail: "TBD" when the time isn't set
  if (game.state === "postponed") return "Postponed";
  if (game.state === "canceled") return "Canceled";
  if (game.state === "delayed") return game.detail || "Delayed";
  if (game.state === "live") return game.detail || "Live";
  return game.detail || "Final";
}

// "W 39–22 vs GB" / "L 1–2 at PSV" / "D 1–1 vs NEC" from one team's side.
export function resultLine(game, team) {
  const mineHome = sameTeam(team, game.home.team);
  const me = mineHome ? game.home : game.away;
  const them = mineHome ? game.away : game.home;
  if (me.score === null || them.score === null) return "";
  const wl = me.score > them.score || me.winner ? "W" : me.score < them.score || them.winner ? "L" : "D";
  return `${wl} ${me.score}–${them.score} ${mineHome ? "vs" : "at"} ${them.team.abbr || them.team.short}`;
}
export function fixtureLine(game, team, fmt = {}) {
  const mineHome = sameTeam(team, game.home.team);
  const them = mineHome ? game.away : game.home;
  return `${mineHome ? "vs" : "at"} ${them.team.abbr || them.team.short} · ${formatStart(game.start, { ...fmt, withDay: true })}`;
}

// ── Refresh timing ───────────────────────────────────────────────────────────
export const LIVE_POLL_MS = 30_000;
const SOON_MS = 30 * 60_000;
// How long until the view should re-read today's scores, or null for "don't":
// every LIVE_POLL_MS while a game is on (or should have started), at the next
// kick-off when one is within half an hour, otherwise not at all.
export function nextRefreshMs(games, nowMs = Date.now()) {
  let soonest = null;
  for (const g of games || []) {
    if (isLive(g)) return LIVE_POLL_MS;
    if (g.state !== "pre") continue;
    const until = Date.parse(g.start) - nowMs;
    if (until <= 0 && until > -SOON_MS) return LIVE_POLL_MS; // started; the feed hasn't caught up
    if (until > 0 && until <= SOON_MS && (soonest === null || until < soonest)) soonest = until;
  }
  return soonest === null ? null : Math.max(LIVE_POLL_MS, soonest + 5_000);
}

// How long the CDN and browser may reuse a scoreboard response, in seconds.
export function scoreboardCacheSeconds(games, dateKey, nowMs = Date.now()) {
  const list = games || [];
  if (list.some(isLive)) return 20;
  const today = new Date(nowMs).toISOString().slice(0, 10);
  if (list.some((g) => g.state === "pre" && Date.parse(g.start) - nowMs < 3 * 3_600_000)) return 60;
  if (dateKey < shiftDateKey(today, -1)) return 6 * 3600; // settled
  return 300;
}
