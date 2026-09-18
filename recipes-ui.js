// recipes-ui.js — Recipes (+ Cook) domain extracted from app.js (createRecipesModule).
// Pattern mirrors groceries-ui.js / finance-ui.js: 17 pure normalizers are top-level exports
// (app.js defaultState/normalizeState/mergeStates call them at boot, before the factory
// exists); the whole recipe/cook UI lives in createRecipesModule(deps). Cook folds in as a
// feature (no standalone surface) per CLAUDE.md Decision #2a.
//
// NOT here (stays in app.js): meal-plan (recipe/ingredient pickers, auto-generate, slot
// resolution, meal-plan recipe cards, serving writeback), the restore/backup machinery
// (mergeMissingRecipesFromBackup, isMissingRestoreRecipe, normalizeRestoreFolder), the
// health-page daily-dozen/food-log UI, the shared scan seam (prepareScanImage/retainScanImage-
// Edits/renderScanImagePreviews/applyScanImageAction — injected), ingredient-options (shared
// with groceries — injected), and shared Supabase primitives (supabaseBaseUrl/Headers/
// deleteSupabaseRow — injected). The relational eat_recipes/eat_folders data layer IS here.
import * as LiveMealPlanServings from './meal-plan-servings.js';
import * as NutritionDomain from './nutrition-domain.js'; // was a bundle-masked free var
import { makeSortable } from './sortable.js';

// Module-scope copies of two tiny standalone helpers (identical to app.js) so the pure
// exports and the factory share one definition without threading them through as deps.
function createId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function normalize(value) {
  return value.toLowerCase().replace(/^[\d\s./-]+/, "").replace(/\s+/g, " ").trim();
}

// Recipe constant data (moved verbatim from app.js).
const preferredFolderOrder = [
  "Breakfast - Weekday",
  "Breakfast - Weekend",
  "Morning Snack",
  "Lunch - Weekday",
  "Lunch - Weekend",
  "Afternoon Snack",
  "Dinner - Main",
  "Dinner - Side"
];

// ── Pure normalizers (top-level exports; boot-safe, no app state) ──────────
export function normalizeActiveCooking(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      id: item?.id || createId("cook"),
      recipeId: item?.recipeId || "",
      startedAt: item?.startedAt || new Date().toISOString(),
      durationMinutes: Math.max(0, Number(item?.durationMinutes) || 0),
      servings: Math.max(1, Number(item?.servings) || 1),
      notes: item?.notes || "",
      completedSteps: Array.isArray(item?.completedSteps) ? item.completedSteps.map(Boolean) : [],
      checkedIngredients: Array.isArray(item?.checkedIngredients) ? item.checkedIngredients.map(Boolean) : [],
      collapsedSections: {
        ingredients: Boolean(item?.collapsedSections?.ingredients),
        instructions: Boolean(item?.collapsedSections?.instructions),
        nutrition: Boolean(item?.collapsedSections?.nutrition)
      }
    }))
    .filter((item) => item.recipeId);
}

export function defaultRecipeTags() {
  return [];
}

export function normalizeRecipeTags(tags) {
  const normalizedTags = new Map();
  [...defaultRecipeTags(), ...(Array.isArray(tags) ? tags : [])]
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .forEach((tag) => {
      const key = normalize(tag);
      if (key !== "protected" && !normalizedTags.has(key)) normalizedTags.set(key, tag);
    });
  return [...normalizedTags.values()].sort((a, b) => normalize(a).localeCompare(normalize(b)));
}

export function normalizeRecipeTagSelection(tags) {
  const normalizedTags = new Map();
  (Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .forEach((tag) => {
      const key = normalize(tag);
      if (key !== "protected" && !normalizedTags.has(key)) normalizedTags.set(key, tag);
    });
  return [...normalizedTags.values()].sort((a, b) => normalize(a).localeCompare(normalize(b)));
}

export function migrateRecipeFoldersToTags(targetState) {
  const foldersById = new Map((targetState.folders || []).map((folder) => [folder.id, folder]));
  const tagValues = [...(targetState.recipeTags || [])];
  (targetState.recipes || []).forEach((recipe) => {
    const folder = foldersById.get(recipe.folderId);
    const nextTags = folder?.name ? [...(recipe.tags || []), folder.name] : recipe.tags;
    recipe.tags = normalizeRecipeTagSelection(nextTags);
    tagValues.push(...recipe.tags);
    recipe.folderId = "";
  });
  targetState.recipeTags = normalizeRecipeTags(tagValues);
  (targetState.folders || []).forEach((folder) => {
    delete folder.protected;
  });
}

export function normalizeRecipe(recipe) {
  const prepTime = recipe?.prepTime || recipe?.time || "";
  const cookTime = recipe?.cookTime || "";
  const defaultServings = Math.max(1, Number(recipe?.defaultServings ?? recipe?.servings) || 1);
  return {
    ...recipe,
    servings: defaultServings,
    defaultServings,
    prepTime,
    cookTime,
    time: recipe?.time || combinedRecipeTime({ prepTime, cookTime }),
    folderId: recipe?.folderId || "",
    photoUrl: recipe?.photoUrl || "",
    createdAt: recipe?.createdAt || recipe?.created_at || "",
    updatedAt: recipe?.updatedAt || recipe?.updated_at || "",
    tags: normalizeRecipeTagSelection(recipe?.tags || []),
    nutrition: normalizeNutritionFacts(recipe?.nutrition),
    nutritionEstimate: normalizeNutritionEstimate(recipe?.nutritionEstimate || recipe?.nutrition_estimate),
    ingredientNutritionMatches: normalizeIngredientNutritionMatches(recipe?.ingredientNutritionMatches || recipe?.ingredient_nutrition_matches),
    cookLog: normalizeCookLog(recipe?.cookLog),
    steps: normalizeInstructionSteps(recipe?.steps).join("\n")
  };
}

export function normalizeCookLog(log) {
  if (!Array.isArray(log)) return [];
  return log
    .map((entry) => ({
      id: entry?.id || createId("log"),
      cookedAt: entry?.cookedAt || entry?.date || new Date().toISOString(),
      notes: String(entry?.notes || "").trim(),
      servings: Math.max(1, Number(entry?.servings) || 1),
      durationSeconds: Math.max(0, Number(entry?.durationSeconds) || 0),
      photoUrl: entry?.photoUrl || entry?.photo_url || ""
    }))
    .filter((entry) => entry.cookedAt)
    .sort((a, b) => Date.parse(b.cookedAt) - Date.parse(a.cookedAt));
}

export function normalizeTrashedRecipe(item) {
  const recipe = normalizeRecipe(item?.recipe || item);
  return {
    id: item?.id || recipe.id || createId("trash"),
    deletedAt: item?.deletedAt || new Date().toISOString(),
    recipe
  };
}

export function seedFolders() {
  return [
    { id: "folder-breakfast", name: "Breakfast" },
    { id: "folder-lunch", name: "Lunch" },
    { id: "folder-dinner", name: "Dinner" }
  ];
}

export function combinedRecipeTime(recipe) {
  const prepTime = recipe?.prepTime || "";
  const cookTime = recipe?.cookTime || "";
  if (prepTime && cookTime) return `Prep ${prepTime} + Cook ${cookTime}`;
  return prepTime || cookTime || recipe?.time || "";
}

export function normalizeInstructionSteps(steps) {
  if (Array.isArray(steps)) return steps.map((step) => String(step || "").trim()).filter(Boolean);
  const text = String(steps || "").trim();
  if (!text) return [];
  const lineSteps = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lineSteps.length > 1) {
    return lineSteps
      .filter((line) => !isStepHeaderOnly(line))
      .map(stripInstructionStepPrefix)
      .filter(Boolean);
  }
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(stripInstructionStepPrefix)
    .filter(Boolean);
}

export function isStepHeaderOnly(line) {
  return /^(step\s*)?\d+[\s.):–\-]*$/i.test(line.trim());
}

export function stripInstructionStepPrefix(step) {
  return String(step || "").trim().replace(/^(step\s*)?\d+[\).:\-]\s*/i, "").trim();
}

export function normalizeNutritionFacts(facts) {
  if (!Array.isArray(facts)) return [];
  return facts
    .map((fact) => {
      if (typeof fact === "string") {
        const [nutrient, ...amountParts] = fact.split(":");
        return { nutrient: (nutrient || "").trim(), amount: amountParts.join(":").trim() };
      }
      return {
        nutrient: String(fact?.nutrient || fact?.name || "").trim(),
        amount: String(fact?.amount || fact?.value || "").trim()
      };
    })
    .filter((fact) => fact.nutrient || fact.amount);
}

export function normalizeNutritionCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return {};
  return {
    fdcId: String(candidate.fdcId || ""),
    description: String(candidate.description || candidate.matchedFood || "").trim(),
    brandOwner: String(candidate.brandOwner || "").trim(),
    dataType: String(candidate.dataType || "").trim(),
    servingSize: Number(candidate.servingSize) || null,
    servingSizeUnit: String(candidate.servingSizeUnit || "").trim(),
    householdServingFullText: String(candidate.householdServingFullText || "").trim(),
    foodNutrients: Array.isArray(candidate.foodNutrients) ? candidate.foodNutrients : [],
    source: String(candidate.source || "USDA FoodData Central"),
    confidenceScore: Math.max(0, Math.min(1, Number(candidate.confidenceScore) || 0))
  };
}

export function normalizeIngredientNutritionMatches(matches) {
  return (Array.isArray(matches) ? matches : []).map((match) => ({
    rawLine: String(match?.rawLine || "").trim(),
    ingredientName: String(match?.ingredientName || "").trim(),
    normalizedName: NutritionDomain.normalizeIngredientName(match?.normalizedName || match?.ingredientName),
    quantity: Number.isFinite(Number(match?.quantity)) ? Number(match.quantity) : null,
    unit: NutritionDomain.normalizeUnit(match?.unit),
    preparationNote: String(match?.preparationNote || "").trim(),
    optional: Boolean(match?.optional),
    required: match?.required !== false,
    fdcId: String(match?.fdcId || ""),
    matchedFood: String(match?.matchedFood || match?.description || "").trim(),
    source: String(match?.source || "").trim(),
    grams: Number.isFinite(Number(match?.grams)) ? Number(match.grams) : null,
    conversionConfidenceScore: Math.max(0, Math.min(1, Number(match?.conversionConfidenceScore) || 0)),
    confidenceScore: Math.max(0, Math.min(1, Number(match?.confidenceScore) || 0)),
    conversionNote: String(match?.conversionNote || "").trim(),
    nutrients: match?.nutrients && typeof match.nutrients === "object" ? match.nutrients : {},
    candidates: (Array.isArray(match?.candidates) ? match.candidates : []).map(normalizeNutritionCandidate)
  }));
}

export function normalizeNutritionEstimate(estimate) {
  if (!estimate || typeof estimate !== "object" || Array.isArray(estimate)) return null;
  const normalizeValues = (values) => Object.fromEntries(
    NutritionDomain.nutrientDefinitions.map(({ key }) => [key, Number(values?.[key]) || 0])
  );
  return {
    totals: normalizeValues(estimate.totals),
    perServing: normalizeValues(estimate.perServing),
    servings: Math.max(1, Number(estimate.servings) || 1),
    confidenceScore: Math.max(0, Math.min(1, Number(estimate.confidenceScore) || 0)),
    source: String(estimate.source || "USDA FoodData Central"),
    lastCalculatedAt: String(estimate.lastCalculatedAt || ""),
    disclaimer: "Estimated from ingredient data; actual values vary.",
    stale: Boolean(estimate.stale)
  };
}

// ══════════════════════════════════════════════════════════════════════════
export function createRecipesModule(deps) {
  const {
    state, elements, persist, render, trashItemTemplate, getActiveAppArea, getAuthSession, getSupabaseClient, setRowStorageReady, getAmountOptions, getQuantityOptions, getPrepOptions, getPendingMealRecipeSelection, getPendingAutoRuleRecipeSelection, clearPendingMealRecipeSelection, clearPendingAutoRuleRecipeSelection, activateEatShell, allowScreenOff, applyScanImageAction, canUseCloudStorage, canUseLocalBackend, chooseRecipeForPendingAutoRule, chooseRecipeForPendingMeal, closeFloatingMenus, dailyDozenCategoryName, dailyDozenRecipeSuggestions, dateInputToIso, dateInputValue, deleteSupabaseRow, displayMealName, escapeHtml, fileToDataUrl, formatServingsLabel, imageElementFromFile, keepScreenOn, mealEntryValue, mirrorStateToLocalStorage, normalizeIngredientOptions, openDailyDozenPage, plannedServingsForEntry, prepareScanImage, recipeForSlot, recordDeletion, removeRecipeFromMealSlots, renderPlanner, renderScanImagePreviews, retainScanImageEdits, rowStorageCanWrite, saveImportedArticle, scheduleLocalBackup, setPageTitle, supabaseBaseUrl, supabaseHeaders, trackUsage, tryPreChangeBackup, unrecordDeletion, updateGroceryMealServing, updateMealPlannedServingsFromContext, formatGroceryAmount, groceryAmountToNumber, renderGroceries,
  } = deps;

  let activeCookingInterval = null;
  let activeFolder = "";
  let activeRecipeTag = "";
  let currentActiveRecipeViewId = "";
  let dragOpenFolderId = "";
  let draggedFolderId = "";
  let draggedRecipeId = "";
  let editingFolderId = "";
  let folderDragOpenTarget = "";
  let folderDragOpenTimer = null;
  let folderMenuId = "";
  let pendingAiRecipeResult = null;
  let pendingCookLogId = "";
  let pendingCookSessionPhotoFile = null;
  let pendingNutritionEstimate = null;
  let pendingNutritionRecipeId = "";
  let pendingRecipePhotoFile = null;
  let recipeTimer = null; // { totalSecs, remainingSecs, paused, intervalId }
  let recipeViewMealContext = null;
  let scanRecipeFiles = [];
  let scanRecipeImageEdits = new Map();
  const recipePhotoBucket = "recipe-photos";
  const activeRecipeScrollPositions = new Map();
  const TIMER_RE = /\b((?:about|approximately|around)\s+)?(\d+(?:\.\d+)?)(\s*(?:to|-|or)\s*(\d+(?:\.\d+)?))?(\s*(?:minutes?|mins?|hours?|hrs?|seconds?|secs?))\b/gi;

function recipePhotoProxyUrl(pathOrUrl) {
  if (!pathOrUrl) return "";
  // Non-Supabase URL (user-entered external link) — use as-is
  if (pathOrUrl.startsWith("http") && !pathOrUrl.includes(".supabase.co")) return pathOrUrl;
  // Extract storage path from full Supabase public or signed URL
  const pub  = "/storage/v1/object/public/"  + recipePhotoBucket + "/";
  const sign = "/storage/v1/object/sign/"    + recipePhotoBucket + "/";
  let path = pathOrUrl;
  const pi = pathOrUrl.indexOf(pub);
  if (pi !== -1) path = pathOrUrl.slice(pi + pub.length);
  else {
    const si = pathOrUrl.indexOf(sign);
    if (si !== -1) path = pathOrUrl.slice(si + sign.length).split("?")[0];
  }
  const token = getAuthSession()?.access_token || "";
  return "/.netlify/functions/recipe-photo?path=" + encodeURIComponent(path) +
    (token ? "&_token=" + encodeURIComponent(token) : "");
}

function recipeTags() {
  const recipeTagSelections = (state.recipes || []).flatMap((recipe) => normalizeRecipeTagSelection(recipe.tags));
  state.recipeTags = normalizeRecipeTags([...(state.recipeTags || []), ...recipeTagSelections]);
  return state.recipeTags;
}

function migrateLegacyRecipeOrganization() {
  migrateRecipeFoldersToTags(state);
  mirrorStateToLocalStorage();
}

function recipeDefaultServings(recipe) {
  return LiveMealPlanServings.recipeDefaultServings(recipe);
}

function activeRecipes() {
  if (!Array.isArray(state.recipes)) state.recipes = [];
  return state.recipes;
}

function trashedRecipes() {
  if (!Array.isArray(state.trashedRecipes)) state.trashedRecipes = [];
  return state.trashedRecipes;
}

async function hydrateRecipeRowsFromSupabase() {
  setRowStorageReady(false);
  if (!canUseCloudStorage() || !getAuthSession()?.access_token) return;

  try {
    const [folders, recipes] = await Promise.all([
      loadFolderRowsFromSupabase(),
      loadRecipeRowsFromSupabase()
    ]);

    if (folders.length || recipes.length) {
      state.folders = folders;
      state.recipes = recipes;
      migrateRecipeFoldersToTags(state);
      mirrorStateToLocalStorage();
      setRowStorageReady(true);
      await writeAllRecipeRowsToSupabase();
      render();
      scheduleLocalBackup();
      return;
    }

    await writeAllRecipeRowsToSupabase();
    setRowStorageReady(true);
    scheduleLocalBackup();
  } catch (error) {
    console.warn("Recipe row storage unavailable; using state storage for recipes.", error);
  }
}

async function loadFolderRowsFromSupabase() {
  const response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_folders?select=id,name,sort_order&order=sort_order.asc,name.asc`, {
    headers: supabaseHeaders(),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Folder row load failed with status ${response.status}`);
  const rows = await response.json();
  const parentIds = new Map((state.folders || []).map((folder) => [folder.id, folder.parentId || ""]));
  return rows.map((row) => ({ id: row.id, name: row.name, parentId: parentIds.get(row.id) || "" }));
}

async function loadRecipeRowsFromSupabase() {
  let response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_recipes?select=id,name,time,prep_time,cook_time,servings,folder_id,source_url,photo_url,created_at,updated_at,ingredients,steps,tags,nutrition,nutrition_estimate,ingredient_nutrition_matches,cook_log&order=name.asc`, {
    headers: supabaseHeaders(),
    cache: "no-store"
  });
  if (!response.ok) {
    response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_recipes?select=id,name,time,prep_time,cook_time,servings,folder_id,source_url,photo_url,created_at,updated_at,ingredients,steps,tags,nutrition,cook_log&order=name.asc`, {
      headers: supabaseHeaders(),
      cache: "no-store"
    });
  }
  if (!response.ok) {
    response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_recipes?select=id,name,time,servings,folder_id,source_url,photo_url,ingredients,steps,tags,nutrition&order=name.asc`, {
      headers: supabaseHeaders(),
      cache: "no-store"
    });
  }
  if (!response.ok) {
    response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_recipes?select=id,name,time,servings,folder_id,source_url,photo_url,ingredients,steps,tags&order=name.asc`, {
      headers: supabaseHeaders(),
      cache: "no-store"
    });
  }
  if (!response.ok) {
    response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_recipes?select=id,name,time,servings,folder_id,source_url,photo_url,ingredients,steps&order=name.asc`, {
      headers: supabaseHeaders(),
      cache: "no-store"
    });
  }
  if (!response.ok) throw new Error(`Recipe row load failed with status ${response.status}`);
  const rows = await response.json();
  return rows.map(recipeFromRow).map(normalizeRecipe);
}

function recipeFromRow(row) {
  const localRecipe = state.recipes?.find((recipe) => recipe.id === row.id);
  // If local recipe was updated more recently than the stored row (e.g. a row write failed),
  // prefer local values for fields that might be stale in row storage.
  const localIsNewer = Boolean(localRecipe?.updatedAt && (!row.updated_at || localRecipe.updatedAt > row.updated_at));
  return {
    id: row.id,
    name: row.name || "",
    time: row.time || "",
    prepTime: row.prep_time || "",
    cookTime: row.cook_time || "",
    servings: Number(row.servings) || 1,
    folderId: row.folder_id || "",
    sourceUrl: row.source_url || "",
    photoUrl: row.photo_url || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    ingredients: Array.isArray(row.ingredients) ? row.ingredients : [],
    tags: (!localIsNewer && Array.isArray(row.tags))
      ? row.tags
      : normalizeRecipeTagSelection(localRecipe?.tags || []),
    nutrition: Array.isArray(row.nutrition) ? row.nutrition : normalizeNutritionFacts(localRecipe?.nutrition || []),
    nutritionEstimate: row.nutrition_estimate || localRecipe?.nutritionEstimate || null,
    ingredientNutritionMatches: Array.isArray(row.ingredient_nutrition_matches)
      ? row.ingredient_nutrition_matches
      : localRecipe?.ingredientNutritionMatches || [],
    cookLog: Array.isArray(row.cook_log) ? row.cook_log : normalizeCookLog(localRecipe?.cookLog || []),
    steps: row.steps || ""
  };
}

function recipeToRow(recipe) {
  return {
    id: recipe.id,
    name: recipe.name,
    time: combinedRecipeTime(recipe),
    prep_time: recipe.prepTime || "",
    cook_time: recipe.cookTime || "",
    servings: Number(recipe.servings) || 1,
    folder_id: recipe.folderId || null,
    source_url: recipe.sourceUrl || "",
    photo_url: recipe.photoUrl || "",
    ingredients: normalizeIngredients(recipe.ingredients),
    tags: normalizeRecipeTagSelection(recipe.tags),
    nutrition: normalizeNutritionFacts(recipe.nutrition),
    nutrition_estimate: normalizeNutritionEstimate(recipe.nutritionEstimate),
    ingredient_nutrition_matches: normalizeIngredientNutritionMatches(recipe.ingredientNutritionMatches),
    cook_log: normalizeCookLog(recipe.cookLog),
    steps: recipe.steps || "",
    updated_at: new Date().toISOString()
  };
}

async function writeAllRecipeRowsToSupabase() {
  if (!rowStorageCanWrite()) return;
  await Promise.all([
    upsertFolderRows(state.folders),
    upsertRecipeRows(activeRecipes())
  ]);
}

function saveFolderRow(folder) {
  if (!rowStorageCanWrite()) return;
  upsertFolderRows(normalizedFolders()).catch((error) => console.warn("Folder row save failed.", error));
}

function saveRecipeRow(recipe) {
  if (!rowStorageCanWrite()) return;
  upsertFolderRows(normalizedFolders())
    .then(() => upsertRecipeRows([recipe]))
    .catch((error) => {
      if (String(error.message || "").includes("tags")) {
        console.warn("Recipe tag row save failed. Run the Supabase tags migration before relying on tags across devices.", error);
      } else {
        console.warn("Recipe row save failed.", error);
      }
    });
}

function deleteFolderRow(folderId) {
  if (!rowStorageCanWrite()) return;
  deleteSupabaseRow("eat_folders", folderId).catch((error) => console.warn("Folder row delete failed.", error));
}

function deleteRecipeRow(recipeId) {
  if (!rowStorageCanWrite()) return;
  deleteSupabaseRow("eat_recipes", recipeId).catch((error) => console.warn("Recipe row delete failed.", error));
}

async function upsertFolderRows(folders) {
  if (!folders.length) return;
  const rows = folders.map((folder, index) => ({
    id: folder.id,
    name: folder.name,
    sort_order: index,
    updated_at: new Date().toISOString()
  }));
  const response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_folders?on_conflict=id`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(rows)
  });
  if (!response.ok) throw new Error(`Folder row save failed with status ${response.status}`);
}

async function upsertRecipeRows(recipes) {
  if (!recipes.length) return;
  const rows = recipes.map(recipeToRow);
  let response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_recipes?on_conflict=id`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(rows)
  });
  if (!response.ok) {
    const fallbackRows = rows.map(({ nutrition_estimate, ingredient_nutrition_matches, ...row }) => row);
    response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_recipes?on_conflict=id`, {
      method: "POST",
      headers: {
        ...supabaseHeaders(),
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(fallbackRows)
    });
  }
  if (!response.ok) {
    const legacyRows = rows.map(({ nutrition, nutrition_estimate, ingredient_nutrition_matches, cook_log, prep_time, cook_time, ...row }) => row);
    response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_recipes?on_conflict=id`, {
      method: "POST",
      headers: {
        ...supabaseHeaders(),
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(legacyRows)
    });
  }
  if (!response.ok) throw new Error(`Recipe row save failed with status ${response.status}`);
}

function normalizedFolders() {
  if (!Array.isArray(state.folders)) state.folders = [];
  state.folders.forEach((folder) => {
    if (!folder.parentId || !state.folders.some((item) => item.id === folder.parentId)) folder.parentId = "";
    delete folder.protected;
  });
  return state.folders.sort(compareFolders);
}

function compareFolders(a, b) {
  const aIndex = preferredFolderOrder.findIndex((name) => normalize(name) === normalize(a.name));
  const bIndex = preferredFolderOrder.findIndex((name) => normalize(name) === normalize(b.name));
  if (aIndex >= 0 || bIndex >= 0) {
    if (aIndex < 0) return 1;
    if (bIndex < 0) return -1;
    return aIndex - bIndex;
  }
  return a.name.localeCompare(b.name);
}

function folderName(folderId) {
  if (!folderId) return "Unfiled";
  return normalizedFolders().find((folder) => folder.id === folderId)?.name || "Unfiled";
}

function openRecipeBoxPage() {
  closeFloatingMenus();
  activateEatShell();
  resetRecipeBoxSearch();
  setPageTitle(getPendingMealRecipeSelection()
    ? `Choose ${getPendingMealRecipeSelection().meal}`
    : getPendingAutoRuleRecipeSelection()
      ? `Choose ${displayMealName(getPendingAutoRuleRecipeSelection().meal)} rule`
      : "Recipe Box");
  if (!elements.recipeBoxPageDialog.open) elements.recipeBoxPageDialog.showModal();
  requestAnimationFrame(() => elements.recipeSearch.focus());
}

function resetRecipeBoxSearch() {
  if (!elements.recipeSearch.value) {
    updateRecipeSearchClearButton();
    return;
  }
  elements.recipeSearch.value = "";
  updateRecipeSearchClearButton();
  renderRecipes();
}

function clearRecipeSearch() {
  elements.recipeSearch.value = "";
  updateRecipeSearchClearButton();
  renderRecipes();
  elements.recipeSearch.focus();
}

function updateRecipeSearchClearButton() {
  elements.clearRecipeSearchBtn.hidden = !elements.recipeSearch.value.trim();
}

function closeRecipeBoxPage() {
  clearPendingMealRecipeSelection();
  clearPendingAutoRuleRecipeSelection();
  elements.recipeBoxPageDialog.close();
}

function renderActiveCooking() {
  const recipeIds = new Set(activeRecipes().map((recipe) => recipe.id));
  const cooking = normalizeActiveCooking(state.activeCooking).filter((item) => recipeIds.has(item.recipeId));
  state.activeCooking = cooking;
  if (!elements.activeCookingSection || !elements.activeCookingList) return;
  if (getActiveAppArea() !== "eat") {
    elements.activeCookingSection.hidden = true;
    return;
  }
  elements.activeCookingSection.hidden = cooking.length === 0;
  elements.activeCookingList.innerHTML = cooking.map(activeCookingTemplate).join("");

  elements.activeCookingList.querySelectorAll("[data-view-active-recipe]").forEach((button) => {
    button.addEventListener("click", () => openActiveRecipeView(button.dataset.viewActiveRecipe));
  });
  elements.activeCookingList.querySelectorAll("[data-finish-cooking]").forEach((button) => {
    button.addEventListener("click", () => requestFinishCooking(button.dataset.finishCooking));
  });
  syncActiveCookingClock();
}

function activeCookingTemplate(item) {
  const recipe = activeRecipes().find((candidate) => candidate.id === item.recipeId);
  if (!recipe) return "";
  return `
    <article class="active-cooking-card">
      <button class="active-cooking-thumb" type="button" data-view-active-recipe="${escapeHtml(item.id)}">
        ${recipe.photoUrl ? `<img class="active-cooking-photo" src="${escapeHtml(recipePhotoProxyUrl(recipe.photoUrl))}" alt="" />` : ""}
        <span class="active-cooking-title">${escapeHtml(recipe.name)}</span>
        <div class="active-cooking-status">
          <span class="active-cooking-servings">${escapeHtml(formatServingsLabel(item.servings))}</span>
          <span class="active-cooking-timer">${escapeHtml(cookingTimerText(item))}</span>
        </div>
      </button>
      <button class="secondary-btn compact-btn active-cooking-done" type="button" data-finish-cooking="${escapeHtml(item.id)}">Done</button>
    </article>
  `;
}

function startCookingRecipe(recipeId, servings) {
  const recipe = activeRecipes().find((item) => item.id === recipeId);
  if (!recipe) return "";
  const baseServings = Number(recipe.servings || 1) || 1;
  const nextServings = Math.max(1, Number(servings) || baseServings);
  const cookingId = createId("cook");
  state.activeCooking = [
    ...normalizeActiveCooking(state.activeCooking).filter((item) => item.recipeId !== recipeId),
    {
      id: cookingId,
      recipeId,
      startedAt: new Date().toISOString(),
      durationMinutes: recipeDurationMinutes(recipe.cookTime || recipe.time),
      servings: nextServings,
      notes: "",
      completedSteps: [],
      checkedIngredients: [],
      collapsedSections: {
        ingredients: false,
        instructions: false,
        nutrition: false
      }
    }
  ];
  persist();
  renderActiveCooking();
  return cookingId;
}

function requestFinishCooking(id) {
  const cookingItem = normalizeActiveCooking(state.activeCooking).find((item) => item.id === id);
  if (!cookingItem) return;
  pendingCookLogId = id;
  if (elements.recipeViewDialog.open) elements.recipeViewDialog.close();
  elements.logCookDialog.showModal();
}

function finishCookingRecipe(id, options = {}) {
  const cookingItem = normalizeActiveCooking(state.activeCooking).find((item) => item.id === id);
  if (cookingItem && options.log) {
    if (typeof options.notes === "string") cookingItem.notes = options.notes;
    if (typeof options.photoUrl === "string") cookingItem.photoUrl = options.photoUrl;
    addCookingLogEntry(cookingItem);
  }
  state.activeCooking = normalizeActiveCooking(state.activeCooking).filter((item) => item.id !== id);
  persist();
  renderActiveCooking();
}

function completeCookingWithoutLog() {
  const cookingId = pendingCookLogId;
  pendingCookLogId = "";
  elements.logCookDialog.close();
  finishCookingRecipe(cookingId, { log: false });
}

function openCookSessionNotesDialog() {
  const cookingItem = normalizeActiveCooking(state.activeCooking).find((item) => item.id === pendingCookLogId);
  if (!cookingItem) return;
  elements.logCookDialog.close();
  elements.cookSessionNotes.value = cookingItem.notes || "";
  pendingCookSessionPhotoFile = null;
  elements.cookSessionPhoto.value = "";
  updateCookSessionPhotoPreview("");
  elements.cookSessionNotesDialog.showModal();
  elements.cookSessionNotes.focus();
}

async function completeCookingWithLog() {
  const cookingId = pendingCookLogId;
  const notes = elements.cookSessionNotes.value.trim();
  const cookingItem = normalizeActiveCooking(state.activeCooking).find((item) => item.id === cookingId);
  if (!cookingItem) return;
  elements.saveCookSessionNotesBtn.disabled = true;
  try {
    const photoUrl = pendingCookSessionPhotoFile
      ? await uploadRecipePhoto(pendingCookSessionPhotoFile, cookingItem.recipeId, "cook")
      : "";
    pendingCookLogId = "";
    pendingCookSessionPhotoFile = null;
    elements.cookSessionNotesDialog.close();
    finishCookingRecipe(cookingId, { log: true, notes, photoUrl });
  } catch (error) {
    updateCookSessionPhotoPreview(error.message || "Photo upload failed.");
  } finally {
    elements.saveCookSessionNotesBtn.disabled = false;
  }
}

function closeCookSessionNotesDialog() {
  pendingCookLogId = "";
  pendingCookSessionPhotoFile = null;
  elements.cookSessionPhoto.value = "";
  elements.cookSessionNotesDialog.close();
}

function handleCookSessionPhotoSelection() {
  pendingCookSessionPhotoFile = elements.cookSessionPhoto.files?.[0] || null;
  updateCookSessionPhotoPreview(pendingCookSessionPhotoFile
    ? `Ready to upload: ${pendingCookSessionPhotoFile.name}`
    : "Optional photo from this cook.");
}

function updateCookSessionPhotoPreview(message) {
  if (!elements.cookSessionPhotoPreview) return;
  elements.cookSessionPhotoPreview.innerHTML = pendingCookSessionPhotoFile
    ? `<span>${escapeHtml(message)}</span>`
    : escapeHtml(message || "Optional photo from this cook.");
}

function addCookingLogEntry(cookingItem) {
  const recipeIndex = activeRecipes().findIndex((recipe) => recipe.id === cookingItem.recipeId);
  if (recipeIndex < 0) return;
  const recipe = normalizeRecipe(activeRecipes()[recipeIndex]);
  recipe.cookLog = normalizeCookLog([
    {
      id: createId("log"),
      cookedAt: new Date().toISOString(),
      notes: cookingItem.notes || "",
      servings: cookingItem.servings,
      durationSeconds: elapsedCookingSeconds(cookingItem),
      photoUrl: cookingItem.photoUrl || ""
    },
    ...(recipe.cookLog || [])
  ]);
  if (cookingItem.photoUrl && !recipe.photoUrl) recipe.photoUrl = cookingItem.photoUrl;
  activeRecipes()[recipeIndex] = recipe;
  saveRecipeRow(recipe);
}

function syncActiveCookingClock() {
  const hasActiveRecipes = normalizeActiveCooking(state.activeCooking).length > 0;
  if (activeCookingInterval && !hasActiveRecipes) {
    clearInterval(activeCookingInterval);
    activeCookingInterval = null;
  }
  if (!activeCookingInterval && hasActiveRecipes) {
    activeCookingInterval = window.setInterval(renderActiveCooking, 1000);
  }
}

function recipeDurationMinutes(timeText) {
  const text = String(timeText || "").toLowerCase();
  if (!text.trim()) return 0;
  let minutes = 0;
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/);
  if (hourMatch) minutes += Number(hourMatch[1]) * 60;
  if (minuteMatch) minutes += Number(minuteMatch[1]);
  if (!minutes) {
    const numberMatch = text.match(/\d+(?:\.\d+)?/);
    if (numberMatch) minutes = Number(numberMatch[0]);
  }
  return Math.max(0, Math.round(minutes));
}

function cookingTimerText(item) {
  return formatCookingDuration(elapsedCookingSeconds(item));
}

function elapsedCookingSeconds(item) {
  const started = Date.parse(item.startedAt);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((Date.now() - started) / 1000));
}

function formatCookingDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function renderFolders() {
  const query = recipeSearchQuery();
  activeRecipeTag = "";
  elements.folderList.innerHTML = "";
  elements.folderList.hidden = true;
  elements.recipeList.hidden = false;
  const visibleRecipes = activeRecipes()
    .filter((recipe) => recipeMatchesSearch(recipe, query))
    .sort((a, b) => a.name.localeCompare(b.name));
  elements.recipeList.innerHTML = recipeTileGridTemplate(visibleRecipes);
  bindRecipeCards(elements.recipeList);
  renderRecipeFolderOptions();
}

function recipeBoxTags() {
  const tagMap = new Map();
  [...recipeTags(), ...activeRecipes().flatMap((recipe) => normalizeRecipeTagSelection(recipe.tags))]
    .map((tag) => tag.trim())
    .filter(Boolean)
    .forEach((tag) => {
      const key = normalize(tag);
      if (!tagMap.has(key)) tagMap.set(key, tag);
    });
  return [...tagMap.values()].sort((a, b) => a.localeCompare(b));
}

function recipeTagFilterTemplate(tags) {
  const allActive = activeRecipeTag ? "" : "active";
  return `
    <button class="folder-btn recipe-tag-filter ${allActive}" type="button" data-recipe-tag-filter="" aria-pressed="${activeRecipeTag ? "false" : "true"}">
      <span><strong>All</strong><small>${activeRecipes().length}</small></span>
    </button>
    ${tags.map((tag) => {
      const count = activeRecipes().filter((recipe) => recipeHasTag(recipe, tag)).length;
      const isActive = normalize(activeRecipeTag) === normalize(tag);
      return `
        <button class="folder-btn recipe-tag-filter ${isActive ? "active" : ""}" type="button" data-recipe-tag-filter="${escapeHtml(tag)}" aria-pressed="${isActive ? "true" : "false"}">
          <span><strong>${escapeHtml(tag)}</strong><small>${count}</small></span>
        </button>
      `;
    }).join("")}
  `;
}

function bindRecipeTagFilters() {
  elements.folderList.querySelectorAll("[data-recipe-tag-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const tag = button.dataset.recipeTagFilter || "";
      activeRecipeTag = normalize(activeRecipeTag) === normalize(tag) ? "" : tag;
      renderFolders();
    });
  });
}

function recipeTagGroupsTemplate(query) {
  const visibleRecipes = activeRecipes()
    .filter((recipe) => recipeMatchesSearch(recipe, query))
    .filter((recipe) => !activeRecipeTag || recipeHasTag(recipe, activeRecipeTag))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!visibleRecipes.length) return "";
  if (query || activeRecipeTag) return recipeTileGridTemplate(visibleRecipes);

  const tags = recipeBoxTags();
  const grouped = tags
    .map((tag) => ({
      tag,
      recipes: visibleRecipes.filter((recipe) => recipeHasTag(recipe, tag))
    }))
    .filter((group) => group.recipes.length);
  const taggedRecipeIds = new Set(grouped.flatMap((group) => group.recipes.map((recipe) => recipe.id)));
  const untagged = visibleRecipes.filter((recipe) => !taggedRecipeIds.has(recipe.id));
  return [
    ...grouped.map((group) => recipeTagGroupTemplate(group.tag, group.recipes)),
    untagged.length ? recipeTagGroupTemplate("Untagged", untagged) : ""
  ].join("");
}

function recipeTagGroupTemplate(tag, recipes) {
  return `
    <section class="recipe-tag-group">
      <h3>${escapeHtml(tag)}</h3>
      ${recipeTileGridTemplate(recipes)}
    </section>
  `;
}

function recipeTileGridTemplate(recipes) {
  return `<div class="folder-recipes recipe-tile-grid">${recipes.map(recipeCardTemplate).join("")}</div>`;
}

function recipeHasTag(recipe, tag) {
  return normalizeRecipeTagSelection(recipe.tags).some((recipeTag) => normalize(recipeTag) === normalize(tag));
}

function bindRecipeCards(root) {
  root.querySelectorAll(".recipe-card").forEach((card) => {
    card.addEventListener("click", () => {
      if (getPendingMealRecipeSelection()) {
        chooseRecipeForPendingMeal(card.dataset.id);
        return;
      }
      if (getPendingAutoRuleRecipeSelection()) {
        chooseRecipeForPendingAutoRule(card.dataset.id);
        return;
      }
      openRecipeView(card.dataset.id);
    });
    card.addEventListener("contextmenu", (event) => openRecipeMenu(event, card.dataset.id));
    card.addEventListener("mousedown", (event) => {
      if (event.button === 2) openRecipeMenu(event, card.dataset.id);
    });
  });
  // Recipe → folder move — shared sortable primitive (move mode); delegates to the
  // existing moveRecipeToFolder. Folder buttons are the drop zones. Bound once.
  if (root.nodeType === 1 && !root.__sortableBound) {
    root.__sortableBound = true;
    makeSortable(root, {
      rowSelector: ".recipe-card",
      getId: (card) => card.dataset.id,
      reorder: false,
      dropZoneSelector: ".folder-btn[data-folder]",
      onDropZone: ({ itemId, zone }) => moveRecipeToFolder(itemId, zone.dataset.folder),
      itemLabel: (card) => (card.textContent || "recipe").trim().slice(0, 40),
    });
  }
}

function recipesByFolder() {
  const query = recipeSearchQuery();
  return activeRecipes().reduce((groups, recipe) => {
    if (query && !recipeMatchesSearch(recipe, query) && !folderMatchesSearch(recipe.folderId || "unfiled", query)) return groups;
    const folderId = recipe.folderId || "unfiled";
    if (!groups[folderId]) groups[folderId] = [];
    groups[folderId].push(recipe);
    groups[folderId].sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }, {});
}

function recipeSearchQuery() {
  return elements.recipeSearch.value.trim().toLowerCase();
}

function renderRecipeFolderOptions() {
  elements.recipeFolder.innerHTML = `<option value="">No folder</option>`;
}

function folderTreeTemplates(folders, folderCounts, recipeGroups, query = "") {
  return folders
    .filter((folder) => !folder.parentId)
    .flatMap((folder) => folderTreeTemplate(folder, folders, folderCounts, recipeGroups, 0, query));
}

function folderTreeTemplate(folder, folders, folderCounts, recipeGroups, depth, query = "") {
  if (query && !folderHasSearchResult(folder, folders, recipeGroups, query)) return [];
  const children = (query || shouldShowChildFolders(folder.id))
    ? folders
      .filter((child) => child.parentId === folder.id)
      .flatMap((child) => folderTreeTemplate(child, folders, folderCounts, recipeGroups, depth + 1, query))
    : [];
  const recipes = recipeGroups[folder.id] || [];
  const showRecipes = query ? recipes.length > 0 : activeFolder === folder.id;
  return [
    folderButtonTemplate(folder.id, folder.name, folderCounts[folder.id] || 0, recipes, depth, false),
    ...children,
    showRecipes ? folderRecipeListTemplate(recipes) : ""
  ];
}

function folderHasSearchResult(folder, folders, recipeGroups, query) {
  if (!query) return true;
  if (folderMatchesSearch(folder.id, query)) return true;
  if ((recipeGroups[folder.id] || []).length) return true;
  return folders
    .filter((child) => child.parentId === folder.id)
    .some((child) => folderHasSearchResult(child, folders, recipeGroups, query));
}

function folderMatchesSearch(folderId, query) {
  if (!query) return true;
  if (folderId === "unfiled") return "unfiled".includes(query);
  const folder = normalizedFolders().find((item) => item.id === folderId);
  return normalize(folder?.name || "").includes(normalize(query));
}

function shouldShowChildFolders(folderId) {
  return activeFolder === folderId
    || isAncestorFolder(folderId, activeFolder)
    || dragOpenFolderId === folderId
    || isAncestorFolder(folderId, dragOpenFolderId);
}

function nextActiveFolder(folderId) {
  if (activeFolder !== folderId) return folderId;
  if (folderId === "unfiled") return "";
  return normalizedFolders().find((folder) => folder.id === folderId)?.parentId || "";
}

function folderTreeList(folders, parentId = "", depth = 0) {
  return folders
    .filter((folder) => (folder.parentId || "") === parentId)
    .flatMap((folder) => [
      { folder, depth },
      ...folderTreeList(folders, folder.id, depth + 1)
    ]);
}

function folderButtonTemplate(id, name, count, recipes = [], depth = 0, includeRecipes = true) {
  const isActive = activeFolder === id;
  const folder = id === "unfiled" ? null : normalizedFolders().find((item) => item.id === id);
  if (editingFolderId === id) {
    return `
      <div class="folder-rename-row" style="--folder-depth: ${depth}">
        <input data-folder-rename="${escapeHtml(id)}" value="${escapeHtml(name)}" aria-label="Rename folder ${escapeHtml(name)}" />
        <strong>${count}</strong>
      </div>
    `;
  }
  return `
    <div class="folder-row" style="--folder-depth: ${depth}" data-folder-row="${escapeHtml(id)}">
      <button class="folder-btn ${isActive ? "active" : ""}" data-folder="${escapeHtml(id)}" ${id === "unfiled" ? "" : "data-folder-drag draggable=\"true\""} aria-pressed="${isActive}">
        <span>${escapeHtml(name)}</span>
        <strong>${count}</strong>
      </button>
    </div>
    ${includeRecipes && isActive ? folderRecipeListTemplate(recipes) : ""}
  `;
}

function folderRecipeListTemplate(recipes) {
  if (!recipes.length) return "";
  return `<div class="folder-recipes">${recipes.map(recipeCardTemplate).join("")}</div>`;
}

function startFolderRename(folderId) {
  if (folderId === "unfiled") return;
  closeFolderMenu();
  editingFolderId = folderId;
  renderFolders();
}

function openFolderMenu(event, folderId) {
  if (folderId === "unfiled") return;
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();
  folderMenuId = folderId;

  const folder = normalizedFolders().find((item) => item.id === folderId);
  if (!folder) return;

  const menu = document.createElement("div");
  menu.className = "folder-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-rename-folder="${escapeHtml(folderId)}">
      Rename folder
    </button>
    ${folder.parentId ? `
      <button type="button" role="menuitem" data-move-folder-top="${escapeHtml(folderId)}">
        Move to top level
      </button>
    ` : ""}
    <button type="button" role="menuitem" data-delete-folder="${escapeHtml(folderId)}">
      Delete folder
    </button>
  `;

  document.body.append(menu);
  const sourceRect = event.currentTarget?.getBoundingClientRect?.();
  const rawX = event.clientX || sourceRect?.right || 10;
  const rawY = event.clientY || sourceRect?.bottom || 10;
  const x = Math.min(rawX, window.innerWidth - menu.offsetWidth - 10);
  const y = Math.min(rawY, window.innerHeight - menu.offsetHeight - 10);
  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${Math.max(10, y)}px`;

  menu.querySelector("[data-rename-folder]").addEventListener("click", (clickEvent) => {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
    startFolderRename(folder.id);
  });
  menu.querySelector("[data-move-folder-top]")?.addEventListener("click", (clickEvent) => {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
    moveFolderToParent(folder.id, "");
  });
  menu.querySelector("[data-delete-folder]").addEventListener("click", (clickEvent) => {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
    void deleteFolder(folder.id, folder.name);
  });
}

function openRecipeMenu(event, recipeId) {
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();

  const recipe = activeRecipes().find((item) => item.id === recipeId);
  if (!recipe) return;

  const menu = document.createElement("div");
  menu.className = "folder-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-rename-recipe="${escapeHtml(recipeId)}">
      Rename recipe
    </button>
    <button type="button" role="menuitem" data-delete-recipe="${escapeHtml(recipeId)}">
      Delete recipe
    </button>
  `;

  document.body.append(menu);
  const sourceRect = event.currentTarget?.getBoundingClientRect?.();
  const rawX = event.clientX || sourceRect?.right || 10;
  const rawY = event.clientY || sourceRect?.bottom || 10;
  const x = Math.min(rawX, window.innerWidth - menu.offsetWidth - 10);
  const y = Math.min(rawY, window.innerHeight - menu.offsetHeight - 10);
  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${Math.max(10, y)}px`;

  menu.querySelector("[data-rename-recipe]").addEventListener("click", (clickEvent) => {
    clickEvent.stopPropagation();
    renameRecipeFromMenu(recipe.id);
  });
  menu.querySelector("[data-delete-recipe]").addEventListener("click", (clickEvent) => {
    clickEvent.stopPropagation();
    deleteRecipeById(recipe.id);
  });
}

function closeFolderMenu() {
  document.querySelectorAll(".folder-context-menu").forEach((menu) => menu.remove());
  folderMenuId = "";
}

function renderTagLibrary() {
  const tags = recipeTags();
  elements.tagList.innerHTML = tags
    .map((tag) => `
      <span class="tag-library-item">
        ${escapeHtml(tag)}
        <button type="button" data-remove-tag="${escapeHtml(tag)}" aria-label="Remove ${escapeHtml(tag)}">×</button>
      </span>
    `)
    .join("");

  elements.tagList.querySelectorAll("[data-remove-tag]").forEach((button) => {
    button.addEventListener("click", () => removeRecipeTag(button.dataset.removeTag));
  });
}

function addRecipeTag(event) {
  event.preventDefault();
  const tag = elements.tagInput.value.trim();
  if (!tag) return;
  state.recipeTags = normalizeRecipeTags([...recipeTags(), tag]);
  elements.tagInput.value = "";
  persist();
  renderTagLibrary();
  renderRecipeTagChoices(collectRecipeTags());
}

function removeRecipeTag(tag) {
  state.recipeTags = recipeTags().filter((item) => normalize(item) !== normalize(tag));
  activeRecipes().forEach((recipe) => {
    recipe.tags = normalizeRecipeTagSelection(recipe.tags).filter((item) => normalize(item) !== normalize(tag));
    saveRecipeRow(recipe);
  });
  persist();
  renderTagLibrary();
  renderRecipeTagChoices(collectRecipeTags());
  renderRecipes();
}

function renderTrash() {
  const items = trashedRecipes();
  if (!items.length) {
    elements.trashList.innerHTML = `<div class="empty-state">Trash is empty.</div>`;
    return;
  }

  elements.trashList.innerHTML = items.map(trashItemTemplate).join("");
  elements.trashList.querySelectorAll("[data-restore-trash]").forEach((button) => {
    button.addEventListener("click", () => restoreTrashedRecipe(button.dataset.restoreTrash));
  });
  elements.trashList.querySelectorAll("[data-delete-trash]").forEach((button) => {
    button.addEventListener("click", () => permanentlyDeleteTrashedRecipe(button.dataset.deleteTrash));
  });
}

function restoreTrashedRecipe(trashId) {
  const item = trashedRecipes().find((entry) => entry.id === trashId);
  if (!item) return;
  const recipe = item.recipe;
  const originalId = recipe.id;
  recipe.id = activeRecipes().some((existing) => existing.id === recipe.id) ? createId("recipe") : recipe.id;
  unrecordDeletion("recipes", originalId); // allow restored recipe to survive merges
  recordDeletion("trashedRecipes", trashId);
  activeRecipes().push(recipe);
  state.trashedRecipes = trashedRecipes().filter((entry) => entry.id !== trashId);
  persist();
  saveRecipeRow(recipe);
  render();
  renderTrash();
}

async function permanentlyDeleteTrashedRecipe(trashId) {
  const item = trashedRecipes().find((entry) => entry.id === trashId);
  if (!item || !window.confirm(`Permanently delete "${item.recipe.name || "this recipe"}"?`)) return;
  if (!(await tryPreChangeBackup("permanently deleting a trashed recipe"))) return;
  recordDeletion("trashedRecipes", trashId);
  state.trashedRecipes = trashedRecipes().filter((entry) => entry.id !== trashId);
  persist();
  renderTrash();
}

async function deleteFolder(folderId, folderName) {
  closeFolderMenu();
  const recipeCount = activeRecipes().filter((recipe) => recipe.folderId === folderId).length;
  const message = recipeCount
    ? `Delete "${folderName}" and move ${recipeCount} recipe${recipeCount === 1 ? "" : "s"} to Unfiled?`
    : `Delete "${folderName}"?`;
  if (!window.confirm(message)) return;
  if (!(await tryPreChangeBackup("deleting a folder"))) return;

  recordDeletion("folders", folderId);
  state.folders = normalizedFolders().filter((folder) => folder.id !== folderId);
  state.folders.forEach((folder) => {
    if (folder.parentId === folderId) folder.parentId = "";
  });
  activeRecipes().forEach((recipe) => {
    if (recipe.folderId === folderId) recipe.folderId = "";
  });
  if (activeFolder === folderId) activeFolder = "";
  if (editingFolderId === folderId) editingFolderId = "";
  persist();
  deleteFolderRow(folderId);
  render();
}

function saveFolderRename(input) {
  const folderId = input.dataset.folderRename;
  const folder = normalizedFolders().find((item) => item.id === folderId);
  if (!folder) {
    editingFolderId = "";
    renderFolders();
    return;
  }

  const nextName = input.value.trim();
  const duplicate = normalizedFolders().some((item) => item.id !== folderId && normalize(item.name) === normalize(nextName));
  if (nextName && !duplicate) {
    folder.name = nextName;
    state.folders.sort(compareFolders);
    persist();
    saveFolderRow(folder);
  }

  editingFolderId = "";
  renderFolders();
  renderRecipes();
}

function handleFolderDragStart(event) {
  draggedFolderId = event.currentTarget.dataset.folder;
  event.currentTarget.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedFolderId);
}

function clearFolderDragState() {
  draggedFolderId = "";
  elements.folderList.querySelectorAll(".is-dragging, .folder-drop-target").forEach((element) => {
    element.classList.remove("is-dragging", "folder-drop-target");
  });
}

function renderRecipes() {
  renderFolders();
}

function recipeMatchesSearch(recipe, query) {
  if (!query) return true;
  const ingredients = normalizeIngredients(recipe.ingredients).map(ingredientToText).join(" ");
  const haystack = [recipe.name, recipe.prepTime, recipe.cookTime, recipe.time, recipe.sourceUrl, normalizeRecipeTagSelection(recipe.tags).join(" "), ingredients].join(" ").toLowerCase();
  return haystack.includes(query);
}

function recipeCardTemplate(recipe) {
  const tags = normalizeRecipeTagSelection(recipe.tags);
  return `
    <button class="recipe-card" data-id="${recipe.id}">
      <span class="recipe-card-head">
        <h3>${escapeHtml(recipe.name)}</h3>
        ${recipeTimePillsTemplate(recipe, "Anytime")}
      </span>
      ${tags.length ? `<span class="recipe-card-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</span>` : ""}
    </button>
  `;
}

function handleRecipeDragStart(event) {
  draggedRecipeId = event.currentTarget.dataset.id;
  window.clearTimeout(folderDragOpenTimer);
  folderDragOpenTarget = "";
  dragOpenFolderId = "";
  event.currentTarget.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedRecipeId);
}

function handleFolderDragOver(event, folderButton) {
  if (!draggedRecipeId && !canDropFolderOnFolder(draggedFolderId, folderButton.dataset.folder)) return;
  event.preventDefault();
  folderButton.classList.add("folder-drop-target");
  event.dataTransfer.dropEffect = "move";
  scheduleFolderDragOpen(folderButton.dataset.folder);
}

function handleFolderDrop(event, folderButton) {
  event.preventDefault();
  if (draggedFolderId) {
    moveFolderToParent(draggedFolderId, folderButton.dataset.folder === "unfiled" ? "" : folderButton.dataset.folder);
    clearFolderDragState();
    return;
  }

  const recipeId = draggedRecipeId || event.dataTransfer.getData("text/plain");
  moveRecipeToFolder(recipeId, folderButton.dataset.folder);
  clearRecipeDragState();
}

function clearRecipeDragState() {
  window.clearTimeout(folderDragOpenTimer);
  folderDragOpenTimer = null;
  folderDragOpenTarget = "";
  dragOpenFolderId = "";
  draggedRecipeId = "";
  elements.folderList.querySelectorAll(".is-dragging, .folder-drop-target").forEach((element) => {
    element.classList.remove("is-dragging", "folder-drop-target");
  });
}

function scheduleFolderDragOpen(folderId) {
  if (!draggedRecipeId || !folderId || folderId === "unfiled" || shouldShowChildFolders(folderId)) return;
  if (folderDragOpenTarget === folderId && folderDragOpenTimer) return;
  window.clearTimeout(folderDragOpenTimer);
  folderDragOpenTarget = folderId;
  folderDragOpenTimer = window.setTimeout(() => {
    if (!draggedRecipeId) return;
    dragOpenFolderId = folderId;
    folderDragOpenTimer = null;
    folderDragOpenTarget = "";
    renderFolders();
  }, 550);
}

function moveRecipeToFolder(recipeId, folderId) {
  const recipe = activeRecipes().find((item) => item.id === recipeId);
  if (!recipe) return;
  const nextFolderId = folderId === "unfiled" ? "" : folderId;
  if ((recipe.folderId || "") === nextFolderId) return;
  recipe.folderId = nextFolderId;
  persist();
  saveRecipeRow(recipe);
  renderFolders();
  renderPlanner();
  renderGroceries();
}

function moveFolderToParent(folderId, parentId) {
  const folder = normalizedFolders().find((item) => item.id === folderId);
  if (!folder || !canDropFolderOnFolder(folderId, parentId || "unfiled")) return;
  folder.parentId = parentId || "";
  activeFolder = parentId || folder.id;
  persist();
  saveFolderRow(folder);
  renderFolders();
}

function canDropFolderOnFolder(folderId, targetFolderId) {
  if (!folderId) return false;
  if (targetFolderId === "unfiled") return true;
  if (folderId === targetFolderId) return false;
  return !isDescendantFolder(targetFolderId, folderId);
}

function isDescendantFolder(folderId, ancestorId) {
  const folder = normalizedFolders().find((item) => item.id === folderId);
  if (!folder?.parentId) return false;
  if (folder.parentId === ancestorId) return true;
  return isDescendantFolder(folder.parentId, ancestorId);
}

function isAncestorFolder(folderId, descendantId) {
  if (!folderId || !descendantId) return false;
  const folder = normalizedFolders().find((item) => item.id === descendantId);
  if (!folder?.parentId) return false;
  if (folder.parentId === folderId) return true;
  return isAncestorFolder(folderId, folder.parentId);
}

function openRecipeDialog(id) {
  const recipe = activeRecipes().find((item) => item.id === id);
  populateRecipeForm(recipe || null);
  elements.recipeDialog.showModal();
}

function recipeViewScroller() {
  return elements.recipeViewDialog.querySelector(".recipe-form");
}

function rememberActiveRecipeScroll() {
  if (!currentActiveRecipeViewId) return;
  const scroller = recipeViewScroller();
  if (scroller) activeRecipeScrollPositions.set(currentActiveRecipeViewId, scroller.scrollTop);
}

function restoreActiveRecipeScroll(cookingId) {
  const scroller = recipeViewScroller();
  if (!scroller) return;
  const scrollTop = activeRecipeScrollPositions.get(cookingId) || 0;
  requestAnimationFrame(() => {
    scroller.scrollTop = scrollTop;
  });
}

function openRecipeView(id, mealContext = null) {
  const recipe = recipeForSlot(id);
  if (!recipe) return;
  rememberActiveRecipeScroll();
  currentActiveRecipeViewId = "";
  recipeViewMealContext = mealContext;
  const baseServings = recipeDefaultServings(recipe);
  const mealEntry = mealContext ? mealEntryValue(mealContext.day, mealContext.meal, mealContext.index) : null;
  const currentServings = recipe.virtualGroceryRecipe
    ? Number(recipe.groceryMealServings || 1) || 1
    : mealEntry ? plannedServingsForEntry(mealEntry, recipe) : baseServings;
  elements.recipeViewTitle.textContent = recipe.name;
  elements.recipeViewDialog.querySelector(".muted-label").textContent = recipe.virtualGroceryRecipe ? "Ingredient" : "Recipe";
  elements.recipeViewHeaderActions.innerHTML = `
    <label class="header-serving-editor">
      <span>Servings</span>
      <input type="number" min="0.25" step="0.25" value="${currentServings}" data-serving-adjuster data-base-servings="${baseServings}" />
    </label>
    ${recipe.virtualGroceryRecipe ? "" : `<button class="primary-btn header-cook-btn" type="button" data-start-cooking="${escapeHtml(recipe.id)}">Let's cook!</button>`}
  `;
  setActiveRecipeSideNavigation("");
  elements.recipeViewContent.innerHTML = recipeViewTemplate(recipe, currentServings / baseServings);
  elements.recipeViewContent.ontouchstart = null;
  elements.recipeViewContent.ontouchend = null;
  bindRecipeViewServingControls(recipe, mealContext);
  elements.recipeViewContent.querySelector("[data-edit-recipe-view]")?.addEventListener("click", () => {
    elements.recipeViewDialog.close();
    openRecipeDialog(recipe.id);
  });
  elements.recipeViewContent.querySelector("[data-estimate-nutrition]")?.addEventListener("click", () => {
    openNutritionEstimateDialog(recipe.id);
  });
  elements.recipeViewContent.querySelector("[data-open-recipe-daily-dozen]")?.addEventListener("click", () => {
    elements.recipeViewDialog.close();
    openDailyDozenPage(recipe.id);
  });
  elements.recipeViewContent.querySelectorAll("[data-use-log-photo]").forEach((button) => {
    button.addEventListener("click", () => useCookLogPhotoAsRecipePhoto(recipe.id, button.dataset.useLogPhoto));
  });
  elements.recipeViewHeaderActions.querySelector("[data-start-cooking]")?.addEventListener("click", () => {
    const input = elements.recipeViewHeaderActions.querySelector("[data-serving-adjuster]");
    const cookingId = startCookingRecipe(recipe.id, input?.value);
    elements.recipeViewDialog.close();
    if (cookingId) openActiveRecipeView(cookingId);
  });
  if (!elements.recipeViewDialog.open) elements.recipeViewDialog.showModal();
  keepScreenOn("recipe"); // keep the screen awake while a recipe is open for cooking
  requestAnimationFrame(() => {
    const scroller = recipeViewScroller();
    if (scroller) scroller.scrollTop = 0;
  });
  elements.closeRecipeViewBtn.focus();
}

function openActiveRecipeView(cookingId) {
  const cookingItem = normalizeActiveCooking(state.activeCooking).find((item) => item.id === cookingId);
  if (!cookingItem) return;
  const recipe = activeRecipes().find((item) => item.id === cookingItem.recipeId);
  if (!recipe) return;
  rememberActiveRecipeScroll();
  elements.recipeViewTitle.textContent = recipe.name;
  elements.recipeViewDialog.querySelector(".muted-label").textContent = "Active Recipe";
  elements.recipeViewHeaderActions.innerHTML = "";
  setActiveRecipeSideNavigation(cookingItem.id);
  elements.recipeViewContent.innerHTML = activeRecipeViewTemplate(recipe, cookingItem);
  bindActiveRecipeViewControls(cookingItem.id);
  bindActiveRecipeSwipe(cookingItem.id);
  if (!elements.recipeViewDialog.open) elements.recipeViewDialog.showModal();
  keepScreenOn("recipe"); // active cooking view — keep the screen awake
  currentActiveRecipeViewId = cookingItem.id;
  restoreActiveRecipeScroll(cookingItem.id);
}

function setActiveRecipeSideNavigation(cookingId) {
  const items = normalizeActiveCooking(state.activeCooking);
  const showNavigation = cookingId && items.length > 1;
  elements.recipeViewDialog.classList.toggle("has-active-recipe-nav", Boolean(showNavigation));
  elements.activeRecipePrevBtn.hidden = !showNavigation;
  elements.activeRecipeNextBtn.hidden = !showNavigation;
  elements.activeRecipePrevBtn.onclick = showNavigation ? () => navigateActiveRecipe(cookingId, -1) : null;
  elements.activeRecipeNextBtn.onclick = showNavigation ? () => navigateActiveRecipe(cookingId, 1) : null;
}

function bindActiveRecipeSwipe(cookingId) {
  let startX = 0;
  let startY = 0;
  elements.recipeViewContent.ontouchstart = (event) => {
    if (event.touches.length !== 1) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
  };
  elements.recipeViewContent.ontouchend = (event) => {
    if (!startX || !event.changedTouches.length) return;
    const deltaX = event.changedTouches[0].clientX - startX;
    const deltaY = event.changedTouches[0].clientY - startY;
    startX = 0;
    startY = 0;
    if (Math.abs(deltaX) < 54 || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) return;
    navigateActiveRecipe(cookingId, deltaX < 0 ? 1 : -1);
  };
}

function navigateActiveRecipe(cookingId, direction) {
  const items = normalizeActiveCooking(state.activeCooking);
  if (items.length < 2) return;
  const index = items.findIndex((item) => item.id === cookingId);
  if (index < 0) return;
  const nextIndex = (index + direction + items.length) % items.length;
  openActiveRecipeView(items[nextIndex].id);
}

function recipeViewTemplate(recipe, requestedIngredientScale = 1) {
  const ingredients = normalizeIngredients(recipe.ingredients);
  const tags = normalizeRecipeTagSelection(recipe.tags);
  const steps = normalizeInstructionSteps(recipe.steps);
  const nutrition = normalizeNutritionFacts(recipe.nutrition);
  const nutritionEstimate = normalizeNutritionEstimate(recipe.nutritionEstimate);
  const cookLog = normalizeCookLog(recipe.cookLog);
  const dailyDozenSuggestions = recipe.virtualGroceryRecipe ? [] : dailyDozenRecipeSuggestions(recipe);
  const baseServings = Number(recipe.servings || 1) || 1;
  const ingredientScale = recipe.virtualGroceryRecipe
    ? (Number(recipe.groceryMealServings || 1) || 1) / baseServings
    : requestedIngredientScale;
  return `
    ${recipe.photoUrl ? `<img class="recipe-view-photo" src="${escapeHtml(recipePhotoProxyUrl(recipe.photoUrl))}" alt="${escapeHtml(recipe.name)}" />` : ""}
    <div class="recipe-view-meta">
      ${recipeTimePillsTemplate(recipe, "Flexible")}
      ${tags.map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("")}
    </div>
    <section class="recipe-view-section">
      <h3>Ingredients</h3>
      ${ingredients.length ? `<ul data-scaled-ingredients>${scaledIngredientListTemplate(ingredients, ingredientScale)}</ul>` : `<p class="empty-state">No ingredients added yet.</p>`}
    </section>
    ${recipe.virtualGroceryRecipe ? "" : `
      <section class="recipe-view-section recipe-daily-dozen">
        <div class="recipe-view-section-heading">
          <h3>Daily Dozen</h3>
          <button class="secondary-btn compact-btn" type="button" data-open-recipe-daily-dozen="${escapeHtml(recipe.id)}">Review</button>
        </div>
        <p>${dailyDozenSuggestions.length
    ? `This recipe may contribute ${escapeHtml(dailyDozenSuggestions.map((suggestion) => dailyDozenCategoryName(suggestion.categoryId)).join(", "))}. Confirm servings in the tracker.`
    : "No Daily Dozen categories are currently tagged for this recipe's ingredients."}</p>
        <small>Inspired by Dr. Greger's Daily Dozen / NutritionFacts.org. Estimates vary; no servings are counted automatically.</small>
      </section>
    `}
    <section class="recipe-view-section">
      <h3>Instructions</h3>
      ${steps.length ? `<ol class="recipe-steps-view">${steps.map((step) => `<li>${linkTimerMentions(escapeHtml(step))}</li>`).join("")}</ol>` : `<p class="empty-state">No instructions added yet.</p>`}
    </section>
    <section class="recipe-view-section">
      <div class="recipe-view-section-heading">
        <h3>Nutrition Facts</h3>
        ${recipe.nutritionEstimate?.stale ? `<span class="nutrition-stale-badge">Recalculating…</span>` : ""}
      </div>
      ${nutrition.length ? `<dl class="nutrition-facts-view">${nutrition.map((fact) => `
        <div>
          <dt>${escapeHtml(fact.nutrient)}</dt>
          <dd>${escapeHtml(fact.amount)}</dd>
        </div>
      `).join("")}</dl>` : `<p class="empty-state">No nutrition facts added yet.</p>`}
      ${nutritionEstimate ? `
        <p class="nutrition-estimate-caption">
          Estimated per serving from ingredient data; actual values vary.${nutritionEstimate.stale ? " Ingredients or servings changed; recalculate this estimate." : ""}
          ${nutritionEstimate.lastCalculatedAt ? ` Updated ${escapeHtml(new Date(nutritionEstimate.lastCalculatedAt).toLocaleDateString())}.` : ""}
        </p>
      ` : ""}
    </section>
    <section class="recipe-view-section">
      <h3>Log & Notes</h3>
      ${cookLogTemplate(cookLog)}
    </section>
    <div class="recipe-view-actions recipe-view-footer-actions">
      ${recipe.virtualGroceryRecipe ? "" : `<button class="recipe-edit-link" type="button" data-edit-recipe-view="${escapeHtml(recipe.id)}">Edit recipe</button>`}
      ${/^https?:\/\//i.test(recipe.sourceUrl) ? `<a class="recipe-source-link" href="${escapeHtml(recipe.sourceUrl)}" target="_blank" rel="noreferrer">Source recipe</a>` : ""}
    </div>
  `;
}

function activeRecipeViewTemplate(recipe, cookingItem) {
  const ingredients = normalizeIngredients(recipe.ingredients);
  const tags = normalizeRecipeTagSelection(recipe.tags);
  const steps = normalizeInstructionSteps(recipe.steps);
  const nutrition = normalizeNutritionFacts(recipe.nutrition);
  const cookLog = normalizeCookLog(recipe.cookLog);
  const baseServings = Number(recipe.servings || 1) || 1;
  const servings = Math.max(1, Number(cookingItem.servings) || baseServings);
  const scale = servings / baseServings;
  const completedSteps = Array.isArray(cookingItem.completedSteps) ? cookingItem.completedSteps : [];
  const checkedIngredients = Array.isArray(cookingItem.checkedIngredients) ? cookingItem.checkedIngredients : [];
  return `
    ${recipe.photoUrl ? `<img class="recipe-view-photo" src="${escapeHtml(recipePhotoProxyUrl(recipe.photoUrl))}" alt="${escapeHtml(recipe.name)}" />` : ""}
    <div class="recipe-view-meta">
      ${recipeTimePillsTemplate(recipe, "Flexible")}
      <span class="serving-adjuster serving-static"><span>Servings</span><strong>${escapeHtml(String(servings))}</strong></span>
      ${tags.map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("")}
    </div>
    ${recipe.sourceUrl ? `<a class="recipe-source-link" href="${escapeHtml(recipe.sourceUrl)}" target="_blank" rel="noreferrer">Source recipe</a>` : ""}
    ${activeRecipeSectionTemplate("ingredients", "Ingredients", cookingItem.collapsedSections?.ingredients, ingredients.length ? activeIngredientChecklistTemplate(ingredients, scale, checkedIngredients) : `<p class="empty-state">No ingredients added yet.</p>`)}
    ${activeRecipeSectionTemplate("instructions", "Instructions", cookingItem.collapsedSections?.instructions, steps.length ? `<ol class="active-recipe-steps">${steps.map((step, index) => `
      <li>
        <button class="active-cooking-step ${completedSteps[index] ? "is-complete" : ""}" type="button" data-active-step="${index}" aria-pressed="${completedSteps[index] ? "true" : "false"}">
          <span class="active-cooking-step-label">Step ${index + 1}</span>
          <span class="active-cooking-step-text">${escapeHtml(step)}</span>
        </button>
        ${stepTimerButtons(step)}
      </li>
    `).join("")}</ol>` : `<p class="empty-state">No instructions added yet.</p>`)}
    <section class="recipe-view-section active-cooking-notes">
      <h3>Log & Notes</h3>
      <label>
        <span>Notes from this cook</span>
        <textarea data-active-cooking-notes placeholder="What changed, what worked, what to remember next time">${escapeHtml(cookingItem.notes || "")}</textarea>
      </label>
      <button class="primary-btn compact-btn" type="button" data-finish-active-cooking="${escapeHtml(cookingItem.id)}">Done cooking</button>
      ${cookLog.length ? cookLogTemplate(cookLog) : ""}
    </section>
  `;
}

function activeIngredientChecklistTemplate(ingredients, scale, checkedIngredients) {
  return `
    <ul class="active-ingredient-list">
      ${ingredients
        .map((ingredient) => scaledIngredientToText(ingredient, scale))
        .filter(Boolean)
        .map((ingredient, index) => `
          <li>
            <label class="active-ingredient-check ${checkedIngredients[index] ? "is-checked" : ""}">
              <input type="checkbox" data-active-ingredient="${index}" ${checkedIngredients[index] ? "checked" : ""} />
              <span>${escapeHtml(ingredient)}</span>
            </label>
          </li>
        `).join("")}
    </ul>
  `;
}

function cookLogTemplate(cookLog) {
  const entries = normalizeCookLog(cookLog);
  if (!entries.length) return `<p class="empty-state">No cooking notes yet.</p>`;
  return `
    <ol class="cook-log-list">
      ${entries.map((entry) => `
        <li>
          <div class="cook-log-date">
            <strong>${escapeHtml(formatCookLogDate(entry.cookedAt))}</strong>
            <span>${escapeHtml([formatServingsLabel(entry.servings), entry.durationSeconds ? formatCookingDuration(entry.durationSeconds) : ""].filter(Boolean).join(" · "))}</span>
          </div>
          ${entry.photoUrl ? cookLogPhotoTemplate(entry.photoUrl) : ""}
          ${entry.notes ? `<p>${escapeHtml(entry.notes)}</p>` : `<p class="muted-note">No notes added.</p>`}
        </li>
      `).join("")}
    </ol>
  `;
}

function cookLogPhotoTemplate(photoUrl) {
  return `
    <div class="cook-log-photo-wrap">
      <img class="cook-log-photo" src="${escapeHtml(recipePhotoProxyUrl(photoUrl))}" alt="Cooked dish" />
      <button class="secondary-btn compact-btn" type="button" data-use-log-photo="${escapeHtml(photoUrl)}">Use as recipe photo</button>
    </div>
  `;
}

function useCookLogPhotoAsRecipePhoto(recipeId, photoUrl, activeCookingId = "") {
  if (!recipeId || !photoUrl) return;
  const recipeIndex = activeRecipes().findIndex((recipe) => recipe.id === recipeId);
  if (recipeIndex < 0) return;
  const recipe = normalizeRecipe({ ...activeRecipes()[recipeIndex], photoUrl });
  activeRecipes()[recipeIndex] = recipe;
  persist();
  saveRecipeRow(recipe);
  renderRecipes();
  renderActiveCooking();
  if (activeCookingId) openActiveRecipeView(activeCookingId);
  else openRecipeView(recipeId);
}

function formatCookLogDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Unknown date";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function activeRecipeSectionTemplate(sectionId, title, isCollapsed, content) {
  return `
    <section class="recipe-view-section active-recipe-section ${isCollapsed ? "is-collapsed" : ""}" data-active-section="${sectionId}">
      <div class="active-recipe-section-head">
        <h3>${escapeHtml(title)}</h3>
        <button class="icon-btn active-recipe-toggle" type="button" data-toggle-active-section="${sectionId}" title="${isCollapsed ? "Expand" : "Collapse"} ${escapeHtml(title)}" aria-label="${isCollapsed ? "Expand" : "Collapse"} ${escapeHtml(title)}" aria-expanded="${isCollapsed ? "false" : "true"}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
      <div class="active-recipe-section-body">
        ${content}
      </div>
    </section>
  `;
}

function bindActiveRecipeViewControls(cookingId) {
  const cookingItem = normalizeActiveCooking(state.activeCooking).find((item) => item.id === cookingId);
  const recipeId = cookingItem?.recipeId || "";
  elements.recipeViewContent.querySelectorAll("[data-use-log-photo]").forEach((button) => {
    button.addEventListener("click", () => useCookLogPhotoAsRecipePhoto(recipeId, button.dataset.useLogPhoto, cookingId));
  });
  elements.recipeViewContent.querySelector("[data-active-cooking-notes]")?.addEventListener("input", (event) => {
    updateActiveCookingItem(cookingId, (item) => {
      item.notes = event.target.value;
    });
  });
  elements.recipeViewContent.querySelector("[data-finish-active-cooking]")?.addEventListener("click", () => {
    requestFinishCooking(cookingId);
  });
  elements.recipeViewContent.querySelectorAll("[data-active-ingredient]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      checkbox.closest(".active-ingredient-check")?.classList.toggle("is-checked", checkbox.checked);
      updateActiveCookingItem(cookingId, (item) => {
        const index = Number(checkbox.dataset.activeIngredient);
        item.checkedIngredients[index] = checkbox.checked;
      });
    });
  });
  elements.recipeViewContent.querySelectorAll("[data-active-step]").forEach((button) => {
    button.addEventListener("click", () => {
      updateActiveCookingItem(cookingId, (item) => {
        const index = Number(button.dataset.activeStep);
        item.completedSteps[index] = !item.completedSteps[index];
      });
      openActiveRecipeView(cookingId);
    });
  });
  elements.recipeViewContent.querySelectorAll("[data-toggle-active-section]").forEach((button) => {
    button.addEventListener("click", () => {
      const sectionId = button.dataset.toggleActiveSection;
      updateActiveCookingItem(cookingId, (item) => {
        item.collapsedSections[sectionId] = !item.collapsedSections[sectionId];
      });
      openActiveRecipeView(cookingId);
    });
  });
}

function updateActiveCookingItem(cookingId, updater) {
  state.activeCooking = normalizeActiveCooking(state.activeCooking).map((item) => {
    if (item.id !== cookingId) return item;
    const nextItem = {
      ...item,
      completedSteps: [...item.completedSteps],
      checkedIngredients: [...item.checkedIngredients],
      collapsedSections: { ...item.collapsedSections }
    };
    updater(nextItem);
    return nextItem;
  });
  persist();
  renderActiveCooking();
}

function bindRecipeViewServingControls(recipe, mealContext = null) {
  const input = elements.recipeViewHeaderActions.querySelector("[data-serving-adjuster]");
  const ingredientList = elements.recipeViewContent.querySelector("[data-scaled-ingredients]");
  if (!input || !ingredientList) return;

  input.addEventListener("input", () => {
    const baseServings = Number(input.dataset.baseServings || 1) || 1;
    const nextServings = Math.max(0.25, Number(input.value) || baseServings);
    const scale = nextServings / baseServings;
    ingredientList.innerHTML = scaledIngredientListTemplate(normalizeIngredients(recipe.ingredients), scale);
    if (recipe.virtualGroceryRecipe) updateGroceryMealServing(recipe.groceryMealItem, nextServings, mealContext);
    else if (mealContext) updateMealPlannedServingsFromContext(nextServings, mealContext);
  });
}

function scaledIngredientListTemplate(ingredients, scale) {
  return ingredients
    .map((ingredient) => scaledIngredientToText(ingredient, scale))
    .filter(Boolean)
    .map((ingredient) => `<li>${escapeHtml(ingredient)}</li>`)
    .join("");
}

function recipeTimePillsTemplate(recipe, fallback = "Flexible") {
  const prepTime = recipe?.prepTime || "";
  const cookTime = recipe?.cookTime || "";
  if (prepTime || cookTime) {
    return [
      prepTime ? `<span class="pill gold">Prep ${escapeHtml(prepTime)}</span>` : "",
      cookTime ? `<span class="pill gold">Cook ${escapeHtml(cookTime)}</span>` : ""
    ].join("");
  }
  return `<span class="pill gold">${escapeHtml(recipe?.time || fallback)}</span>`;
}

function scaledIngredientToText(ingredient, scale) {
  const normalized = typeof ingredient === "string" ? parseIngredientLine(ingredient) : ingredient;
  const amount = scaleIngredientAmount(normalized.amount, scale);
  return [amount, normalized.quantity, normalized.item, normalized.prep].filter(Boolean).join(" ");
}

function scaleIngredientAmount(amount, scale) {
  const value = groceryAmountToNumber(amount);
  if (value === null) return amount || "";
  return formatGroceryAmount(value * scale);
}

function populateRecipeForm(recipe) {
  renderRecipeFolderOptions();
  elements.dialogTitle.textContent = recipe ? "Edit recipe" : "Add recipe";
  elements.recipeId.value = recipe?.id || "";
  elements.recipeName.value = recipe?.name || "";
  elements.recipePrepTime.value = recipe?.prepTime || recipe?.time || "";
  elements.recipeCookTime.value = recipe?.cookTime || "";
  elements.recipeServings.value = recipe?.defaultServings || recipe?.servings || "";
  elements.recipeFolder.value = "";
  renderRecipeTagChoices(recipe?.tags || []);
  elements.recipeSourceUrl.value = recipe?.sourceUrl || "";
  pendingRecipePhotoFile = null;
  elements.recipePhotoInput.value = "";
  elements.recipePhotoUrl.value = recipe?.photoUrl || "";
  updateRecipePhotoPreview(recipe?.photoUrl || "");
  renderIngredientRows(recipe ? normalizeIngredients(recipe.ingredients) : [blankIngredient()]);
  renderStepRows(recipe ? normalizeInstructionSteps(recipe.steps) : [""]);
  renderNutritionRows(recipe ? normalizeNutritionFacts(recipe.nutrition) : [blankNutritionFact()]);
  renderCookLogRows(recipe ? normalizeCookLog(recipe.cookLog) : []);
  elements.deleteRecipeBtn.hidden = !recipe;
  const aiStatus = document.getElementById("recipeAiStatus");
  if (aiStatus) { aiStatus.textContent = ""; aiStatus.hidden = true; }
}

function handleRecipePhotoSelection() {
  pendingRecipePhotoFile = elements.recipePhotoInput.files?.[0] || null;
  updateRecipePhotoPreview(elements.recipePhotoUrl.value, pendingRecipePhotoFile);
}

function removeRecipePhotoSelection() {
  pendingRecipePhotoFile = null;
  elements.recipePhotoInput.value = "";
  elements.recipePhotoUrl.value = "";
  updateRecipePhotoPreview("");
}

function updateRecipePhotoPreview(photoUrl, file = null) {
  if (!elements.recipePhotoPreview) return;
  const previewUrl = file ? URL.createObjectURL(file) : recipePhotoProxyUrl(photoUrl);
  elements.recipePhotoPreview.innerHTML = previewUrl
    ? `<img src="${escapeHtml(previewUrl)}" alt="Dish photo preview" />`
    : "No photo selected.";
}

function renderRecipeTagChoices(selectedTags = []) {
  const selected = new Set(normalizeRecipeTagSelection(selectedTags).map(normalize));
  elements.recipeTagList.innerHTML = recipeTags()
    .map((tag) => {
      const checked = selected.has(normalize(tag)) ? "checked" : "";
      return `
        <label class="tag-choice">
          <input type="checkbox" value="${escapeHtml(tag)}" ${checked} />
          <span>${escapeHtml(tag)}</span>
        </label>
      `;
    })
    .join("");
}

async function saveRecipeFromForm(event) {
  event.preventDefault();
  const id = elements.recipeId.value || createId("recipe");
  const currentRecipe = activeRecipes().find((item) => item.id === id);
  let photoUrl = elements.recipePhotoUrl.value || currentRecipe?.photoUrl || "";
  if (pendingRecipePhotoFile) {
    try {
      photoUrl = await uploadRecipePhoto(pendingRecipePhotoFile, id, "recipe");
    } catch (error) {
      updateRecipePhotoPreview(photoUrl);
      window.alert(error.message || "Photo upload failed.");
      return;
    }
  }
  const recipe = {
    id,
    name: elements.recipeName.value.trim(),
    prepTime: elements.recipePrepTime.value.trim(),
    cookTime: elements.recipeCookTime.value.trim(),
    time: combinedRecipeTime({
      prepTime: elements.recipePrepTime.value.trim(),
      cookTime: elements.recipeCookTime.value.trim()
    }),
    servings: Number(elements.recipeServings.value) || 1,
    defaultServings: Number(elements.recipeServings.value) || 1,
    folderId: "",
    sourceUrl: elements.recipeSourceUrl.value.trim(),
    photoUrl,
    createdAt: currentRecipe?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cookLog: collectCookLogRows(),
    tags: collectRecipeTags(),
    ingredients: collectIngredientRows(),
    nutrition: collectNutritionRows(),
    nutritionEstimate: currentRecipe?.nutritionEstimate || null,
    ingredientNutritionMatches: currentRecipe?.ingredientNutritionMatches || [],
    steps: collectStepRows().join("\n")
  };
  const needsNutrition = !currentRecipe
    || !currentRecipe.nutritionEstimate
    || nutritionRecipeSignature(currentRecipe) !== nutritionRecipeSignature(recipe);

  if (needsNutrition) {
    recipe.nutritionEstimate = currentRecipe?.nutritionEstimate
      ? { ...currentRecipe.nutritionEstimate, stale: true }
      : null;
  }

  const index = activeRecipes().findIndex((item) => item.id === id);
  if (index >= 0) {
    activeRecipes()[index] = recipe;
  } else {
    activeRecipes().push(recipe);
  }

  persist();
  saveRecipeRow(recipe);
  pendingRecipePhotoFile = null;
  elements.recipeDialog.close();
  render();

  if (needsNutrition && recipe.ingredients?.length) {
    autoEstimateNutrition(recipe.id);
  }
}

async function autoEstimateNutrition(recipeId) {
  const helperUrl = nutritionEstimateHelperUrl();
  if (!helperUrl || !getAuthSession()?.access_token) return;
  const recipe = activeRecipes().find((r) => r.id === recipeId);
  if (!recipe?.ingredients?.length) return;
  const ingredients = normalizeIngredients(recipe.ingredients);
  try {
    const response = await fetch(helperUrl, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${getAuthSession().access_token}` },
      body: JSON.stringify({
        ingredients,
        servings: Math.max(1, Number(recipe.servings) || 1),
        corrections: state.nutritionIngredientMappings || {}
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return;
    const fresh = activeRecipes().find((r) => r.id === recipeId);
    if (!fresh) return;
    fresh.nutritionEstimate = {
      ...payload.estimate,
      matches: normalizeIngredientNutritionMatches(payload.estimate?.matches),
      stale: false
    };
    persist();
    saveRecipeRow(fresh);
    render();
  } catch { /* silently skip — nutrition is best-effort */ }
}

function collectRecipeTags() {
  return normalizeRecipeTagSelection([...elements.recipeTagList.querySelectorAll("input:checked")].map((input) => input.value));
}

function renderCookLogRows(entries) {
  const rows = normalizeCookLog(entries);
  elements.recipeCookLogList.innerHTML = rows.length
    ? rows.map(cookLogRowTemplate).join("")
    : `<p class="empty-state">No cooking notes yet.</p>`;
  elements.recipeCookLogList.querySelectorAll("[data-remove-cook-log]").forEach((button) => {
    button.addEventListener("click", () => {
      button.closest(".cook-log-row").remove();
      if (!elements.recipeCookLogList.querySelector(".cook-log-row")) {
        elements.recipeCookLogList.innerHTML = `<p class="empty-state">No cooking notes yet.</p>`;
      }
    });
  });
  elements.recipeCookLogList.querySelectorAll("[data-use-log-photo]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.recipePhotoUrl.value = button.dataset.useLogPhoto || "";
      pendingRecipePhotoFile = null;
      elements.recipePhotoInput.value = "";
      updateRecipePhotoPreview(elements.recipePhotoUrl.value);
    });
  });
}

function addCookLogRow() {
  if (!elements.recipeCookLogList.querySelector(".cook-log-row")) elements.recipeCookLogList.innerHTML = "";
  elements.recipeCookLogList.insertAdjacentHTML("afterbegin", cookLogRowTemplate({
    id: createId("log"),
    cookedAt: new Date().toISOString(),
    notes: "",
    servings: Number(elements.recipeServings.value) || 1,
    durationSeconds: 0
  }));
  const row = elements.recipeCookLogList.querySelector(".cook-log-row");
  row.querySelector("[data-remove-cook-log]").addEventListener("click", () => {
    row.remove();
    if (!elements.recipeCookLogList.querySelector(".cook-log-row")) {
      elements.recipeCookLogList.innerHTML = `<p class="empty-state">No cooking notes yet.</p>`;
    }
  });
  row.querySelector("[data-cook-log-notes]").focus();
}

function cookLogRowTemplate(entry) {
  return `
      <div class="cook-log-row" data-cook-log-id="${escapeHtml(entry.id)}">
      <input type="hidden" data-cook-log-photo-url value="${escapeHtml(entry.photoUrl || "")}" />
      ${entry.photoUrl ? cookLogPhotoTemplate(entry.photoUrl) : ""}
      <div class="cook-log-row-grid">
        <label>
          Date
          <input type="date" data-cook-log-date value="${escapeHtml(dateInputValue(entry.cookedAt))}" />
        </label>
        <label>
          Servings
          <input type="number" min="1" step="1" data-cook-log-servings value="${escapeHtml(String(entry.servings || 1))}" />
        </label>
        <label>
          Time
          <input data-cook-log-duration value="${escapeHtml(entry.durationSeconds ? formatCookingDuration(entry.durationSeconds) : "")}" placeholder="25 min" />
        </label>
        <button class="icon-btn" type="button" data-remove-cook-log title="Remove log" aria-label="Remove log">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <label>
        Notes
        <textarea data-cook-log-notes placeholder="What worked or what to change next time">${escapeHtml(entry.notes || "")}</textarea>
      </label>
    </div>
  `;
}

function collectCookLogRows() {
  return normalizeCookLog([...elements.recipeCookLogList.querySelectorAll(".cook-log-row")]
    .map((row) => ({
      id: row.dataset.cookLogId || createId("log"),
      cookedAt: dateInputToIso(row.querySelector("[data-cook-log-date]").value),
      servings: Number(row.querySelector("[data-cook-log-servings]").value) || 1,
      durationSeconds: parseCookingDuration(row.querySelector("[data-cook-log-duration]").value),
      notes: row.querySelector("[data-cook-log-notes]").value.trim(),
      photoUrl: row.querySelector("[data-cook-log-photo-url]")?.value || ""
    })));
}

function parseCookingDuration(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return 0;
  if (text.includes(":")) {
    const parts = text.split(":").map((part) => Number(part));
    if (parts.some((part) => Number.isNaN(part))) return 0;
    if (parts.length === 3) return Math.max(0, (parts[0] * 3600) + (parts[1] * 60) + parts[2]);
    if (parts.length === 2) return Math.max(0, (parts[0] * 60) + parts[1]);
  }
  let seconds = 0;
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/);
  const secondMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/);
  if (hourMatch) seconds += Number(hourMatch[1]) * 3600;
  if (minuteMatch) seconds += Number(minuteMatch[1]) * 60;
  if (secondMatch) seconds += Number(secondMatch[1]);
  if (!seconds) {
    const numberMatch = text.match(/\d+(?:\.\d+)?/);
    if (numberMatch) seconds = Number(numberMatch[0]) * 60;
  }
  return Math.max(0, Math.round(seconds));
}

function renderStepRows(steps) {
  const rows = steps.length ? steps : [""];
  elements.stepList.innerHTML = rows.map(stepRowTemplate).join("");
  elements.stepList.querySelectorAll(".step-row").forEach(bindStepRowControls);
}

function addStepRow(step = "", afterRow = null) {
  if (afterRow) afterRow.insertAdjacentHTML("afterend", stepRowTemplate(step));
  else elements.stepList.insertAdjacentHTML("beforeend", stepRowTemplate(step));
  const row = afterRow ? afterRow.nextElementSibling : elements.stepList.querySelector(".step-row:last-child");
  bindStepRowControls(row);
  row.querySelector("[data-step-text]").focus();
}

function bindStepRowControls(row) {
  row.querySelector("[data-remove-step]").addEventListener("click", () => {
    row.remove();
    if (!elements.stepList.querySelector(".step-row")) addStepRow();
  });
  row.querySelector("[data-step-text]").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    addStepRow("", row);
  });
}

function stepRowTemplate(step) {
  return `
    <div class="step-row">
      <textarea data-step-text rows="2" placeholder="Add instruction step">${escapeHtml(step)}</textarea>
      <button class="icon-btn" type="button" data-remove-step title="Remove step" aria-label="Remove step">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  `;
}

function collectStepRows() {
  return [...elements.stepList.querySelectorAll("[data-step-text]")]
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function blankNutritionFact() {
  return { nutrient: "", amount: "" };
}

function renderNutritionRows(facts) {
  const rows = facts.length ? facts : [blankNutritionFact()];
  elements.nutritionList.innerHTML = rows.map(nutritionRowTemplate).join("");
  elements.nutritionList.querySelectorAll("[data-remove-nutrition]").forEach((button) => {
    button.addEventListener("click", () => {
      button.closest(".nutrition-row").remove();
      if (!elements.nutritionList.querySelector(".nutrition-row")) addNutritionRow();
    });
  });
}

function addNutritionRow(fact = blankNutritionFact()) {
  elements.nutritionList.insertAdjacentHTML("beforeend", nutritionRowTemplate(fact));
  const row = elements.nutritionList.querySelector(".nutrition-row:last-child");
  row.querySelector("[data-remove-nutrition]").addEventListener("click", () => {
    row.remove();
    if (!elements.nutritionList.querySelector(".nutrition-row")) addNutritionRow();
  });
  row.querySelector("[data-nutrition-nutrient]").focus();
}

function nutritionRowTemplate(fact) {
  return `
    <div class="nutrition-grid nutrition-row">
      <input data-nutrition-nutrient aria-label="Nutrient" value="${escapeHtml(fact.nutrient)}" placeholder="Calories" />
      <input data-nutrition-amount aria-label="Nutrient amount" value="${escapeHtml(fact.amount)}" placeholder="320" />
      <button class="icon-btn" type="button" data-remove-nutrition title="Remove nutrient" aria-label="Remove nutrient">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  `;
}

function collectNutritionRows() {
  return [...elements.nutritionList.querySelectorAll(".nutrition-row")]
    .map((row) => ({
      nutrient: row.querySelector("[data-nutrition-nutrient]").value.trim(),
      amount: row.querySelector("[data-nutrition-amount]").value.trim()
    }))
    .filter((fact) => fact.nutrient || fact.amount);
}

function nutritionRecipeSignature(recipe) {
  return JSON.stringify({
    servings: Math.max(1, Number(recipe?.servings) || 1),
    ingredients: normalizeIngredients(recipe?.ingredients).map((ingredient) => ({
      amount: ingredient.amount,
      quantity: ingredient.quantity,
      item: ingredient.item,
      prep: ingredient.prep
    }))
  });
}

async function openNutritionEstimateDialog(recipeId) {
  const recipe = activeRecipes().find((item) => item.id === recipeId);
  if (!recipe) return;
  const ingredients = normalizeIngredients(recipe.ingredients);
  if (!ingredients.length) {
    window.alert("Add ingredients before estimating nutrition.");
    return;
  }
  pendingNutritionRecipeId = recipe.id;
  pendingNutritionEstimate = null;
  elements.nutritionEstimateServings.value = Math.max(1, Number(recipe.servings) || 1);
  elements.nutritionMatchList.innerHTML = "";
  elements.nutritionEstimateSummary.innerHTML = "";
  elements.saveNutritionEstimateBtn.disabled = true;
  trackUsage("claude_nutrition");
  setNutritionEstimateStatus("Matching ingredients with USDA FoodData Central...");
  if (elements.recipeViewDialog.open) elements.recipeViewDialog.close();
  elements.nutritionEstimateDialog.showModal();
  try {
    const helperUrl = nutritionEstimateHelperUrl();
    if (!helperUrl) throw new Error("Nutrition estimates need the local helper or live app.");
    const response = await fetch(helperUrl, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${getAuthSession()?.access_token || ""}` },
      body: JSON.stringify({
        ingredients,
        servings: elements.nutritionEstimateServings.value,
        corrections: state.nutritionIngredientMappings || {}
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Nutrition estimate failed with status ${response.status}`);
    pendingNutritionEstimate = {
      ...payload.estimate,
      matches: normalizeIngredientNutritionMatches(payload.estimate?.matches)
    };
    recalculatePendingNutritionEstimate();
    renderNutritionMatchReview();
    elements.saveNutritionEstimateBtn.disabled = false;
    setNutritionEstimateStatus("Review every ingredient match before saving.");
  } catch (error) {
    setNutritionEstimateStatus(error.message || "Nutrition could not be estimated.");
  }
}

function nutritionEstimateHelperUrl() {
  if (canUseLocalBackend()) return "/api/estimate-nutrition";
  if (window.location.protocol.startsWith("http")) return "/.netlify/functions/estimate-nutrition";
  return "";
}

function closeNutritionEstimateDialog() {
  elements.nutritionEstimateDialog.close();
  pendingNutritionEstimate = null;
  pendingNutritionRecipeId = "";
}

function setNutritionEstimateStatus(message) {
  elements.nutritionEstimateStatus.textContent = message;
}

function renderNutritionMatchReview() {
  const matches = pendingNutritionEstimate?.matches || [];
  elements.nutritionMatchList.innerHTML = matches.map((match, index) => {
    const selectedId = String(match.fdcId || "");
    return `
      <article class="nutrition-match-row ${selectedId ? "" : "needs-review"}">
        <div class="nutrition-match-ingredient">
          <strong>${escapeHtml(match.rawLine || match.ingredientName)}</strong>
          <small>${match.grams === null ? "Gram amount unavailable" : `${formatNutritionNumber(match.grams)} g estimated`} · ${Math.round((match.confidenceScore || 0) * 100)}% confidence</small>
        </div>
        <label>
          Matched food
          <select data-nutrition-match-index="${index}">
            <option value="">No match</option>
            ${(match.candidates || []).map((candidate) => `
              <option value="${escapeHtml(candidate.fdcId)}" ${String(candidate.fdcId) === selectedId ? "selected" : ""}>
                ${escapeHtml(candidate.description)}${candidate.brandOwner ? ` — ${escapeHtml(candidate.brandOwner)}` : ""}
              </option>
            `).join("")}
          </select>
        </label>
        ${match.conversionNote ? `<p>${escapeHtml(match.conversionNote)}</p>` : ""}
      </article>
    `;
  }).join("");
}

function handleNutritionMatchChange(event) {
  const select = event.target.closest("[data-nutrition-match-index]");
  if (!select || !pendingNutritionEstimate) return;
  const index = Number(select.dataset.nutritionMatchIndex);
  const current = pendingNutritionEstimate.matches[index];
  if (!current) return;
  const candidate = current.candidates.find((item) => String(item.fdcId) === select.value);
  pendingNutritionEstimate.matches[index] = candidate
    ? { ...NutritionDomain.calculateIngredientNutrition(current, candidate), candidates: current.candidates }
    : { ...current, fdcId: "", matchedFood: "", source: "", grams: null, confidenceScore: 0, nutrients: {} };
  recalculatePendingNutritionEstimate();
  renderNutritionMatchReview();
}

function recalculatePendingNutritionEstimate() {
  if (!pendingNutritionEstimate) return;
  const servings = Math.max(1, Number(elements.nutritionEstimateServings.value) || 1);
  pendingNutritionEstimate = {
    ...pendingNutritionEstimate,
    ...NutritionDomain.sumNutrition(pendingNutritionEstimate.matches, servings),
    servings,
    confidenceScore: nutritionEstimateConfidence(pendingNutritionEstimate.matches),
    source: "USDA FoodData Central",
    lastCalculatedAt: new Date().toISOString(),
    disclaimer: "Estimated from ingredient data; actual values vary.",
    stale: false
  };
  renderNutritionEstimateSummary();
}

function nutritionEstimateConfidence(matches) {
  const scored = matches.filter((match) => match.fdcId);
  if (!matches.length || !scored.length) return 0;
  return scored.reduce((sum, match) => sum + (Number(match.confidenceScore) || 0), 0) / matches.length;
}

function renderNutritionEstimateSummary() {
  const estimate = normalizeNutritionEstimate(pendingNutritionEstimate);
  if (!estimate) {
    elements.nutritionEstimateSummary.innerHTML = "";
    return;
  }
  const facts = NutritionDomain.nutritionFactsFromEstimate(estimate);
  elements.nutritionEstimateSummary.innerHTML = `
    <div class="recipe-view-section-heading">
      <h3>Per serving estimate</h3>
      <span>${Math.round(estimate.confidenceScore * 100)}% confidence</span>
    </div>
    <dl class="nutrition-facts-view">
      ${facts.map((fact) => `
        <div>
          <dt>${escapeHtml(fact.nutrient)}</dt>
          <dd>${escapeHtml(fact.amount)}</dd>
        </div>
      `).join("")}
    </dl>
  `;
}

function saveNutritionEstimate() {
  const recipe = activeRecipes().find((item) => item.id === pendingNutritionRecipeId);
  if (!recipe || !pendingNutritionEstimate) return;
  const matches = normalizeIngredientNutritionMatches(pendingNutritionEstimate.matches);
  const estimate = normalizeNutritionEstimate(pendingNutritionEstimate);
  recipe.servings = estimate.servings;
  recipe.nutritionEstimate = estimate;
  recipe.ingredientNutritionMatches = matches.map(({ candidates, ...match }) => match);
  recipe.nutrition = NutritionDomain.nutritionFactsFromEstimate(estimate);
  recipe.updatedAt = new Date().toISOString();
  if (!state.nutritionIngredientMappings || typeof state.nutritionIngredientMappings !== "object") {
    state.nutritionIngredientMappings = {};
  }
  matches.forEach((match) => {
    const candidate = match.candidates.find((item) => String(item.fdcId) === String(match.fdcId));
    if (match.normalizedName && candidate) {
      state.nutritionIngredientMappings[match.normalizedName] = normalizeNutritionCandidate(candidate);
    }
  });
  persist();
  saveRecipeRow(recipe);
  closeNutritionEstimateDialog();
  openRecipeView(recipe.id);
}

function formatNutritionNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number >= 10 ? String(Math.round(number)) : number.toFixed(1).replace(/\.0$/, "");
}

function openImportDialog(prefilledUrl = "", shouldAutoFetch = false) {
  openRecipeBoxPage();
  elements.importUrl.value = normalizeRecipeUrlInput(prefilledUrl);
  elements.importText.value = "";
  elements.importStatus.textContent = "";
  elements.importDialog.showModal();
  if (shouldAutoFetch && elements.importUrl.value) {
    window.setTimeout(importRecipeFromUrl, 50);
  }
}

async function importRecipeFromUrl() {
  const url = normalizeRecipeUrlInput(elements.importUrl.value);
  if (!url) {
    setImportStatus("Paste a recipe or article URL first.");
    return;
  }
  elements.importUrl.value = url;

  setImportStatus("Reading the page…");
  elements.fetchRecipeBtn.disabled = true;
  try {
    // The gateway auto-detects the content type; route the result to the right home:
    // a recipe opens the recipe form, an article is saved to the reading list.
    const result = await importViaGateway(url);
    if (result?.type === "recipe" && result.data && (result.data.name || result.data.ingredients?.length)) {
      openImportedRecipe({ ...result.data, folderId: "" });
      return;
    }
    if (result?.type === "article" && result.data && (result.data.text || result.data.title)) {
      elements.importDialog.close();
      saveImportedArticle(result.data, url);
      return;
    }
    setImportStatus("No recipe or article could be read from that URL. If it is blocked, copy the recipe text and paste it below.");
  } catch {
    setImportStatus("This URL could not be read directly. If it is NYT, Bon Appetit, or Google Drive, copy the recipe text and paste it below.");
  } finally {
    elements.fetchRecipeBtn.disabled = false;
  }
}

async function importViaGateway(url) {
  trackUsage("claude_recipe_import");
  const endpoint = importGatewayUrl();
  if (!endpoint) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`);
    return { type: "recipe", status: "needs-review", data: parseRecipeHtml(await response.text(), url) };
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${getAuthSession()?.access_token || ""}` },
    body: JSON.stringify({ source: { url, sourceClient: "in-app" } })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.warnings?.[0] || `Import failed with status ${response.status}`);
  return payload;
}

function importGatewayUrl() {
  if (canUseLocalBackend()) return "/api/import";
  if (window.location.protocol.startsWith("http")) return "/.netlify/functions/import";
  return "";
}

function normalizeRecipeUrlInput(value) {
  const trimmed = String(value || "").trim();
  const firstUrl = trimmed.match(/https?:\/\/[^\s]+/i)?.[0] || "";
  if (!firstUrl) return "";
  const duplicateStart = firstUrl.slice(8).search(/https?:\/\//i);
  return duplicateStart >= 0 ? firstUrl.slice(0, duplicateStart + 8) : firstUrl;
}

function handleImportUrlParameter() {
  const params = new URLSearchParams(window.location.search);
  // Accept the app's own ?importUrl= deep-link AND the Web Share Target params
  // (?url= / ?text= / ?title=, per manifest.json share_target). Android Chrome
  // often puts the shared link in `text`, so scan each candidate for the first
  // URL. The import dialog auto-detects recipe vs article from here.
  const shared = params.get("importUrl") || params.get("url") || params.get("text") || params.get("title") || "";
  const importUrl = normalizeRecipeUrlInput(shared);
  if (!importUrl) return;

  ["importUrl", "url", "text", "title"].forEach((key) => params.delete(key));
  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", nextUrl);
  openImportDialog(importUrl, true);
}

function importRecipeFromText() {
  const text = elements.importText.value.trim();
  if (!text) {
    setImportStatus("Paste recipe text first.");
    return;
  }

  openImportedRecipe(parseRecipeText(text, elements.importUrl.value.trim()));
}

function openImportedRecipe(recipe) {
  elements.importDialog.close();
  populateRecipeForm(recipe);
  elements.recipeDialog.showModal();
}

function setImportStatus(message) {
  elements.importStatus.textContent = message;
}

function openScanDialog() {
  openRecipeBoxPage();
  clearScanRecipeFiles();
  elements.scanDialog.showModal();
}

function replaceScanRecipeFiles() {
  scanRecipeFiles = [...elements.scanImages.files || []].slice(0, 6);
  scanRecipeImageEdits = retainScanImageEdits(scanRecipeFiles, scanRecipeImageEdits);
  updateScanSelectionStatus();
}

function appendCameraScanRecipeFile() {
  const files = [...elements.scanCameraImage.files || []];
  if (files.length) scanRecipeFiles = [...scanRecipeFiles, ...files].slice(0, 6);
  scanRecipeImageEdits = retainScanImageEdits(scanRecipeFiles, scanRecipeImageEdits);
  elements.scanCameraImage.value = "";
  updateScanSelectionStatus();
}

function clearScanRecipeFiles() {
  scanRecipeFiles = [];
  scanRecipeImageEdits = new Map();
  elements.scanImages.value = "";
  elements.scanCameraImage.value = "";
  renderScanRecipeImagePreviews();
  setScanStatus("Upload one or more clear photos, then review the extracted recipe before saving.");
}

function updateScanSelectionStatus() {
  renderScanRecipeImagePreviews();
  if (!scanRecipeFiles.length) {
    setScanStatus("Upload one or more clear photos, then review the extracted recipe before saving.");
    return;
  }
  const pageText = scanRecipeFiles.length === 1 ? "photo" : "photos";
  setScanStatus(`${scanRecipeFiles.length} ${pageText} selected.`);
}

async function scanRecipeFromImages() {
  const files = [...scanRecipeFiles];
  if (!files.length) {
    setScanStatus("Choose at least one cookbook photo first.");
    return;
  }
  if (files.length > 6) {
    setScanStatus("Use up to 6 photos for one recipe scan.");
    return;
  }

  setScanStatus("Reading cookbook photo...");
  elements.scanImagesBtn.disabled = true;
  try {
    const images = await Promise.all(files.map(async (file) => (
      fileToDataUrl(await prepareScanImage(file, scanRecipeImageEdits.get(file), {
        maxDimension: 1600,
        quality: 0.82
      }))
    )));
    trackUsage("claude_recipe_scan");
    const helperUrl = recipeScanHelperUrl();
    if (!helperUrl) throw new Error("Recipe scanning needs the local helper or the live app.");
    const response = await fetch(helperUrl, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${getAuthSession()?.access_token || ""}` },
      body: JSON.stringify({ images })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Scan failed with status ${response.status}`);
    const recipe = normalizeRecipe({
      ...payload.recipe,
      folderId: ""
    });
    if (!recipe.name && !normalizeIngredients(recipe.ingredients).length) throw new Error("No recipe could be read from those images.");
    elements.scanDialog.close();
    populateRecipeForm(recipe);
    elements.recipeDialog.showModal();
  } catch (error) {
    setScanStatus(error.message || "The recipe scan failed.");
  } finally {
    elements.scanImagesBtn.disabled = false;
  }
}

function recipeScanHelperUrl() {
  if (canUseLocalBackend()) return "/api/scan-recipe";
  if (window.location.protocol.startsWith("http")) return "/.netlify/functions/scan-recipe";
  return "";
}

function renderScanRecipeImagePreviews() {
  renderScanImagePreviews(scanRecipeFiles, scanRecipeImageEdits, elements.scanImagePreviewList, "cookbook");
}

function handleScanRecipePreviewAction(event) {
  const button = event.target.closest("[data-scan-image-action]");
  if (!button) return;
  const index = Number(button.dataset.scanImageIndex);
  if (!Number.isInteger(index) || !scanRecipeFiles[index]) return;
  const result = applyScanImageAction(
    scanRecipeFiles,
    scanRecipeImageEdits,
    index,
    button.dataset.scanImageAction
  );
  scanRecipeFiles = result.files;
  scanRecipeImageEdits = result.edits;
  elements.scanImages.value = "";
  updateScanSelectionStatus();
}

async function uploadRecipePhoto(file, recipeId, kind = "recipe") {
  if (!file) return "";
  if (!getSupabaseClient() || !getAuthSession()?.access_token) {
    throw new Error("Sign in before uploading recipe photos.");
  }
  const imageBlob = await resizeRecipePhoto(file);
  const userId = getAuthSession().user?.id || "personal";
  const safeRecipeId = String(recipeId || createId("recipe")).replace(/[^a-z0-9-]/gi, "-");
  const path = `${userId}/${safeRecipeId}/${kind}-${Date.now()}.jpg`;
  const { error } = await getSupabaseClient().storage
    .from(recipePhotoBucket)
    .upload(path, imageBlob, {
      contentType: imageBlob.type,
      cacheControl: "31536000",
      upsert: false
    });
  if (error) throw new Error(`${error.message}. Run supabase-photo-storage.sql if the photo bucket is not set up yet.`);
  return path;
}

async function resizeRecipePhoto(file) {
  const image = await imageElementFromFile(file);
  const maxWidth = 1200;
  const scale = Math.min(1, maxWidth / image.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(image.src);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Could not prepare photo for upload."));
      else resolve(blob);
    }, "image/jpeg", 0.82);
  });
}

function setScanStatus(message) {
  elements.scanStatus.textContent = message;
}

function parseRecipeHtml(html, sourceUrl) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const jsonRecipes = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .flatMap((script) => parseJsonLd(script.textContent))
    .map(findRecipeNode)
    .filter(Boolean);
  const recipe = jsonRecipes[0];
  if (!recipe) {
    return parseRecipeText(document.body?.innerText || "", sourceUrl);
  }

  return {
    name: textValue(recipe.name) || document.querySelector("h1")?.textContent?.trim() || "",
    prepTime: textValue(recipe.prepTime),
    cookTime: textValue(recipe.cookTime),
    time: readableDuration(textValue(recipe.totalTime || recipe.cookTime || recipe.prepTime)),
    servings: parseServings(recipe.recipeYield),
    folderId: "",
    sourceUrl,
    ingredients: arrayValue(recipe.recipeIngredient).map((line) => parseIngredientLine(String(line))),
    steps: instructionsToText(recipe.recipeInstructions)
  };
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
  if (Array.isArray(node["@graph"])) {
    return node["@graph"].map(findRecipeNode).find(Boolean) || null;
  }
  return null;
}

function parseRecipeText(text, sourceUrl = "") {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const name = lines[0] || "";
  const ingredientsStart = lines.findIndex((line) => /^ingredients:?$/i.test(line));
  const instructionsStart = lines.findIndex((line) => /^(instructions|directions|preparation|method):?$/i.test(line));
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

function arrayValue(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  return value ? String(value) : "";
}

// ISO-8601 duration (PT1H30M) → "1 hr 30 min"; passes non-ISO strings through.
// Ported from server.js (the only prior copy): parseRecipeText runs client-side too
// (recipe import), where `readableDuration` was undefined → this threw in production.
function readableDuration(value) {
  if (!/^P(T|\d)/i.test(value)) return value;
  const hours = Number(value.match(/(\d+)H/i)?.[1] || 0);
  const minutes = Number(value.match(/(\d+)M/i)?.[1] || 0);
  return [hours ? `${hours} hr` : "", minutes ? `${minutes} min` : ""].filter(Boolean).join(" ");
}

function parseServings(value) {
  const text = textValue(value);
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : 1;
}

function looksLikeIngredient(line) {
  return /^(\d|pinch|⅛|¼|⅓|½|⅔|¾)/i.test(line) || /\b(cup|cups|tablespoon|tablespoons|tbsp|teaspoon|teaspoons|tsp|ounce|ounces|oz|pound|pounds|lb|can|clove|slice)\b/i.test(line);
}

function blankIngredient() {
  return { amount: "", quantity: "", item: "", prep: "" };
}

function renderIngredientRows(ingredients) {
  renderIngredientSuggestions();
  const rows = ingredients.length ? ingredients : [blankIngredient()];
  elements.ingredientList.innerHTML = rows.map(ingredientRowTemplate).join("");
  elements.ingredientList.querySelectorAll(".ingredient-row").forEach(bindIngredientRowControls);
}

function addIngredientRow(ingredient = blankIngredient(), afterRow = null) {
  renderIngredientSuggestions();
  if (afterRow) afterRow.insertAdjacentHTML("afterend", ingredientRowTemplate(ingredient));
  else elements.ingredientList.insertAdjacentHTML("beforeend", ingredientRowTemplate(ingredient));
  const row = afterRow ? afterRow.nextElementSibling : elements.ingredientList.querySelector(".ingredient-row:last-child");
  bindIngredientRowControls(row);
  row.querySelector("[data-ingredient-item]").focus();
}

function bindIngredientRowControls(row) {
  row.querySelector("[data-remove-ingredient]").addEventListener("click", () => {
    row.remove();
    if (!elements.ingredientList.querySelector(".ingredient-row")) addIngredientRow();
  });
  row.querySelectorAll("select, input").forEach((field) => {
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      addIngredientRow(blankIngredient(), row);
    });
  });
}

function ingredientRowTemplate(ingredient) {
  return `
    <div class="ingredient-grid ingredient-row">
      <select data-ingredient-amount aria-label="Ingredient number">
        ${optionList(getAmountOptions(), ingredient.amount)}
      </select>
      <select data-ingredient-quantity aria-label="Ingredient quantity">
        ${optionList(getQuantityOptions(), ingredient.quantity)}
      </select>
      <input data-ingredient-item list="ingredientSuggestions" aria-label="Ingredient item" value="${escapeHtml(ingredient.item)}" placeholder="yellow onions" required />
      <select data-ingredient-prep aria-label="Ingredient prep">
        ${optionList(getPrepOptions(), ingredient.prep)}
      </select>
      <button class="icon-btn" type="button" data-remove-ingredient title="Remove ingredient" aria-label="Remove ingredient">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  `;
}

function renderIngredientSuggestions() {
  const itemOptions = normalizeIngredientOptions(state.ingredientOptions).items;
  elements.ingredientSuggestions.innerHTML = [...new Set([...itemOptions, ...grocerySuggestionItems()])]
    .sort((a, b) => normalize(a).localeCompare(normalize(b)))
    .map((item) => `<option value="${escapeHtml(item)}"></option>`)
    .join("");
}

function optionList(options, selectedValue) {
  return options.map((option) => {
    const selected = option === selectedValue ? "selected" : "";
    const label = option || "-";
    return `<option value="${escapeHtml(option)}" ${selected}>${escapeHtml(label)}</option>`;
  }).join("");
}

function collectIngredientRows() {
  return [...elements.ingredientList.querySelectorAll(".ingredient-row")]
    .map((row) => ({
      amount: row.querySelector("[data-ingredient-amount]").value,
      quantity: row.querySelector("[data-ingredient-quantity]").value,
      item: row.querySelector("[data-ingredient-item]").value.trim(),
      prep: row.querySelector("[data-ingredient-prep]").value
    }))
    .filter((ingredient) => ingredient.item);
}

function normalizeIngredients(ingredients) {
  if (!Array.isArray(ingredients)) return [];
  return ingredients
    .map((ingredient) => {
      if (typeof ingredient === "string") return parseIngredientLine(ingredient);
      return {
        amount: ingredient.amount || "",
        quantity: ingredient.quantity || ingredient.unit || "",
        item: ingredient.item || "",
        prep: ingredient.prep || "",
        rawLine: ingredient.rawLine || ingredientToText(ingredient),
        optional: Boolean(ingredient.optional) || /\boptional\b/i.test(`${ingredient.item || ""} ${ingredient.prep || ""}`),
        required: ingredient.required !== false && !Boolean(ingredient.optional)
      };
    })
    .filter((ingredient) => ingredient.item || ingredient.amount || ingredient.quantity || ingredient.prep);
}

function parseIngredientLine(line) {
  let normalizedLine = line.trim()
    .replace(/^[-*•]\s*/, "")
    .replace(/⅛/g, "1/8").replace(/¼/g, "1/4").replace(/⅓/g, "1/3")
    .replace(/½/g, "1/2").replace(/⅔/g, "2/3").replace(/¾/g, "3/4");

  // Strip inline packaging parentheticals like "(14 oz)" or "(15-oz)" that appear
  // after an amount but before a unit — e.g. "1 (14 oz) can tomatoes"
  normalizedLine = normalizedLine.replace(/^(\d[\d\s/]*)\s*\([\d.\s–\-]+\s*oz\)/i, "$1");

  // Extract trailing prep in parentheses — "(beaten)", "(room temperature)", etc.
  const prepMatch = normalizedLine.match(/\(([^)]+)\)$/);
  const prepText = prepMatch ? prepMatch[1].toLowerCase().trim() : "";
  const lineWithoutTrailingPrep = prepMatch ? normalizedLine.slice(0, prepMatch.index).trim() : normalizedLine;
  const parts = lineWithoutTrailingPrep.split(/\s+/);

  const amount = takeIngredientAmount(parts, getAmountOptions());
  let quantity = "";
  const rawUnit = parts[0] || "";
  const unit = rawUnit.toLowerCase();
  const unitMap = {
    c: "C", cup: "C", cups: "C",
    tablespoon: "Tbsp", tablespoons: "Tbsp", tbsp: "Tbsp",
    teaspoon: "tsp", teaspoons: "tsp", tsp: "tsp",
    pound: "lb", pounds: "lb", lb: "lb",
    ounce: "oz", ounces: "oz", oz: "oz",
    cans: "can", can: "can", cloves: "clove", clove: "clove",
    slices: "slice", slice: "slice", bunch: "bunch", bunches: "bunch",
    package: "package", packages: "package", pkg: "package",
    g: "g", gram: "g", grams: "g", kg: "kg",
    ml: "ml", l: "L", liter: "L", liters: "L",
    qt: "qt", quart: "qt", pt: "pt", pint: "pt",
    stick: "stick", sticks: "stick", sprig: "sprig", sprigs: "sprig",
    head: "head", heads: "head", stalk: "stalk", stalks: "stalk",
  };
  const mappedUnit = rawUnit === "T" ? "Tbsp" : rawUnit === "t" ? "tsp" : unitMap[unit];
  if (mappedUnit) { quantity = mappedUnit; parts.shift(); }

  // Check for trailing prep word at end of item (e.g. "garlic cloves minced")
  const trailingPrep = getPrepOptions().includes(parts.at(-1)?.toLowerCase()) ? parts.pop().toLowerCase() : "";

  // Prefer explicit end-of-line prep in parens; fall back to trailing word
  const prep = getPrepOptions().includes(prepText) ? prepText : trailingPrep;
  const itemParts = parts.join(" ");
  const leftoverPrep = prepText && !prep ? `(${prepText})` : "";
  const item = [itemParts, leftoverPrep].filter(Boolean).join(" ");

  const optional = /\boptional\b/i.test(`${normalizedLine} ${prepText}`);
  return { amount, quantity, item, prep, rawLine: normalizedLine, optional, required: !optional };
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

function ingredientToText(ingredient) {
  const normalized = typeof ingredient === "string" ? parseIngredientLine(ingredient) : ingredient;
  return [normalized.amount, normalized.quantity, normalized.item, normalized.prep].filter(Boolean).join(" ");
}

function addRecipeFolder(event) {
  event?.preventDefault();
  const name = elements.folderInput.value.trim();
  if (!name) return;

  const existing = normalizedFolders().find((folder) => normalize(folder.name) === normalize(name));
  if (existing) {
    activeFolder = existing.id;
  } else {
    const folder = { id: createId("folder"), name };
    state.folders.push(folder);
    state.folders.sort(compareFolders);
    saveFolderRow(folder);
    activeFolder = folder.id;
  }

  elements.folderInput.value = "";
  openRecipeBoxPage();
  renderFolders();
  renderRecipes();
}

async function deleteRecipeFromForm() {
  const id = elements.recipeId.value;
  const deleted = await deleteRecipeById(id);
  if (deleted) elements.recipeDialog.close();
}

async function deleteRecipeById(id) {
  const recipe = activeRecipes().find((item) => item.id === id);
  if (!recipe) return false;
  closeFolderMenu();
  if (!(await tryPreChangeBackup("deleting a recipe"))) return false;
  recordDeletion("recipes", id);
  state.recipes = activeRecipes().filter((item) => item.id !== id);
  trashedRecipes().unshift({
    id: createId("trash"),
    deletedAt: new Date().toISOString(),
    recipe
  });
  Object.values(state.plans).forEach((week) => {
    removeRecipeFromMealSlots(week.slots, id);
    removeRecipeFromMealSlots(week.publishedSlots, id);
  });
  persist();
  deleteRecipeRow(id);
  render();
  return true;
}

function renameRecipeFromMenu(id) {
  const recipe = activeRecipes().find((item) => item.id === id);
  if (!recipe) return;
  closeFolderMenu();
  const nextName = window.prompt("Rename recipe", recipe.name || "");
  if (nextName === null) return;
  const trimmedName = nextName.trim();
  if (!trimmedName || trimmedName === recipe.name) return;
  recipe.name = trimmedName;
  persist();
  saveRecipeRow(recipe);
  render();
}

function initAiRecipeToolbar() {
  document.getElementById("recipeDialog")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-ai-recipe-mode]");
    if (btn) { e.preventDefault(); runAiRecipeCleanup(btn.dataset.aiRecipeMode); }
  });
  document.getElementById("closeAiRecipeReviewBtn")?.addEventListener("click", closeAiRecipeReview);
  document.getElementById("cancelAiRecipeReviewBtn")?.addEventListener("click", closeAiRecipeReview);
  document.getElementById("applyAiRecipeReviewBtn")?.addEventListener("click", applyAiRecipeReview);
}

async function runAiRecipeCleanup(mode) {
  const statusEl = document.getElementById("recipeAiStatus");
  const setStatus = (msg, hidden = false) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.hidden = hidden;
  };
  setStatus("Analysing recipe with AI…");

  const ingredients = collectIngredientRows().map((i) =>
    [i.amount, i.quantity, i.item, i.prep].filter(Boolean).join(" ")
  );
  const steps = collectStepRows();
  const recipe = {
    name: elements.recipeName?.value?.trim() || "",
    ingredients,
    steps
  };
  const existingTags = recipeTags();
  const ingredientItems = (state.ingredientOptions?.items || []).filter(Boolean);

  const url = (() => {
    if (canUseLocalBackend()) return "/api/clean-recipe";
    if (window.location.protocol.startsWith("http")) return "/.netlify/functions/clean-recipe";
    return "";
  })();
  if (!url) { setStatus("AI recipe cleanup requires the live app."); return; }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${getAuthSession()?.access_token || ""}` },
      body: JSON.stringify({ recipe, mode, existingTags, ingredientItems })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);
    pendingAiRecipeResult = payload.result;
    setStatus("", true);
    openAiRecipeReview(mode, payload.result);
    trackUsage("claude_recipe_import");
  } catch (err) {
    setStatus(err.message || "AI request failed.");
  }
}

function openAiRecipeReview(mode, result) {
  const body = document.getElementById("aiReviewBody");
  if (!body) return;

  const sections = [];

  if (result.structure) {
    const { ingredients, steps } = result.structure;
    const ingredientRows = ingredients.map((i, idx) => `
      <label class="ai-review-row">
        <input type="checkbox" class="ai-review-check" data-review-type="ingredient" data-review-index="${idx}" checked />
        <span class="ai-review-main">${escapeHtml([i.amount, i.quantity, i.item].filter(Boolean).join(" "))}${i.prep ? ` <em>(${escapeHtml(i.prep)})</em>` : ""}</span>
      </label>`).join("");
    const stepRows = steps.map((s, idx) => `
      <label class="ai-review-row">
        <input type="checkbox" class="ai-review-check" data-review-type="step" data-review-index="${idx}" checked />
        <span class="ai-review-main">${escapeHtml(s)}</span>
      </label>`).join("");
    sections.push(`
      <section class="ai-review-section">
        <h3>Ingredients <span class="ai-review-count">${ingredients.length}</span></h3>
        <div class="ai-review-rows">${ingredientRows || "<p class='muted-label'>No ingredients returned.</p>"}</div>
      </section>
      <section class="ai-review-section">
        <h3>Steps <span class="ai-review-count">${steps.length}</span></h3>
        <div class="ai-review-rows">${stepRows || "<p class='muted-label'>No steps returned.</p>"}</div>
      </section>`);
  }

  if (result.tags) {
    const { existing, new: newTags } = result.tags;
    const allTagRows = [
      ...existing.map((t, idx) => `
        <label class="ai-review-row">
          <input type="checkbox" class="ai-review-check" data-review-type="tag-existing" data-review-index="${idx}" checked />
          <span class="ai-review-main">${escapeHtml(t)}</span>
        </label>`),
      ...newTags.map((t, idx) => `
        <label class="ai-review-row">
          <input type="checkbox" class="ai-review-check" data-review-type="tag-new" data-review-index="${idx}" checked />
          <span class="ai-review-main">${escapeHtml(t)}</span>
          <span class="ai-review-badge">New tag</span>
        </label>`)
    ].join("");
    sections.push(`
      <section class="ai-review-section">
        <h3>Tags</h3>
        <div class="ai-review-rows">${allTagRows || "<p class='muted-label'>No tags suggested.</p>"}</div>
      </section>`);
  }

  if (result.newIngredientItems?.length) {
    sections.push(`
      <section class="ai-review-section ai-review-section--notice">
        <h3>New ingredients</h3>
        <p class="muted-label" style="margin-bottom:8px">These items weren't in your ingredient library. After saving, visit your grocery daily dozen tags to assign any daily dozen categories.</p>
        <ul class="ai-review-new-items">${result.newIngredientItems.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
      </section>`);
  }

  body.innerHTML = sections.join("") || "<p class='muted-label' style='padding:16px'>No suggestions returned.</p>";

  const dialog = document.getElementById("aiRecipeReviewDialog");
  if (dialog && !dialog.open) dialog.showModal();
}

function closeAiRecipeReview() {
  document.getElementById("aiRecipeReviewDialog")?.close();
  pendingAiRecipeResult = null;
}

function applyAiRecipeReview() {
  const result = pendingAiRecipeResult;
  if (!result) return;

  const checked = (type) => [...document.querySelectorAll(
    `#aiReviewBody .ai-review-check[data-review-type="${type}"]:checked`
  )].map((el) => parseInt(el.dataset.reviewIndex, 10));

  if (result.structure) {
    const { ingredients, steps } = result.structure;
    const selectedIngredients = checked("ingredient").map((i) => ingredients[i]).filter(Boolean);
    if (selectedIngredients.length) renderIngredientRows(selectedIngredients);
    const selectedSteps = checked("step").map((i) => steps[i]).filter(Boolean);
    if (selectedSteps.length) renderStepRows(selectedSteps);
  }

  if (result.tags) {
    const { existing, new: newTags } = result.tags;
    const selectedExisting = checked("tag-existing").map((i) => existing[i]).filter(Boolean);
    const selectedNew = checked("tag-new").map((i) => newTags[i]).filter(Boolean);
    const allSelected = [...selectedExisting, ...selectedNew];
    if (allSelected.length) {
      // Add any new tags to the global tag library
      selectedNew.forEach((tag) => {
        if (!state.recipeTags.includes(tag)) state.recipeTags.push(tag);
      });
      state.recipeTags = normalizeRecipeTags(state.recipeTags);
      // Re-render tag choices with all new tags selected
      const currentChecked = new Set(
        [...elements.recipeTagList.querySelectorAll("input:checked")].map((el) => el.value.toLowerCase())
      );
      allSelected.forEach((t) => currentChecked.add(t.toLowerCase()));
      renderRecipeTagChoices([...currentChecked]);
    }
  }

  closeAiRecipeReview();
}

function parseTimerSeconds(n1str, n2str, unitStr) {
  const n1 = parseFloat(n1str);
  const n2 = n2str ? parseFloat(n2str) : null;
  const avg = n2 != null ? (n1 + n2) / 2 : n1;
  const u = unitStr.trim().toLowerCase();
  if (u.startsWith("h")) return Math.round(avg * 3600);
  if (u.startsWith("s")) return Math.round(avg);
  return Math.round(avg * 60);
}

function linkTimerMentions(escapedHtml) {
  return escapedHtml.replace(TIMER_RE, (match, prefix, n1, _range, n2, unit) => {
    const secs = parseTimerSeconds(n1, n2, unit);
    if (secs <= 0) return match;
    const p = prefix || "";
    const label = match.slice(p.length);
    return `${p}<button type="button" class="timer-chip" data-timer-seconds="${secs}">${label}</button>`;
  });
}

function stepTimerButtons(rawStep) {
  const timers = [];
  const re = new RegExp(TIMER_RE.source, "gi");
  let m;
  while ((m = re.exec(rawStep)) !== null) {
    const secs = parseTimerSeconds(m[2], m[4], m[5]);
    if (secs > 0) timers.push({ label: m[0].trim(), secs });
  }
  if (!timers.length) return "";
  return `<div class="step-timer-row">${timers.map((t) =>
    `<button type="button" class="timer-chip" data-timer-seconds="${t.secs}">
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>
      ${escapeHtml(t.label)}
    </button>`
  ).join("")}</div>`;
}

function startRecipeTimer(totalSecs) {
  if (recipeTimer?.intervalId) clearInterval(recipeTimer.intervalId);
  recipeTimer = { totalSecs, remainingSecs: totalSecs, paused: false, intervalId: null };
  const widget = document.getElementById("recipeTimerWidget");
  if (widget) widget.hidden = false;
  updateRecipeTimerWidget();
  recipeTimer.intervalId = setInterval(tickRecipeTimer, 1000);
}

function tickRecipeTimer() {
  if (!recipeTimer || recipeTimer.paused) return;
  recipeTimer.remainingSecs = Math.max(0, recipeTimer.remainingSecs - 1);
  updateRecipeTimerWidget();
  if (recipeTimer.remainingSecs <= 0) {
    clearInterval(recipeTimer.intervalId);
    recipeTimer.intervalId = null;
    fireTimerDone();
  }
}

function updateRecipeTimerWidget() {
  if (!recipeTimer) return;
  const { totalSecs, remainingSecs, paused } = recipeTimer;
  const m = Math.floor(remainingSecs / 60);
  const s = remainingSecs % 60;
  const isDone = remainingSecs <= 0 && !recipeTimer.intervalId;

  const countdown = document.getElementById("timerCountdown");
  if (countdown) countdown.textContent = isDone ? "Done!" : `${m}:${String(s).padStart(2, "0")}`;

  const circ = 2 * Math.PI * 42;
  const progress = totalSecs > 0 ? remainingSecs / totalSecs : 0;
  const ring = document.getElementById("timerRingProgress");
  if (ring) {
    ring.style.strokeDasharray = `${circ}`;
    ring.style.strokeDashoffset = `${circ * (1 - progress)}`;
  }

  const pauseBtn = document.getElementById("timerPauseBtn");
  if (pauseBtn) {
    pauseBtn.textContent = isDone ? "" : (paused ? "Resume" : "Pause");
    pauseBtn.hidden = isDone;
  }

  const widget = document.getElementById("recipeTimerWidget");
  if (widget) widget.classList.toggle("timer-done", isDone);
}

function fireTimerDone() {
  updateRecipeTimerWidget();
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.3, 0.6].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.4);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.4);
    });
  } catch {}
}

function closeRecipeTimer() {
  if (recipeTimer?.intervalId) clearInterval(recipeTimer.intervalId);
  recipeTimer = null;
  const widget = document.getElementById("recipeTimerWidget");
  if (widget) { widget.hidden = true; widget.classList.remove("timer-done"); }
}

function initRecipeTimer() {
  document.getElementById("timerPauseBtn")?.addEventListener("click", () => {
    if (!recipeTimer) return;
    recipeTimer.paused = !recipeTimer.paused;
    if (!recipeTimer.paused && recipeTimer.remainingSecs > 0 && !recipeTimer.intervalId) {
      recipeTimer.intervalId = setInterval(tickRecipeTimer, 1000);
    }
    updateRecipeTimerWidget();
  });
  document.getElementById("timerCancelBtn")?.addEventListener("click", closeRecipeTimer);

  document.addEventListener("click", (e) => {
    const chip = e.target.closest(".timer-chip");
    if (!chip) return;
    const secs = parseInt(chip.dataset.timerSeconds, 10);
    if (secs > 0) startRecipeTimer(secs);
  });
}

  // Recipe-view dialog close handler (moved out of bindEvents so currentActiveRecipeViewId
  // and recipeViewMealContext stay private to this module). bindEvents wires this by name.
  function onRecipeViewDialogClose() {
    allowScreenOff("recipe"); // let the screen sleep again once the recipe closes
    rememberActiveRecipeScroll();
    currentActiveRecipeViewId = "";
    if (recipeViewMealContext) {
      const adjuster = elements.recipeViewHeaderActions.querySelector("[data-serving-adjuster]");
      if (adjuster) {
        const baseServings = Number(adjuster.dataset.baseServings || 1) || 1;
        const servings = Math.max(0.25, Number(adjuster.value) || baseServings);
        updateMealPlannedServingsFromContext(servings, recipeViewMealContext);
      }
      recipeViewMealContext = null;
    }
  }

  return {
    activeRecipes,
    addCookLogRow,
    addIngredientRow,
    addNutritionRow,
    addRecipeFolder,
    addRecipeTag,
    addStepRow,
    appendCameraScanRecipeFile,
    autoEstimateNutrition,
    clearRecipeSearch,
    clearScanRecipeFiles,
    closeCookSessionNotesDialog,
    closeFolderMenu,
    closeNutritionEstimateDialog,
    closeRecipeBoxPage,
    completeCookingWithLog,
    completeCookingWithoutLog,
    deleteRecipeFromForm,
    folderName,
    handleCookSessionPhotoSelection,
    handleImportUrlParameter,
    handleNutritionMatchChange,
    handleRecipePhotoSelection,
    handleScanRecipePreviewAction,
    hydrateRecipeRowsFromSupabase,
    importRecipeFromText,
    importRecipeFromUrl,
    importViaGateway,
    initAiRecipeToolbar,
    initRecipeTimer,
    isDescendantFolder,
    migrateLegacyRecipeOrganization,
    normalizeIngredients,
    normalizeRecipeUrlInput,
    normalizedFolders,
    onRecipeViewDialogClose,
    openCookSessionNotesDialog,
    openImportDialog,
    openImportedRecipe,
    openRecipeBoxPage,
    openRecipeDialog,
    openRecipeView,
    openScanDialog,
    parseIngredientLine,
    recalculatePendingNutritionEstimate,
    recipeDefaultServings,
    recipeTags,
    rememberActiveRecipeScroll,
    removeRecipePhotoSelection,
    renderActiveCooking,
    renderFolders,
    renderIngredientSuggestions,
    renderRecipes,
    renderTagLibrary,
    renderTrash,
    replaceScanRecipeFiles,
    saveFolderRow,
    saveNutritionEstimate,
    saveRecipeFromForm,
    saveRecipeRow,
    scaleIngredientAmount,
    scaledIngredientToText,
    scanRecipeFromImages,
    trashedRecipes,
    updateRecipeSearchClearButton,
  };
}
