const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5veW9jamNsdHJlbndkb3ZxcnFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMjk5MjUsImV4cCI6MjA5MzkwNTkyNX0.UFs3GHdG2yuqOvPGXr6D8DjbvnTLzgC5-KGilg4Oc94";
const IMPORT_HELPERS = {
  live: "https://effervescent-malabi-e0af55.netlify.app/.netlify/functions/import-recipe",
  local: "http://localhost:4174/api/import-recipe"
};
const SESSION_KEY = "eatSupabaseSession";
const IMPORT_TARGET_KEY = "eatImportTarget";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error.message || "Something went wrong." });
  });
  return true;
});

async function handleMessage(message) {
  if (message?.type === "sessionStatus") return sessionStatus();
  if (message?.type === "importTarget") return importTargetStatus();
  if (message?.type === "setImportTarget") return setImportTarget(message.target);
  if (message?.type === "signIn") return signInWithGoogle();
  if (message?.type === "signOut") return signOut();
  if (message?.type === "importRecipe") return importRecipe(message.url);
  return { ok: false, error: "Unknown action." };
}

async function sessionStatus() {
  const session = await getValidSession(false);
  return {
    ok: true,
    signedIn: Boolean(session?.access_token),
    email: session?.user?.email || ""
  };
}

async function signInWithGoogle() {
  const redirectTo = chrome.identity.getRedirectURL("supabase");
  const verifier = randomString(64);
  const challenge = await pkceChallenge(verifier);
  const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=s256`;

  const callbackUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const callback = new URL(callbackUrl);
  const error = callback.searchParams.get("error") || new URLSearchParams(callback.hash.slice(1)).get("error");
  if (error) throw new Error(error);

  let session;
  const hashParams = new URLSearchParams(callback.hash.slice(1));
  if (hashParams.get("access_token")) {
    session = sessionFromHash(hashParams);
  } else {
    const code = callback.searchParams.get("code");
    if (!code) throw new Error("Google did not return an auth code.");
    session = await exchangeCodeForSession(code, verifier);
  }

  await storeSession(session);
  return { ok: true, email: session.user?.email || "" };
}

async function signOut() {
  await chrome.storage.local.remove(SESSION_KEY);
  return { ok: true };
}

async function importTargetStatus() {
  return { ok: true, target: await getImportTarget() };
}

async function setImportTarget(target) {
  const normalizedTarget = IMPORT_HELPERS[target] ? target : "live";
  await chrome.storage.local.set({ [IMPORT_TARGET_KEY]: normalizedTarget });
  return { ok: true, target: normalizedTarget };
}

async function importRecipe(url) {
  const session = await getValidSession(true);
  const recipeUrl = normalizeRecipeUrlInput(url);
  if (!recipeUrl) throw new Error("Open a supported recipe URL first.");

  const target = await getImportTarget();
  const parsedRecipe = await parseRecipe(recipeUrl, target);
  const existing = await recipeBySourceUrl(recipeUrl, session.access_token);
  const recipe = {
    ...parsedRecipe,
    id: existing?.id || parsedRecipe.id || createId("recipe"),
    folderId: "",
    sourceUrl: recipeUrl
  };

  await saveRecipe(recipe, session.access_token, Boolean(existing?.id));
  return { ok: true, updated: Boolean(existing?.id), name: recipe.name || "Recipe", target };
}

async function parseRecipe(recipeUrl, target) {
  const helperUrl = IMPORT_HELPERS[target] || IMPORT_HELPERS.live;
  const response = await fetch(`${helperUrl}?url=${encodeURIComponent(recipeUrl)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Import failed with status ${response.status}`);
  if (!payload.recipe?.name && !payload.recipe?.ingredients?.length) throw new Error("No recipe data found.");
  return payload.recipe;
}

async function getImportTarget() {
  const stored = await chrome.storage.local.get(IMPORT_TARGET_KEY);
  return IMPORT_HELPERS[stored[IMPORT_TARGET_KEY]] ? stored[IMPORT_TARGET_KEY] : "live";
}

async function recipeBySourceUrl(sourceUrl, accessToken) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/eat_recipes?select=id&source_url=eq.${encodeURIComponent(sourceUrl)}&limit=1`, {
    headers: supabaseHeaders(accessToken)
  });
  if (!response.ok) throw new Error(`Recipe lookup failed with status ${response.status}`);
  const rows = await response.json();
  return rows[0] || null;
}

async function saveRecipe(recipe, accessToken, isUpdate) {
  const row = recipeToRow(recipe);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/eat_recipes${isUpdate ? `?id=eq.${encodeURIComponent(recipe.id)}` : ""}`, {
    method: isUpdate ? "PATCH" : "POST",
    headers: {
      ...supabaseHeaders(accessToken),
      Prefer: "return=minimal"
    },
    body: JSON.stringify(isUpdate ? row : [row])
  });
  if (!response.ok) throw new Error(`Recipe save failed with status ${response.status}`);
}

function recipeToRow(recipe) {
  return {
    id: recipe.id,
    name: recipe.name || "Untitled recipe",
    time: recipe.time || "",
    servings: Number(recipe.servings) || 1,
    folder_id: null,
    source_url: recipe.sourceUrl || "",
    photo_url: recipe.photoUrl || "",
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
    steps: recipe.steps || "",
    updated_at: new Date().toISOString()
  };
}

async function getValidSession(requireSession) {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  const session = stored[SESSION_KEY];
  if (!session?.access_token) {
    if (requireSession) throw new Error("Connect the extension to Eat first.");
    return null;
  }

  if (session.expires_at && session.expires_at - 60 > Date.now() / 1000) return session;
  if (!session.refresh_token) {
    if (requireSession) throw new Error("Connect the extension to Eat again.");
    return null;
  }

  try {
    const refreshed = await refreshSession(session.refresh_token);
    await storeSession(refreshed);
    return refreshed;
  } catch (error) {
    await chrome.storage.local.remove(SESSION_KEY);
    if (requireSession) throw error;
    return null;
  }
}

async function refreshSession(refreshToken) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error_description || payload.msg || "Could not refresh Eat connection.");
  return normalizeSession(payload);
}

async function exchangeCodeForSession(code, verifier) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ auth_code: code, code_verifier: verifier })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error_description || payload.msg || "Could not finish Google sign-in.");
  return normalizeSession(payload);
}

function sessionFromHash(hashParams) {
  return normalizeSession({
    access_token: hashParams.get("access_token"),
    refresh_token: hashParams.get("refresh_token"),
    expires_in: Number(hashParams.get("expires_in") || 3600),
    token_type: hashParams.get("token_type") || "bearer"
  });
}

function normalizeSession(payload) {
  const accessToken = payload.access_token;
  if (!accessToken) throw new Error("Missing access token.");
  return {
    access_token: accessToken,
    refresh_token: payload.refresh_token || "",
    expires_at: Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600),
    token_type: payload.token_type || "bearer",
    user: payload.user || userFromJwt(accessToken)
  };
}

async function storeSession(session) {
  await chrome.storage.local.set({ [SESSION_KEY]: session });
}

function authHeaders() {
  return {
    apikey: SUPABASE_ANON_KEY,
    "content-type": "application/json"
  };
}

function supabaseHeaders(accessToken) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    "content-type": "application/json"
  };
}

function userFromJwt(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { email: payload.email || "" };
  } catch {
    return { email: "" };
  }
}

function normalizeRecipeUrlInput(value) {
  const trimmed = String(value || "").trim();
  const firstUrl = trimmed.match(/https?:\/\/[^\s]+/i)?.[0] || "";
  if (!firstUrl) return "";
  const duplicateStart = firstUrl.slice(8).search(/https?:\/\//i);
  return duplicateStart >= 0 ? firstUrl.slice(0, duplicateStart + 8) : firstUrl;
}

function createId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function randomString(length) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

async function pkceChallenge(verifier) {
  const bytes = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
