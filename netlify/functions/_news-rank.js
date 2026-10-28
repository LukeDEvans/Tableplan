// News "For you" ranking (NEWS_RANKING_DESIGN.md) — pure, no I/O.
//
// A story is described by a few features; a person has a weight per feature; a
// story's score is the capped sum of its features' weights, plus freshness and a
// newsletter-lead bonus. Weights move with feedback (open, listen, save, More /
// Less like this, hide) and fade with a three-week half-life.
//
// Feature strings:
//   p:<paper>         s:<section>
//   t:<topic>         one of TOPICS (from the AI tags, _news-tags.js)
//   e:<entity>        a named person / place / organisation (AI tags)
//   team:<team key>   a sports-model team key ("nfl:minnesota-vikings")
//   k:<keyword>       a headline keyword or proper-noun phrase (no AI)

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const HALF_LIFE_MS = 21 * DAY_MS;
const MAX_WEIGHT = 10;
const MAX_FEATURES = 400;
const MAX_MUTED = 100;
const MAX_TOPICS = 16;
const FRESH_WINDOW_MS = 36 * HOUR_MS;
const FAVORITE_TEAM_WEIGHT = 4;

// The AI tags' fixed list (keep in step with the prompt in _news-tags.js).
const TOPICS = Object.freeze({
  "us-politics": "U.S. politics", elections: "Elections", congress: "Congress", courts: "Courts and law",
  "world-politics": "World politics", war: "War and conflict", europe: "Europe", "middle-east": "The Middle East",
  asia: "Asia", china: "China", "latin-america": "Latin America", africa: "Africa", canada: "Canada",
  minnesota: "Minnesota", economy: "The economy", markets: "Markets", business: "Business", tech: "Tech",
  ai: "AI", climate: "Climate", energy: "Energy", science: "Science", space: "Space", health: "Health",
  education: "Education", immigration: "Immigration", crime: "Crime", media: "Media", culture: "Culture",
  books: "Books", "film-tv": "Film and TV", music: "Music", art: "Art", food: "Food", travel: "Travel",
  style: "Style", housing: "Housing", "personal-finance": "Personal finance", religion: "Religion",
  obituaries: "Obituaries", transport: "Transport", labor: "Work and labor", weather: "Weather",
  nfl: "NFL", nba: "NBA", wnba: "WNBA", mlb: "MLB", nhl: "NHL", soccer: "Soccer",
  "college-sports": "College sports", olympics: "Olympics", golf: "Golf", tennis: "Tennis",
  motorsport: "Motorsport", betting: "Sports betting", "other-sports": "Other sports"
});

// How much a decision moves the weights of the story's features.
const DECISION_DELTA = Object.freeze({ read: 1, listen: 2, send: 3, more: 3, less: -3, hide: -1, skip: -0.5 });
// A story shown in For you and scrolled past this many visits (never opened) counts
// as a mild "not for me" once, and then leaves the For you pool.
const SKIP_LIMIT = 3;

// Per-feature-kind multiplier on a decision (a whole paper or section moves slowly)
// and per-kind cap on its share of a score (six keywords can't drown a topic).
const KIND = Object.freeze({
  p: { learn: 0.2, cap: 1.5 },
  s: { learn: 0.3, cap: 2 },
  t: { learn: 1, cap: 4 },
  e: { learn: 0.7, cap: 3 },
  team: { learn: 1, cap: 5 },
  k: { learn: 0.4, cap: 2 }
});
const kindOf = (f) => { const i = String(f).indexOf(":"); return i > 0 ? f.slice(0, i) : ""; };

// ── Text → features ──────────────────────────────────────────────────────────

const STOP = new Set(("a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its just more most "
  + "new news no not of off on one or our out over says said she so than that the their them then there these they this those to too two up us was we were "
  + "what when where which who why will with would you your after again against all also amid any back before being between both during each few here "
  + "while about above below through under until very week weeks year years day days today tonight first last next big top best worst why how what "
  + "plus live latest update updates analysis opinion review takeaways things ways time times may might must should shall get gets got make makes made "
  + "take takes took still now yet ever never only even much many some such own same other another want wants need needs source sources report reports "
  + "watch stream streaming channel options preview recap").split(/\s+/));
// Words that start a headline in capitals without being a name.
const HEADLINE_STARTS = new Set("why how what when who where the a an in on at for as after before inside meet can is are will does did".split(" "));

const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[’']s\b/g, "").replace(/[^a-z0-9.+&-]+/g, " ").replace(/\s+/g, " ").trim();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

// Headline + subtitle → up to `max` keyword features: proper-noun phrases first
// ("Federal Reserve", "Anthony Edwards"), then other content words, de-duplicated.
function keywordFeatures(title, subtitle = "", max = 6) {
  const out = [];
  const add = (w) => { const k = slug(w); if (k.length >= 3 && !STOP.has(k) && !out.includes(`k:${k}`)) out.push(`k:${k}`); };
  for (const text of [title, subtitle]) {
    const words = String(text || "").replace(/[“”"()[\]:;!?]/g, " ").split(/\s+/).filter(Boolean);
    let run = [];
    const endRun = () => { if (run.length >= 2 || (run.length === 1 && run[0].length >= 4)) add(run.join(" ")); run = []; };
    words.forEach((raw, i) => {
      const w = raw.replace(/[.,]+$/, "");
      const cap = /^[A-Z][a-zA-Z.&-]*[a-z]/.test(w) || /^[A-Z]{2,5}$/.test(w);
      const lw = w.toLowerCase();
      if (cap && !(i === 0 && HEADLINE_STARTS.has(lw)) && !STOP.has(lw)) run.push(w);
      else endRun();
      if (/[.,]$/.test(raw)) endRun();
    });
    endRun();
  }
  // Other content words from the headline, skipping ones already inside a phrase.
  const inPhrase = new Set(out.flatMap((k) => k.slice(2).split("-")));
  for (const w of norm(title).split(" ")) if (w.length >= 5 && !STOP.has(w) && !/^\d+$/.test(w) && !inPhrase.has(w)) add(w);
  return out.slice(0, max);
}

// Words a team's name ends in that don't identify it on their own.
const GENERIC_TEAM_WORDS = new Set(["united", "city", "fc", "sc", "afc", "cf", "state", "university", "college", "club", "athletic", "real", "sporting", "town", "county", "rovers", "wanderers"]);

// The names a story might call a team: full name, short name, and a distinctive
// nickname ("Vikings", "Timberwolves", "Golden Gophers", "Ajax"). A one-word
// nickname is matched only when capitalised ("Wild" the team, not "a wild night");
// a place name alone ("Minnesota" from "Minnesota United") is never an alias.
// Returns [{ text, cased }].
const CLUB_ABBR = new Set(["fc", "afc", "sc", "cf"]);
function teamAliases(team) {
  const out = new Map();
  const add = (s, cased = false) => {
    const n = norm(s).split(" ").filter((w) => !CLUB_ABBR.has(w)).join(" ");
    if (n.length >= 4 && !out.has(n)) out.set(n, cased && !n.includes(" "));
  };
  const all = norm(team?.name).split(" ").filter(Boolean);
  const words = all.filter((w) => !GENERIC_TEAM_WORDS.has(w));
  const placeOnly = words.length === 1 && all.some((w) => GENERIC_TEAM_WORDS.has(w) && !CLUB_ABBR.has(w));
  add(team?.name);
  const short = norm(team?.short);
  if (short && short.includes(" ")) add(short);
  if (words.length >= 3) add(words.slice(-2).join(" ")); // "golden gophers"
  if (words.length > 1) add(words[words.length - 1], true); // "vikings", "wild"
  else if (words.length === 1 && !placeOnly) add(words[0], true); // "AFC Ajax" → "Ajax"
  return [...out].map(([text, cased]) => ({ text, cased }));
}

// [teams] → (text) => [team keys mentioned]. Whole words only.
function teamMatcher(teams) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const list = (Array.isArray(teams) ? teams : []).filter((t) => t?.key).map((t) => ({
    key: t.key,
    tests: teamAliases(t).map(({ text, cased }) => (cased
      ? { cased: true, re: new RegExp(`(^|[^A-Za-z])${esc(text[0].toUpperCase() + text.slice(1))}([^A-Za-z]|$)`) }
      : { cased: false, re: new RegExp(`(^| )${esc(text)}( |$)`) }))
  }));
  return (text) => {
    const raw = String(text || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    const n = ` ${norm(text)} `;
    return list.filter((t) => t.tests.some(({ cased, re }) => re.test(cased ? raw : n))).map((t) => t.key);
  };
}

// One story's features. `ai` = { tags, entities } from _news-tags.js, or null.
// `teamKeys` = teams the story is known to be about (its Athletic team feed),
// merged with teams named in the text.
function storyFeatures(card, { ai = null, matchTeams = null, teamKeys = [] } = {}) {
  const f = [];
  const add = (x) => { if (x && !f.includes(x)) f.push(x); };
  for (const t of ai?.tags || []) if (TOPICS[t]) add(`t:${t}`);
  const text = `${card?.title || ""} ${card?.subtitle || ""}`;
  for (const k of [...teamKeys, ...(matchTeams ? matchTeams(text) : [])]) add(`team:${k}`);
  for (const e of ai?.entities || []) { const s = slug(e); if (s.length >= 3) add(`e:${s}`); }
  for (const k of keywordFeatures(card?.title, card?.subtitle, ai?.tags?.length ? 3 : 6)) add(k);
  return f.slice(0, MAX_TOPICS - 2).concat([card?.paper ? `p:${card.paper}` : "", card?.section ? `s:${card.section}` : ""].filter(Boolean));
}

// ── Weights ──────────────────────────────────────────────────────────────────

function weightOf(weights, f, nowMs) {
  const e = weights?.[f];
  if (!Array.isArray(e)) return 0;
  const [w, at] = e;
  if (!Number.isFinite(w)) return 0;
  const age = Math.max(0, nowMs - (Number(at) || nowMs));
  return w * Math.pow(0.5, age / HALF_LIFE_MS);
}

function normalizeInterest(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const weights = {};
  for (const [k, v] of Object.entries(r.weights && typeof r.weights === "object" ? r.weights : {})) {
    if (typeof k === "string" && k.length <= 80 && Array.isArray(v) && Number.isFinite(v[0])) weights[k] = [Number(v[0]), Number(v[1]) || 0];
  }
  const muted = {};
  for (const [k, v] of Object.entries(r.muted && typeof r.muted === "object" ? r.muted : {})) if (typeof k === "string" && k.length <= 80) muted[k] = Number(v) || 0;
  const teams = (Array.isArray(r.teams) ? r.teams : []).filter((t) => t && typeof t.key === "string").slice(0, 20);
  return { weights, muted, teams, teamsSig: typeof r.teams_sig === "string" ? r.teams_sig : (r.teamsSig || "") };
}

// Keep the strongest MAX_FEATURES, each stored decayed-to-now.
function compactWeights(weights, nowMs) {
  const live = Object.keys(weights).map((k) => [k, weightOf(weights, k, nowMs)]).filter(([, v]) => Math.abs(v) >= 0.05);
  live.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const out = {};
  for (const [k, v] of live.slice(0, MAX_FEATURES)) out[k] = [Math.round(v * 1000) / 1000, nowMs];
  return out;
}

// Apply decisions: [{ decision, features }] → new weights (decayed to now).
function applyFeedback(weights, items, nowMs = Date.now()) {
  const next = { ...(weights || {}) };
  for (const { decision, features } of items || []) {
    const delta = DECISION_DELTA[decision];
    if (!delta) continue;
    for (const f of features || []) {
      const k = KIND[kindOf(f)];
      if (!k) continue;
      const v = Math.max(-MAX_WEIGHT, Math.min(MAX_WEIGHT, weightOf(next, f, nowMs) + delta * k.learn));
      next[f] = [v, nowMs];
    }
  }
  return compactWeights(next, nowMs);
}

// The feature "Mute topic" mutes: the story's first AI topic, else its team,
// entity or keyword. Never a whole paper or section.
function primaryFeature(features) {
  for (const kind of ["t", "team", "e", "k"]) {
    const f = (features || []).find((x) => kindOf(x) === kind);
    if (f) return f;
  }
  return null;
}

function addMute(muted, feature, nowMs = Date.now()) {
  if (!feature) return { ...(muted || {}) };
  const entries = Object.entries({ ...(muted || {}), [feature]: nowMs }).sort((a, b) => b[1] - a[1]).slice(0, MAX_MUTED);
  return Object.fromEntries(entries);
}

// ── Scoring ──────────────────────────────────────────────────────────────────

const favoriteTeamFeatures = (teams) => new Set((teams || []).map((t) => `team:${t.key}`));

function scoreStory(features, interest, { nowMs = Date.now(), publishedAt, leadAt } = {}) {
  const muted = interest?.muted || {};
  if ((features || []).some((f) => muted[f] !== undefined)) return null;
  const favs = favoriteTeamFeatures(interest?.teams);
  const byKind = {};
  for (const f of features || []) {
    const kind = kindOf(f);
    if (!KIND[kind]) continue;
    const w = weightOf(interest?.weights, f, nowMs) + (favs.has(f) ? FAVORITE_TEAM_WEIGHT : 0);
    byKind[kind] = (byKind[kind] || 0) + w;
  }
  let score = 0;
  for (const [kind, sum] of Object.entries(byKind)) score += Math.max(-KIND[kind].cap, Math.min(KIND[kind].cap, sum));
  const age = nowMs - (Date.parse(publishedAt || "") || nowMs);
  score += 2 * Math.max(0, 1 - Math.max(0, age) / FRESH_WINDOW_MS);
  const lead = Date.parse(leadAt || "");
  if (lead && nowMs - lead <= FRESH_WINDOW_MS) score += 1;
  return Math.round(score * 1000) / 1000;
}

// The part of a score that comes from the person's interests (not freshness or
// paper/section), used to tell "matches you" from "something different".
function interestScore(features, interest, nowMs) {
  const favs = favoriteTeamFeatures(interest?.teams);
  let s = 0;
  for (const f of features || []) {
    if (!["t", "e", "team", "k"].includes(kindOf(f))) continue;
    s += weightOf(interest?.weights, f, nowMs) + (favs.has(f) ? FAVORITE_TEAM_WEIGHT : 0);
  }
  return s;
}

// A short reason to show on the card, from the strongest positive feature.
function whyLabel(features, interest, nowMs = Date.now()) {
  const favs = favoriteTeamFeatures(interest?.teams);
  const teamName = (key) => { const t = (interest?.teams || []).find((x) => x.key === key); return t ? (t.short || t.name) : ""; };
  let best = null;
  for (const f of features || []) {
    const kind = kindOf(f);
    if (!["t", "e", "team", "k", "s"].includes(kind)) continue;
    const w = weightOf(interest?.weights, f, nowMs) + (favs.has(f) ? FAVORITE_TEAM_WEIGHT : 0);
    if (w > 0.5 && (!best || w > best.w)) best = { f, w, kind };
  }
  if (!best) return "";
  const v = best.f.slice(best.kind.length + 1);
  if (best.kind === "t") return TOPICS[v] || "";
  if (best.kind === "team") return teamName(v);
  if (best.kind === "s") return "";
  return v.split("-").map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}
const featureLabel = (f, interest) => {
  const kind = kindOf(f);
  const v = String(f).slice(kind.length + 1);
  if (kind === "t") return TOPICS[v] || v;
  if (kind === "team") { const t = (interest?.teams || []).find((x) => x.key === v); return t ? (t.short || t.name) : v.split(":").pop().replace(/-/g, " "); }
  return v.replace(/-/g, " ");
};

// Order a pool of scored stories for the For you view.
//   rows: [{ id, section, features, score, publishedAt }]
// Greedy by score with two diversity rules (no three in a row from one section;
// at most three of the top ten sharing a topic or team), and every 8th slot an
// "exploration" pick: a fresh story with no positive interest match, chosen at
// random, so the view can learn about things outside the usual mix.
function arrangeForYou(rows, interest, { limit = 40, nowMs = Date.now(), rng = Math.random } = {}) {
  const pool = (rows || []).filter((r) => r && r.score != null).slice().sort((a, b) => b.score - a.score);
  const out = [];
  const used = new Set();
  const lead = (r) => primaryFeature(r.features) || `s:${r.section}`;
  const ok = (r, sectionRule = true) => {
    const n = out.length;
    if (sectionRule && n >= 2 && out[n - 1].section === r.section && out[n - 2].section === r.section) return false;
    if (n < 10) {
      const l = lead(r);
      if (out.filter((x) => lead(x) === l).length >= 3) return false;
    }
    return true;
  };
  const explorers = pool.filter((r) => interestScore(r.features, interest, nowMs) <= 0 && nowMs - (Date.parse(r.publishedAt || "") || 0) < DAY_MS);
  while (out.length < limit && used.size < pool.length) {
    let pick = null;
    if ((out.length + 1) % 8 === 0) {
      const choices = explorers.filter((r) => !used.has(r.id));
      if (choices.length) pick = { ...choices[Math.floor(rng() * choices.length) % choices.length], explore: true };
    }
    // Both rules; then only the topic rule; then the best left.
    if (!pick) pick = pool.find((r) => !used.has(r.id) && ok(r)) || pool.find((r) => !used.has(r.id) && ok(r, false)) || pool.find((r) => !used.has(r.id));
    if (!pick) break;
    used.add(pick.id);
    out.push(pick);
  }
  return out;
}

// Which Athletic stories one person gets: with favourite teams, only stories from
// a favourite's team feed (card.teamKeys) or naming a favourite; with none,
// everything (as before For you). Other papers' stories pass through.
function athleticForUser(cards, teams) {
  if (!teams?.length) return cards || [];
  const keys = new Set(teams.map((t) => t.key));
  const match = teamMatcher(teams);
  return (cards || []).filter((c) => c?.paper !== "athletic"
    || (c.teamKeys || []).some((k) => keys.has(k))
    || match(`${c.title || ""} ${c.subtitle || ""}`).length > 0);
}

// "What News has learned": the strongest likes and dislikes and the mutes, named.
// Papers and sections are left out (they move slowly and read oddly as interests).
function learnedSummary(interest, { nowMs = Date.now(), likes = 20, dislikes = 10 } = {}) {
  const rows = Object.keys(interest?.weights || {})
    .filter((f) => ["t", "e", "team", "k"].includes(kindOf(f)))
    .map((f) => ({ feature: f, weight: Math.round(weightOf(interest.weights, f, nowMs) * 10) / 10 }))
    .filter((r) => Math.abs(r.weight) >= 0.3);
  const named = (r) => ({ ...r, label: featureLabel(r.feature, interest), kind: kindOf(r.feature) });
  return {
    likes: rows.filter((r) => r.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, likes).map(named),
    dislikes: rows.filter((r) => r.weight < 0).sort((a, b) => a.weight - b.weight).slice(0, dislikes).map(named),
    muted: Object.entries(interest?.muted || {}).sort((a, b) => b[1] - a[1]).map(([f]) => ({ feature: f, label: featureLabel(f, interest), kind: kindOf(f) })),
    teams: (interest?.teams || []).map((t) => t.short || t.name)
  };
}

// Edits from that screen: forget some learned features, unmute some, or reset
// everything learned (favourite teams stay; they come from Scores).
function editInterest(interest, { forget = [], unmute = [], reset = false } = {}, nowMs = Date.now()) {
  if (reset) return { weights: {}, muted: {} };
  const weights = { ...(interest?.weights || {}) };
  for (const f of forget) delete weights[f];
  const muted = { ...(interest?.muted || {}) };
  for (const f of unmute) delete muted[f];
  return { weights: compactWeights(weights, nowMs), muted };
}

// Favourite teams → a stable signature (the app compares it with its own to know
// whether to send its favourites again). Same function in news-ui.js.
function teamsSignature(teams) {
  return (Array.isArray(teams) ? teams : []).map((t) => String(t?.key || "")).filter(Boolean).sort().join("|");
}
function cleanTeams(raw) {
  const s = (v, n) => String(v ?? "").slice(0, n);
  return (Array.isArray(raw) ? raw : []).filter((t) => t && /^[a-z-]+:[a-z0-9-]+$/.test(String(t.key || ""))).slice(0, 20)
    .map((t) => ({ key: s(t.key, 80), scope: s(t.scope, 24), name: s(t.name, 80), short: s(t.short, 40), league: s(t.league, 32) }));
}

module.exports = {
  TOPICS, DECISION_DELTA, MAX_TOPICS, HALF_LIFE_MS, FAVORITE_TEAM_WEIGHT,
  keywordFeatures, teamAliases, teamMatcher, storyFeatures,
  weightOf, normalizeInterest, applyFeedback, primaryFeature, addMute,
  scoreStory, interestScore, whyLabel, featureLabel, arrangeForYou,
  teamsSignature, cleanTeams, kindOf, athleticForUser, learnedSummary, editInterest, SKIP_LIMIT
};
