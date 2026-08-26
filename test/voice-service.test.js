import { describe, it, expect, vi } from "vitest";
import { createVoiceService } from "../voice-service.js";
import { createGoogleProvider, createKokoroProvider, GOOGLE_MODEL } from "../tts-provider.js";
import { ttsCacheKey } from "../tts-cache-identity.js";

function service({ aiSettings = {}, callFn = vi.fn().mockResolvedValue({ urls: ["a.mp3"], timings: null, cached: false }), kokoroProxy = null } = {}) {
  const svc = createVoiceService({
    providers: {
      google: createGoogleProvider({ callFn }),
      kokoro: createKokoroProvider({ synthViaProxy: kokoroProxy }),
    },
    getAiSettings: () => aiSettings,
  });
  return { svc, callFn };
}

describe("VoiceService — resolves voiceId → provider → providerVoiceId", () => {
  it("article domain (default) routes to Google with the right cache key; no provider ids leak to the consumer", async () => {
    const { svc, callFn } = service();
    const out = await svc.synthesize({ text: "Hello.", domain: "article", refId: "art1" });
    // Consumer sees the APP voice id + provider name only — never af_* / Neural2.
    expect(out.voiceId).toBe("google-neural");
    expect(out.provider).toBe("google");
    expect(out.urls).toEqual(["a.mp3"]);
    // The cache key is the content-addressed identity for the resolved provider voice.
    const expectedKey = ttsCacheKey({ text: "Hello.", provider: "google", providerVoiceId: "en-US-Neural2-D", model: GOOGLE_MODEL, speed: 1, speedInAudio: false });
    expect(out.cacheKey).toBe(expectedKey);
    expect(callFn).toHaveBeenCalledWith("generate-tts", { articleId: "art1", text: "Hello.", cacheKey: expectedKey });
  });

  it("an explicit voiceId (e.g. a preview) overrides the domain preference", async () => {
    const { svc } = service({ kokoroProxy: vi.fn().mockResolvedValue({ urls: ["k.mp3"], timings: null }) });
    const out = await svc.synthesize({ text: "hi", domain: "article", voiceId: "bella" });
    expect(out.voiceId).toBe("bella");
    expect(out.provider).toBe("kokoro");
  });

  it("a per-domain preference override selects a different provider", async () => {
    const { svc } = service({
      aiSettings: { voice: { default: { voiceId: "google-neural" }, overrides: { assistant: { voiceId: "bella" } } } },
      kokoroProxy: vi.fn().mockResolvedValue({ urls: ["k.mp3"], timings: null }),
    });
    expect((await svc.synthesize({ text: "x", domain: "assistant" })).provider).toBe("kokoro");
    expect((await svc.synthesize({ text: "x", domain: "article" })).provider).toBe("google");
  });
});

describe("VoiceService — errors are explicit (no silent provider swap)", () => {
  it("unknown voice throws", async () => {
    const { svc } = service({ aiSettings: { voice: { default: { voiceId: "ghost" } } } });
    await expect(svc.synthesize({ text: "x", domain: "article" })).rejects.toThrow(/unknown voice/i);
  });
  it("selecting an unconfigured Kokoro voice throws — does NOT fall back to Google (privacy boundary §7)", async () => {
    const { svc, callFn } = service({ aiSettings: { voice: { default: { voiceId: "bella" } } } }); // kokoroProxy null
    await expect(svc.synthesize({ text: "secret email", domain: "email" })).rejects.toThrow(/not configured/i);
    expect(callFn).not.toHaveBeenCalled(); // private text never reached Google
  });
});

describe("VoiceService — read helpers for Settings/previews", () => {
  it("voiceForDomain reports the resolved voice + speed", () => {
    const { svc } = service({ aiSettings: { voice: { default: { voiceId: "google-neural", speed: 1.25 } } } });
    const r = svc.voiceForDomain("article");
    expect(r.voiceId).toBe("google-neural");
    expect(r.speed).toBe(1.25);
    expect(r.voice.displayName).toBe("Standard (Google)");
  });
  it("capabilities() reflects the voice's provider", () => {
    const { svc } = service();
    expect(svc.capabilities("google-neural").wordTimings).toBe(true);
    expect(svc.capabilities("bella").model).toBe("kokoro-v1");
  });
});
