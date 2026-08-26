import { describe, it, expect } from "vitest";
import { VOICES, getVoices, getVoice, resolveProviderVoice, DEFAULT_VOICE_ID } from "../voice-registry.js";

describe("voice registry — app id → provider mapping (bella → kokoro → af_bella)", () => {
  it("resolves a friendly id to provider + providerVoiceId", () => {
    expect(resolveProviderVoice("bella")).toEqual({ provider: "kokoro", providerVoiceId: "af_bella" });
    expect(resolveProviderVoice("google-neural")).toEqual({ provider: "google", providerVoiceId: "en-US-Neural2-D" });
  });
  it("unknown voice → null (no throw)", () => {
    expect(resolveProviderVoice("nope")).toBe(null);
    expect(getVoice("nope")).toBe(null);
  });
  it("consumers never need provider-specific ids — displayName is friendly, not af_*", () => {
    for (const v of VOICES) {
      expect(v.displayName).not.toMatch(/af_|am_|Neural2/);
      expect(v.id).not.toMatch(/^af_|^am_/);
    }
  });
});

describe("voice registry — availability & default", () => {
  it("Phase 0 default is the working Google voice (behaviour-preserving)", () => {
    expect(DEFAULT_VOICE_ID).toBe("google-neural");
    expect(getVoice(DEFAULT_VOICE_ID).provider).toBe("google");
    expect(getVoice(DEFAULT_VOICE_ID).availability).toBe("available");
  });
  it("Kokoro voices are registered but unavailable until Phase 1", () => {
    const kokoro = getVoices({ provider: "kokoro" });
    expect(kokoro.length).toBeGreaterThan(0);
    expect(kokoro.every((v) => v.availability === "unavailable")).toBe(true);
    expect(kokoro.map((v) => v.id)).toContain("bella");
  });
  it("availableOnly filter returns only available voices", () => {
    const avail = getVoices({ availableOnly: true });
    expect(avail.every((v) => v.availability === "available")).toBe(true);
    expect(avail.map((v) => v.id)).toContain("google-neural");
  });
  it("voice ids are unique", () => {
    const ids = VOICES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
