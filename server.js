const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const tls = require("node:tls");
const { scanRecipeFromImages } = require("./recipe-scan");
const { scanReceiptFromImages } = require("./receipt-scan");
const { estimateRecipeNutrition } = require("./nutrition-provider");

// Load .env file if present (for local development)
try {
  const envPath = path.join(__dirname, ".env");
  const envLines = fsSync.readFileSync(envPath, "utf8").split("\n");
  for (const line of envLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = value;
  }
} catch {
  // No .env file — that's fine
}

const PORT = Number(process.env.PORT || 4174);
const ROOT = __dirname;
const DATA_DIR = process.env.EAT_DATA_DIR || path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "tableplan-state.json");
const BACKUP_DIR = process.env.EAT_BACKUP_DIR || path.join(os.homedir(), "Desktop", "Eat", "Backups");
const MAX_BACKUPS = Number(process.env.EAT_MAX_BACKUPS || 20);
const MAX_SAFETY_BACKUPS = Number(process.env.EAT_MAX_SAFETY_BACKUPS || 30);
const BACKUP_MIN_AGE_MS = 48 * 60 * 60 * 1000; // always keep backups younger than 48 h
const US_HOLIDAYS_ICS_URL = "https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics";
const GOOGLE_PLACES_BASE_URL = "https://places.googleapis.com/v1";
const GOOGLE_STORE_TYPES = ["grocery_store", "supermarket", "warehouse_store", "food_store", "market"];
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/import-recipe") {
      await handleRecipeImport(url, response);
      return;
    }
    if (url.pathname === "/api/scan-recipe") {
      await handleRecipeScan(request, response);
      return;
    }
    if (url.pathname === "/api/scan-receipt") {
      await handleReceiptScan(request, response);
      return;
    }
    if (url.pathname === "/api/estimate-nutrition") {
      await handleNutritionEstimate(request, response);
      return;
    }
    if (url.pathname === "/api/holidays") {
      await handleHolidays(response);
      return;
    }
    if (url.pathname === "/api/calendars" || url.pathname === "/api/birthdays") {
      await handleCalendarSync(url, response);
      return;
    }
    if (url.pathname === "/api/google-places") {
      await handleGooglePlaces(url, response);
      return;
    }
    if (url.pathname === "/api/tmdb-search") {
      await handleTmdbSearch(url, response);
      return;
    }
    if (url.pathname === "/api/tmdb-watch-providers") {
      await handleTmdbWatchProviders(url, response);
      return;
    }
    if (url.pathname === "/api/tmdb-season") {
      await handleTmdbSeason(url, response);
      return;
    }
    if (url.pathname === "/api/showtimes") {
      await handleShowtimes(url, response);
      return;
    }
    if (url.pathname === "/api/weekly-email") {
      await handleWeeklyEmail(request, response);
      return;
    }
    if (url.pathname === "/api/email-interview") {
      await handleEmailInterview(request, response);
      return;
    }
    if (url.pathname === "/api/auto-tag-grocery") {
      await handleAutoTagGrocery(request, response);
      return;
    }
    if (url.pathname === "/api/ics-proxy") {
      await handleIcsProxy(url, response);
      return;
    }
    if (url.pathname === "/api/state") {
      await handleState(request, response);
      return;
    }
    if (url.pathname === "/api/backup") {
      await handleBackup(request, response);
      return;
    }
    if (url.pathname === "/api/admin-data") {
      await handleNetlifyFunction("./netlify/functions/admin-data", request, response);
      return;
    }

    await serveStatic(url.pathname, request, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Tableplan server running at http://localhost:${PORT}/`);
});

async function handleRecipeImport(url, response) {
  const sourceUrl = normalizeRecipeUrlInput(url.searchParams.get("url"));
  if (!sourceUrl) {
    sendJson(response, 400, { error: "Missing recipe URL." });
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    sendJson(response, 400, { error: "Invalid recipe URL." });
    return;
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    sendJson(response, 400, { error: "Recipe URL must start with http or https." });
    return;
  }

  if (isGoogleDocUrl(sourceUrl)) {
    const googleDocResult = await importGoogleDocRecipe(sourceUrl);
    if (googleDocResult.error) {
      sendJson(response, googleDocResult.status, { error: googleDocResult.error });
      return;
    }

    sendJson(response, 200, { recipe: googleDocResult.recipe });
    return;
  }

  const fetched = await fetch(sourceUrl, {
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 TableplanRecipeImporter/1.0"
    }
  });
  if (!fetched.ok) {
    sendJson(response, fetched.status, { error: `Recipe page returned ${fetched.status}.` });
    return;
  }

  const html = await fetched.text();
  if (looksLikeBlockedGoogleDoc(html)) {
    sendJson(response, 422, { error: googleDocAccessMessage() });
    return;
  }

  const recipe = parseRecipeHtml(html, sourceUrl);
  if (!recipe.name && !recipe.ingredients.length) {
    sendJson(response, 422, { error: "No recipe data found on that page." });
    return;
  }

  sendJson(response, 200, { recipe });
}

async function handleRecipeScan(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(await readRequestBody(request));
  } catch {
    sendJson(response, 400, { error: "Invalid JSON body." });
    return;
  }

  try {
    const recipe = await scanRecipeFromImages(parsed.images || []);
    sendJson(response, 200, { recipe });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Recipe scan failed." });
  }
}

async function handleReceiptScan(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(await readRequestBody(request));
  } catch {
    sendJson(response, 400, { error: "Invalid JSON body." });
    return;
  }
  try {
    sendJson(response, 200, { receipt: await scanReceiptFromImages(parsed.images || []) });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Receipt scan failed." });
  }
}

async function handleNutritionEstimate(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(await readRequestBody(request));
  } catch {
    sendJson(response, 400, { error: "Invalid JSON body." });
    return;
  }
  try {
    sendJson(response, 200, { estimate: await estimateRecipeNutrition(parsed) });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Nutrition estimate failed." });
  }
}

async function handleHolidays(response) {
  const fetched = await fetch(US_HOLIDAYS_ICS_URL, {
    headers: {
      accept: "text/calendar,text/plain,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 EatHolidaySync/1.0"
    }
  });
  if (!fetched.ok) {
    sendJson(response, fetched.status, { error: `Holiday calendar returned ${fetched.status}.` });
    return;
  }

  sendJson(response, 200, { events: parseHolidayIcs(await fetched.text()) });
}

async function handleCalendarSync(url, response) {
  const calendarUrl = String(url.searchParams.get("url") || "").trim();
  if (!calendarUrl) {
    sendJson(response, 400, { error: "Missing calendar URL." });
    return;
  }
  if (!isAllowedCalendarUrl(calendarUrl)) {
    sendJson(response, 400, { error: "Use a Google Calendar iCal URL." });
    return;
  }
  const fetched = await fetch(calendarUrl, {
    headers: {
      accept: "text/calendar,text/plain,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 EatCalendarSync/1.0"
    }
  });
  if (!fetched.ok) {
    sendJson(response, fetched.status, { error: `Calendar returned ${fetched.status}.` });
    return;
  }

  sendJson(response, 200, { events: parseCalendarIcs(await fetched.text()) });
}

async function handleGooglePlaces(url, response) {
  const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || process.env.Google_Maps || "").trim();
  if (!apiKey) {
    sendJson(response, 503, { error: "Google Maps is not configured yet." });
    return;
  }
  const action = String(url.searchParams.get("action") || "autocomplete");
  try {
    if (action === "details") {
      const store = await fetchGooglePlaceDetails({
        apiKey,
        placeId: url.searchParams.get("placeId"),
        sessionToken: url.searchParams.get("sessionToken"),
        name: url.searchParams.get("name")
      });
      sendJson(response, 200, { store });
      return;
    }
    const suggestions = await fetchGooglePlaceSuggestions({
      apiKey,
      input: url.searchParams.get("input"),
      sessionToken: url.searchParams.get("sessionToken"),
      latitude: url.searchParams.get("latitude"),
      longitude: url.searchParams.get("longitude")
    });
    sendJson(response, 200, { suggestions });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "Google Places request failed." });
  }
}

async function fetchGooglePlaceSuggestions({ apiKey, input, sessionToken, latitude, longitude }) {
  const query = String(input || "").trim();
  if (query.length < 2) return [];
  const locationRestriction = googlePlacesLocationRestriction(latitude, longitude);
  const fetched = await fetch(`${GOOGLE_PLACES_BASE_URL}/places:autocomplete`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.text"
    },
    body: JSON.stringify({
      input: query,
      sessionToken: cleanGooglePlacesSessionToken(sessionToken),
      includedPrimaryTypes: GOOGLE_STORE_TYPES,
      includedRegionCodes: ["us"],
      languageCode: "en",
      regionCode: "us",
      ...(locationRestriction ? { locationRestriction } : {})
    })
  });
  const body = await readGooglePlacesResponse(fetched);
  return (body.suggestions || [])
    .map((suggestion) => suggestion.placePrediction)
    .filter((prediction) => prediction?.placeId)
    .map((prediction) => ({
      placeId: prediction.placeId,
      name: prediction.structuredFormat?.mainText?.text || prediction.text?.text || "Store",
      address: prediction.structuredFormat?.secondaryText?.text || ""
    }));
}

function googlePlacesLocationRestriction(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    circle: {
      center: { latitude: lat, longitude: lng },
      radius: 50000
    }
  };
}

async function fetchGooglePlaceDetails({ apiKey, placeId, sessionToken, name }) {
  const id = String(placeId || "").trim();
  if (!id) throw googlePlacesRequestError(400, "Missing Google Place ID.");
  const params = new URLSearchParams({ languageCode: "en", regionCode: "US" });
  const token = cleanGooglePlacesSessionToken(sessionToken);
  if (token) params.set("sessionToken", token);
  const fetched = await fetch(`${GOOGLE_PLACES_BASE_URL}/places/${encodeURIComponent(id)}?${params}`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "id,formattedAddress,location,types"
    }
  });
  const place = await readGooglePlacesResponse(fetched);
  return {
    placeId: place.id || id,
    name: String(name || "").trim() || "Store",
    address: place.formattedAddress || "",
    latitude: Number(place.location?.latitude) || null,
    longitude: Number(place.location?.longitude) || null,
    types: Array.isArray(place.types) ? place.types : []
  };
}

async function readGooglePlacesResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (response.ok) return body;
  throw googlePlacesRequestError(response.status, body.error?.message || `Google Places returned ${response.status}.`);
}

function cleanGooglePlacesSessionToken(value) {
  return String(value || "").trim().slice(0, 128);
}

function googlePlacesRequestError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseHolidayIcs(text) {
  return unfoldIcsLines(text)
    .join("\n")
    .split("BEGIN:VEVENT")
    .slice(1)
    .map((block) => ({
      date: formatIcsDate(readIcsProperty(block, "DTSTART")),
      summary: cleanHolidaySummary(readIcsProperty(block, "SUMMARY"))
    }))
    .filter((event) => event.date && event.summary);
}

function parseCalendarIcs(text) {
  return unfoldIcsLines(text)
    .join("\n")
    .split("BEGIN:VEVENT")
    .slice(1)
    .map((block) => {
      const startsAt = readIcsProperty(block, "DTSTART");
      const recursYearly = /RRULE[^:\n]*:[^\n]*FREQ=YEARLY/i.test(block);
      return {
        date: formatIcsDate(startsAt),
        monthDay: recursYearly ? formatIcsMonthDay(startsAt) : "",
        recursYearly,
        summary: cleanHolidaySummary(readIcsProperty(block, "SUMMARY"))
      };
    })
    .filter((event) => (event.date || event.monthDay) && event.summary);
}

function isAllowedCalendarUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && ["calendar.google.com", "www.google.com"].includes(url.hostname)
      && url.pathname.includes("/calendar/ical/");
  } catch {
    return false;
  }
}

function unfoldIcsLines(text) {
  return String(text || "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function readIcsProperty(block, propertyName) {
  const line = block.split(/\n/).find((item) => item.startsWith(`${propertyName};`) || item.startsWith(`${propertyName}:`));
  return line ? line.slice(line.indexOf(":") + 1).trim() : "";
}

function formatIcsDate(value) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function formatIcsMonthDay(value) {
  const match = String(value || "").match(/^(\d{4})?(\d{2})(\d{2})/);
  return match ? `${match[2]}-${match[3]}` : "";
}

function cleanHolidaySummary(value) {
  return String(value || "").replace(/\\,/g, ",").replace(/\\;/g, ";").trim();
}

function normalizeRecipeUrlInput(value) {
  const trimmed = String(value || "").trim();
  const firstUrl = trimmed.match(/https?:\/\/[^\s]+/i)?.[0] || "";
  if (!firstUrl) return "";
  const duplicateStart = firstUrl.slice(8).search(/https?:\/\//i);
  return duplicateStart >= 0 ? firstUrl.slice(0, duplicateStart + 8) : firstUrl;
}

async function importGoogleDocRecipe(sourceUrl) {
  const exportUrl = googleDocTextExportUrl(sourceUrl);
  if (!exportUrl) return { status: 400, error: "Invalid Google Docs recipe URL." };

  const fetched = await fetch(exportUrl, {
    headers: {
      "accept": "text/plain,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 TableplanRecipeImporter/1.0"
    }
  });

  if (!fetched.ok) {
    return { status: 422, error: googleDocAccessMessage() };
  }

  const text = await fetched.text();
  if (looksLikeBlockedGoogleDoc(text)) {
    return { status: 422, error: googleDocAccessMessage() };
  }

  const recipe = parseRecipeText(text, sourceUrl, await readGoogleDocTitle(sourceUrl));
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
    const fetched = await fetch(sourceUrl, {
      headers: {
        "accept": "text/html,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 TableplanRecipeImporter/1.0"
      }
    });
    if (!fetched.ok) return "";
    return findTitle(await fetched.text()).replace(/\s*-\s*Google Docs\s*$/i, "").trim();
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

async function handleEmailInterview(request, response) {
  if (request.method !== "POST") { sendJson(response, 405, { error: "Method not allowed." }); return; }
  let body;
  try { body = JSON.parse(await readRequestBody(request)); } catch { sendJson(response, 400, { error: "Invalid JSON." }); return; }

  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) { sendJson(response, 503, { error: "ANTHROPIC_API_KEY not set in .env" }); return; }

  const currentPrefs = await readEmailPrefs();

  if (body.step === "questions") {
    const prefsContext = currentPrefs.trim()
      ? `Current preferences:\n${currentPrefs.trim()}`
      : "No preferences set yet.";
    const raw = await claudeCall(apiKey, {
      system: `You help Luke configure a personal weekly email digest from his life-management app.
The email covers: recipes added, meal plan, exercise logs, to-do progress, watch list, calendar events.
Generate exactly 6 short, specific questions to understand his preferences for tone, structure, and content.
Return ONLY a valid JSON array of 6 strings — no explanation, no markdown fences, no keys, just the array.`,
      user: prefsContext
    });
    let questions;
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    try { questions = JSON.parse(cleaned); } catch { questions = cleaned.split("\n").map((s) => s.trim().replace(/^["'\d.\s-]+/, "").replace(/[",]+$/, "").trim()).filter((s) => s.length > 10).slice(0, 6); }
    sendJson(response, 200, { questions });
  } else if (body.step === "update") {
    const qa = (body.questions || []).map((q, i) => `Q: ${q}\nA: ${(body.answers || [])[i] || "(no answer)"}`).join("\n\n");
    const prefsContext = currentPrefs.trim() ? `\nCurrent preferences:\n${currentPrefs.trim()}` : "";
    const newPrefs = await claudeCall(apiKey, {
      system: `You are rewriting a personal email-preferences file for Luke's weekly digest.
Output ONLY clean markdown — a short intro comment line starting with #, then bullet points.
Each bullet should be a specific, actionable instruction for future emails.
Incorporate the existing preferences unless an answer contradicts them.
Do not include the Q&A themselves. No preamble, no explanation — just the markdown file content.`,
      user: `Interview answers:\n\n${qa}${prefsContext}`
    });
    sendJson(response, 200, { prefs: newPrefs.trim() });
  } else if (body.step === "save") {
    const content = String(body.prefs || "").trim();
    if (!content) { sendJson(response, 400, { error: "No content to save." }); return; }
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(EMAIL_PREFS_FILE, content + "\n", "utf8");
    sendJson(response, 200, { ok: true });
  } else {
    sendJson(response, 400, { error: "Invalid step." });
  }
}

async function claudeCall(apiKey, { system, user, maxTokens = 1024 }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error?.message || `Anthropic API error ${res.status}`); }
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function handleAutoTagGrocery(request, response) {
  if (request.method !== "POST") { sendJson(response, 405, { error: "Method not allowed." }); return; }
  let body;
  try { body = JSON.parse(await readRequestBody(request)); } catch { sendJson(response, 400, { error: "Invalid JSON." }); return; }

  const items = Array.isArray(body.items) ? body.items.map(s => String(s).trim()).filter(Boolean) : [];
  if (!items.length) { sendJson(response, 400, { error: "No items provided." }); return; }

  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) { sendJson(response, 503, { error: "ANTHROPIC_API_KEY not set in .env" }); return; }

  const raw = await claudeCall(apiKey, {
    system: `You are a nutrition tagger for the Daily Dozen eating plan. Given a list of grocery items, return a JSON object mapping each item name (exactly as given) to an array of Daily Dozen category IDs.
Valid category IDs: beans, berries, other-fruits, cruciferous-vegetables, greens, other-vegetables, flaxseed, nuts-seeds, herbs-spices, whole-grains, beverages
Rules:
- Only include items that clearly fit a category. Omit items that don't belong to any Daily Dozen category (meat, dairy, eggs, processed food, oil, sugar, condiments, etc.).
- An item may have multiple category IDs (e.g. kale → ["cruciferous-vegetables", "greens"]).
- Return ONLY valid JSON — no explanation, no markdown fences.`,
    user: `Tag these grocery items:\n${items.map((item, i) => `${i + 1}. ${item}`).join("\n")}`,
    maxTokens: 2048
  });

  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let tags;
  try { tags = JSON.parse(cleaned); } catch { sendJson(response, 500, { error: "AI returned invalid JSON." }); return; }
  sendJson(response, 200, { tags });
}

async function handleWeeklyEmail(request, response) {
  if (request.method === "GET") {
    sendJson(response, 200, {
      hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
      hasEmailUser: Boolean(process.env.EMAIL_USER?.trim()),
      hasEmailPassword: Boolean(process.env.EMAIL_APP_PASSWORD?.trim()),
      hasEmailTo: Boolean(process.env.EMAIL_TO?.trim()),
      emailTo: String(process.env.EMAIL_TO || "").trim()
    });
    return;
  }
  if (request.method !== "POST") { sendJson(response, 405, { error: "Method not allowed." }); return; }
  let body;
  try { body = JSON.parse(await readRequestBody(request)); } catch { sendJson(response, 400, { error: "Invalid JSON." }); return; }

  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) { sendJson(response, 503, { error: "ANTHROPIC_API_KEY not set in .env" }); return; }

  const appState = await readStoredState();
  if (!appState) { sendJson(response, 503, { error: "No app state found on disk." }); return; }

  const prefs = String(appState.emailPrefs || await readEmailPrefs()).trim();
  const notes = String(body.notes || "").trim();
  const context = buildWeeklyContext(appState, notes);
  const html = await generateEmailWithClaude(context, apiKey, prefs);

  if (body.preview) { sendJson(response, 200, { html }); return; }

  const emailUser = String(process.env.EMAIL_USER || "").trim();
  const emailPassword = String(process.env.EMAIL_APP_PASSWORD || "").trim();
  const emailTo = String(process.env.EMAIL_TO || "").trim();
  if (!emailUser || !emailPassword || !emailTo) {
    sendJson(response, 503, { error: "EMAIL_USER, EMAIL_APP_PASSWORD, or EMAIL_TO not set in .env" });
    return;
  }
  const subject = `Your Weekly Review – ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  await sendSmtpEmail({ user: emailUser, password: emailPassword, from: emailUser, to: emailTo, subject, html });
  sendJson(response, 200, { ok: true, to: emailTo });
}

function buildWeeklyContext(state, notes = "") {
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const nextWeekStart = new Date(weekEnd); nextWeekStart.setDate(nextWeekStart.getDate() + 1);
  const nextWeekEnd = new Date(nextWeekStart); nextWeekEnd.setDate(nextWeekStart.getDate() + 6);
  const startKey = srvDateKey(weekStart), endKey = srvDateKey(weekEnd);
  const nextStartKey = srvDateKey(nextWeekStart), nextEndKey = srvDateKey(nextWeekEnd);
  const twoWeeksAgo = srvDateKey(new Date(Date.now() - 14 * 86400000));
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const lines = [];

  lines.push(`WEEKLY REVIEW — ${weekStart.toLocaleDateString("en-US", {month:"long",day:"numeric"})} – ${weekEnd.toLocaleDateString("en-US", {month:"long",day:"numeric",year:"numeric"})}`);
  lines.push(`Generated: ${now.toLocaleDateString("en-US", {weekday:"long",month:"long",day:"numeric",year:"numeric"})}`);
  lines.push("");

  // Recipes
  const recipes = Array.isArray(state.recipes) ? state.recipes : [];
  const recentRecipes = recipes.filter((r) => srvDateKey(new Date(r.createdAt || 0)) >= twoWeeksAgo);
  lines.push("=== RECIPES (added in last 14 days) ===");
  if (recentRecipes.length) {
    recentRecipes.forEach((r) => {
      const source = r.sourceUrl ? ` [imported from ${srvHostname(r.sourceUrl)}]` : " [manually added]";
      const ingredients = Array.isArray(r.ingredients) ? r.ingredients.length : 0;
      const hasSteps = String(r.steps || "").trim().length > 20;
      const needsReview = r.sourceUrl && (ingredients < 3 || !hasSteps);
      lines.push(`- "${r.name || "Untitled"}"${source}`);
      if (needsReview) lines.push(`  ⚠️ NEEDS REVIEW: ${ingredients} ingredient(s), steps: ${hasSteps ? "present" : "missing/very short"}`);
      else lines.push(`  ✓ ${ingredients} ingredients, steps present`);
    });
  } else { lines.push("No new recipes added."); }
  lines.push("");

  // Meal plan this week + next
  lines.push("=== MEAL PLAN ===");
  const plans = typeof state.plans === "object" ? state.plans : {};
  const mealRows = [], nextMealRows = [];
  Object.entries(plans).forEach(([weekKey, weekPlan]) => {
    if (typeof weekPlan !== "object") return;
    Object.entries(weekPlan).forEach(([dayOffset, entries]) => {
      if (!Array.isArray(entries) || !entries.length) return;
      try {
        const d = new Date(weekKey + "T00:00:00"); d.setDate(d.getDate() + Number(dayOffset));
        const key = srvDateKey(d);
        const names = entries.map((e) => e.name || e.recipeName || "").filter(Boolean);
        if (!names.length) return;
        const row = `- ${dayNames[d.getDay()]}: ${names.join(", ")}`;
        if (key >= startKey && key <= endKey) mealRows.push(row);
        else if (key >= nextStartKey && key <= nextEndKey) nextMealRows.push(row);
      } catch {}
    });
  });
  if (mealRows.length) mealRows.forEach((r) => lines.push(r)); else lines.push("Nothing planned this week.");
  if (nextMealRows.length) { lines.push("Next week:"); nextMealRows.forEach((r) => lines.push(r)); }
  else lines.push("Next week: not planned yet.");
  lines.push("");

  // Exercise
  lines.push("=== EXERCISE ===");
  const workouts = Array.isArray(state.workouts) ? state.workouts : [];
  const exLogs = [];
  workouts.forEach((w) => {
    (Array.isArray(w.logs) ? w.logs : []).forEach((log) => {
      if (log.date < startKey || log.date > endKey) return;
      const details = [];
      if (log.timedMinutes && log.timedMinutes !== "0") details.push(`${log.timedMinutes} min`);
      if (log.distanceWhole && log.distanceWhole !== "0") details.push(`${log.distanceWhole}${log.distanceDecimal ? `.${log.distanceDecimal}` : ""} ${log.distanceUnit || "km"}`);
      exLogs.push(`- ${log.date}: ${w.title || "Workout"}${details.length ? ` (${details.join(", ")})` : ""}`);
    });
  });
  if (exLogs.length) exLogs.forEach((r) => lines.push(r)); else lines.push("No workouts logged this week.");
  lines.push("");

  // To-do
  lines.push("=== TO DO ===");
  const allTasks = [...(Array.isArray(state.doTasks) ? state.doTasks : []),
    ...Object.values(state.doPlans || {}).flatMap((d) => Object.values(d || {}).flat())];
  const done = allTasks.filter((t) => t?.done);
  const pending = allTasks.filter((t) => t && !t.done && (t.title || t.text || t.name));
  if (done.length) { lines.push(`Completed: ${done.length}`); done.slice(0, 5).forEach((t) => lines.push(`  ✓ "${t.title || t.text || t.name}"`)); if (done.length > 5) lines.push(`  … and ${done.length - 5} more`); }
  if (pending.length) { lines.push(`Pending: ${pending.length}`); pending.slice(0, 5).forEach((t) => lines.push(`  - "${t.title || t.text || t.name}"`)); if (pending.length > 5) lines.push(`  … and ${pending.length - 5} more`); }
  if (!done.length && !pending.length) lines.push("No tasks found.");
  lines.push("");

  // Watch list
  lines.push("=== WATCH LIST ===");
  const watchItems = Array.isArray(state.watchItems) ? state.watchItems : [];
  const watched = watchItems.filter((w) => (w.logs || []).some((l) => l.date >= startKey && l.date <= endKey));
  const addedToWatch = watchItems.filter((w) => srvDateKey(new Date(w.createdAt || 0)) >= startKey);
  if (watched.length) { lines.push("Watched this week:"); watched.forEach((w) => { const log = (w.logs || []).filter((l) => l.date >= startKey && l.date <= endKey).slice(-1)[0]; lines.push(`  - "${w.title || w.name}"${log?.stars ? ` (${"★".repeat(log.stars)})` : ""}`); }); }
  if (addedToWatch.length) { lines.push("Added to watch list:"); addedToWatch.forEach((w) => lines.push(`  - "${w.title || w.name}"`)); }
  if (!watched.length && !addedToWatch.length) lines.push("No watch activity this week.");
  lines.push("");

  // Calendar events
  const planEvents = Array.isArray(state.planEvents) ? state.planEvents : [];
  const calThis = planEvents.filter((e) => e.date >= startKey && e.date <= endKey);
  const calNext = planEvents.filter((e) => e.date >= nextStartKey && e.date <= nextEndKey);
  if (calThis.length || calNext.length) {
    lines.push("=== CALENDAR ===");
    if (calThis.length) { lines.push("This week:"); calThis.forEach((e) => lines.push(`  - ${e.date}: ${e.title}${e.startTime ? ` at ${e.startTime}` : ""}`)); }
    if (calNext.length) { lines.push("Next week:"); calNext.forEach((e) => lines.push(`  - ${e.date}: ${e.title}${e.startTime ? ` at ${e.startTime}` : ""}`)); }
  }

  if (notes) {
    lines.push("");
    lines.push("=== NOTES FOR THIS EMAIL ===");
    lines.push(notes);
  }

  return lines.join("\n");
}

function srvDateKey(date) { return date.toISOString().slice(0, 10); }
function srvHostname(url) { try { return new URL(url).hostname; } catch { return url; } }

const EMAIL_PREFS_FILE = path.join(DATA_DIR, "email-prefs.md");

async function readEmailPrefs() {
  try { return await fs.readFile(EMAIL_PREFS_FILE, "utf8"); } catch { return ""; }
}

async function generateEmailWithClaude(context, apiKey, prefs = "") {
  const prefsSection = prefs.trim()
    ? `\n\nSTANDING PREFERENCES FROM LUKE:\n${prefs.trim()}`
    : "";
  return await claudeCall(apiKey, {
    maxTokens: 2048,
    system: `You are a personal assistant writing a weekly digest email for a life-management app called "Live". The user is Luke.
Write a warm, personal, helpful email in clean HTML with inline styles (for email client compatibility).
Style: body background #FFFDF6, font Arial/sans-serif, max-width 600px centered, headings color #92400E, body text #1C1917.
Structure: warm greeting → week recap (recipes, meals, exercise, to-do, watching, calendar) → anything flagged ⚠️ needing attention → brief look ahead.
Tone: like a thoughtful friend reviewing the week with Luke, not a corporate newsletter. Conversational, encouraging, scannable.
Output ONLY the HTML body content (start with a <div> or <table>, no doctype/html/head/body tags).${prefsSection}`,
    user: context
  }) || "<p>Could not generate email content.</p>";
}

function sendSmtpEmail({ user, password, from, to, subject, html }) {
  return new Promise((resolve, reject) => {
    const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@live.local>`;
    const message = [
      `From: "Live App" <${from}>`, `To: ${to}`, `Subject: ${subject}`,
      `MIME-Version: 1.0`, `Content-Type: text/html; charset=utf-8`,
      `Date: ${new Date().toUTCString()}`, `Message-ID: ${msgId}`,
      "", ...html.split("\n").map((l) => (l === "." ? ".." : l)), "."
    ].join("\r\n");

    const socket = tls.connect(465, "smtp.gmail.com", { servername: "smtp.gmail.com" });
    let step = 0, buf = "";
    const send = (cmd) => socket.write(cmd + "\r\n");

    socket.setTimeout(20000);
    socket.on("timeout", () => { socket.destroy(); reject(new Error("SMTP timeout")); });
    socket.on("error", reject);
    socket.on("close", () => { if (step >= 7) resolve(); });

    socket.on("data", (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 2);
        if (line.length < 3 || line[3] === "-") continue;
        const code = Number(line.slice(0, 3));
        if (step === 0 && code === 220) { send("EHLO live.local"); step = 1; }
        else if (step === 1 && code === 250) { send(`AUTH PLAIN ${Buffer.from(`\0${user}\0${password}`).toString("base64")}`); step = 2; }
        else if (step === 2 && code === 235) { send(`MAIL FROM:<${from}>`); step = 3; }
        else if (step === 3 && code === 250) { send(`RCPT TO:<${to}>`); step = 4; }
        else if (step === 4 && code === 250) { send("DATA"); step = 5; }
        else if (step === 5 && code === 354) { socket.write(message + "\r\n"); step = 6; }
        else if (step === 6 && code === 250) { send("QUIT"); step = 7; }
        else if (step === 7 && code === 221) { socket.end(); resolve(); }
        else if (code >= 400) { socket.destroy(); reject(new Error(`SMTP ${code}: ${line}`)); }
      }
    });
  });
}

async function handleIcsProxy(url, response) {
  const calUrl = String(url.searchParams.get("url") || "").trim();
  if (!calUrl) { sendJson(response, 400, { error: "Missing url." }); return; }
  let parsed;
  try { parsed = new URL(calUrl); } catch { sendJson(response, 400, { error: "Invalid URL." }); return; }
  if (parsed.protocol !== "https:") { sendJson(response, 400, { error: "Only https URLs are supported." }); return; }
  const fetched = await fetch(calUrl, {
    headers: { accept: "text/calendar,text/plain,*/*;q=0.8", "user-agent": "Mozilla/5.0 EatPlanSync/1.0" }
  });
  if (!fetched.ok) { sendJson(response, fetched.status, { error: `Calendar returned ${fetched.status}.` }); return; }
  sendJson(response, 200, { events: parsePlanIcs(await fetched.text()) });
}

function parsePlanIcs(text) {
  return unfoldIcsLines(text)
    .join("\n")
    .split("BEGIN:VEVENT")
    .slice(1)
    .map((block) => {
      const summary = cleanHolidaySummary(readIcsProperty(block, "SUMMARY"));
      if (!summary) return null;
      const start = readIcsDatetime(block, "DTSTART");
      if (!start.date) return null;
      const end = readIcsDatetime(block, "DTEND") || computeIcsEnd(start, readIcsProperty(block, "DURATION"));
      return {
        uid: readIcsProperty(block, "UID") || `ics-${Math.random().toString(36).slice(2)}`,
        title: summary,
        date: start.date,
        startTime: start.time || null,
        endTime: end.time || null,
        endDate: (end.date && end.date !== start.date) ? end.date : null,
        allDay: start.allDay,
        notes: cleanHolidaySummary(readIcsProperty(block, "DESCRIPTION")),
        location: cleanHolidaySummary(readIcsProperty(block, "LOCATION")),
        recurring: /RRULE/i.test(block)
      };
    })
    .filter(Boolean);
}

function readIcsDatetime(block, prop) {
  const line = block.split("\n").find((l) => l.startsWith(`${prop}:`) || l.startsWith(`${prop};`));
  if (!line) return null;
  const value = line.slice(line.indexOf(":") + 1).trim();
  const allDay = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (allDay) return { date: `${allDay[1]}-${allDay[2]}-${allDay[3]}`, time: null, allDay: true };
  const dt = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (dt) return { date: `${dt[1]}-${dt[2]}-${dt[3]}`, time: `${dt[4]}:${dt[5]}`, allDay: false };
  return null;
}

function computeIcsEnd(start, duration) {
  if (!start) return null;
  if (!duration) {
    if (start.allDay) return { date: icsAddDays(start.date, 1), time: null, allDay: true };
    if (start.time) return { date: start.date, time: icsAddHour(start.time, 1), allDay: false };
    return start;
  }
  const days = Number(duration.match(/P(\d+)D/i)?.[1] || 0);
  const hours = Number(duration.match(/T.*?(\d+)H/i)?.[1] || 0);
  const mins = Number(duration.match(/T.*?(\d+)M/i)?.[1] || 0);
  if (start.allDay && days) return { date: icsAddDays(start.date, days), time: null, allDay: true };
  if (start.time && (hours || mins)) return { date: start.date, time: icsAddMinutes(start.time, hours * 60 + mins), allDay: false };
  return start;
}

function icsAddDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function icsAddHour(time, h) {
  const [hr, mn] = time.split(":").map(Number);
  return `${String((hr + h) % 24).padStart(2, "0")}:${String(mn).padStart(2, "0")}`;
}

function icsAddMinutes(time, mins) {
  const [hr, mn] = time.split(":").map(Number);
  const total = hr * 60 + mn + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

async function handleState(request, response) {
  if (request.method === "GET") {
    const state = await readStoredState();
    sendJson(response, 200, { state });
    return;
  }

  if (request.method === "PUT") {
    const body = await readRequestBody(request);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      sendJson(response, 400, { error: "Invalid JSON body." });
      return;
    }

    await writeStoredState(parsed.state || parsed);
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 405, { error: "Method not allowed." });
}

async function handleBackup(request, response) {
  if (request.method === "GET") {
    const fileName = new URL(request.url, "http://localhost").searchParams.get("file");
    if (fileName) {
      if (!/^eat-(backup|safety)-[\w.-]+\.json$/.test(fileName)) {
        sendJson(response, 400, { error: "Invalid backup file name." });
        return;
      }
      const filePath = path.join(BACKUP_DIR, fileName);
      try {
        const data = await fs.readFile(filePath, "utf8");
        sendJson(response, 200, JSON.parse(data));
      } catch (error) {
        sendJson(response, error.code === "ENOENT" ? 404 : 500, { error: "Backup file not found." });
      }
      return;
    }
    sendJson(response, 200, await backupStatus());
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const body = await readRequestBody(request);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(response, 400, { error: "Invalid JSON body." });
    return;
  }

  const backup = await writeRotatingBackup(parsed.state || parsed, {
    protected: Boolean(parsed.protected),
    reason: String(parsed.reason || "")
  });
  sendJson(response, 200, { ok: true, backup });
}

async function readStoredState() {
  try {
    const data = await fs.readFile(STATE_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeStoredState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${STATE_FILE}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(state, null, 2)}\n`);
  await fs.rename(tempFile, STATE_FILE);
}

async function writeRotatingBackup(state, options = {}) {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const checksum = stateChecksum(state);
  const existing = await findBackupByChecksum(checksum, Boolean(options.protected));
  if (existing) return { fileName: existing.fileName, folder: BACKUP_DIR, deduplicated: true };
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = options.protected ? "eat-safety" : "eat-backup";
  const fileName = `${prefix}-${timestamp}.json`;
  const filePath = path.join(BACKUP_DIR, fileName);
  const backupPayload = {
    app: "Live",
    version: 1,
    createdAt: new Date().toISOString(),
    protected: Boolean(options.protected),
    reason: String(options.reason || ""),
    state,
    checksum
  };
  await fs.writeFile(filePath, `${JSON.stringify(backupPayload, null, 2)}\n`);
  await pruneOldBackups();
  return { fileName, folder: BACKUP_DIR };
}

async function backupStatus() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const backups = await backupFiles();
  const latest = backups[0] || null;
  return {
    ok: true,
    folder: BACKUP_DIR,
    maxBackups: MAX_BACKUPS,
    backupCount: backups.length,
    latestBackup: latest,
    latestValidation: latest ? await validateBackupFile(latest.filePath) : null,
    backups: backups.map(({ filePath, ...backup }) => backup)
  };
}

async function backupFiles() {
  const entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
  const backups = await Promise.all(entries
    .filter((entry) => entry.isFile() && /^eat-(backup|safety)-.+\.json$/.test(entry.name))
    .map(async (entry) => {
      const filePath = path.join(BACKUP_DIR, entry.name);
      const stat = await fs.stat(filePath);
      return {
        fileName: entry.name,
        filePath,
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
        modifiedAt: stat.mtime.toISOString(),
        mtimeMs: stat.mtimeMs
      };
    }));
  return backups.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function findBackupByChecksum(checksum, protectedBackup) {
  const prefix = protectedBackup ? "eat-safety-" : "eat-backup-";
  const backups = (await backupFiles()).filter((backup) => backup.fileName.startsWith(prefix));
  for (const backup of backups) {
    try {
      const parsed = JSON.parse(await fs.readFile(backup.filePath, "utf8"));
      if (parsed.checksum === checksum) return backup;
    } catch {
      // Invalid files remain visible to backup health and are ignored for deduplication.
    }
  }
  return null;
}

async function validateBackupFile(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    const state = parsed.state || parsed;
    const recipeCount = Array.isArray(state?.recipes) ? state.recipes.length : 0;
    const folderCount = Array.isArray(state?.folders) ? state.folders.length : 0;
    const checksumMatches = parsed.checksum ? parsed.checksum === stateChecksum(state) : null;
    return {
      ok: Boolean(state && Array.isArray(state.recipes)),
      recipeCount,
      folderCount,
      checksumMatches
    };
  } catch (error) {
    return { ok: false, error: error.message || "Backup could not be read." };
  }
}

function stateChecksum(state) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(state))
    .digest("hex");
}

async function pruneOldBackups() {
  const backups = await backupFiles();
  const cutoff = Date.now() - BACKUP_MIN_AGE_MS;
  pruneBackupGroup(backups.filter((b) => b.fileName.startsWith("eat-backup-")), MAX_BACKUPS, cutoff);
  pruneBackupGroup(backups.filter((b) => b.fileName.startsWith("eat-safety-")), MAX_SAFETY_BACKUPS, cutoff);
}

function pruneBackupGroup(backups, minKeep, cutoffMs) {
  // Always keep the newest minKeep entries. Also keep anything younger than cutoffMs
  // (48 h) so yesterday's data is always recoverable. Hard cap at minKeep * 10 to
  // prevent unbounded growth if the app is used heavily every day.
  const hardCap = minKeep * 10;
  backups.slice(hardCap).forEach((b) => fs.unlink(b.filePath).catch(() => {}));
  backups.slice(0, hardCap)
    .filter((b, i) => i >= minKeep && b.mtimeMs < cutoffMs)
    .forEach((b) => fs.unlink(b.filePath).catch(() => {}));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 15_000_000) {
        request.destroy();
        reject(new Error("Request body too large."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function serveStatic(pathname, request, response) {
  const cleanPath = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const filePath = path.normalize(path.join(ROOT, cleanPath));
  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  const file = await fs.readFile(filePath);
  const stat = await fs.stat(filePath);
  response.writeHead(200, {
    "content-type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
    "content-length": stat.size,
    "last-modified": stat.mtime.toUTCString(),
    "cache-control": "no-store"
  });
  if (request.method !== "HEAD") response.end(file);
  else response.end();
}

async function handleNetlifyFunction(modulePath, request, response) {
  const fn = require(modulePath);
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  const event = {
    httpMethod: request.method,
    headers: request.headers,
    body,
    queryStringParameters: {}
  };
  const result = await fn.handler(event);
  response.writeHead(result.statusCode, result.headers || { "content-type": "application/json; charset=utf-8" });
  response.end(result.body);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function parseRecipeHtml(html, sourceUrl) {
  const jsonRecipes = findJsonLdBlocks(html)
    .flatMap(parseJsonLd)
    .map(findRecipeNode)
    .filter(Boolean);
  const recipe = jsonRecipes[0];
  if (!recipe) return parseRecipeText(htmlToText(html), sourceUrl);

  return {
    name: textValue(recipe.name) || findTitle(html),
    prepTime: readableDuration(textValue(recipe.prepTime)),
    cookTime: readableDuration(textValue(recipe.cookTime)),
    time: readableDuration(textValue(recipe.totalTime || recipe.cookTime || recipe.prepTime)),
    servings: parseServings(recipe.recipeYield),
    folderId: "",
    sourceUrl,
    ingredients: arrayValue(recipe.recipeIngredient).map((line) => parseIngredientLine(String(line))),
    steps: instructionsToText(recipe.recipeInstructions)
  };
}

function findJsonLdBlocks(html) {
  const blocks = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html))) blocks.push(decodeHtml(match[1].trim()));
  return blocks;
}

function parseJsonLd(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function findRecipeNode(node) {
  if (!node || typeof node !== "object") return null;
  const type = arrayValue(node["@type"]).map((item) => String(item).toLowerCase());
  if (type.includes("recipe")) return node;
  if (Array.isArray(node["@graph"])) return node["@graph"].map(findRecipeNode).find(Boolean) || null;
  return null;
}

function parseRecipeText(text, sourceUrl = "", fallbackName = "") {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/^\uFEFF/, "").trim()).filter(Boolean);
  const ingredientsStart = lines.findIndex((line) => /^ingredients:?$/i.test(line));
  const explicitInstructionsStart = lines.findIndex((line) => /^(instructions|directions|preparation|method):?$/i.test(line));
  const repeatedIngredientsStart = ingredientsStart >= 0
    ? lines.findIndex((line, index) => index > ingredientsStart && /^ingredients:?$/i.test(line))
    : -1;
  const instructionsStart = explicitInstructionsStart >= 0 ? explicitInstructionsStart : repeatedIngredientsStart;
  const name = fallbackName || findPlainTextRecipeName(lines, ingredientsStart) || "";
  let ingredientLines = [];
  let instructionLines = [];

  if (ingredientsStart >= 0) {
    const end = instructionsStart > ingredientsStart ? instructionsStart : lines.length;
    ingredientLines = lines.slice(ingredientsStart + 1, end);
    instructionLines = instructionsStart >= 0 ? lines.slice(instructionsStart + 1) : [];
  } else {
    ingredientLines = lines.slice(1).filter(looksLikeIngredient);
    instructionLines = lines.slice(1).filter((line) => !looksLikeIngredient(line));
  }

  return {
    name,
    time: "",
    prepTime: "",
    cookTime: "",
    servings: 1,
    folderId: "",
    sourceUrl,
    ingredients: ingredientLines.map(parseIngredientLine),
    steps: instructionLines.join("\n")
  };
}

function instructionsToText(instructions) {
  return arrayValue(instructions).map((step) => {
    if (typeof step === "string") return step;
    return step.text || step.name || "";
  }).filter(Boolean).join("\n");
}

function findPlainTextRecipeName(lines, ingredientsStart) {
  const nameCandidates = ingredientsStart >= 0 ? lines.slice(0, ingredientsStart) : lines;
  return nameCandidates.find((line) => !/^(prep|cook|total) time:/i.test(line) && !/^servings?:/i.test(line)) || lines[0] || "";
}

function parseIngredientLine(line) {
  const normalizedLine = line.trim()
    .replace(/^[-*]\s*/, "")
    .replace(/⅛/g, "1/8")
    .replace(/¼/g, "1/4")
    .replace(/⅓/g, "1/3")
    .replace(/½/g, "1/2")
    .replace(/⅔/g, "2/3")
    .replace(/¾/g, "3/4");
  const prepMatch = normalizedLine.match(/\(([^)]+)\)$/);
  const prepText = prepMatch ? prepMatch[1].toLowerCase() : "";
  const lineWithoutPrep = prepMatch ? normalizedLine.slice(0, prepMatch.index).trim() : normalizedLine;
  const parts = lineWithoutPrep.split(/\s+/);
  const amountOptions = ["pinch", "1/8", "1/4", "1/3", "1/2", "2/3", "3/4", "1", "1 1/4", "1 1/2", "1 3/4", "2", "2 1/4", "2 1/2", "2 3/4", "3", "3 1/4", "3 1/2", "3 3/4", "4", "4 1/4", "4 1/2", "4 3/4", "5", "5 1/4", "5 1/2", "5 3/4", "6", "6 1/4", "6 1/2", "6 3/4", "7", "7 1/4", "7 1/2", "7 3/4", "8", "8 1/4", "8 1/2", "8 3/4", "9", "9 1/4", "9 1/2", "9 3/4", "10", "10 1/4", "10 1/2", "10 3/4", "11", "11 1/4", "11 1/2", "11 3/4", "12", "12 1/4", "12 1/2", "12 3/4", "13", "13 1/4", "13 1/2", "13 3/4", "14", "14 1/4", "14 1/2", "14 3/4", "15", "15 1/4", "15 1/2", "15 3/4", "16"];
  const amount = takeIngredientAmount(parts, amountOptions);
  let quantity = "";
  const rawUnit = parts[0] || "";
  const unit = rawUnit.toLowerCase();
  const unitMap = { c: "C", cup: "C", cups: "C", t: "tsp", tablespoon: "Tbsp", tablespoons: "Tbsp", tbsp: "Tbsp", teaspoon: "tsp", teaspoons: "tsp", tsp: "tsp", pound: "lb", pounds: "lb", lb: "lb", ounce: "oz", ounces: "oz", oz: "oz", cans: "can", can: "can", cloves: "clove", clove: "clove", slices: "slice", slice: "slice" };
  const mappedUnit = rawUnit === "T" ? "Tbsp" : rawUnit === "t" ? "tsp" : unitMap[unit];
  if (mappedUnit) {
    quantity = mappedUnit;
    parts.shift();
  }
  const prepOptions = ["chopped", "diced", "minced", "sliced", "grated", "zested", "juiced", "peeled", "crushed", "rinsed", "drained", "cooked", "uncooked", "melted", "softened"];
  const trailingPrep = prepOptions.includes(parts.at(-1)?.toLowerCase()) ? parts.pop().toLowerCase() : "";
  const prep = prepOptions.includes(prepText) ? prepText : trailingPrep;
  const item = prep && prepMatch ? parts.join(" ") : [parts.join(" "), prepText && !prep ? `(${prepText})` : ""].filter(Boolean).join(" ");
  return { amount, quantity, item, prep };
}

function takeIngredientAmount(parts, options) {
  const mixedAmount = `${parts[0] || ""} ${parts[1] || ""}`.trim();
  if (options.includes(mixedAmount)) {
    parts.shift();
    parts.shift();
    return mixedAmount;
  }
  return options.includes(parts[0]) ? parts.shift() : "";
}

function htmlToText(html) {
  return decodeHtml(html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim());
}

function findTitle(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return decodeHtml((h1 || title || "").replace(/<[^>]+>/g, "")).trim();
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function readableDuration(value) {
  if (!/^P(T|\d)/i.test(value)) return value;
  const hours = Number(value.match(/(\d+)H/i)?.[1] || 0);
  const minutes = Number(value.match(/(\d+)M/i)?.[1] || 0);
  return [hours ? `${hours} hr` : "", minutes ? `${minutes} min` : ""].filter(Boolean).join(" ");
}

function arrayValue(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  return value ? String(value) : "";
}

function parseServings(value) {
  const text = textValue(value);
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : 1;
}

function looksLikeIngredient(line) {
  return /^(\d|pinch|⅛|¼|⅓|½|⅔|¾)/i.test(line) || /\b(cup|cups|tablespoon|tablespoons|tbsp|teaspoon|teaspoons|tsp|ounce|ounces|oz|pound|pounds|lb|can|clove|slice)\b/i.test(line);
}

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

function tmdbApiKey() {
  return String(process.env.TMDB_API_KEY || "").trim();
}

async function handleTmdbSearch(url, response) {
  const apiKey = tmdbApiKey();
  if (!apiKey) {
    sendJson(response, 503, { error: "TMDB is not configured. Set TMDB_API_KEY to enable streaming search." });
    return;
  }
  const query = String(url.searchParams.get("q") || "").trim();
  if (!query) {
    sendJson(response, 400, { error: "Missing search query." });
    return;
  }
  try {
    const fetched = await fetch(
      `${TMDB_BASE_URL}/search/multi?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&language=en-US&page=1&include_adult=false`
    );
    if (!fetched.ok) {
      sendJson(response, fetched.status, { error: `TMDB returned ${fetched.status}.` });
      return;
    }
    const data = await fetched.json();
    const results = (data.results || [])
      .filter((r) => r.media_type === "movie" || r.media_type === "tv")
      .slice(0, 8)
      .map((r) => ({
        tmdbId: r.id,
        type: r.media_type,
        title: r.media_type === "movie" ? (r.title || r.original_title || "") : (r.name || r.original_name || ""),
        year: r.media_type === "movie" ? (r.release_date || "").slice(0, 4) : (r.first_air_date || "").slice(0, 4),
        posterPath: r.poster_path || null,
        overview: r.overview || "",
        totalSeasons: r.media_type === "tv" ? (r.number_of_seasons || null) : null
      }));
    sendJson(response, 200, { results });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "TMDB search failed." });
  }
}

async function handleTmdbWatchProviders(url, response) {
  const apiKey = tmdbApiKey();
  if (!apiKey) {
    sendJson(response, 503, { error: "TMDB is not configured." });
    return;
  }
  const id = String(url.searchParams.get("id") || "").trim();
  const type = String(url.searchParams.get("type") || "movie").trim();
  if (!id || !["movie", "tv"].includes(type)) {
    sendJson(response, 400, { error: "Missing or invalid id/type." });
    return;
  }
  try {
    const fetches = [
      fetch(`${TMDB_BASE_URL}/${type}/${encodeURIComponent(id)}/watch/providers?api_key=${encodeURIComponent(apiKey)}`),
      fetch(`${TMDB_BASE_URL}/${type}/${encodeURIComponent(id)}?api_key=${encodeURIComponent(apiKey)}&language=en-US`)
    ];
    if (type === "movie") {
      fetches.push(fetch(`${TMDB_BASE_URL}/movie/${encodeURIComponent(id)}/release_dates?api_key=${encodeURIComponent(apiKey)}`));
    }
    const [providerRes, detailRes, releaseDatesRes] = await Promise.all(fetches);
    if (!providerRes.ok) {
      sendJson(response, providerRes.status, { error: `TMDB returned ${providerRes.status}.` });
      return;
    }
    const providerData = await providerRes.json();
    const detailData = detailRes.ok ? await detailRes.json() : {};
    const releaseDatesData = releaseDatesRes?.ok ? await releaseDatesRes.json() : null;
    let extra;
    if (type === "movie") {
      extra = { runtime: detailData.runtime || null, ...detectInTheaters(releaseDatesData) };
    } else {
      extra = {
        totalSeasons: detailData.number_of_seasons || null,
        totalEpisodes: detailData.number_of_episodes || null,
        avgEpisodeRuntime: detailData.episode_run_time?.[0] || null
      };
    }
    sendJson(response, 200, { providers: providerData.results?.US || null, ...extra });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "TMDB watch providers request failed." });
  }
}

async function handleShowtimes(url, response) {
  const apiKey = String(process.env.SERPAPI_KEY || "").trim();
  if (!apiKey) { sendJson(response, 503, { error: "SERPAPI_KEY is not configured." }); return; }
  const title = String(url.searchParams.get("title") || "").trim();
  if (!title) { sendJson(response, 400, { error: "Missing title." }); return; }
  const location = String(url.searchParams.get("location") || "").trim();
  try {
    const params = new URLSearchParams({ engine: "google", q: `${title} showtimes`, hl: "en", gl: "us", api_key: apiKey });
    if (location) params.set("location", location);
    const res = await fetch(`https://serpapi.com/search.json?${params}`);
    const data = await res.json();
    if (!res.ok) { sendJson(response, res.status, { error: data.error || "SerpAPI error." }); return; }
    sendJson(response, 200, { showtimes: data.showtimes || [] });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Showtimes request failed." });
  }
}

function detectInTheaters(releaseDatesData) {
  const none = { inTheaters: false, theatricalReleaseDate: null };
  if (!releaseDatesData?.results) return none;
  const us = releaseDatesData.results.find((r) => r.iso_3166_1 === "US");
  if (!us) return none;
  const theatrical = us.release_dates.find((r) => r.type === 3);
  if (!theatrical) return none;
  const theatricalDate = new Date(theatrical.release_date);
  const releaseDate = theatrical.release_date.slice(0, 10);
  const now = new Date();
  if (theatricalDate > now) return { inTheaters: false, theatricalReleaseDate: releaseDate };
  if ((now - theatricalDate) / 86400000 > 90) return none;
  const digital = us.release_dates.find((r) => r.type === 4);
  if (digital && new Date(digital.release_date) <= now) return none;
  return { inTheaters: true, theatricalReleaseDate: releaseDate };
}

async function handleTmdbSeason(url, response) {
  const apiKey = tmdbApiKey();
  if (!apiKey) {
    sendJson(response, 503, { error: "TMDB is not configured." });
    return;
  }
  const id = String(url.searchParams.get("id") || "").trim();
  const season = String(url.searchParams.get("season") || "").trim();
  if (!id || !season) {
    sendJson(response, 400, { error: "Missing id or season." });
    return;
  }
  try {
    const fetched = await fetch(
      `${TMDB_BASE_URL}/tv/${encodeURIComponent(id)}/season/${encodeURIComponent(season)}?api_key=${encodeURIComponent(apiKey)}&language=en-US`
    );
    if (!fetched.ok) {
      sendJson(response, fetched.status, { error: `TMDB returned ${fetched.status}.` });
      return;
    }
    const data = await fetched.json();
    const episodes = (data.episodes || []).map((ep) => ({
      episodeNumber: ep.episode_number,
      name: ep.name || `Episode ${ep.episode_number}`,
      airDate: ep.air_date || null
    }));
    sendJson(response, 200, { episodes });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "TMDB season request failed." });
  }
}
