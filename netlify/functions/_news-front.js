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
const SIGNAL_WEIGHT = 0.75;            // an outside headline counts this much of a story toward heat
const SIGNAL_MAX = 3;                  // …and at most this many of them per event
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
  // Outside signals (the BBC's and AP's top headlines, _news-signals.js): they are
  // never shown, but an event they also carry is bigger. The newest few count
  // toward heat, each outlet counts as a paper, and a place near the top of an
  // outlet's own front page adds up to 1.5.
  const outside = c.items.filter((it) => it.row.signal).sort((a, b) => b.at - a.at);
  const outlets = new Set(outside.map((it) => it.row.paper));
  for (const it of outside.slice(0, SIGNAL_MAX)) heat += SIGNAL_WEIGHT * Math.exp(-Math.max(0, nowMs - it.at) / HEAT_TAU_MS);
  const bestPos = Math.min(...outside.map((it) => (Number.isInteger(it.row.pos) ? it.row.pos : Infinity)));
  const prominence = bestPos <= 2 ? 1.5 : bestPos <= 7 ? 0.75 : 0;
  for (const it of c.items) {
    if (it.row.signal) continue;
    // The same headline filed twice (a live-blog update and its article) counts once.
    const key = String(it.row.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    const age = Math.max(0, nowMs - it.at);
    // Opinion pieces follow the news; they add little to how big it is.
    heat += Math.exp(-age / HEAT_TAU_MS) * (it.row.section === "opinion" ? 0.4 : 1);
    if (it.row.paper) papers.add(it.row.paper);
  }
  const live = c.items.some((it) => !it.row.signal && isLive(it.row));
  // Breaking: an event with two or more stories whose first one is under six hours
  // old gets a head start, so it can pass a days-old saga with more stories.
  const firstAt = Math.min(...c.items.map((it) => it.at));
  const breaking = seenTitles.size + outlets.size >= 2 ? 1.5 * Math.max(0, 1 - Math.max(0, nowMs - firstAt) / BREAKING_MS) : 0;
  const eventScore = 3 * Math.log2(1 + heat) + (papers.size + outlets.size >= 2 ? 1 : 0) + (live ? 1.5 : 0) + breaking + prominence;
  const need = Math.max(1, Math.ceil(c.items.length * 0.3));
  const stories = c.items.filter((it) => !it.row.signal);
  const paperCount = new Map();
  for (const it of stories) paperCount.set(it.row.paper, (paperCount.get(it.row.paper) || 0) + 1);
  for (const it of stories) {
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
      + (paperCount.get(it.row.paper) || 0) / stories.length
      + (isLive(it.row) && !isLiveUpdate(it.row) ? 3 : 0)
      + (isLiveUpdate(it.row) ? -3 : 0)
      + (it.row.subtitle ? 0 : -0.5);
  }
  c.heat = heat;
  c.papers = papers;
  c.outlets = outlets;
  c.stories = stories;
  c.live = live;
  c.eventScore = eventScore;
  c.ranked = [...stories].sort((a, b) => b.repScore - a.repScore || a.at - b.at);
  c.best = Math.max(...stories.map((it) => it.score));
}

// rows: the pool (id, url, title, subtitle, paper, section, published_at, lead_at,
// topics). Returns the top stories in display order, each { id, score, heat,
// stories, papers, outside, live }. `isWeak(row)` drops rows whose title is a
// fragment. `signals`: outside headlines as rows marked `signal: true`
// (_news-signals.js signalRows) — they shape the events' scores and are never returned.
function rankFront(rows, { nowMs = Date.now(), max = TOP_MAX, isWeak = () => false, signals = [] } = {}) {
  const inWindow = (r) => nowMs - ms(r.published_at) <= POOL_WINDOW_MS && nowMs - ms(r.published_at) > -HOUR_MS;
  const pool = (rows || []).filter((r) => r && r.id && r.title && !r.signal && inWindow(r) && !isWeak(r));
  const extra = (signals || []).filter((r) => r && r.signal && r.title && inWindow(r));
  // An event nobody we carry has written about has nothing to show.
  const clusters = clusterRows([...pool, ...extra]).filter((c) => c.items.some((it) => !it.row.signal));
  for (const c of clusters) scoreCluster(c, nowMs);
  clusters.sort((a, b) => b.best - a.best);
  const top = [];
  const describe = (c, it) => ({ id: it.row.id, score: Math.round(it.score * 100) / 100, heat: Math.round(c.heat * 100) / 100, stories: c.stories.length, papers: c.papers.size, outside: c.outlets.size, live: c.live });
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

// ── The blended Front page (Luke, 2026-11-20) ────────────────────────────────
// Top stories stay chosen by importance (the bar above), with three personal
// touches; everything below them is ordered by _news-store.js using `importance`.
//   - Angle: within an event, among stories nearly as good as its best (and never
//     a live-blog update, or opinion unless the best is), the one the person's
//     interests favour stands for it. A live blog itself always stands for its event.
//   - Lift: up to LIFT_MAX stories just under the bar whose interest is strong
//     join the block after the must-reads, marked `lifted`. In a full block a lift
//     replaces the weakest must-read only if that one barely cleared the bar.
//   - Muted: an event whose stories are all muted leaves the block unless it is
//     big (heat ≥ BIG_EVENT_HEAT) — real news still leads.
const LIFT_RANGE = 1.5;     // how far under MIN_TOP_SCORE a story may be lifted from
const LIFT_INTEREST = 3;    // the interest it needs (a favourite team alone is 4)
const LIFT_MAX = 2;
const ANGLE_RANGE = 1;      // how close to the event's best story an angle must be
const MARGINAL = 1;         // a must-read this close over the bar can give way to a lift

// rows / opts as rankFront, plus interestOf(row) → number and isMuted(row) → bool.
// Returns { top: [{ id, score, heat, …, lifted }], importance: Map(id → { event,
// prior, cluster, top }) } — `importance` for every story in the 24 h pool.
function rankFrontFor(rows, { nowMs = Date.now(), max = TOP_MAX, isWeak = () => false, signals = [], interestOf = () => 0, isMuted = () => false } = {}) {
  const inWindow = (r) => nowMs - ms(r.published_at) <= POOL_WINDOW_MS && nowMs - ms(r.published_at) > -HOUR_MS;
  const pool = (rows || []).filter((r) => r && r.id && r.title && !r.signal && inWindow(r) && !isWeak(r));
  const extra = (signals || []).filter((r) => r && r.signal && r.title && inWindow(r));
  const clusters = clusterRows([...pool, ...extra]).filter((c) => c.items.some((it) => !it.row.signal));
  for (const c of clusters) scoreCluster(c, nowMs);
  clusters.sort((a, b) => b.best - a.best);
  const interest = new Map();
  const interestOfRow = (row) => { if (!interest.has(row.id)) interest.set(row.id, Number(interestOf(row)) || 0); return interest.get(row.id); };
  const big = (c) => c.heat >= BIG_EVENT_HEAT;
  // The story that stands for an event, or null (all muted in a small event).
  const pickRep = (c, skip = () => false) => {
    const cands = c.ranked.filter((it) => !skip(it) && (big(c) || !isMuted(it.row)));
    const best = cands[0];
    if (!best) return null;
    if (isLive(best.row) && !isLiveUpdate(best.row)) return best;
    let pick = best;
    for (const it of cands) {
      if (best.repScore - it.repScore > ANGLE_RANGE) break;
      if (isLiveUpdate(it.row) || (it.row.section === "opinion" && best.row.section !== "opinion")) continue;
      if (interestOfRow(it.row) > interestOfRow(pick.row) + 0.25) pick = it;
    }
    return pick;
  };
  const describe = (c, it, lifted = false) => ({ id: it.row.id, score: Math.round(it.score * 100) / 100, heat: Math.round(c.heat * 100) / 100, stories: c.stories.length, papers: c.papers.size, outside: c.outlets.size, live: c.live, lifted });
  const top = [];
  const inTop = new Set();
  for (const c of clusters) {
    if (top.length >= max) break;
    if (c.ranked[0].score < MIN_TOP_SCORE) continue;
    const first = pickRep(c);
    if (!first) continue;
    top.push(describe(c, first));
    inTop.add(c);
    if (big(c) && top.length < max) {
      const second = c.ranked.find((it) => it !== first && it.row.paper !== first.row.paper && !isLiveUpdate(it.row) && it.row.section !== "opinion");
      if (second) top.push(describe(c, second));
    }
  }
  // Lift: near-misses the person cares about, best first.
  const lifts = [];
  for (const c of clusters) {
    if (inTop.has(c)) continue;
    const s = c.ranked[0].score;
    if (s >= MIN_TOP_SCORE || s < MIN_TOP_SCORE - LIFT_RANGE) continue;
    const rep = pickRep(c);
    if (!rep || isMuted(rep.row) || interestOfRow(rep.row) < LIFT_INTEREST) continue;
    lifts.push({ c, rep, by: rep.score + 0.25 * interestOfRow(rep.row) });
  }
  lifts.sort((a, b) => b.by - a.by);
  for (const l of lifts.slice(0, LIFT_MAX)) {
    if (top.length >= max) {
      // A full block: a lift may take the place of the weakest marginal must-read
      // (under MARGINAL, not part of a big event) — never of real news.
      let k = -1;
      for (let i = top.length - 1; i >= 0; i--) {
        if (!top[i].lifted && top[i].score < MIN_TOP_SCORE + MARGINAL && top[i].heat < BIG_EVENT_HEAT) { k = i; break; }
      }
      if (k < 0) break;
      const [gone] = top.splice(k, 1);
      for (const c of clusters) if (c.stories.some((it) => it.row.id === gone.id) && !top.some((t) => c.stories.some((it) => it.row.id === t.id))) inTop.delete(c);
    }
    top.push(describe(l.c, l.rep, true));
    inTop.add(l.c);
  }
  const importance = new Map();
  clusters.forEach((c, i) => {
    for (const it of c.stories) importance.set(it.row.id, { event: c.eventScore, prior: SECTION_PRIOR[it.row.section] ?? 0, cluster: i, top: inTop.has(c) });
  });
  return { top, importance };
}

module.exports = { rankFront, rankFrontFor, LIFT_RANGE, LIFT_INTEREST, LIFT_MAX, BIG_EVENT_HEAT, clusterRows, storyTokens, stem, isLive, isLiveUpdate, POOL_WINDOW_MS, TOP_MAX, MIN_TOP_SCORE, SECTION_PRIOR };
