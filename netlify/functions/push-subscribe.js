// Stores or removes a Web Push subscription for the authenticated user.
// POST   /api/push-subscribe  { subscription: PushSubscriptionJSON }  → 200
// DELETE /api/push-subscribe  { endpoint: string }                    → 200

export const config = { path: "/api/push-subscribe" };

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "POST" && req.method !== "DELETE") return jsonError(405, "Method not allowed.");

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return jsonError(503, "Server not configured.");

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return jsonError(401, "Not authenticated.");

  // Resolve user ID from token
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${token}` }
  });
  if (!userRes.ok) return jsonError(401, "Invalid session.");
  const { id: userId } = await userRes.json();

  let body;
  try { body = await req.json(); } catch { return jsonError(400, "Invalid JSON."); }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal"
  };

  if (req.method === "DELETE") {
    const endpoint = String(body.endpoint || "").trim();
    if (!endpoint) return jsonError(400, "endpoint is required.");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/live_push_subscriptions?user_id=eq.${userId}&endpoint=eq.${encodeURIComponent(endpoint)}`,
      { method: "DELETE", headers }
    );
    if (!res.ok) return jsonError(502, "Failed to remove subscription.");
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", ...corsHeaders() } });
  }

  // POST — upsert subscription
  const subscription = body.subscription;
  if (!subscription?.endpoint) return jsonError(400, "subscription.endpoint is required.");

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/live_push_subscriptions?on_conflict=endpoint`,
    {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: userId, endpoint: subscription.endpoint, subscription })
    }
  );
  if (!res.ok) {
    const err = await res.text();
    console.error("[push-subscribe] Supabase error:", err);
    return jsonError(502, "Failed to save subscription.");
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json", ...corsHeaders() } });
};

function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization" };
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { "content-type": "application/json", ...corsHeaders() }
  });
}
