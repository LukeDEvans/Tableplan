// news-ticker.js — the headlines-and-scores strip along the top of the bottom
// dock (Luke, 2026-10-14). A third of the dock's height; one item at a time.
//
// What it shows, in order:
//   1. News: the Front page's lead stories (news-ui.js tickerLeads — the
//      newsletter leads from the last ~36 h).
//   2. Scores: every game of a team the user follows (state.sportsPrefs, the
//      Scores view's favorites) on the days in view —
//        before noon  yesterday's games (results) and today's
//        from noon    today's games and tomorrow's (what's coming)
//      Today's games run live first, then upcoming, then finished.
//
// A tap opens the story in the reader, or the game in News → Sports → Scores on
// its day. Swiping sideways skips; hovering (or touching) holds it.
//
// Data: only through the injected news and scores interfaces — the scores
// function (CDN-cached) and News's own feed call, never Supabase directly.
// Refreshes are one timer, only while the app is in the foreground: scores every
// 30 s while a followed game is on (or about to start), otherwise every 10 min;
// headlines every 15 min at most (a one-row Front page request).

import { LEAGUE_BY_KEY, normalizeSportsPrefs, isFavorite, compareGames, statusText, isLive, nextRefreshMs, dateKeyOf, shiftDateKey } from './sports-model.js';
import { NEWS_SECTIONS } from './news-ui.js';

export const TICKER_NOON_HOUR = 12;
export const TICKER_MAX_LEADS = 8;
const NEWS_TTL_MS = 15 * 60_000;
const SCORES_IDLE_MS = 10 * 60_000;
const SCORES_LIVE_TTL_MS = 25_000;
const HOLD_MS = 5_500;            // an item that fits
const SCROLL_LEAD_MS = 1_400;     // pause before a long item scrolls
const SCROLL_TAIL_MS = 1_600;     // pause after it has
const SCROLL_PX_PER_S = 48;
const TOUCH_HOLD_MS = 10_000;
const SECTION_LABEL = Object.fromEntries(NEWS_SECTIONS.map((s) => [s.key, s.label]));

// ── Pure helpers (exported for tests) ────────────────────────────────────────

// The days the ticker covers at `now` (the viewer's local day): before noon,
// yesterday and today; from noon, today and tomorrow. rel: -1 | 0 | 1.
export function tickerDays(now = new Date()) {
  const today = dateKeyOf(now);
  return now.getHours() < TICKER_NOON_HOUR
    ? [{ key: shiftDateKey(today, -1), rel: -1 }, { key: today, rel: 0 }]
    : [{ key: today, rel: 0 }, { key: shiftDateKey(today, 1), rel: 1 }];
}

// Milliseconds until the window above next changes (noon or midnight), plus a beat.
export function msUntilWindowChange(now = new Date()) {
  const next = new Date(now);
  if (now.getHours() < TICKER_NOON_HOUR) next.setHours(TICKER_NOON_HOUR, 0, 0, 0);
  else { next.setDate(next.getDate() + 1); next.setHours(0, 0, 0, 0); }
  return Math.max(1_000, next - now + 1_000);
}

// Followed teams' games across the days in view, in ticker order.
// gamesByDay: { dateKey: games[] | null }. → [{ game, dateKey, rel, fav: { home, away } }]
export function favoriteGames(gamesByDay, prefs, days) {
  const p = normalizeSportsPrefs(prefs);
  if (!p.teams.length) return [];
  const seen = new Set();
  const out = [];
  for (const day of days || []) {
    const list = (gamesByDay?.[day.key] || [])
      .map((game) => ({ game, dateKey: day.key, rel: day.rel, fav: { home: isFavorite(p, game.home.team), away: isFavorite(p, game.away.team) } }))
      .filter((e) => (e.fav.home || e.fav.away) && !seen.has(e.game.id));
    // Today: live, then upcoming, then finished. Other days: by start time.
    list.sort(day.rel === 0 ? (a, b) => compareGames(a.game, b.game) : (a, b) => Date.parse(a.game.start) - Date.parse(b.game.start));
    for (const e of list) { seen.add(e.game.id); out.push(e); }
  }
  return out;
}

const timeOf = (iso, locale) => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));

// The words for one game: league tag, the two sides (in the sport's order), and
// the status ("Final", "3rd 5:21", "7:00 PM", "Tomorrow 7:00 PM", "Yesterday · Final").
export function gameTicker(entry, { locale } = {}) {
  const { game, rel, fav } = entry;
  // Soccer lists the home side first; North American sports list the visitor first.
  const order = game.sport === "soccer" ? ["home", "away"] : ["away", "home"];
  const scored = game.home.score !== null && game.away.score !== null;
  const sides = order.map((w) => ({
    abbr: game[w].team.abbr || game[w].team.short,
    score: scored ? game[w].score : null,
    fav: !!fav?.[w],
  }));
  let status;
  if (game.state === "pre") {
    const when = game.detail || timeOf(game.start, locale);
    status = rel === 1 ? `Tomorrow ${when}` : rel === -1 ? `Yesterday ${when}` : when;
  } else {
    status = statusText(game);
    if (rel === -1) status = `Yesterday · ${status}`;
    if (rel === 1) status = `Tomorrow · ${status}`;
  }
  const joiner = scored ? "" : game.sport === "soccer" ? "v" : "at";
  const label = `${game.away.team.name} at ${game.home.team.name}${scored ? `, ${game.away.score} to ${game.home.score}` : ""}, ${status}`;
  return { league: LEAGUE_BY_KEY[game.league]?.short || "", sides, joiner, status, live: isLive(game), label };
}

// Everything the ticker shows, news first, then scores. Each item has a stable `key`.
export function buildTickerItems({ leads = [], games = [] } = {}, fmt = {}) {
  const items = [];
  for (const a of (leads || []).slice(0, TICKER_MAX_LEADS)) {
    if (!a?.id || !a.title) continue;
    items.push({ kind: "news", key: `n:${a.id}`, id: a.id, tag: SECTION_LABEL[a.section] && a.section !== "more" ? SECTION_LABEL[a.section] : "News", text: a.title, read: !!a.readAt });
  }
  for (const e of games || []) {
    items.push({ kind: "game", key: `g:${e.game.id}`, id: e.game.id, dateKey: e.dateKey, ...gameTicker(e, fmt) });
  }
  return items;
}

// How long to hold an item whose text overflows its box by `overflowPx`.
export function holdMsFor(overflowPx) {
  if (!(overflowPx > 4)) return HOLD_MS;
  return SCROLL_LEAD_MS + Math.round((overflowPx / SCROLL_PX_PER_S) * 1000) + SCROLL_TAIL_MS;
}

// ── Module ───────────────────────────────────────────────────────────────────

export function createNewsTickerModule(deps) {
  const {
    escapeHtml: esc,
    getState,
    // Whether the ticker may show at all (signed in, News switched on).
    isEnabled,
    // news-ui.js tickerLeads({ maxAgeMs }) → lead articles.
    getLeads,
    // scores-ui.js getBoard(dateKey, { maxAgeMs }) → games | null.
    getBoard,
    // Open a headline (news-ui.js openStory) / a game in News → Scores.
    openStory,
    openGame,
    // The ticker shows or hides — the dock's height changes with it.
    onShownChange,
  } = deps;

  let items = [];
  let index = 0;
  let advanceTimer = null;
  let scrollTimer = null;
  let refreshTimer = null;
  let refreshing = null;
  let holdUntil = 0;
  let hovered = false;
  let wired = false;
  let shown = false;
  let suppressClick = false;
  let lastLiveish = false;

  const el = () => document.getElementById("dockTicker");
  const stage = () => document.getElementById("dockTickerStage");
  const reduceMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // ── Data ──
  // A call while a refresh is running runs once more afterward, with the latest
  // state (a favorite followed mid-load must still show).
  let again = false;
  async function refresh() {
    if (refreshing) { again = true; return refreshing; }
    refreshing = (async () => {
      do {
        again = false;
        await refreshOnce();
      } while (again);
    })().finally(() => { refreshing = null; scheduleRefresh(); });
    return refreshing;
  }
  async function refreshOnce() {
    try {
      if (!isEnabled?.()) { setItems([]); return; }
      const now = new Date();
      const days = tickerDays(now);
      const ttl = lastLiveish ? SCORES_LIVE_TTL_MS : SCORES_IDLE_MS / 2;
      const [l, ...boards] = await Promise.all([
        Promise.resolve(getLeads?.({ maxAgeMs: NEWS_TTL_MS })).catch(() => []),
        ...days.map((d) => Promise.resolve(getBoard?.(d.key, { maxAgeMs: ttl })).catch(() => null)),
      ]);
      const leads = l || [];
      const byDay = Object.fromEntries(days.map((d, i) => [d.key, boards[i]]));
      const games = favoriteGames(byDay, getState?.()?.sportsPrefs, days);
      lastLiveish = nextRefreshMs(games.filter((e) => e.rel >= 0).map((e) => e.game), now.getTime()) !== null;
      setItems(buildTickerItems({ leads, games }));
    } catch {
      /* keep what's showing */
    }
  }

  // One timer, foreground only: soon while a followed game is on, otherwise
  // every few minutes, and always at noon / midnight when the days in view change.
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = null;
    if (document.hidden || !isEnabled?.()) return;
    const delay = Math.min(lastLiveish ? 30_000 : SCORES_IDLE_MS, msUntilWindowChange());
    refreshTimer = setTimeout(() => { refreshTimer = null; if (!document.hidden) refresh(); }, delay);
  }

  // ── Display ──
  function setItems(next) {
    const currentKey = items[index]?.key;
    const before = items[index] ? JSON.stringify(items[index]) : "";
    items = next;
    const keep = items.findIndex((it) => it.key === currentKey);
    index = keep >= 0 ? keep : 0;
    setShown(items.length > 0);
    if (!items.length) { stopRotation(); if (stage()) stage().innerHTML = ""; return; }
    // Same item still showing and unchanged: leave it be (a scroll in progress stays).
    if (keep >= 0 && JSON.stringify(items[index]) === before && stage()?.firstElementChild) {
      if (!advanceTimer) startItem(stage().firstElementChild);
      return;
    }
    showItem(0);
  }

  function setShown(on) {
    const host = el();
    if (host) host.hidden = !on;
    document.body.classList.toggle("has-dock-ticker", on);
    if (on !== shown) { shown = on; onShownChange?.(on); }
  }

  function itemHtml(it) {
    if (it.kind === "news") {
      return `<button type="button" class="dtk-item is-news${it.read ? " is-read" : ""}" data-dtk-key="${esc(it.key)}" aria-label="${esc(`${it.tag}: ${it.text}`)}">
        <span class="dtk-tag">${esc(it.tag)}</span>
        <span class="dtk-text"><span class="dtk-run">${esc(it.text)}</span></span>
      </button>`;
    }
    const side = (s) => `<span class="dtk-side${s.fav ? " is-fav" : ""}">${esc(s.abbr)}${s.score !== null ? ` <b>${esc(String(s.score))}</b>` : ""}</span>`;
    const mid = it.joiner ? `<span class="dtk-join">${esc(it.joiner)}</span>` : '<span class="dtk-join" aria-hidden="true">·</span>';
    return `<button type="button" class="dtk-item is-game${it.live ? " is-live" : ""}" data-dtk-key="${esc(it.key)}" aria-label="${esc(it.label)}">
      <span class="dtk-tag">${esc(it.league)}</span>
      <span class="dtk-text"><span class="dtk-run">${side(it.sides[0])}${mid}${side(it.sides[1])}</span></span>
      <span class="dtk-status">${it.live ? '<i class="dtk-live-dot" aria-hidden="true"></i>' : ""}${esc(it.status)}</span>
    </button>`;
  }

  // Put item `index` on stage. dir: 0 = replace in place, 1 = next (rises from
  // below), -1 = previous (drops from above).
  function showItem(dir) {
    const host = stage();
    if (!host || !items.length) return;
    clearTimers();
    const wrap = document.createElement("div");
    wrap.innerHTML = itemHtml(items[index]).trim();
    const next = wrap.firstElementChild;
    const old = [...host.children];
    if (!dir || reduceMotion() || !old.length) {
      host.replaceChildren(next);
    } else {
      next.style.transform = `translateY(${dir * 100}%)`;
      host.append(next);
      void host.offsetWidth; // commit the start position
      const ease = "transform 0.32s cubic-bezier(0.2, 0.7, 0.3, 1)";
      next.style.transition = ease;
      next.style.transform = "translateY(0)";
      for (const o of old) {
        o.style.transition = ease;
        o.style.transform = `translateY(${-dir * 100}%)`;
        setTimeout(() => o.remove(), 360);
      }
    }
    startItem(next);
  }

  // Scroll a long item through once, then hold, then move on.
  function startItem(node) {
    clearTimers();
    const box = node.querySelector(".dtk-text");
    const run = node.querySelector(".dtk-run");
    let overflow = 0;
    if (box && run && !reduceMotion()) {
      run.style.transition = "none";
      run.style.transform = "";
      overflow = Math.max(0, run.scrollWidth - box.clientWidth);
    }
    node.classList.toggle("is-long", overflow > 4);
    if (overflow > 4) {
      scrollTimer = setTimeout(() => {
        run.style.transition = `transform ${(overflow / SCROLL_PX_PER_S).toFixed(2)}s linear`;
        run.style.transform = `translateX(${-overflow}px)`;
      }, SCROLL_LEAD_MS);
    }
    if (items.length > 1) advanceTimer = setTimeout(tick, holdMsFor(overflow));
  }

  function tick() {
    advanceTimer = null;
    const wait = holdUntil - Date.now();
    if (wait > 0 || hovered || document.hidden) { advanceTimer = setTimeout(tick, Math.max(wait, 1_000)); return; }
    step(1);
  }

  function step(dir) {
    if (items.length < 2) return;
    index = (((index + dir) % items.length) + items.length) % items.length;
    showItem(dir);
  }

  function clearTimers() {
    clearTimeout(advanceTimer); advanceTimer = null;
    clearTimeout(scrollTimer); scrollTimer = null;
  }
  function stopRotation() { clearTimers(); }

  // ── Input ──
  function wire() {
    const host = el();
    if (wired || !host) return;
    wired = true;
    host.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-dtk-key]");
      if (!btn || suppressClick) return;
      const it = items.find((x) => x.key === btn.dataset.dtkKey);
      if (!it) return;
      if (it.kind === "news") openStory?.(it.id);
      else openGame?.(it.dateKey, it.id);
    });
    host.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") hovered = true; });
    host.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hovered = false; });
    let sx = 0, sy = 0;
    host.addEventListener("touchstart", (e) => {
      holdUntil = Date.now() + TOUCH_HOLD_MS;
      const t = e.touches[0];
      sx = t?.clientX || 0; sy = t?.clientY || 0;
    }, { passive: true });
    host.addEventListener("touchend", (e) => {
      const t = e.changedTouches[0];
      const dx = (t?.clientX || 0) - sx, dy = (t?.clientY || 0) - sy;
      if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy)) {
        suppressClick = true; setTimeout(() => { suppressClick = false; }, 400);
        step(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
    // Trackpad: one item per sideways gesture.
    let wheelAcc = 0, wheelLock = 0;
    host.addEventListener("wheel", (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (Date.now() < wheelLock) return;
      wheelAcc += e.deltaX;
      if (Math.abs(wheelAcc) > 40) { step(wheelAcc > 0 ? 1 : -1); wheelAcc = 0; wheelLock = Date.now() + 450; }
    }, { passive: false });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { clearTimeout(refreshTimer); refreshTimer = null; return; }
      refresh();
    });
  }

  function init() {
    wire();
    return refresh();
  }

  return {
    init, refresh,
    items: () => items.map((it) => ({ ...it })),
    current: () => items[index]?.key || null,
    next: () => step(1),
  };
}
