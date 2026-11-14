// Outside signals for the Front page (NEWS_FRONT_PAGE_DESIGN.md §9).
//
// The BBC's and the AP's top-story headlines are read as a measure of how big a
// story is — never shown, never stored as articles (Luke, 2026-11-14: "just for
// signaling, not stories"). They live in one small row, `news_signals` in
// tableplan_states (a sibling of `newsfeeds_status`: a server-only row, not a
// user's state), rewritten whole by the hourly job and by the check that runs
// when News opens. The row also carries `checkedAt`, which is what spaces those
// checks out.
//
// Egress: the row is ~10 KB (≤ 90 headlines). It is read at most once a minute
// per warm function (the Front page ranking and the open-check share the copy).
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const ROW_ID = "news_signals";
const ROW = `${SUPABASE_URL}/rest/v1/tableplan_states`;

const HOUR_MS = 3_600_000;
const SIGNAL_WINDOW_MS = 24 * HOUR_MS;
const MAX_SIGNALS = 90;
const CACHE_MS = 60_000;

// `ordered`: the feed lists stories in the order of the outlet's own front page,
// so an item's position says how prominent the story is there. The AP's own
// apnews.com feeds stopped in 2024; its verified Flipboard account's feed links to
// apnews.com and lists the latest additions (not ordered by prominence).
const SIGNAL_FEEDS = [
  { source: "bbc", url: "https://feeds.bbci.co.uk/news/rss.xml", ordered: true },
  { source: "bbc", url: "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml", ordered: false },
  { source: "ap", url: "https://flipboard.com/@associatedpress/top-stories-u7govdf1z.rss", ordered: false }
];

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Parsed feed items (title, description, publishedAt) of one signal feed → signals.
// Pure. An item with no date counts as seen now.
function signalsFromItems(items, feed, nowMs = Date.now()) {
  const out = [];
  (items || []).forEach((it, i) => {
    const t = String(it?.title || "").trim().slice(0, 160);
    if (t.split(/\s+/).length < 3) return;
    const parsed = Date.parse(it.publishedAt || "");
    const at = Number.isNaN(parsed) ? nowMs : Math.min(parsed, nowMs);
    if (nowMs - at > SIGNAL_WINDOW_MS) return;
    const sig = { s: feed.source, t, at: new Date(at).toISOString() };
    const d = String(it.description || "").trim().slice(0, 140);
    if (d && d !== t) sig.d = d;
    if (feed.ordered) sig.pos = i;
    out.push(sig);
  });
  return out;
}

// One list for the row: a headline once per source (its best position kept),
// newest first, capped. Pure.
function mergeSignals(lists, nowMs = Date.now()) {
  const byKey = new Map();
  for (const sig of (lists || []).flat()) {
    if (!sig?.t || !sig.s) continue;
    if (nowMs - Date.parse(sig.at || "") > SIGNAL_WINDOW_MS) continue;
    const key = `${sig.s}|${norm(sig.t)}`;
    const cur = byKey.get(key);
    if (!cur) { byKey.set(key, { ...sig }); continue; }
    if (Number.isInteger(sig.pos) && (!Number.isInteger(cur.pos) || sig.pos < cur.pos)) cur.pos = sig.pos;
  }
  return [...byKey.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.t < b.t ? -1 : 1)).slice(0, MAX_SIGNALS);
}

// Signals → rows shaped like the Front page pool's, for _news-front.js. Pure.
function signalRows(signals, nowMs = Date.now()) {
  return (signals || [])
    .filter((s) => s?.t && s.s && nowMs - Date.parse(s.at || "") <= SIGNAL_WINDOW_MS)
    .map((s, i) => ({ id: `signal:${s.s}:${i}`, signal: true, title: s.t, subtitle: s.d || "", paper: s.s, url: "", published_at: s.at, ...(Number.isInteger(s.pos) ? { pos: s.pos } : {}) }));
}

const headers = (serviceKey, extra = {}) => ({ apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json", "content-type": "application/json", ...extra });

let cache = null; // { at, row }
const resetSignalsCache = () => { cache = null; };

// The row: { checkedAt, items }. {} when it doesn't exist yet or can't be read
// (the ranking then simply runs without outside signals).
async function loadSignalsRow(serviceKey, { fetchImpl = fetch, nowMs = Date.now(), maxAgeMs = CACHE_MS } = {}) {
  if (cache && nowMs >= cache.at && nowMs - cache.at <= maxAgeMs) return cache.row;
  let row = {};
  try {
    const res = await fetchImpl(`${ROW}?id=eq.${ROW_ID}&select=state`, { headers: headers(serviceKey) });
    if (res.ok) row = (await res.json())?.[0]?.state || {};
  } catch { /* no signals this time */ }
  cache = { at: nowMs, row };
  return row;
}

// Rewrite the row. `items` omitted (a feed run that got nothing) keeps the
// previous headlines and only moves `checkedAt`.
async function saveSignalsRow(serviceKey, { items, checkedAt, previous = {} }, { fetchImpl = fetch } = {}) {
  const state = { checkedAt, items: Array.isArray(items) && items.length ? items : (previous.items || []) };
  cache = { at: Date.parse(checkedAt) || Date.now(), row: state };
  const res = await fetchImpl(`${ROW}?on_conflict=id`, {
    method: "POST",
    headers: headers(serviceKey, { prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ id: ROW_ID, state, updated_at: checkedAt })
  });
  if (!res.ok) throw new Error(`news_signals write failed (${res.status})`);
  return state;
}

module.exports = {
  ROW_ID, SIGNAL_FEEDS, SIGNAL_WINDOW_MS, MAX_SIGNALS,
  signalsFromItems, mergeSignals, signalRows, loadSignalsRow, saveSignalsRow, resetSignalsCache
};
