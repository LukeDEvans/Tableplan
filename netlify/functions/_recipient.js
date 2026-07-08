// Resolves who outgoing emails go to, without hardcoding an address in the repo.
// Priority: WEEKLY_REVIEW_TO env override → the signed-in caller (when a
// Supabase access token is available) → the app owner (oldest auth account).
// Files prefixed with _ are not deployed as individual functions.
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

async function resolveRecipientEmail(serviceKey, accessToken) {
  const override = (process.env.WEEKLY_REVIEW_TO || "").trim();
  if (override) return override;

  if (accessToken) {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
      });
      if (res.ok) {
        const user = await res.json();
        if (user.email) return user.email;
      }
    } catch {}
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=50`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    if (!res.ok) return "";
    const data = await res.json();
    const users = (Array.isArray(data.users) ? data.users : []).filter((u) => u.email);
    users.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    return users[0]?.email || "";
  } catch { return ""; }
}

module.exports = { resolveRecipientEmail };
