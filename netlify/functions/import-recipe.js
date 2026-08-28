// import-recipe — authenticated recipe URL importer.
//
// Thin handler: verify the session, fetch the page through the shared SSRF-guarded
// fetcher (_import-fetch), and run the deterministic recipe extractor
// (_recipe-extract). Parsing, URL handling, and scoring live in reusable modules
// so this file only owns request/response + auth. Response stays backward
// compatible ({ recipe }); an additive { result } carries the import contract.
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const { safeFetch, statusForImportError } = require("./_import-fetch.js");
const { normalizeImportUrlInput } = require("./_import-url.js");
const { extractRecipeFromHtml, extractRecipeFromText, findTitle } = require("./_recipe-extract.js");
const { recipeResult } = require("./_import-contract.js");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return jsonResponse(405, { error: "Method not allowed." });

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return jsonResponse(503, { error: "Service not configured." });

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse(401, { error: "Not authenticated." });
  if (!await verifySession(accessToken, serviceKey)) return jsonResponse(401, { error: "Invalid session." });

  const sourceUrl = normalizeImportUrlInput(event.queryStringParameters?.url);
  if (!sourceUrl) return jsonResponse(400, { error: "Missing recipe URL." });

  try {
    if (isGoogleDocUrl(sourceUrl)) {
      const googleDocResult = await importGoogleDocRecipe(sourceUrl);
      if (googleDocResult.error) return jsonResponse(googleDocResult.status, { error: googleDocResult.error });
      return jsonResponse(200, { recipe: googleDocResult.recipe, result: recipeResult(googleDocResult.recipe, sourceUrl) });
    }

    const fetched = await safeFetch(sourceUrl, {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    });
    if (!fetched.ok) {
      return jsonResponse(fetched.status, { error: `Recipe page returned ${fetched.status}.` });
    }

    const html = fetched.body;
    if (looksLikeBlockedGoogleDoc(html)) {
      return jsonResponse(422, { error: googleDocAccessMessage() });
    }

    const recipe = extractRecipeFromHtml(html, sourceUrl);
    if (!recipe.name && !recipe.ingredients.length) {
      return jsonResponse(422, { error: "No recipe data found on that page." });
    }

    return jsonResponse(200, { recipe, result: recipeResult(recipe, sourceUrl) });
  } catch (error) {
    if (error && (error.isImportFetchError || error.isImportUrlError)) {
      return jsonResponse(statusForImportError(error), { error: error.message });
    }
    return jsonResponse(500, { error: error.message || "Recipe import failed." });
  }
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body)
  };
}

async function verifySession(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
    });
    return res.ok;
  } catch { return false; }
}

async function importGoogleDocRecipe(sourceUrl) {
  const exportUrl = googleDocTextExportUrl(sourceUrl);
  if (!exportUrl) return { status: 400, error: "Invalid Google Docs recipe URL." };

  let fetched;
  try {
    fetched = await safeFetch(exportUrl, { accept: "text/plain,*/*;q=0.8" });
  } catch {
    return { status: 422, error: googleDocAccessMessage() };
  }
  if (!fetched.ok || looksLikeBlockedGoogleDoc(fetched.body)) {
    return { status: 422, error: googleDocAccessMessage() };
  }

  const recipe = extractRecipeFromText(fetched.body, sourceUrl, await readGoogleDocTitle(sourceUrl));
  if (!recipe.name || !recipe.ingredients.length) {
    return { status: 422, error: googleDocAccessMessage() };
  }

  return { status: 200, recipe };
}

function isGoogleDocUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "docs.google.com" && /\/document\/d\/[^/]+/.test(url.pathname);
  } catch {
    return false;
  }
}

function googleDocTextExportUrl(value) {
  const id = String(value || "").match(/\/document\/d\/([^/]+)/)?.[1];
  return id ? `https://docs.google.com/document/d/${id}/export?format=txt` : "";
}

async function readGoogleDocTitle(sourceUrl) {
  try {
    const fetched = await safeFetch(sourceUrl, { accept: "text/html,*/*;q=0.8" });
    if (!fetched.ok) return "";
    return findTitle(fetched.body).replace(/\s*-\s*Google Docs\s*$/i, "").trim();
  } catch {
    return "";
  }
}

function looksLikeBlockedGoogleDoc(text) {
  return /Google Docs/i.test(text) && /JavaScript isn't enabled in your browser|Enable and reload/i.test(text);
}

function googleDocAccessMessage() {
  return "Google Docs could not be read directly. Share the doc as Anyone with the link can view, or copy the recipe text and paste it into Eat.";
}
