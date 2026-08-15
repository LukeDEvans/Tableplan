// Blob identity & catalog — decouples domain records from any single device's
// IndexedDB key. Scores and recordings are referenced by a stable `blobId`; the
// BlobAsset catalog record carries content identity (sha-256 hash, size, MIME),
// ownership (owned vs cached), provenance, and a list of physical `locations`
// (this device's IndexedDB, an external URL, a future home-server/cloud). This
// is what lets bytes move between devices/backends without rewriting domain data.
//
// availability is DERIVED from locations, never stored authoritatively.

let blobCounter = 0;
export function newBlobId() {
  blobCounter += 1;
  return `blob_${Date.now().toString(36)}${blobCounter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Normalize/build a BlobAsset catalog record.
 *   blobId, hash, size, mimeType, ownership: "owned"|"cache", provenance,
 *   locations: [{kind:"idb", key} | {kind:"url", url} | {kind:"home-server", …}]
 * `availability` is intentionally NOT a stored field.
 */
export function makeBlobAsset(p = {}) {
  return {
    entity: "blobAsset",
    blobId: String(p.blobId || newBlobId()),
    hash: p.hash ? String(p.hash) : null,      // sha-256 hex; content identity
    size: Number.isFinite(p.size) ? Number(p.size) : null,
    mimeType: p.mimeType ? String(p.mimeType) : null,
    ownership: p.ownership === "cache" ? "cache" : "owned",
    locations: Array.isArray(p.locations) ? p.locations.map(normalizeLocation).filter(Boolean) : [],
    provenance: p.provenance && typeof p.provenance === "object" ? p.provenance : {},
    createdAt: p.createdAt ? String(p.createdAt) : new Date().toISOString(),
  };
}

function normalizeLocation(l) {
  if (!l || !l.kind) return null;
  if (l.kind === "idb") return { kind: "idb", key: String(l.key) };
  if (l.kind === "url") return { kind: "url", url: String(l.url) };
  return { ...l, kind: String(l.kind) }; // forward-compat: home-server, cloud, etc.
}

/**
 * DERIVE availability from locations (+ an optional local presence check).
 *   "local"   — bytes are present on this device (a resolvable idb location, verified if a checker is given)
 *   "remote"  — no local bytes, but a fetchable location (url / home-server) exists
 *   "missing" — no resolvable location at all
 * `hasLocalBytes(key)` (optional) lets a caller confirm the idb key actually holds bytes;
 * without it, an idb location is treated as local (catalog-trusted).
 */
export function blobAvailability(asset, hasLocalBytes = null) {
  const locs = asset?.locations || [];
  const idb = locs.find((l) => l.kind === "idb");
  if (idb) {
    if (!hasLocalBytes) return "local";
    return hasLocalBytes(idb.key) ? "local" : (hasRemote(locs) ? "remote" : "missing");
  }
  return hasRemote(locs) ? "remote" : "missing";
}
function hasRemote(locs) { return locs.some((l) => l.kind === "url" || l.kind === "home-server" || l.kind === "cloud"); }

export function addLocation(asset, location) {
  const loc = normalizeLocation(location);
  if (!loc) return asset;
  const exists = asset.locations.some((l) => JSON.stringify(l) === JSON.stringify(loc));
  return exists ? asset : { ...asset, locations: [...asset.locations, loc] };
}

/** sha-256 hex of bytes (ArrayBuffer/Uint8Array). Content identity for dedupe + integrity. */
export async function hashBytes(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
