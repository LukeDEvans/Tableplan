// Weekly scheduled function (see netlify.toml): the recipe-digest Mail AI
// features (NYT Cooking, Bon Appétit, … — see RECIPE_SOURCES). Each source is
// gated on its own toggle in state.mailAiSettings.
//
// Collection happens continuously in the inbox sweep (_gmail-shared.js):
// recipe links are stored and each source email is filed away immediately
// after processing (to "Apps/AI trash" in test mode, else Trash). This weekly
// run does two things:
//   1. Catch-up: collect + immediately file any matching emails the sweep
//      missed (e.g. arrived while the real-time watch was down).
//   2. Delivery: one email with the accumulated collection from all sources,
//      grouped by publication, deduped against previous digests.
const { listGmailUsers, getValidAccessToken, gFetch, headersMap, extractBody, loadAppConfig } = require("./_gmail-shared");
const { enabledRecipeSources, extractRecipes, aiTrashTestMode, findAiTrashLabelId, disposeProcessedEmail, loadMailAiRow, saveMailAiRow, appendPendingRecipes } = require("./_recipe-digest");
const { resolveRecipientEmail } = require("./_recipient");
const FROM_EMAIL = "Live App <onboarding@resend.dev>";

exports.handler = async () => {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const resendKey = (process.env.RESEND_API_KEY || "").trim();
  if (!serviceKey || !resendKey) { console.log("[recipe-digest] Missing SUPABASE_SERVICE_ROLE_KEY or RESEND_API_KEY"); return ok(); }

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

      // 1. Catch-up collection per source: persist links, file email away immediately
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
          await appendPendingRecipes(serviceKey, userId, recipes); // persist first…
          await disposeProcessedEmail(gFetch, gToken, id, { testMode, aiTrashLabelId }); // …then file away
          console.log(`[recipe-digest] Catch-up ${source.name}: ${recipes.length} link(s) from message ${id} (${testMode ? "AI trash" : "trash"})`);
        }
      }

      // 2. Delivery
      const row = await loadMailAiRow(serviceKey, userId);
      const pending = Array.isArray(row.recipesPending) ? row.recipesPending : [];
      const sentUrls = new Set(Array.isArray(row.recipesSentUrls) ? row.recipesSentUrls : []);
      const fresh = pending.filter((r) => !sentUrls.has(r.url));

      if (!fresh.length) {
        console.log(`[recipe-digest] ${tokens.email}: nothing new to send (${pending.length} pending, all repeats)`);
        row.recipesPending = [];
        row.recipesLastRunAt = new Date().toISOString();
        await saveMailAiRow(serviceKey, userId, row);
        continue;
      }

      const to = await resolveRecipientEmail(serviceKey);
      if (!to) { console.error("[recipe-digest] No recipient email — keeping collection for next week"); continue; }

      // Group: category header (Recipes, Health, …) → source subheading → links
      const CATEGORY_ORDER = ["Recipes", "Health"];
      const byCategory = new Map();
      for (const r of fresh) {
        const cat = r.category || "Recipes";
        if (!byCategory.has(cat)) byCategory.set(cat, new Map());
        const bySource = byCategory.get(cat);
        if (!bySource.has(r.source)) bySource.set(r.source, []);
        bySource.get(r.source).push(r);
      }
      const orderedCats = [...byCategory.keys()].sort((a, b) => {
        const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      const linkList = (items) =>
        `<ul style="padding-left:20px;margin:0 0 14px">` +
        items.map(({ url, title }) =>
          `<li style="margin:0 0 10px"><a href="${escapeHtml(url)}" style="color:#1C1917;font-size:16px">${escapeHtml(title)}</a></li>`
        ).join("") +
        `</ul>`;
      const sections = orderedCats.map((cat) => {
        const bySource = byCategory.get(cat);
        const inner = bySource.size > 1
          ? [...bySource.entries()].map(([name, items]) =>
              `<p style="margin:10px 0 6px;font-weight:bold;color:#57534E;font-size:14px">${escapeHtml(name)}</p>` + linkList(items)
            ).join("")
          : linkList([...bySource.values()][0]);
        return `<h3 style="color:#92400E;margin:22px 0 8px;font-size:18px;border-bottom:1px solid #E7E0D2;padding-bottom:4px">${escapeHtml(cat)}</h3>` + inner;
      }).join("");

      const counts = orderedCats.map((cat) => {
        const n = [...byCategory.get(cat).values()].reduce((s, arr) => s + arr.length, 0);
        return cat === "Recipes" ? `${n} recipe${n === 1 ? "" : "s"}` : `${n} ${cat.toLowerCase()} link${n === 1 ? "" : "s"}`;
      }).join(", ");

      const html =
        `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#FFFDF6;padding:24px;color:#1C1917">` +
        `<h2 style="color:#92400E;margin:0 0 6px">Your weekly digest</h2>` +
        `<p style="margin:0 0 10px;color:#57534E">${escapeHtml(counts)} collected. The original emails have been ${testMode ? "filed to Apps/AI trash" : "moved to the trash"}.</p>` +
        sections + `</div>`;

      const sent = await sendResendEmail(resendKey, to, `Weekly digest — ${counts}`, html);
      if (!sent) { console.error("[recipe-digest] Digest send failed — collection kept for next week"); continue; }

      row.recipesPending = [];
      row.recipesSentUrls = [...sentUrls, ...fresh.map((r) => r.url)].slice(-500);
      row.recipesLastRunAt = new Date().toISOString();
      await saveMailAiRow(serviceKey, userId, row);
      console.log(`[recipe-digest] ${tokens.email}: sent ${fresh.length} recipes to ${to}`);
    } catch (e) {
      console.error(`[recipe-digest] ${tokens.email} failed:`, e.message);
    }
  }
  return ok();
};

async function sendResendEmail(resendKey, to, subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html })
  });
  return res.ok;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function ok() {
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
}
