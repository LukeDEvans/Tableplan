// Shared Kokoro synth-to-Storage writer.
//
// The pre-synth background job and the (session-gated) kokoro-tts proxy both need
// to render a chunk of text on the box and store the MP3 in Supabase under the
// content-addressed key the incremental player reads. This module owns that write
// so the two producers are byte-identical: same object path (`<keyPrefix>/0.mp3`),
// same meta (`<keyPrefix>/meta.json` = { count:1, version, ... }), same public URL.
// Any divergence would leave pre-rendered audio un-findable (silent cache miss),
// so the layout constants here MUST match kokoro-tts.mjs (FORMAT_VERSION included).
//
// Pure-ish (only fetch); no DOM, no app globals. The caller passes the box URL +
// token and the Supabase service key, so this never reaches into env itself.

import { categorizeFetchError, errorForStatus, KOKORO_ERRORS } from "./kokoro-core.mjs";

export const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
export const BUCKET = "article-audio";
export const FORMAT_VERSION = 1; // MUST match kokoro-tts.mjs

function tag(err, code) { const e = err instanceof Error ? err : new Error(String(err)); e.kokoroCode = code; return e; }

// POST one chunk to the box; return raw MP3 bytes. Throws Error w/ `.kokoroCode`.
export async function synthChunk(url, token, text, voice, speed, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
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

export function publicUrl(path) { return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`; }

export async function getStorageJson(serviceKey, path) {
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function uploadBuffer(serviceKey, path, buffer, contentType) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "content-type": contentType, "cache-control": "31536000", "x-upsert": "true" },
    body: buffer,
  });
  return res.ok;
}

// Render ONE chunk into storage under keyPrefix, matching the incremental layout
// (a single-segment folder: 0.mp3 + meta.json {count:1}). Idempotent: if a valid
// meta already exists it skips the box entirely. Returns { url, cached }.
export async function renderChunkToStorage({ keyPrefix, text, voice, speed, kokoroUrl, kokoroToken, serviceKey, timeoutMs }) {
  const url = publicUrl(`${keyPrefix}/0.mp3`);
  const existing = await getStorageJson(serviceKey, `${keyPrefix}/meta.json`);
  if (existing?.count && existing.version === FORMAT_VERSION) return { url, cached: true };

  const audio = await synthChunk(kokoroUrl, kokoroToken, text, voice, speed, timeoutMs);
  if (!(await uploadBuffer(serviceKey, `${keyPrefix}/0.mp3`, audio, "audio/mpeg"))) {
    throw tag(new Error("upload failed"), KOKORO_ERRORS.SYNTHESIS_FAILED);
  }
  await uploadBuffer(serviceKey, `${keyPrefix}/meta.json`, Buffer.from(JSON.stringify({ count: 1, version: FORMAT_VERSION, timings: null, generatedAt: new Date().toISOString() })), "application/json");
  return { url, cached: false };
}
