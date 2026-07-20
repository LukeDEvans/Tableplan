// Shared pieces of the recipe-digest Mail AI features (NYT Cooking,
// Bon Appétit, …). Collection happens wherever mail is processed (inbox
// sweep, weekly catch-up): recipe links are persisted to the user's pending
// collection FIRST, then the source email is filed away immediately — to the
// "Apps/AI trash" label while test mode is on, to the real Trash otherwise.
// The weekly digest then emails the whole collection.
// Files prefixed with _ are not deployed as individual functions.
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

// One entry per publication. `key` doubles as the settings toggle in
// state.mailAiSettings (Settings → Mail AI).
const RECIPE_SOURCES = [
  {
    key: "nytCookingDigest",
    name: "NYT Cooking",
    category: "Recipes",
    senderRe: /nytimes\.com/i,
    urlRe: /^https?:\/\/cooking\.nytimes\.com\/recipes\/[a-z0-9][^?#\s"']*/i,
    slugRe: /\/recipes\/(?:\d+-)?([^/?#]+)/i,
    searchQ: 'from:(nytimes.com) ("NYT Cooking" OR subject:cooking)',
    // Every link in NYT newsletters is an nl.nytimes.com click-tracker with no
    // embedded target URL — recipe links only surface after a redirect hop.
    resolveRedirects: true,
    trackerRe: /^https?:\/\/nl\.nytimes\.com\//i
  },
  {
    key: "bonAppetitDigest",
    name: "Bon Appétit",
    category: "Recipes",
    senderRe: /bonappetit\.com/i,
    urlRe: /^https?:\/\/(?:www\.)?bonappetit\.com\/recipe\/[a-z0-9][^?#\s"']*/i,
    slugRe: /\/recipe\/([^/?#]+)/i,
    searchQ: "from:(bonappetit.com)",
    // Condé Nast newsletters wrap links in opaque click-trackers that don't
    // embed the target URL — those need a redirect hop to resolve.
    resolveRedirects: true,
    trackerRe: /^https?:\/\/[^/]*(?:bonappetit|condenast|cmail|exacttarget)\.[^/]+\//i
  },
  {
    key: "nutritionFactsDigest",
    name: "Dr. Greger / NutritionFacts",
    category: "Health",
    senderRe: /nutritionfacts\.org|dr\.?\s*greger/i,
    urlRe: /^https?:\/\/(?:www\.)?nutritionfacts\.org\/(?:video|blog|audio|topics)\/[a-z0-9][^?#\s"']*/i,
    slugRe: /\/(?:video|blog|audio|topics)\/([^/?#]+)/i,
    searchQ: 'from:(nutritionfacts.org)',
    resolveRedirects: true,
    trackerRe: /^https?:\/\/[^/]*(?:nutritionfacts|list-manage|mailchimp|createsend|cmail\d*)\.[^/]+\//i
  },
];

function enabledRecipeSources(mailAiSettings) {
  // Features default ON: only an explicit false (user toggled off) disables.
  return RECIPE_SOURCES.filter((s) => mailAiSettings?.[s.key] !== false);
}

function recipeSourceForSender(from, mailAiSettings) {
  return enabledRecipeSources(mailAiSettings).find((s) => s.senderRe.test(from || "")) || null;
}

// Extracts { url, title, source } for every recipe link of `source` in an
// email body. Unwraps ?url=-style redirects; follows opaque click-trackers
// (bounded, parallel) when the source requires it.
async function extractRecipes(html, source) {
  const anchors = [];
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html)) !== null) anchors.push({ href: m[1], inner: m[2] });

  const results = [];
  const candidates = [];
  const seenHrefs = new Set();
  // Anchor text that is clearly newsletter chrome, not a recipe card
  const BOILER_RE = /unsubscrib|view in browser|privacy|advertis|manage (your )?(preferences|account)|sign ?up|app store|google play|feedback|help center|terms of|follow us|facebook|twitter|instagram|tiktok|read more news|games|wirecutter|athletic|audio|account/i;
  for (const { href, inner } of anchors) {
    const unwrapped = unwrapParamRedirect(href);
    const direct = unwrapped.match(source.urlRe);
    if (direct) {
      results.push({ url: direct[0], inner });
    } else if (source.resolveRedirects && source.trackerRe?.test(href) && !seenHrefs.has(href)) {
      seenHrefs.add(href);
      const innerText = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (BOILER_RE.test(innerText)) continue;
      // Recipe cards carry an image and/or a real title — resolve those first
      const weight = (/<img\b/i.test(inner) ? 2 : 0) + (innerText.length >= 12 ? 1 : 0);
      candidates.push({ href, inner, weight });
    }
  }

  if (candidates.length) {
    const toResolve = candidates.sort((a, b) => b.weight - a.weight).slice(0, 30);
    const resolved = await Promise.all(toResolve.map(async ({ href, inner }) => {
      const final = await followRedirects(href);
      const hit = unwrapParamRedirect(final).match(source.urlRe);
      return hit ? { url: hit[0], inner } : null;
    }));
    resolved.filter(Boolean).forEach((r) => results.push(r));
  }

  return results.map(({ url, inner }) => {
    let title = inner
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&#39;|&apos;|&rsquo;/gi, "’")
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, " ")
      .trim();
    if (!title || title.length < 3 || /^(view|see|tap|click|get|make|recipe|cook|save|read more)\b.{0,14}$/i.test(title)
      || /\bfor the new york times\b|food stylist|prop stylist|photograph by|getty images/i.test(title)) {
      title = titleFromSlug(url, source);
    }
    return title ? { url, title, source: source.name, category: source.category || "Recipes" } : null;
  }).filter(Boolean);
}

function unwrapParamRedirect(raw) {
  let url = String(raw || "");
  for (let i = 0; i < 3; i++) {
    const m = url.match(/[?&](?:url|u|redirect_uri|destination)=([^&]+)/i);
    if (!m) break;
    try { url = decodeURIComponent(m[1]); } catch { break; }
  }
  return url;
}

async function followRedirects(url, hops = 3) {
  let cur = url;
  for (let i = 0; i < hops; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(cur, { method: "GET", redirect: "manual", signal: ctrl.signal });
      clearTimeout(t);
      const loc = res.headers.get("location");
      if (!loc) return cur;
      cur = new URL(loc, cur).toString();
    } catch { return cur; }
  }
  return cur;
}

function titleFromSlug(url, source) {
  const m = url.match(source.slugRe);
  if (!m) return "";
  return m[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Disposal ─────────────────────────────────────────────────────────────────
// Test mode (default ON until explicitly turned off in settings): file the
// email under the "Apps/AI trash" label so it can be verified by hand.
// Otherwise: real Trash.

function aiTrashTestMode(mailAiSettings) {
  return mailAiSettings?.aiTrashTestMode !== false;
}

async function findAiTrashLabelId(gFetch, gToken) {
  const res = await gFetch(gToken, "/labels");
  if (!res.ok) return null;
  const data = await res.json();
  const label = (data.labels || []).find((l) => /^(apps\/)?ai.?trash$/i.test(l.name || ""));
  return label?.id || null;
}

// Returns true if the message was filed away.
async function disposeProcessedEmail(gFetch, gToken, messageId, { testMode, aiTrashLabelId }) {
  if (testMode) {
    if (!aiTrashLabelId) {
      console.error("[recipe-digest] 'Apps/AI trash' label not found — leaving email in place");
      return false;
    }
    const r = await gFetch(gToken, `/messages/${messageId}/modify`, "POST", {
      addLabelIds: [aiTrashLabelId],
      removeLabelIds: ["INBOX", "UNREAD"]
    });
    return r.ok;
  }
  const r = await gFetch(gToken, `/messages/${messageId}/trash`, "POST");
  return r.ok;
}

// ── Pending collection storage (row mailai_<userId>) ────────────────────────

async function loadMailAiRow(serviceKey, userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.mailai_${userId}&select=state`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json" }
  });
  const rows = await res.json().catch(() => []);
  return rows[0]?.state || {};
}

async function saveMailAiRow(serviceKey, userId, state) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({ id: `mailai_${userId}`, state, updated_at: new Date().toISOString() })
  });
  // Must throw on failure: callers dispose the source email after this write,
  // so a silent failure would lose the collected recipes permanently.
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`mailai row save failed (${res.status}): ${detail.slice(0, 200)}`);
  }
}

async function appendPendingRecipes(serviceKey, userId, recipes) {
  const row = await loadMailAiRow(serviceKey, userId);
  const pending = new Map((row.recipesPending || []).map((r) => [r.url, r]));
  for (const r of recipes) {
    const existing = pending.get(r.url);
    if (!existing || r.title.length > existing.title.length) pending.set(r.url, r);
  }
  row.recipesPending = [...pending.values()].slice(-300);
  await saveMailAiRow(serviceKey, userId, row);
  return row;
}

// Classifies each recipe's title as vegetarian or not (dairy/eggs/honey are
// fine; meat, poultry, and fish/seafood are not). Returns an array of
// booleans aligned to `recipes`, or null if classification couldn't be
// trusted (no key, bad response, mismatched length) — callers should treat
// null as "don't filter" rather than dropping everything.
async function classifyVegetarian(anthropicKey, recipes) {
  if (!anthropicKey || !recipes.length) return null;
  try {
    const ai = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_RECIPE_FILTER_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 500,
        temperature: 0,
        messages: [{
          role: "user",
          content: [
            "For each numbered recipe title, decide if the dish is vegetarian.",
            "Dairy, eggs, and honey are fine. Meat, poultry, and fish/seafood (including things like anchovy, bacon, gelatin, fish sauce, or stock/broth unless clearly vegetable) are not.",
            'Reply with ONLY a JSON array of booleans, same order and length as the list, true = vegetarian. No other text.',
            "",
            recipes.map((r, i) => `${i + 1}. ${r.title}`).join("\n")
          ].join("\n")
        }]
      })
    });
    if (!ai.ok) return null;
    const data = await ai.json();
    const text = data?.content?.map((c) => c.text || "").join("") || "";
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr) || arr.length !== recipes.length) return null;
    return arr.map(Boolean);
  } catch {
    return null;
  }
}

module.exports = {
  RECIPE_SOURCES,
  enabledRecipeSources,
  recipeSourceForSender,
  extractRecipes,
  aiTrashTestMode,
  findAiTrashLabelId,
  disposeProcessedEmail,
  loadMailAiRow,
  saveMailAiRow,
  appendPendingRecipes,
  classifyVegetarian
};
