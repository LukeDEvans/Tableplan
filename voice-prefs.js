// Voice preference resolution — the config seam for the eventual Settings model.
//
// Preferences live at config.aiSettings.voice (household-scoped, synced) with a
// single global default and optional per-domain overrides; an absent override
// INHERITS the default (never duplicates it). Phase 0 only needs this resolver +
// the shape it reads; the Settings UI that writes it comes in Phase 3.
//
//   aiSettings.voice = {
//     default:  { voiceId: "google-neural", speed: 1.0 },
//     overrides: { assistant: null, article: null, email: null, notification: null },
//     enabledFor: { assistant: true, article: true, email: true, notification: true },
//   }
//
// Pure and DOM-free so inheritance/override behaviour is unit-tested directly.

import { DEFAULT_VOICE_ID } from "./voice-registry.js";

export const VOICE_DOMAINS = Object.freeze(["assistant", "article", "email", "notification"]);

function positiveNumOr(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

// Effective { voiceId, speed } for a domain: per-domain override wins, else the
// global default, else the registry default. Robust to a missing/garbage aiSettings.
export function resolveVoicePrefs(aiSettings, domain) {
  const voice = (aiSettings && typeof aiSettings.voice === "object" && aiSettings.voice) || {};
  const def = (voice.default && typeof voice.default === "object") ? voice.default : {};
  const override = (voice.overrides && typeof voice.overrides === "object") ? voice.overrides[domain] : null;
  const ov = (override && typeof override === "object") ? override : {};

  const voiceId = ov.voiceId || def.voiceId || DEFAULT_VOICE_ID;
  const speed = positiveNumOr(ov.speed, positiveNumOr(def.speed, 1));
  return { voiceId, speed };
}

// Whether the AI voice is enabled for a domain ("Use AI voice for …"). Default on
// so absent config keeps existing behaviour.
export function voiceEnabledForDomain(aiSettings, domain) {
  const enabled = aiSettings?.voice?.enabledFor;
  return !enabled || enabled[domain] !== false;
}

// A per-device article voice layered over the synced (household) settings. The
// iPhone app reads articles with the on-device Apple voice ("device") so they
// keep playing with the phone locked, while the web keeps the household's
// chosen voice. `deviceVoiceId` falls back to "device"; speed still comes from
// the synced settings. Returns a new object; `aiSettings` isn't changed.
export function withDeviceArticleVoice(aiSettings, deviceVoiceId) {
  const ai = (aiSettings && typeof aiSettings === "object") ? aiSettings : {};
  const voice = (ai.voice && typeof ai.voice === "object") ? ai.voice : {};
  const overrides = (voice.overrides && typeof voice.overrides === "object") ? voice.overrides : {};
  const article = (overrides.article && typeof overrides.article === "object") ? overrides.article : {};
  return {
    ...ai,
    voice: { ...voice, overrides: { ...overrides, article: { ...article, voiceId: deviceVoiceId || "device" } } },
  };
}

// The Apple voices worth listing for reading: English, no novelty voices, best
// quality first. `defaultId` (the plugin's automatic pick) leads its tier.
export function readableNativeVoices(voices, defaultId) {
  const rank = { premium: 0, enhanced: 1, default: 2 };
  return (Array.isArray(voices) ? voices : [])
    .filter((v) => v && v.id && /^en/i.test(v.lang || "") && !v.novelty)
    .sort((a, b) =>
      ((rank[a.quality] ?? 3) - (rank[b.quality] ?? 3)) ||
      ((b.id === defaultId) - (a.id === defaultId)) ||
      String(a.name).localeCompare(String(b.name)));
}
