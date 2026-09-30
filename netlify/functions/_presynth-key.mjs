// Shared-secret gate for the presynth background worker (SRV-7 / MED-2).
//
// presynth-tts-background burns Kokoro box time and writes to Storage with the
// service key, and was callable by anyone. presynth-cron now sends
// `x-presynth-key: HMAC(SUPABASE_SERVICE_ROLE_KEY, "presynth-v1")` (hex) and the
// worker rejects anything else — derived from an existing secret, no new env var.
import crypto from "node:crypto";

export const PRESYNTH_HEADER = "x-presynth-key";

export function presynthKey(serviceKey) {
  const s = String(serviceKey || "").trim();
  if (!s) return "";
  return crypto.createHmac("sha256", s).update("presynth-v1").digest("hex");
}

export function presynthKeyValid(provided, serviceKey) {
  const expected = presynthKey(serviceKey);
  if (!expected) return false;
  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(String(provided || "")).digest();
  return crypto.timingSafeEqual(a, b);
}

export function requestHeader(req, name) {
  try { return req?.headers?.get?.(name) || ""; } catch { return ""; }
}
