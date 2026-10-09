// scores-ui.js — the Scores view (SPORTS_SCORES_DESIGN.md), shown in News → Sports.
//
// A day's games across the leagues the user follows, favorites pinned first.
// Data comes only from the app's own scores function (netlify/functions/
// scores.mjs) in the app's own model (sports-model.js) — this file never sees a
// provider's JSON, so swapping the data source doesn't touch it.
//
// Favorites and league choices are per user: state.sportsPrefs, in the personal
// `recreate` section (synced, stamped per field — settings-sync.js).
//
// Refreshing: a view is re-read when shown if it is stale, on Refresh, and — only
// for today, only while this view is on screen — on a timer while a game is live
// (sports-model.js nextRefreshMs). The timer reads the CDN-cached function, never
// the database, and stops when the page is hidden or left.

import {
  LEAGUES, LEAGUE_BY_KEY, LEAGUE_GROUPS, cleanGames, cleanGame, cleanTeam, normalizeSportsPrefs, leaguesToRequest,
  arrangeScores, addFavorite, removeFavorite, isFavorite, setLeagueOn, moveLeague, isLeagueOn, enabledLeagueKeys,
  dateKeyOf, shiftDateKey, dateStrip, dayLabel, statusText, resultLine, fixtureLine, nextRefreshMs, isLive, normName
} from './sports-model.js';

const FRESH_MS = 15_000;            // a tap within this long reuses what's shown
const PAST_FRESH_MS = 10 * 60_000;  // other days change rarely
const SCHEDULE_TTL_MS = 15 * 60_000;
const TEAMS_TTL_MS = 6 * 3_600_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const COLLAPSED_KEY = "live-scores-collapsed-v1";
const PROVIDER_LABEL = { espn: "ESPN", thesportsdb: "TheSportsDB" };

// ── Pure helpers (exported for tests) ────────────────────────────────────────

// "nfl:espn:16" — how the schedule action addresses a favorite: its home league
// plus one provider's id for it. "" when the team has neither.
export function scheduleToken(fav) {
  const [provider, ref] = Object.entries(fav?.refs || {})[0] || [];
  return fav?.league && provider && ref ? `${fav.league}:${provider}:${ref}` : "";
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

  const prefs = () => normalizeSportsPrefs(getState()?.sportsPrefs);
  const isShown = () => !!mountEl?.isConnected && getActiveAppArea?.() === "news" && !document.hidden;
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
    return `<div class="scores-idle">${logoHtml(team)}<span class="scores-idle-name">${esc(team.short)}</span><span class="scores-idle-lines">${lines.join("")}</span></div>`;
  }

  function daysHtml(today) {
    return dateStrip(selected).map((key) => {
      const l = dayLabel(key, today);
      return `<button type="button" class="scores-day${key === selected ? " is-selected" : ""}" data-scores-day="${key}" aria-pressed="${key === selected}" aria-label="${esc(l.long)}"><span class="scores-day-dow">${esc(l.dow)}</span><span class="scores-day-date">${esc(l.date)}</span></button>`;
    }).join("");
  }

  function render() {
    if (!mountEl?.isConnected) return;
    rollToday();
    const today = dateKeyOf();
    const p = prefs();
    const board = seeded || boards.get(selected);
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
          <button type="button" class="scores-sec-head" data-scores-collapse="${key}" aria-expanded="${!shut}">
            <h3>${esc(sec.league.label)}</h3>
            ${sec.live ? `<span class="scores-live-pill">${sec.live} live</span>` : ""}
            <span class="scores-count">${sec.games.length + sec.hidden}</span>
            <span class="scores-chevron">${CHEVRON}</span>
          </button>
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
      <div class="scores-bar">
        <button type="button" class="scores-nav" data-scores-shift="-1" aria-label="Earlier days">‹</button>
        <div class="scores-days">${daysHtml(today)}</div>
        <button type="button" class="scores-nav" data-scores-shift="1" aria-label="Later days">›</button>
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

  function toggleFollow(teamKey, leagueKey) {
    const board = seeded || boards.get(selected);
    const pool = [
      ...(board?.games || []).flatMap((g) => [g.home.team, g.away.team]),
      ...(teamLists.get(leagueKey)?.teams || []),
      ...prefs().teams,
    ];
    const team = pool.find((t) => t.key === teamKey);
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

  // ── Interface (news-ui.js mounts this into the Sports section) ──
  function mount(el) {
    if (!el) return;
    if (mountEl !== el) {
      mountEl = el;
      el.addEventListener("click", onClick);
    }
    if (!listening) { listening = true; document.addEventListener("visibilitychange", onVisibility); }
    render();
    loadBoard(selected);
    scheduleRefresh();
  }

  function unmount() {
    mountEl = null;
    clearTimeout(timer);
    timer = null;
  }

  function refresh() {
    failures = 0;
    schedule = { ...schedule, loadedAt: 0 };
    return loadBoard(selected, { force: true });
  }

  // Local-dev only (window.__liveQA.scoresSetBoard): fill the view without a server.
  function seed(board) {
    seeded = board ? { games: cleanGames(board.games), leagues: board.leagues || {}, loadedAt: Date.now() } : null;
    if (board?.date) selected = board.date;
    if (board?.schedule) schedule = { key: "seed", loadedAt: Date.now(), byToken: board.schedule, loading: false };
    render();
    return seeded ? seeded.games.length : 0;
  }

  return { mount, unmount, refresh, seed, openSettings: openDialog };
}
