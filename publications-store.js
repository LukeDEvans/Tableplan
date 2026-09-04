// publications-store.js — the relational data-access MAPPING layer (Phase 3 cutover
// slice 1). PURE row⇄model mappers between the snake_case DB columns
// (public.publications / feeds / articles) and the canonical client shapes from
// publications.js. No network here — the thin PostgREST calls live in app.js
// (mirroring the eat_recipes pattern) and use these mappers.
//
// Identity: the DB keys by the SAME string ids the client uses (art_… / pub_… /
// feed_…) — see the ids-to-text migration — so DB identity == client identity and
// no re-keying is needed. One canonical article per group is enforced by the DB's
// unique(group_id, canonical_url). Article BODIES are NOT stored here (content
// store). group_id is injected by the caller (userGroup.id) so RLS passes; it is a
// row-scoping concern, never part of the client model.

import { makeArticle, makePublication, makeFeed } from "./publications.js";

const str = (x) => (x == null ? "" : String(x));
const orNull = (x) => { const s = x == null ? "" : String(x); return s || null; };
const cleanIds = (a) => (Array.isArray(a) ? a.map(str).filter(Boolean) : []);

// ── articles ──────────────────────────────────────────────────────────────────
export function articleToRow(a, groupId) {
  return {
    id: str(a.id),
    group_id: str(groupId),
    publication_id: a.publicationId ? str(a.publicationId) : null,
    feed_ids: cleanIds(a.feedIds),
    guid: orNull(a.guid),
    url: orNull(a.url),
    canonical_url: orNull(a.canonicalUrl),
    title: str(a.title),
    author: orNull(a.author),
    published_at: orNull(a.publishedAt),
    updated_at: orNull(a.updatedAt),
    description: orNull(a.description),
    image_url: orNull(a.imageUrl),
    category: orNull(a.category),
    discovered_at: str(a.discoveredAt) || new Date().toISOString(),
  };
}

export function articleFromRow(row) {
  return makeArticle({
    id: row.id,
    publicationId: row.publication_id,
    feedIds: cleanIds(row.feed_ids),
    guid: row.guid,
    url: row.url,
    canonicalUrl: row.canonical_url, // preserved (never re-derived) — DB is authoritative
    title: row.title,
    author: row.author,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    description: row.description,
    imageUrl: row.image_url,
    category: row.category,
    discoveredAt: row.discovered_at,
  });
}

// ── publications ────────────────────────────────────────────────────────────────
// feedIds live in the feeds table (feeds.publication_id), NOT on the publications
// row — so toRow drops them and fromRow takes them back from the joined feeds.
export function publicationToRow(p, groupId) {
  const pub = makePublication(p);
  return {
    id: str(pub.id),
    group_id: str(groupId),
    name: str(pub.name),
    key: str(pub.key),
    enabled: pub.enabled !== false,
    updated_at: new Date().toISOString(),
  };
}

export function publicationFromRow(row, feedIds = []) {
  return makePublication({
    id: row.id,
    name: row.name,
    key: row.key,
    enabled: row.enabled !== false,
    feedIds: cleanIds(feedIds),
  });
}

// ── feeds ────────────────────────────────────────────────────────────────────────
export function feedToRow(f, groupId) {
  const feed = makeFeed(f);
  return {
    id: str(feed.id),
    group_id: str(groupId),
    publication_id: orNull(feed.publicationId),
    url: str(feed.url),
    title: orNull(feed.title),
    enabled: feed.enabled !== false,
    etag: feed.etag,
    last_modified: feed.lastModified,
    last_fetched_at: feed.lastFetchedAt,
    last_success_at: feed.lastSuccessAt,
    next_fetch_at: feed.nextFetchAt,
    error_count: Number.isInteger(feed.errorCount) ? feed.errorCount : 0,
    last_error: feed.lastError,
    updated_at: new Date().toISOString(),
  };
}

export function feedFromRow(row) {
  return makeFeed({
    id: row.id,
    publicationId: row.publication_id,
    url: row.url,
    title: row.title,
    enabled: row.enabled !== false,
    etag: row.etag,
    lastModified: row.last_modified,
    lastFetchedAt: row.last_fetched_at,
    lastSuccessAt: row.last_success_at,
    nextFetchAt: row.next_fetch_at,
    errorCount: row.error_count,
    lastError: row.last_error,
  });
}

// Assemble the client pubDefs (publications with their feedIds) from the two row
// sets — the read-side join the relational split requires.
export function assemblePublications(pubRows, feedRows) {
  const byPub = new Map();
  for (const f of feedRows || []) {
    const pid = str(f.publication_id);
    if (!pid) continue;
    if (!byPub.has(pid)) byPub.set(pid, []);
    byPub.get(pid).push(str(f.id));
  }
  return (pubRows || []).map((r) => publicationFromRow(r, byPub.get(str(r.id)) || []));
}
