const GOOGLE_PLACES_BASE_URL = "https://places.googleapis.com/v1";
const STORE_TYPES = ["grocery_store", "supermarket", "warehouse_store", "food_store", "market"];
const DEFAULT_SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const DEFAULT_ALLOWED_EMAIL = "mrlukedevans@gmail.com";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return jsonResponse(405, { error: "Method not allowed." });
  const authResult = await authorizeRequest(event);
  if (!authResult.ok) return jsonResponse(authResult.statusCode, { error: authResult.error });
  const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || process.env.Google_Maps || "").trim();
  if (!apiKey) return jsonResponse(503, { error: "Google Maps is not configured yet." });

  const action = String(event.queryStringParameters?.action || "autocomplete");
  try {
    if (action === "details") {
      return jsonResponse(200, {
        store: await fetchPlaceDetails({
          apiKey,
          placeId: event.queryStringParameters?.placeId,
          sessionToken: event.queryStringParameters?.sessionToken,
          name: event.queryStringParameters?.name
        })
      });
    }
    return jsonResponse(200, {
      suggestions: await fetchPlaceSuggestions({
        apiKey,
        input: event.queryStringParameters?.input,
        sessionToken: event.queryStringParameters?.sessionToken
      })
    });
  } catch (error) {
    return jsonResponse(error.statusCode || 500, { error: error.message || "Google Places request failed." });
  }
};

async function authorizeRequest(event) {
  const token = String(event.headers?.authorization || event.headers?.Authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, statusCode: 401, error: "Sign in before searching for stores." };
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceRoleKey) return { ok: false, statusCode: 503, error: "Store search authentication is not configured." };
  const supabaseUrl = String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) return { ok: false, statusCode: 401, error: "Your sign-in session could not be verified." };
  const user = await response.json();
  const allowedEmail = String(process.env.GOOGLE_PLACES_ALLOWED_EMAIL || DEFAULT_ALLOWED_EMAIL).trim().toLowerCase();
  if (allowedEmail && String(user.email || "").toLowerCase() !== allowedEmail) {
    return { ok: false, statusCode: 403, error: "This account is not allowed to use store search." };
  }
  return { ok: true, user };
}

async function fetchPlaceSuggestions({ apiKey, input, sessionToken }) {
  const query = String(input || "").trim();
  if (query.length < 2) return [];
  const response = await fetch(`${GOOGLE_PLACES_BASE_URL}/places:autocomplete`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.text"
    },
    body: JSON.stringify({
      input: query,
      sessionToken: cleanSessionToken(sessionToken),
      includedPrimaryTypes: STORE_TYPES,
      includedRegionCodes: ["us"],
      languageCode: "en",
      regionCode: "us"
    })
  });
  const body = await readGoogleResponse(response);
  return (body.suggestions || [])
    .map((suggestion) => suggestion.placePrediction)
    .filter((prediction) => prediction?.placeId)
    .map((prediction) => ({
      placeId: prediction.placeId,
      name: prediction.structuredFormat?.mainText?.text || prediction.text?.text || "Store",
      address: prediction.structuredFormat?.secondaryText?.text || ""
    }));
}

async function fetchPlaceDetails({ apiKey, placeId, sessionToken, name }) {
  const id = String(placeId || "").trim();
  if (!id) throw requestError(400, "Missing Google Place ID.");
  const params = new URLSearchParams({
    languageCode: "en",
    regionCode: "US"
  });
  const token = cleanSessionToken(sessionToken);
  if (token) params.set("sessionToken", token);
  const response = await fetch(`${GOOGLE_PLACES_BASE_URL}/places/${encodeURIComponent(id)}?${params}`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "id,formattedAddress,location,types"
    }
  });
  const place = await readGoogleResponse(response);
  return {
    placeId: place.id || id,
    name: String(name || "").trim() || "Store",
    address: place.formattedAddress || "",
    latitude: Number(place.location?.latitude) || null,
    longitude: Number(place.location?.longitude) || null,
    types: Array.isArray(place.types) ? place.types : []
  };
}

async function readGoogleResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (response.ok) return body;
  const message = body.error?.message || `Google Places returned ${response.status}.`;
  throw requestError(response.status, message);
}

function cleanSessionToken(value) {
  return String(value || "").trim().slice(0, 128);
}

function requestError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

exports.fetchPlaceSuggestions = fetchPlaceSuggestions;
exports.fetchPlaceDetails = fetchPlaceDetails;
