// Cloud byte store — the durable/cross-device backstop for large content,
// content-addressed by sha-256. Bytes are large relative to their metadata, so
// they live in a dedicated PRIVATE Storage bucket, NEVER in the IO-hot
// tableplan_states JSONB rows. Bytes are immutable and addressed by their content
// hash, so the same content uploaded twice is one object and a corrupt download
// is detectable.
//
// The Storage client is INJECTED (the app passes the app's supabaseClient; tests
// pass a fake), so this module is pure of app globals and unit-testable — and a
// future home-server backend can implement the same tiny surface.
//
// Domain-neutral: extracted from Cadence (music/cloud-blob.js) as Phase 0. The
// only change is that the `bucket` is now a REQUIRED argument (no cadence-blobs
// default); each domain supplies its own bucket. Cadence keeps cadence-blobs via
// the music/cloud-blob.js shim.
//
//   uploadBlob(client, { userId, hash, bytes, mimeType, bucket }) → { bucket, path }
//   downloadBlob(client, { bucket, path })                        → Uint8Array
//   cloudLocation({ bucket, path })                               → BlobAsset location
//   blobPath(userId, hash)                                        → "userId/hash"

const HEX64 = /^[0-9a-f]{64}$/;

/** Content-addressed object path. Scoped by user for multi-user + tidy listing. */
export function blobPath(userId, hash) {
  const uid = String(userId || "personal").replace(/[^a-z0-9-]/gi, "-") || "personal";
  const h = String(hash || "").toLowerCase();
  if (!HEX64.test(h)) throw new Error("cloud-blob: a sha-256 hex hash is required for the content-addressed path");
  return `${uid}/${h}`;
}

function requireBucket(bucket) {
  if (!bucket) throw new Error("cloud-blob: a bucket is required");
  return bucket;
}

/**
 * Upload bytes once, addressed by hash. Idempotent: an already-present object
 * (409 / "already exists") is treated as success, because content addressing
 * guarantees the existing bytes are identical.
 */
export async function uploadBlob(client, { userId, hash, bytes, mimeType, bucket }) {
  requireBucket(bucket);
  const path = blobPath(userId, hash);
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const { error } = await client.storage.from(bucket).upload(path, body, {
    contentType: mimeType || "application/octet-stream",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error && !isAlreadyExists(error)) throw error;
  return { bucket, path };
}

/** Download bytes for a stored blob location. Returns a Uint8Array. */
export async function downloadBlob(client, { bucket, path }) {
  requireBucket(bucket);
  const { data, error } = await client.storage.from(bucket).download(path);
  if (error) throw error;
  if (!data) throw new Error("cloud-blob: download returned no data");
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}

/** The BlobAsset location record for a cloud object (blob.js consumes it). */
export function cloudLocation({ bucket, path }) {
  return { kind: "cloud", bucket, path };
}

function isAlreadyExists(error) {
  const status = String(error?.statusCode ?? error?.status ?? "");
  const msg = String(error?.message || "").toLowerCase();
  return status === "409" || msg.includes("already exists") || msg.includes("duplicate") || msg.includes("resource already exists");
}
