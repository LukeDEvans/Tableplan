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

const DAY_MS = 86_400_000;
const KEEP_DAYS = 3;            // the News window (matches _news-links FRESH_DAYS)
const PRUNE_DAYS = KEEP_DAYS + 1;
const PAGE_MAX = 200;
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
    discovered_at: card.discoveredAt || new Date().toISOString()
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

// PostgREST query string for one page of a view. Pure.
//   view: { kind: "front" | "section" | "paper" | "sent", key }
//   before: ISO published_at cursor (inclusive); q: title search.
function feedQuery(userId, { view = {}, before, q, limit = 150, nowMs = Date.now() } = {}) {
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
  // lte, not lt: stories sharing the boundary timestamp would otherwise be skipped;
  // the client de-duplicates by id.
  if (before) parts.push(`published_at=lte.${enc(before)}`);
  const term = String(q || "").replace(/[%*(),."\\]/g, " ").trim().slice(0, 80);
  if (term) parts.push(`title=ilike.${enc(`*${term}*`)}`);
  parts.push("order=published_at.desc,id.desc");
  parts.push(`limit=${Math.max(1, Math.min(PAGE_MAX, Number(limit) || 150))}`);
  return parts.join("&");
}

// ── Network ──────────────────────────────────────────────────────────────────

async function insertArticles(serviceKey, userId, cards, origin = "email", { fetchImpl = fetch } = {}) {
  const rows = [];
  const seen = new Set();
  for (const c of cards || []) {
    if (!c?.id || !c.url || !c.title || !c.paper || seen.has(c.id)) continue;
    seen.add(c.id);
    rows.push(rowFromCard(userId, c, origin));
  }
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const res = await fetchImpl(`${TABLE}?on_conflict=user_id,id`, {
      method: "POST",
      headers: headers(serviceKey, { prefer: "resolution=ignore-duplicates,return=minimal" }),
      body: JSON.stringify(rows.slice(i, i + INSERT_CHUNK))
    });
    if (!res.ok) throw new Error(`news_articles insert failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  return rows.length;
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
  const { view = {}, before, q, limit = 150, fetchImpl = fetch, nowMs = Date.now() } = opts;
  const rows = await getRows(serviceKey, feedQuery(userId, { view, before, q, limit, nowMs }), { fetchImpl });
  let leads = [];
  if ((view.kind || "front") === "front" && !before && !q) {
    const since = new Date(nowMs - LEAD_WINDOW_MS).toISOString();
    leads = await getRows(serviceKey, [
      `select=${COLUMNS}`, `user_id=eq.${enc(userId)}`, "hidden_at=is.null",
      `lead_at=gte.${enc(since)}`, "order=lead_at.desc", "limit=12"
    ].join("&"), { fetchImpl });
  }
  const byId = new Map();
  for (const r of [...leads, ...rows]) byId.set(r.id, r);
  const capped = Math.max(1, Math.min(PAGE_MAX, Number(limit) || 150));
  return {
    articles: [...byId.values()].map(cardFromRow),
    // A full page means there may be more. A page that didn't move the cursor
    // (all one timestamp) ends paging rather than repeating forever.
    nextBefore: rows.length >= capped && rows[rows.length - 1].published_at !== before ? rows[rows.length - 1].published_at : null
  };
}

// Batched read / unread / send / hide. Send saves to Media first (caller's
// saveToMedia), so a failed save leaves the row un-sent for another try.
async function applyDecisions(serviceKey, userId, decisions, { saveToMedia, fetchImpl = fetch } = {}) {
  const last = new Map(); // id → { read?: bool, send?: true, hide?: true }
  for (const d of decisions || []) {
    if (!d?.id) continue;
    const cur = last.get(d.id) || {};
    if (d.decision === "hide") cur.hide = true;
    else if (d.decision === "send") cur.send = true;
    else if (d.decision === "read" || d.decision === "unread") cur.read = d.decision === "read";
    last.set(d.id, cur);
  }
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
  KEEP_DAYS, PRUNE_DAYS, PAGE_MAX, COLUMNS,
  rowFromCard, cardFromRow, countsFromRows, feedQuery,
  insertArticles, markLeads, loadCounts, loadFeedPage, applyDecisions, pruneArticles
};
