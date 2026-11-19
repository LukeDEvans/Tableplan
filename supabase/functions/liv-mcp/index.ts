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
// Writes (a key with the "write" scope) go through makeDb().update and are logged
// in assistant_changes (migrations/2026-11-17d-assistant-changes.sql).

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
  // x-live-writer: the enforce_live_writer trigger refuses section writes without it.
  async function send(method: string, path: string, body: unknown, prefer = "return=representation") {
    const res = await fetch(`${url}/rest/v1/${path}`, { method, headers: { ...headers, "content-type": "application/json", Prefer: prefer, "x-live-writer": "liv-mcp" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${method.toLowerCase()} ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  async function rpc(fn: string, args: Record<string, unknown>) {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(args) });
    if (!res.ok) throw new Error(`rpc ${fn} ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  return { get, rpc, send };
}

// Only columns that exist in prod — asking PostgREST for a missing column is a
// 400. prep_time / cook_time were added to prod 2026-11-17 (migration 20261117200000).
const RECIPE_COLUMNS = "id,name,time,prep_time,cook_time,servings,source_url,ingredients,steps,tags";

type Mutate = (state: Record<string, unknown>) => { changed?: boolean } | Promise<{ changed?: boolean }>;
const enc = encodeURIComponent;

// The one database surface tools.js / write-tools.js see.
function makeDb(s: ReturnType<typeof svc>, who: { keyId: string; userId: string }) {
  return {
    // Read-change-write one section row, the way a phone saves (app.js section
    // writes): only if updated_at still matches what was read, retried; the new
    // stateUpdatedAt makes this copy the newer one in the app's merge.
    async update(id: string, mutate: Mutate) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const rows = await s.get(`tableplan_states?id=eq.${enc(id)}&select=state,updated_at`);
        const row = rows?.[0];
        const state = (row?.state && typeof row.state === "object") ? structuredClone(row.state) : {};
        const out = await mutate(state);
        if (!out?.changed) return out;
        const now = new Date().toISOString();
        const body = { state: { ...state, stateUpdatedAt: now }, updated_at: now };
        if (!row) {
          const ins = await s.send("POST", `tableplan_states?on_conflict=id&select=updated_at`, { id, ...body }, "return=representation,resolution=ignore-duplicates");
          if (Array.isArray(ins) && ins.length) return out;
          continue; // someone created it meanwhile — read again
        }
        const upd = await s.send("PATCH", `tableplan_states?id=eq.${enc(id)}&updated_at=eq.${enc(row.updated_at)}&select=updated_at`, body);
        if (Array.isArray(upd) && upd.length) return out;
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
      }
      throw new Error("row busy");
    },
    async log(entry: { tool: string; summary: string; undo: unknown }) {
      const rows = await s.send("POST", "assistant_changes?select=id", { key_id: who.keyId, user_id: who.userId, tool: entry.tool, summary: entry.summary, undo: entry.undo ?? null });
      return rows?.[0] || null;
    },
    changes: (limit: number) => s.get(`assistant_changes?user_id=eq.${enc(who.userId)}&select=id,tool,summary,undo,undone_at,created_at&order=created_at.desc&limit=${Math.min(30, Math.max(1, limit))}`),
    async change(id: string) {
      if (!UUID_RE.test(id)) return null;
      const rows = await s.get(`assistant_changes?id=eq.${enc(id)}&user_id=eq.${enc(who.userId)}&select=id,tool,summary,undo,undone_at,created_at`);
      return rows?.[0] || null;
    },
    // True only for the call that marked it (the row must still be not undone).
    async markUndone(id: string) {
      const rows = await s.send("PATCH", `assistant_changes?id=eq.${enc(id)}&undone_at=is.null&select=id`, { undone_at: new Date().toISOString() });
      return Array.isArray(rows) && rows.length > 0;
    },
    unmarkUndone: (id: string) => s.send("PATCH", `assistant_changes?id=eq.${enc(id)}`, { undone_at: null }, "return=minimal"),
    row: (id: string, keys: string[]) => s.rpc("assistant_state_read", { p_row: id, p_paths: keys }),
    health: (userId: string) => s.rpc("assistant_health", { p_user: userId }),
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

// Liv itself (Settings › Connected assistants), signed in as the person: it may list
// and undo the changes assistants made for them, nothing else. Same rule as every
// function: a sign-in below aal2 is refused when the person has a verified factor.
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SIGNED_IN_TOOLS = new Set(["list_recent_changes", "undo_change"]);
const ALLOWED_ORIGINS = [
  /^https:\/\/effervescent-malabi-e0af55\.netlify\.app$/,
  /^https:\/\/[a-z0-9-]+--effervescent-malabi-e0af55\.netlify\.app$/,
  /^capacitor:\/\/localhost$/,
  /^http:\/\/localhost:4174$/,
  /^http:\/\/127\.0\.0\.1:4174$/,
];
function cors(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.some((re) => re.test(origin))) return {};
  return { "access-control-allow-origin": origin, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST, OPTIONS", vary: "origin" };
}
function tokenAal(token: string): string {
  try { return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).aal || ""; } catch { return ""; }
}

async function handleSignedIn(req: Request, token: string, origin: string | null): Promise<Response> {
  const h = cors(origin);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, { error: "too large" }, h);
  let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  try { msg = JSON.parse(raw); } catch { return json(400, { error: "json" }, h); }
  const name = msg?.params?.name || "";
  if (msg?.method !== "tools/call" || !SIGNED_IN_TOOLS.has(name)) return json(403, { error: "Only list_recent_changes and undo_change." }, h);
  const res = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, { headers: { apikey: env("SUPABASE_ANON_KEY")!, authorization: `Bearer ${token}` } });
  if (!res.ok) return json(401, { error: "sign in" }, h);
  const user = await res.json();
  const factors = Array.isArray(user?.factors) ? user.factors : [];
  if (tokenAal(token) !== "aal2" && factors.some((f: { status?: string }) => f?.status === "verified")) return json(401, { error: "authenticator code" }, h);
  if (!UUID_RE.test(String(user?.id || ""))) return json(401, { error: "sign in" }, h);
  const s = svc();
  // An undo is logged against the key that made the change.
  let keyId = "";
  if (name === "undo_change") {
    const changeId = String(msg.params?.arguments?.change_id || "");
    if (!UUID_RE.test(changeId)) return json(400, { error: "change_id" }, h);
    const rows = await s.get(`assistant_changes?id=eq.${enc(changeId)}&user_id=eq.${enc(user.id)}&select=key_id`);
    keyId = rows?.[0]?.key_id || "";
    if (!keyId) return json(404, { error: "No such change." }, h);
  }
  let ctx;
  try { ctx = await contextFor(s, user.id, ["read", "write"]); } catch { return json(502, { error: "Couldn't load the account." }, h); }
  if (!ctx) return json(403, { error: "Not in a household." }, h);
  const out = await handleRpc(msg, { db: makeDb(s, { keyId, userId: user.id }), ctx, now: new Date() });
  return json(out.status, out.body, h);
}

export async function handle(req: Request): Promise<Response> {
  if (env("LIV_MCP_DISABLED") === "1") return json(503, { error: "disabled" });
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return json(204, null, { allow: "POST, OPTIONS", ...cors(origin) });
  if (req.method !== "POST") return json(405, { error: "POST only" }, { allow: "POST, OPTIONS" });

  const key = keyFrom(req);
  const [keyId, secret] = key.split(".");
  const unauthorized = () => json(401, { error: "A valid Liv connector key is required." });
  if (!UUID_RE.test(keyId || "") || !SECRET_RE.test(secret || "")) {
    if (JWT_RE.test(key)) return handleSignedIn(req, key, origin);
    return unauthorized();
  }

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

  const { status, body } = await handleRpc(msg, { db: makeDb(s, { keyId, userId: who.user_id }), ctx, now: new Date() });
  return json(status, body);
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") Deno.serve(handle);
