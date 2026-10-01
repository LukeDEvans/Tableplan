import { describe, it, expect } from "vitest";
import { resolveVoicePrefs, withDeviceArticleVoice, readableNativeVoices } from "../voice-prefs.js";

describe("withDeviceArticleVoice", () => {
  const synced = { voice: { default: { voiceId: "kokoro-heart", speed: 1.25 }, overrides: { assistant: { voiceId: "google-neural" } } } };

  it("makes articles use the Apple voice on this device, keeping the household speed", () => {
    const r = resolveVoicePrefs(withDeviceArticleVoice(synced, ""), "article");
    expect(r).toEqual({ voiceId: "device", speed: 1.25 });
  });

  it("honours a voice picked on this device", () => {
    expect(resolveVoicePrefs(withDeviceArticleVoice(synced, "kokoro-heart"), "article").voiceId).toBe("kokoro-heart");
  });

  it("leaves other domains and the synced object untouched", () => {
    const out = withDeviceArticleVoice(synced, "");
    expect(resolveVoicePrefs(out, "assistant").voiceId).toBe("google-neural");
    expect(resolveVoicePrefs(out, "email").voiceId).toBe("kokoro-heart");
    expect(synced.voice.overrides.article).toBeUndefined();
  });

  it("copes with missing settings", () => {
    expect(resolveVoicePrefs(withDeviceArticleVoice(undefined, null), "article").voiceId).toBe("device");
  });
});

describe("readableNativeVoices", () => {
  const vs = [
    { id: "c.samantha", name: "Samantha", lang: "en-US", quality: "default" },
    { id: "zarvox", name: "Zarvox", lang: "en-US", quality: "default", novelty: true },
    { id: "p.zoe", name: "Zoe", lang: "en-US", quality: "premium" },
    { id: "e.ava", name: "Ava", lang: "en-US", quality: "enhanced" },
    { id: "fr", name: "Thomas", lang: "fr-FR", quality: "enhanced" },
    { id: "p.ava", name: "Ava", lang: "en-US", quality: "premium" },
  ];
  it("drops novelty and non-English voices, best quality first", () => {
    expect(readableNativeVoices(vs, "").map((v) => v.id)).toEqual(["p.ava", "p.zoe", "e.ava", "c.samantha"]);
  });
  it("puts the automatic pick first within its tier", () => {
    expect(readableNativeVoices(vs, "p.zoe")[0].id).toBe("p.zoe");
  });
});
