// Scheduled daily (see netlify.toml). Gmail watch subscriptions expire after
// 7 days — a hard Google limit — so this re-arms the watch for every connected
// user, and doubles as a catch-up sweep in case any push notification was
// missed. With a daily schedule there are six days of slack before real-time
// delivery would actually stop.
const { listGmailUsers, getValidAccessToken, armGmailWatch, loadMailSuggestions, saveMailSuggestions } = require("./_gmail-shared");

exports.handler = async () => {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  const topicName = (process.env.GMAIL_PUBSUB_TOPIC || "").trim();
  if (!serviceKey) { console.log("[gmail-watch-rearm] No SUPABASE_SERVICE_ROLE_KEY"); return ok(); }

  const users = await listGmailUsers(serviceKey);
  if (!users.length) { console.log("[gmail-watch-rearm] No connected Gmail users"); return ok(); }

  for (const { userId, tokens } of users) {
    try {
      const { token: gToken, invalidGrant } = await getValidAccessToken(tokens, serviceKey, userId);
      if (invalidGrant) { console.error(`[gmail-watch-rearm] ${tokens.email}: refresh token dead, cleared`); continue; }
      if (!gToken) { console.error(`[gmail-watch-rearm] ${tokens.email}: could not get access token`); continue; }

      if (topicName) {
        const watch = await armGmailWatch(gToken, topicName);
        const sugg = await loadMailSuggestions(serviceKey, userId);
        sugg.watchExpiration = Number(watch.expiration) || 0;
        if (!sugg.lastHistoryId && watch.historyId) sugg.lastHistoryId = String(watch.historyId);
        await saveMailSuggestions(serviceKey, userId, sugg);
        console.log(`[gmail-watch-rearm] ${tokens.email}: watch armed until ${new Date(Number(watch.expiration)).toISOString()}`);
      } else {
        console.log("[gmail-watch-rearm] GMAIL_PUBSUB_TOPIC not set — skipping watch, running sweep only");
      }

    } catch (e) {
      console.error(`[gmail-watch-rearm] ${tokens.email} failed:`, e.message);
    }
  }

  // Catch-up sweep for all users runs in the background function — AI
  // newsletter conversion takes longer than this function's time budget.
  if (anthropicKey) {
    try {
      const base = (process.env.URL || "").replace(/\/$/, "");
      const token = (process.env.PUBSUB_VERIFICATION_TOKEN || "").trim();
      await fetch(`${base}/.netlify/functions/sweep-background?token=${encodeURIComponent(token)}`, { method: "POST", body: "{}" });
      console.log("[gmail-watch-rearm] background catch-up sweep started");
    } catch (e) {
      console.error("[gmail-watch-rearm] could not start background sweep:", e.message);
    }
  }
  return ok();
};

function ok() {
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
}
