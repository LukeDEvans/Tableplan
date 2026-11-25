// health-sync — the Apple Health sync protocol (HEALTH_DESIGN.md §3–4). Supabase Edge Function.
//
// Lets a phone copy its owner's workout summaries and daily activity rings into their
// Liv account, including while Liv is closed (HealthKit background delivery), without
// holding the person's sign-in. Same shape as photo-sync: every rule about what a
// device may do lives in the database (migrations/2026-11-24c-health.sql); this
// function checks request shapes, hashes the device's secret and relays with the
// service key. Nothing here is Apple-specific: `activity` is Liv's own word for the
// sport, so another source (a Garmin export, an Android phone) speaks the same calls.
//
// One POST endpoint, body { op, ... }:
//   register — Authorization: Bearer <the person's sign-in>. { deviceKey, name }
//              → { deviceId, secret } (shown once; the database keeps its SHA-256).
//   put      — header x-health-device: "<deviceId>.<secret>".
//              { workouts ≤200, deleted ≤200 ids, days ≤400 } → { workouts, deleted, days }
//
// Provided by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// HEALTH_SYNC_DISABLED=1 switches it off.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url
const WORKOUT_ID_RE = /^[0-9a-f]{32}$/;
const ACTIVITY_RE = /^[a-z_]{1,32}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    "access-control-allow-headers": "authorization, content-type, apikey, x-client-info, x-health-device",
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
const iso = (v: unknown) => { if (typeof v !== "string") return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };

// Only the fields a workout may carry, each checked; anything else is dropped.
export function cleanWorkout(raw: Record<string, unknown>) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "");
  const activity = String(raw.activity || "");
  const started = iso(raw.started_at);
  const ended = iso(raw.ended_at);
  const duration = int(raw.duration_s, 0, 604800);
  if (!WORKOUT_ID_RE.test(id) || !ACTIVITY_RE.test(activity) || !started || !ended || duration === null) return null;
  const hrAvg = int(raw.hr_avg, 20, 260);
  const hrMax = int(raw.hr_max, 20, 260);
  return {
    id,
    started_at: started,
    ended_at: ended,
    activity,
    indoor: typeof raw.indoor === "boolean" ? raw.indoor : null,
    duration_s: duration,
    distance_m: num(raw.distance_m, 0, 10_000_000),
    energy_kcal: num(raw.energy_kcal, 0, 100_000),
    hr_avg: hrAvg,
    hr_max: hrMax,
    source: typeof raw.source === "string" && raw.source.length <= 60 ? raw.source : null,
  };
}

export function cleanDay(raw: Record<string, unknown>) {
  if (!raw || typeof raw !== "object" || !DAY_RE.test(String(raw.day || ""))) return null;
  return {
    day: String(raw.day),
    move_kcal: num(raw.move_kcal, 0, 100_000),
    move_goal: num(raw.move_goal, 0, 100_000),
    exercise_min: int(raw.exercise_min, 0, 1440),
    exercise_goal: int(raw.exercise_goal, 0, 1440),
    stand_h: int(raw.stand_h, 0, 24),
    stand_goal: int(raw.stand_goal, 0, 24),
  };
}

function tokenAal(auth: string): string {
  try {
    const part = auth.replace(/^Bearer\s+/i, "").split(".")[1] || "";
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))).aal || "";
  } catch { return ""; }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return reply(405, { error: "method" }, origin);
  if (Deno.env.get("HEALTH_SYNC_DISABLED") === "1") return reply(503, { error: "disabled" }, origin);

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
      const whoUser = await who.json();
      // A sign-in that skipped the authenticator code can't mint a key when a factor
      // is verified (the tables' require_mfa_when_enrolled rule; this path is service role).
      if (tokenAal(auth) !== "aal2" && Array.isArray(whoUser?.factors) && whoUser.factors.some((f: { status?: string }) => f?.status === "verified")) {
        return reply(401, { error: "authenticator code" }, origin);
      }
      const userId = whoUser?.id;
      if (!UUID_RE.test(String(userId || ""))) return reply(401, { error: "sign in" }, origin);
      const secret = newSecret();
      const name = typeof body.name === "string" ? body.name.slice(0, 60) : "";
      const deviceId = await rpc("health_sync_register", { p_user: userId, p_device_key: deviceKey, p_name: name, p_secret_hash: await sha256Hex(secret) });
      return reply(200, { deviceId, secret }, origin);
    }

    const cred = req.headers.get("x-health-device") || "";
    const dot = cred.indexOf(".");
    const deviceId = cred.slice(0, dot);
    const secret = cred.slice(dot + 1);
    if (dot < 0 || !UUID_RE.test(deviceId) || !SECRET_RE.test(secret)) return reply(401, { error: "device" }, origin);

    if (op === "put") {
      const rawW = body.workouts === undefined ? [] : body.workouts;
      const rawD = body.days === undefined ? [] : body.days;
      const rawX = body.deleted === undefined ? [] : body.deleted;
      if (!Array.isArray(rawW) || rawW.length > 200 || !Array.isArray(rawD) || rawD.length > 400 || !Array.isArray(rawX) || rawX.length > 200) {
        return reply(400, { error: "batch" }, origin);
      }
      const workouts = rawW.map((w) => cleanWorkout(w as Record<string, unknown>));
      const days = rawD.map((d) => cleanDay(d as Record<string, unknown>));
      if (workouts.some((w) => !w) || days.some((d) => !d) || !rawX.every((x) => typeof x === "string" && WORKOUT_ID_RE.test(x))) {
        return reply(400, { error: "item" }, origin);
      }
      const out = await rpc("health_sync_put", {
        p_device: deviceId,
        p_secret_hash: await sha256Hex(secret),
        p_workouts: workouts,
        p_deleted: rawX,
        p_days: days,
      });
      return reply(200, out || {}, origin);
    }

    return reply(400, { error: "op" }, origin);
  } catch (error) {
    const status = (error as { status?: number })?.status || 502;
    return reply(status, { error: status === 401 ? "device" : status === 400 ? "request" : "upstream" }, origin);
  }
});
