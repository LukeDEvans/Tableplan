// liv-mcp — Liv as an MCP server for outside AI assistants (Claude Duet first).
// Supabase Edge Function; plan and decisions in DUET_CONNECTOR_DESIGN.md.
//
// Transport: MCP Streamable HTTP, stateless — POST one JSON-RPC message, get one
// JSON answer (no sessions, no server-sent events). GET/DELETE → 405.
//
// Who may call it: a holder of an assistant connector key "<keyId>.<secret>"
// (migrations/2026-11-17-assistant-connector-keys.sql), sent as either
//   Authorization: Bearer <key>     (claude.ai custom connector › Request headers)
//   x-api-key: <key>
//   …/liv-mcp/k/<key>               (fallback when request headers aren't offered;
//                                    the key then sits in the URL — revoke and
//                                    re-mint if that URL is ever shared)
// The database keeps only the SHA-256 of the secret, checks it, counts the call
// against the key's rate limit (120 per 10 min) and says whose key it is. The
// gateway's JWT check is off for this function (the key isn't a JWT).
//
// What a key can read, and how, is tools.bundle.js (built from tools.js —
// `npm run build:liv-mcp`; a test fails when it's out of date).
//
// Provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Optional secret: LIV_MCP_DISABLED=1 switches it off (every call → 503).

import { handleRpc } from "./tools.bundle.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_BODY = 64 * 1024;

const env = (k: string) => (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k);

function json(status: number, body: unknown, extra: Record<string, string> = {}) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { ...(body == null ? {} : { "content-type": "application/json" }), "cache-control": "no-store", ...extra },
  });
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
async function sha256Hex(s: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

export function keyFrom(req: Request): string {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  if (m) return m[1];
  const x = req.headers.get("x-api-key");
  if (x) return x.trim();
  const p = new URL(req.url).pathname.match(/\/k\/([^/]+)\/?$/);
  return p ? decodeURIComponent(p[1]) : "";
}

function svc() {
  const url = env("SUPABASE_URL")!;
  const key = env("SUPABASE_SERVICE_ROLE_KEY")!;
  const headers = { apikey: key, authorization: `Bearer ${key}`, accept: "application/json" };
  async function get(path: string) {
    const res = await fetch(`${url}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(`read ${res.status}`);
    return res.json();
  }
  async function rpc(fn: string, args: Record<string, unknown>) {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(args) });
    if (!res.ok) throw new Error(`rpc ${fn} ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  return { get, rpc };
}

// Only columns that exist in prod (checked 2026-11-17): eat_recipes has no
// prep_time / cook_time there (the app's loader falls back without them), and
// asking PostgREST for a missing column is a 400.
const RECIPE_COLUMNS = "id,name,time,servings,source_url,ingredients,steps,tags";

// The one database surface tools.js sees.
function makeDb(s: ReturnType<typeof svc>) {
  return {
    row: (id: string, keys: string[]) => s.rpc("assistant_state_read", { p_row: id, p_paths: keys }),
    async recipes(ids: string[] | null) {
      if (ids && !ids.length) return [];
      const filter = ids ? `&id=in.(${ids.map((i) => `"${String(i).replace(/["\\]/g, "")}"`).join(",")})` : "";
      return s.get(`eat_recipes?select=${RECIPE_COLUMNS}${filter}&order=name.asc`);
    },
  };
}

async function contextFor(s: ReturnType<typeof svc>, userId: string, scopes: string[]) {
  const enc = encodeURIComponent(userId);
  const [groups, spaces] = await Promise.all([
    s.get(`live_group_members?user_id=eq.${enc}&select=group_id,role&order=joined_at.asc,group_id.asc&limit=1`),
    s.get(`live_space_members?user_id=eq.${enc}&select=space_id&order=joined_at.asc&limit=1`),
  ]);
  const g = groups?.[0];
  if (!g?.group_id) return null;
  return { userId, groupId: g.group_id, role: g.role || "member", spaceId: spaces?.[0]?.space_id || "", scopes };
}

export async function handle(req: Request): Promise<Response> {
  if (env("LIV_MCP_DISABLED") === "1") return json(503, { error: "disabled" });
  if (req.method === "OPTIONS") return json(204, null, { allow: "POST, OPTIONS" });
  if (req.method !== "POST") return json(405, { error: "POST only" }, { allow: "POST, OPTIONS" });

  const key = keyFrom(req);
  const [keyId, secret] = key.split(".");
  const unauthorized = () => json(401, { error: "A valid Liv connector key is required." });
  if (!UUID_RE.test(keyId || "") || !SECRET_RE.test(secret || "")) return unauthorized();

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { error: "too large" });
  let msg: unknown;
  try { msg = JSON.parse(raw); } catch { return json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  if (Array.isArray(msg)) return json(400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batches aren't supported" } });

  const s = svc();
  let who: { user_id: string; scopes: string[]; limited: boolean } | undefined;
  try {
    const rows = await s.rpc("assistant_connector_check", { p_key: keyId, p_secret_hash: await sha256Hex(secret) });
    who = Array.isArray(rows) ? rows[0] : undefined;
  } catch {
    return json(502, { error: "Couldn't check the key." });
  }
  if (!who) return unauthorized();
  if (who.limited) return json(429, { error: "Too many calls — try again in a few minutes." }, { "retry-after": "600" });

  let ctx;
  try { ctx = await contextFor(s, who.user_id, who.scopes || []); } catch { return json(502, { error: "Couldn't load the account." }); }
  if (!ctx) return json(403, { error: "This key's owner isn't in a household." });

  const { status, body } = await handleRpc(msg, { db: makeDb(s), ctx, now: new Date() });
  return json(status, body);
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") Deno.serve(handle);
