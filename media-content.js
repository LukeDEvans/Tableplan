// media-content.js — Media's article-body adapter over the shared ContentStore
// (local-first foundation, Phase 1). Article bodies are large text/HTML that
// today bloat the IO-hot media state section; this moves the BYTES into the
// content store (local IndexedDB + the private "reading-content" durable backstop)
// keyed by the article id, while the small savedArticles record stays the synced
// metadata carrier.
//
// Phase 1a is ADDITIVE + REVERSIBLE: bodies are dual-written here and
// savedArticles[].text remains the source of truth + fallback. Removing text from
// synced state (the actual Disk-IO win) is a later, separately-reviewed step.
//
// Pure over injected deps (storage + cloudClient), so it unit-tests against the
// memory StoragePort + a fake Storage client with no real Supabase.

import { createContentStore } from "./content-store/content-store.js";

export const READING_CONTENT_BUCKET = "reading-content";
export const READING_DB = "reading";
export const READING_STORES = ["bytes", "blobAssets"];

const articleBlobId = (id) => `article:${id}`;
const encode = (html) => new TextEncoder().encode(html);
const decode = (bytes) => new TextDecoder().decode(bytes);

/**
 * @param storage      a StoragePort (createIdbStorage in the app; memory in tests)
 * @param cloudClient  a Supabase-Storage-shaped client, or null → local-only (no backstop)
 * @param userId       path scope for the content-addressed cloud objects
 */
export function createArticleContent({ storage, cloudClient = null, userId = "personal" }) {
  const store = createContentStore({
    storage,
    cloudClient,
    bucket: cloudClient ? READING_CONTENT_BUCKET : null,
    userId,
    bytesStore: "bytes",
  });

  return {
    store,

    /**
     * Store an article's body locally (always) and in the durable backstop (when a
     * cloud client is configured). Returns a small `ref` to persist on the synced
     * savedArticles record so another device can later fetch the body from the
     * backstop — or null when there's nothing to store. Never throws for the caller
     * to have to handle: an offline/failed upload still leaves the local copy and a
     * null cloud ref (retried on the next stash).
     */
    async saveBody(articleId, html) {
      if (!html || typeof html !== "string") return null;
      const asset = await store.putBytes(articleBlobId(articleId), encode(html), { mimeType: "text/html", ownership: "owned" });
      const cloud = (asset.locations || []).find((l) => l.kind === "cloud");
      return { hash: asset.hash, size: asset.size, cloud: cloud ? { bucket: cloud.bucket, path: cloud.path } : null };
    },

    /**
     * Layered read: local IndexedDB → durable backstop (via the saved `ref`) →
     * `fallbackText`. Returns the body HTML string, or the fallback (which today is
     * savedArticles[].text, keeping behavior identical until that field is removed).
     */
    async loadBody(articleId, { ref = null, fallbackText = null } = {}) {
      const blobId = articleBlobId(articleId);
      const local = await store.getBytes(blobId);
      if (local) return decode(local);
      if (ref?.cloud && cloudClient) {
        try {
          const bytes = await store.ensureAvailable({ blobId, locations: [{ kind: "cloud", bucket: ref.cloud.bucket, path: ref.cloud.path }] });
          return decode(bytes);
        } catch { /* backstop miss/err → fall back to the synced text */ }
      }
      return fallbackText;
    },

    /** Is this article's body already in the local content store? */
    async hasLocal(articleId) { return store.has(articleBlobId(articleId)); },

    /** Release the local StoragePort (e.g. before deleting the db on logout). */
    async close() { try { await storage.close?.(); } catch { /* already closed */ } },
  };
}
