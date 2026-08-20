// Receives Gmail push notifications via Google Cloud Pub/Sub.
// Pub/Sub POSTs { message: { data: base64({ emailAddress, historyId }) } }.
//
// The per-notification cost is now bounded and ISOLATED: one PK read on
// mail_accounts + one atomic claim on mail_sweep_state (both tiny dedicated
// tables, never the hot tableplan_states). The heavy sweep-background function
// is spawned ONLY when the atomic claim wins — so a notification burst (incl.
// the disposal→notification feedback loop) collapses into cheap no-op claims
// that cannot exhaust the connection pool. See supabase-mail-jobs.sql.
//
// Always ACK 200: a non-2xx makes Pub/Sub retry aggressively, and the durable
// checkpoint means a missed notification is recovered by the next one anyway.
const { lookupAccount, claimSweep } = require("./_mail-jobs");

// EMERGENCY KILL-SWITCH: when true, ACK every notification without any DB work
// or sweep. Manual override retained on top of the architectural safeguards
// (isolated tables + atomic claim + per-window circuit breaker). Flip true +
// redeploy to halt. Re-enabled (false) once the durable engine landed.
const SWEEP_KILL_SWITCH = false;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "" };

  const expected = (process.env.PUBSUB_VERIFICATION_TOKEN || "").trim();
  const provided = event.queryStringParameters?.token || "";
  if (!expected || provided !== expected) return { statusCode: 403, body: "" };

  if (SWEEP_KILL_SWITCH) return { statusCode: 200, body: "" };

  let notif;
  try {
    const body = JSON.parse(event.body || "{}");
    notif = JSON.parse(Buffer.from(body.message.data, "base64").toString());
  } catch {
    console.error("gmail-webhook: malformed Pub/Sub payload");
    return { statusCode: 200, body: "" };
  }

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) { console.error("gmail-webhook: missing SUPABASE_SERVICE_ROLE_KEY"); return { statusCode: 200, body: "" }; }

  // Isolated lookup + atomic claim. Any error → ACK anyway (never 500 → no
  // Pub/Sub retry storm). If the claim doesn't win, we're debounced / a sweep is
  // already running / the circuit breaker tripped — do nothing, the storm ends here.
  try {
    const userId = await lookupAccount(serviceKey, notif.emailAddress);
    if (!userId) { console.error("gmail-webhook: no connected user for", notif.emailAddress); return { statusCode: 200, body: "" }; }

    const claimed = await claimSweep(serviceKey, userId);
    if (!claimed) return { statusCode: 200, body: "" };

    // Claim won → hand the (now-guaranteed-due) sweep to the 15-minute background
    // function, which runs with preClaimed=true and releases the lock at the end.
    const base = (process.env.URL || "").replace(/\/$/, "");
    await fetch(`${base}/.netlify/functions/sweep-background?token=${encodeURIComponent(expected)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, preClaimed: true })
    }).catch((e) => console.error("gmail-webhook: could not start background sweep:", e.message));
  } catch (e) {
    console.error("gmail-webhook: handler error (acking anyway):", e.message);
  }
  return { statusCode: 200, body: "" };
};
