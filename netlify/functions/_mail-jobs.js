// Durable mail-processing engine — the single, shared home for how the Gmail
// sweep claims work, tracks per-message idempotency, and trips its own circuit
// breaker. Backed by dedicated, isolated tables + atomic SQL functions
// (supabase-mail-jobs.sql) so a notification burst can NEVER become a
// per-notification read storm on the hot tableplan_states table again.
//
// Every entry point (webhook, background sweep, daily re-arm, manual "check now")
// goes through these helpers — one engine, not five subtly different ones.

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

// Tunables (env-overridable). The debounce alone caps sweeps at ~1/30s; the
// rate cap is a defense-in-depth backstop that trips only under sustained
// self-amplification (the failure mode), pausing that user's sweeping for the
// rest of the rolling hour rather than thrashing the DB.
const SWEEP_MIN_INTERVAL_S = Number(process.env.MAIL_SWEEP_MIN_INTERVAL_S) || 30;
const SWEEP_STALE_S = Number(process.env.MAIL_SWEEP_STALE_S) || 300;      // dead-lock takeover after 5 min
const SWEEP_RATE_CAP = Number(process.env.MAIL_SWEEP_RATE_CAP) || 60;      // max successful sweeps / rolling hour
const MSG_MAX_ATTEMPTS = Number(process.env.MAIL_MSG_MAX_ATTEMPTS) || 2;   // then quarantine ('gave_up')
const MSG_BATCH_LIMIT = 10;                                                // bounded work per sweep

function headers(serviceKey) {
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json", accept: "application/json" };
}

async function rpc(serviceKey, fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: headers(serviceKey), body: JSON.stringify(args)
  });
  if (!res.ok) throw new Error(`rpc ${fn} failed ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return res.json().catch(() => null);
}

// ── email → user lookup (isolated PK read, replaces gmailidx_) ────────────────
async function lookupAccount(serviceKey, email) {
  const key = String(email || "").trim().toLowerCase();
  if (!key) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/mail_accounts?email=eq.${encodeURIComponent(key)}&select=user_id`, { headers: headers(serviceKey) });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return rows[0]?.user_id || null;
}

async function upsertAccount(serviceKey, email, userId) {
  const key = String(email || "").trim().toLowerCase();
  if (!key || !userId) return;
  await fetch(`${SUPABASE_URL}/rest/v1/mail_accounts?on_conflict=email`, {
    method: "POST",
    headers: { ...headers(serviceKey), prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ email: key, user_id: userId })
  });
}

// ── Atomic sweep claim / release ─────────────────────────────────────────────
// Returns true only to the ONE caller that wins the lock and passes debounce +
// in-progress + rate-cap. This is the single gate in front of all sweep work.
async function claimSweep(serviceKey, userId, opts = {}) {
  const out = await rpc(serviceKey, "mail_claim_sweep", {
    p_user: userId,
    p_cap: opts.cap ?? SWEEP_RATE_CAP,
    p_min_interval_s: opts.minIntervalS ?? SWEEP_MIN_INTERVAL_S,
    p_stale_s: opts.staleS ?? SWEEP_STALE_S
  });
  return out === true || (Array.isArray(out) && out[0] === true);
}

async function releaseSweep(serviceKey, userId, historyId) {
  await rpc(serviceKey, "mail_release_sweep", { p_user: userId, p_history_id: historyId || "" });
}

async function getSweepCheckpoint(serviceKey, userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/mail_sweep_state?user_id=eq.${encodeURIComponent(userId)}&select=last_history_id`, { headers: headers(serviceKey) });
  if (!res.ok) return "";
  const rows = await res.json().catch(() => []);
  return rows[0]?.last_history_id || "";
}

// ── Per-message idempotency ──────────────────────────────────────────────────
// Records/bumps each candidate and returns the bounded batch to process (new +
// still-pending, oldest first); anything past the attempt cap is quarantined.
async function takeMessages(serviceKey, userId, ids, opts = {}) {
  const out = await rpc(serviceKey, "mail_take_messages", {
    p_user: userId, p_ids: ids || [], p_max: opts.max ?? MSG_MAX_ATTEMPTS, p_limit: opts.limit ?? MSG_BATCH_LIMIT
  });
  if (!Array.isArray(out)) return [];
  return out.map((r) => (typeof r === "string" ? r : r?.mail_take_messages)).filter(Boolean);
}

async function markDone(serviceKey, ids) {
  if (!ids || !ids.length) return;
  await rpc(serviceKey, "mail_mark_done", { p_ids: ids });
}

async function pruneProcessed(serviceKey, days = 14) {
  try { await rpc(serviceKey, "mail_prune_processed", { p_days: days }); } catch { /* best-effort */ }
}

// ── Pure claim-decision mirror (for unit tests + documentation) ──────────────
// Mirrors mail_claim_sweep's logic exactly so the intended semantics are
// unit-testable without a database. `state` is the current mail_sweep_state row.
function sweepClaimDecision(state, nowMs, opts = {}) {
  const cap = opts.cap ?? SWEEP_RATE_CAP;
  const minIntervalMs = (opts.minIntervalS ?? SWEEP_MIN_INTERVAL_S) * 1000;
  const staleMs = (opts.staleS ?? SWEEP_STALE_S) * 1000;
  const s = state || {};
  const t = (v) => (v ? new Date(v).getTime() : 0);
  const wStartMs = t(s.window_start);
  let wCount = s.window_count || 0;
  let wStart = wStartMs;
  if (!wStartMs || nowMs - wStartMs > 3600_000) { wStart = nowMs; wCount = 0; }

  // Zero-deploy kill switch: a false `enabled` column halts all sweeping (absent
  // column ⇒ treated as enabled, matching the DB default of true).
  if (s.enabled === false) return { allow: false, reason: "disabled" };
  if (s.last_sweep_at && nowMs - t(s.last_sweep_at) < minIntervalMs) return { allow: false, reason: "debounced" };
  if (s.locked_at && nowMs - t(s.locked_at) < staleMs) return { allow: false, reason: "in-progress" };
  if (wCount >= cap) return { allow: false, reason: "rate-capped" };
  return { allow: true, reason: "claimed", nextWindowStart: wStart, nextWindowCount: wCount + 1 };
}

// ── Observability ────────────────────────────────────────────────────────────
// One structured line per sweep to stdout (Netlify captures it). No email bodies.
function logSweep(evt) {
  try { console.log("[sweep] " + JSON.stringify(evt)); } catch { /* ignore */ }
}

module.exports = {
  SWEEP_MIN_INTERVAL_S, SWEEP_STALE_S, SWEEP_RATE_CAP, MSG_MAX_ATTEMPTS, MSG_BATCH_LIMIT,
  lookupAccount, upsertAccount,
  claimSweep, releaseSweep, getSweepCheckpoint,
  takeMessages, markDone, pruneProcessed,
  sweepClaimDecision, logSweep
};
