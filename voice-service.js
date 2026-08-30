// VoiceService — the seam every speech consumer uses.
//
//   consumer.synthesize({ text, domain })
//        → resolve prefs (voice-prefs) for the domain
//        → app voiceId → provider + providerVoiceId (voice-registry)
//        → content-addressed cache key (tts-cache-identity)
//        → provider.synthesize(...)   [Google today, Kokoro from Phase 1]
//        → normalized { urls, timings, voiceId, provider, cacheKey }
//
// The architectural rule: CONSUMERS REQUEST SPEECH; they never invoke Google or
// Kokoro directly, and never see provider-specific voice ids. Kept DOM-free and
// injectable (providers + a getAiSettings accessor) so it is unit-testable.

import { getVoices, getVoice, resolveProviderVoice } from "./voice-registry.js";
import { resolveVoicePrefs } from "./voice-prefs.js";
import { ttsCacheKey } from "./tts-cache-identity.js";

export function createVoiceService({ providers = {}, getAiSettings } = {}) {
  const providerFor = (id) => providers[id] || null;

  return {
    // Registry passthroughs (Settings + previews use these in later phases).
    getVoices,
    getVoice,
    resolveProviderVoice,
    capabilities(voiceId) {
      const v = getVoice(voiceId);
      const p = v && providerFor(v.provider);
      return p ? p.capabilities() : null;
    },

    // Resolve the effective voice for a domain without synthesizing (for UI).
    voiceForDomain(domain) {
      const prefs = resolveVoicePrefs(getAiSettings ? getAiSettings() : {}, domain);
      return { ...prefs, voice: getVoice(prefs.voiceId) };
    },

    // Request speech. `voiceId` overrides the domain preference (used by voice
    // previews in Phase 3). Throws — never silently swaps providers — so no
    // private content is routed to an unintended provider (design §7/§26).
    async synthesize({ text, domain = "article", refId, voiceId: explicit } = {}) {
      const prefs = resolveVoicePrefs(getAiSettings ? getAiSettings() : {}, domain);
      const voiceId = explicit || prefs.voiceId;
      const voice = getVoice(voiceId);
      if (!voice) throw new Error(`Unknown voice: ${voiceId}`);

      const provider = providerFor(voice.provider);
      if (!provider) throw new Error(`No provider registered for voice "${voiceId}" (${voice.provider})`);

      const caps = provider.capabilities ? provider.capabilities() : {};
      const cacheKey = ttsCacheKey({
        text,
        provider: voice.provider,
        providerVoiceId: voice.providerVoiceId,
        model: caps.model,
        speed: prefs.speed,
        speedInAudio: !!caps.speedInAudio,
      });

      const result = await provider.synthesize({
        text, refId, providerVoiceId: voice.providerVoiceId, cacheKey, speed: prefs.speed,
      });
      return { ...result, voiceId, provider: voice.provider, cacheKey };
    },
  };
}
