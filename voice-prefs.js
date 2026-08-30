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
