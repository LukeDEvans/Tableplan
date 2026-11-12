// finance-nightly — the once-a-day bank job (FINANCE_AUDIT.md A1). Supabase Edge
// Function (Deno), called by pg_cron through pg_net (migrations/2026-11-12-finance-nightly.sql).
//
// One bank pull per household, then: the bank cache the app reads (finaccts_), the
// durable transaction store, the daily balance history (finhist_) and the finance
// backup (finbackup_). The work itself is netlify/functions/_finance-nightly.js,
// bundled into ./nightly.bundle.js by `npm run build:finance-nightly` (a test fails
// when the bundle is out of date).
//
// Why here and not in Netlify's daily-briefing: that scheduled call was being cut
// off after ~15 s, before the bank bridge answered, so nothing after the pull ran.
// This function answers 202 at once and does the work in the background.
//
// Who may call it: only a caller holding the key kept in Supabase Vault
// (`finance_nightly_key`), checked by asking Postgres (finance_nightly_key_ok). The
// key never leaves the database, and the gateway's JWT check is off because
// pg_net sends none. A second call within MIN_INTERVAL_MS is skipped, so a
// repeated trigger can't spend the bank's daily request budget.
//
// Provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Optional secret: FINANCE_NIGHTLY_DISABLED=1 switches it off.
//
// Result: the server-only row `finnightly_status` in tableplan_states (no ":" in
// the id, so no app can read it): { startedAt, finishedAt, ok, runs } — counts,
// timings and step names only; no ids, names or amounts.

import { snapshotFinanceBalances } from "./nightly.bundle.js";

const STATUS_ID = "finnightly_status";
const MIN_INTERVAL_MS = 30 * 60 * 1000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function serviceHeaders(serviceKey: string): Record<string, string> {
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json", "content-type": "application/json", "x-live-writer": "2" };
}

async function keyOk(supabaseUrl: string, serviceKey: string, key: string): Promise<boolean> {
  if (!key || key.length > 200) return false;
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/finance_nightly_key_ok`, {
    method: "POST", headers: serviceHeaders(serviceKey), body: JSON.stringify({ p_key: key }),
  });
  return res.ok && (await res.json()) === true;
}

async function readStatus(supabaseUrl: string, serviceKey: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${supabaseUrl}/rest/v1/tableplan_states?id=eq.${STATUS_ID}&select=state`, { headers: serviceHeaders(serviceKey) });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows?.[0]?.state || null;
}

async function writeStatus(supabaseUrl: string, serviceKey: string, state: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${supabaseUrl}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: { ...serviceHeaders(serviceKey), prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: STATUS_ID, state, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) console.error(`[fin-nightly] status save ${res.status}`);
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (Deno.env.get("FINANCE_NIGHTLY_DISABLED") === "1") return json(503, { error: "switched off" });
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json(500, { error: "not configured" });
  if (!(await keyOk(supabaseUrl, serviceKey, req.headers.get("x-nightly-key") || ""))) return json(401, { error: "not allowed" });

  const last = await readStatus(supabaseUrl, serviceKey);
  const lastStarted = Date.parse(String(last?.startedAt || "")) || 0;
  if (Date.now() - lastStarted < MIN_INTERVAL_MS) return json(200, { skipped: "ran recently" });

  const startedAt = new Date().toISOString();
  await writeStatus(supabaseUrl, serviceKey, { startedAt, finishedAt: null, ok: false, runs: [], lastGood: last?.lastGood || null });
  const work = (async () => {
    let runs: Array<Record<string, unknown>> = [];
    let error = "";
    try { runs = await snapshotFinanceBalances(serviceKey); }
    catch (e) { error = (e as Error)?.name || "error"; console.error("[fin-nightly] failed:", error); }
    const ok = !error && runs.length > 0 && runs.every((r) => r.ok === true);
    const finishedAt = new Date().toISOString();
    await writeStatus(supabaseUrl, serviceKey, { startedAt, finishedAt, ok, runs, ...(error ? { error } : {}), lastGood: ok ? finishedAt : (last?.lastGood || null) });
    console.log(`[fin-nightly] finished ok=${ok} households=${runs.length}`);
  })();
  // Keep working after the 202 where the runtime allows it (Supabase does).
  const edge = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (edge?.waitUntil) edge.waitUntil(work);
  else await work;
  return json(202, { started: startedAt });
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") Deno.serve(handle);
