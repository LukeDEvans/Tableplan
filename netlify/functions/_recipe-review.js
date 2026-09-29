// _recipe-review.js — pure logic for the Recipe Box review queue.
//
// Recipes that arrive WITHOUT the user typing them in (Gmail-found recipes, the
// Chrome extension, in-app URL import / paste / scan / share) are parked here
// until the user opens them in the recipe editor and saves (= approves) or
// dismisses them. Only a saved recipe reaches the recipe book (eat_recipes).
//
// Storage: one service-only row per user, id "recipereview_<userId>" (no ":" so
// client RLS policies can never match it — same pattern as finreceipts_). The
// row's state is { items: [QueueItem] }. Everything here is pure so it unit-tests
// without a network; recipe-review.js wraps it with auth + updateRawRow.

const MAX_ITEMS = 50;
const MAX_TEXT = 20000;
const SOURCES = new Set(["gmail", "extension", "import", "scan", "share", "other"]);

function reviewRowId(userId) {
  return `recipereview_${userId}`;
}

function str(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function canonicalSourceUrl(url) {
  const raw = str(url);
  if (!raw) return "";
  try {
    const u = new URL(raw);
    u.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "smid", "smtyp"].forEach((k) => u.searchParams.delete(k));
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return raw.replace(/[#].*$/, "").replace(/\/+$/, "");
  }
}

// Keep only the recipe fields the client editor understands, bounded in size, so a
// hostile or buggy caller can't bloat the row.
function sanitizeRecipe(recipe = {}) {
  const list = (value, max = 200) => (Array.isArray(value) ? value.slice(0, max) : []);
  const steps = Array.isArray(recipe.steps) ? recipe.steps.map((s) => str(s, 4000)).join("\n") : str(recipe.steps, MAX_TEXT);
  return {
    name: str(recipe.name, 300),
    prepTime: str(recipe.prepTime, 60),
    cookTime: str(recipe.cookTime, 60),
    time: str(recipe.time, 60),
    servings: Number(recipe.servings) > 0 ? Math.min(Number(recipe.servings), 1000) : 0,
    sourceUrl: str(recipe.sourceUrl, 2000),
    photoUrl: str(recipe.photoUrl, 2000),
    tags: list(recipe.tags, 50).map((t) => str(t, 60)).filter(Boolean),
    ingredients: list(recipe.ingredients, 200),
    nutrition: list(recipe.nutrition, 100),
    steps
  };
}

function normalizeQueueItem(input = {}, { now = new Date().toISOString(), createId } = {}) {
  const recipe = sanitizeRecipe(input.recipe || {});
  const source = SOURCES.has(input.source) ? input.source : "other";
  return {
    id: str(input.id, 100) || (createId ? createId() : `rr-${Date.now().toString(36)}`),
    source,
    queuedAt: str(input.queuedAt, 40) || now,
    recipe
  };
}

function queueItems(state) {
  return Array.isArray(state?.items) ? state.items.filter((item) => item && item.id && item.recipe) : [];
}

// Adds an item, de-duplicating on the canonical source URL (a re-imported link
// replaces its older queued copy rather than stacking). Returns the new state, or
// null when the item has nothing reviewable (no name and no ingredients/steps).
function addToQueue(state, item) {
  const r = item.recipe || {};
  if (!r.name && !(r.ingredients || []).length && !r.steps) return null;
  const canon = canonicalSourceUrl(r.sourceUrl);
  const kept = queueItems(state).filter((existing) => existing.id !== item.id
    && !(canon && canonicalSourceUrl(existing.recipe?.sourceUrl) === canon));
  const items = [item, ...kept].slice(0, MAX_ITEMS);
  return { ...(state || {}), items };
}

function removeFromQueue(state, ids) {
  const drop = new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean));
  const items = queueItems(state);
  const next = items.filter((item) => !drop.has(item.id));
  if (next.length === items.length) return null; // nothing to write
  return { ...(state || {}), items: next };
}

module.exports = { MAX_ITEMS, reviewRowId, canonicalSourceUrl, sanitizeRecipe, normalizeQueueItem, queueItems, addToQueue, removeFromQueue };
