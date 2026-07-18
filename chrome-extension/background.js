const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5veW9jamNsdHJlbndkb3ZxcnFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzMjk5MjUsImV4cCI6MjA5MzkwNTkyNX0.UFs3GHdG2yuqOvPGXr6D8DjbvnTLzgC5-KGilg4Oc94";
const IMPORT_RECIPE_URL = "https://effervescent-malabi-e0af55.netlify.app/.netlify/functions/import-recipe";
const SAVE_ARTICLE_URL = "https://effervescent-malabi-e0af55.netlify.app/.netlify/functions/save-article";
const SAVE_PAGE_ARTICLES_URL = "https://effervescent-malabi-e0af55.netlify.app/.netlify/functions/save-page-articles";
const SIMPLEFIN_URL = "https://effervescent-malabi-e0af55.netlify.app/.netlify/functions/simplefin";
const SESSION_KEY = "eatSupabaseSession";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error.message || "Something went wrong." });
  });
  return true;
});

async function handleMessage(message) {
  if (message?.type === "sessionStatus") return sessionStatus();
  if (message?.type === "signIn") return signInWithGoogle();
  if (message?.type === "signOut") return signOut();
  if (message?.type === "importRecipe") return importRecipe(message.url);
  if (message?.type === "saveArticle") return saveArticle(message.url, message.title, message.tabId);
  if (message?.type === "importFromPage") return importFromPage(message.tabId, message.publication);
  if (message?.type === "importReceipt") return importReceiptFromPage(message.tabId);
  return { ok: false, error: "Unknown action." };
}

// Grabs the RENDERED text of an order/receipt page (Target purchase history,
// Amazon orders, …) from the user's logged-in session — no credentials, no
// brittle selectors — and lets the server itemize + categorize it.
async function importReceiptFromPage(tabId) {
  const session = await getValidSession(true);
  if (!tabId) throw new Error("Open the receipt page first.");
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ url: location.href, text: (document.body?.innerText || "").slice(0, 20000) })
  });
  const page = results?.[0]?.result;
  if (!page?.text || page.text.length < 40) throw new Error("Could not read this page.");
  const response = await fetch(SIMPLEFIN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action: "importReceipt", text: page.text, url: page.url })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Import failed (${response.status})`);
  if (!payload.receipt) throw new Error("No itemized receipt found — open a single order's details page.");
  return { ok: true, receipt: payload.receipt };
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

async function importRecipe(url) {
  const session = await getValidSession(true);
  const recipeUrl = normalizeRecipeUrlInput(url);
  if (!recipeUrl) throw new Error("Open a supported recipe URL first.");

  const parsedRecipe = await parseRecipe(recipeUrl);
  const existing = await recipeBySourceUrl(recipeUrl, session.access_token);
  const recipe = {
    ...parsedRecipe,
    id: existing?.id || parsedRecipe.id || createId("recipe"),
    folderId: "",
    sourceUrl: recipeUrl
  };

  await saveRecipe(recipe, session.access_token, Boolean(existing?.id));
  return { ok: true, updated: Boolean(existing?.id), name: recipe.name || "Recipe" };
}

async function saveArticle(url, title, tabId) {
  const session = await getValidSession(true);
  if (!url || !url.startsWith("http")) throw new Error("Open a web page first.");
  const publication = detectPublication(url);

  let extracted = null;
  if (tabId) {
    try {
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: extractArticleTextFromDOM });
      extracted = results?.[0]?.result || null;
    } catch { /* tab may not support scripting; proceed without text */ }
  }

  const body = {
    url,
    title: extracted?.title || title || url,
    publication,
    text: extracted?.text || null,
    author: extracted?.author || null,
    date: extracted?.date || null
  };

  const response = await fetch(SAVE_ARTICLE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Save failed with status ${response.status}`);

  if (!payload.already_saved && payload.id) {
    const article = {
      id: payload.id,
      url: body.url,
      title: body.title,
      publication: body.publication,
      savedAt: new Date().toISOString(),
      author: body.author || null,
      date: body.date || null,
      text: body.text || null
    };
    pushArticleToAppTabs(article).catch(() => {});
  }

  return { ok: true, already_saved: payload.already_saved || false, hasText: Boolean(extracted?.text) };
}

// Runs inside the article page — must be self-contained (no closures, no imports)
function extractArticleTextFromDOM() {
  function esc(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function getMeta(name) {
    return (
      document.querySelector('meta[property="' + name + '"]')?.content ||
      document.querySelector('meta[name="' + name + '"]')?.content ||
      ""
    );
  }

  const title = getMeta("og:title") || document.title || "";
  const author = getMeta("author") || getMeta("article:author") || getMeta("byl") || "";
  const date =
    getMeta("article:published_time") ||
    getMeta("date") ||
    document.querySelector("time[datetime]")?.getAttribute("datetime") ||
    "";

  // Wikipedia gets a dedicated path: generic extraction would keep "[edit]"
  // links, [1][2] citation markers, and the References/External-links tail —
  // all garbage when the article is read aloud.
  if (/(^|\.)wikipedia\.org$/i.test(location.hostname)) {
    const src = document.querySelector("#mw-content-text .mw-parser-output");
    if (src) {
      const root = src.cloneNode(true);
      root.querySelectorAll(
        ".mw-editsection, sup.reference, .reference, sup.noprint, .infobox, .navbox, " +
        ".vertical-navbox, .sidebar, table, figure, .thumb, .hatnote, .shortdescription, " +
        ".toc, #toc, .reflist, .mw-references-wrap, style, .gallery, .metadata, .ambox, " +
        ".portalbox, .sistersitebox, .mw-empty-elt, .side-box"
      ).forEach(function (el) { el.remove(); });
      const STOP_H2 = /^(references|external links|see also|further reading|notes|footnotes|bibliography|sources|citations|works cited)$/i;
      const wikiBlocks = [];
      const wikiSeen = new Set();
      let stopped = false;
      root.querySelectorAll("p, h2, h3, h4, blockquote").forEach(function (el) {
        if (stopped) return;
        const raw = (el.innerText || "").replace(/\s+/g, " ").trim();
        if (el.tagName === "H2") {
          if (STOP_H2.test(raw)) { stopped = true; return; }
        }
        // Strip leftover citation markers: [1], [a], [citation needed], [note 2]
        const text = raw.replace(/\[\d+\]|\[[a-z]\]|\[citation needed\]|\[note \d+\]|\[update\]/gi, "").trim();
        if (text.length < 12 || wikiSeen.has(text)) return;
        wikiSeen.add(text);
        const tag = el.tagName.toLowerCase();
        wikiBlocks.push(tag === "p" || tag === "blockquote" ? "<p>" + esc(text) + "</p>" : "<h3>" + esc(text) + "</h3>");
      });
      if (wikiBlocks.length >= 2) {
        const wikiTitle = (document.querySelector("#firstHeading")?.innerText || title).trim();
        return { title: wikiTitle, author: "Wikipedia", date: "", text: wikiBlocks.join("\n") };
      }
    }
  }

  const SELECTORS = [
    '[data-testid="article-body"]',
    'section[name="articleBody"]',
    '[class*="StoryBodyCompanionColumn"]',
    '[class*="article__body-text"]',
    '[class*="article__body"]',
    '[class*="articleBody"]',
    '[class*="article-body"]',
    '[class*="story-body"]',
    '[class*="post-body"]',
    '[class*="entry-content"]',
    "article",
    "main"
  ];

  const SKIP_RE = /^(subscribe|sign in|log in|advertisement|share|follow|newsletter|cookies|more from|read more|listen|related)/i;

  // Extracts blocks from a SET of containers (many sites split one article
  // body across several same-class sections — a single querySelector only
  // caught the first fragment, truncating the save).
  function collectBlocks(containers) {
    const seen = new Set();
    const blocks = [];
    let totalLen = 0;
    containers.forEach(function (container) {
      container.querySelectorAll("p, h2, h3, h4, blockquote").forEach(function (el) {
        if (el.closest("nav, aside, [aria-hidden='true'], [aria-hidden=\"true\"]")) return;
        const cls = (el.getAttribute("class") || "") + " " + (el.parentElement?.getAttribute("class") || "");
        if (/promo|newsletter|ad[-_]|related|recommend|paywall/i.test(cls)) return;
        const text = (el.innerText || "").replace(/\s+/g, " ").trim();
        if (text.length < 12 || seen.has(text)) return;
        // Boilerplate filter only applies to short blocks — a real paragraph
        // can legitimately start with "Listen…" or "Share…"
        if (text.length < 120 && SKIP_RE.test(text)) return;
        seen.add(text);
        const tag = el.tagName.toLowerCase();
        blocks.push(tag === "p" || tag === "blockquote" ? "<p>" + esc(text) + "</p>" : "<h3>" + esc(text) + "</h3>");
        totalLen += text.length;
      });
    });
    return { blocks: blocks, totalLen: totalLen };
  }

  let best = null;
  for (const sel of SELECTORS) {
    try {
      const els = Array.from(document.querySelectorAll(sel));
      if (!els.length) continue;
      const cand = collectBlocks(els);
      if (cand.blocks.length >= 3) { best = cand; break; }
    } catch { /* skip bad selector */ }
  }

  // Sanity check against a broad container: if the page's <article>/<main>
  // yields much more text, the specific selector only matched a fragment.
  const broadRoot = document.querySelector("article") || document.querySelector("main");
  if (broadRoot) {
    const broad = collectBlocks([broadRoot]);
    if (broad.blocks.length >= 3 && (!best || broad.totalLen > best.totalLen * 1.6)) best = broad;
  }

  if (!best || best.blocks.length < 3) return null;
  return { title: title.trim(), author: author.trim(), date: date.trim(), text: best.blocks.join("\n") };
}

async function importFromPage(tabId, publication) {
  const session = await getValidSession(true);

  const extractor = publication === "nyt" ? extractNYTFromDOM : extractEconomistFromDOM;
  const results = await chrome.scripting.executeScript({ target: { tabId }, func: extractor });
  const articles = results?.[0]?.result;
  if (!Array.isArray(articles) || articles.length === 0) {
    throw new Error("No saved articles found on this page. Make sure you're on the saved articles page and it has finished loading.");
  }

  const response = await fetch(SAVE_PAGE_ARTICLES_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ articles })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Save failed (${response.status})`);
  return { ok: true, imported: payload.imported, total: articles.length };
}

// Runs inside the NYT page — must be self-contained (no closures, no imports)
function extractNYTFromDOM() {
  const seen = new Set();
  const articles = [];
  const NYT_RE = /nytimes\.com\/(\d{4})\/(\d{2})\/(\d{2})\//;
  const LANG_RE = /\/(es|zh|ar|fr|de)\//;
  const root = document.querySelector("#stream-panel") || document.body;
  root.querySelectorAll("a[href]").forEach((a) => {
    const href = a.href;
    if (!NYT_RE.test(href) || LANG_RE.test(href)) return;
    const url = href.split("?")[0].split("#")[0].replace(/\/$/, "");
    if (seen.has(url)) return;
    seen.add(url);
    const container = a.closest("article, li, [data-testid]") || a;
    const titleEl = container.querySelector("h1,h2,h3,h4") || a;
    const title = titleEl.textContent.trim() || url;
    articles.push({ url, title, publication: "nyt" });
  });
  return articles;
}

// Runs inside the Economist page — must be self-contained
function extractEconomistFromDOM() {
  const seen = new Set();
  const articles = [];
  const ECON_RE = /economist\.com\/[a-z-]+\/\d{4}\/\d{2}\/\d{2}\//;
  const root = document.querySelector('[class*="bookmarks-client"]') || document.body;
  root.querySelectorAll("a[href]").forEach((a) => {
    const href = a.href;
    if (!ECON_RE.test(href)) return;
    const url = href.split("?")[0].split("#")[0].replace(/\/$/, "");
    if (seen.has(url)) return;
    seen.add(url);
    const container = a.closest("article, li, [class*='teaser']") || a;
    const titleEl = container.querySelector("h3, h2, h4") || a;
    const title = titleEl.textContent.trim() || url;
    articles.push({ url, title, publication: "economist" });
  });
  return articles;
}

async function pushArticleToAppTabs(article) {
  const APP_URLS = [
    "https://effervescent-malabi-e0af55.netlify.app/*",
    "http://localhost:4174/*",
    "http://localhost:8888/*"
  ];
  const tabs = await chrome.tabs.query({ url: APP_URLS });
  for (const tab of tabs) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: function(a) {
          if (typeof window._liveAddArticle === "function") window._liveAddArticle(a);
        },
        args: [article]
      });
    } catch { /* tab may not be injectable; ignore */ }
  }
}

function detectPublication(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.includes("nytimes.com")) return "nyt";
    if (h.includes("economist.com")) return "economist";
    if (h.includes("startribune.com")) return "startribune";
    if (h.includes("wikipedia.org")) return "wikipedia";
  } catch { /* ignore */ }
  return "other";
}

async function parseRecipe(recipeUrl) {
  const helperUrl = IMPORT_RECIPE_URL;
  const response = await fetch(`${helperUrl}?url=${encodeURIComponent(recipeUrl)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Import failed with status ${response.status}`);
  if (!payload.recipe?.name && !payload.recipe?.ingredients?.length) throw new Error("No recipe data found.");
  return payload.recipe;
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
