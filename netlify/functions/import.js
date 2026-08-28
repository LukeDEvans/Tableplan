// import — the unified content-import gateway (deterministic; no AI).
//
// POST { source:{ url?, title?, sharedText?, sourceClient? },
//        hints?:{ contentType? },
//        extractedContent?:{ html?, text?, metadata? } }
//   → the import-result contract { type, status, confidence, data, warnings, source }
//
// Stateless EXTRACTION only: it verifies the session, runs the gateway, and
// returns the extracted result. Persistence stays with the caller and the
// existing domain paths (recipe → eat_recipes; article → media.savedArticles).
// Existing endpoints (import-recipe, save-article, fetch-article) are unchanged;
// this is additive.
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const { runImport } = require("./_import-gateway.js");
const { statusForImportError } = require("./_import-fetch.js");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(json(200, {}));
  if (event.httpMethod !== "POST") return cors(json(405, { error: "Method not allowed" }));

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return cors(json(503, { error: "Service not configured." }));

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return cors(json(401, { error: "Not authenticated." }));
  if (!await verifySession(accessToken, serviceKey)) return cors(json(401, { error: "Invalid session." }));

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { return cors(json(400, { error: "Invalid JSON." })); }

  try {
    const result = await runImport(body);
    return cors(json(200, result));
  } catch (error) {
    if (error && (error.isImportFetchError || error.isImportUrlError)) {
      return cors(json(statusForImportError(error), {
        type: "unknown", status: "failed", confidence: 0, warnings: [error.message], error: error.message
      }));
    }
    return cors(json(500, { type: "unknown", status: "failed", error: error.message || "Import failed." }));
  }
};

async function verifySession(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
    });
    return res.ok;
  } catch { return false; }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body)
  };
}

function cors(response) {
  return {
    ...response,
    headers: {
      ...(response.headers || {}),
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization"
    }
  };
}
