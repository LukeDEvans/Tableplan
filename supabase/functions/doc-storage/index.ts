// doc-storage — hands out short-lived upload / download / delete URLs for Documents'
// encrypted blobs (DOCUMENTS_DESIGN.md §5.2). Supabase Edge Function (Deno).
//
// The store's secret key lives only here (function secrets). A caller gets URLs
// only for scopes they may use, checked by asking Postgres as them
// (doc_can_access through PostgREST with their own token, so row security applies).
// Bytes never pass through this function, and it never sees a readable document:
// blobs are encrypted on the device.
//
// Secrets: DOC_S3_ENDPOINT (https://<account>.r2.cloudflarestorage.com),
//          DOC_S3_BUCKET, DOC_S3_ACCESS_KEY_ID, DOC_S3_SECRET_ACCESS_KEY,
//          DOC_S3_REGION (optional, "auto" for R2),
//          DOCUMENTS_STORAGE_DISABLED=1 to switch it off.
// Provided by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY.
//
// The home server later: point DOC_S3_ENDPOINT at it (Garage / MinIO speak the same API).

import { presignS3 } from "./s3-presign.js";

const PARTS = new Set(["content", "thumb", "text"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PART_BYTES = 70 * 1024 * 1024;
const MAX_BATCH = 25;
const EXPIRES = 600;
const METHOD: Record<string, string> = { put: "PUT", get: "GET", delete: "DELETE" };

const ALLOWED_ORIGINS = [
  /^https:\/\/effervescent-malabi-e0af55\.netlify\.app$/,
  /^https:\/\/[a-z0-9-]+--effervescent-malabi-e0af55\.netlify\.app$/,
  /^capacitor:\/\/localhost$/,
  /^http:\/\/localhost:4174$/, // the dev server (npm run dev:local)
  /^http:\/\/127\.0\.0\.1:4174$/,
];

// Other origins get no allow-origin header at all (never "null", which sandboxed
// frames send).
function cors(origin: string | null): Record<string, string> {
  const ok = origin && ALLOWED_ORIGINS.some((re) => re.test(origin));
  return {
    ...(ok ? { "access-control-allow-origin": origin! } : {}),
    "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "origin",
  };
}

function reply(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors(origin) } });
}

// Asks Postgres as the caller (their token, so row security applies).
async function ask(fn: string, args: Record<string, string>, auth: string): Promise<boolean> {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: Deno.env.get("SUPABASE_ANON_KEY")!, authorization: auth },
    body: JSON.stringify(args),
  });
  return res.ok && (await res.json()) === true;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return reply(405, { error: "method" }, origin);
  if (Deno.env.get("DOCUMENTS_STORAGE_DISABLED") === "1") return reply(503, { error: "disabled" }, origin);
  const endpoint = Deno.env.get("DOC_S3_ENDPOINT");
  const bucket = Deno.env.get("DOC_S3_BUCKET");
  const accessKeyId = Deno.env.get("DOC_S3_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("DOC_S3_SECRET_ACCESS_KEY");
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return reply(503, { error: "not configured" }, origin);

  const auth = req.headers.get("authorization") || "";
  if (!/^Bearer [A-Za-z0-9._-]+$/.test(auth)) return reply(401, { error: "sign in" }, origin);

  let body: { op?: string; items?: Array<{ scope?: string; fileId?: string; part?: string; size?: number } | null> };
  try { body = await req.json(); } catch { return reply(400, { error: "json" }, origin); }
  const op = (body && typeof body.op === "string" && body.op) || "";
  const items = (Array.isArray(body?.items) ? body.items : []) as Array<{ scope?: string; fileId?: string; part?: string; size?: number }>;
  if (!METHOD[op] || items.length < 1 || items.length > MAX_BATCH) return reply(400, { error: "request" }, origin);
  for (const it of items) {
    if (!it || typeof it !== "object") return reply(400, { error: "item" }, origin);
    if (!SCOPE_RE.test(it.scope || "") || !UUID_RE.test(it.fileId || "") || !PARTS.has(it.part || "")) return reply(400, { error: "item" }, origin);
    if (op === "put" && !(Number.isInteger(it.size) && it.size! >= 1 && it.size! <= MAX_PART_BYTES)) return reply(400, { error: "size" }, origin);
  }

  for (const scope of new Set(items.map((i) => i.scope!))) {
    if (!(await ask("doc_can_access", { p_scope: scope }, auth))) return reply(403, { error: "scope" }, origin);
  }
  // Blobs go only after 30 days in Recently deleted (or if the upload never got a row).
  if (op === "delete") {
    for (const fileId of new Set(items.map((i) => `${i.scope}|${i.fileId}`))) {
      const [scope, id] = fileId.split("|");
      if (!(await ask("doc_blob_deletable", { p_scope: scope, p_file: id }, auth))) return reply(403, { error: "not deletable yet" }, origin);
    }
  }

  const region = Deno.env.get("DOC_S3_REGION") || "auto";
  const urls = await Promise.all(items.map(async (it) => {
    const key = `${it.scope}/${it.fileId!.toLowerCase()}/${it.part}`;
    const headers: Record<string, string> = op === "put" ? { "content-length": String(it.size) } : {};
    const url = await presignS3({ method: METHOD[op], endpoint, bucket, key, region, accessKeyId, secretAccessKey, expires: EXPIRES, headers });
    // content-length is set by the browser from the body; it's signed so the size can't change.
    return { url, headers: {} };
  }));
  return reply(200, { urls }, origin);
});
