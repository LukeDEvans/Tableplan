// Content-addressed identity for a unit of synthesized speech.
//
// The legacy cache keyed by article id alone (see generate-tts.js), which is
// correct only while there is exactly one voice. The moment the app supports
// multiple voices/providers/speeds, "Article A" can legitimately produce
// different audio, so the id MUST fold in everything that changes the bytes:
// the spoken text, the resolved provider + provider voice, the model/format
// version, and — ONLY if the provider bakes speed into the audio — the speed.
//
// Pure, deterministic, DOM-free, and path-safe (the result is used as a Storage
// path segment), so it is trivially unit-testable and identical on every device.

// cyrb53 — a fast, deterministic, non-cryptographic 53-bit string hash. Ample
// for a personal cache id (collision probability is negligible at this scale)
// and synchronous, so it never defers the generation path behind an await.
export function hashText(str) {
  const s = String(str == null ? "" : str);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(36);
}

// Lower-case, path-safe token; empty/absent collapses to a stable placeholder so
// keys never contain "/", "..", or other traversal characters.
function slug(v) {
  const s = String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
  return s || "x";
}

// The identity. `speed` participates ONLY when `speedInAudio` is true (a provider
// that bakes speed into the generated audio); when speed is applied at playback
// (the current engine.setRate approach) the audio bytes are speed-independent, so
// speed is excluded and 1.0x / 1.25x share one cache entry.
export function ttsCacheKey({ text, provider, providerVoiceId, model, speed, speedInAudio = false } = {}) {
  return [
    slug(provider),
    slug(providerVoiceId),
    slug(model),
    speedInAudio ? `s${slug(speed == null ? 1 : speed)}` : "splay",
    hashText(text),
  ].join("_");
}
