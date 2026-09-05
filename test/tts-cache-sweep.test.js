import { describe, it, expect } from "vitest";
import { articleAudioPrefixes, liveAudioPrefixes, partitionAudioFolders } from "../tts-cache-sweep.mjs";
import { prepareArticleListenText } from "../tts-article-text.mjs";
import { chunkText, sanitizeKey } from "../kokoro-core.mjs";
import { ttsCacheKey } from "../tts-cache-identity.js";

const KOKORO = { provider: "kokoro", providerVoiceId: "af_bella", model: "kokoro-v1", speed: 1 };
const GOOGLE = { provider: "google", providerVoiceId: "en-US-Neural2-D", model: "google-neural2d-v2", speed: 1 };

describe("articleAudioPrefixes", () => {
  it("kokoro: one folder per chunk, matching sanitizeKey(ttsCacheKey(chunk))", () => {
    const article = { title: "T", author: "A", text: "word ".repeat(600) }; // forces multiple chunks
    const prepared = prepareArticleListenText(article);
    const chunks = chunkText(prepared.text);
    expect(chunks.length).toBeGreaterThan(1);
    const expected = chunks.map((c) => sanitizeKey(ttsCacheKey({ ...KOKORO, text: c, speedInAudio: false })));
    expect(articleAudioPrefixes(article, KOKORO)).toEqual(expected);
  });

  it("google: exactly one folder for the whole article", () => {
    const article = { title: "T", text: "Short body." };
    const prefixes = articleAudioPrefixes(article, GOOGLE);
    expect(prefixes).toHaveLength(1);
    const prepared = prepareArticleListenText(article);
    expect(prefixes[0]).toBe(sanitizeKey(ttsCacheKey({ ...GOOGLE, text: prepared.text, speedInAudio: false })));
  });

  it("all prefixes are storage-safe (lowercase [a-z0-9_-])", () => {
    const all = articleAudioPrefixes({ title: "Héllo!", text: "Some body here." }, KOKORO);
    for (const p of all) expect(p).toMatch(/^[a-z0-9_-]+$/);
  });

  it("returns nothing for an article with no readable body", () => {
    expect(articleAudioPrefixes({ title: "No body" }, KOKORO)).toEqual([]);
  });

  it("is deterministic", () => {
    const a = { title: "Stable", text: "Deterministic body text." };
    expect(articleAudioPrefixes(a, KOKORO)).toEqual(articleAudioPrefixes(a, KOKORO));
  });
});

describe("liveAudioPrefixes + partitionAudioFolders", () => {
  const a1 = { id: "1", title: "One", text: "First article body." };
  const a2 = { id: "2", title: "Two", text: "Second article body." };

  it("unions prefixes across articles and voices, skipping bodyless ones", () => {
    const live = liveAudioPrefixes([a1, a2, { id: "3", title: "empty" }], [KOKORO, GOOGLE]);
    const manual = new Set([
      ...articleAudioPrefixes(a1, KOKORO), ...articleAudioPrefixes(a1, GOOGLE),
      ...articleAudioPrefixes(a2, KOKORO), ...articleAudioPrefixes(a2, GOOGLE),
    ]);
    expect(live).toEqual(manual);
  });

  it("keeps live folders and marks the rest orphan", () => {
    const live = liveAudioPrefixes([a1], [KOKORO]);
    const liveName = [...live][0];
    const { keep, orphan } = partitionAudioFolders([liveName, "kokoro_old_stale_hash", "legacy_articleid_123"], live);
    expect(keep).toEqual([liveName]);
    expect(orphan).toEqual(["kokoro_old_stale_hash", "legacy_articleid_123"]);
  });

  it("empty live set → everything is orphan (caller must guard against bad reads)", () => {
    const { keep, orphan } = partitionAudioFolders(["a", "b"], new Set());
    expect(keep).toEqual([]);
    expect(orphan).toEqual(["a", "b"]);
  });
});
