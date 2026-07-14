// Netlify BACKGROUND function (the "-background" filename suffix gives it a
// 15-minute execution limit instead of ~26 seconds). All inbox sweeping is
// delegated here: converting newsletters to articles with Claude can take
// minutes for a batch, which killed sweeps that ran inline in the webhook and
// the daily cron — the platform 504'd them before any state was saved.
// Callers get an immediate 202 and the sweep continues in the background.
// POST body { email } sweeps one user; empty body sweeps all connected users.
const { listGmailUsers, findGmailUserByEmail, runInboxSweep } = require("./_gmail-shared");

exports.handler = async (event) => {
  const expected = (process.env.PUBSUB_VERIFICATION_TOKEN || "").trim();
  const provided = event.queryStringParameters?.token || "";
  if (!expected || provided !== expected) return { statusCode: 403, body: "" };

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!serviceKey || !anthropicKey) {
    console.error("[sweep-background] missing SUPABASE_SERVICE_ROLE_KEY or ANTHROPIC_API_KEY");
    return { statusCode: 200, body: "" };
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { /* sweep all users */ }

  let targets = [];
  if (body.email) {
    const user = await findGmailUserByEmail(serviceKey, body.email);
    if (user) targets = [user];
    else console.error("[sweep-background] no connected user for", body.email);
  } else {
    targets = await listGmailUsers(serviceKey);
  }

  for (const { userId, tokens } of targets) {
    try {
      const result = await runInboxSweep(tokens, serviceKey, userId, { anthropicKey });
      console.log(`[sweep-background] ${tokens.email}: scanned ${result.scanned}, added ${result.added}`);
    } catch (e) {
      console.error(`[sweep-background] ${tokens.email} failed:`, e.message);
    }
  }
  return { statusCode: 200, body: "" };
};
