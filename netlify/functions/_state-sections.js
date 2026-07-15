// Shared helpers for server-side reads/writes of the app's sectioned state.
// The app stores each section as its own row: id = "<groupId>:<section>".
// All writes go through an optimistic-locking loop (conditional PATCH on
// updated_at), mirroring the client's writeSectionWithMerge — a server
// function can therefore never clobber a concurrent client write.
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

function serviceHeaders(serviceKey) {
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    accept: "application/json",
    // Writer-version stamp — see enforce_live_writer trigger / app.js
    "x-live-writer": "2"
  };
}

async function getUserIdFromToken(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user.id || null;
  } catch { return null; }
}

async function getUserGroupId(serviceKey, userId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/live_group_members?user_id=eq.${encodeURIComponent(userId)}&select=group_id&limit=1`,
      { headers: serviceHeaders(serviceKey) }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0]?.group_id || null;
  } catch { return null; }
}

// Personal (per-member) rows live beside the group rows: "u-<userId>:<section>".
function personalRowId(userId, section) {
  return `u-${userId}:${section}`;
}

async function loadSection(serviceKey, groupId, section) {
  const rowId = `${groupId}:${section}`;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.${encodeURIComponent(rowId)}&select=state,updated_at`,
    { headers: serviceHeaders(serviceKey), cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Section "${section}" load failed (${res.status})`);
  const rows = await res.json();
  return rows[0] || null;
}

// Read-modify-write with optimistic locking. `mutate(state)` returns the new
// state object, or null/undefined to skip writing. Retries on conflict with a
// fresh read, so concurrent writers interleave instead of overwriting.
// `owner` is a group id (household row) or "u-<userId>" (personal row) —
// personal rows are created on first write instead of failing.
async function updateSection(serviceKey, owner, section, mutate, attempts = 4) {
  const rowId = `${owner}:${section}`;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const row = await loadSection(serviceKey, owner, section);
    if (!row) {
      if (!owner.startsWith("u-")) throw new Error(`Section row "${rowId}" not found`);
      const newState = mutate({});
      if (!newState) return { ok: true, skipped: true };
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
        method: "POST",
        headers: { ...serviceHeaders(serviceKey), "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ id: rowId, state: newState, updated_at: new Date().toISOString() })
      });
      if (!ins.ok) throw new Error(`Section "${section}" create failed (${ins.status})`);
      return { ok: true, created: true };
    }
    const newState = mutate({ ...(row.state || {}) });
    if (!newState) return { ok: true, skipped: true };

    const upd = await fetch(
      `${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.${encodeURIComponent(rowId)}&updated_at=eq.${encodeURIComponent(row.updated_at)}`,
      {
        method: "PATCH",
        headers: { ...serviceHeaders(serviceKey), "content-type": "application/json", prefer: "return=representation" },
        body: JSON.stringify({ state: newState, updated_at: new Date().toISOString() })
      }
    );
    if (!upd.ok) throw new Error(`Section "${section}" save failed (${upd.status})`);
    const updRows = await upd.json();
    if (updRows.length) return { ok: true };
    // 0 rows matched → another writer got there first; re-read and retry
  }
  throw new Error(`Section "${section}" kept conflicting — giving up`);
}

module.exports = { SUPABASE_URL, serviceHeaders, getUserIdFromToken, getUserGroupId, loadSection, updateSection, personalRowId };
