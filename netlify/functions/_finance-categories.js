// The household's Finance budget categories, for receipt scans that assign each
// line a budget category (scan-receipt for the one receipts list; simplefin's
// scanReceipt/importReceipt for the split editor and the browser extension).
// Keys are "cat:<groupId>:<categoryId>", the labels Finance splits use.
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

function svc(serviceKey) {
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json", "x-live-writer": "2" };
}

async function getGroupIdForUser(serviceKey, userId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/live_group_members?user_id=eq.${encodeURIComponent(userId)}&select=group_id&limit=1`,
      { headers: svc(serviceKey) }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0]?.group_id || null;
  } catch { return null; }
}

async function loadFinanceCategories(serviceKey, groupId) {
  if (!groupId) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.${encodeURIComponent(groupId + ":finance")}&select=state`,
      { headers: svc(serviceKey), cache: "no-store" }
    );
    const rows = res.ok ? await res.json() : [];
    const groups = rows[0]?.state?.financeBudgetGroups || [];
    return groups.flatMap((g) => (g.categories || []).map((c) => ({ key: `cat:${g.id}:${c.id}`, name: `${g.label} · ${c.name}` })));
  } catch { return []; }
}

module.exports = { getGroupIdForUser, loadFinanceCategories };
