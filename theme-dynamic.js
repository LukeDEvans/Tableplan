// Dynamic display (Luke, 2026-11-04): the look changes by itself
//   • on a holiday — the whole day — to that holiday's theme, and
//   • while one of the person's chosen favorite teams is playing — to that team's
//     colors. When two chosen teams play at once, the higher-ranked one wins
//     (rank = the order of the person's favorites, state.sportsPrefs.teams).
// A game beats a holiday (it's the shorter, more specific moment). Outside both,
// the view's own theme shows.
//
// Pure (no DOM, no network): app.js feeds it today's games from the Scores
// board (the same CDN-cached request the dock ticker makes) and applies the
// answer through applyThemeMode. Only teams the person switched on count —
// a favorite on its own never changes the display.

import { THEMES, cleanGamedayTeams } from "./theme.js";
export { cleanGamedayTeams };
import { isLive, normName, sameTeam } from "./sports-model.js";

// The holiday themes, each with the day it falls on in a given year.
export const HOLIDAYS = Object.freeze([
  Object.freeze({ theme: "halloween", label: "Halloween", day: (year) => new Date(year, 9, 31) }),
  Object.freeze({ theme: "thanksgiving", label: "Thanksgiving", day: (year) => nthWeekday(year, 10, 4, 4) }), // 4th Thursday of November
]);

// month 0–11, weekday 0 (Sun)–6, n ≥ 1.
export function nthWeekday(year, month, weekday, n) {
  const first = new Date(year, month, 1).getDay();
  return new Date(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// The holiday theme for this local day, or "".
export function holidayTheme(date = new Date()) {
  for (const h of HOLIDAYS) {
    if (THEMES[h.theme] && sameDay(h.day(date.getFullYear()), date)) return h.theme;
  }
  return "";
}

// The next holiday on or after `date` — for the Display screen's line.
export function nextHoliday(date = new Date()) {
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const upcoming = [];
  for (const h of HOLIDAYS) {
    for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
      const d = h.day(year);
      if (d >= today) { upcoming.push({ ...h, date: d }); break; }
    }
  }
  upcoming.sort((a, b) => a.date - b.date);
  return upcoming[0] || null;
}

// Which theme carries a team's colors. A team matches when its scope is one
// listed and its full or short name is one of the names (normalized, as
// sports-model.js compares teams). Add a team here when its theme is added.
export const TEAM_THEMES = Object.freeze([
  Object.freeze({ theme: "vikings", scopes: ["nfl"], names: ["Minnesota Vikings", "Vikings"] }),
  Object.freeze({ theme: "wolves", scopes: ["nba"], names: ["Minnesota Timberwolves", "Timberwolves"] }),
  Object.freeze({ theme: "wolves", scopes: ["wnba"], names: ["Minnesota Lynx", "Lynx"] }),
  Object.freeze({ theme: "wild", scopes: ["nhl"], names: ["Minnesota Wild", "Wild"] }),
  Object.freeze({ theme: "twins", scopes: ["mlb"], names: ["Minnesota Twins", "Twins"] }),
  Object.freeze({ theme: "gophers", scopes: ["college", "college-w"], names: ["Minnesota Golden Gophers", "Golden Gophers", "Minnesota"] }),
  Object.freeze({ theme: "ajax", scopes: ["soccer"], names: ["AFC Ajax", "Ajax", "Ajax Amsterdam"] }),
  Object.freeze({ theme: "mnufc", scopes: ["soccer"], names: ["Minnesota United FC", "Minnesota United"] }),
]);

export function teamTheme(team) {
  if (!team?.scope) return "";
  const mine = [team.name, team.short].map(normName).filter(Boolean);
  for (const t of TEAM_THEMES) {
    if (!t.scopes.includes(team.scope) || !THEMES[t.theme]) continue;
    const names = new Set(t.names.map(normName));
    if (mine.some((n) => names.has(n))) return t.theme;
  }
  return "";
}

// The favorites that can drive the display, in rank order: switched on and with
// a theme of their own.
export function rankedGamedayTeams(favorites, onKeys) {
  const on = new Set(onKeys || []);
  return (favorites || []).filter((t) => on.has(t.key) && teamTheme(t)).map((t) => ({ team: t, theme: teamTheme(t) }));
}

const STARTED_GRACE_MS = 30 * 60_000; // started, but the feed still says "pre"
const playsIn = (game, team) => [game?.home?.team, game?.away?.team].some((t) => sameTeam(t, team));

export function isPlaying(game, nowMs = Date.now()) {
  if (isLive(game)) return true;
  if (game?.state !== "pre") return false;
  const since = nowMs - Date.parse(game.start);
  return since >= 0 && since < STARTED_GRACE_MS;
}

// The game-day theme right now: the highest-ranked switched-on team with a game
// in progress. → { theme, team, game } or null.
export function gamedayTheme(games, ranked, nowMs = Date.now()) {
  for (const { team, theme } of ranked || []) {
    const game = (games || []).find((g) => playsIn(g, team) && isPlaying(g, nowMs));
    if (game) return { theme, team, game };
  }
  return null;
}

export const GAMEDAY_LIVE_CHECK_MS = 60_000;
// When to look at the board again (foreground only), or null for "not today":
// every minute while a chosen team is playing, otherwise at the next chosen
// team's start time.
export function nextGamedayCheckMs(games, ranked, nowMs = Date.now()) {
  let soonest = null;
  for (const { team } of ranked || []) {
    for (const g of games || []) {
      if (!playsIn(g, team)) continue;
      if (isPlaying(g, nowMs)) return GAMEDAY_LIVE_CHECK_MS;
      if (g.state !== "pre") continue;
      const until = Date.parse(g.start) - nowMs;
      if (until > 0 && (soonest === null || until < soonest)) soonest = until;
    }
  }
  return soonest === null ? null : Math.max(GAMEDAY_LIVE_CHECK_MS, soonest + 5_000);
}

// The theme the view shows: the game, then the holiday, then its own.
// `prefs` is the view's display prefs ({ theme, holidays, gameday }).
export function dynamicTheme(prefs, { now = new Date(), games = [], ranked = [] } = {}) {
  if (prefs?.gameday) {
    const g = gamedayTheme(games, ranked, now.getTime());
    if (g) return { theme: g.theme, reason: "game", team: g.team };
  }
  if (prefs?.holidays) {
    const h = holidayTheme(now);
    if (h) return { theme: h, reason: "holiday" };
  }
  return { theme: prefs?.theme || "classic", reason: "" };
}
