// TTSProvider contract + the two concrete providers.
//
// A provider turns a synthesis request into a NORMALIZED result; consumers never
// see provider HTTP/API details. The engine consumes ordered segment URLs, so the
// normalized result is simply:
//
//   { urls: string[], timings: any|null, cached?: boolean }
//
// Contract (Phase 0 subset — streaming/health come later, per the design's §27):
//   id
//   capabilities() -> { wordTimings, speedInAudio, model, ... }
//   listVoices()   -> provider's raw voices (the registry maps friendly ids)
//   synthesize({ text, refId, providerVoiceId, cacheKey, speed }) -> normalized result
//
// `cancel()` is intentionally omitted in Phase 0 — cancellation belongs to the
// SpeechQueue refactor (Phase 2), not the provider seam.

// ── Google ────────────────────────────────────────────────────────────────────
// Wraps the EXISTING generate-tts Netlify function. This does not change how
// Google synthesizes; it only routes the call and passes the content-addressed
// cache key. `callFn(name, body)` is injected so the provider is testable with a
// fake and never reaches into app globals.
//
// GOOGLE_MODEL must track generate-tts.js's actual voice + FORMAT_VERSION so a
// server-side voice/format change invalidates the cache. (Documented coupling —
// the single source of truth for identity is tts-cache-identity.js; this constant
// is only the model descriptor fed into it.)
export const GOOGLE_MODEL = "google-neural2d-v2"; // en-US-Neural2-D, generate-tts FORMAT_VERSION=2

export function createGoogleProvider({ callFn } = {}) {
  if (typeof callFn !== "function") throw new Error("createGoogleProvider requires a callFn(name, body)");
  return {
    id: "google",
    capabilities: () => ({ wordTimings: true, speedInAudio: false, ssml: true, model: GOOGLE_MODEL }),
    listVoices: () => [{ providerVoiceId: "en-US-Neural2-D", language: "en-US" }],
    async synthesize({ text, refId, cacheKey } = {}) {
      const res = await callFn("generate-tts", { articleId: refId, text, cacheKey });
      if (res?.error || !Array.isArray(res?.urls) || !res.urls.length) {
        throw new Error(res?.error || "TTS generation failed");
      }
      return { urls: res.urls, timings: res.timings || null, cached: !!res.cached };
    },
  };
}

// ── Kokoro ──────────────────────────────────────────────────────────────────
// Phase-0 SEAM ONLY. Declares its identity + capabilities (so the registry and
// cache key are correct today) but refuses to synthesize until the Phase-1
// session-gated `kokoro-tts` proxy exists. No fake endpoints, no client secrets:
// `synthViaProxy` stays null in Phase 0 and is injected in Phase 1.
export const KOKORO_MODEL = "kokoro-v1";

export function createKokoroProvider({ synthViaProxy = null } = {}) {
  return {
    id: "kokoro",
    capabilities: () => ({ wordTimings: false, speedInAudio: false, model: KOKORO_MODEL, configured: !!synthViaProxy }),
    listVoices: () => [], // the registry owns the friendly voice list + providerVoiceIds
    async synthesize(req) {
      if (typeof synthViaProxy !== "function") {
        throw new Error("Kokoro provider is not configured yet (Phase 1: session-gated kokoro-tts proxy).");
      }
      return synthViaProxy(req);
    },
  };
}
