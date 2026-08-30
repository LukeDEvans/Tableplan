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
