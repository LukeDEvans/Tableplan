import { describe, it, expect } from "vitest";
import { createScoreProviderRegistry, makeScoreResult, isStructuredFormat, SCORE_CAP } from "../music/score-provider.js";

// Mock providers with an INJECTED result set — no network, deterministic.
const provider = (id, caps, hits, { available = true, throws = false } = {}) => ({
  id, label: id,
  capabilities: new Set(caps),
  async isAvailable() { return available; },
  async search() { if (throws) throw new Error("boom"); return hits; },
  async fetchStructured() { return { name: `${id}.musicxml`, bytes: new Uint8Array([1]), format: "musicxml" }; },
});

describe("isStructuredFormat — the honest machine-readable bar", () => {
  it("is true only for real structured formats", () => {
    expect(isStructuredFormat("musicxml")).toBe(true);
    expect(isStructuredFormat("MXL")).toBe(true);
    expect(isStructuredFormat("mei")).toBe(true);
    expect(isStructuredFormat("pdf")).toBe(false);
    expect(isStructuredFormat("interactive")).toBe(false);
    expect(isStructuredFormat("")).toBe(false);
  });
});

describe("makeScoreResult", () => {
  it("derives `structured` from the format, not the provider's say-so", () => {
    expect(makeScoreResult({ format: "musicxml" }).structured).toBe(true);
    expect(makeScoreResult({ format: "pdf", structured: true }).structured).toBe(false); // a PDF is never structured
  });
});

describe("createScoreProviderRegistry", () => {
  const structured = provider("mutopia", [SCORE_CAP.SEARCH, SCORE_CAP.STRUCTURED], [{ externalId: "1", title: "Sonata", composer: "Beethoven", format: "musicxml" }]);
  const scans = provider("imslp", [SCORE_CAP.SEARCH], [{ externalId: "9", title: "Sonata scan", format: "pdf" }]);
  const broken = provider("down", [SCORE_CAP.SEARCH], [], { throws: true });
  const reg = createScoreProviderRegistry([structured, scans, broken]);

  it("aggregates results and isolates a failing provider (never breaks the rest)", async () => {
    const { results, providerStatuses } = await reg.search("sonata");
    expect(results).toHaveLength(2);                         // structured + scan; broken contributed nothing
    const down = providerStatuses.find((s) => s.provider === "down");
    expect(down).toMatchObject({ ok: false });
    expect(down.error).toMatch(/boom/);
  });

  it("sorts structured (importable) results ahead of scans", async () => {
    const { results } = await reg.search("sonata");
    expect(results[0].structured).toBe(true);
    expect(results[0].provider).toBe("mutopia");
  });

  it("skips an unavailable provider without erroring", async () => {
    const off = provider("off", [SCORE_CAP.SEARCH], [{ externalId: "x", format: "musicxml" }], { available: false });
    const r = createScoreProviderRegistry([off]);
    const { results, providerStatuses } = await r.search("x");
    expect(results).toHaveLength(0);
    expect(providerStatuses[0]).toMatchObject({ provider: "off", ok: false });
  });

  it("exposes structured providers (the ones import should prefer)", () => {
    expect(reg.structuredProviders().map((p) => p.id)).toEqual(["mutopia"]);
    expect(reg.withCapability(SCORE_CAP.SEARCH).map((p) => p.id)).toEqual(["mutopia", "imslp", "down"]);
  });

  it("blank query returns nothing", async () => {
    expect((await reg.search("  ")).results).toEqual([]);
  });
});
