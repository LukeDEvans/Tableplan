const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { scanRecipeFromImages } = require("./recipe-scan");
const { scanReceiptFromImages } = require("./receipt-scan");
const { estimateRecipeNutrition } = require("./nutrition-provider");

const PORT = Number(process.env.PORT || 4174);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "tableplan-state.json");
const BACKUP_DIR = process.env.EAT_BACKUP_DIR || path.join(os.homedir(), "Desktop", "Eat", "Backups");
const MAX_BACKUPS = Number(process.env.EAT_MAX_BACKUPS || 5);
const MAX_SAFETY_BACKUPS = Number(process.env.EAT_MAX_SAFETY_BACKUPS || 10);
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
    if (url.pathname === "/api/state") {
      await handleState(request, response);
      return;
    }
    if (url.pathname === "/api/backup") {
      await handleBackup(request, response);
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
  backups
    .filter((backup) => backup.fileName.startsWith("eat-backup-"))
    .slice(MAX_BACKUPS)
    .forEach((backup) => {
      fs.unlink(backup.filePath).catch(() => {});
    });
  backups
    .filter((backup) => backup.fileName.startsWith("eat-safety-"))
    .slice(MAX_SAFETY_BACKUPS)
    .forEach((backup) => {
      fs.unlink(backup.filePath).catch(() => {});
    });
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
