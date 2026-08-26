import { describe, it, expect, vi } from "vitest";
import { createGoogleProvider, createKokoroProvider, GOOGLE_MODEL, KOKORO_MODEL } from "../tts-provider.js";

describe("Google provider — wraps generate-tts, normalizes result", () => {
  it("calls generate-tts with refId as articleId + text + cacheKey; returns normalized urls/timings", async () => {
    const callFn = vi.fn().mockResolvedValue({ urls: ["a.mp3", "b.mp3"], timings: [{ c: 0, t: 0 }], cached: false });
    const p = createGoogleProvider({ callFn });
    const out = await p.synthesize({ text: "hi", refId: "art1", cacheKey: "k1" });
    expect(callFn).toHaveBeenCalledWith("generate-tts", { articleId: "art1", text: "hi", cacheKey: "k1" });
    expect(out).toEqual({ urls: ["a.mp3", "b.mp3"], timings: [{ c: 0, t: 0 }], cached: false });
  });
  it("advertises word timings + model, speed applied at playback (not in audio)", () => {
    const caps = createGoogleProvider({ callFn: () => {} }).capabilities();
    expect(caps.wordTimings).toBe(true);
    expect(caps.speedInAudio).toBe(false);
    expect(caps.model).toBe(GOOGLE_MODEL);
  });
  it("throws on a provider error or empty urls (so callers fail loudly, as before)", async () => {
    await expect(createGoogleProvider({ callFn: () => ({ error: "boom" }) }).synthesize({})).rejects.toThrow(/boom/);
    await expect(createGoogleProvider({ callFn: () => ({ urls: [] }) }).synthesize({})).rejects.toThrow();
  });
  it("requires a callFn", () => {
    expect(() => createGoogleProvider({})).toThrow(/callFn/);
  });
});

describe("Kokoro provider — Phase 0 seam only", () => {
  it("declares identity + capabilities but is unconfigured (no fake endpoint)", () => {
    const p = createKokoroProvider();
    expect(p.id).toBe("kokoro");
    expect(p.capabilities()).toMatchObject({ model: KOKORO_MODEL, configured: false });
  });
  it("synthesize refuses until Phase 1 (never silently succeeds)", async () => {
    await expect(createKokoroProvider().synthesize({ text: "x" })).rejects.toThrow(/not configured/i);
  });
  it("uses the injected proxy when configured (Phase 1 wiring point)", async () => {
    const synthViaProxy = vi.fn().mockResolvedValue({ urls: ["k.mp3"], timings: null });
    const p = createKokoroProvider({ synthViaProxy });
    expect(p.capabilities().configured).toBe(true);
    expect(await p.synthesize({ text: "x" })).toEqual({ urls: ["k.mp3"], timings: null });
  });
});
