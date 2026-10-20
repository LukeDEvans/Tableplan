// Personal finance accounts, split on the server (FINANCE_SPLIT_DESIGN.md §2.1).
//
// One SimpleFIN connection per household keeps pulling every account. Before
// anything is saved or returned, each account is sorted by its view assignment
// (table live_finance_account_views; a row = Personal, no row = Household):
//
//   Household → finaccts_<groupId>,   finance_transactions group_id <groupId>,   finhist_<groupId>
//   Personal  → finaccts_u-<ownerId>, finance_transactions group_id u-<ownerId>, finhist_u-<ownerId>
//
// so the household's cache, store and history never hold a personal account,
// and a member only ever receives household accounts plus their own personal
// ones. The table is written only by the server (the move, step 3) — clients
// read their own rows at most.
//
// Fail closed: if the assignment table exists but can't be read, callers must
// not save or serve split data this time (a personal account would otherwise
// land in, or be served from, household paths). Before the migration is applied
// the table doesn't exist; that reads as "no personal accounts", which is
// exactly today's behaviour.

const DEFAULT_SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

// "u-<ownerId>" — the personal group id used by finance_transactions RLS and the
// colon-less server-only rows (finaccts_ / finhist_ / finbackup_).
function personalScopeId(ownerId) {
  return `u-${ownerId}`;
}

// { ok, map: Map<linkedId, ownerId> }. ok:false = couldn't read a table that
// exists (fail closed). A missing table (migration not applied) = ok, empty.
async function loadAccountViews({ serviceKey, groupId, supabaseUrl = DEFAULT_SUPABASE_URL, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(
      `${supabaseUrl}/rest/v1/live_finance_account_views?group_id=eq.${encodeURIComponent(groupId)}&view=eq.personal&select=linked_id,owner_id&limit=500`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, accept: "application/json" }, cache: "no-store" }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // PostgREST: unknown relation → 404 with code PGRST205 (or 42P01).
      if (res.status === 404 || /PGRST205|42P01/.test(body)) return { ok: true, map: new Map() };
      return { ok: false, map: new Map() };
    }
    const rows = await res.json();
    const map = new Map();
    for (const r of Array.isArray(rows) ? rows : []) {
      const linked = String(r?.linked_id || "");
      const owner = String(r?.owner_id || "");
      if (linked && owner) map.set(linked, owner);
    }
    return { ok: true, map };
  } catch {
    return { ok: false, map: new Map() };
  }
}

// Sort normalized accounts ({ id, … }) by assignment.
// → { household: [...], byOwner: { [ownerId]: [...] } }
function splitAccounts(accounts, views) {
  const household = [];
  const byOwner = {};
  for (const a of Array.isArray(accounts) ? accounts : []) {
    const owner = views?.get?.(String(a?.id || ""));
    if (owner) (byOwner[owner] ||= []).push(a);
    else household.push(a);
  }
  return { household, byOwner };
}

// What one member receives: household accounts (never an assigned one, even
// from a cache written before the assignment) plus their own personal accounts,
// each marked scope "personal".
function accountsForMember({ householdAccounts, personalAccounts, views, userId }) {
  const household = (Array.isArray(householdAccounts) ? householdAccounts : [])
    .filter((a) => !views?.has?.(String(a?.id || "")));
  const mine = (Array.isArray(personalAccounts) ? personalAccounts : [])
    .filter((a) => userId && views?.get?.(String(a?.id || "")) === userId)
    .map((a) => ({ ...a, scope: "personal" }));
  return [...household, ...mine];
}

// Does this member own any personal account?
function ownsAny(views, userId) {
  if (!userId || !views) return false;
  for (const owner of views.values()) if (owner === userId) return true;
  return false;
}

// Owners with at least one personal account.
function ownersOf(views) {
  return [...new Set(views ? [...views.values()] : [])];
}

module.exports = { personalScopeId, loadAccountViews, splitAccounts, accountsForMember, ownsAny, ownersOf };
