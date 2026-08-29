// ContentStore — a thin composition over a StoragePort (local IndexedDB) + an
// injected cloud blob client (durable backstop) + the BlobAsset catalog. It
// formalizes the layered read path that domains use for large content:
//
//     get content
//        ↓
//     local IndexedDB
//        ↓ (miss)
//     remote durable Storage  → rehydrate local
//        ↓ (miss / unavailable)
//     typed error (domain decides whether to provider-refetch)
//
// This is the domain-neutral seam a domain adopts. The domain owns identity
// (blobId or a logical "article:123" key), the catalog record's placement in its
// own state, and any provider re-fetch/reconstruction. The ContentStore owns
// only the movement of bytes between local and durable storage.
//
// WHAT IT OWNS:  local byte persistence, sha-256 identity, ownership metadata,
//                cloud upload/download, local↔remote availability resolution.
// WHAT IT DOESN'T: what the bytes MEAN (article vs score vs audio), when to
//                fetch/purge, provider reconstruction, sync of metadata (that
//                rides the existing state-section system, never this store).
//
// Cadence composes these same primitives inline today and continues to; this
// composition is the reusable form the first new consumer (Media) will use.

import { hashBytes, makeBlobAsset, addLocation, blobAvailability } from "./blob.js";
import { uploadBlob, downloadBlob, cloudLocation } from "./cloud-blob.js";

const byteLength = (b) => (b && (b.byteLength ?? b.length)) || 0;

/**
 * @param storage      a StoragePort (createIdbStorage / createMemoryStorage)
 * @param cloudClient  an injected Supabase-Storage-shaped client (or null → local-only)
 * @param bucket       the private bucket for this domain's content (required if cloudClient)
 * @param userId       path scope for content-addressed cloud objects
 * @param bytesStore   the StoragePort store name holding raw bytes (default "bytes")
 */
export function createContentStore({ storage, cloudClient = null, bucket = null, userId = "personal", bytesStore = "bytes" }) {
  if (!storage) throw new Error("content-store: a StoragePort is required");

  return {
    /**
     * Store bytes locally (always) and, when a cloud backstop is configured, upload
     * to it (idempotent, content-addressed). Returns the BlobAsset catalog record the
     * domain persists in its own metadata. An offline/failed upload keeps the local
     * copy and simply omits the cloud location — it can be re-uploaded later.
     */
    async putBytes(blobId, bytes, { mimeType = null, ownership = "owned" } = {}) {
      await storage.put(bytesStore, blobId, bytes);
      const hash = await hashBytes(bytes);
      let asset = makeBlobAsset({
        blobId, hash, size: byteLength(bytes), mimeType, ownership,
        locations: [{ kind: "idb", key: blobId }],
      });
      if (cloudClient && bucket) {
        try {
          const { path } = await uploadBlob(cloudClient, { userId, hash, bytes, mimeType, bucket });
          asset = addLocation(asset, cloudLocation({ bucket, path }));
        } catch { /* backstop unavailable (offline / transient) — local stands; retry later */ }
      }
      return asset;
    },

    /** Local-only read. Returns the stored bytes or undefined (no network). */
    async getBytes(blobId) { return storage.get(bytesStore, blobId); },

    async has(blobId) { return storage.has(bytesStore, blobId); },

    async delete(blobId) { await storage.delete(bytesStore, blobId); },

    /**
     * Layered read: local → remote (rehydrating local) → typed error. Throws:
     *   code "missing"           — no local bytes and no remote location on the asset
     *   code "remote-unavailable"— a remote location exists but no cloud client is configured
     * Genuine download errors (network / permission / corrupt) propagate as-is so a
     * caller never mistakes an auth failure for "not found".
     */
    async ensureAvailable(asset) {
      const blobId = asset?.blobId;
      const local = blobId ? await storage.get(bytesStore, blobId) : undefined;
      if (local !== undefined) return local;
      const cloud = (asset?.locations || []).find((l) => l.kind === "cloud");
      if (!cloud) { const e = new Error("content-store: no local bytes and no remote location"); e.code = "missing"; throw e; }
      if (!cloudClient) { const e = new Error("content-store: a remote location exists but no cloud client is configured"); e.code = "remote-unavailable"; throw e; }
      const bytes = await downloadBlob(cloudClient, { bucket: cloud.bucket, path: cloud.path });
      if (blobId) await storage.put(bytesStore, blobId, bytes); // rehydrate local
      return bytes;
    },

    /** Availability projection for an asset (local / remote / missing). Verifies
     *  local bytes actually exist (a catalog idb location alone is not "local"). */
    async availability(asset) {
      const idbKey = (asset?.locations || []).find((l) => l.kind === "idb")?.key || asset?.blobId;
      const localPresent = idbKey ? await storage.has(bytesStore, idbKey) : false;
      return blobAvailability(asset, () => localPresent);
    },

    /** Drop the local copy of evictable (cache) content; owned content is preserved. */
    async evictIfCache(asset) {
      if (asset?.ownership === "cache" && asset.blobId) { await storage.delete(bytesStore, asset.blobId); return true; }
      return false;
    },
  };
}
