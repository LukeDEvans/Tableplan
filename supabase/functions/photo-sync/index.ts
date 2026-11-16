// photo-sync — the photo sync protocol (PHOTOS_DESIGN.md §17). Supabase Edge Function.
//
// Lets a device keep adding its owner's photos to Personal Photos while Liv is closed
// (iOS background tasks today; any client tomorrow — nothing here is Apple-specific).
// Every rule about what a device may do lives in the database
// (migrations/2026-11-16b-photo-sync-devices.sql); this function checks request
// shapes, turns the device's secret into its hash, relays to those functions with
// the service key, and signs thumbnail uploads.
//
// One POST endpoint, body { op, ... }:
//   register  — Authorization: Bearer <the person's sign-in>. { deviceKey, name }
//               → { deviceId, secret }. The secret is shown once; the database keeps
//               its SHA-256. Registering again replaces the device's earlier key.
//   Everything else — header x-photo-device: "<deviceId>.<secret>":
//   mine  { ids ≤200 }                       → { items: [{ id, has_thumb }] }
//   add   { items ≤100 }                     → { ids }   (records + this device as source)
//   sign  { items ≤25: [{ id, size }] }      → { urls: [{ url, headers }] }  PUT ph/<id>/thumb
//   done  { ids ≤200, bytes ≤200 }           → { count }
//   update { items ≤100 }                    → { count }  (a photo changed on the phone)
//   gone  { ids ≤200 }                       → { count }  (photos deleted on the phone)
//
// Secrets: DOC_S3_* (the R2 bucket, shared with doc-storage). Provided by Supabase:
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// PHOTO_SYNC_DISABLED=1 switches it off.

import { presignS3 } from "./s3-presign.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url
const MAX_THUMB = 2 * 1024 * 1024;
const EXPIRES = 600;

const ALLOWED_ORIGINS = [
  /^https:\/\/effervescent-malabi-e0af55\.netlify\.app$/,
  /^https:\/\/[a-z0-9-]+--effervescent-malabi-e0af55\.netlify\.app$/,
  /^capacitor:\/\/localhost$/,
  /^http:\/\/localhost:4174$/,
  /^http:\/\/127\.0\.0\.1:4174$/,
];
function cors(origin: string | null): Record<string, string> {
  const ok = origin && ALLOWED_ORIGINS.some((re) => re.test(origin));
  return {
    ...(ok ? { "access-control-allow-origin": origin! } : {}),
    "access-control-allow-headers": "authorization, content-type, apikey, x-client-info, x-photo-device",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "origin",
  };
}
function reply(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors(origin) } });
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
async function sha256Hex(s: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}
function newSecret() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Calls a database function with the service key. Errors from the function's own
// checks (an unknown or revoked device) come back as 401.
async function rpc(fn: string, args: Record<string, unknown>) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}` },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    let code = "";
    try { code = JSON.parse(text)?.code || ""; } catch { /* not JSON */ }
    const err = new Error(`rpc ${fn} ${res.status}`) as Error & { status: number };
    err.status = code === "42501" ? 401 : (code === "22023" || code === "22P02" || code === "23514" ? 400 : 502);
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const int = (v: unknown, lo: number, hi: number) => { const n = num(v, lo, hi); return n === null ? null : Math.round(n); };
const isoOrNull = (v: unknown) => { if (typeof v !== "string") return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };

// Only the fields a record may carry, each checked; anything else is dropped.
// `update` sends the same shape without local_id (the id already names the photo).
function cleanItem(raw: Record<string, unknown>, needLocalId = true) {
  if (!raw || typeof raw !== "object" || !UUID_RE.test(String(raw.id || ""))) return null;
  const localId = typeof raw.local_id === "string" && raw.local_id.length >= 1 && raw.local_id.length <= 300 ? raw.local_id : null;
  if (!localId && needLocalId) return null;
  const kind = raw.kind === "video" ? "video" : "photo";
  return {
    id: String(raw.id).toLowerCase(),
    local_id: localId,
    kind,
    is_screenshot: raw.is_screenshot === true,
    is_live: raw.is_live === true,
    burst_id: typeof raw.burst_id === "string" && raw.burst_id.length <= 100 ? raw.burst_id : null,
    taken_at: isoOrNull(raw.taken_at),
    width: int(raw.width, 0, 100000),
    height: int(raw.height, 0, 100000),
    duration: kind === "video" ? num(raw.duration, 0, 86400) : null,
    bytes: int(raw.bytes, 0, 50_000_000_000),
    lat: num(raw.lat, -90, 90),
    lng: num(raw.lng, -180, 180),
    favorite: raw.favorite === true,
    thumb_bytes: int(raw.thumb_bytes, 0, MAX_THUMB) || 0,
  };
}

const uuids = (v: unknown, max: number) => (Array.isArray(v) && v.length >= 1 && v.length <= max && v.every((x) => typeof x === "string" && UUID_RE.test(x)) ? (v as string[]).map((x) => x.toLowerCase()) : null);

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return reply(405, { error: "method" }, origin);
  if (Deno.env.get("PHOTO_SYNC_DISABLED") === "1") return reply(503, { error: "disabled" }, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "json" }, origin); }
  const op = typeof body?.op === "string" ? body.op : "";

  try {
    if (op === "register") {
      const auth = req.headers.get("authorization") || "";
      if (!/^Bearer [A-Za-z0-9._-]+$/.test(auth)) return reply(401, { error: "sign in" }, origin);
      const deviceKey = String(body.deviceKey || "");
      if (!DEVICE_KEY_RE.test(deviceKey)) return reply(400, { error: "device" }, origin);
      const who = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, { headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY")!, authorization: auth } });
      if (!who.ok) return reply(401, { error: "sign in" }, origin);
      const userId = (await who.json())?.id;
      if (!UUID_RE.test(String(userId || ""))) return reply(401, { error: "sign in" }, origin);
      const secret = newSecret();
      const name = typeof body.name === "string" ? body.name.slice(0, 60) : "";
      const deviceId = await rpc("photo_sync_register", { p_user: userId, p_device_key: deviceKey, p_name: name, p_secret_hash: await sha256Hex(secret) });
      return reply(200, { deviceId, secret }, origin);
    }

    const cred = req.headers.get("x-photo-device") || "";
    const dot = cred.indexOf(".");
    const deviceId = cred.slice(0, dot);
    const secret = cred.slice(dot + 1);
    if (dot < 0 || !UUID_RE.test(deviceId) || !SECRET_RE.test(secret)) return reply(401, { error: "device" }, origin);
    const dev = { p_device: deviceId, p_secret_hash: await sha256Hex(secret) };

    if (op === "mine") {
      const ids = uuids(body.ids, 200);
      if (!ids) return reply(400, { error: "ids" }, origin);
      const known = await rpc("photo_sync_device", dev);
      if (!Array.isArray(known) || !known.length) return reply(401, { error: "device" }, origin);
      const items = await rpc("photo_sync_mine", { ...dev, p_ids: ids });
      return reply(200, { items: items || [] }, origin);
    }

    if (op === "add") {
      const raw = Array.isArray(body.items) ? body.items : null;
      if (!raw || raw.length < 1 || raw.length > 100) return reply(400, { error: "items" }, origin);
      const items = raw.map((r) => cleanItem(r as Record<string, unknown>));
      if (items.some((i) => !i)) return reply(400, { error: "item" }, origin);
      const ids = await rpc("photo_sync_add", { ...dev, p_items: items });
      return reply(200, { ids: (ids || []).map((r: unknown) => (typeof r === "string" ? r : (r as { photo_sync_add?: string })?.photo_sync_add)).filter(Boolean) }, origin);
    }

    if (op === "sign") {
      const raw = Array.isArray(body.items) ? body.items as Array<{ id?: unknown; size?: unknown }> : null;
      if (!raw || raw.length < 1 || raw.length > 25) return reply(400, { error: "items" }, origin);
      if (!raw.every((r) => r && UUID_RE.test(String(r.id || "")) && Number.isInteger(r.size) && (r.size as number) >= 1 && (r.size as number) <= MAX_THUMB)) {
        return reply(400, { error: "item" }, origin);
      }
      const ids = raw.map((r) => String(r.id).toLowerCase());
      const known = await rpc("photo_sync_device", dev);
      if (!Array.isArray(known) || !known.length) return reply(401, { error: "device" }, origin);
      const mine = await rpc("photo_sync_mine", { ...dev, p_ids: ids });
      const allowed = new Set((mine || []).map((r: { id: string }) => r.id));
      if (!ids.every((id) => allowed.has(id))) return reply(403, { error: "photo" }, origin);
      const endpoint = Deno.env.get("DOC_S3_ENDPOINT");
      const bucket = Deno.env.get("DOC_S3_BUCKET");
      const accessKeyId = Deno.env.get("DOC_S3_ACCESS_KEY_ID");
      const secretAccessKey = Deno.env.get("DOC_S3_SECRET_ACCESS_KEY");
      if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return reply(503, { error: "not configured" }, origin);
      const region = Deno.env.get("DOC_S3_REGION") || "auto";
      const urls = await Promise.all(raw.map(async (r, i) => ({
        url: await presignS3({ method: "PUT", endpoint, bucket, key: `ph/${ids[i]}/thumb`, region, accessKeyId, secretAccessKey, expires: EXPIRES, headers: { "content-length": String(r.size) } }),
        headers: {},
      })));
      return reply(200, { urls }, origin);
    }

    if (op === "done") {
      const ids = uuids(body.ids, 200);
      const bytes = Array.isArray(body.bytes) && body.bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= MAX_THUMB) ? body.bytes as number[] : null;
      if (!ids || !bytes || bytes.length !== ids.length) return reply(400, { error: "ids" }, origin);
      const count = await rpc("photo_sync_done", { ...dev, p_ids: ids, p_bytes: bytes });
      return reply(200, { count: Number(count) || 0 }, origin);
    }

    if (op === "update") {
      const raw = Array.isArray(body.items) ? body.items : null;
      if (!raw || raw.length < 1 || raw.length > 100) return reply(400, { error: "items" }, origin);
      const items = raw.map((r) => cleanItem(r as Record<string, unknown>, false));
      if (items.some((i) => !i)) return reply(400, { error: "item" }, origin);
      const count = await rpc("photo_sync_update", { ...dev, p_items: items });
      return reply(200, { count: Number(count) || 0 }, origin);
    }

    if (op === "gone") {
      const ids = uuids(body.ids, 200);
      if (!ids) return reply(400, { error: "ids" }, origin);
      const count = await rpc("photo_sync_gone", { ...dev, p_ids: ids });
      return reply(200, { count: Number(count) || 0 }, origin);
    }

    return reply(400, { error: "op" }, origin);
  } catch (error) {
    const status = (error as { status?: number })?.status || 502;
    return reply(status, { error: status === 401 ? "device" : status === 400 ? "request" : "upstream" }, origin);
  }
});
