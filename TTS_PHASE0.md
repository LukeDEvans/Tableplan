# TTS Phase 0 — Provider Seam + Cache Identity

Phase 0 of `KOKORO_VOICE_DESIGN.md`. A **behavior-preserving** architectural seam: existing article TTS works exactly as before, but TTS is no longer hardwired to one provider/voice and the cache is keyed by the synthesis configuration rather than the article id. **No playback/queue/UI/assistant changes.**

## 1. Provider architecture

```
consumer (today: article read-aloud)
    → getVoiceService().synthesize({ text, domain, refId })   [app.js]
        → resolveVoicePrefs(aiSettings, domain)               [voice-prefs.js]   → { voiceId, speed }
        → getVoice(voiceId)                                   [voice-registry.js] → { provider, providerVoiceId }
        → ttsCacheKey({ text, provider, providerVoiceId, model, speed }) [tts-cache-identity.js]
        → provider.synthesize({ text, refId, providerVoiceId, cacheKey })  [tts-provider.js]
            • google  → generate-tts Netlify fn (unchanged synthesis)
            • kokoro  → SEAM ONLY (throws until Phase 1 proxy is injected)
        → normalized { urls, timings, voiceId, provider, cacheKey }
```
Consumers request speech by **domain**; they never call Google/Kokoro directly and never see provider voice ids. Modules are pure/DOM-free (except the thin `app.js` singleton) and unit-tested.

## 2. Voice id → provider voice id

The registry (`voice-registry.js`) is the only place app ids map to provider ids:

| app voiceId | provider | providerVoiceId | availability |
|---|---|---|---|
| `google-neural` (**Phase 0 default**) | google | `en-US-Neural2-D` | available |
| `bella` (Phase 1 default) | kokoro | `af_bella` | unavailable |
| nicole / sarah / sky / adam / michael | kokoro | `af_*` / `am_*` | unavailable |

## 3. Cache identity

`ttsCacheKey({ text, provider, providerVoiceId, model, speed, speedInAudio })` = `provider_voice_model_speedmarker_hash(text)` — path-safe, deterministic. Speed is included **only** when a provider bakes it into the audio; today speed is applied at playback (engine rate), so `1.0×` and `1.25×` share one entry. Different voice/provider/model/text ⇒ different key (tested). The client computes it and passes it to `generate-tts`, which uses it as the Storage path prefix (sanitized; **falls back to `articleId`** when absent).

## 4. Current provider behavior

- **Google** is the working provider; article TTS output (chunked mp3 + per-word timings for highlighting) is byte-for-byte what it was — only the call routing + cache path changed.
- **Kokoro** is registered with real voice ids + capabilities so Settings/cache are correct now, but `synthesize()` throws `not configured` until Phase 1 (no fake endpoints, no client secrets). The VoiceService **never silently falls back** to Google, so private content can't be routed to an unintended provider.
- **Preferences** read from `config.aiSettings.voice` (global default + per-domain overrides, inherit); absent config resolves to the Google default at speed 1.0 — so **no state/migration change was needed** in Phase 0. The Settings UI that writes this arrives in Phase 3.

## 5. Remaining for Phase 1+

- `kokoro-tts` session-gated Netlify proxy → home-server Kokoro (bounded concurrency); inject `synthViaProxy`; flip default to `bella`; mark Kokoro voices available.
- Phase 2: SpeechQueue/Session consolidation + cancellation/recovery (the article→article reliability work).
- Phase 3: Settings → AI → Voice UI (voice browser, preview via VoiceService, speed, overrides) + persist `aiSettings.voice`.
- Phase 4: assistant/email/notification consumers.
- Provider-aware usage tracking (Phase 0 still records `google_tts` for the article path).

## 6. Migration / compatibility

- **No data migration.** `aiSettings.voice` is read-with-defaults; nothing is written yet.
- **Cache:** new requests write under the content-addressed key; **existing `article-audio/{articleId}/…` entries are orphaned and regenerate once on next play** (a deliberate, authorized tradeoff — legacy audio has no voice/speed identity to map to; `FORMAT_VERSION` already causes this class of one-time regen). The server keeps the `articleId` fallback so an older client mid-deploy still works.
- **Playback engine, `MEDIA_KINDS`, prefetch, `ttsResolvedUrls`, and the synchronous article→article hand-off were NOT touched.**
