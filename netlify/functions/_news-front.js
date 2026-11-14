// The Front page's top stories (NEWS_FRONT_PAGE_DESIGN.md). Pure: rows in, order out.
//
// Before this the Front page was "the newsletters' first links, then everything
// newest first", so during the 2026-11-13 nationwide ground stop it led with a
// travel piece while eleven ground-stop stories sat far down the list. Now the
// stories of the last day are grouped into events, each event gets a heat (how
// many stories, how recently, from how many papers, with a live blog or not),
// and the hottest events lead the page.
//
// Nothing here reads the network or the database; _news-store.js loadFeedPage
// hands it the pool it already read.

const HOUR_MS = 3_600_000;
const POOL_WINDOW_MS = 24 * HOUR_MS;   // stories older than this never lead
const HEAT_TAU_MS = 6 * HOUR_MS;       // a story's weight in its event falls by 1/e every 6 h
const FRESH_MS = 12 * HOUR_MS;         // freshness bonus runs out here
const BREAKING_MS = 6 * HOUR_MS;      // how long a new event keeps its head start
const TOP_MAX = 8;                     // stories pinned above the newest-first list
const BIG_EVENT_HEAT = 3;              // an event this hot may show a second story, from another paper
const MIN_TOP_SCORE = 4.5;             // below this a story is not "front page"; the list stays newest-first

// How much a section counts toward the front page: hard news leads, features don't.
const SECTION_PRIOR = { us: 1, world: 1, politics: 1, mn: 1, business: 0.6, science: 0.2, more: -0.5, sports: -1, opinion: -1.5, culture: -1.5 };

// Words that say nothing about which event a story is about. The second group is
// the standing cast of political news: two stories that share only "Trump" and
// "Congress" are not the same event.
const STOP = new Set((
  "a an and are as at be been but by can could did do does for from had has have he her here hers him his how i if in into is it its just " +
  "may might more most much my new no not now of off on one only or other our out over own s said say says she so some still such t than that " +
  "the their them then there these they this those to too two under up us was we were what when where which who why will with would you your " +
  "about after again against all also amid among any back because before being between both down during each even every first get got go going " +
  "last latest like live look make makes many next news plus since take takes three time today week year years day days way know need want " +
  "trump president administration white house senate congress democrats democrat democratic republicans republican gop officials government federal " +
  "state states united america american americans national nation country city county minnesota minneapolis paul york world u.s " +
  // Words every desk uses every day.
  "work district election elections race chief company best public across secretary former million billion people help should deal power left right " +
  "lost lose loss feel top run second long talk talks turn moment show market review play another meet face plan plans call calls set big major " +
  "found leader leaders official report reports group case home open close end start part early late high low old little good bad " +
  "monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december"
).split(" "));

const ms = (iso) => { const t = Date.parse(iso || ""); return Number.isNaN(t) ? 0 : t; };

// A crude stem, enough to join grounded / grounding / ground and flights / flight.
function stem(w) {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es") && !w.endsWith("ses")) return w.slice(0, -1).replace(/e$/, "");
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

// The words a story is "about": headline, summary and its AI entity tags.
function storyTokens(row) {
  const out = new Set();
  const add = (text) => {
    for (const raw of String(text || "").toLowerCase().replace(/[’']s\b/g, "").replace(/\b([a-z])\.(?=[a-z]\.)/g, "$1").split(/[^a-z0-9]+/)) {
      if (raw.length < 3 || STOP.has(raw) || /^\d+$/.test(raw)) continue;
      const s = stem(raw);
      if (s.length >= 3 && !STOP.has(s)) out.add(s);
    }
  };
  add(row.title);
  add(row.subtitle);
  for (const t of row.topics || []) if (typeof t === "string" && t.startsWith("e:")) add(t.slice(2).replace(/-/g, " "));
  return out;
}

const isLive = (row) => /\/live\//.test(row.url || "") || /^live:/i.test(row.title || "");
// A live blog's individual update (nytimes.com/live/<date>/<desk>/<blog>/<update>):
// part of the event, never the story that represents it.
const isLiveUpdate = (row) => /^live:/i.test(row.title || "") === false && /\/live\//.test(row.url || "");

// Group the pool into events. Pure.
//
// Pass 1, leader-follower, oldest story first. A story joins a young event (one
// or two stories) only if it shares three words with one of them; it joins an
// established event if it shares two of that event's core words (words in at
// least 30% of its stories, and in at least two). Core words are what stop
// chains: a story must match what the event is about, not any one member.
// Pass 2 repairs what the order of arrival split: established events about the
// same thing are merged, and leftover stories that carry two of an established
// event's main words (those in half its stories) are moved into it.
const sharedCount = (a, b) => { let n = 0; for (const t of a) if (b.has(t)) n++; return n; };
const coreWords = (c, share) => {
  const need = Math.max(2, Math.ceil(c.items.length * share));
  return new Set([...c.df].filter(([, n]) => n >= need).map(([t]) => t));
};
function addTo(c, it) {
  c.items.push(it);
  for (const t of it.tokens) c.df.set(t, (c.df.get(t) || 0) + 1);
}
function clusterRows(rows) {
  const items = rows.map((row) => ({ row, tokens: storyTokens(row), at: ms(row.published_at) })).sort((a, b) => a.at - b.at);
  let clusters = [];
  for (const it of items) {
    let best = null, bestShared = 0;
    for (const c of clusters) {
      let shared;
      if (c.items.length < 3) {
        shared = Math.max(...c.items.map((m) => sharedCount(it.tokens, m.tokens)));
        if (shared < 3) continue;
      } else {
        shared = sharedCount(it.tokens, coreWords(c, 0.3));
        if (shared < 2) continue;
      }
      if (shared > bestShared) { best = c; bestShared = shared; }
    }
    if (!best) clusters.push(best = { items: [], df: new Map() });
    addTo(best, it);
  }
  // Pass 2a: merge established events that share three main words.
  const big = clusters.filter((c) => c.items.length >= 3).sort((a, b) => b.items.length - a.items.length);
  const gone = new Set();
  for (let i = 0; i < big.length; i++) {
    if (gone.has(big[i])) continue;
    for (let j = i + 1; j < big.length; j++) {
      if (gone.has(big[j])) continue;
      if (sharedCount(coreWords(big[i], 0.5), coreWords(big[j], 0.5)) >= 3) {
        for (const it of big[j].items) addTo(big[i], it);
        gone.add(big[j]);
      }
    }
  }
  clusters = clusters.filter((c) => !gone.has(c));
  // Pass 2b: stories left alone or in a pair join an established event they match.
  const established = clusters.filter((c) => c.items.length >= 3);
  const mains = new Map(established.map((c) => [c, coreWords(c, 0.5)]));
  const out = [...established];
  for (const c of clusters) {
    if (c.items.length >= 3) continue;
    const stay = { items: [], df: new Map() };
    for (const it of c.items) {
      let best = null, bestShared = 1;
      for (const e of established) {
        const shared = sharedCount(it.tokens, mains.get(e));
        if (shared > bestShared) { best = e; bestShared = shared; }
      }
      addTo(best || stay, it);
    }
    if (stay.items.length) out.push(stay);
  }
  return out;
}

// One event's heat and the order of its stories.
function scoreCluster(c, nowMs) {
  const seenTitles = new Set();
  let heat = 0;
  const papers = new Set();
  for (const it of c.items) {
    // The same headline filed twice (a live-blog update and its article) counts once.
    const key = String(it.row.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    const age = Math.max(0, nowMs - it.at);
    // Opinion pieces follow the news; they add little to how big it is.
    heat += Math.exp(-age / HEAT_TAU_MS) * (it.row.section === "opinion" ? 0.4 : 1);
    if (it.row.paper) papers.add(it.row.paper);
  }
  const live = c.items.some((it) => isLive(it.row));
  // Breaking: an event with two or more stories whose first one is under six hours
  // old gets a head start, so it can pass a days-old saga with more stories.
  const firstAt = Math.min(...c.items.map((it) => it.at));
  const breaking = seenTitles.size >= 2 ? 1.5 * Math.max(0, 1 - Math.max(0, nowMs - firstAt) / BREAKING_MS) : 0;
  const eventScore = 3 * Math.log2(1 + heat) + (papers.size >= 2 ? 1 : 0) + (live ? 1.5 : 0) + breaking;
  const need = Math.max(1, Math.ceil(c.items.length * 0.3));
  const paperCount = new Map();
  for (const it of c.items) paperCount.set(it.row.paper, (paperCount.get(it.row.paper) || 0) + 1);
  for (const it of c.items) {
    const age = Math.max(0, nowMs - it.at);
    let central = 0;
    for (const t of it.tokens) if ((c.df.get(t) || 0) >= need) central++;
    it.central = central;
    it.score = eventScore
      + (SECTION_PRIOR[it.row.section] ?? 0)
      + 2 * Math.max(0, 1 - age / FRESH_MS)
      + (it.row.lead_at ? 1 : 0);
    // Which story stands for the event: the live blog itself, else its best-scored
    // story (fresh, hard news) that is most about it, from the paper covering it most.
    it.repScore = it.score
      + Math.min(central, 6) * 0.3
      + (paperCount.get(it.row.paper) || 0) / c.items.length
      + (isLive(it.row) && !isLiveUpdate(it.row) ? 3 : 0)
      + (isLiveUpdate(it.row) ? -3 : 0)
      + (it.row.subtitle ? 0 : -0.5);
  }
  c.heat = heat;
  c.papers = papers;
  c.live = live;
  c.eventScore = eventScore;
  c.ranked = [...c.items].sort((a, b) => b.repScore - a.repScore || a.at - b.at);
  c.best = Math.max(...c.items.map((it) => it.score));
}

// rows: the pool (id, url, title, subtitle, paper, section, published_at, lead_at,
// topics). Returns the top stories in display order, each { id, score, heat,
// stories, papers, live }. `isWeak(row)` drops rows whose title is a fragment.
function rankFront(rows, { nowMs = Date.now(), max = TOP_MAX, isWeak = () => false } = {}) {
  const pool = (rows || []).filter((r) => r && r.id && r.title && nowMs - ms(r.published_at) <= POOL_WINDOW_MS && nowMs - ms(r.published_at) > -HOUR_MS && !isWeak(r));
  const clusters = clusterRows(pool);
  for (const c of clusters) scoreCluster(c, nowMs);
  clusters.sort((a, b) => b.best - a.best);
  const top = [];
  const describe = (c, it) => ({ id: it.row.id, score: Math.round(it.score * 100) / 100, heat: Math.round(c.heat * 100) / 100, stories: c.items.length, papers: c.papers.size, live: c.live });
  for (const c of clusters) {
    if (top.length >= max) break;
    const first = c.ranked[0];
    if (first.score < MIN_TOP_SCORE) continue;
    top.push(describe(c, first));
    // A big event also shows another paper's take (the local angle, usually).
    if (c.heat >= BIG_EVENT_HEAT && top.length < max) {
      const second = c.ranked.find((it) => it.row.paper !== first.row.paper && !isLiveUpdate(it.row) && it.row.section !== "opinion");
      if (second) top.push(describe(c, second));
    }
  }
  return top;
}

module.exports = { rankFront, clusterRows, storyTokens, stem, isLive, isLiveUpdate, POOL_WINDOW_MS, TOP_MAX, MIN_TOP_SCORE, SECTION_PRIOR };
