// scan-content.js — the SOURCE-IMAGE adapter for scanned documents (receipts today;
// recipes/articles later) over the shared ContentStore. Scan images are large binary
// bytes that must never ride the synced JSONB state — they live in the content store
// (local IndexedDB + the durable backstop), keyed by the owning record's id, while the
// small `imageRefs` metadata stays on the receipt record.
//
// Reuses the existing "reading" IndexedDB + "reading-content" bucket (a generic
// content-bytes store) rather than provisioning a new bucket: blobs are content-
// addressed by hash under the user's path, so receipt images coexist safely with
// article bodies, and the existing sign-out purge of the "reading" DB
// (purgeLocalArticleContent) already drops these local copies — satisfying the
// "purge local on sign-out; cloud backstop RLS-scoped" retention decision for free.
//
// Pure over injected deps (storage + cloudClient), so it unit-tests against the
// memory StoragePort with no real Supabase.

import { createContentStore } from "./content-store/content-store.js";
import { READING_CONTENT_BUCKET } from "./media-content.js";

// Distinct blobId namespace so scan images never collide with article bodies
// (which use "article:<id>") in the shared bytes store.
const scanBlobId = (recordId, index) => `receipt:${recordId}:${index}`;

export function createScanImages({ storage, cloudClient = null, userId = "personal" }) {
  const store = createContentStore({
    storage,
    cloudClient,
    bucket: cloudClient ? READING_CONTENT_BUCKET : null,
    userId,
    bytesStore: "bytes",
  });

  return {
    store,

    // Store one prepared scan image locally (always) + in the backstop (when a cloud
    // client is configured). Returns the small `ref` to persist on the receipt so
    // another device can fetch it later — or null when there's nothing to store.
    async saveImage(recordId, index, bytes, mimeType = "image/jpeg") {
      if (!recordId || !bytes || !bytes.length) return null;
      const asset = await store.putBytes(scanBlobId(recordId, index), bytes, { mimeType, ownership: "owned" });
      const cloud = (asset.locations || []).find((l) => l.kind === "cloud");
      return { index, hash: asset.hash, size: asset.size, mimeType, cloud: cloud ? { bucket: cloud.bucket, path: cloud.path } : null };
    },

    // Layered read: local IndexedDB → durable backstop (via the saved ref). Returns
    // raw bytes (Uint8Array) or null. Callers turn bytes into a blob/object URL.
    async loadImage(recordId, index, { ref = null } = {}) {
      const blobId = scanBlobId(recordId, index);
      const local = await store.getBytes(blobId);
      if (local) return local;
      if (ref?.cloud && cloudClient) {
        try {
          return await store.ensureAvailable({ blobId, locations: [{ kind: "cloud", bucket: ref.cloud.bucket, path: ref.cloud.path }] });
        } catch { /* backstop miss → null */ }
      }
      return null;
    },

    async hasImage(recordId, index) { return store.has(scanBlobId(recordId, index)); },

    // Remove one record's local image copies (called when the receipt is deleted).
    // Cloud blobs are content-addressed + RLS-scoped; orphans are harmless and age
    // out — deleting the record's LOCAL bytes is what matters for privacy/space.
    async removeImages(recordId, count = 8) {
      for (let i = 0; i < count; i++) {
        try { await store.delete(scanBlobId(recordId, i)); } catch { /* best-effort */ }
      }
    },

    async close() { try { await storage.close?.(); } catch { /* already closed */ } },
  };
}
