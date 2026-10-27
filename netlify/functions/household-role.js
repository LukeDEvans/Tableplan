// Change a household member's role (Settings › Household; Luke, 2026-10-26).
//
// Members can't change roles from the app (VIEWS_DESIGN §2.1: RLS lets each person
// update only display_name and personal_disabled_pages on their own row), so this
// runs with the service role after checking, on every call:
//   - the caller's session is real and the caller is the admin of their household;
//   - the target is someone else in that same household;
//   - the new role is "admin" or "member";
//   - the change never leaves the household without an admin (you can't change
//     your own role here, and the last admin can't be demoted).
// Nothing else on the row is written.

const { userGroupQuery } = require("./_group-lookup.js");

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const ROLES = ["admin", "member"];

// Pure: whether this change is allowed, given the caller's membership and the
// household's members ([{ user_id, role }]). Returns { ok } or { status, error }.
function checkRoleChange({ caller, callerMembership, members, targetUserId, newRole }) {
  if (!caller?.id) return { status: 401, error: "Invalid session." };
  if (!callerMembership || callerMembership.role !== "admin") return { status: 403, error: "Only the household's admin can change roles." };
  if (!ROLES.includes(newRole)) return { status: 400, error: "Role must be admin or member." };
  if (!targetUserId || typeof targetUserId !== "string") return { status: 400, error: "Pick a member." };
  if (targetUserId === caller.id) return { status: 400, error: "You can't change your own role." };
  const list = Array.isArray(members) ? members : [];
  const target = list.find((m) => m.user_id === targetUserId);
  if (!target) return { status: 404, error: "That person isn't in your household." };
  if (target.role === newRole) return { ok: true, unchanged: true };
  const adminsAfter = list.filter((m) => (m.user_id === targetUserId ? newRole : m.role) === "admin").length;
  if (adminsAfter < 1) return { status: 400, error: "The household needs an admin." };
  return { ok: true };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return jsonResponse(503, { error: "Service not configured." });

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse(401, { error: "Not authenticated." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON." }); }
  const targetUserId = String(body.userId || "").trim();
  const newRole = String(body.role || "").trim();

  const caller = await getCallerUser(accessToken, serviceKey);
  if (!caller) return jsonResponse(401, { error: "Invalid session." });
  const callerMembership = await getGroupMembership(caller.id, serviceKey);
  const members = callerMembership ? await getGroupMembers(callerMembership.group_id, serviceKey) : [];
  if (callerMembership && members === null) return jsonResponse(502, { error: "Couldn't read the household." });

  const verdict = checkRoleChange({ caller, callerMembership, members, targetUserId, newRole });
  if (!verdict.ok) return jsonResponse(verdict.status, { error: verdict.error });
  if (verdict.unchanged) return jsonResponse(200, { ok: true, role: newRole });

  // Scoped to the caller's group and the target, and only the role column.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/live_group_members?group_id=eq.${encodeURIComponent(callerMembership.group_id)}&user_id=eq.${encodeURIComponent(targetUserId)}`,
    {
      method: "PATCH",
      headers: { ...serviceHeaders(serviceKey), "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ role: newRole }),
    }
  );
  if (!res.ok) return jsonResponse(502, { error: "Couldn't save the role." });
  console.log(JSON.stringify({ fn: "household-role", by: caller.id, target: targetUserId, role: newRole }));
  return jsonResponse(200, { ok: true, role: newRole });
};

function serviceHeaders(serviceKey) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" };
}

async function getCallerUser(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id ? user : null;
  } catch { return null; }
}

async function getGroupMembership(userId, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${userGroupQuery(userId, "group_id,role")}`, { headers: serviceHeaders(serviceKey) });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows[0] || null;
  } catch { return null; }
}

async function getGroupMembers(groupId, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/live_group_members?group_id=eq.${encodeURIComponent(groupId)}&select=user_id,role`, { headers: serviceHeaders(serviceKey) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function jsonResponse(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}

module.exports = { handler: exports.handler, checkRoleChange, ROLES };
