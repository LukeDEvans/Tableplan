// Cadence music domain — canonical entities. Pure data + normalizing factories;
// no DOM, storage, providers, or MusicXML. Inner ring; nothing leaks in.
//
// The Work is the aggregate root and is FORMAT-FREE. Bytes (scores/recordings)
// are referenced by blobId → BlobAsset (music/blob.js), never by an IndexedDB
// key. Positions are edition-pinned (music/position.js).
//
// Every factory takes a partial (a synced-state row or an IndexedDB record) and
// returns a normalized object with defaults + a stable id — tolerant of old/
// missing fields, like the app's existing normalizeX functions.

let idCounter = 0;
export function uid(prefix = "id") {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
export function resetIds() { idCounter = 0; }

const nowIso = () => new Date().toISOString();
const str = (v, d = "") => (v == null ? d : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const obj = (v) => (v && typeof v === "object" ? v : {});

// ── Canonical spine ───────────────────────────────────────────────────────────
export function makeWork(p = {}) {
  return {
    entity: "work",
    id: str(p.id) || uid("work"),
    title: str(p.title),
    subtitle: str(p.subtitle),
    composer: str(p.composer),
    composerId: str(p.composerId) || null,     // optional graph entity id
    instrumentation: arr(p.instrumentation).map(String),
    movements: arr(p.movements).map(makeMovement),
    editions: arr(p.editions).map(makeScoreEdition),
    tags: arr(p.tags).map(String),
    metadata: obj(p.metadata),
    createdAt: str(p.createdAt) || nowIso(),
    updatedAt: str(p.updatedAt) || nowIso(),
  };
}

export function makeMovement(p = {}) {
  return {
    entity: "movement",
    id: str(p.id) || uid("mvt"),
    title: str(p.title),
    ordinal: num(p.ordinal, 0),
    defaultTempoBpm: p.defaultTempoBpm == null ? null : num(p.defaultTempoBpm),
    defaultKey: str(p.defaultKey),
  };
}

export function makeScoreEdition(p = {}) {
  return {
    entity: "scoreEdition",
    id: str(p.id) || uid("ed"),
    label: str(p.label) || "Untitled edition",
    editor: str(p.editor),
    provenance: {
      providerId: str(p.provenance?.providerId) || "user-upload",
      externalId: str(p.provenance?.externalId) || null,
      sourceUrl: str(p.provenance?.sourceUrl) || null,
      importedAt: str(p.provenance?.importedAt) || nowIso(),
    },
    licence: str(p.licence) || null,
    representations: arr(p.representations).map(makeRepresentation),
    createdAt: str(p.createdAt) || nowIso(),
  };
}

/** A concrete file/rendering of an edition. Bytes referenced by blobId → BlobAsset. */
export function makeRepresentation(p = {}) {
  const kind = str(p.kind) || "musicxml"; // "musicxml" | "pdf" | "scan" | "midi"
  return {
    entity: "representation",
    id: str(p.id) || uid("rep"),
    kind,
    blobId: str(p.blobId) || null,          // → BlobAsset catalog (never a raw IDB key)
    parseVersion: kind === "musicxml" ? num(p.parseVersion, 0) : 0,
    scoreModelBlobId: str(p.scoreModelBlobId) || null, // derived, cached ScoreModel (also a blob)
    // Persisted measure identity (music/measure-identity.js): index-aligned
    // stable ids + content fingerprints, reconciled across reparses.
    measureIdentity: {
      ids: arr(p.measureIdentity?.ids).map(String),
      fingerprints: arr(p.measureIdentity?.fingerprints).map(String),
    },
    createdAt: str(p.createdAt) || nowIso(),
  };
}

// ── User-owned data ────────────────────────────────────────────────────────────
export function makePracticeSession(p = {}) {
  const startedAt = str(p.startedAt) || nowIso();
  return {
    entity: "practiceSession",
    id: str(p.id) || uid("sess"),
    workId: str(p.workId),
    movementId: str(p.movementId) || null,
    editionId: str(p.editionId) || null,
    startedAt,
    endedAt: str(p.endedAt) || null,
    durationMs: p.durationMs == null ? null : num(p.durationMs),
    inputSource: str(p.inputSource) || null,
    startPosition: p.startPosition || null,   // ScorePosition (normalized by caller)
    endPosition: p.endPosition || null,
    sectionsPracticed: arr(p.sectionsPracticed),
    recordingId: str(p.recordingId) || null,
    notes: str(p.notes),
    context: obj(p.context),
    createdAt: str(p.createdAt) || startedAt,
  };
}

/** Metric attached to a session — versioned so historical values stay interpretable. */
export function makeSessionMetric(p = {}) {
  return {
    entity: "sessionMetric",
    id: str(p.id) || uid("metric"),
    sessionId: str(p.sessionId),
    type: str(p.type),
    range: p.range || null,
    value: p.value ?? null,
    unit: str(p.unit) || null,                 // "bpm" | "cents" | "ratio" | "ms" | …
    schemaVersion: num(p.schemaVersion, 1),    // this metric type's shape version
    producedBy: str(p.producedBy) || "user",   // algorithm/producer id
    producerVersion: str(p.producerVersion) || null, // producer's own version
    producedAt: str(p.producedAt) || nowIso(),
  };
}

export function makeRecording(p = {}) {
  return {
    entity: "recording",
    id: str(p.id) || uid("rec"),
    sessionId: str(p.sessionId) || null,
    workId: str(p.workId),
    media: arr(p.media).map((m) => ({
      kind: str(m?.kind) || "audio",           // "audio" | "midi" | "events"
      blobId: str(m?.blobId) || null,          // → BlobAsset
      mimeType: str(m?.mimeType) || null,
      durationMs: num(m?.durationMs, 0),
    })),
    alignment: p.alignment || null,            // TimelineAlignment
    createdAt: str(p.createdAt) || nowIso(),
  };
}

export function makeAnnotation(p = {}) {
  return {
    entity: "annotation",
    id: str(p.id) || uid("anno"),
    workId: str(p.workId),
    anchor: normalizeAnchor(p.anchor),
    type: str(p.type) || "note",
    payload: p.payload ?? null,
    status: str(p.status) || "ok",             // "ok" | "needs-review" (migration §21)
    createdBy: str(p.createdBy) || "user",
    createdAt: str(p.createdAt) || nowIso(),
  };
}

export function makeRelationship(p = {}) {
  return {
    entity: "relationship",
    id: str(p.id) || uid("rel"),
    fromType: str(p.fromType), fromId: str(p.fromId),
    type: str(p.type),
    toType: str(p.toType), toId: str(p.toId),
    metadata: obj(p.metadata),
    createdAt: str(p.createdAt) || nowIso(),
  };
}

function normalizeAnchor(a) {
  if (a && a.kind === "graphical") {
    return { kind: "graphical", representationId: str(a.representationId), geometry: a.geometry ?? null };
  }
  return { kind: "musical", at: a?.at ?? null }; // ScorePosition or ScoreRange
}

/** Movement-ordinal lookup derived from a Work — for comparePositions/positionKey. */
export function movementOrderOf(work) {
  const order = {};
  arr(work?.movements).slice().sort((a, b) => a.ordinal - b.ordinal).forEach((m, i) => { order[m.id] = i; });
  return order;
}
