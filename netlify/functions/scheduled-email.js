// Netlify Scheduled Function — runs every 15 minutes.
// Returns snoozed emails to the inbox when their time comes (processDueSnoozes).
// It used to also send a weekly review email; that was removed with Settings ›
// Email (Luke, 2026-10-14). The name stays so the schedule in netlify.toml keeps
// working. Requires SUPABASE_SERVICE_ROLE_KEY.

exports.handler = async () => {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) { console.log("[scheduled-email] No SUPABASE_SERVICE_ROLE_KEY"); return ok(); }

  try {
    const { processDueSnoozes } = require("./_gmail-shared");
    await processDueSnoozes(serviceKey);
  } catch (e) {
    console.error("[scheduled-email] snooze wake failed:", e.message);
  }
  return ok();
};

function ok() { return { statusCode: 200 }; }
