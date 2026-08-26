// kokoro-tts — session-gated proxy from the app to the home Kokoro server.
//
//   authenticated client (VoiceService → Kokoro provider)
//        → THIS function (verifies the app session)
//        → server-to-server call to the home Kokoro server (URL + token from env)
//        → chunked MP3 audio stored in Storage, keyed by the Phase-0 cache id
//        → { urls, timings } — the SAME normalized shape the engine already plays
//
// Security boundary: the client never sees the home-server URL or token; it can
// only reach the home server THROUGH this authenticated function. The destination
// is fixed by env (SSRF-safe), the voice is allowlisted (kokoro-core), and no
// private text is ever logged. On any failure this returns a typed error and
// NEVER falls back to Google (design §14).
//
// Pure logic (validation/chunking/voices/errors) lives in ../../kokoro-core.js
// (bundled via netlify.toml included_files) and is unit-tested.
import {
  validateKokoroRequest, chunkText, sanitizeKey, errorForStatus, categorizeFetchError, KOKORO_ERRORS,
} from "../../kokoro-core.mjs";

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
// Reuse the existing article-audio bucket: the cache key already namespaces by
// provider (kokoro vs google), so Kokoro + Google audio never collide.
const BUCKET = "article-audio";
const FORMAT_VERSION = 1;      // kokoro meta format (client KOKORO_MODEL busts content)
const HOME_TIMEOUT_MS = 25000; // per-chunk home-server request timeout

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(json(200, {}));
  if (event.httpMethod !== "POST") return cors(json(405, { code: KOKORO_ERRORS.INVALID_REQUEST, error: "Method not allowed" }));

  const reqId = randomId();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const kokoroUrl = (process.env.KOKORO_URL || "").trim();
  const kokoroToken = (process.env.KOKORO_TOKEN || "").trim();

  if (!serviceKey) return cors(json(503, { code: KOKORO_ERRORS.UNAVAILABLE, error: clientMessage(KOKORO_ERRORS.UNAVAILABLE) }));
  // Home Kokoro not configured → explicit UNAVAILABLE. NEVER route the text to Google.
  if (!kokoroUrl || !kokoroToken) {
    log(reqId, { status: "unavailable", reason: "not-configured" });
    return cors(json(503, { code: KOKORO_ERRORS.UNAVAILABLE, error: clientMessage(KOKORO_ERRORS.UNAVAILABLE) }));
  }

  // Authenticate the app user via the existing session mechanism; never trust a
  // client-supplied id.
  const accessToken = bearer(event);
  if (!accessToken) return cors(json(401, { code: KOKORO_ERRORS.INVALID_REQUEST, error: "Not authenticated." }));
  if (!(await getUserId(accessToken, serviceKey))) return cors(json(401, { code: KOKORO_ERRORS.INVALID_REQUEST, error: "Invalid session." }));

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return cors(json(400, { code: KOKORO_ERRORS.INVALID_REQUEST, error: "Invalid JSON" })); }

  const v = validateKokoroRequest(body);
  if (!v.ok) {
    log(reqId, { status: "rejected", code: v.code, textLen: (typeof body?.text === "string" ? body.text.length : 0) });
    return cors(json(v.code === KOKORO_ERRORS.UNSUPPORTED_VOICE ? 400 : 400, { code: v.code, error: v.error }));
  }
  const { text, voice, speed } = v.value;

  // Storage path = the client's content-addressed cache key (Phase 0), which folds
  // in provider/voice/model/speed. Sanitized to one path segment (defense in depth).
  const keyPrefix = sanitizeKey(body.cacheKey) || sanitizeKey(body.refId) || `kokoro-${reqId}`;
  const started = Date.now();

  // Cache hit (same identity already synthesized)?
  const cached = await getStorageJson(serviceKey, `${keyPrefix}/meta.json`);
  if (cached?.count && cached.version === FORMAT_VERSION) {
    const urls = Array.from({ length: cached.count }, (_, i) => publicUrl(`${keyPrefix}/${i}.mp3`));
    log(reqId, { status: "hit", voice, count: cached.count });
    return cors(json(200, { urls, timings: cached.timings || null, cached: true }));
  }

  // Synthesize chunk by chunk (sequential = a natural throttle; the home server
  // bounds its own concurrency — see TTS_PHASE1A.md).
  const chunks = chunkText(text);
  const urls = [];
  for (let i = 0; i < chunks.length; i++) {
    let audio;
    try {
      audio = await synthChunk(kokoroUrl, kokoroToken, chunks[i], voice, speed);
    } catch (err) {
      const code = err.kokoroCode || categorizeFetchError(err);
      log(reqId, { status: "error", code, chunk: i, of: chunks.length, ms: Date.now() - started });
      return cors(json(statusFor(code), { code, error: clientMessage(code) }));
    }
    if (!(await uploadAudio(serviceKey, `${keyPrefix}/${i}.mp3`, audio))) {
      log(reqId, { status: "error", code: KOKORO_ERRORS.SYNTHESIS_FAILED, reason: "upload", chunk: i });
      return cors(json(502, { code: KOKORO_ERRORS.SYNTHESIS_FAILED, error: clientMessage(KOKORO_ERRORS.SYNTHESIS_FAILED) }));
    }
    urls.push(publicUrl(`${keyPrefix}/${i}.mp3`));
  }

  // Phase 1A: the base Kokoro model provides no word-level alignment, so timings
  // are null (article word-highlighting simply doesn't activate for Kokoro voices;
  // Google's highlighting is untouched — design §12). The meta reserves the field.
  await uploadJson(serviceKey, `${keyPrefix}/meta.json`, {
    count: chunks.length, version: FORMAT_VERSION, timings: null, generatedAt: new Date().toISOString(),
  });
  log(reqId, { status: "ok", voice, count: chunks.length, ms: Date.now() - started });
  return cors(json(200, { urls, timings: null, cached: false }));
};

// POST one chunk to the home server; return raw MP3 bytes. Throws Error with a
// `.kokoroCode` on a typed failure. The text is never logged.
async function synthChunk(url, token, text, voice, speed) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HOME_TIMEOUT_MS);
  let res;
  try {
    // Kokoro-FastAPI's OpenAI-compatible speech endpoint. KOKORO_URL must be the
    // FULL ".../v1/audio/speech" URL. The bearer is checked by the auth layer in
    // front of Kokoro (Caddy / Cloudflare) in production; Kokoro-FastAPI itself
    // ignores unknown headers, so local testing needs no auth. See KOKORO_SERVER_SETUP.md.
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, accept: "audio/mpeg" },
      body: JSON.stringify({ model: "kokoro", input: text, voice, speed, response_format: "mp3" }),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw tag(err, categorizeFetchError(err));
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw tag(new Error(`home ${res.status}`), errorForStatus(res.status));
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw tag(new Error("empty audio"), KOKORO_ERRORS.SYNTHESIS_FAILED);
  return buf;
}

// ── helpers ─────────────────────────────────────────────────────────────────
function tag(err, code) { const e = err instanceof Error ? err : new Error(String(err)); e.kokoroCode = code; return e; }

function statusFor(code) {
  switch (code) {
    case KOKORO_ERRORS.TIMEOUT: return 504;
    case KOKORO_ERRORS.UNAVAILABLE: return 503;
    case KOKORO_ERRORS.INVALID_REQUEST:
    case KOKORO_ERRORS.UNSUPPORTED_VOICE: return 400;
    default: return 502; // AUTH_FAILED / SYNTHESIS_FAILED — server-side, not the client's fault
  }
}

// Client-safe messages — never expose home-server URLs, tokens, or stack traces.
function clientMessage(code) {
  switch (code) {
    case KOKORO_ERRORS.UNAVAILABLE: return "The voice service is unavailable right now.";
    case KOKORO_ERRORS.TIMEOUT: return "Voice generation timed out.";
    case KOKORO_ERRORS.AUTH_FAILED: return "The voice service rejected the request.";
    case KOKORO_ERRORS.UNSUPPORTED_VOICE: return "That voice isn't available.";
    case KOKORO_ERRORS.INVALID_REQUEST: return "Invalid voice request.";
    default: return "Voice generation failed.";
  }
}

function bearer(event) {
  const h = event.headers?.authorization || event.headers?.Authorization || "";
  return h.replace(/^Bearer\s+/i, "").trim();
}

async function getUserId(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const user = await res.json();
    return user.id || null;
  } catch { return null; }
}

function publicUrl(path) { return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`; }

async function getStorageJson(serviceKey, path) {
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function uploadAudio(serviceKey, path, buffer) {
  return uploadBuffer(serviceKey, path, buffer, "audio/mpeg");
}
async function uploadJson(serviceKey, path, obj) {
  return uploadBuffer(serviceKey, path, Buffer.from(JSON.stringify(obj)), "application/json");
}
async function uploadBuffer(serviceKey, path, buffer, contentType) {
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "content-type": contentType, "cache-control": "31536000", "x-upsert": "true" },
      body: buffer,
    });
    return res.ok;
  } catch { return false; }
}

function randomId() { return Math.random().toString(36).slice(2, 10); }

// Metadata-only diagnostics — NEVER the request text/body (design §20).
function log(reqId, meta) { try { console.log("[kokoro-tts]", JSON.stringify({ reqId, ...meta })); } catch { /* noop */ } }

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}
function cors(response) {
  return { ...response, headers: { ...(response.headers || {}), "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" } };
}
