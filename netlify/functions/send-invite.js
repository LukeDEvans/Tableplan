const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const DEFAULT_FROM_EMAIL = "Live App <onboarding@resend.dev>";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method not allowed." });
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const resendKey = (process.env.RESEND_API_KEY || "").trim();
  if (!serviceKey || !resendKey) return jsonResponse(503, { error: "Service not configured." });

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse(401, { error: "Not authenticated." });

  const caller = await getCallerUser(accessToken, serviceKey);
  if (!caller) return jsonResponse(401, { error: "Invalid session." });

  const memberRow = await getGroupMembership(caller.id, serviceKey);
  if (!memberRow || memberRow.role !== "admin") return jsonResponse(403, { error: "Only group admins can send invites." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return jsonResponse(400, { error: "Invalid JSON." }); }
  const email = String(body.email || "").trim().toLowerCase();
  if (!email) return jsonResponse(400, { error: "Email is required." });

  const inviteRes = await fetch(`${SUPABASE_URL}/rest/v1/live_group_invites`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ group_id: memberRow.group_id, email, invited_by: caller.id })
  });
  if (!inviteRes.ok) return jsonResponse(500, { error: "Could not create invite." });
  const [invite] = await inviteRes.json();

  const appUrl = (process.env.APP_URL || process.env.URL || "").replace(/\/$/, "");
  const inviteUrl = `${appUrl}/?invite=${invite.id}`;
  await sendEmail({ resendKey, from: DEFAULT_FROM_EMAIL, to: email, subject: "You've been invited to Live",
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1C1917;"><h2 style="color:#92400E;margin-bottom:16px;">You're invited</h2><p style="margin-bottom:24px;">You've been invited to join a family group on <strong>Live</strong>, a personal life-management app.</p><a href="${inviteUrl}" style="display:inline-block;background:#92400E;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Accept Invite</a><p style="margin-top:24px;font-size:0.85em;color:#78716c;">If you didn't expect this, you can safely ignore this email.</p></div>`
  });
  return jsonResponse(200, { ok: true, inviteUrl });
};

async function getCallerUser(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function getGroupMembership(userId, serviceKey) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/live_group_members?user_id=eq.${userId}&select=group_id,role&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

async function sendEmail({ resendKey, from, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Email failed (${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

function jsonResponse(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}
