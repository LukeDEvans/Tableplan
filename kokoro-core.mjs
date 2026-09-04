// Pure, I/O-free core for the kokoro-tts proxy (Phase 1A).
//
// Everything here is deterministic and testable: request validation, the voice
// allowlist (the server-side guard that stops a client bypassing the Voice
// Registry), text chunking, path sanitizing, and error categorization. The
// kokoro-tts.mjs handler wires these to auth, the home Kokoro server, and Storage.
//
// Shared by the ESM Netlify function (imported via netlify.toml included_files)
// and the unit tests, so the two never drift.

// Typed provider errors — surfaced to the client as { code, error } so the app's
// higher-level recovery can branch, and so raw infrastructure detail never leaks.
export const KOKORO_ERRORS = Object.freeze({
  UNAVAILABLE:       "KOKORO_UNAVAILABLE",        // server not configured / unreachable (retryable)
  TIMEOUT:           "KOKORO_TIMEOUT",            // synthesis stalled (retryable)
  AUTH_FAILED:       "KOKORO_AUTH_FAILED",        // proxy↔home-server auth rejected (not retryable)
  INVALID_REQUEST:   "KOKORO_INVALID_REQUEST",    // malformed client request (not retryable)
  UNSUPPORTED_VOICE: "KOKORO_UNSUPPORTED_VOICE",  // voice not in the allowlist (not retryable)
  SYNTHESIS_FAILED:  "KOKORO_SYNTHESIS_FAILED",   // home server returned an error/bad audio
});

// The ONLY provider voice ids the proxy will forward. Tracks voice-registry.js's
// Kokoro entries; a client cannot request an arbitrary voice or model path.
export const KOKORO_VOICES = Object.freeze([
  "af_bella", "af_nicole", "af_sarah", "af_sky", "am_adam", "am_michael",
]);

export const MAX_TTS_CHARS = 60000;   // reject absurd payloads (≈ a very long article)
// Per home-server request. Kept small so a single warm synth finishes well inside
// the proxy's home-server timeout (which itself must stay under Netlify's ~10s
// synchronous-function cap — see kokoro-tts.mjs HOME_TIMEOUT_MS). Smaller chunks
// also mean faster time-to-first-audio for the incremental (chunk-by-chunk) path.
export const MAX_CHUNK_CHARS = 800;
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2.0;

// Validate + normalize a client request. Returns { ok, code?, error?, value? }
// where value = { text, voice, speed }. Never throws.
export function validateKokoroRequest(body) {
  const b = body && typeof body === "object" ? body : {};
  const text = typeof b.text === "string" ? b.text : null;
  if (!text || !text.trim()) return fail(KOKORO_ERRORS.INVALID_REQUEST, "text is required");
  if (text.length > MAX_TTS_CHARS) return fail(KOKORO_ERRORS.INVALID_REQUEST, "text too long");

  const voice = typeof b.providerVoiceId === "string" ? b.providerVoiceId : "";
  if (!KOKORO_VOICES.includes(voice)) return fail(KOKORO_ERRORS.UNSUPPORTED_VOICE, "unsupported voice");

  // Speed: finite number, clamped to the supported range (garbage → invalid).
  let speed = b.speed == null ? 1 : Number(b.speed);
  if (!Number.isFinite(speed)) return fail(KOKORO_ERRORS.INVALID_REQUEST, "invalid speed");
  speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));

  return { ok: true, value: { text, voice, speed } };
}

function fail(code, error) { return { ok: false, code, error }; }

// Split text into ordered chunks no longer than maxChars, preferring sentence
// boundaries so a chunk never ends mid-word. Never returns an empty chunk; a
// single over-long "sentence" is hard-split. Deterministic.
export function chunkText(text, maxChars = MAX_CHUNK_CHARS) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]*\s*/g) || [clean];
  const chunks = [];
  let cur = "";
  for (const s of sentences) {
    if (s.length > maxChars) {                 // a monster sentence: flush + hard-split
      if (cur) { chunks.push(cur.trim()); cur = ""; }
      for (let i = 0; i < s.length; i += maxChars) chunks.push(s.slice(i, i + maxChars).trim());
      continue;
    }
    if (cur.length + s.length > maxChars) { chunks.push(cur.trim()); cur = s; }
    else cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

// One safe path segment (no "/", "..", spaces). Empty → "" so callers fall back.
export function sanitizeKey(k) {
  return String(k == null ? "" : k).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 160);
}

// Map a home-server HTTP status to a typed code.
export function errorForStatus(status) {
  if (status === 401 || status === 403) return KOKORO_ERRORS.AUTH_FAILED;
  if (status === 400 || status === 422) return KOKORO_ERRORS.INVALID_REQUEST;
  if (status === 404 || status === 502 || status === 503 || status === 504) return KOKORO_ERRORS.UNAVAILABLE;
  return KOKORO_ERRORS.SYNTHESIS_FAILED;
}

// Categorize a thrown fetch error (network/abort) into a typed code.
export function categorizeFetchError(err) {
  const name = err && (err.name || "");
  if (name === "AbortError") return KOKORO_ERRORS.TIMEOUT;
  return KOKORO_ERRORS.UNAVAILABLE; // DNS/connection refused/etc. — treat as unreachable
}

// Conservative retry policy — only transient categories. The SpeechQueue phase
// adds smarter playback-level recovery; the proxy must not cause synthesis storms.
export function isRetryable(code) {
  return code === KOKORO_ERRORS.TIMEOUT || code === KOKORO_ERRORS.UNAVAILABLE;
}
