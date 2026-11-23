// Nightly receipt linking (FINANCE_JOURNEY_AUDIT.md R1, Luke 2026-11-23): links
// receipts that surely fit a bank charge, for every household and each person's
// Personal receipts, so linking no longer waits for Finance to be opened.
//
// Runs at 12:10 UTC, after the finance-nightly Edge Function (11:40 UTC) has saved
// the day's transactions. No bank call: a few table reads and small updates, well
// inside a scheduled function's time limit. The rules are the app's own
// (receipt-matcher.js via _receipt-link.js): only "sure" fits are linked.
// Schedule lives in netlify.toml. Logs counts only — no ids, names or amounts.
import { linkReceiptsForScope } from "./_receipt-link.js";
import financeSplit from "./_finance-split.js";

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

export default async () => {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) { console.log("[receipt-link] no service key — skip"); return new Response("no key", { status: 200 }); }
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json" };
  let linked = 0, scopes = 0;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=like.simplefin*&select=id`, { headers });
    if (!res.ok) throw new Error(`households ${res.status}`);
    for (const row of await res.json()) {
      const groupId = String(row.id || "").replace(/^simplefin_/, "");
      if (!groupId || groupId === row.id) continue;
      const views = await financeSplit.loadAccountViews({ serviceKey, groupId });
      const owners = views.ok ? [...new Set(views.map.values())] : [];
      for (const scope of [groupId, ...owners.map(financeSplit.personalScopeId)]) {
        scopes += 1;
        try { linked += (await linkReceiptsForScope({ serviceKey, scope })).linked || 0; }
        catch (e) { console.error("[receipt-link] scope failed", e.message || "error"); }
      }
    }
  } catch (e) {
    console.error("[receipt-link] failed", e.message || "error");
  }
  console.log(`[receipt-link] linked ${linked} across ${scopes} scope(s)`);
  return new Response("ok", { status: 200 });
};
