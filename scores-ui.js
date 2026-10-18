// scores-ui.js — the Scores page (SPORTS_SCORES_DESIGN.md), under Recreate since 2026-10-17.
//
// A day's games across the leagues the user follows, favorites pinned first.
// Data comes only from the app's own scores function (netlify/functions/
// scores.mjs) in the app's own model (sports-model.js) — this file never sees a
// provider's JSON, so swapping the data source doesn't touch it.
//
// Favorites and league choices are per user: state.sportsPrefs, in the personal
// `recreate` section (synced, stamped per field — settings-sync.js).
//
// Besides the day view it has two pages of its own: a league's table, and a
// team's whole season (soccer: every competition). Each is reached from the day
// view (a league heading, a game, a favorite) and goes back with ‹ Back.
//
// Refreshing: a view is re-read when shown if it is stale, on Refresh, and — only
// for today, only while this view is on screen — on a timer while a game is live
// (sports-model.js nextRefreshMs). The timer reads the CDN-cached function, never
// the database, and stops when the page is hidden or left.

import {
  LEAGUES, LEAGUE_BY_KEY, LEAGUE_GROUPS, cleanGames, cleanGame, cleanTeam, normalizeSportsPrefs, leaguesToRequest,
  arrangeScores, addFavorite, removeFavorite, isFavorite, setLeagueOn, moveLeague, isLeagueOn, enabledLeagueKeys,
  dateKeyOf, shiftDateKey, dateStrip, dayLabel, statusText, resultLine, fixtureLine, nextRefreshMs, isLive, normName,
  cleanStandings, standingsColumns, standingsLegend, orderStandingsGroups, arrangeTeamSchedule, teamRecordFrom, sameTeam
} from './sports-model.js';

const FRESH_MS = 15_000;            // a tap within this long reuses what's shown
const PAST_FRESH_MS = 10 * 60_000;  // other days change rarely
const SCHEDULE_TTL_MS = 15 * 60_000;
const TEAMS_TTL_MS = 6 * 3_600_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const COLLAPSED_KEY = "live-scores-collapsed-v1";
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

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z"/></svg>';
const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const ARROW_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg>';
const ARROW_DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg>';
const SLIDERS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>';
const TABLE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M4 10h16M4 14.5h16M9.5 5v14"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

// ── Module ───────────────────────────────────────────────────────────────────

export function createScoresModule(deps) {
  const { escapeHtml: esc, showToast, getState, persist, canUseLocalBackend, isNativeApp, getActiveAppArea } = deps;

  const boards = new Map();   // dateKey → { games, leagues, loadedAt, requestKey }
  const errors = new Map();   // dateKey → message
  const inflight = new Set(); // dateKey
  const teamLists = new Map(); // leagueKey → { teams, loadedAt } | { error, loadedAt } | { loading: true }
  const showAll = new Set();  // college leagues expanded to every game, for now
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
  const isShown = () => !!mountEl?.isConnected && getActiveAppArea?.() === "scores" && !document.hidden;
  const fmt = () => ({ now: new Date() });
  const darkTheme = () => {
    const mode = document.body?.dataset?.theme;
    return mode === "dark" || (mode !== "light" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  };

  let collapsed = new Set();
  try { collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY)) || []); } catch { /* private mode */ }
  const saveCollapsed = () => { try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); } catch { /* full */ } };

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

  // The next and last game of favorites that aren't playing today.
  async function loadSchedule(idle) {
    if (seeded) return;
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
      <span class="scores-team">${side.rank ? `<small class="scores-rank">${side.rank}</small>` : ""}<span class="scores-name">${esc(side.team.short)}</span>${fav ? `<span class="scores-star" title="Favorite">${STAR}</span>` : ""}${game.possession === which ? '<span class="scores-poss" title="Has the ball"></span>' : ""}</span>
      ${side.record ? `<small class="scores-rec">${esc(side.record)}</small>` : ""}
      <span class="scores-pts">${score}</span>
    </span>`;
  }

  function followBtn(team, leagueKey) {
    const on = isFavorite(prefs(), team);
    return `<button type="button" class="scores-follow${on ? " is-on" : ""}" data-scores-follow="${esc(team.key)}" data-league="${esc(leagueKey)}" aria-pressed="${on}">${STAR}<span>${on ? "Following" : "Follow"} ${esc(team.short)}</span></button>`;
  }

  // A link to a team's season page. Needs a provider id for the team.
  function teamLink(team, leagueKey, label) {
    if (!teamRef(team)) return "";
    return `<button type="button" class="scores-textlink" data-scores-team="${esc(team.key)}" data-league="${esc(leagueKey)}">${esc(label)} ›</button>`;
  }

  function gameHtml({ game, fav }, where) {
    const domId = `${where}|${game.id}`;
    const open = expandedId === domId;
    // Soccer lists the home side first; North American sports list the visitor first.
    const order = game.sport === "soccer" ? ["home", "away"] : ["away", "home"];
    const sub = game.state === "live" && game.situation ? game.situation : game.state === "final" ? "" : game.broadcasts[0] || "";
    const label = `${game.away.team.name} at ${game.home.team.name}, ${statusText(game, fmt())}`;
    let detail = "";
    if (open) {
      const facts = [LEAGUE_BY_KEY[game.league].short, game.note, game.venue, game.broadcasts.join(", ")].filter(Boolean).map(esc).join(" · ");
      detail = `<div class="scores-detail">
        ${facts ? `<div class="scores-facts">${facts}</div>` : ""}
        <div class="scores-actions">
          ${order.map((w) => followBtn(game[w].team, game.league)).join("")}
        </div>
        <div class="scores-actions scores-links">
          ${order.map((w) => teamLink(game[w].team, game.league, `${game[w].team.short} schedule`)).join("")}
          <button type="button" class="scores-textlink" data-scores-table="${esc(game.league)}">${esc(LEAGUE_BY_KEY[game.league].short)} table</button>
          ${game.link ? `<a class="scores-link" href="${esc(game.link)}" target="_blank" rel="noopener noreferrer">Game page ↗</a>` : ""}
        </div>
      </div>`;
    }
    return `<article class="scores-game is-${game.state}${open ? " is-open" : ""}">
      <button type="button" class="scores-game-main" data-scores-game="${esc(domId)}" aria-expanded="${open}" aria-label="${esc(label)}">
        <span class="scores-sides">${order.map((w) => sideHtml(game, w, fav[w])).join("")}</span>
        <span class="scores-status"><span class="scores-state">${isLive(game) ? '<i class="scores-live-dot"></i>' : ""}${esc(statusText(game, fmt()))}</span>${sub ? `<small class="scores-sub">${esc(sub)}</small>` : ""}</span>
      </button>${detail}
    </article>`;
  }

  function idleHtml(team) {
    const sched = schedule.byToken[scheduleToken(team)];
    const lines = [];
    if (sched?.next) lines.push(`<span><b>Next</b> ${esc(fixtureLine(sched.next, team, fmt()))}${sched.next.broadcasts[0] ? ` · ${esc(sched.next.broadcasts[0])}` : ""}</span>`);
    if (sched?.last) { const r = resultLine(sched.last, team); if (r) lines.push(`<span><b>Last</b> ${esc(r)}</span>`); }
    if (!lines.length) lines.push(`<span>${schedule.loading ? "Checking the schedule…" : "No game today"}</span>`);
    const inner = `${logoHtml(team)}<span class="scores-idle-name">${esc(team.short)}</span><span class="scores-idle-lines">${lines.join("")}</span>`;
    return teamRef(team) && team.league
      ? `<button type="button" class="scores-idle" data-scores-team="${esc(team.key)}" data-league="${esc(team.league)}" aria-label="${esc(team.name)} schedule">${inner}</button>`
      : `<div class="scores-idle">${inner}</div>`;
  }

  function daysHtml(today) {
    return dateStrip(selected).map((key) => {
      const l = dayLabel(key, today);
      return `<button type="button" class="scores-day${key === selected ? " is-selected" : ""}" data-scores-day="${key}" aria-pressed="${key === selected}" aria-label="${esc(l.long)}"><span class="scores-day-dow">${esc(l.dow)}</span><span class="scores-day-date">${esc(l.date)}</span></button>`;
    }).join("");
  }

  function render() {
    if (!mountEl?.isConnected) return;
    if (route.view === "table") { renderTable(); return; }
    if (route.view === "team") { renderTeam(); return; }
    rollToday();
    const today = dateKeyOf();
    const p = prefs();
    const board = seeded ? (seeded.days ? { ...seeded, games: seeded.days[selected] || [] } : seeded) : boards.get(selected);
    const loading = inflight.has(selected);
    let body = "";
    if (!board) {
      body = `<p class="news-empty">${esc(loading ? "Loading scores…" : errors.get(selected) || "Loading scores…")}</p>`;
    } else {
      const view = arrangeScores(board.games, p, { showAll });
      const sum = boardSummary(board.leagues);
      if (errors.has(selected)) body += `<div class="scores-note">Showing the last scores loaded. ${esc(errors.get(selected))}</div>`;
      if (sum.noLive) body += `<div class="scores-note">Live clocks are unavailable right now. Scores update when games finish.</div>`;

      // My Teams
      const idle = selected === today ? view.idle : [];
      if (idle.length) loadSchedule(idle);
      const dayWords = selected === today ? "today" : `on ${dayLabel(selected, today).long}`;
      let mine = view.myTeams.map((t) => gameHtml(t, "mine")).join("");
      if (!p.teams.length) {
        mine = `<div class="scores-empty-mine">Pick the teams you follow and their games are pinned here. <button type="button" class="news-banner-btn" data-scores-open="teams">Choose teams</button></div>`;
      } else if (!mine && !idle.length) {
        mine = `<p class="news-empty">None of your teams play ${esc(dayWords)}.</p>`;
      }
      body += `<section class="scores-sec scores-mine">
        <div class="scores-sec-head"><h3>My Teams</h3></div>
        ${mine ? `<div class="scores-list">${mine}</div>` : ""}
        ${idle.length ? `<div class="scores-idles">${idle.map(idleHtml).join("")}</div>` : ""}
      </section>`;

      for (const sec of view.sections) {
        const key = sec.league.key;
        const shut = collapsed.has(key);
        body += `<section class="scores-sec">
          <div class="scores-sec-row">
            <button type="button" class="scores-sec-head" data-scores-collapse="${key}" aria-expanded="${!shut}">
              <h3>${esc(sec.league.label)}</h3>
              ${sec.live ? `<span class="scores-live-pill">${sec.live} live</span>` : ""}
              <span class="scores-count">${sec.games.length + sec.hidden}</span>
              <span class="scores-chevron">${CHEVRON}</span>
            </button>
            <button type="button" class="scores-sec-link" data-scores-table="${key}" aria-label="${esc(sec.league.label)} table">Table</button>
          </div>
          ${shut ? "" : `${sec.games.length ? `<div class="scores-list">${sec.games.map((t) => gameHtml(t, key)).join("")}</div>` : `<p class="news-empty">No ranked teams or favorites playing.</p>`}
          ${sec.hidden ? `<button type="button" class="scores-more" data-scores-showall="${key}">Show all ${sec.games.length + sec.hidden} games</button>` : showAll.has(key) ? `<button type="button" class="scores-more" data-scores-showall="${key}">Show ranked teams and favorites only</button>` : ""}`}
        </section>`;
      }
      if (!view.sections.length) body += `<p class="news-empty">No games ${esc(dayWords)} in the leagues you follow.</p>`;

      const foot = [];
      if (sum.failed.length) foot.push(`Couldn't load ${esc(sum.failed.join(", "))}.`);
      if (board.loadedAt) foot.push(`Updated ${esc(new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(board.loadedAt)))}`);
      if (sum.providers.length) foot.push(`Data: ${esc(sum.providers.join(", "))}`);
      body += `<div class="scores-foot">${foot.join(" · ")}</div>`;
    }
    const focus = focusSelector();
    mountEl.innerHTML = `<div class="scores">
      ${backStack.length ? subbarHtml("") : ""}
      <div class="scores-bar">
        <button type="button" class="scores-nav" data-scores-shift="-1" aria-label="Earlier days">‹</button>
        <div class="scores-days">${daysHtml(today)}</div>
        <button type="button" class="scores-nav" data-scores-shift="1" aria-label="Later days">›</button>
        <button type="button" class="scores-nav" data-scores-table="" aria-label="League tables" title="League tables">${TABLE_ICON}</button>
        <button type="button" class="scores-nav scores-settings" data-scores-open="teams" aria-label="Teams and leagues" title="Teams and leagues">${SLIDERS}</button>
      </div>
      ${selected !== today ? `<button type="button" class="scores-today" data-scores-day="${today}">Back to today</button>` : ""}
      ${body}
    </div>`;
    // Keep the chosen day in view in the strip, and the keyboard where it was.
    const strip = mountEl.querySelector(".scores-days");
    const chosen = strip?.querySelector(".is-selected");
    if (strip && chosen) strip.scrollLeft = chosen.offsetLeft - strip.offsetLeft - (strip.clientWidth - chosen.clientWidth) / 2;
    if (focus) mountEl.querySelector(focus)?.focus({ preventScroll: true });
    // Opened from the dock ticker: bring that game into view once it has drawn.
    if (scrollToGame && board) {
      const row = mountEl.querySelector(`[data-scores-game="${CSS.escape(scrollToGame)}"]`);
      if (row) row.scrollIntoView({ block: "center" });
      scrollToGame = "";
    }
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
    if (isFavorite(p, team)) { setPrefs(removeFavorite(p, team)); showToast?.(`Stopped following ${team.short}.`); }
    else {
      const next = addFavorite(p, team, leagueKey);
      if (next.teams.length === p.teams.length) { showToast?.("That's the most teams you can follow."); return; }
      setPrefs(next);
      showToast?.(LEAGUE_BY_KEY[leagueKey]?.scope === "college" ? `Following ${team.short} in every college sport.` : `Following ${team.short}.`);
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
    const shift = t.closest("[data-scores-shift]");
    if (shift) { selectDay(shiftDateKey(selected, Number(shift.dataset.scoresShift) * 3)); return; }
    const openBtn = t.closest("[data-scores-open]");
    if (openBtn) { openDialog(openBtn.dataset.scoresOpen); return; }
    const follow = t.closest("[data-scores-follow]");
    if (follow) { toggleFollow(follow.dataset.scoresFollow, follow.dataset.league); return; }
    const sec = t.closest("[data-scores-collapse]");
    if (sec) {
      const key = sec.dataset.scoresCollapse;
      if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
      saveCollapsed();
      render();
      return;
    }
    const all = t.closest("[data-scores-showall]");
    if (all) {
      const key = all.dataset.scoresShowall;
      if (showAll.has(key)) showAll.delete(key); else showAll.add(key);
      render();
      return;
    }
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
  }

  function goBack() {
    const prev = backStack.pop() || { route: { view: "day" }, scroll: 0 };
    route = prev.route;
    render();
    scroller()?.scrollTo?.({ top: prev.scroll });
    if (route.view === "day") { loadBoard(selected); scheduleRefresh(); }
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
    expandedId = `${mine ? "mine" : game.league}|${game.id}`;
    scrollToGame = expandedId;
    render();
    loadBoard(selected);
    scheduleRefresh();
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
    if (route.view === "table" && route.league === leagueKey) render();
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

  function subbarHtml(title, extra = "") {
    return `<div class="scores-subbar">
      <button type="button" class="scores-back" data-scores-back>‹ Back</button>
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
    mountEl.innerHTML = `<div class="scores scores-page">
      ${subbarHtml("")}
      <div class="scores-teamhead"${team.color ? ` style="--tc:${esc(team.color)}"` : ""}>
        ${logoHtml(team)}
        <div class="scores-teamhead-text"><h3>${esc(team.name)}</h3><span>${esc([league.short, record].filter(Boolean).join(" · "))}</span></div>
      </div>
      <div class="scores-actions">
        <button type="button" class="scores-follow${on ? " is-on" : ""}" data-scores-follow="${esc(team.key)}" data-league="${esc(leagueKey)}" aria-pressed="${on}">${STAR}<span>${on ? "Following" : "Follow"}</span></button>
        <button type="button" class="scores-textlink" data-scores-table="${esc(leagueKey)}">${esc(league.short)} table ›</button>
      </div>
      ${body}
    </div>`;
    if (scrollToNext && games?.length) {
      scrollToNext = false;
      mountEl.querySelector(".scores-srow.is-next")?.scrollIntoView({ block: "center" });
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
        ${p.teams.length ? `<div class="scores-chips">${p.teams.map((t) => `<span class="scores-chip">${logoHtml(t)}<span>${esc(t.short)}</span><button type="button" data-scores-follow="${esc(t.key)}" data-league="${esc(t.league)}" aria-label="Stop following ${esc(t.name)}">${CLOSE}</button></span>`).join("")}</div>` : `<p class="news-empty">No teams yet. Star a team below.</p>`}
        <div class="scores-dialog-label">Add a team</div>
        <div class="scores-pick-controls">
          <select id="scoresLeagueSelect" aria-label="League">${options}</select>
          <input id="scoresTeamSearch" type="search" placeholder="Search teams" aria-label="Search teams" value="${esc(dialogQuery)}">
        </div>
        ${league?.scope === "college" ? `<p class="scores-hint">Following a college follows it in football, basketball and hockey.</p>` : league?.sport === "soccer" ? `<p class="scores-hint">Following a soccer team follows it in every competition you show.</p>` : ""}
        <div class="scores-pick-list" id="scoresTeamList">${teamListHtml()}</div>`;
    } else {
      const on = enabledLeagueKeys(p).map((k) => LEAGUE_BY_KEY[k]);
      const off = LEAGUES.filter((l) => !isLeagueOn(p, l.key));
      body = `
        <div class="scores-dialog-label">Showing, in this order</div>
        <div class="scores-league-list">${on.map((l, i) => leagueRowHtml(l, { on: true, movable: true, first: i === 0, last: i === on.length - 1 })).join("") || `<p class="news-empty">No leagues switched on.</p>`}</div>
        <div class="scores-dialog-label">College games</div>
        <div class="scores-seg" role="group" aria-label="College games shown">
          <button type="button" data-scores-college="ranked" aria-pressed="${p.collegeScope !== "all"}">Top 25 and my teams</button>
          <button type="button" data-scores-college="all" aria-pressed="${p.collegeScope === "all"}">Every game</button>
        </div>
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
    const college = t.closest("[data-scores-college]");
    if (college) { setPrefs({ ...prefs(), collegeScope: college.dataset.scoresCollege }); showAll.clear(); renderDialog(); }
  }

  function onDialogChange(e) {
    const t = e.target;
    if (t.id === "scoresLeagueSelect") { dialogLeague = t.value; dialogQuery = ""; renderDialog(); loadTeams(dialogLeague); return; }
    if (t.dataset?.scoresLeague) { setPrefs(setLeagueOn(prefs(), t.dataset.scoresLeague, t.checked)); renderDialog(); }
  }

  // ── Interface (app.js's showScoresApp mounts this on the Scores page) ──
  function mount(el) {
    if (!el) return;
    if (mountEl !== el) {
      mountEl = el;
      el.addEventListener("click", onClick);
      el.addEventListener("change", (e) => {
        if (e.target.id === "scoresTableLeague") { route = { view: "table", league: e.target.value }; render(); loadTable(route.league); }
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
  // The view shows it on its next mount (app.js showScoresApp).
  let scrollToGame = "";
  function showGame(dateKey, gameId) {
    route = { view: "day" };
    backStack.length = 0;
    selected = dateKey || dateKeyOf();
    expandedId = gameId ? `mine|${gameId}` : null;
    scrollToGame = expandedId || "";
    render();
  }

  // Local-dev only (window.__liveQA.scoresSetBoard): fill the view without a server.
  // `board.days` ({ dateKey: games }) seeds several days at once.
  let seededDate = "";
  function seed(board) {
    seededDate = board?.date || dateKeyOf();
    seeded = board ? { games: cleanGames(board.games || board.days?.[seededDate]), leagues: board.leagues || {}, loadedAt: Date.now() } : null;
    if (seeded && board.days) seeded.days = Object.fromEntries(Object.entries(board.days).map(([k, v]) => [k, cleanGames(v)]));
    if (board?.date) selected = board.date;
    if (board?.schedule) schedule = { key: "seed", loadedAt: Date.now(), byToken: board.schedule, loading: false };
    if (seeded && board.tables) seeded.tables = Object.fromEntries(Object.entries(board.tables).map(([k, v]) => [k, cleanStandings({ league: k, ...v })]));
    if (seeded && board.seasons) seeded.seasons = Object.fromEntries(Object.entries(board.seasons).map(([k, v]) => [k, cleanGames(v)]));
    render();
    return seeded ? seeded.games.length : 0;
  }

  return { mount, unmount, refresh, seed, openSettings: openDialog, getBoard, showGame };
}
