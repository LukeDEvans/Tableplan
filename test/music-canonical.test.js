import { describe, it, expect } from "vitest";
import {
  deriveWorkDescriptor, matchWork, matchRecording, workGroupingKey,
  composerCompatible, extractCatalog, consolidateSearchResults, enrichWork,
  makeCanonicalWork, deriveWorkFromRecord,
} from "../music-canonical.js";

const rec = (p) => ({ entity: "track", provider: p.provider || "ia", providerRefs: [{ provider: p.provider || "ia", externalId: p.ext || "x/f.mp3" }], ...p });

describe("composer identity", () => {
  it("matches surname + compatible given names, incl. initials", () => {
    expect(composerCompatible("Beethoven", "Ludwig van Beethoven")).toBe(true);
    expect(composerCompatible("J.S. Bach", "Johann Sebastian Bach")).toBe(true);
    expect(composerCompatible("Beethoven", "Beethoven")).toBe(true);
  });
  it("rejects different people who share nothing / conflicting givens", () => {
    expect(composerCompatible("J.S. Bach", "C.P.E. Bach")).toBe(false);
    expect(composerCompatible("Beethoven", "Mozart")).toBe(false);
  });
});

describe("catalog extraction", () => {
  it("parses Op./No., BWV, K.", () => {
    expect(extractCatalog("Piano Sonata No. 14, Op. 27 No. 2")).toMatchObject({ catalogId: "op27no2", opus: 27 });
    expect(extractCatalog("Cello Suite No. 1, BWV 1007")).toMatchObject({ catalogId: "bwv1007" });
    expect(extractCatalog("Sonata K. 545")).toMatchObject({ catalogId: "k545" });
  });
});

describe("matchWork — conservative resolution", () => {
  const D = (t, c) => deriveWorkDescriptor(t, c);

  it("same work, different providers/formatting → matches", () => {
    const a = D("Piano Sonata No. 14 in C-sharp minor, Op. 27 No. 2", "Beethoven");
    const b = D("Sonata No. 14 Op. 27/2", "Ludwig van Beethoven");
    expect(matchWork(a, b).matched).toBe(true);
    expect(matchWork(a, b).signals).toContain("catalog");
  });

  it("nickname resolves to the same work (Moonlight = No. 14)", () => {
    const a = D("Moonlight Sonata", "Beethoven");
    const b = D("Piano Sonata No. 14, Op. 27 No. 2", "Beethoven");
    expect(matchWork(a, b).matched).toBe(true);
  });

  it("structured match without catalog (composer + type + number + instrument)", () => {
    const a = D("Piano Sonata No. 8", "Beethoven");
    const b = D("Beethoven: Piano Sonata No. 8 'Pathétique'", "");
    expect(matchWork(a, b).matched).toBe(true);
    expect(matchWork(a, b).signals).toContain("structured");
  });

  it("different works with similar names do NOT merge (number conflict)", () => {
    const a = D("Piano Sonata No. 13, Op. 27 No. 1", "Beethoven");
    const b = D("Piano Sonata No. 14, Op. 27 No. 2", "Beethoven");
    const m = matchWork(a, b);
    expect(m.matched).toBe(false);
    expect(m.reason).toBe("catalog-conflict");
  });

  it("catalog conflict beats title similarity", () => {
    const a = D("Symphony No. 5, Op. 67", "Beethoven");
    const b = D("Symphony No. 5, Op. 95", "Dvořák"); // different composer AND catalog
    expect(matchWork(a, b).matched).toBe(false);
  });

  it("ambiguous records (no strong key) stay separate — no grouping key", () => {
    const a = D("Ambient Soundscape", "");
    expect(workGroupingKey(a)).toBeNull();
  });
});

describe("matchRecording — same performance vs different", () => {
  it("same performer + album/duration → exact match", () => {
    const a = { performers: [{ name: "Glenn Gould" }], album: "Goldberg 1981", durationMs: 90000 };
    const b = { performers: [{ name: "Glenn Gould" }], album: "Goldberg 1981", durationMs: 91000 };
    expect(matchRecording(a, b).matched).toBe(true);
  });
  it("different performers → not the same recording", () => {
    const a = { performers: [{ name: "Glenn Gould" }], durationMs: 90000, album: "X" };
    const b = { performers: [{ name: "András Schiff" }], durationMs: 90000, album: "X" };
    expect(matchRecording(a, b).matched).toBe(false);
    expect(matchRecording(a, b).reason).toBe("performer-mismatch");
  });
});

describe("consolidateSearchResults — Work → recordings", () => {
  it("groups provider records of one work; keeps loose items separate", () => {
    const items = [
      rec({ provider: "musopen", title: "Beethoven: Piano Sonata No. 14, Op. 27 No. 2 (Moonlight)", composer: "Beethoven", ext: "m1/f.mp3" }),
      rec({ provider: "ia", title: "Piano Sonata No. 14 in C# minor, Op. 27 No. 2", composer: "Beethoven", ext: "i1/f.mp3" }),
      rec({ provider: "ia", title: "Rain Sounds for Sleep", composer: "", ext: "amb/f.mp3" }),
    ];
    const { groups, loose } = consolidateSearchResults(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].work.catalogId).toBe("op27no2");
    expect(groups[0].work.providerRefs).toHaveLength(2); // both providers referenced
    expect(loose.map((l) => l.title)).toEqual(["Rain Sounds for Sleep"]);
  });
});

describe("enrichWork — merge without clobbering user edits", () => {
  it("fills empty fields from incoming but never overrides canonicalFields", () => {
    const base = makeCanonicalWork({ composer: "Beethoven", title: "Sonata 14", canonicalFields: { title: "My Title" }, providerRefs: [{ provider: "ia", externalId: "a" }] });
    base.title = base.canonicalFields.title; // user edit applied
    const incoming = makeCanonicalWork({ composer: "Beethoven", title: "Piano Sonata No. 14", key: "c sharp minor", providerRefs: [{ provider: "musopen", externalId: "b" }] });
    const merged = enrichWork(base, incoming);
    expect(merged.title).toBe("My Title");       // user edit preserved
    expect(merged.key).toBe("c sharp minor");     // empty field enriched
    expect(merged.providerRefs).toHaveLength(2);  // refs merged
  });
});

describe("deriveWorkFromRecord — provenance kept", () => {
  it("records provider provenance and refs on the derived work", () => {
    const w = deriveWorkFromRecord(rec({ provider: "musopen", title: "Bach: Cello Suite No. 1, BWV 1007", composer: "Bach", ext: "id/1.mp3" }));
    expect(w.catalogId).toBe("bwv1007");
    expect(w.provenance[0].provider).toBe("musopen");
    expect(w.providerRefs[0].externalId).toBe("id/1.mp3");
  });
});
