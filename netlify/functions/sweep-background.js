// Netlify BACKGROUND function (15-minute limit): runs the actual inbox sweep,
// which can take minutes for a batch of AI conversions. Spawned by the webhook
// ONLY after the atomic claim already won (body { userId, preClaimed:true }), or
// invoked with an empty body for the daily catch-up over all connected users
// (each of which then claims for itself).
const { listGmailUsers, loadUserGmailTokens, runInboxSweep } = require("./_gmail-shared");
const { lookupAccount } = require("./_mail-jobs");

// EMERGENCY KILL-SWITCH — see gmail-webhook.js. Keep both in sync.
const SWEEP_KILL_SWITCH = false;

exports.handler = async (event) => {
  const expected = (process.env.PUBSUB_VERIFICATION_TOKEN || "").trim();
  const provided = event.queryStringParameters?.token || "";
  if (!expected || provided !== expected) return { statusCode: 403, body: "" };

  if (SWEEP_KILL_SWITCH) return { statusCode: 200, body: "" };

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!serviceKey || !anthropicKey) {
    console.error("[sweep-background] missing SUPABASE_SERVICE_ROLE_KEY or ANTHROPIC_API_KEY");
    return { statusCode: 200, body: "" };
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { /* catch-up all users */ }

  // targets: [{ userId, tokens, preClaimed }]
  let targets = [];
  try {
    if (body.userId) {
      const tokens = await loadUserGmailTokens(serviceKey, body.userId);
      if (tokens?.refreshToken) targets = [{ userId: body.userId, tokens, preClaimed: body.preClaimed === true }];
    } else if (body.email) {
      const userId = await lookupAccount(serviceKey, body.email);
      const tokens = userId ? await loadUserGmailTokens(serviceKey, userId) : null;
      if (userId && tokens?.refreshToken) targets = [{ userId, tokens, preClaimed: false }];
    } else {
      targets = (await listGmailUsers(serviceKey)).map((u) => ({ ...u, preClaimed: false }));
    }
  } catch (e) {
    // Never 500 (the caller already ACKed). Skip; the next trigger recovers.
    console.error("[sweep-background] target resolution failed (skipping):", e.message);
    return { statusCode: 200, body: "" };
  }

  for (const { userId, tokens, preClaimed } of targets) {
    try {
      // If the claim wasn't held for us, runInboxSweep claims atomically itself.
      await runInboxSweep(tokens, serviceKey, userId, { anthropicKey, preClaimed });
    } catch (e) {
      console.error(`[sweep-background] ${tokens?.email || userId} failed:`, e.message);
    }
  }
  return { statusCode: 200, body: "" };
};
