// Weekly scheduled function (see netlify.toml): catch-up collection for the
// recipe-digest Mail AI features (NYT Cooking, Bon Appétit, NutritionFacts —
// see RECIPE_SOURCES). Each source is gated on its own toggle in
// state.mailAiSettings.
//
// Collection happens continuously in the real-time inbox sweep
// (_gmail-shared.js) — this weekly run is just a safety net for anything
// that arrived while that watch was down: it searches the last 14 days per
// source and processes any matching email the sweep hasn't already filed
// away. Recipes are queued for the Meal Plan page's notification bell;
// NutritionFacts health links are saved straight to the Media page.
// (There used to be a second step here that emailed a weekly digest — Luke
// asked for in-app notifications instead, so recipes now surface as soon as
// they're collected rather than waiting for this weekly run.)
const { listGmailUsers, getValidAccessToken, gFetch, headersMap, extractBody, loadAppConfig } = require("./_gmail-shared");
const { enabledRecipeSources, extractRecipes, aiTrashTestMode, findAiTrashLabelId, disposeProcessedEmail, handleExtractedRecipes } = require("./_recipe-digest");

exports.handler = async () => {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) { console.log("[recipe-digest] Missing SUPABASE_SERVICE_ROLE_KEY"); return ok(); }
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();

  const users = await listGmailUsers(serviceKey);
  if (!users.length) { console.log("[recipe-digest] No connected Gmail users"); return ok(); }

  for (const { userId, tokens } of users) {
    try {
      // Feature flags live in each user's own config section
      const cfg = await loadAppConfig(serviceKey, userId);
      const mailAi = cfg?.mailAiSettings || {};
      const sources = enabledRecipeSources(mailAi);
      if (!sources.length) { console.log(`[recipe-digest] ${tokens.email}: no recipe sources enabled — skipping`); continue; }
      const testMode = aiTrashTestMode(mailAi);

      const { token: gToken } = await getValidAccessToken(tokens, serviceKey, userId);
      if (!gToken) { console.error(`[recipe-digest] ${tokens.email}: no access token`); continue; }

      const aiTrashLabelId = testMode ? await findAiTrashLabelId(gFetch, gToken) : null;

      for (const source of sources) {
        const q = `${source.searchQ} newer_than:14d in:inbox`;
        const listRes = await gFetch(gToken, "/messages?" + new URLSearchParams({ q, maxResults: "50" }));
        if (!listRes.ok) { console.error(`[recipe-digest] ${source.name}: search failed (${listRes.status})`); continue; }
        const listData = await listRes.json();
        for (const { id } of listData.messages || []) {
          const r = await gFetch(gToken, `/messages/${id}?format=full`);
          if (!r.ok) continue;
          const msg = await r.json();
          const hdrs = headersMap(msg.payload?.headers);
          if (!source.senderRe.test(hdrs.from || "")) continue;
          const recipes = await extractRecipes(extractBody(msg.payload) || "", source);
          if (!recipes.length) continue; // not a recipe email — leave it alone
          const result = await handleExtractedRecipes(serviceKey, userId, mailAi, anthropicKey, recipes); // persist first…
          await disposeProcessedEmail(gFetch, gToken, id, { testMode, aiTrashLabelId }); // …then file away
          console.log(`[recipe-digest] Catch-up ${source.name}: queued ${result.queued}, filtered ${result.filtered}, health ${result.health} from message ${id} (${testMode ? "AI trash" : "trash"})`);
        }
      }
    } catch (e) {
      console.error(`[recipe-digest] ${tokens.email} failed:`, e.message);
    }
  }
  return ok();
};

function ok() {
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
}
