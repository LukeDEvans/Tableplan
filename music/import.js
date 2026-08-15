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
  const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
  const mimeType = file.mimeType || MUSICXML_MIME;

  // 1. Store the owned bytes, addressed by a stable blobId, and catalog them.
  const blobId = newBlobId();
  const hash = await hashBytes(bytes);
  await storage.put("bytes", blobId, { bytes, mimeType });
  const asset = makeBlobAsset({
    blobId, hash, size: bytes.byteLength, mimeType, ownership: "owned",
    locations: [{ kind: "idb", key: blobId }],
    provenance: { source: "user-upload", filename: String(file.name || "") },
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
