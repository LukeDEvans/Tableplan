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
const MailJobs = require("./_mail-jobs");

exports.handler = async () => {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) { console.log("[recipe-digest] Missing SUPABASE_SERVICE_ROLE_KEY"); return ok(); }
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();

  const users = await listGmailUsers(serviceKey);
  if (!users.length) { console.log("[recipe-digest] No connected Gmail users"); return ok(); }

  for (const { userId, tokens } of users) {
    // Route through the shared engine: this per-user claim honours the same
    // in-progress lock, per-hour circuit breaker and zero-deploy kill switch as
    // the real-time sweep, so the weekly catch-up can never run alongside a live
    // sweep or during an emergency stop. If not claimed (a sweep just ran, or
    // sweeping is disabled), skip — the real-time path already has this covered.
    let claimed = false;
    try {
      claimed = await MailJobs.claimSweep(serviceKey, userId);
      if (!claimed) { console.log(`[recipe-digest] ${tokens.email}: sweep not claimed (busy/disabled) — skipping`); continue; }

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
        const ids = (listData.messages || []).map((m) => m.id);
        if (!ids.length) continue;

        // Shared idempotency ledger: only handle messages not already 'done' (by
        // this catch-up OR the real-time sweep); anything past the attempt cap is
        // quarantined by takeMessages rather than re-fetched every week.
        const fresh = await MailJobs.takeMessages(serviceKey, userId, ids, { max: MailJobs.MSG_MAX_ATTEMPTS, limit: 50 });
        const done = [];
        for (const id of fresh) {
          const r = await gFetch(gToken, `/messages/${id}?format=full`);
          if (!r.ok) { if (r.status === 404 || r.status === 410) done.push(id); continue; } // gone → age out; else retry next run
          const msg = await r.json();
          const hdrs = headersMap(msg.payload?.headers);
          if (!source.senderRe.test(hdrs.from || "")) { done.push(id); continue; }
          const recipes = await extractRecipes(extractBody(msg.payload) || "", source);
          if (!recipes.length) { done.push(id); continue; } // examined, not a recipe — handled
          const result = await handleExtractedRecipes(serviceKey, userId, mailAi, anthropicKey, recipes); // persist first…
          await disposeProcessedEmail(gFetch, gToken, id, { testMode, aiTrashLabelId }); // …then file away
          done.push(id);
          console.log(`[recipe-digest] Catch-up ${source.name}: queued ${result.queued}, filtered ${result.filtered}, health ${result.health} from message ${id} (${testMode ? "AI trash" : "trash"})`);
        }
        await MailJobs.markDone(serviceKey, done);
      }
    } catch (e) {
      console.error(`[recipe-digest] ${tokens.email} failed:`, e.message);
    } finally {
      // Release the lock (does not advance the history checkpoint — this catch-up
      // is query-based, not history-delta based).
      if (claimed) await MailJobs.releaseSweep(serviceKey, userId, "").catch(() => {});
    }
  }
  return ok();
};

function ok() {
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
}
