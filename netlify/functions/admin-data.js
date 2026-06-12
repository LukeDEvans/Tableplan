const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return jsonResponse(405, { error: "Method not allowed." });

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return jsonResponse(503, { error: "Service not configured." });

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse(401, { error: "Not authenticated." });

  const caller = await getCallerUser(accessToken, serviceKey);
  if (!caller) return jsonResponse(401, { error: "Invalid session." });

  const memberRow = await getGroupMembership(caller.id, serviceKey);
  if (!memberRow || memberRow.role !== "admin") return jsonResponse(403, { error: "Admin only." });

  const [usersData, groups, memberships] = await Promise.all([
    fetchAllUsers(serviceKey),
    fetchGroups(serviceKey),
    fetchMemberships(serviceKey),
  ]);

  const membershipByUserId = {};
  for (const m of memberships) {
    membershipByUserId[m.user_id] = m;
  }

  const memberCountByGroup = {};
  const adminByGroup = {};
  for (const m of memberships) {
    memberCountByGroup[m.group_id] = (memberCountByGroup[m.group_id] || 0) + 1;
    if (m.role === "admin") adminByGroup[m.group_id] = m.display_name || m.user_id;
  }

  const users = usersData.map(u => ({
    id: u.id,
    email: u.email || "",
    display_name: membershipByUserId[u.id]?.display_name || u.user_metadata?.full_name || "",
    dob: u.user_metadata?.dob || "",
    household_id: membershipByUserId[u.id]?.group_id || null,
  }));

  const households = groups.map(g => ({
    id: g.id,
    member_count: memberCountByGroup[g.id] || 0,
    admin_name: adminByGroup[g.id] || "",
  }));

  return jsonResponse(200, { users, households });
};

async function fetchAllUsers(serviceKey) {
  const results = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!res.ok) break;
    const data = await res.json();
    const batch = data.users || [];
    results.push(...batch);
    if (batch.length < 1000) break;
    page++;
  }
  return results;
}

async function fetchGroups(serviceKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/live_groups?select=id`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  return res.ok ? await res.json() : [];
}

async function fetchMemberships(serviceKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/live_group_members?select=user_id,group_id,display_name,role`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  return res.ok ? await res.json() : [];
}

async function getCallerUser(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

async function getGroupMembership(userId, serviceKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/live_group_members?user_id=eq.${userId}&select=group_id,role&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

function jsonResponse(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}
