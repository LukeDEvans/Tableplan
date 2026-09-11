import { describe, it, expect } from "vitest";
import { ttsCacheKey, hashText } from "../tts-cache-identity.js";

const base = { text: "Hello world.", provider: "kokoro", providerVoiceId: "af_bella", model: "kokoro-v1", speed: 1.0 };

describe("ttsCacheKey — DO collide (identical synthesis config)", () => {
  it("same text + voice + provider + model + speed → identical key", () => {
    expect(ttsCacheKey(base)).toBe(ttsCacheKey({ ...base }));
  });
  it("is deterministic across calls (serialization stability)", () => {
    const a = ttsCacheKey(base);
    for (let i = 0; i < 5; i++) expect(ttsCacheKey(base)).toBe(a);
  });
  it("speed does NOT change the key when speed is applied at playback (speedInAudio=false)", () => {
    expect(ttsCacheKey({ ...base, speed: 1.0 })).toBe(ttsCacheKey({ ...base, speed: 1.25 }));
  });
});

describe("ttsCacheKey — do NOT collide (any synthesis input differs)", () => {
  it("different voice → different key", () => {
    expect(ttsCacheKey(base)).not.toBe(ttsCacheKey({ ...base, providerVoiceId: "af_nicole" }));
  });
  it("different provider → different key", () => {
    expect(ttsCacheKey(base)).not.toBe(ttsCacheKey({ ...base, provider: "google" }));
  });
  it("different model/version → different key (a model upgrade cannot reuse old audio)", () => {
    expect(ttsCacheKey(base)).not.toBe(ttsCacheKey({ ...base, model: "kokoro-v2" }));
  });
  it("different text → different key", () => {
    expect(ttsCacheKey(base)).not.toBe(ttsCacheKey({ ...base, text: "Hello world!" }));
  });
  it("speed DOES change the key when the provider bakes speed into audio (speedInAudio=true)", () => {
    const s = { ...base, speedInAudio: true };
    expect(ttsCacheKey({ ...s, speed: 1.0 })).not.toBe(ttsCacheKey({ ...s, speed: 1.25 }));
  });
});

describe("ttsCacheKey — path safety & robustness", () => {
  it("produces a path-safe token (no slashes, dots, spaces, traversal)", () => {
    const k = ttsCacheKey({ ...base, provider: "ko/../ro", providerVoiceId: "af bella!!" });
    expect(k).toMatch(/^[a-z0-9_-]+$/);
    expect(k).not.toContain("..");
    expect(k).not.toContain("/");
  });
  it("handles empty/missing fields without throwing", () => {
    expect(typeof ttsCacheKey({})).toBe("string");
    expect(typeof ttsCacheKey()).toBe("string");
  });
});

describe("hashText", () => {
  it("is deterministic and differs on different input", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
    expect(hashText("")).toBe(hashText(null)); // null coerced to ""
  });
});

// The presynth writer (presynth-tts-background → kokoro-store) and the client's
// direct-from-Storage reader (app.js articleStorageChunkUrls) MUST derive the
// SAME object path from a chunk, or a pre-rendered hit looks like a miss and the
// instant path silently never fires. Pin the shared derivation so a change to
// KOKORO_MODEL / the provider string / speedInAudio on either side trips a test.
import { sanitizeKey } from "../kokoro-core.mjs";
import { KOKORO_MODEL } from "../tts-provider.js";

describe("Kokoro article Storage path — presynth writer ⇄ client reader parity", () => {
  const chunkParams = (text, providerVoiceId, speed) => ({
    text, provider: "kokoro", providerVoiceId, model: KOKORO_MODEL, speed, speedInAudio: false,
  });
  it("keyPrefix is sanitizeKey(ttsCacheKey(...)) with the exact presynth params", () => {
    const params = chunkParams("A sentence to read.", "af_bella", 1);
    const keyPrefix = sanitizeKey(ttsCacheKey(params));
    expect(keyPrefix).toMatch(/^kokoro_af-bella_kokoro-v[0-9]+_splay_[a-z0-9]+$/);
    expect(keyPrefix).toBe(sanitizeKey(ttsCacheKey({ ...params }))); // stable
  });
  it("KOKORO_MODEL is the descriptor baked into the key (guards silent drift)", () => {
    expect(ttsCacheKey(chunkParams("x", "af_bella", 1))).toContain(KOKORO_MODEL);
  });
  it("speed is NOT in the key (speedInAudio:false → same MP3, played at playbackRate)", () => {
    const a = sanitizeKey(ttsCacheKey(chunkParams("x", "af_bella", 1)));
    const b = sanitizeKey(ttsCacheKey(chunkParams("x", "af_bella", 1.2)));
    expect(a).toBe(b); // deliberate: rate is applied at play-time, not baked into the render
  });
  it("a different voice or chunk text IS a different path", () => {
    const base = sanitizeKey(ttsCacheKey(chunkParams("x", "af_bella", 1)));
    expect(sanitizeKey(ttsCacheKey(chunkParams("x", "am_michael", 1)))).not.toBe(base);
    expect(sanitizeKey(ttsCacheKey(chunkParams("y", "af_bella", 1)))).not.toBe(base);
  });
});
