// Voice Registry — the one source of truth for user-facing voices.
//
// Consumers and preferences reference stable APPLICATION voice ids ("bella").
// Provider-specific ids ("af_bella", "en-US-Neural2-D") live ONLY here, so the
// rest of the app is never coupled to Kokoro or Google identifiers.
//
// Phase 0: Google is the working provider, so its voice is `availability:
// "available"` and is the default. Kokoro voices are registered (names + real
// providerVoiceIds) but marked `"unavailable"` until the Phase 1 server proxy
// exists — the registry is complete so Settings/cache identity are correct now,
// without pretending Kokoro can synthesize yet.

export const VOICES = Object.freeze([
  // ── Google (current working provider) ──────────────────────────────────────
  { id: "google-neural", displayName: "Standard (Google)", provider: "google",
    providerVoiceId: "en-US-Neural2-D", language: "en-US", accent: "American",
    availability: "available" },

  // ── Kokoro (default target from Phase 1; seam only in Phase 0) ──────────────
  { id: "bella",   displayName: "Bella",   provider: "kokoro", providerVoiceId: "af_bella",   language: "en-US", accent: "American", availability: "unavailable" },
  { id: "nicole",  displayName: "Nicole",  provider: "kokoro", providerVoiceId: "af_nicole",  language: "en-US", accent: "American", availability: "unavailable" },
  { id: "sarah",   displayName: "Sarah",   provider: "kokoro", providerVoiceId: "af_sarah",   language: "en-US", accent: "American", availability: "unavailable" },
  { id: "sky",     displayName: "Sky",     provider: "kokoro", providerVoiceId: "af_sky",     language: "en-US", accent: "American", availability: "unavailable" },
  { id: "adam",    displayName: "Adam",    provider: "kokoro", providerVoiceId: "am_adam",    language: "en-US", accent: "American", availability: "unavailable" },
  { id: "michael", displayName: "Michael", provider: "kokoro", providerVoiceId: "am_michael", language: "en-US", accent: "American", availability: "unavailable" },
]);

const BY_ID = new Map(VOICES.map((v) => [v.id, v]));

// Phase 0 default = the working provider's voice, so existing article TTS is
// byte-for-byte preserved. Phase 1 flips this to "bella" once Kokoro is live.
export const DEFAULT_VOICE_ID = "google-neural";

export function getVoices({ provider, availableOnly = false } = {}) {
  return VOICES.filter((v) =>
    (!provider || v.provider === provider) &&
    (!availableOnly || v.availability === "available"));
}

export function getVoice(voiceId) {
  return BY_ID.get(voiceId) || null;
}

// voiceId → { provider, providerVoiceId }; null for an unknown voice. This is the
// ONLY place the app translates an app voice id to a provider-specific one.
export function resolveProviderVoice(voiceId) {
  const v = BY_ID.get(voiceId);
  return v ? { provider: v.provider, providerVoiceId: v.providerVoiceId } : null;
}
