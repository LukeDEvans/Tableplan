import { describe, it, expect } from "vitest";
import {
  validateKokoroRequest, chunkText, sanitizeKey, errorForStatus, categorizeFetchError,
  isRetryable, KOKORO_ERRORS, KOKORO_VOICES, MAX_TTS_CHARS, MAX_CHUNK_CHARS, SPEED_MIN, SPEED_MAX,
} from "../kokoro-core.mjs";

const ok = { text: "Hello there.", providerVoiceId: "af_bella", speed: 1.0 };

describe("validateKokoroRequest", () => {
  it("accepts a well-formed request and normalizes it", () => {
    const r = validateKokoroRequest(ok);
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ text: "Hello there.", voice: "af_bella", speed: 1.0 });
  });
  it("rejects missing/blank/non-string text as INVALID_REQUEST", () => {
    for (const text of [undefined, "", "   ", 42]) {
      expect(validateKokoroRequest({ ...ok, text }).code).toBe(KOKORO_ERRORS.INVALID_REQUEST);
    }
  });
  it("rejects text over the max length", () => {
    expect(validateKokoroRequest({ ...ok, text: "a".repeat(MAX_TTS_CHARS + 1) }).code).toBe(KOKORO_ERRORS.INVALID_REQUEST);
  });
  it("rejects a voice outside the allowlist (cannot bypass the Voice Registry)", () => {
    expect(validateKokoroRequest({ ...ok, providerVoiceId: "af_hacker" }).code).toBe(KOKORO_ERRORS.UNSUPPORTED_VOICE);
    expect(validateKokoroRequest({ ...ok, providerVoiceId: "../../etc" }).code).toBe(KOKORO_ERRORS.UNSUPPORTED_VOICE);
    expect(validateKokoroRequest({ ...ok, providerVoiceId: undefined }).code).toBe(KOKORO_ERRORS.UNSUPPORTED_VOICE);
  });
  it("every allowlisted voice validates", () => {
    for (const v of KOKORO_VOICES) expect(validateKokoroRequest({ ...ok, providerVoiceId: v }).ok).toBe(true);
  });
  it("clamps speed to the supported range; rejects non-numeric", () => {
    expect(validateKokoroRequest({ ...ok, speed: 5 }).value.speed).toBe(SPEED_MAX);
    expect(validateKokoroRequest({ ...ok, speed: 0.1 }).value.speed).toBe(SPEED_MIN);
    expect(validateKokoroRequest({ ...ok, speed: undefined }).value.speed).toBe(1);
    expect(validateKokoroRequest({ ...ok, speed: "fast" }).code).toBe(KOKORO_ERRORS.INVALID_REQUEST);
  });
});

describe("chunkText", () => {
  it("returns [] for empty", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   ")).toEqual([]);
  });
  it("keeps a short text as a single chunk", () => {
    expect(chunkText("One. Two. Three.")).toEqual(["One. Two. Three."]);
  });
  it("splits on sentence boundaries, each chunk within maxChars, order preserved", () => {
    const sentences = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`);
    const chunks = chunkText(sentences.join(" "), 80);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(80);
    // reassembling preserves the words in order
    expect(chunks.join(" ").replace(/\s+/g, " ")).toContain("Sentence number 39 is here.");
  });
  it("hard-splits a single over-long sentence", () => {
    const chunks = chunkText("x".repeat(5000), 1000);
    expect(chunks.length).toBe(5);
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
  });
  it("defaults to MAX_CHUNK_CHARS", () => {
    expect(chunkText("word ".repeat(2000)).every((c) => c.length <= MAX_CHUNK_CHARS)).toBe(true);
  });
});

describe("sanitizeKey", () => {
  it("strips traversal/unsafe chars to one path segment", () => {
    expect(sanitizeKey("ab/../cd ef!")).toMatch(/^[a-z0-9_-]+$/);
    expect(sanitizeKey("ok_key-1")).toBe("ok_key-1");
    expect(sanitizeKey("")).toBe("");
  });
});

describe("error mapping & retry policy", () => {
  it("maps HTTP status to typed codes", () => {
    expect(errorForStatus(401)).toBe(KOKORO_ERRORS.AUTH_FAILED);
    expect(errorForStatus(400)).toBe(KOKORO_ERRORS.INVALID_REQUEST);
    expect(errorForStatus(503)).toBe(KOKORO_ERRORS.UNAVAILABLE);
    expect(errorForStatus(500)).toBe(KOKORO_ERRORS.SYNTHESIS_FAILED);
  });
  it("categorizes abort as TIMEOUT, other network errors as UNAVAILABLE", () => {
    expect(categorizeFetchError({ name: "AbortError" })).toBe(KOKORO_ERRORS.TIMEOUT);
    expect(categorizeFetchError(new Error("ECONNREFUSED"))).toBe(KOKORO_ERRORS.UNAVAILABLE);
  });
  it("only transient categories are retryable (no synthesis storms)", () => {
    expect(isRetryable(KOKORO_ERRORS.TIMEOUT)).toBe(true);
    expect(isRetryable(KOKORO_ERRORS.UNAVAILABLE)).toBe(true);
    expect(isRetryable(KOKORO_ERRORS.AUTH_FAILED)).toBe(false);
    expect(isRetryable(KOKORO_ERRORS.INVALID_REQUEST)).toBe(false);
    expect(isRetryable(KOKORO_ERRORS.UNSUPPORTED_VOICE)).toBe(false);
  });
});
