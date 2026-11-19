// ── Your place in a show (Luke, 2026-11-01) ──────────────────────────────────
//
// Shows like Saturday Night Live or Holiday Baking Championship are watched from
// "now", not from Season 1, and nobody should have to tick 50 seasons to say so.
//
//   • Your place is the episode you crossed off MOST RECENTLY (its tick time,
//     watch-merge.js `tickAt`). The panel opens on its season, "next" is the
//     first unticked episode after it, and anything before it that isn't ticked
//     counts as skipped, not missed. The poster's bar shows that season.
//     Ticks saved before tick times existed: the furthest-along tick.
//   • A show with nothing crossed off opens on Season 1 — except talk, reality
//     and news shows (TMDB's type or genre), which open on the latest season
//     that has aired.
//
// Pure: the caller passes `episodesFor(season)` (the season's episode list,
// [] when not loaded) and `seasons` (the season numbers the show has).

// TMDB TV genre ids: 10763 News, 10764 Reality, 10767 Talk.
const FROM_NOW_TYPES = new Set(["Reality", "Talk Show", "News"]);
const FROM_NOW_GENRES = new Set([10763, 10764, 10767]);

/** A show you'd start at its newest season (talk / reality / news). */
export function watchesFromNow(item) {
  if (!item) return false;
  if (FROM_NOW_TYPES.has(item.showType)) return true;
  return Array.isArray(item.genreIds) && item.genreIds.some((g) => FROM_NOW_GENRES.has(Number(g)));
}

/** The season a never-started show opens on. */
export function watchStartSeason(item, seasons = []) {
  const last = seasons.length ? Math.max(...seasons) : (item?.totalSeasons || 1);
  if (!watchesFromNow(item)) return seasons.length ? Math.min(...seasons) : 1;
  const aired = Number(item.lastAiredSeason);
  return Number.isFinite(aired) && aired > 0 && aired <= last ? aired : last;
}

/**
 * Your place: { season, episode } of the most recently ticked episode, or null
 * when nothing is ticked. `episode` is Infinity for a season ticked as a whole
 * (an old save), meaning "the end of that season".
 */
export function watchPlace(item) {
  const prog = item?.seasonProgress || {};
  let best = null;
  for (const [key, at] of Object.entries(item?.tickAt || {})) {
    const [s, e] = key.split(":").map(Number);
    if (!(s > 0) || !(e > 0) || !prog[s]?.episodes?.[e]) continue; // unticked since
    if (typeof at === "string" && (!best || at > best.at)) best = { season: s, episode: e, at };
  }
  if (best) return { season: best.season, episode: best.episode };
  for (const [s, sd] of Object.entries(prog)) {
    const sn = Number(s);
    if (!(sn > 0) || !sd || typeof sd !== "object") continue;
    const eps = Object.entries(sd.episodes || {}).filter(([, v]) => v).map(([e]) => Number(e)).filter((e) => e > 0);
    const e = sd.watched ? Infinity : (eps.length ? Math.max(...eps) : 0);
    if (!e) continue;
    if (!best || sn > best.season || (sn === best.season && e > best.episode)) best = { season: sn, episode: e };
  }
  return best;
}

/**
 * The next episode to watch: the first unticked one after your place (or from
 * the start season when there's no place). { season, episode, name, unsure? }
 * or null when you're caught up. `unsure` = the season's list isn't loaded.
 */
export function watchNextFrom(item, { seasons = [], episodesFor = () => [] } = {}) {
  if (!item || item.type !== "tv") return null;
  const prog = item.seasonProgress || {};
  const place = watchPlace(item);
  const last = Math.max(1, item.totalSeasons || 0, ...seasons, place?.season || 0);
  let s = place ? place.season : watchStartSeason(item, seasons);
  let from = place ? place.episode : 0;
  for (; s <= last; s++, from = 0) {
    if (from === Infinity) continue;
    const sd = prog[s] || {};
    if (sd.watched) continue; // a season ticked as a whole (old save)
    const ticked = sd.episodes || {};
    const eps = episodesFor(s) || [];
    if (eps.length) {
      const ep = eps.find((x) => x.episodeNumber > from && !ticked[x.episodeNumber]);
      if (ep) return { season: s, episode: ep.episodeNumber, name: ep.name || "" };
      continue;
    }
    let e = from + 1;
    while (ticked[e]) e++;
    return { season: s, episode: e, name: "", unsure: true };
  }
  return null;
}

/** The season the panel opens on: next episode's, else your place's, else the start. */
export function watchOpenSeason(item, { seasons = [], episodesFor = () => [] } = {}) {
  if (!seasons.length) return null;
  const next = watchNextFrom(item, { seasons, episodesFor });
  if (next && seasons.includes(next.season)) return next.season;
  const place = watchPlace(item);
  if (place && seasons.includes(place.season)) return place.season;
  const start = watchStartSeason(item, seasons);
  return seasons.includes(start) ? start : seasons[seasons.length - 1];
}

/**
 * The poster's bar: % of the season you're in (next episode's season, else
 * your place's). null for a show you haven't started or can't measure.
 */
export function watchSeasonPct(item, { seasons = [], episodesFor = () => [] } = {}) {
  if (!item || item.type !== "tv") return null;
  const place = watchPlace(item);
  if (!place) return null;
  const next = watchNextFrom(item, { seasons, episodesFor });
  const s = next ? next.season : place.season;
  const sd = item.seasonProgress?.[s] || {};
  const eps = episodesFor(s) || [];
  const ticked = sd.episodes || {};
  const total = eps.length || Object.keys(ticked).length;
  if (!total) return null;
  if (sd.watched) return 100;
  const done = eps.length ? eps.filter((x) => ticked[x.episodeNumber]).length : Object.values(ticked).filter(Boolean).length;
  return Math.round((done / total) * 100);
}
