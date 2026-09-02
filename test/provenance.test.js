import { describe, it, expect } from "vitest";
import { ORIGIN, makeProvenance, markUserModified, markObserved, describeProvenance } from "../provenance.js";

describe("makeProvenance", () => {
  it("stamps an imported record as refreshable by default", () => {
    const p = makeProvenance({ origin: ORIGIN.IMPORTED, source: "import", sourceUrl: "https://x.com/a" });
    expect(p.origin).toBe("imported");
    expect(p.source).toBe("import");
    expect(p.sourceUrl).toBe("https://x.com/a");
    expect(p.refreshable).toBe(true);
    expect(p.userModified).toBe(false);
    expect(p.importedAt).toBeTruthy();
    expect(p.observedAt).toBe(p.importedAt); // observed defaults to imported
  });

  it("provider origin is refreshable; manual/generated/derived are not, by default", () => {
    expect(makeProvenance({ origin: ORIGIN.PROVIDER }).refreshable).toBe(true);
    expect(makeProvenance({ origin: ORIGIN.MANUAL }).refreshable).toBe(false);
    expect(makeProvenance({ origin: ORIGIN.GENERATED }).refreshable).toBe(false);
    expect(makeProvenance({ origin: ORIGIN.DERIVED }).refreshable).toBe(false);
  });

  it("explicit refreshable overrides the origin default (e.g. a one-time email capture)", () => {
    expect(makeProvenance({ origin: ORIGIN.IMPORTED, refreshable: false }).refreshable).toBe(false);
    expect(makeProvenance({ origin: ORIGIN.MANUAL, refreshable: true }).refreshable).toBe(true);
  });

  it("coerces an unknown origin to manual (never throws on bad input)", () => {
    expect(makeProvenance({ origin: "bogus" }).origin).toBe("manual");
    expect(makeProvenance().origin).toBe("manual");
  });

  it("honors an explicit importedAt/observedAt", () => {
    const p = makeProvenance({ origin: ORIGIN.PROVIDER, importedAt: "2026-01-01T00:00:00Z", observedAt: "2026-02-01T00:00:00Z" });
    expect(p.importedAt).toBe("2026-01-01T00:00:00Z");
    expect(p.observedAt).toBe("2026-02-01T00:00:00Z");
  });
});

describe("markUserModified / markObserved (immutable updates)", () => {
  it("markUserModified flips the flag without mutating the input", () => {
    const p = makeProvenance({ origin: ORIGIN.IMPORTED });
    const p2 = markUserModified(p);
    expect(p.userModified).toBe(false);   // original untouched
    expect(p2.userModified).toBe(true);
  });

  it("markObserved updates the observed stamp immutably", () => {
    const p = makeProvenance({ origin: ORIGIN.PROVIDER, importedAt: "2026-01-01T00:00:00Z" });
    const p2 = markObserved(p, "2026-03-01T00:00:00Z");
    expect(p.observedAt).toBe("2026-01-01T00:00:00Z");
    expect(p2.observedAt).toBe("2026-03-01T00:00:00Z");
  });

  it("tolerate null/garbage provenance", () => {
    expect(markUserModified(null)).toBe(null);
    expect(markObserved(undefined)).toBe(undefined);
  });
});

describe("describeProvenance — answers the lifecycle questions", () => {
  it("an untouched imported record is safely regenerable", () => {
    const d = describeProvenance(makeProvenance({ origin: ORIGIN.IMPORTED, source: "import", sourceUrl: "u" }));
    expect(d.origin).toBe("imported");
    expect(d.refreshable).toBe(true);
    expect(d.userModified).toBe(false);
    expect(d.safelyRegenerable).toBe(true);
  });

  it("a user-modified imported record is NOT safely regenerable (would lose edits)", () => {
    const d = describeProvenance(markUserModified(makeProvenance({ origin: ORIGIN.IMPORTED })));
    expect(d.safelyRegenerable).toBe(false);
  });

  it("a manual record is not refreshable and not regenerable", () => {
    const d = describeProvenance(makeProvenance({ origin: ORIGIN.MANUAL }));
    expect(d.refreshable).toBe(false);
    expect(d.safelyRegenerable).toBe(false);
  });

  it("legacy record with no provenance → unknown origin, safe defaults", () => {
    const d = describeProvenance(undefined);
    expect(d.origin).toBe("unknown");
    expect(d.refreshable).toBe(false);
    expect(d.safelyRegenerable).toBe(false);
    expect(d.lastObserved).toBe(null);
  });

  it("lastObserved falls back to importedAt when observedAt is absent", () => {
    const d = describeProvenance({ origin: "imported", importedAt: "2026-01-01T00:00:00Z" });
    expect(d.lastObserved).toBe("2026-01-01T00:00:00Z");
  });
});
