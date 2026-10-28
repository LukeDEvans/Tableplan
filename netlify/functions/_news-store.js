// News articles store (NEWS_PAGE_DESIGN.md §10): the relational news_articles table
// (migrations/2026-10-06-news-articles.sql). Service-role only — gmail.js reads and
// writes it for the signed-in user; the mail sweep and the hourly news-feeds job
// insert into it.
//
// Egress rules (CLAUDE.md): inserts are ignore-duplicates + return=minimal (no
// response body), the page reads one page of the columns it shows, counts come from
// one small RPC, and read / send / hide PATCH only the rows involved. Nothing here
// loops or polls.
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const TABLE = `${SUPABASE_URL}/rest/v1/news_articles`;
const INTEREST = `${SUPABASE_URL}/rest/v1/news_interest`;
const Rank = require("./_news-rank.js");

const DAY_MS = 86_400_000;
const KEEP_DAYS = 3;            // the News window (matches _news-links FRESH_DAYS)
// Rows (hidden / read / sent state included) outlive the window by a margin: the
// feed job accepts a story while its own pubDate is ≤ KEEP_DAYS+1 days old, and an
// email card's stored date can be up to a day EARLIER than that (URL date at
// midnight UTC). Pruning at +2 means a story's row is never gone while some intake
// would still call it fresh, so hide / read / sent can't be undone by a re-insert.
const PRUNE_DAYS = KEEP_DAYS + 2;
const PAGE_MAX = 200;
// For you (NEWS_RANKING_DESIGN.md): a pool of the person's best-ranked unread
// stories from the last two days is re-scored with their current interests and
// arranged; FORYOU_SHOW of them are returned.
const FORYOU_POOL = 120;
const FORYOU_SHOW = 40;
const FORYOU_WINDOW_MS = 48 * 3_600_000;
const LEAD_WINDOW_MS = 36 * 3_600_000;
const INSERT_CHUNK = 500;

// The columns the page shows. Never `select=*`.
const COLUMNS = "id,url,title,subtitle,image,paper,source,section,published_at,discovered_at,lead_at,read_at,sent_at";

const headers = (serviceKey, extra = {}) => ({
  apikey: serviceKey,
  authorization: `Bearer ${serviceKey}`,
  accept: "application/json",
  "content-type": "application/json",
  ...extra
});
const enc = encodeURIComponent;
const inList = (ids) => `in.(${ids.map((id) => `"${String(id).replace(/["\\]/g, "")}"`).join(",")})`;

// ── Pure mapping (client keeps the card field names it had) ─────────────────

function rowFromCard(userId, card, origin = "email") {
  return {
    user_id: userId,
    id: String(card.id),
    url: String(card.url).slice(0, 1000),
    title: String(card.title || "").slice(0, 300),
    subtitle: card.subtitle ? String(card.subtitle).slice(0, 500) : null,
    image: card.image ? String(card.image).slice(0, 1000) : null,
    paper: card.paper,
    source: card.source ? String(card.source).slice(0, 100) : null,
    section: card.section || "more",
    origin,
    published_at: card.publishedAt || card.discoveredAt || new Date().toISOString(),
    discovered_at: card.discoveredAt || new Date().toISOString(),
    // Only once the For you migration is in (insertArticles is told so).
    ...(Array.isArray(card.topics) ? { topics: card.topics.slice(0, Rank.MAX_TOPICS).map((t) => String(t).slice(0, 80)) } : {}),
    ...(Number.isFinite(card.rankScore) ? { rank_score: card.rankScore } : {})
  };
}

function cardFromRow(r) {
  const c = {
    id: r.id, url: r.url, title: r.title, subtitle: r.subtitle || "", image: r.image || "",
    paper: r.paper, source: r.source || "", section: r.section || "more",
    publishedAt: r.published_at, discoveredAt: r.discovered_at
  };
  if (r.lead_at) c.lead = r.lead_at;
  if (r.read_at) c.readAt = r.read_at;
  if (r.sent_at) c.sentAt = r.sent_at;
  return c;
}

// news_counts rows → { all, sent, section: {s: unread}, paper: {p: unread}, sections: [present] }
// (the same shape news-ui.js unreadCounts produces).
function countsFromRows(rows) {
  const out = { all: 0, sent: 0, section: {}, paper: {}, sections: [] };
  const present = new Set();
  for (const r of rows || []) {
    const unread = Number(r.unread) || 0;
    out.all += unread;
    out.sent += Number(r.sent) || 0;
    if (unread) {
      out.section[r.section] = (out.section[r.section] || 0) + unread;
      out.paper[r.paper] = (out.paper[r.paper] || 0) + unread;
    }
    if (Number(r.total) > 0) present.add(r.section);
  }
  out.sections = [...present];
  return out;
}

const FRONT_PAPER_FILTER = "or(paper.is.null,paper.neq.athletic)";
const ATHLETIC_TAGGED_FILTER = "or(paper.neq.athletic,topics.not.is.null)";

// PostgREST query string for one page of a view. Pure.
//   view: { kind: "front" | "section" | "paper" | "sent", key }
//   before: "<published_at ISO>|<id>" cursor — rows strictly after it in
//   (published_at desc, id desc) order; q: title / summary search.
function feedQuery(userId, { view = {}, before, q, limit = 150, nowMs = Date.now(), athleticTagged = false } = {}) {
  const since = new Date(nowMs - KEEP_DAYS * DAY_MS - DAY_MS).toISOString(); // window incl. the URL-date grace day
  const parts = [
    `select=${COLUMNS}`,
    `user_id=eq.${enc(userId)}`,
    "hidden_at=is.null",
    `published_at=gte.${enc(since)}`
  ];
  if (view.kind === "section" && view.key) parts.push(`section=eq.${enc(view.key)}`);
  if (view.kind === "paper" && view.key) parts.push(`paper=eq.${enc(view.key)}`);
  if (view.kind === "sent") parts.push("sent_at=not.is.null");
  // Cursor and search are both OR groups; one and=(…) param holds them so they
  // combine with AND unambiguously.
  const groups = [];
  // The Front page leaves out The Athletic (Luke, 2026-10-15); it still shows in
  // Sports and under Papers. A story with no paper stays.
  if ((view.kind || "front") === "front") groups.push(FRONT_PAPER_FILTER);
  // The Athletic: only stories matched to a favourite team at intake (they carry
  // topics). Older league-feed stories, stored before For you, have none.
  else if (athleticTagged) groups.push(ATHLETIC_TAGGED_FILTER);
  const cur = parseCursor(before);
  // Keyset on (published_at, id) so stories sharing a timestamp page cleanly.
  if (cur) groups.push(`or(published_at.lt.${cur.at},and(published_at.eq.${cur.at},id.lt.${cur.id}))`);
  const term = searchTerm(q);
  if (term) groups.push(`or(title.ilike."*${term}*",subtitle.ilike."*${term}*")`);
  if (groups.length) parts.push(`and=${enc(`(${groups.join(",")})`)}`);
  parts.push("order=published_at.desc,id.desc");
  parts.push(`limit=${Math.max(1, Math.min(PAGE_MAX, Number(limit) || 150))}`);
  return parts.join("&");
}

// "<ISO>|<id>" → { at, id }, or null. Ids are base-36 hashes; anything else is refused.
function parseCursor(before) {
  const [at, id] = String(before || "").split("|");
  if (!at || Number.isNaN(Date.parse(at)) || !/^[0-9a-z]{1,64}$/.test(id || "")) return null;
  return { at: new Date(at).toISOString(), id };
}
// A search term safe inside a quoted PostgREST filter value: no quotes, backslashes,
// wildcards or list syntax; "U.S." and other punctuation are kept.
function searchTerm(q) {
  return String(q || "").replace(/["\\*%(),]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

// ── Network ──────────────────────────────────────────────────────────────────

// Insert-only (existing rows untouched). With `returnIds`, the response is just
// the ids actually inserted (ON CONFLICT DO NOTHING returns only new rows), which
// is how the feed job knows which stories are new and need tagging. With
// `withTopics` false, topics / rank_score are left out (before the migration).
async function insertArticles(serviceKey, userId, cards, origin = "email", { fetchImpl = fetch, returnIds = false, withTopics = false } = {}) {
  const rows = [];
  const seen = new Set();
  for (const c of cards || []) {
    if (!c?.id || !c.url || !c.title || !c.paper || seen.has(c.id)) continue;
    seen.add(c.id);
    const row = rowFromCard(userId, c, origin);
    if (!withTopics) { delete row.topics; delete row.rank_score; }
    rows.push(row);
  }
  const inserted = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const res = await fetchImpl(`${TABLE}?on_conflict=user_id,id${returnIds ? "&select=id" : ""}`, {
      method: "POST",
      headers: headers(serviceKey, { prefer: `resolution=ignore-duplicates,${returnIds ? "return=representation" : "return=minimal"}` }),
      body: JSON.stringify(rows.slice(i, i + INSERT_CHUNK))
    });
    if (!res.ok) throw new Error(`news_articles insert failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
    if (returnIds) for (const r of await res.json().catch(() => [])) if (r?.id) inserted.push(String(r.id));
  }
  return returnIds ? inserted : rows.length;
}

// Topics + rank for stories just inserted (one request; the full rows are sent
// again because an upsert's insert half needs every required column).
async function setTopics(serviceKey, userId, cards, origin, { fetchImpl = fetch } = {}) {
  const rows = (cards || []).filter((c) => c?.id && Array.isArray(c.topics)).map((c) => rowFromCard(userId, c, origin));
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const res = await fetchImpl(`${TABLE}?on_conflict=user_id,id&columns=user_id,id,url,title,subtitle,image,paper,source,section,origin,published_at,discovered_at,topics,rank_score`, {
      method: "POST",
      headers: headers(serviceKey, { prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(rows.slice(i, i + INSERT_CHUNK).map((r) => ({ ...r, topics: r.topics || [], rank_score: r.rank_score ?? null })))
    });
    if (!res.ok) throw new Error(`news_articles topics update failed (${res.status})`);
  }
  return rows.length;
}

// ── For you: schema probe and interests ─────────────────────────────────────
// The code ships before its migration may be applied. One cheap probe per warm
// function instance (re-tried every 10 minutes while missing) decides whether the
// For you columns and table exist; until they do, everything behaves as before.
let schemaState = { ready: null, at: 0 };
async function forYouReady(serviceKey, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  if (schemaState.ready === true) return true;
  if (schemaState.ready === false && nowMs - schemaState.at < 10 * 60_000) return false;
  let ready = false;
  try {
    const res = await fetchImpl(`${INTEREST}?select=user_id&limit=0`, { headers: headers(serviceKey) });
    ready = !!res.ok;
  } catch { ready = false; }
  schemaState = { ready, at: nowMs };
  return ready;
}
function resetSchemaProbe() { schemaState = { ready: null, at: 0 }; }

const INTEREST_COLS = { teams: "user_id,teams,teams_sig", all: "user_id,teams,teams_sig,weights,muted" };

// One person's interests (normalized; a missing row reads as empty).
async function loadInterest(serviceKey, userId, { cols = "all", fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${INTEREST}?select=${INTEREST_COLS[cols] || INTEREST_COLS.all}&user_id=eq.${enc(userId)}&limit=1`, { headers: headers(serviceKey) });
  if (!res.ok) throw new Error(`news_interest read failed (${res.status})`);
  const rows = await res.json();
  return Rank.normalizeInterest(rows?.[0] || {});
}
// Several people's (the hourly job): Map(userId → interest).
async function loadInterests(serviceKey, userIds, { fetchImpl = fetch } = {}) {
  const out = new Map();
  if (!userIds?.length) return out;
  const res = await fetchImpl(`${INTEREST}?select=${INTEREST_COLS.all}&user_id=${enc(inList(userIds))}`, { headers: headers(serviceKey) });
  if (!res.ok) throw new Error(`news_interest read failed (${res.status})`);
  for (const r of await res.json()) out.set(String(r.user_id), Rank.normalizeInterest(r));
  return out;
}
async function saveInterest(serviceKey, userId, patch, { fetchImpl = fetch } = {}) {
  const body = { user_id: userId, updated_at: new Date().toISOString() };
  if (patch.teams) { body.teams = patch.teams; body.teams_sig = Rank.teamsSignature(patch.teams); }
  if (patch.weights) body.weights = patch.weights;
  if (patch.muted) body.muted = patch.muted;
  const res = await fetchImpl(`${INTEREST}?on_conflict=user_id`, {
    method: "POST",
    headers: headers(serviceKey, { prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`news_interest write failed (${res.status})`);
}

// The For you pool: unread, unhidden, unsaved stories from the last two days, best
// stored rank first, plus the recent newsletter leads (email stories carry no
// stored rank). Topics come along for re-scoring; they're stripped before replying.
function forYouQuery(userId, { nowMs = Date.now() } = {}) {
  const since = new Date(nowMs - FORYOU_WINDOW_MS).toISOString();
  return [
    `select=${COLUMNS},topics,rank_score`, `user_id=eq.${enc(userId)}`,
    "hidden_at=is.null", "read_at=is.null", "sent_at=is.null", `published_at=gte.${enc(since)}`,
    `skips=lt.${Rank.SKIP_LIMIT}`,
    `and=${enc(`(${ATHLETIC_TAGGED_FILTER})`)}`,
    "order=rank_score.desc.nullslast,published_at.desc", `limit=${FORYOU_POOL}`
  ].join("&");
}

// Pool rows → the For you page: re-scored with current interests, muted stories
// dropped, arranged (diversity + exploration), each with a short `why`.
function arrangeForYouRows(rows, interest, { nowMs = Date.now(), rng = Math.random, limit = FORYOU_SHOW } = {}) {
  const scored = [];
  const seen = new Set();
  for (const r of rows || []) {
    if (!r?.id || seen.has(r.id)) continue;
    seen.add(r.id);
    const features = Array.isArray(r.topics) && r.topics.length ? r.topics : Rank.storyFeatures(cardFromRow(r));
    const score = Rank.scoreStory(features, interest, { nowMs, publishedAt: r.published_at, leadAt: r.lead_at });
    if (score == null) continue;
    scored.push({ id: r.id, section: r.section, features, score, publishedAt: r.published_at, row: r });
  }
  return Rank.arrangeForYou(scored, interest, { limit, nowMs, rng }).map((x) => {
    const c = cardFromRow(x.row);
    const why = x.explore ? "Something different" : Rank.whyLabel(x.features, interest, nowMs);
    if (why) c.why = why;
    return c;
  });
}

async function loadForYou(serviceKey, userId, interest, { fetchImpl = fetch, nowMs = Date.now(), rng } = {}) {
  const since = new Date(nowMs - LEAD_WINDOW_MS).toISOString();
  const [pool, leads] = await Promise.all([
    getRows(serviceKey, forYouQuery(userId, { nowMs }), { fetchImpl }),
    getRows(serviceKey, [
      `select=${COLUMNS},topics,rank_score`, `user_id=eq.${enc(userId)}`, "hidden_at=is.null", "read_at=is.null", "sent_at=is.null",
      `skips=lt.${Rank.SKIP_LIMIT}`, `lead_at=gte.${enc(since)}`, "order=lead_at.desc", "limit=12"
    ].join("&"), { fetchImpl })
  ]);
  return { articles: arrangeForYouRows([...pool, ...leads], interest, { nowMs, rng }), nextBefore: null };
}

async function patchRows(serviceKey, userId, ids, body, extraFilter = "", { fetchImpl = fetch } = {}) {
  if (!ids.length) return;
  const res = await fetchImpl(`${TABLE}?user_id=eq.${enc(userId)}&id=${enc(inList(ids))}${extraFilter}`, {
    method: "PATCH",
    headers: headers(serviceKey, { prefer: "return=minimal" }),
    body: JSON.stringify({ ...body, updated_at: new Date().toISOString() })
  });
  if (!res.ok) throw new Error(`news_articles update failed (${res.status})`);
}

async function markLeads(serviceKey, userId, ids, iso = new Date().toISOString(), opts) {
  await patchRows(serviceKey, userId, [...new Set(ids)].filter(Boolean), { lead_at: iso }, "", opts);
}

async function getRows(serviceKey, query, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${TABLE}?${query}`, { headers: headers(serviceKey) });
  if (!res.ok) throw new Error(`news_articles read failed (${res.status})`);
  return res.json();
}

async function loadCounts(serviceKey, userId, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const res = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/news_counts`, {
    method: "POST",
    headers: headers(serviceKey),
    body: JSON.stringify({ p_user: userId, p_since: new Date(nowMs - KEEP_DAYS * DAY_MS - DAY_MS).toISOString() })
  });
  if (!res.ok) throw new Error(`news_counts failed (${res.status})`);
  return countsFromRows(await res.json());
}

// One page of a view (+ on the first Front page, the recent newsletter leads so
// they can lead even when older than the newest page).
async function loadFeedPage(serviceKey, userId, opts = {}) {
  const { view = {}, before, q, limit = 150, fetchImpl = fetch, nowMs = Date.now(), athleticTagged = false } = opts;
  const rows = await getRows(serviceKey, feedQuery(userId, { view, before, q, limit, nowMs, athleticTagged }), { fetchImpl });
  let leads = [];
  if ((view.kind || "front") === "front" && !before && !q) {
    const since = new Date(nowMs - LEAD_WINDOW_MS).toISOString();
    leads = await getRows(serviceKey, [
      `select=${COLUMNS}`, `user_id=eq.${enc(userId)}`, "hidden_at=is.null",
      `lead_at=gte.${enc(since)}`, `and=${enc(`(${FRONT_PAPER_FILTER})`)}`, "order=lead_at.desc", "limit=12"
    ].join("&"), { fetchImpl });
  }
  const byId = new Map();
  for (const r of [...leads, ...rows]) byId.set(r.id, r);
  const capped = Math.max(1, Math.min(PAGE_MAX, Number(limit) || 150));
  return {
    articles: [...byId.values()].map(cardFromRow),
    // A full page means there may be more; the cursor is the last row's (time, id).
    nextBefore: rows.length >= capped ? `${rows[rows.length - 1].published_at}|${rows[rows.length - 1].id}` : null
  };
}

// Batched read / unread / send / hide. Send saves to Media first (caller's
// saveToMedia), so a failed save leaves the row un-sent for another try.
async function applyDecisions(serviceKey, userId, decisions, { saveToMedia, fetchImpl = fetch, learn = false } = {}) {
  const last = new Map(); // id → { read?: bool, send?: true, hide?: true }
  for (const d of decisions || []) {
    if (!d?.id) continue;
    const cur = last.get(d.id) || {};
    if (d.decision === "hide") cur.hide = true;
    else if (d.decision === "send") cur.send = true;
    else if (d.decision === "read" || d.decision === "unread" || d.decision === "listen") cur.read = d.decision !== "unread";
    last.set(d.id, cur);
  }
  // For you: what each decision teaches (before the rows change).
  const learned = learn ? await learnFromDecisions(serviceKey, userId, decisions, { fetchImpl }) : [];
  const now = new Date().toISOString();
  const ids = (pred) => [...last].filter(([, v]) => pred(v)).map(([id]) => id);
  const sendIds = ids((v) => v.send && !v.hide);
  if (sendIds.length) {
    const rows = await getRows(serviceKey, `select=${COLUMNS}&user_id=eq.${enc(userId)}&id=${enc(inList(sendIds))}&sent_at=is.null`, { fetchImpl });
    for (const r of rows) await saveToMedia(acceptedArticleRecord(cardFromRow(r)));
    await patchRows(serviceKey, userId, rows.map((r) => r.id), { sent_at: now }, "", { fetchImpl });
  }
  await patchRows(serviceKey, userId, ids((v) => v.read === true && !v.hide), { read_at: now }, "&read_at=is.null", { fetchImpl });
  await patchRows(serviceKey, userId, ids((v) => v.read === false && !v.hide), { read_at: null }, "", { fetchImpl });
  await patchRows(serviceKey, userId, ids((v) => v.hide), { hidden_at: now }, "", { fetchImpl });
  return { learned };
}

// Feedback → the person's weights and mutes. Reads the decided stories' topics
// (or works them out from the headline for stories stored without), applies the
// deltas, saves once. Returns [{ id, decision, label }] for the app's toasts.
const LEARNING = new Set(["read", "listen", "send", "hide", "more", "less", "mute", "skip"]);
async function learnFromDecisions(serviceKey, userId, decisions, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const items = (decisions || []).filter((d) => d?.id && LEARNING.has(d.decision));
  if (!items.length) return [];
  const ids = [...new Set(items.map((d) => d.id))];
  const [rows, interest] = await Promise.all([
    getRows(serviceKey, `select=id,title,subtitle,paper,section,topics,skips&user_id=eq.${enc(userId)}&id=${enc(inList(ids))}`, { fetchImpl }),
    loadInterest(serviceKey, userId, { fetchImpl })
  ]);
  const featuresOf = new Map(rows.map((r) => [r.id, Array.isArray(r.topics) && r.topics.length ? r.topics : Rank.storyFeatures(cardFromRow(r))]));
  const skipsOf = new Map(rows.map((r) => [r.id, Number(r.skips) || 0]));
  const feedback = [];
  let muted = interest.muted;
  const learned = [];
  const skipped = new Map(); // new skip count → [ids]
  const skipSeen = new Set();
  for (const d of items) {
    const features = featuresOf.get(d.id);
    if (!features) continue;
    if (d.decision === "skip") {
      // Counted once per visit (the app sends at most one skip per story per
      // visit); teaches only on reaching the limit, when the story also leaves For you.
      if (skipSeen.has(d.id)) continue;
      skipSeen.add(d.id);
      const next = (skipsOf.get(d.id) || 0) + 1;
      skipsOf.set(d.id, next);
      skipped.set(next, [...(skipped.get(next) || []), d.id]);
      if (next === Rank.SKIP_LIMIT) feedback.push({ decision: "skip", features });
      continue;
    }
    if (d.decision === "mute") {
      const f = Rank.primaryFeature(features);
      if (f) { muted = Rank.addMute(muted, f, nowMs); learned.push({ id: d.id, decision: "mute", label: Rank.featureLabel(f, interest) }); }
      continue;
    }
    feedback.push({ decision: d.decision, features });
    if (d.decision === "more" || d.decision === "less") {
      const f = Rank.primaryFeature(features);
      learned.push({ id: d.id, decision: d.decision, label: f ? Rank.featureLabel(f, interest) : "" });
    }
  }
  for (const [count, ids] of skipped) await patchRows(serviceKey, userId, ids, { skips: Math.min(count, 99) }, "", { fetchImpl });
  if (feedback.length || muted !== interest.muted) {
    const weights = Rank.applyFeedback(interest.weights, feedback, nowMs);
    await saveInterest(serviceKey, userId, { weights, muted }, { fetchImpl });
  }
  return learned;
}

// Drop everything past the window, hidden tombstones included (by then the 3-day
// freshness cutoff keeps the article from ever being collected again).
async function pruneArticles(serviceKey, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const cutoff = new Date(nowMs - PRUNE_DAYS * DAY_MS).toISOString();
  const res = await fetchImpl(`${TABLE}?published_at=lt.${enc(cutoff)}`, {
    method: "DELETE", headers: headers(serviceKey, { prefer: "return=minimal" })
  });
  if (!res.ok) throw new Error(`news_articles prune failed (${res.status})`);
}

function acceptedArticleRecord(card, nowIso) {
  return require("./_news-links.js").acceptedArticleRecord(card, nowIso);
}

module.exports = {
  KEEP_DAYS, PRUNE_DAYS, PAGE_MAX, COLUMNS, FORYOU_SHOW,
  rowFromCard, cardFromRow, countsFromRows, feedQuery, parseCursor, searchTerm, forYouQuery, arrangeForYouRows,
  insertArticles, setTopics, markLeads, loadCounts, loadFeedPage, loadForYou, applyDecisions, learnFromDecisions, pruneArticles,
  forYouReady, resetSchemaProbe, loadInterest, loadInterests, saveInterest
};
