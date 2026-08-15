import { describe, it, expect } from "vitest";
import { rat } from "../music/rational.js";
import { mintMeasureIdentity, reconcileMeasureIdentity, measureFingerprint, indexOfMeasureId } from "../music/measure-identity.js";

// Minimal ScoreModel-shaped measures for fingerprinting: events carry
// onset {num,den}, midis[], dur {num,den}.
const M = (...events) => ({ timeSig: [4, 4], events });
const note = (onNum, onDen, midi, durNum = 1, durDen = 4) => ({ onset: rat(onNum, onDen), midis: [midi], dur: rat(durNum, durDen) });

const scoreA = [
  M(note(0, 1, 60), note(1, 4, 62), note(1, 2, 64), note(3, 4, 65)),  // measure 0
  M(note(0, 1, 67), note(1, 2, 69)),                                  // measure 1
  M(note(0, 1, 71)),                                                  // measure 2
];

describe("measure identity — minting & fingerprints", () => {
  it("mints one id per measure with index-aligned fingerprints", () => {
    const idn = mintMeasureIdentity(scoreA);
    expect(idn.ids).toHaveLength(3);
    expect(new Set(idn.ids).size).toBe(3);           // unique
    expect(idn.fingerprints).toHaveLength(3);
  });
  it("fingerprint is content-based and order-independent within a measure", () => {
    const a = measureFingerprint(M(note(0, 1, 60), note(1, 2, 64)));
    const b = measureFingerprint(M(note(1, 2, 64), note(0, 1, 60))); // same content, different order
    expect(a).toBe(b);
    const c = measureFingerprint(M(note(0, 1, 61), note(1, 2, 64))); // different pitch
    expect(a).not.toBe(c);
  });
});

describe("measure identity — reconciliation across reparse", () => {
  it("keeps ids when content is unchanged (a cosmetic reparse)", () => {
    const prior = mintMeasureIdentity(scoreA);
    const { identity, report } = reconcileMeasureIdentity(prior, scoreA);
    expect(identity.ids).toEqual(prior.ids);
    expect(report).toEqual({ matched: 3, minted: 0, retired: [] });
  });

  it("carries ids across an inserted measure and mints only the new one", () => {
    const prior = mintMeasureIdentity(scoreA);
    const withInsert = [scoreA[0], M(note(0, 1, 55)), scoreA[1], scoreA[2]]; // new measure at index 1
    const { identity, report } = reconcileMeasureIdentity(prior, withInsert);
    expect(identity.ids[0]).toBe(prior.ids[0]);       // measure 0 kept
    expect(identity.ids[2]).toBe(prior.ids[1]);       // old measure 1 shifted to index 2, id kept
    expect(identity.ids[3]).toBe(prior.ids[2]);
    expect(identity.ids[1]).not.toBe(prior.ids[0]);   // inserted measure got a fresh id
    expect(report.matched).toBe(3);
    expect(report.minted).toBe(1);
    expect(report.retired).toEqual([]);
  });

  it("retires the id of a removed measure (→ caller flags positions needs-review)", () => {
    const prior = mintMeasureIdentity(scoreA);
    const withoutMiddle = [scoreA[0], scoreA[2]]; // measure 1 deleted
    const { identity, report } = reconcileMeasureIdentity(prior, withoutMiddle);
    expect(identity.ids[0]).toBe(prior.ids[0]);
    expect(identity.ids[1]).toBe(prior.ids[2]);
    expect(report.retired).toEqual([prior.ids[1]]);
  });

  it("resolves a measureId to its current index after a reparse", () => {
    const prior = mintMeasureIdentity(scoreA);
    const anchorId = prior.ids[2];
    const withInsert = [scoreA[0], M(note(0, 1, 55)), scoreA[1], scoreA[2]];
    const { identity } = reconcileMeasureIdentity(prior, withInsert);
    expect(indexOfMeasureId(identity, anchorId)).toBe(3); // measure 2 → now index 3
  });
});
