// Import pipeline — provider-agnostic ingestion of a MusicXML file into the
// canonical domain, stored offline-first. This is the "user-upload ScoreProvider"
// path; other providers (PDMX/IMSLP/OMR) will feed the same tail end.
//
//   file bytes → hash + store bytes (blobId) → BlobAsset (owned) → parse to
//   ScoreModel → mint measure identity → Work/Movement/Edition/Representation →
//   persist records. Everything lands in the StoragePort so an offline reload
//   reconstructs the whole thing with no network.

import { hashBytes, makeBlobAsset, newBlobId } from "./blob.js";
import { parseMusicXml } from "./musicxml-parser.js";
import { extractMusicXml, isZip } from "./mxl.js";
import { mintMeasureIdentity } from "./measure-identity.js";
import { makeWork, makeMovement, makeScoreEdition, makeRepresentation } from "./domain.js";

const MUSICXML_MIME = "application/vnd.recordare.musicxml+xml";
const stripExt = (n) => String(n || "Untitled").replace(/\.[^.]+$/, "");

/**
 * Import one MusicXML file.
 * @param file    { name, bytes:Uint8Array, mimeType? }
 * @param storage StoragePort
 * @param opts    { workTitle?, composer? }
 * @returns       { work, edition, movement, representation, model, blobId, warnings }
 */
export async function importMusicXmlFile(file, storage, opts = {}) {
  const rawBytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
  const wasCompressed = isZip(rawBytes);
  // Normalize .mxl (zip) → plain MusicXML; a .xml/.musicxml passes through. We
  // store the extracted plain XML so the parser and renderer only see plain XML.
  const bytes = extractMusicXml(rawBytes);
  const mimeType = MUSICXML_MIME;

  // 1. Store the owned bytes, addressed by a stable blobId, and catalog them.
  const blobId = newBlobId();
  const hash = await hashBytes(bytes);
  await storage.put("bytes", blobId, { bytes, mimeType });
  const asset = makeBlobAsset({
    blobId, hash, size: bytes.byteLength, mimeType, ownership: "owned",
    locations: [{ kind: "idb", key: blobId }],
    provenance: { source: "user-upload", filename: String(file.name || ""), originalFormat: wasCompressed ? "mxl" : "musicxml" },
  });
  await storage.put("blobAssets", blobId, asset);

  // 2. Parse to the normalized ScoreModel.
  const xml = new TextDecoder().decode(bytes);
  const model = parseMusicXml(xml);

  // 3. Build the canonical domain spine.
  const identity = mintMeasureIdentity(model.measures);
  const representation = makeRepresentation({ kind: "musicxml", blobId, measureIdentity: identity });
  const edition = makeScoreEdition({
    label: opts.editionLabel || stripExt(file.name),
    provenance: { providerId: "user-upload", importedAt: new Date().toISOString() },
    representations: [representation],
  });
  const movement = makeMovement({ title: "", ordinal: 0 });
  const work = makeWork({
    title: opts.workTitle || stripExt(file.name),
    composer: opts.composer || "",
    instrumentation: ["piano"],
    movements: [movement],
    editions: [edition],
  });

  // 4. Persist. ScoreModel is a derived cache keyed by representation; a flat
  //    representation index carries work/edition backrefs for quick reload.
  model.id = `sm_${representation.id}`;
  model.representationId = representation.id;
  model.parseVersion = representation.parseVersion;
  await storage.put("scoreModels", representation.id, model);
  await storage.put("works", work.id, work);
  await storage.put("representations", representation.id, {
    ...representation, workId: work.id, editionId: edition.id, movementId: movement.id,
  });

  return { work, edition, movement, representation, model, blobId, warnings: model.warnings };
}

/**
 * Reload an imported work end-to-end from storage (offline path). Returns the
 * pieces a renderer needs, or null if not found.
 */
export async function loadWork(storage, workId) {
  const work = await storage.get("works", workId);
  if (!work) return null;
  const edition = work.editions[0];
  const representation = edition?.representations?.[0];
  if (!representation) return { work, edition: edition || null, representation: null, model: null };
  const model = await storage.get("scoreModels", representation.id);
  const asset = await storage.get("blobAssets", representation.blobId);
  return { work, edition, movement: work.movements[0] || null, representation, model, asset };
}

/** List imported works (id + title) for a picker. */
export async function listWorks(storage) {
  const works = await storage.getAll("works");
  return works.map((w) => ({ id: w.id, title: w.title, composer: w.composer }));
}

/** Decode a representation's stored MusicXML bytes to a string, or null if the
 * bytes aren't on this device. Keeps store-name/byte-shape knowledge out of the UI. */
export async function readRepresentationXml(storage, representation) {
  if (!representation?.blobId) return null;
  const rec = await storage.get("bytes", representation.blobId);
  if (!rec || !rec.bytes) return null;
  return new TextDecoder().decode(rec.bytes);
}

/**
 * Rebuild a Work's LOCAL cache from canonical metadata that arrived via sync,
 * so the offline render path (loadWork / readRepresentationXml) works unchanged
 * on a device that never did the original import. Ids are preserved — this is a
 * cache-fill, not a new import. `bytes` may be null (metadata-only): the Work
 * record still lands so the library can show it as "not on this device yet".
 *
 * @param storage   StoragePort
 * @param canonical { work, blobAsset?, bytes?:Uint8Array }
 * @returns         { work, representation }
 */
export async function hydrateWorkLocally(storage, { work, blobAsset = null, bytes = null }) {
  const edition = work?.editions?.[0];
  const representation = edition?.representations?.[0] || null;
  if (!representation) { await storage.put("works", work.id, work); return { work, representation: null }; }

  const mimeType = blobAsset?.mimeType || MUSICXML_MIME;
  if (bytes) {
    const bytesU8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    await storage.put("bytes", representation.blobId, { bytes: bytesU8, mimeType });
    // Re-derive the ScoreModel cache from the bytes, keyed by the SAME
    // representation id (measure identity already rode along on the record).
    const xml = new TextDecoder().decode(bytesU8);
    const model = parseMusicXml(xml);
    model.id = `sm_${representation.id}`;
    model.representationId = representation.id;
    model.parseVersion = representation.parseVersion || 0;
    await storage.put("scoreModels", representation.id, model);
  }
  if (blobAsset) await storage.put("blobAssets", representation.blobId, blobAsset);
  await storage.put("works", work.id, work);
  await storage.put("representations", representation.id, {
    ...representation, workId: work.id, editionId: edition.id, movementId: work.movements?.[0]?.id || null,
  });
  return { work, representation };
}

/** Delete a Work and every record it owns (bytes, blob catalog, score model,
 * representation, work). The one place that knows how a Work fans across stores. */
export async function deleteWork(storage, workId) {
  const w = await loadWork(storage, workId);
  if (w?.representation) {
    await storage.delete("bytes", w.representation.blobId);
    await storage.delete("blobAssets", w.representation.blobId);
    await storage.delete("scoreModels", w.representation.id);
    await storage.delete("representations", w.representation.id);
  }
  await storage.delete("works", workId);
}
