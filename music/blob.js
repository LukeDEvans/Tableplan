// Cadence's blob identity & catalog is the domain-neutral BlobAsset, now owned by
// the shared content-store (Phase 0 extraction). This file is a stable import
// path for Cadence + existing tests; the implementation lives in content-store.
export * from "../content-store/blob.js";
