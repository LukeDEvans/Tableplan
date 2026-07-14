const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return jsonResponse(503, { error: "Service not configured." });

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse(401, { error: "Not authenticated." });

  const caller = await getCallerUser(accessToken, serviceKey);
  if (!caller) return jsonResponse(401, { error: "Invalid session." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON." }); }
  const { token, displayName } = body;

  // With a token: exact lookup. Without one (the link's token lives in
  // per-tab sessionStorage and is easily lost on phones), fall back to the
  // newest pending invite addressed to the signed-in email — the pre-created
  // auth account proves the owner invited exactly this address.
  const query = token
    ? `id=eq.${encodeURIComponent(token)}`
    : `email=eq.${encodeURIComponent((caller.email || "").toLowerCase())}&accepted_at=is.null&order=created_at.desc&limit=1`;
  const inviteRes = await fetch(
    `${SUPABASE_URL}/rest/v1/live_group_invites?${query}&select=id,group_id,email,accepted_at,expires_at`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!inviteRes.ok) return jsonResponse(500, { error: "Could not look up invite." });
  const [invite] = await inviteRes.json();
  if (!invite) return jsonResponse(404, { error: "Invite not found." });
  if (invite.accepted_at) return jsonResponse(409, { error: "This invite has already been used." });
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) return jsonResponse(410, { error: "This invite has expired. Ask the group admin to send a new one." });
  if (invite.email.toLowerCase() !== (caller.email || "").toLowerCase()) return jsonResponse(403, { error: "This invite was sent to a different email address." });

  const existingRes = await fetch(
    `${SUPABASE_URL}/rest/v1/live_group_members?group_id=eq.${invite.group_id}&user_id=eq.${caller.id}`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const existing = await existingRes.json();

  if (!existing.length) {
    const addRes = await fetch(`${SUPABASE_URL}/rest/v1/live_group_members`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ group_id: invite.group_id, user_id: caller.id, display_name: displayName || caller.email, role: "member" })
    });
    if (!addRes.ok) return jsonResponse(500, { error: "Could not add group membership." });
  }

  await fetch(`${SUPABASE_URL}/rest/v1/live_group_invites?id=eq.${token}`, {
    method: "PATCH",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ accepted_at: new Date().toISOString() })
  });

  const groupRes = await fetch(`${SUPABASE_URL}/rest/v1/live_groups?id=eq.${invite.group_id}&select=id,disabled_pages`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  const [group] = await groupRes.json();

  return jsonResponse(200, { ok: true, groupId: invite.group_id, disabledPages: group?.disabled_pages || [] });
};

async function getCallerUser(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function jsonResponse(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}
