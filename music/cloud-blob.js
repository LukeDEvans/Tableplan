// Cadence cloud blob store — the shared content-store cloud-blob configured with
// Cadence's private bucket ("cadence-blobs"). The generic primitive lives in
// content-store/cloud-blob.js (Phase 0 extraction); this shim only supplies the
// bucket default, so existing call sites (which omit the bucket) and the existing
// bucket configuration are unchanged.
import { blobPath, uploadBlob as cloudUpload, downloadBlob as cloudDownload, cloudLocation as cloudLoc } from "../content-store/cloud-blob.js";

export const CADENCE_BLOB_BUCKET = "cadence-blobs";
export { blobPath };

export function uploadBlob(client, opts = {}) { return cloudUpload(client, { bucket: CADENCE_BLOB_BUCKET, ...opts }); }
export function downloadBlob(client, opts = {}) { return cloudDownload(client, { bucket: CADENCE_BLOB_BUCKET, ...opts }); }
export function cloudLocation(opts = {}) { return cloudLoc({ bucket: CADENCE_BLOB_BUCKET, ...opts }); }
