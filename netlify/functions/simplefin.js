// SimpleFIN Bridge integration — read-only bank balances & transactions.
//
// Security model (do not weaken):
// - The SimpleFIN access URL (credentials embedded) lives ONLY in the
//   tableplan_states row `simplefin_<groupId>`. Row ids without a ":" can
//   never match the RLS policies (they split on ":" and compare group/user
//   ids), so no client — not even a signed-in household member — can read
//   it via PostgREST. Only this function's service key reaches it.
// - The access URL is never returned to the client, never logged, and never
//   included in error messages. Clients get derived data only.
// - The token is read-only by protocol: it can list balances/transactions,
//   nothing else. Revocable any time at beta-bridge.simplefin.org.
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(json(200, {}));
  if (event.httpMethod !== "POST") return cors(json(405, { error: "Method not allowed" }));

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return cors(json(503, { error: "Not configured." }));

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return cors(json(401, { error: "Not authenticated." }));
  const userId = await getUserId(accessToken, serviceKey);
  if (!userId) return cors(json(401, { error: "Invalid session." }));
  const groupId = await getGroupId(serviceKey, userId);
  if (!groupId) return cors(json(403, { error: "No household group." }));

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return cors(json(400, { error: "Invalid JSON" })); }
  const action = body.action;

  try {
    if (action === "status") {
      const row = await loadSecretRow(serviceKey, groupId);
      return cors(json(200, { connected: Boolean(row?.state?.accessUrl), connectedAt: row?.state?.connectedAt || null }));
    }

    if (action === "setup") {
      // One-time claim: the pasted setup token is a base64 claim URL; POSTing
      // to it returns the access URL and invalidates the token.
      const setupToken = String(body.setupToken || "").trim();
      if (!setupToken) return cors(json(400, { error: "setupToken required" }));
      let claimUrl;
      try {
        claimUrl = Buffer.from(setupToken, "base64").toString("utf8").trim();
      } catch { return cors(json(400, { error: "Setup token is not valid base64." })); }
      if (!/^https:\/\/[^\s]+$/i.test(claimUrl)) return cors(json(400, { error: "Setup token did not decode to an HTTPS URL." }));
      // Pin to the official bridge: keeps this endpoint from being used to
      // make the server call arbitrary URLs (SSRF), and guarantees the
      // stored access URL points at SimpleFIN and nothing else.
      let claimHost;
      try { claimHost = new URL(claimUrl).hostname; } catch { return cors(json(400, { error: "Setup token URL is malformed." })); }
      if (claimHost !== "simplefin.org" && !claimHost.endsWith(".simplefin.org")) {
        return cors(json(400, { error: "Setup token must come from simplefin.org." }));
      }
      const claim = await fetch(claimUrl, { method: "POST" });
      if (!claim.ok) return cors(json(502, { error: `Claim failed (${claim.status}) — setup tokens are single-use; generate a fresh one.` }));
      const accessUrl = (await claim.text()).trim();
      if (!/^https:\/\//i.test(accessUrl)) return cors(json(502, { error: "Bridge returned an unexpected claim response." }));
      await saveSecretRow(serviceKey, groupId, { accessUrl, connectedAt: new Date().toISOString(), connectedBy: userId });
      return cors(json(200, { ok: true }));
    }

    if (action === "disconnect") {
      await saveSecretRow(serviceKey, groupId, {});
      return cors(json(200, { ok: true }));
    }

    if (action === "history") {
      // Daily balance snapshots recorded by the briefing job (finhist_ row is
      // service-only; this is the sole client-facing read path).
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.${encodeURIComponent(`finhist_${groupId}`)}&select=state`,
        { headers: svc(serviceKey), cache: "no-store" }
      );
      if (!res.ok) return cors(json(502, { error: "History load failed." }));
      const rows = await res.json();
      return cors(json(200, { days: rows[0]?.state?.days || {} }));
    }

    if (action === "accounts") {
      const row = await loadSecretRow(serviceKey, groupId);
      const accessUrl = row?.state?.accessUrl;
      if (!accessUrl) return cors(json(409, { error: "SimpleFIN is not connected yet." }));
      const days = Math.min(Math.max(Number(body.days) || 30, 1), 90);
      const start = Math.floor(Date.now() / 1000) - days * 86400;
      // SimpleFIN access URLs embed basic-auth credentials; Node's fetch
      // rejects such URLs, so split them into an Authorization header.
      const { url: bridgeUrl, auth } = splitAccessUrl(accessUrl);
      const res = await fetch(`${bridgeUrl}/accounts?start-date=${start}`, {
        headers: { accept: "application/json", ...(auth ? { authorization: `Basic ${auth}` } : {}) }
      });
      if (!res.ok) return cors(json(502, { error: `Bridge fetch failed (${res.status}).` }));
      const data = await res.json().catch(() => null);
      if (!data || !Array.isArray(data.accounts)) return cors(json(502, { error: "Bridge returned an unexpected payload." }));
      // Derived data only — normalize and drop anything we don't display.
      const accounts = data.accounts.map((a) => ({
        id: String(a.id || ""),
        org: a.org?.name || a.org?.domain || "",
        name: a.name || "",
        currency: a.currency || "USD",
        balance: numOrNull(a.balance),
        available: numOrNull(a["available-balance"]),
        balanceDate: a["balance-date"] ? new Date(a["balance-date"] * 1000).toISOString() : null,
        transactions: (a.transactions || []).map((t) => ({
          id: String(t.id || ""),
          posted: t.posted ? new Date(t.posted * 1000).toISOString() : null,
          amount: numOrNull(t.amount),
          description: String(t.description || "").slice(0, 200),
          pending: Boolean(t.pending)
        }))
      }));
      return cors(json(200, { accounts, errors: Array.isArray(data.errors) ? data.errors.map(String).slice(0, 5) : [] }));
    }

    return cors(json(400, { error: `Unknown action: ${action}` }));
  } catch (e) {
    // Never echo internals — the access URL must not leak through messages.
    console.error("[simplefin]", action, e.name || "error");
    return cors(json(500, { error: "SimpleFIN request failed." }));
  }
};

function numOrNull(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function splitAccessUrl(accessUrl) {
  try {
    const u = new URL(accessUrl);
    const auth = (u.username || u.password)
      ? Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64")
      : null;
    u.username = "";
    u.password = "";
    return { url: u.toString().replace(/\/+$/, ""), auth };
  } catch {
    return { url: accessUrl, auth: null };
  }
}

function secretRowId(groupId) {
  // No ":" — structurally unreadable through the client RLS policies.
  return `simplefin_${groupId}`;
}

async function loadSecretRow(serviceKey, groupId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.${encodeURIComponent(secretRowId(groupId))}&select=state`,
    { headers: svc(serviceKey), cache: "no-store" }
  );
  if (!res.ok) throw new Error(`secret load ${res.status}`);
  const rows = await res.json();
  return rows[0] || null;
}

async function saveSecretRow(serviceKey, groupId, state) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: { ...svc(serviceKey), "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: secretRowId(groupId), state, updated_at: new Date().toISOString() })
  });
  if (!res.ok) throw new Error(`secret save ${res.status}`);
}

function svc(serviceKey) {
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json", "x-live-writer": "2" };
}

async function getUserId(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user.id || null;
  } catch { return null; }
}

async function getGroupId(serviceKey, userId) {
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

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}

function cors(response) {
  return { ...response, headers: { ...(response.headers || {}), "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" } };
}
