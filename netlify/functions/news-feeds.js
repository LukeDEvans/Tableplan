// Scheduled hourly (netlify.toml): read every section feed of the papers users are
// signed in to and add new stories to News (_news-feeds.js, NEWS_PAGE_DESIGN.md §10).
// Bounded: one pass over a fixed feed list, inserts are ignore-duplicates, one status
// row write; nothing reschedules itself.
const { runFeedIntake } = require("./_news-feeds.js");

exports.handler = async () => {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) { console.error("[news-feeds] no service key"); return { statusCode: 500, body: "no key" }; }
  try {
    const s = await runFeedIntake(serviceKey);
    const okFeeds = s.feeds.filter((f) => f.ok).length;
    console.log(`[news-feeds] ${s.users} user(s), ${okFeeds}/${s.feeds.length} feeds ok, ${s.cards} fresh stories`);
    return { statusCode: 200, body: "ok" };
  } catch (e) {
    console.error("[news-feeds] failed:", e.message);
    return { statusCode: 500, body: "failed" };
  }
};
