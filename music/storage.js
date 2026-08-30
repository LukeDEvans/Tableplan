// Cadence StoragePort — the shared content-store StoragePort configured with
// Cadence's own database ("cadence", v2) and object stores. The generic primitive
// lives in content-store/storage.js (Phase 0 extraction); this shim only supplies
// Cadence's configuration, so existing import paths and persisted IndexedDB data
// are unchanged.
import { createMemoryStorage as memStorage, createIdbStorage as idbStorage, hasLocalBytes } from "../content-store/storage.js";

export const STORES = ["bytes", "blobAssets", "works", "representations", "scoreModels", "practiceSessions", "annotations", "recordings"];

/** In-memory StoragePort seeded with Cadence's stores (unchanged public behavior). */
export function createMemoryStorage(stores = STORES) { return memStorage(stores); }

/** IndexedDB StoragePort on the "cadence" database (unchanged name/version/stores). */
export function createIdbStorage(dbName = "cadence", version = 2) { return idbStorage(dbName, version, STORES); }

export { hasLocalBytes };
