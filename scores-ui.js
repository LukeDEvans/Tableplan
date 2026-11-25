// scores-ui.js — the Scores view (SPORTS_SCORES_DESIGN.md), its own News section
// (one swipe right of the Front page; Luke, 2026-11-20).
//
// A day's games, one tab at a time (Luke, 2026-11-20): a row of tabs like the Meal
// Plan's days — ★ (my teams' games on the day chosen), then each league the user
// shows. A swipe sideways on the games moves to the next tab. Under it a strip of
// days three wide (yesterday, today, tomorrow; scroll for more), the league table
// button and ★ (the My teams window: today's game or the next and last for each
// team). Teams and leagues are chosen in News's gear menu › Scores.
// Data comes only from the app's own scores function (netlify/functions/
// scores.mjs) in the app's own model (sports-model.js) — this file never sees a
// provider's JSON, so swapping the data source doesn't touch it.
//
// Favorites and league choices are per user: state.sportsPrefs, in the personal
// `recreate` section (synced, stamped per field — settings-sync.js).
//
// Besides the day view it has two pages of its own: a league's table, and a
// team's whole season (soccer: every competition; its card pinned at the top with
// a star to follow). Each is reached from the day view (a team's name, the table
// button, the My teams window). Back is News's own top-left button, which turns
// into ‹ while there's a page to go back to (canGoBack / goBack / onNavChange).
//
// Refreshing: a view is re-read when shown if it is stale, on Refresh, and — only
// for today, only while this view is on screen — on a timer while a game is live
// (sports-model.js nextRefreshMs). The timer reads the CDN-cached function, never
// the database, and stops when the page is hidden or left.

import { inWatchWindow, watchOptionsForGame, networkFor } from "./sports-watch.js";
import { linkOutAttrs } from "./link-out.js";
import {
  LEAGUES, LEAGUE_BY_KEY, LEAGUE_GROUPS, cleanGames, cleanGame, cleanTeam, normalizeSportsPrefs, leaguesToRequest,
  arrangeScores, addFavorite, removeFavorite, isFavorite, setLeagueOn, moveLeague, isLeagueOn, enabledLeagueKeys,
  dateKeyOf, shiftDateKey, dateStrip, dayLabel, statusText, resultLine, fixtureLine, nextRefreshMs, isLive, normName,
  cleanStandings, standingsColumns, standingsLegend, orderStandingsGroups, arrangeTeamSchedule, teamRecordFrom, sameTeam,
  teamLabel, teamSportOf, fillFavoriteRefs, isCollegeScope
} from './sports-model.js';

const FRESH_MS = 15_000;            // a tap within this long reuses what's shown
const PAST_FRESH_MS = 10 * 60_000;  // other days change rarely
const SCHEDULE_TTL_MS = 15 * 60_000;
const TEAMS_TTL_MS = 6 * 3_600_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const TAB_KEY = "live-scores-tab-v1"; // per device: "mine" or a league key
const FILTER_KEY = "live-scores-filter-v1"; // per device: { [leagueKey]: filter id }
const MINE = "mine";
const TABLE_TTL_MS = 10 * 60_000;
const SEASON_TTL_MS = 5 * 60_000;
const RETRY_AFTER_ERROR_MS = 30_000;
const PROVIDER_LABEL = { espn: "ESPN", thesportsdb: "TheSportsDB" };

// ── Pure helpers (exported for tests) ────────────────────────────────────────

// "nfl:espn:16" — how the schedule action addresses a favorite: its home league
// plus one provider's id for it. "" when the team has neither.
export function scheduleToken(fav) {
  const ref = teamRef(fav);
  return fav?.league && ref ? `${fav.league}:${ref}` : "";
}

// "espn:16" — how the team action addresses a team: one provider's id for it.
export function teamRef(team) {
  const [provider, ref] = Object.entries(team?.refs || {})[0] || [];
  return provider && ref ? `${provider}:${ref}` : "";
}

// One row of a team's season, from that team's side: who, where, and the result
// or the start. `outcome` is "W" | "L" | "D" | "" (not played).
export function seasonRow(game, team) {
  const home = sameTeam(team, game.home.team);
  const me = home ? game.home : game.away, them = home ? game.away : game.home;
  let outcome = "";
  if (game.state === "final" && me.score !== null && them.score !== null) {
    outcome = me.score > them.score || (me.score === them.score && me.winner) ? "W"
      : me.score < them.score || (me.score === them.score && them.winner) ? "L" : "D";
  }
  return { home, opponent: them.team, outcome, score: outcome ? `${me.score}–${them.score}${me.pens !== null && them.pens !== null ? ` (${me.pens}–${them.pens})` : ""}` : "" };
}

// What a scoreboard response's per-league status means for the footer:
// who supplied the data, which leagues failed, and whether any league is being
// served by a provider without live clocks.
export function boardSummary(leagues) {
  const providers = new Set(), failed = [];
  let noLive = false;
  for (const [key, st] of Object.entries(leagues || {})) {
    if (!st?.ok) { failed.push(LEAGUE_BY_KEY[key]?.short || key); continue; }
    if (st.provider) providers.add(PROVIDER_LABEL[st.provider] || st.provider);
    if (st.live === false && st.count > 0) noLive = true;
  }
  return { providers: [...providers], failed, noLive };
}

// Teams whose name matches a search, best match first.
export function filterTeams(teams, query) {
  const q = normName(query);
  if (!q) return teams || [];
  const score = (t) => {
    const names = [t.name, t.short, t.abbr].map(normName);
    if (names.some((n) => n === q)) return 0;
    if (names.some((n) => n.startsWith(q))) return 1;
    return names.some((n) => n.includes(q)) ? 2 : 9;
  };
  return (teams || []).map((t) => [score(t), t]).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).map(([, t]) => t);
}

// The tabs above the day: ★ (my teams), then the leagues shown, in order.
export function scoreTabs(prefs) {
  return [MINE, ...enabledLeagueKeys(prefs)];
}
// The tab one step from `current` (+1 = the next, a swipe left), or null at an end.
export function stepTab(tabs, current, dir) {
  const i = Math.max(0, tabs.indexOf(current));
  return tabs[i + dir] || null;
}
// The days in the strip: three weeks either side of today, stretched to reach a
// day picked further out (a team page's game).
export function dayRange(todayKey, selectedKey, span = 21) {
  let from = shiftDateKey(todayKey, -span), to = shiftDateKey(todayKey, span);
  if (selectedKey < from) from = selectedKey;
  if (selectedKey > to) to = selectedKey;
  const out = [];
  for (let k = from; k <= to && out.length < 400; k = shiftDateKey(k, 1)) out.push(k);
  return out;
}

// ── Filter (Luke, 2026-11-21) ──
// Per league, what the games list shows: every game (the default), a conference
// or division from the league's table, or (college) the Top 25. Ids: "all",
// "top25", "c:<conference>", "g:<division or conference>".
export function filterOptions(leagueKey, standings) {
  const league = LEAGUE_BY_KEY[leagueKey];
  const out = [{ id: "all", label: "All games" }];
  if (league?.college) out.push({ id: "top25", label: "Top 25" });
  const groups = (standings?.groups || []).filter((g) => g.name);
  const parents = [...new Set(groups.map((g) => g.parent).filter(Boolean))];
  for (const p of parents) out.push({ id: `c:${p}`, label: p, kind: "conference" });
  if (groups.length > 1) for (const g of groups) out.push({ id: `g:${g.name}`, label: g.name, kind: parents.length ? "division" : "conference" });
  return out;
}
// The games a filter keeps. A game stays when either side is in the group (or
// ranked, for Top 25). Without the table yet, a group filter keeps everything.
export function applyGameFilter(items, filterId, standings) {
  if (!filterId || filterId === "all") return items;
  if (filterId === "top25") return items.filter(({ game }) => [game.home, game.away].some((s) => s.rank && s.rank <= 25));
  const [kind, name] = [filterId.slice(0, 1), filterId.slice(2)];
  const groups = (standings?.groups || []).filter((g) => (kind === "c" ? g.parent === name : g.name === name));
  if (!groups.length) return items;
  const teams = groups.flatMap((g) => g.rows.map((r) => r.team));
  const inGroup = (t) => teams.some((x) => sameTeam(x, t));
  return items.filter(({ game }) => inGroup(game.home.team) || inGroup(game.away.team));
}

// ── Live games (Luke, 2026-11-21) — all from the scoreboard already fetched ──
// The box score: one column per period with regulation always shown, then T.
const REGULATION = { football: 4, hockey: 3, baseball: 9, soccer: 2 };
export function periodLabels(game, count) {
  const league = LEAGUE_BY_KEY[game.league];
  const sport = game.sport || league?.sport;
  const reg = sport === "basketball" ? (game.league === "ncaam" ? 2 : 4) : REGULATION[sport] || 4;
  const n = Math.max(count, sport === "soccer" ? 0 : reg);
  return Array.from({ length: n }, (_, i) => {
    if (sport === "baseball") return String(i + 1);
    if (sport === "soccer") return ["1H", "2H", "ET1", "ET2", "PK"][i] || String(i + 1);
    if (i < reg) return String(i + 1);
    if (sport === "hockey" && game.league === "nhl" && i === reg + 1) return "SO";
    return i === reg ? "OT" : `${i - reg + 1}OT`;
  });
}
export function boxScore(game) {
  const a = game?.away?.lines || [], h = game?.home?.lines || [];
  const count = Math.max(a.length, h.length);
  if (!count || game.state === "pre") return null;
  const labels = periodLabels(game, count);
  const row = (lines) => labels.map((_, i) => (lines[i] ?? null));
  return { labels, away: row(a), home: row(h) };
}
// Football: where the ball is, in yards from the away team's goal line (the
// field's left end), which way the team with it is going, and the line to gain.
export function fieldSpot(game) {
  const live = game?.live;
  if (!live?.spot || !game.possession) return null;
  const m = String(live.spot).trim().match(/^(?:([A-Za-z.&]{1,6})\s+)?(\d{1,2})$/);
  if (!m) return null;
  const yd = Number(m[2]);
  if (yd < 0 || yd > 50) return null;
  const abbr = (m[1] || "").toUpperCase();
  let x;
  if (!abbr || yd === 50) x = 50;
  else if (abbr === String(game.home.team.abbr).toUpperCase()) x = 100 - yd;
  else if (abbr === String(game.away.team.abbr).toUpperCase()) x = yd;
  else return null;
  const dir = game.possession === "away" ? 1 : -1;
  const gain = live.distance && live.distance > 0 ? x + dir * live.distance : null;
  return { x, dir, firstDown: gain !== null && gain > 0 && gain < 100 ? gain : null };
}

const FILTER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z"/></svg>';
const ARROW_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg>';
const ARROW_DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg>';
const TABLE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M4 10h16M4 14.5h16M9.5 5v14"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

// ── Module ───────────────────────────────────────────────────────────────────

// The small game card the dock's ticker opens in the Household and Business views
// (VIEWS_DESIGN.md decision 15): Scores is a Personal page, so a tap there shows
// the game in place instead of switching views. `esc` escapes text for HTML.
// "Watch on …" buttons for a game that's live or about to start
// (STREAMING_HANDOFF_DESIGN.md §4.3). `services` = the person's Streaming
// Services. "" when there's nothing to offer.
// `always`: offer them for any game not yet over (Scores' open game, so where to
// watch is a tap away — Luke, 2026-11-20), not only within the hour.
// `links`: plain text links in a row, no "Watch" label (Scores' open game —
// Luke, 2026-11-21: the buttons took too much room).
export function gameWatchHtml(game, esc, services = [], { always = false, links = false } = {}) {
  if (always ? !(game?.state === "live" || game?.state === "pre") : !inWatchWindow(game)) return "";
  const opts = watchOptionsForGame(game, { services });
  if (!opts.length) return "";
  const viaOf = (o) => (o.network && !o.label.toLowerCase().startsWith(o.network.toLowerCase()) ? o.network : "");
  if (links) {
    return `<div class="scores-watch-links" role="group" aria-label="Watch">${opts.map((o) => {
      const via = viaOf(o);
      const note = o.id === "xfinity" && via ? `Opening Xfinity Stream — ${via} is under Live TV` : "";
      return `<button type="button" class="scores-watch-link${o.mine ? " is-mine" : ""}" ${linkOutAttrs({ ...o, note }, esc)} aria-label="Watch on ${esc(o.label)}${via ? ` (${esc(via)})` : ""}">${esc(o.label)}</button>`;
    }).join('<span class="scores-watch-sep" aria-hidden="true">·</span>')}</div>`;
  }
  const btns = opts.map((o) => {
    // The channel, when it isn't the app's own name ("FOX" on Xfinity, "NBC" on Peacock).
    const via = viaOf(o);
    const note = o.id === "xfinity" && via ? `Opening Xfinity Stream — ${via} is under Live TV` : "";
    return `<button type="button" class="game-watch-btn${o.mine ? " is-mine" : ""}" ${linkOutAttrs({ ...o, note }, esc)} aria-label="Watch on ${esc(o.label)}${via ? ` (${esc(via)})` : ""}">${PLAY}<span>${esc(o.label)}</span>${via ? `<small>${esc(via)}</small>` : ""}</button>`;
  }).join("");
  return `<div class="game-watch" role="group" aria-label="Watch"><span class="game-watch-label">Watch</span>${btns}</div>`;
}

export function gameCardHtml(game, esc, fmt = {}, services = []) {
  if (!game) return `<p class="game-card-empty">This game isn't on the board right now.</p>`;
  const league = LEAGUE_BY_KEY[game.league];
  const side = (s) => `
    <div class="game-card-side${s.winner ? " is-winner" : ""}">
      <span class="game-card-team">${esc(s.team.name || s.team.short || s.team.abbr || "")}${s.record ? ` <small>${esc(s.record)}</small>` : ""}</span>
      <span class="game-card-score">${s.score === null ? "" : esc(String(s.score))}${s.pens !== null && s.pens !== undefined ? ` <small>(${esc(String(s.pens))})</small>` : ""}</span>
    </div>`;
  const extra = [game.note, game.situation, game.venue, game.broadcasts?.length ? game.broadcasts.join(", ") : ""].filter(Boolean);
  return `
    <div class="game-card-head">
      <span class="game-card-league">${esc(league?.label || game.league || "")}</span>
      <span class="game-card-status${game.state === "live" ? " is-live" : ""}">${esc(statusText(game, fmt))}</span>
    </div>
    ${side(game.away)}
    ${side(game.home)}
    ${extra.length ? `<p class="game-card-extra">${extra.map((x) => esc(x)).join(" · ")}</p>` : ""}
    ${gameWatchHtml(game, esc, services)}`;
}

export function createScoresModule(deps) {
  const { escapeHtml: esc, showToast, getState, persist, canUseLocalBackend, isNativeApp, getActiveAppArea } = deps;

  const boards = new Map();   // dateKey → { games, leagues, loadedAt, requestKey }
  const errors = new Map();   // dateKey → message
  const inflight = new Set(); // dateKey
  const teamLists = new Map(); // leagueKey → { teams, loadedAt } | { error, loadedAt } | { loading: true }
  let schedule = { key: "", loadedAt: 0, byToken: {}, loading: false };
  let selected = dateKeyOf();
  let lastToday = selected;
  let expandedId = null;
  let mountEl = null;
  let timer = null;
  let failures = 0;
  let seeded = null;          // local-dev seed (window.__liveQA.scoresSetBoard)
  let dialog = null;
  let dialogTab = "teams";
  let dialogLeague = "nfl";
  let dialogQuery = "";
  let listening = false;
  // The page on show: the day view, a league's table, or a team's season.
  let route = { view: "day" };
  const backStack = [];       // earlier routes, each with the scroll it had
  const tables = new Map();   // leagueKey → { data, loadedAt, error, loading }
  const seasons = new Map();  // "league|provider:id" → { games, loadedAt, error, loading }
  let scrollToNext = false;   // a team page just opened: bring its next game into view

  const prefs = () => normalizeSportsPrefs(getState()?.sportsPrefs);
  const isShown = () => !!mountEl?.isConnected && getActiveAppArea?.() === "news" && !document.hidden;
  const fmt = () => ({ now: new Date() });
  const darkTheme = () => {
    const mode = document.body?.dataset?.theme;
    return mode === "dark" || (mode !== "light" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  };

  // The tab on show: MINE (★) or a league key. Remembered on this device; a league
  // switched off since falls back to ★.
  let tab = MINE;
  try { tab = localStorage.getItem(TAB_KEY) || MINE; } catch { /* private mode */ }
  const currentTab = () => (scoreTabs(prefs()).includes(tab) ? tab : MINE);
  function setTab(next) {
    tab = next;
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* full */ }
  }
  // Each league's filter (Luke, 2026-11-21): "all" unless the viewer chose one.
  let filters = {};
  try { filters = JSON.parse(localStorage.getItem(FILTER_KEY)) || {}; } catch { /* private mode */ }
  const filterOf = (leagueKey) => filters[leagueKey] || "all";
  function setFilter(leagueKey, id) {
    if (id === "all") delete filters[leagueKey]; else filters[leagueKey] = id;
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch { /* full */ }
  }
  const tableData = (leagueKey) => seeded?.tables?.[leagueKey] || tables.get(leagueKey)?.data || null;
  let filterDialog = null;

  // News's top-left button shows ‹ while there's a page to go back to.
  const navListeners = new Set();
  const notifyNav = () => { for (const fn of navListeners) { try { fn(); } catch { /* a listener's own problem */ } } };
  let mineDialog = null;

  function setPrefs(next) {
    const state = getState();
    if (!state) return;
    state.sportsPrefs = normalizeSportsPrefs(next);
    persist();
  }

  // ── Data ──
  function apiUrl(params) {
    const qs = new URLSearchParams(params).toString();
    if (canUseLocalBackend?.()) return `/api/scores?${qs}`;
    // Relative in the iPhone app too: app.js's native fetch shim points it at the
    // deployed site (same as weather-ui.js).
    if (window.location.protocol.startsWith("http") || isNativeApp?.()) return `/.netlify/functions/scores?${qs}`;
    return "";
  }
  async function request(params) {
    const url = apiUrl(params);
    if (!url) throw new Error("Scores need a connection.");
    const signal = typeof globalThis.AbortSignal?.timeout === "function" ? globalThis.AbortSignal.timeout(15000) : undefined;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`scores ${res.status}`);
    return res.json();
  }

  async function loadBoard(dateKey, { force = false } = {}) {
    if (seeded) { render(); return; }
    const leagues = leaguesToRequest(prefs());
    const requestKey = leagues.join(",");
    const have = boards.get(dateKey);
    const fresh = dateKey === dateKeyOf() ? FRESH_MS : PAST_FRESH_MS;
    if (inflight.has(dateKey)) return;
    if (!force && have && have.requestKey === requestKey && Date.now() - have.loadedAt < fresh) return;
    if (!leagues.length) { boards.set(dateKey, { games: [], leagues: {}, loadedAt: Date.now(), requestKey }); render(); return; }
    inflight.add(dateKey);
    if (!have) render();
    try {
      const body = await request({ action: "scoreboard", date: dateKey, leagues: requestKey });
      boards.set(dateKey, { games: cleanGames(body?.games), leagues: body?.leagues || {}, loadedAt: Date.now(), requestKey });
      fillRefsFrom(boards.get(dateKey).games.flatMap((g) => [g.home.team, g.away.team]));
      errors.delete(dateKey);
      failures = 0;
    } catch {
      // Keep what's on screen; say so only when there's nothing to show.
      errors.set(dateKey, "Couldn't load scores. Check your connection and try Refresh.");
      failures++;
    } finally {
      inflight.delete(dateKey);
    }
    if (boards.size > 12) for (const k of [...boards.keys()].slice(0, boards.size - 12)) if (k !== selected) boards.delete(k);
    render();
    scheduleRefresh();
  }

  // One timer, re-armed after each load. Only today, only while on screen.
  function scheduleRefresh() {
    clearTimeout(timer);
    timer = null;
    const today = dateKeyOf();
    if (seeded || !isShown() || selected !== today) return;
    const base = nextRefreshMs(boards.get(today)?.games);
    if (base === null) return;
    const delay = Math.min(MAX_BACKOFF_MS, base * 2 ** Math.min(failures, 4));
    timer = setTimeout(() => { timer = null; if (isShown() && selected === dateKeyOf()) loadBoard(selected, { force: true }); }, delay);
  }

  function onVisibility() {
    if (document.hidden) { clearTimeout(timer); timer = null; return; }
    if (!isShown()) return;
    rollToday();
    loadBoard(selected);
    scheduleRefresh();
  }

  // Past midnight with the view left on "today": follow the day.
  function rollToday() {
    const today = dateKeyOf();
    if (today !== lastToday) { if (selected === lastToday) selected = today; lastToday = today; }
  }

  // A favorite with no provider id yet (a college followed in every sport before
  // each sport became its own team) takes one from teams seen here, so its
  // schedule and season page work. Saved once found; never asked for again.
  function fillRefsFrom(teams) {
    const p = prefs();
    const next = fillFavoriteRefs(p, teams);
    if (next !== p) setPrefs(next);
  }
  // Idle favorites still without an id: look them up in their league's team
  // list (the CDN-cached teams action), then fill.
  const refLookups = new Set(); // leagueKey, once per session
  async function lookUpMissingRefs(idle) {
    for (const league of new Set(idle.filter((t) => !teamRef(t) && t.league).map((t) => t.league))) {
      if (refLookups.has(league)) continue;
      refLookups.add(league);
      await loadTeams(league);
      const entry = teamLists.get(league);
      if (entry?.loading) { refLookups.delete(league); continue; } // the dialog's load is under way; next render tries again
      if (entry?.teams?.length) { fillRefsFrom(entry.teams); render(); }
    }
  }

  // The next and last game of favorites that aren't playing today.
  async function loadSchedule(idle) {
    if (seeded) return;
    lookUpMissingRefs(idle);
    const tokens = idle.map(scheduleToken).filter(Boolean).slice(0, 12).sort();
    const key = tokens.join(",");
    if (!key || schedule.loading) return;
    if (schedule.key === key && Date.now() - schedule.loadedAt < SCHEDULE_TTL_MS) return;
    schedule = { ...schedule, loading: true };
    let byToken = schedule.key === key ? schedule.byToken : {};
    try {
      const body = await request({ action: "schedule", teams: key });
      byToken = {};
      for (const [token, v] of Object.entries(body?.teams || {})) byToken[token] = { last: v?.last ? cleanGame(v.last) : null, next: v?.next ? cleanGame(v.next) : null };
    } catch { /* the rows just show no next game */ }
    schedule = { key, loadedAt: Date.now(), byToken, loading: false };
    render();
  }

  async function loadTeams(leagueKey) {
    const have = teamLists.get(leagueKey);
    if (have?.loading || (have && Date.now() - have.loadedAt < (have.error ? 30_000 : TEAMS_TTL_MS))) return;
    teamLists.set(leagueKey, { loading: true });
    renderDialog();
    try {
      const body = await request({ action: "teams", league: leagueKey });
      const scope = LEAGUE_BY_KEY[leagueKey].scope;
      teamLists.set(leagueKey, { teams: (body?.teams || []).map((t) => cleanTeam(t, scope)).filter(Boolean), loadedAt: Date.now() });
    } catch {
      teamLists.set(leagueKey, { error: true, loadedAt: Date.now() });
    }
    renderDialog();
  }

  // ── Rendering ──
  function logoHtml(team) {
    const src = (darkTheme() && team.logoDark) || team.logo;
    const initials = esc((team.abbr || team.short || team.name).slice(0, 3));
    const img = src ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('is-missing');this.remove()">` : "";
    return `<span class="scores-logo${src ? "" : " is-missing"}"${team.color ? ` style="--tc:${esc(team.color)}"` : ""}>${img}<i>${initials}</i></span>`;
  }

  function sideHtml(game, which, fav) {
    const side = game[which], other = game[which === "home" ? "away" : "home"];
    const decided = game.state === "final" && (side.winner || other.winner || side.score !== other.score);
    const lost = decided && !(side.winner || (!other.winner && side.score > other.score));
    const score = side.score === null ? "" : `${side.score}${side.pens !== null ? ` <small>(${side.pens})</small>` : ""}`;
    return `<span class="scores-side${lost ? " is-loser" : ""}${decided && !lost ? " is-winner" : ""}">
      ${logoHtml(side.team)}
      <span class="scores-team">${side.rank ? `<small class="scores-rank">${side.rank}</small>` : ""}${nameHtml(side.team, game.league)}${fav ? `<span class="scores-star" title="Favorite">${STAR}</span>` : ""}${game.possession === which ? '<span class="scores-poss" title="Has the ball"></span>' : ""}</span>
      ${side.record ? `<small class="scores-rec">${esc(side.record)}</small>` : ""}
      <span class="scores-pts">${score}</span>
    </span>`;
  }

  // A team's name on a scorecard: a tap opens its schedule (Luke, 2026-11-20).
  // It sits inside the row's own button, so it's a span the click handler reads
  // first; without a provider id there's no schedule, so it's plain text.
  function nameHtml(team, leagueKey) {
    return teamRef(team)
      ? `<span class="scores-name is-link" data-scores-team="${esc(team.key)}" data-league="${esc(leagueKey)}" title="${esc(team.name)} schedule">${esc(team.short)}</span>`
      : `<span class="scores-name">${esc(team.short)}</span>`;
  }

  function gameHtml({ game, fav }, where) {
    const domId = `${where}|${game.id}`;
    const open = expandedId === domId;
    // Soccer lists the home side first; North American sports list the visitor first.
    const order = game.sport === "soccer" ? ["home", "away"] : ["away", "home"];
    const situation = game.state === "live" && game.situation ? game.situation : game.state === "final" ? "" : game.broadcasts[0] || "";
    // My Teams mixes leagues (and a school's several teams), so say which.
    const sub = where === "mine" ? [LEAGUE_BY_KEY[game.league]?.short, situation].filter(Boolean).join(" · ") : situation;
    const label = `${game.away.team.name} at ${game.home.team.name}, ${statusText(game, fmt())}`;
    let detail = "";
    if (open) {
      // Where to watch: text links to the apps that can show it, whenever one can
      // (Luke, 2026-11-20/21); the channels stay in the facts line.
      const watch = gameWatchHtml(game, esc, getState().mediaServices || [], { always: true, links: true });
      const facts = [LEAGUE_BY_KEY[game.league].short, game.note, game.venue, game.broadcasts.join(", ")].filter(Boolean).map(esc).join(" · ");
      const page = game.link ? `<a class="scores-link" href="${esc(game.link)}" target="_blank" rel="noopener noreferrer">Game page</a>` : "";
      detail = `<div class="scores-detail">
        ${liveHtml(game, order)}
        ${facts ? `<div class="scores-facts">${facts}</div>` : ""}
        ${watch || page ? `<div class="scores-detail-foot">${watch}${page}</div>` : ""}
      </div>`;
    }
    return `<article class="scores-game is-${game.state}${open ? " is-open" : ""}">
      <button type="button" class="scores-game-main" data-scores-game="${esc(domId)}" aria-expanded="${open}" aria-label="${esc(label)}">
        <span class="scores-sides">${order.map((w) => sideHtml(game, w, fav[w])).join("")}</span>
        <span class="scores-status"><span class="scores-state">${isLive(game) ? '<i class="scores-live-dot"></i>' : ""}${esc(statusText(game, fmt()))}</span>${sub ? `<small class="scores-sub">${esc(sub)}</small>` : ""}</span>
      </button>${detail}
    </article>`;
  }

  // ── Live details (box score, field, diamond, goals) ──
  const abbrOf = (side) => side.team.abbr || side.team.short;
  function liveHtml(game, order) {
    const parts = [];
    const box = boxScore(game);
    if (box) {
      const cell = (v) => `<td>${v === null ? "" : esc(String(v))}</td>`;
      parts.push(`<table class="scores-box" aria-label="Score by period">
        <thead><tr><th scope="col"><span class="visually-hidden">Team</span></th>${box.labels.map((l) => `<th scope="col">${esc(l)}</th>`).join("")}<th scope="col" class="scores-box-t">T</th></tr></thead>
        <tbody>${order.map((w) => `<tr><th scope="row">${esc(abbrOf(game[w]))}</th>${box[w].map(cell).join("")}<td class="scores-box-t">${game[w].score ?? ""}</td></tr>`).join("")}</tbody>
      </table>`);
    }
    const live = game.live;
    if (game.state === "live" && live) {
      if (game.sport === "football") parts.push(fieldHtml(game));
      if (game.sport === "baseball" && (live.outs !== null || live.balls !== null)) parts.push(diamondHtml(game));
      if (live.lastPlay) parts.push(`<p class="scores-lastplay"><b>Last play</b> ${esc(live.lastPlay)}</p>`);
    }
    if (live?.events?.length) {
      const mark = { goal: "", pen: " (pen)", og: " (OG)", red: "" };
      parts.push(`<ul class="scores-events">${live.events.map((e) => `<li class="is-${e.kind}"><span class="scores-ev-min">${esc(e.minute)}</span><span class="scores-ev-icon" aria-label="${e.kind === "red" ? "Red card" : "Goal"}"></span><span>${esc(e.who || "Goal")}${mark[e.kind]}</span><small>${esc(abbrOf(game[e.side]))}</small></li>`).join("")}</ul>`);
    }
    return parts.length ? `<div class="scores-live">${parts.join("")}</div>` : "";
  }

  // A football field: the away team's end zone on the left, the home team's on the
  // right; the ball on its spot, the line of scrimmage and the line to gain.
  function fieldHtml(game) {
    const live = game.live;
    const spot = fieldSpot(game);
    const team = game.possession ? game[game.possession] : null;
    const down = live.down ? `${["", "1st", "2nd", "3rd", "4th"][live.down]} & ${live.distance === 0 || (spot && spot.firstDown === null && live.distance) ? "Goal" : live.distance ?? ""}` : "";
    const words = [team ? `${abbrOf(team)} ball` : "", down, live.spot ? `at ${live.spot}` : ""].filter(Boolean).join(" · ") || game.situation;
    let svg = "";
    if (spot) {
      const X = (yd) => 10 + yd;
      const lines = Array.from({ length: 9 }, (_, i) => `<line x1="${X((i + 1) * 10)}" y1="2" x2="${X((i + 1) * 10)}" y2="28" class="${i === 4 ? "fld-mid" : "fld-yd"}"/>`).join("");
      const base = X(spot.x) + spot.dir * 3.4, tip = X(spot.x) + spot.dir * 7; // a small arrow just ahead of the ball
      svg = `<svg class="scores-field" viewBox="0 0 120 30" role="img" aria-label="${esc(words)}">
        <rect x="0" y="0" width="120" height="30" rx="2" class="fld-grass"/>
        <rect x="0" y="0" width="10" height="30" class="fld-ez"${game.away.team.color ? ` style="fill:${esc(game.away.team.color)}"` : ""}/>
        <rect x="110" y="0" width="10" height="30" class="fld-ez"${game.home.team.color ? ` style="fill:${esc(game.home.team.color)}"` : ""}/>
        <text x="5" y="15" class="fld-ez-t" transform="rotate(-90 5 15)">${esc(abbrOf(game.away))}</text>
        <text x="115" y="15" class="fld-ez-t" transform="rotate(90 115 15)">${esc(abbrOf(game.home))}</text>
        ${lines}
        ${spot.firstDown !== null ? `<line x1="${X(spot.firstDown)}" y1="1" x2="${X(spot.firstDown)}" y2="29" class="fld-gain"/>` : ""}
        <line x1="${X(spot.x)}" y1="1" x2="${X(spot.x)}" y2="29" class="fld-los"/>
        <path d="M${base} 12.6 L${tip} 15 L${base} 17.4 Z" class="fld-dir"/>
        <ellipse cx="${X(spot.x)}" cy="15" rx="2.6" ry="1.6" class="fld-ball"/>
      </svg>`;
    }
    return `<div class="scores-football">${svg}<p class="scores-sit">${esc(words)}${live.redZone ? ' <span class="scores-redzone">Red zone</span>' : ""}</p></div>`;
  }

  // Baseball: the bases (filled when someone's on), the count and the outs.
  function diamondHtml(game) {
    const l = game.live;
    const [first, second, third] = l.bases || [];
    const base = (x, y, on) => `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" transform="rotate(45 ${x} ${y})" class="dia-base${on ? " is-on" : ""}"/>`;
    const words = [`${l.balls ?? 0}-${l.strikes ?? 0}`, `${l.outs ?? 0} out${l.outs === 1 ? "" : "s"}`].join(" · ");
    const runners = [first && "1st", second && "2nd", third && "3rd"].filter(Boolean);
    return `<div class="scores-baseball">
      <svg class="scores-diamond" viewBox="0 0 44 34" role="img" aria-label="${esc(runners.length ? `Runners on ${runners.join(", ")}` : "Bases empty")}">${base(22, 8, second)}${base(36, 21, first)}${base(8, 21, third)}</svg>
      <div class="scores-count"><b>${esc(words)}</b>${l.batter ? `<span>At bat: ${esc(l.batter)}</span>` : ""}${l.pitcher ? `<span>Pitching: ${esc(l.pitcher)}</span>` : ""}</div>
    </div>`;
  }

  function idleHtml(team) {
    const sched = schedule.byToken[scheduleToken(team)];
    const lines = [];
    if (sched?.next) lines.push(`<span><b>Next</b> ${esc(fixtureLine(sched.next, team, fmt()))}${sched.next.broadcasts[0] ? ` · ${esc(sched.next.broadcasts[0])}` : ""}</span>`);
    if (sched?.last) { const r = resultLine(sched.last, team); if (r) lines.push(`<span><b>Last</b> ${esc(r)}</span>`); }
    if (!lines.length) lines.push(`<span>${schedule.loading ? "Checking the schedule…" : "No game today"}</span>`);
    const inner = `${logoHtml(team)}<span class="scores-idle-name">${esc(team.short)}${teamSportOf(team) ? `<small>${esc(teamSportOf(team))}</small>` : ""}</span><span class="scores-idle-lines">${lines.join("")}</span>`;
    return teamRef(team) && team.league
      ? `<button type="button" class="scores-idle" data-scores-team="${esc(team.key)}" data-league="${esc(team.league)}" aria-label="${esc(teamLabel(team, { full: true }))} schedule">${inner}</button>`
      : `<div class="scores-idle">${inner}</div>`;
  }

  // The date (Luke, 2026-11-21): ‹ the chosen day › — today by default; a tap on
  // the day opens a calendar (the device's own date picker) to jump to any day.
  function dateNavHtml(today) {
    const l = dayLabel(selected, today);
    return `<div class="scores-date">
      <button type="button" class="scores-date-step" data-scores-step="-1" aria-label="Previous day">‹</button>
      <label class="scores-date-pick${selected === today ? " is-today" : ""}" title="Pick a date">
        <span class="scores-day-dow">${esc(l.dow)}</span><span class="scores-day-date">${esc(l.date)}</span>
        <input type="date" class="scores-date-input" data-scores-date value="${selected}" aria-label="${esc(l.long)} — pick a date" data-no-clear>
      </label>
      <button type="button" class="scores-date-step" data-scores-step="1" aria-label="Next day">›</button>
    </div>`;
  }

  // The tab row (Luke, 2026-11-20): the Meal Plan's day tabs' look — ★, then the
  // leagues shown, in the user's order.
  function tabsHtml(p, cur, view) {
    return scoreTabs(p).map((key) => {
      const on = key === cur;
      const league = LEAGUE_BY_KEY[key];
      const live = key === MINE ? view?.myTeams.filter((t) => isLive(t.game)).length : view?.sections.find((x) => x.league.key === key)?.live;
      const label = key === MINE ? `<span class="scores-tab-star">${STAR}</span>` : esc(league.short);
      return `<button type="button" role="tab" class="scores-tab${on ? " is-active" : ""}${live ? " has-live" : ""}" data-scores-ltab="${key}" aria-selected="${on}" aria-label="${esc(key === MINE ? "My teams" : league.label)}${live ? `, ${live} live` : ""}" title="${esc(key === MINE ? "My teams" : league.label)}">${label}</button>`;
    }).join("");
  }

  // The games under the chosen tab, for the chosen day.
  function tabBodyHtml(cur, view, p, dayWords) {
    if (cur === MINE) {
      if (!p.teams.length) return `<div class="scores-empty-mine">Pick the teams you follow and their games show here. <button type="button" class="news-banner-btn" data-scores-open="teams">Choose teams</button></div>`;
      if (!view.myTeams.length) return `<p class="news-empty">None of your teams play ${esc(dayWords)}.</p>`;
      return `<div class="scores-list">${view.myTeams.map((t) => gameHtml(t, "mine")).join("")}</div>`;
    }
    const league = LEAGUE_BY_KEY[cur];
    const sec = view.sections.find((x) => x.league.key === cur);
    if (!sec) return `<p class="news-empty">No ${esc(league.short)} games ${esc(dayWords)}.</p>`;
    const filter = filterOf(cur);
    const opt = filterOptions(cur, tableData(cur)).find((o) => o.id === filter);
    const games = applyGameFilter(sec.games, filter, tableData(cur));
    const chip = filter !== "all" ? `<div class="scores-filter-chip">Showing ${esc(opt?.label || filter.slice(2))} <button type="button" class="scores-filter-clear" data-scores-filter-set="all" aria-label="Show all games">✕</button></div>` : "";
    return `${chip}${games.length ? `<div class="scores-list">${games.map((t) => gameHtml(t, cur)).join("")}</div>` : `<p class="news-empty">No ${esc(opt?.label || "")} games ${esc(dayWords)}.</p>`}`;
  }

  let tabsFor = "";    // the tab the tab row last brought into view
  function render() {
    if (!mountEl?.isConnected) return;
    if (route.view === "table") { renderTable(); return; }
    if (route.view === "team") { renderTeam(); return; }
    rollToday();
    const today = dateKeyOf();
    const p = prefs();
    const cur = currentTab();
    const board = seeded ? (seeded.days ? { ...seeded, games: seeded.days[selected] || [] } : seeded) : boards.get(selected);
    const loading = inflight.has(selected);
    // Every game in a league by default; the filter narrows it (Luke, 2026-11-21).
    const view = board ? arrangeScores(board.games, p, { showAll: LEAGUES.map((l) => l.key) }) : null;
    if (cur !== MINE && filterOf(cur).startsWith("c:") || cur !== MINE && filterOf(cur).startsWith("g:")) loadTable(cur);
    let body = "";
    if (!board) {
      body = `<p class="news-empty">${esc(loading ? "Loading scores…" : errors.get(selected) || "Loading scores…")}</p>`;
    } else {
      const sum = boardSummary(board.leagues);
      if (errors.has(selected)) body += `<div class="scores-note">Showing the last scores loaded. ${esc(errors.get(selected))}</div>`;
      if (sum.noLive) body += `<div class="scores-note">Live clocks are unavailable right now. Scores update when games finish.</div>`;
      const dayWords = selected === today ? "today" : `on ${dayLabel(selected, today).long}`;
      body += tabBodyHtml(cur, view, p, dayWords);
      const foot = [];
      if (sum.failed.length) foot.push(`Couldn't load ${esc(sum.failed.join(", "))}.`);
      if (board.loadedAt) foot.push(`Updated ${esc(new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(board.loadedAt)))}`);
      if (sum.providers.length) foot.push(`Data: ${esc(sum.providers.join(", "))}`);
      body += `<div class="scores-foot">${foot.join(" · ")}</div>`;
    }
    const focus = focusSelector();
    const oldTabs = mountEl.querySelector(".scores-tabs")?.scrollLeft;
    mountEl.innerHTML = `<div class="scores">
      <div class="scores-tabs" role="tablist" aria-label="Leagues">${tabsHtml(p, cur, view)}</div>
      <div class="scores-bar">
        ${dateNavHtml(today)}
        <button type="button" class="icon-btn scores-sq scores-filter-btn${cur !== MINE && filterOf(cur) !== "all" ? " is-active" : ""}" data-scores-filter ${cur === MINE ? "disabled" : ""} aria-label="Filter ${cur === MINE ? "" : esc(LEAGUE_BY_KEY[cur].short)} games" title="Filter">${FILTER_ICON}</button>
        <button type="button" class="icon-btn scores-sq" data-scores-table="${cur === MINE ? "" : esc(cur)}" aria-label="League table" title="League table">${TABLE_ICON}</button>
        <button type="button" class="icon-btn scores-sq scores-mine-btn" data-scores-mine aria-label="My teams" title="My teams">${STAR}</button>
      </div>
      ${selected !== today ? `<button type="button" class="scores-today" data-scores-day="${today}">Back to today</button>` : ""}
      <div class="scores-body" data-scores-body>${body}</div>
    </div>`;
    const tabs = mountEl.querySelector(".scores-tabs");
    const active = tabs?.querySelector(".is-active");
    if (tabs && active) {
      if (tabsFor === cur && typeof oldTabs === "number") tabs.scrollLeft = oldTabs;
      else tabs.scrollLeft = Math.max(0, active.offsetLeft - tabs.offsetLeft - (tabs.clientWidth - active.clientWidth) / 2);
      tabsFor = cur;
    }
    if (focus) mountEl.querySelector(focus)?.focus({ preventScroll: true });
    // Opened from the dock ticker: bring that game into view once it has drawn.
    if (scrollToGame && board) {
      const row = mountEl.querySelector(`[data-scores-game="${CSS.escape(scrollToGame)}"]`);
      if (row) row.scrollIntoView({ block: "center" });
      scrollToGame = "";
    }
    renderMine();
  }

  // A selector for the control that has focus, so a re-render can give it back.
  function focusSelector() {
    const el = document.activeElement;
    if (!el || !mountEl.contains(el)) return "";
    for (const [name, value] of Object.entries(el.dataset || {})) {
      if (name.startsWith("scores")) return `[data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(value)}"]`;
    }
    return "";
  }

  function selectTab(key) {
    if (!scoreTabs(prefs()).includes(key)) return;
    setTab(key);
    expandedId = null;
    render();
  }
  // A sideways swipe on the games moves one tab (Luke, 2026-11-20). Not on the
  // tab row or the day strip, which scroll sideways themselves.
  let swipe = null;
  function onTouchStart(e) {
    if (route.view !== "day" || e.touches.length !== 1 || !e.target.closest("[data-scores-body]")) { swipe = null; return; }
    swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onTouchEnd(e) {
    if (!swipe) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const next = stepTab(scoreTabs(prefs()), currentTab(), dx < 0 ? 1 : -1);
    if (next) selectTab(next);
  }

  function selectDay(key) {
    selected = key;
    expandedId = null;
    render();
    loadBoard(key);
    scheduleRefresh();
  }

  // A team by its key, from anything on hand: the days loaded, tables, team
  // pages, the dialog's team lists, favorites.
  function findTeam(teamKey, leagueKey) {
    if (route.team?.key === teamKey) return route.team;
    const gameTeams = (games) => (games || []).flatMap((g) => [g.home.team, g.away.team]);
    const pools = [
      () => gameTeams(seeded?.games), () => [...boards.values()].flatMap((b) => gameTeams(b.games)),
      () => (tables.get(leagueKey)?.data?.groups || []).flatMap((g) => g.rows.map((r) => r.team)),
      () => [...tables.values()].flatMap((t) => (t.data?.groups || []).flatMap((g) => g.rows.map((r) => r.team))),
      () => [...seasons.values()].flatMap((x) => gameTeams(x.games)),
      () => teamLists.get(leagueKey)?.teams || [], () => prefs().teams,
    ];
    for (const pool of pools) { const t = pool().find((x) => x.key === teamKey); if (t) return t; }
    return null;
  }

  function toggleFollow(teamKey, leagueKey) {
    const team = findTeam(teamKey, leagueKey);
    if (!team) return;
    const p = prefs();
    if (isFavorite(p, team)) { setPrefs(removeFavorite(p, team)); showToast?.(`Stopped following ${teamLabel(team)}.`); }
    else {
      const next = addFavorite(p, team, leagueKey);
      if (next.teams.length === p.teams.length) { showToast?.("That's the most teams you can follow."); return; }
      setPrefs(next);
      showToast?.(`Following ${teamLabel(team)}.`);
    }
    render();
    renderDialog();
    loadBoard(selected); // a favorite's home league may now need loading
  }

  function onClick(e) {
    const t = e.target;
    if (t.closest("[data-scores-back]")) { goBack(); return; }
    const tableBtn = t.closest("[data-scores-table]");
    if (tableBtn) { openTable(tableBtn.dataset.scoresTable); return; }
    const teamBtn = t.closest("[data-scores-team]");
    if (teamBtn) { const team = findTeam(teamBtn.dataset.scoresTeam, teamBtn.dataset.league); if (team) openTeam(team, teamBtn.dataset.league); return; }
    const seasonGame = t.closest("[data-scores-season-game]");
    if (seasonGame) { openGameDay(seasonGame.dataset.scoresSeasonGame); return; }
    const day = t.closest("[data-scores-day]");
    if (day) { selectDay(day.dataset.scoresDay); return; }
    const step = t.closest("[data-scores-step]");
    if (step) { selectDay(shiftDateKey(selected, Number(step.dataset.scoresStep))); return; }
    const pick = t.closest(".scores-date-pick");
    if (pick) {
      // The date box covers the day, so a tap on the phone opens the device's own
      // calendar; Chrome on a laptop needs showPicker for it.
      try { pick.querySelector("[data-scores-date]").showPicker(); } catch { /* the tap itself opens it */ }
      return;
    }
    if (t.closest("[data-scores-filter]")) { openFilter(); return; }
    const setF = t.closest("[data-scores-filter-set]");
    if (setF) { setFilter(currentTab(), setF.dataset.scoresFilterSet); expandedId = null; render(); return; }
    const ltab = t.closest("[data-scores-ltab]");
    if (ltab) { selectTab(ltab.dataset.scoresLtab); return; }
    if (t.closest("[data-scores-mine]")) { openMine(); return; }
    const openBtn = t.closest("[data-scores-open]");
    if (openBtn) { openDialog(openBtn.dataset.scoresOpen); return; }
    const follow = t.closest("[data-scores-follow]");
    if (follow) { toggleFollow(follow.dataset.scoresFollow, follow.dataset.league); return; }
    const game = t.closest("[data-scores-game]");
    if (game) { expandedId = expandedId === game.dataset.scoresGame ? null : game.dataset.scoresGame; render(); }
  }

  // ── Pages: a league's table, a team's season ──
  const scroller = () => mountEl?.closest(".news-scroll");

  function go(next) {
    backStack.push({ route, scroll: scroller()?.scrollTop || 0 });
    if (backStack.length > 12) backStack.shift();
    route = next;
    clearTimeout(timer); timer = null; // the day view's live refresh only runs on the day view
    render();
    scroller()?.scrollTo?.({ top: 0 });
    notifyNav();
  }

  function goBack() {
    const prev = backStack.pop() || { route: { view: "day" }, scroll: 0 };
    route = prev.route;
    render();
    scroller()?.scrollTo?.({ top: prev.scroll });
    if (route.view === "day") { loadBoard(selected); scheduleRefresh(); }
    notifyNav();
  }

  // The table for `leagueKey`, or (from the bar's button, "") for the first league
  // shown today, else the first league switched on.
  function openTable(leagueKey) {
    const p = prefs();
    let key = LEAGUE_BY_KEY[leagueKey] ? leagueKey : "";
    if (!key) {
      const board = seeded || boards.get(selected);
      const shown = arrangeScores(board?.games || [], p).sections.map((s) => s.league.key);
      key = shown[0] || enabledLeagueKeys(p)[0] || LEAGUES[0].key;
    }
    go({ view: "table", league: key });
    loadTable(key);
  }

  function openTeam(team, leagueKey) {
    const league = LEAGUE_BY_KEY[leagueKey] ? leagueKey : team.league;
    if (!LEAGUE_BY_KEY[league] || !teamRef(team)) return;
    scrollToNext = true;
    go({ view: "team", league, team });
    loadSeason(league, team);
  }

  // A game on a team page → its day in the scores, with the game open. Back
  // returns to the team page.
  function openGameDay(gameId) {
    const s = seasons.get(seasonKey(route.league, route.team)) || { games: seeded?.seasons?.[seasonKey(route.league, route.team)] };
    const game = (s?.games || []).find((g) => g.id === gameId);
    if (!game) return;
    backStack.push({ route, scroll: scroller()?.scrollTop || 0 });
    route = { view: "day" };
    selected = dateKeyOf(new Date(game.start));
    const mine = isFavorite(prefs(), game.home.team) || isFavorite(prefs(), game.away.team);
    const where = mine || !scoreTabs(prefs()).includes(game.league) ? MINE : game.league;
    setTab(where);
    expandedId = `${where}|${game.id}`;
    scrollToGame = expandedId;
    render();
    loadBoard(selected);
    scheduleRefresh();
    notifyNav();
  }

  async function loadTable(leagueKey, { force = false } = {}) {
    if (seeded) return;
    const have = tables.get(leagueKey);
    if (have?.loading) return;
    if (!force && have && Date.now() - have.loadedAt < (have.error ? RETRY_AFTER_ERROR_MS : TABLE_TTL_MS)) return;
    tables.set(leagueKey, { ...(have || {}), loading: true });
    try {
      const data = cleanStandings(await request({ action: "standings", league: leagueKey }));
      if (!data) throw new Error("bad table");
      tables.set(leagueKey, { data, loadedAt: Date.now() });
    } catch {
      tables.set(leagueKey, { data: have?.data || null, error: true, loadedAt: Date.now() });
    }
    if ((route.view === "table" && route.league === leagueKey) || route.view === "day") render();
    renderFilter();
  }

  const timeOf = (iso) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const seasonKey = (leagueKey, team) => `${leagueKey}|${teamRef(team)}`;
  async function loadSeason(leagueKey, team, { force = false } = {}) {
    if (seeded) return;
    const key = seasonKey(leagueKey, team);
    const have = seasons.get(key);
    if (have?.loading) return;
    const live = (have?.games || []).some(isLive);
    if (!force && have && Date.now() - have.loadedAt < (have.error ? RETRY_AFTER_ERROR_MS : live ? FRESH_MS * 2 : SEASON_TTL_MS)) return;
    seasons.set(key, { ...(have || {}), loading: true });
    try {
      const body = await request({ action: "team", league: leagueKey, team: teamRef(team) });
      seasons.set(key, { games: cleanGames(body?.games), loadedAt: Date.now() });
    } catch {
      seasons.set(key, { games: have?.games || null, error: true, loadedAt: Date.now() });
    }
    if (seasons.size > 20) seasons.delete(seasons.keys().next().value);
    if (route.view === "team" && seasonKey(route.league, route.team) === key) render();
  }

  // A page's own row under the header (the table's league picker). Back is News's
  // top-left button.
  function subbarHtml(title, extra = "") {
    return `<div class="scores-subbar">
      ${title ? `<h3 class="scores-subtitle">${title}</h3>` : ""}${extra}
    </div>`;
  }

  function leagueSelectHtml(current) {
    const p = prefs();
    const on = enabledLeagueKeys(p);
    const opt = (k) => `<option value="${k}"${k === current ? " selected" : ""}>${esc(LEAGUE_BY_KEY[k].label)}</option>`;
    const off = LEAGUES.map((l) => l.key).filter((k) => !on.includes(k));
    return `<select id="scoresTableLeague" class="scores-league-select" aria-label="League">
      <optgroup label="Your leagues">${on.map(opt).join("")}</optgroup>
      ${off.length ? `<optgroup label="More leagues">${off.map(opt).join("")}</optgroup>` : ""}
    </select>`;
  }

  function renderTable() {
    const league = LEAGUE_BY_KEY[route.league];
    const entry = seeded?.tables?.[route.league] ? { data: seeded.tables[route.league] } : tables.get(route.league);
    if (!entry) loadTable(route.league);
    const p = prefs();
    let body;
    if (!entry?.data) {
      body = `<p class="news-empty">${entry?.error ? "This table isn't available right now. Try Refresh." : "Loading the table…"}</p>`;
    } else {
      const cols = standingsColumns(league.key);
      const legend = standingsLegend(entry.data);
      const head = `<tr><th class="scores-tteam" scope="col">Team</th>${cols.map((c) => `<th scope="col"${c.wide ? ' class="is-wide"' : ""}>${esc(c.label)}</th>`).join("")}</tr>`;
      const groups = orderStandingsGroups(entry.data, p);
      body = groups.map((g) => `<section class="scores-tgroup">
        ${g.name ? `<h4 class="scores-tgroup-name">${esc(g.name)}</h4>` : ""}
        <table class="scores-table"><thead>${head}</thead><tbody>
          ${g.rows.map((r) => {
            const fav = isFavorite(p, r.team);
            return `<tr class="${fav ? "is-fav" : ""}"${r.note?.color ? ` style="--note:${esc(r.note.color)}"` : ""}>
              <td class="scores-tteam"><button type="button" class="scores-trow" data-scores-team="${esc(r.team.key)}" data-league="${esc(league.key)}"${teamRef(r.team) ? "" : " disabled"}${r.note ? ` title="${esc(r.note.text)}"` : ""}>
                <span class="scores-tpos${r.note ? " has-note" : ""}">${r.rank}</span>${logoHtml(r.team)}<span class="scores-name">${esc(r.team.short)}</span>${fav ? `<span class="scores-star">${STAR}</span>` : ""}
              </button></td>
              ${cols.map((c) => `<td${c.wide ? ' class="is-wide"' : ""}>${esc(r.stats[c.key] || "–")}</td>`).join("")}
            </tr>`;
          }).join("")}
        </tbody></table>
      </section>`).join("");
      if (legend.length) body += `<ul class="scores-legend">${legend.map((n) => `<li><i style="--note:${esc(n.color || "transparent")}"></i>${esc(n.text)}</li>`).join("")}</ul>`;
      const foot = [entry.data.season, entry.error ? "Showing the last table loaded." : "", entry.loadedAt ? `Updated ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(entry.loadedAt))}` : ""].filter(Boolean);
      body += `<div class="scores-foot">${foot.map(esc).join(" · ")}</div>`;
    }
    mountEl.innerHTML = `<div class="scores scores-page">${subbarHtml("", leagueSelectHtml(league.key))}${body}</div>`;
  }

  function renderTeam() {
    const { team, league: leagueKey } = route;
    const league = LEAGUE_BY_KEY[leagueKey];
    const key = seasonKey(leagueKey, team);
    const entry = seeded?.seasons?.[key] ? { games: seeded.seasons[key] } : seasons.get(key);
    if (!entry) loadSeason(leagueKey, team);
    const on = isFavorite(prefs(), team);
    const games = entry?.games || null;
    const record = games ? teamRecordFrom(games, team) : "";
    let body;
    if (!games) {
      body = `<p class="news-empty">${entry?.error ? "This team's schedule isn't available right now. Try Refresh." : "Loading the schedule…"}</p>`;
    } else if (!games.length) {
      body = `<p class="news-empty">No games listed for this season yet.</p>`;
    } else {
      const season = arrangeTeamSchedule(games);
      const multi = new Set(games.map((g) => g.league)).size > 1;
      body = season.months.map((m) => `<section class="scores-month"><h4 class="scores-tgroup-name">${esc(m.label)}</h4>
        <div class="scores-season">${m.games.map((g) => {
          const row = seasonRow(g, team);
          const right = row.outcome
            ? `<span class="scores-res is-${row.outcome.toLowerCase()}">${row.outcome}</span><span class="scores-res-score">${esc(row.score)}</span>`
            : `<span class="scores-res-when">${esc(g.state === "pre" ? g.detail || timeOf(g.start) : statusText(g))}</span>`;
          const sub = [multi ? LEAGUE_BY_KEY[g.league].short : "", g.state === "pre" ? g.broadcasts[0] || "" : "", g.note].filter(Boolean).join(" · ");
          return `<button type="button" class="scores-srow${g.id === season.next?.id ? " is-next" : ""}${isLive(g) ? " is-live" : ""}" data-scores-season-game="${esc(g.id)}">
            <span class="scores-sdate"><b>${esc(new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(g.start)))}</b>${esc(new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric" }).format(new Date(g.start)))}</span>
            <span class="scores-sopp"><small>${row.home ? "vs" : "@"}</small>${logoHtml(row.opponent)}<span class="scores-sopp-text"><span class="scores-name">${esc(row.opponent.short)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</span></span>
            <span class="scores-sres">${isLive(g) ? `<i class="scores-live-dot"></i><span class="scores-res-when">${esc(statusText(g))}</span>` : right}</span>
          </button>`;
        }).join("")}</div></section>`).join("");
      if (entry.error) body = `<div class="scores-note">Showing the last schedule loaded.</div>` + body;
    }
    // The team's card stays pinned at the top while the season scrolls; its star
    // follows and unfollows (Luke, 2026-11-20).
    mountEl.innerHTML = `<div class="scores scores-page">
      <div class="scores-teamhead"${team.color ? ` style="--tc:${esc(team.color)}"` : ""}>
        ${logoHtml(team)}
        <div class="scores-teamhead-text"><h3>${esc(team.name)}</h3><span>${esc([league.short, record].filter(Boolean).join(" · "))}</span></div>
        <button type="button" class="scores-teamhead-star${on ? " is-on" : ""}" data-scores-follow="${esc(team.key)}" data-league="${esc(leagueKey)}" aria-pressed="${on}" aria-label="${on ? "Stop following" : "Follow"} ${esc(teamLabel(team, { full: true }))}" title="${on ? "Following" : "Follow"}">${STAR}</button>
      </div>
      ${body}
    </div>`;
    if (scrollToNext && games?.length) {
      scrollToNext = false;
      mountEl.querySelector(".scores-srow.is-next")?.scrollIntoView({ block: "center" });
    }
  }

  // ── Filter window (Luke, 2026-11-21) ──
  // The league on show: every game, or a conference / division from its table,
  // or (college) the Top 25. The choice is remembered per league on this device.
  function openFilter() {
    const leagueKey = currentTab();
    if (leagueKey === MINE) return;
    if (!filterDialog) {
      filterDialog = document.createElement("dialog");
      filterDialog.className = "recipe-dialog auth-dialog scores-dialog scores-filter-dialog";
      filterDialog.id = "scoresFilterDialog";
      filterDialog.addEventListener("click", (e) => {
        const t = e.target;
        if (t === filterDialog || t.closest("[data-scores-filter-close]")) { filterDialog.close(); return; }
        const opt = t.closest("[data-scores-filter-opt]");
        if (opt) {
          setFilter(filterDialog.dataset.league, opt.dataset.scoresFilterOpt);
          filterDialog.close();
          expandedId = null;
          render();
        }
      });
      document.body.appendChild(filterDialog);
    }
    filterDialog.dataset.league = leagueKey;
    renderFilter(true);
    if (!filterDialog.open) filterDialog.showModal();
    loadTable(leagueKey);
  }

  function renderFilter(force = false) {
    if (!filterDialog || (!filterDialog.open && !force)) return;
    const leagueKey = filterDialog.dataset.league;
    const league = LEAGUE_BY_KEY[leagueKey];
    const entry = seeded?.tables?.[leagueKey] ? { data: seeded.tables[leagueKey] } : tables.get(leagueKey);
    const opts = filterOptions(leagueKey, entry?.data);
    const cur = filterOf(leagueKey);
    const row = (o) => `<button type="button" class="scores-filter-opt${o.kind === "division" ? " is-sub" : ""}" data-scores-filter-opt="${esc(o.id)}" aria-pressed="${o.id === cur}">${esc(o.label)}${o.id === cur ? '<span class="scores-filter-check" aria-hidden="true">✓</span>' : ""}</button>`;
    const conf = opts.filter((o) => o.kind === "conference"), div = opts.filter((o) => o.kind === "division");
    const loading = !entry?.data && (entry?.loading || !entry);
    filterDialog.innerHTML = `<div class="recipe-form scores-dialog-form">
      <div class="dialog-head"><h2>${esc(league?.short || "")} games</h2><button class="icon-btn" type="button" data-scores-filter-close aria-label="Close">${CLOSE}</button></div>
      <div class="scores-dialog-body scores-filter-list">
        ${opts.filter((o) => !o.kind).map(row).join("")}
        ${conf.length ? `<div class="scores-dialog-label">Conferences</div>${conf.map(row).join("")}` : ""}
        ${div.length ? `<div class="scores-dialog-label">Divisions</div>${div.map(row).join("")}` : ""}
        ${loading ? `<p class="news-empty">Loading conferences…</p>` : !conf.length && !div.length ? `<p class="news-empty">${esc(league?.short || "This league")} has no conferences or divisions to sort by.</p>` : ""}
      </div>
    </div>`;
  }

  // ── My teams window (Luke, 2026-11-20) ──
  // The ★ button beside the days: every followed team, with today's game (start
  // time, or the score while it's on or once it's over) or, for a team that
  // doesn't play today, its next and last game. Always today, whatever day the
  // view shows. A game opens on today's board; a team opens its schedule.
  const todayGames = () => {
    const today = dateKeyOf();
    if (seeded) return seeded.days ? seeded.days[today] || [] : seededDate === today ? seeded.games : [];
    return boards.get(today)?.games || null;
  };
  function openMine() {
    if (!mineDialog) {
      mineDialog = document.createElement("dialog");
      mineDialog.className = "recipe-dialog auth-dialog scores-dialog scores-mine-dialog";
      mineDialog.id = "scoresMineDialog";
      mineDialog.addEventListener("click", onMineClick);
      document.body.appendChild(mineDialog);
    }
    renderMine(true);
    if (!mineDialog.open) mineDialog.showModal();
    const today = dateKeyOf();
    if (!seeded && today !== selected) loadBoard(today);
  }

  function mineGameLine(game, team) {
    const home = sameTeam(team, game.home.team);
    const me = home ? game.home : game.away, them = home ? game.away : game.home;
    const vs = `${home ? "vs" : "@"} ${them.team.short}`;
    if (game.state === "final") return resultLine(game, team) || `${vs} · Final`;
    if (game.state === "live" || isLive(game)) return `${vs} · ${me.score ?? 0}–${them.score ?? 0} · ${statusText(game, fmt())}`;
    return [vs, statusText(game, fmt()), game.broadcasts[0]].filter(Boolean).join(" · ");
  }

  function renderMine(force = false) {
    if (!mineDialog || (!mineDialog.open && !force)) return;
    const p = prefs();
    const games = todayGames();
    let body;
    if (!p.teams.length) {
      body = `<p class="news-empty">You aren't following any teams yet.</p>`;
    } else {
      const view = games ? arrangeScores(games, p) : null;
      if (view?.idle.length) loadSchedule(view.idle);
      body = `<div class="scores-mine-list">${p.teams.map((team) => {
        const game = (games || []).find((g) => sameTeam(team, g.home.team) || sameTeam(team, g.away.team));
        const name = `${logoHtml(team)}<span class="scores-idle-name">${esc(team.short)}${teamSportOf(team) ? `<small>${esc(teamSportOf(team))}</small>` : ""}</span>`;
        if (game) {
          const live = isLive(game);
          return `<button type="button" class="scores-idle scores-mine-row${live ? " is-live" : ""}" data-scores-mine-game="${esc(game.id)}" aria-label="${esc(`${teamLabel(team, { full: true })}: ${mineGameLine(game, team)}`)}">${name}<span class="scores-idle-lines"><span>${live ? '<i class="scores-live-dot"></i>' : `<b>Today</b> `}${esc(mineGameLine(game, team))}</span></span></button>`;
        }
        if (!games) return `<div class="scores-idle scores-mine-row">${name}<span class="scores-idle-lines"><span>Loading today's games…</span></span></div>`;
        return idleHtml(team);
      }).join("")}</div>`;
    }
    mineDialog.innerHTML = `<div class="recipe-form scores-dialog-form">
      <div class="dialog-head"><h2>My teams</h2><button class="icon-btn" type="button" data-scores-mine-close aria-label="Close">${CLOSE}</button></div>
      <div class="scores-dialog-body">${body}</div>
      <div class="dialog-actions"><button class="secondary-btn" type="button" data-scores-mine-edit>Edit teams</button><button class="primary-btn" type="button" data-scores-mine-close>Done</button></div>
    </div>`;
  }

  function onMineClick(e) {
    const t = e.target;
    if (t === mineDialog || t.closest("[data-scores-mine-close]")) { mineDialog.close(); return; }
    if (t.closest("[data-scores-mine-edit]")) { mineDialog.close(); openDialog("teams"); return; }
    const gameBtn = t.closest("[data-scores-mine-game]");
    if (gameBtn) {
      mineDialog.close();
      if (route.view !== "day") { backStack.push({ route, scroll: scroller()?.scrollTop || 0 }); route = { view: "day" }; }
      selected = dateKeyOf();
      setTab(MINE);
      expandedId = `mine|${gameBtn.dataset.scoresMineGame}`;
      scrollToGame = expandedId;
      render();
      loadBoard(selected);
      scheduleRefresh();
      notifyNav();
      return;
    }
    const teamBtn = t.closest("[data-scores-team]");
    if (teamBtn) {
      const team = findTeam(teamBtn.dataset.scoresTeam, teamBtn.dataset.league);
      mineDialog.close();
      if (team) openTeam(team, teamBtn.dataset.league);
    }
  }

  // ── Teams & leagues dialog ──
  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "recipe-dialog auth-dialog scores-dialog";
    dialog.id = "scoresSettingsDialog";
    dialog.addEventListener("click", onDialogClick);
    dialog.addEventListener("change", onDialogChange);
    dialog.addEventListener("input", (e) => {
      if (e.target.id !== "scoresTeamSearch") return;
      dialogQuery = e.target.value;
      const list = dialog.querySelector("#scoresTeamList");
      if (list) list.innerHTML = teamListHtml();
    });
    dialog.addEventListener("close", () => { render(); loadBoard(selected); });
    document.body.appendChild(dialog);
    return dialog;
  }

  function openDialog(tab) {
    dialogTab = tab === "leagues" ? "leagues" : "teams";
    dialogQuery = "";
    ensureDialog();
    renderDialog();
    if (!dialog.open) dialog.showModal();
    if (dialogTab === "teams") loadTeams(dialogLeague);
  }

  function teamRowHtml(team, leagueKey) {
    const on = isFavorite(prefs(), team);
    return `<div class="scores-pick">${logoHtml(team)}<span class="scores-pick-name">${esc(team.name)}</span>
      <button type="button" class="scores-pick-star${on ? " is-on" : ""}" data-scores-follow="${esc(team.key)}" data-league="${esc(leagueKey)}" aria-pressed="${on}" aria-label="${on ? "Stop following" : "Follow"} ${esc(team.name)}">${STAR}</button></div>`;
  }

  function teamListHtml() {
    const entry = teamLists.get(dialogLeague);
    if (!entry || entry.loading) return `<p class="news-empty">Loading teams…</p>`;
    if (entry.error) return `<p class="news-empty">This league's team list isn't available right now. You can still follow a team from any of its games: tap the game, then Follow.</p>`;
    const list = filterTeams(entry.teams, dialogQuery);
    if (!list.length) return `<p class="news-empty">${dialogQuery ? "No team matches that." : "No teams listed for this league yet."}</p>`;
    return list.map((t) => teamRowHtml(t, dialogLeague)).join("");
  }

  function leagueRowHtml(league, { on, movable, first, last }) {
    return `<div class="scores-league-row">
      <span class="scores-league-name">${esc(league.label)}</span>
      ${movable ? `<button type="button" class="scores-move" data-scores-move="-1" data-league="${league.key}" aria-label="Move ${esc(league.label)} up"${first ? " disabled" : ""}>${ARROW_UP}</button>
      <button type="button" class="scores-move" data-scores-move="1" data-league="${league.key}" aria-label="Move ${esc(league.label)} down"${last ? " disabled" : ""}>${ARROW_DOWN}</button>` : ""}
      <input type="checkbox" class="live-toggle" data-scores-league="${league.key}" aria-label="Show ${esc(league.label)}"${on ? " checked" : ""}>
    </div>`;
  }

  function renderDialog() {
    if (!dialog) return;
    const p = prefs();
    let body;
    if (dialogTab === "teams") {
      const league = LEAGUE_BY_KEY[dialogLeague];
      const options = LEAGUE_GROUPS.map((g) => `<optgroup label="${esc(g.label)}">${LEAGUES.filter((l) => l.group === g.key).map((l) => `<option value="${l.key}"${l.key === dialogLeague ? " selected" : ""}>${esc(l.label)}</option>`).join("")}</optgroup>`).join("");
      body = `
        <div class="scores-dialog-label">Following</div>
        ${p.teams.length ? `<div class="scores-chips">${p.teams.map((t) => `<span class="scores-chip">${logoHtml(t)}<span>${esc(teamLabel(t))}</span><button type="button" data-scores-follow="${esc(t.key)}" data-league="${esc(t.league)}" aria-label="Stop following ${esc(teamLabel(t, { full: true }))}">${CLOSE}</button></span>`).join("")}</div>` : `<p class="news-empty">No teams yet. Star a team below.</p>`}
        <div class="scores-dialog-label">Add a team</div>
        <div class="scores-pick-controls">
          <select id="scoresLeagueSelect" aria-label="League">${options}</select>
          <input id="scoresTeamSearch" type="search" placeholder="Search teams" aria-label="Search teams" value="${esc(dialogQuery)}">
        </div>
        ${isCollegeScope(league?.scope) ? `<p class="scores-hint">Each college sport is its own team: follow a school in each sport you want.</p>` : league?.sport === "soccer" ? `<p class="scores-hint">Following a soccer team follows it in every competition you show.</p>` : ""}
        <div class="scores-pick-list" id="scoresTeamList">${teamListHtml()}</div>`;
    } else {
      const on = enabledLeagueKeys(p).map((k) => LEAGUE_BY_KEY[k]);
      const off = LEAGUES.filter((l) => !isLeagueOn(p, l.key));
      body = `
        <div class="scores-dialog-label">Showing, in this order</div>
        <div class="scores-league-list">${on.map((l, i) => leagueRowHtml(l, { on: true, movable: true, first: i === 0, last: i === on.length - 1 })).join("") || `<p class="news-empty">No leagues switched on.</p>`}</div>
        ${off.length ? `<div class="scores-dialog-label">More leagues</div>
        <div class="scores-league-list">${off.map((l) => leagueRowHtml(l, { on: false })).join("")}</div>` : ""}`;
    }
    const scrollTop = dialog.querySelector(".scores-dialog-body")?.scrollTop || 0;
    dialog.innerHTML = `<div class="recipe-form scores-dialog-form">
      <div class="dialog-head"><h2>Scores</h2><button class="icon-btn" type="button" data-scores-close aria-label="Close">${CLOSE}</button></div>
      <div class="scores-seg" role="tablist">
        <button type="button" role="tab" data-scores-tab="teams" aria-selected="${dialogTab === "teams"}">My teams</button>
        <button type="button" role="tab" data-scores-tab="leagues" aria-selected="${dialogTab === "leagues"}">Leagues</button>
      </div>
      <div class="scores-dialog-body">${body}</div>
      <div class="dialog-actions"><button class="primary-btn" type="button" data-scores-close>Done</button></div>
    </div>`;
    const bodyEl = dialog.querySelector(".scores-dialog-body");
    if (bodyEl) bodyEl.scrollTop = scrollTop;
  }

  function onDialogClick(e) {
    const t = e.target;
    if (t === dialog || t.closest("[data-scores-close]")) { dialog.close(); return; }
    const tab = t.closest("[data-scores-tab]");
    if (tab) { dialogTab = tab.dataset.scoresTab; renderDialog(); if (dialogTab === "teams") loadTeams(dialogLeague); return; }
    const follow = t.closest("[data-scores-follow]");
    if (follow) { toggleFollow(follow.dataset.scoresFollow, follow.dataset.league); return; }
    const move = t.closest("[data-scores-move]");
    if (move) { setPrefs(moveLeague(prefs(), move.dataset.league, Number(move.dataset.scoresMove))); renderDialog(); return; }

  }

  function onDialogChange(e) {
    const t = e.target;
    if (t.id === "scoresLeagueSelect") { dialogLeague = t.value; dialogQuery = ""; renderDialog(); loadTeams(dialogLeague); return; }
    if (t.dataset?.scoresLeague) { setPrefs(setLeagueOn(prefs(), t.dataset.scoresLeague, t.checked)); renderDialog(); }
  }

  // ── Interface (news-ui.js mounts this as its Scores section) ──
  function mount(el) {
    if (!el) return;
    if (mountEl !== el) {
      mountEl = el;
      el.addEventListener("click", onClick);
      el.addEventListener("touchstart", onTouchStart, { passive: true });
      el.addEventListener("touchend", onTouchEnd, { passive: true });
      el.addEventListener("touchcancel", () => { swipe = null; }, { passive: true });
      el.addEventListener("change", (e) => {
        if (e.target.id === "scoresTableLeague") { route = { view: "table", league: e.target.value }; render(); loadTable(route.league); }
        if (e.target.matches?.("[data-scores-date]") && /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) selectDay(e.target.value);
      });
    }
    if (!listening) { listening = true; document.addEventListener("visibilitychange", onVisibility); }
    render();
    if (route.view === "table") loadTable(route.league);
    else if (route.view === "team") loadSeason(route.league, route.team);
    else { loadBoard(selected); scheduleRefresh(); }
  }

  function unmount() {
    mountEl = null;
    clearTimeout(timer);
    timer = null;
  }

  function refresh() {
    if (route.view === "table") return loadTable(route.league, { force: true });
    if (route.view === "team") return loadSeason(route.league, route.team, { force: true });
    failures = 0;
    schedule = { ...schedule, loadedAt: 0 };
    return loadBoard(selected, { force: true });
  }

  // ── For the dock ticker (news-ticker.js) ──
  // A day's games for the leagues this view asks for, from the same cache — the
  // same request the Scores view makes, so the CDN answers both. Reuses a board
  // loaded within `maxAgeMs`; on a failed request, the last board (or null).
  async function getBoard(dateKey, { maxAgeMs = 60_000 } = {}) {
    if (seeded) return seeded.days ? seeded.days[dateKey] || [] : seededDate === dateKey ? seeded.games : [];
    const leagues = leaguesToRequest(prefs());
    const requestKey = leagues.join(",");
    const have = boards.get(dateKey);
    if (have && have.requestKey === requestKey && Date.now() - have.loadedAt < maxAgeMs) return have.games;
    if (!leagues.length) return [];
    try {
      const body = await request({ action: "scoreboard", date: dateKey, leagues: requestKey });
      const board = { games: cleanGames(body?.games), leagues: body?.leagues || {}, loadedAt: Date.now(), requestKey };
      boards.set(dateKey, board);
      if (dateKey === selected) render();
      return board.games;
    } catch {
      return have?.games || null;
    }
  }

  // Open a day with one game expanded (and in view) — a tap on a ticker game.
  // The view shows it on its next mount (news-ui.js showScores).
  let scrollToGame = "";
  function showGame(dateKey, gameId) {
    route = { view: "day" };
    backStack.length = 0;
    selected = dateKey || dateKeyOf();
    if (gameId) setTab(MINE); // the ticker's games are my teams'
    expandedId = gameId ? `mine|${gameId}` : null;
    scrollToGame = expandedId || "";
    render();
    notifyNav();
  }

  // Local-dev only (window.__liveQA.scoresSetBoard): fill the view without a server.
  // `board.days` ({ dateKey: games }) seeds several days at once.
  let seededDate = "";
  function seed(board) {
    seededDate = board?.date || dateKeyOf();
    seeded = board ? { games: cleanGames(board.games || board.days?.[seededDate]), leagues: board.leagues || {}, loadedAt: Date.now() } : null;
    if (seeded && board.days) seeded.days = Object.fromEntries(Object.entries(board.days).map(([k, v]) => [k, cleanGames(v)]));
    if (seeded) fillRefsFrom([seeded.games, ...Object.values(seeded.days || {})].flat().flatMap((g) => [g.home.team, g.away.team]));
    if (board?.date) selected = board.date;
    if (board?.schedule) schedule = { key: "seed", loadedAt: Date.now(), byToken: board.schedule, loading: false };
    if (seeded && board.tables) seeded.tables = Object.fromEntries(Object.entries(board.tables).map(([k, v]) => [k, cleanStandings({ league: k, ...v })]));
    if (seeded && board.seasons) seeded.seasons = Object.fromEntries(Object.entries(board.seasons).map(([k, v]) => [k, cleanGames(v)]));
    render();
    return seeded ? seeded.games.length : 0;
  }

  // Back, for News's top-left button: a table or team page (or a game opened from
  // one) can go back; the day view itself can't.
  const canGoBack = () => backStack.length > 0;
  function onNavChange(fn) { navListeners.add(fn); return () => navListeners.delete(fn); }

  return { mount, unmount, refresh, seed, openSettings: openDialog, openMine, getBoard, showGame, canGoBack, goBack, onNavChange };
}
