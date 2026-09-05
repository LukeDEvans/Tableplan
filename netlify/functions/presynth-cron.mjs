// Scheduled trigger for the pre-synthesis worker.
//
// Netlify scheduled functions run with a short timeout, but the render job needs
// up to 15 minutes (cold-start the box, then render a batch). So this tiny cron
// just fires the `-background` worker (which gets the 15-min budget) and returns.
// Invoking a background function returns 202 immediately; the work runs async.
//
// Schedule lives in netlify.toml.
export default async () => {
  const base = (process.env.URL || process.env.DEPLOY_PRIME_URL || "").trim();
  if (!base) { console.log("[presynth-cron] no site URL in env — skip"); return new Response("no url", { status: 200 }); }
  try {
    const res = await fetch(`${base}/.netlify/functions/presynth-tts-background`, { method: "POST" });
    console.log(`[presynth-cron] triggered worker → ${res.status}`);
  } catch (e) {
    console.error("[presynth-cron] trigger failed:", e.message);
  }
  return new Response("ok", { status: 200 });
};
