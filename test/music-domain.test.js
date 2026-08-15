import { describe, it, expect } from "vitest";
import {
  makeWork, makeScoreEdition, makeRepresentation, makePracticeSession,
  makeSessionMetric, makeAnnotation, makeRelationship, movementOrderOf,
} from "../music/domain.js";

describe("domain factories — normalization & defaults", () => {
  it("builds a Work with stable id and nested normalization", () => {
    const w = makeWork({ title: "Clair de lune", movements: [{ title: "I", ordinal: 0 }], editions: [{ label: "IMSLP" }] });
    expect(w.entity).toBe("work");
    expect(w.id).toMatch(/^work_/);
    expect(w.movements[0].id).toMatch(/^mvt_/);
    expect(w.editions[0].id).toMatch(/^ed_/);
  });
  it("edition retains provenance + licence and never assumes a source", () => {
    const e = makeScoreEdition({ label: "PDMX", licence: "CC0", provenance: { providerId: "pdmx", externalId: "123" } });
    expect(e.provenance.providerId).toBe("pdmx");
    expect(e.licence).toBe("CC0");
    const dflt = makeScoreEdition({});
    expect(dflt.provenance.providerId).toBe("user-upload"); // safe default, still explicit
  });
  it("representation references bytes by blobId (never a raw IDB key) and carries measure identity", () => {
    const r = makeRepresentation({ kind: "musicxml", blobId: "blob_x", measureIdentity: { ids: ["m_a", "m_b"], fingerprints: ["f1", "f2"] } });
    expect(r.blobId).toBe("blob_x");
    expect(r.parseVersion).toBe(0);
    expect(r.measureIdentity.ids).toEqual(["m_a", "m_b"]);
  });
});

describe("versioned & anchored user data", () => {
  it("session metric carries schemaVersion, unit, and producer version", () => {
    const m = makeSessionMetric({ sessionId: "s1", type: "avgTempo", value: 92, unit: "bpm", producedBy: "tempo-v0", producerVersion: "0.1.0" });
    expect(m.schemaVersion).toBe(1);
    expect(m.unit).toBe("bpm");
    expect(m.producedBy).toBe("tempo-v0");
    expect(m.producerVersion).toBe("0.1.0");
  });
  it("annotation defaults to a musical anchor and an 'ok' status", () => {
    const a = makeAnnotation({ workId: "w1", type: "fingering", anchor: { at: { measureIndex: 3 } } });
    expect(a.anchor.kind).toBe("musical");
    expect(a.status).toBe("ok");
    const g = makeAnnotation({ workId: "w1", anchor: { kind: "graphical", representationId: "rep1", geometry: {} } });
    expect(g.anchor.kind).toBe("graphical");
  });
  it("session/practice defaults timestamps and keeps positions opaque", () => {
    const s = makePracticeSession({ workId: "w1" });
    expect(s.startedAt).toBeTruthy();
    expect(s.startPosition).toBeNull();
  });
  it("relationship is a generic typed edge", () => {
    const r = makeRelationship({ fromType: "work", fromId: "w1", type: "composed-by", toType: "composer", toId: "c1" });
    expect(r.type).toBe("composed-by");
  });
});

describe("movementOrderOf", () => {
  it("orders movements by ordinal into an ordinal lookup", () => {
    const w = makeWork({ movements: [{ id: "b", ordinal: 1 }, { id: "a", ordinal: 0 }] });
    expect(movementOrderOf(w)).toEqual({ a: 0, b: 1 });
  });
});
