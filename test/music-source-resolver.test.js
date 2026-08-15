import { describe, it, expect } from "vitest";
import { resolvePlayableSource } from "../music-source-resolver.js";

// Fake provider with resolveRef (fallback) + optional search returning track
// items that carry a playable source.
function fakeProvider(id, { refs = {}, up = true, searchItems = [] } = {}) {
  return {
    id,
    async isAvailable() { return up; },
    async resolveRef(ref) { return refs[ref.externalId] || null; },
    async search() { return searchItems; },
    async getItem(a) { return { album: a, tracks: [] }; },
  };
}
function registry(providers) {
  const byId = new Map(providers.map((p) => [p.id, p]));
  return { get: (id) => byId.get(id) || null, async search(q, o) { const items = []; for (const p of providers) { try { items.push(...(await p.search(q, o))); } catch { /* isolated */ } } return { items }; } };
}

const recording = (refs, extra = {}) => ({
  id: "rec_1", entity: "recording", workId: "work_1", workTitle: "Piano Sonata No. 14, Op. 27 No. 2", composer: "Beethoven",
  performers: [{ name: "Glenn Gould" }], album: "Gould Plays Beethoven", durationMs: 300000,
  originProvider: refs[0] && refs[0].provider, providerRefs: refs, ...extra,
});

describe("resolvePlayableSource — exact via own refs", () => {
  it("plays the exact recording from its primary provider", async () => {
    const ia = fakeProvider("ia", { refs: { "id/track.mp3": { provider: "ia", url: "https://a/stream.mp3", streamable: true } } });
    const rec = recording([{ provider: "ia", externalId: "id/track.mp3" }]);
    const r = await resolvePlayableSource(rec, { registry: registry([ia]) });
    expect(r.status).toBe("exact");
    expect(r.source.url).toBe("https://a/stream.mp3");
    expect(r.providerRef.provider).toBe("ia");
  });

  it("falls back to a SECONDARY provider ref when the primary yields no source", async () => {
    const musopen = fakeProvider("musopen", { refs: {} }); // no source
    const ia = fakeProvider("ia", { refs: { "id/x.mp3": { provider: "ia", url: "https://ia/x.mp3" } } });
    const rec = recording([{ provider: "musopen", externalId: "gone" }, { provider: "ia", externalId: "id/x.mp3" }]);
    const r = await resolvePlayableSource(rec, { registry: registry([musopen, ia]) });
    expect(r.status).toBe("exact");
    expect(r.providerRef.provider).toBe("ia");
  });

  it("honours a preferred provider ordering", async () => {
    const a = fakeProvider("a", { refs: { xa: { provider: "a", url: "https://a" } } });
    const b = fakeProvider("b", { refs: { xb: { provider: "b", url: "https://b" } } });
    const rec = recording([{ provider: "a", externalId: "xa" }, { provider: "b", externalId: "xb" }]);
    const r = await resolvePlayableSource(rec, { registry: registry([a, b]), preferredProvider: "b" });
    expect(r.providerRef.provider).toBe("b");
  });
});

describe("resolvePlayableSource — provider down / dynamic availability", () => {
  it("skips an unavailable provider without deleting refs, uses the next", async () => {
    const down = fakeProvider("musopen", { up: false, refs: { m: { provider: "musopen", url: "https://m" } } });
    const ia = fakeProvider("ia", { refs: { "id/x.mp3": { provider: "ia", url: "https://ia/x.mp3" } } });
    const rec = recording([{ provider: "musopen", externalId: "m" }, { provider: "ia", externalId: "id/x.mp3" }]);
    const r = await resolvePlayableSource(rec, { registry: registry([down, ia]) });
    expect(r.status).toBe("exact");
    expect(r.providerRef.provider).toBe("ia");
    expect(rec.providerRefs).toHaveLength(2); // refs untouched
    expect(r.attempts.find((a) => a.provider === "musopen").reason).toBe("unavailable");
  });
});

describe("resolvePlayableSource — search fallback", () => {
  const sameWorkTrack = (id, url, performer) => ({
    entity: "track", provider: "ia", title: "Piano Sonata No. 14, Op. 27 No. 2", composer: "Beethoven",
    performers: [{ name: performer }], artists: [{ name: performer, role: "performer" }], album: "X", durationMs: 300000,
    providerRefs: [{ provider: "ia", externalId: id }], playable: { provider: "ia", url, streamable: true },
  });

  it("finds the SAME performance via search on a provider we had no ref for → exact", async () => {
    const ia = fakeProvider("ia", { refs: {}, searchItems: [sameWorkTrack("id/g.mp3", "https://ia/g.mp3", "Glenn Gould")] });
    const rec = recording([{ provider: "dead", externalId: "gone" }]); // its own provider is gone
    const r = await resolvePlayableSource(rec, { registry: registry([ia]), allowAlternate: true });
    expect(r.status).toBe("exact");           // same performer → same recording
    expect(r.source.url).toBe("https://ia/g.mp3");
  });

  it("offers an ALTERNATE performance when only a different one exists — never silent", async () => {
    const ia = fakeProvider("ia", { refs: {}, searchItems: [sameWorkTrack("id/s.mp3", "https://ia/s.mp3", "Andras Schiff")] });
    const rec = recording([{ provider: "dead", externalId: "gone" }]);
    const r = await resolvePlayableSource(rec, { registry: registry([ia]), allowAlternate: true });
    expect(r.status).toBe("alternate");
    expect(r.alternateRecording).toBeTruthy();
    expect(r.source.url).toBe("https://ia/s.mp3");
  });

  it("returns unavailable when nothing resolves", async () => {
    const ia = fakeProvider("ia", { refs: {}, searchItems: [] });
    const rec = recording([{ provider: "dead", externalId: "gone" }]);
    const r = await resolvePlayableSource(rec, { registry: registry([ia]), allowAlternate: true });
    expect(r.status).toBe("unavailable");
  });

  it("does not fall back to a DIFFERENT work", async () => {
    const wrong = { entity: "track", provider: "ia", title: "Symphony No. 5, Op. 67", composer: "Beethoven", performers: [{ name: "X" }], providerRefs: [{ provider: "ia", externalId: "w" }], playable: { url: "https://w" } };
    const ia = fakeProvider("ia", { refs: {}, searchItems: [wrong] });
    const rec = recording([{ provider: "dead", externalId: "gone" }]);
    const r = await resolvePlayableSource(rec, { registry: registry([ia]), allowAlternate: true });
    expect(r.status).toBe("unavailable"); // Op. 67 ≠ Op. 27 No. 2
  });
});
