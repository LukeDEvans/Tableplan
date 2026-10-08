// Provider chain for the scores function (SPORTS_SCORES_DESIGN.md §4).
//
// A provider is an object with this contract — the whole surface a new data
// source has to implement:
//
//   id, label          string
//   live               boolean — does it carry an in-game clock and score?
//   enabled(env)       → boolean (e.g. "is my API key set?")
//   supports(league)   → boolean, for one of our league keys (sports-model.js)
//   scoreboard(league, dateKey, ctx)  → raw games for that calendar day
//   teams?(league, ctx)               → raw teams (optional)
//   teamGames?(league, ref, ctx)      → a team's recent + upcoming raw games
//                                       (optional; `ref` is its own team id)
//
// "Raw" means already in the app's field names; cleanGame/cleanTeam validate and
// trim. ctx is { fetchJson, env }. A method throws on any failure — the chain
// catches it and moves to the next provider that supports the league.
//
// Order comes from SCORES_PROVIDERS (comma-separated ids, default below). To
// retire a provider, drop it from that list; to add one, write the adapter, add
// it to PROVIDERS, and give it a fixture in test/scores-providers.test.js.
import { cleanGames, cleanTeam, LEAGUE_BY_KEY } from "../../sports-model.js";
import { espn } from "./_scores-espn.mjs";
import { thesportsdb } from "./_scores-thesportsdb.mjs";

export const PROVIDERS = Object.freeze({ espn, thesportsdb });
export const DEFAULT_ORDER = "espn,thesportsdb";

export function providerChain(env = process.env, providers = PROVIDERS) {
  const order = String(env.SCORES_PROVIDERS || DEFAULT_ORDER).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return [...new Set(order)].map((id) => providers[id]).filter((p) => p && p.enabled(env));
}

const errText = (e) => String(e?.message || e || "failed").slice(0, 120);

// One league's games for a day from the first provider that answers. Never throws.
export async function leagueScoreboard(leagueKey, dateKey, ctx) {
  const tried = [];
  for (const p of ctx.chain) {
    if (!p.supports(leagueKey)) continue;
    try {
      const games = cleanGames(await p.scoreboard(leagueKey, dateKey, ctx));
      return { ok: true, provider: p.id, live: !!p.live, games, tried };
    } catch (e) {
      tried.push({ provider: p.id, error: errText(e) });
    }
  }
  return { ok: false, provider: "", live: false, games: [], tried, error: tried.length ? tried[tried.length - 1].error : "No provider covers this league." };
}

export async function leagueTeams(leagueKey, ctx) {
  const scope = LEAGUE_BY_KEY[leagueKey].scope;
  const tried = [];
  for (const p of ctx.chain) {
    if (!p.supports(leagueKey) || typeof p.teams !== "function") continue;
    try {
      const teams = (await p.teams(leagueKey, ctx)).map((t) => cleanTeam(t, scope)).filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
      return { ok: true, provider: p.id, teams, tried };
    } catch (e) {
      tried.push({ provider: p.id, error: errText(e) });
    }
  }
  return { ok: false, provider: "", teams: [], tried, error: tried.length ? tried[tried.length - 1].error : "No provider lists this league's teams." };
}

// The most recent finished game and the next one for a team, from the provider
// whose id for it the caller holds. Never throws; { last: null, next: null } when
// that provider is gone or doesn't offer schedules.
export async function teamLastNext(leagueKey, providerId, ref, ctx, nowMs = Date.now()) {
  const p = ctx.chain.find((x) => x.id === providerId);
  if (!p || !p.supports(leagueKey) || typeof p.teamGames !== "function") return { ok: false, last: null, next: null };
  try {
    const games = cleanGames(await p.teamGames(leagueKey, ref, ctx));
    const byStart = (a, b) => Date.parse(a.start) - Date.parse(b.start);
    const done = games.filter((g) => g.state === "final").sort(byStart);
    const ahead = games.filter((g) => g.state === "live" || g.state === "delayed" || (g.state === "pre" && Date.parse(g.start) > nowMs - 6 * 3_600_000)).sort(byStart);
    return { ok: true, last: done[done.length - 1] || null, next: ahead[0] || null };
  } catch (e) {
    return { ok: false, last: null, next: null, error: errText(e) };
  }
}
