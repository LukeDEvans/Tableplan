// gmail-attachment — one email attachment, sent as the file's own bytes.
//
// The `attachment` action in gmail.js returns base64 inside JSON from a buffered
// function, so Netlify's ~6MB buffered-response limit counted the INFLATED size
// (base64 is ×1.33) and the app had to stop at 3.5MB. This function streams the
// raw bytes instead: no base64 on the way out, and streamed responses may be up
// to 20MB (Netlify Functions API docs). So the app can open attachments up to
// ATTACHMENT_STREAM_MAX here; only bigger ones go to Gmail.
//
// POST /.netlify/functions/gmail-attachment
//   headers: authorization: Bearer <Supabase access token>
//   body:    { messageId, attachmentId }
//   200 → the file's bytes, always as application/octet-stream with
//         Content-Disposition: attachment and nosniff. The SENDER controls an
//         attachment's declared type, so this endpoint never lets a browser
//         render it as HTML/SVG on our origin; the app decides how to show it.
//   413 { tooLarge: true } when the file is over the cap → app opens Gmail.
//
// Attachment bytes never touch Supabase: Gmail → this function → device. The only
// Supabase calls are the same two the gmail function makes (session + tokens).
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  getUserId, loadUserGmailTokens, getValidAccessToken, gFetch
} = require("./_gmail-shared.js");

// Streamed responses cap at 20MB; leave room for headers and rounding.
export const ATTACHMENT_STREAM_MAX = 19_500_000;
const CHUNK = 256 * 1024;

const ALLOWED_ORIGINS = new Set([
  "https://effervescent-malabi-e0af55.netlify.app",
  "capacitor://localhost",
  "http://localhost:4174",
  "http://127.0.0.1:4174"
]);

function corsHeaders(req) {
  const origin = req.headers.get("origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "Origin"
  };
}

function json(req, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...corsHeaders(req) }
  });
}

// Gmail returns base64url; Buffer understands it directly.
export function decodeGmailData(data) {
  return Buffer.from(String(data || ""), "base64url");
}

// A filename safe for a Content-Disposition header.
export function dispositionName(name) {
  const clean = String(name || "attachment").replace(/[\r\n"\\]/g, "").slice(0, 200) || "attachment";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

function streamOf(bytes) {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      const end = Math.min(offset + CHUNK, bytes.length);
      controller.enqueue(new Uint8Array(bytes.buffer, bytes.byteOffset + offset, end - offset));
      offset = end;
    }
  });
}

export default async (req, _context, deps = {}) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  const env = deps.env || process.env;
  const helpers = { getUserId, loadUserGmailTokens, getValidAccessToken, gFetch, ...(deps.helpers || {}) };
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return json(req, 503, { error: "Server not configured." });

  const accessToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return json(req, 401, { error: "Not authenticated." });
  const userId = await helpers.getUserId(accessToken, serviceKey);
  if (!userId) return json(req, 401, { error: "Invalid session." });

  let body;
  try { body = await req.json(); } catch { return json(req, 400, { error: "Invalid JSON" }); }
  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  const attachmentId = typeof body?.attachmentId === "string" ? body.attachmentId : "";
  if (!messageId || !attachmentId) return json(req, 400, { error: "messageId and attachmentId required" });

  const tokens = await helpers.loadUserGmailTokens(serviceKey, userId);
  if (!tokens?.refreshToken) return json(req, 400, { error: "Gmail not connected." });
  const { token: gToken, invalidGrant } = await helpers.getValidAccessToken(tokens, serviceKey, userId);
  if (invalidGrant) return json(req, 401, { error: "Gmail connection expired — please reconnect." });
  if (!gToken) return json(req, 503, { error: "Could not get Gmail access token." });

  const r = await helpers.gFetch(gToken, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
  if (!r.ok) return json(req, 502, { error: "Attachment fetch failed." });
  const data = await r.json();
  // Check the size before decoding: base64 is 4 chars per 3 bytes.
  const encodedLen = String(data?.data || "").length;
  if (Number(data?.size) > ATTACHMENT_STREAM_MAX || encodedLen * 0.75 > ATTACHMENT_STREAM_MAX + 4) {
    return json(req, 413, { error: "Attachment too large to open here — open it in Gmail.", tooLarge: true });
  }
  const bytes = decodeGmailData(data?.data);

  return new Response(streamOf(bytes), {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": dispositionName(body?.filename),
      "x-content-type-options": "nosniff",
      "x-attachment-size": String(bytes.length),
      "cache-control": "private, no-store",
      ...corsHeaders(req)
    }
  });
};
