// mealplan-ui.js — Meal-plan domain extracted from app.js (createMealplanModule).
// Completes Decision #2's four-way split (recipes / meal-plan / groceries / cook).
// 15 pure normalizers are top-level exports (boot); the whole planner UI + auto-rules +
// meal-entry drag/drop + pickers + auto-generate + serving writeback + meal-plan settings +
// restaurant seam + meal-plan recipe cards is the factory. Meal-plan is the hub: it is
// instantiated LAST, so groceries/recipes get the meal-plan bridge injected via thunks, and
// meal-plan consumes their interfaces directly.
//
// NOT here (stays in app.js, injected): the shared week/slot/plan-record infra (weekState,
// weekKey, mealSlotsForWeek, slotEntries, recipeForSlot, groceryRecipeForSlot, createBlankWeek,
// ensurePrepWindowShape, currentWeek/startOfPrepWindow/plannerDayIdForDate/prepDays — used by
// Tasks + groceries too), the calendar readers (dual list preserved, Decision #1 not applied),
// the restore machinery, and the eat shell (activateEatShell). The legacy week.manualGroceries
// field is untouched (Decision #2b).
import * as LiveMealPlanServings from './meal-plan-servings.js';
import { icon as ldeIcon } from './live-icons.js';

function createId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function normalize(value) {
  return value.toLowerCase().replace(/^[\d\s./-]+/, "").replace(/\s+/g, " ").trim();
}

// Live app state ref set by the factory (null before instantiation -> boot-safe pure exports).
let _appState = null;

// ── Meal-plan constant data (moved verbatim from app.js) ──────────────────
const groceryMealPrefix = "grocery-item::";
const specialMealPrefix = "special-meal::";
const mealPlanCustomOptions = ["n/a", "out", "leftovers"];
const defaultMealEntries = [
  { meal: "Luke Breakfast", index: 0, value: "Tofu Scramble" },
  { meal: "Luke Lunch", index: 0, value: "Peanut Butter & Jelly with Veggies & Hummus" }
];
const autoRuleBlankSlotValue = "__blank_auto_rule_slot__";
const weekdayDefaultDayIds = new Set(["monday", "tuesday", "wednesday", "thursday"]);
const daySpecificDefaultMealEntries = [
  { dayId: "wednesday", meal: "MJ Dinner", index: 0, value: "leftovers" },
  { dayId: "wednesday", meal: "Luke Dinner", index: 0, value: "leftovers" }
];
const weekdayBreakfastDayIds = new Set(["monday", "tuesday", "wednesday", "thursday", "friday-finish"]);
const MEAL_TIME_WINDOWS = {
  Breakfast: [0, 11 * 60],        // until 11:00
  Lunch:     [11 * 60, 15 * 60],  // 11:00–15:00
  Dinner:    [15 * 60, 24 * 60],  // 15:00 onward
};
const expandedMealContext = new Set();

// ── Pure normalizers (top-level exports; boot-safe) ───────────────────────
export function cleanupAutoAppliedFutureMealDefaults(targetState) {
  const currentKey = dateKeyFromDate(startOfPrepWindow(new Date()));
  Object.entries(targetState.plans || {}).forEach(([key, week]) => {
    if (String(key) <= currentKey || !week || week.mealPlanView === "published" || week.publishedSlots) return;
    if (!week.slots || typeof week.slots !== "object") return;
    prepDays.forEach((day) => {
      if (weekdayDefaultDayIds.has(day.id)) {
        defaultMealEntries.forEach((defaultEntry) => removeDefaultMealEntryForState(targetState, week, day, defaultEntry));
      }
      daySpecificDefaultMealEntries
        .filter((defaultEntry) => defaultEntry.dayId === day.id)
        .forEach((defaultEntry) => removeDefaultMealEntryForState(targetState, week, day, defaultEntry));
    });
    week.defaultMealEntriesApplied = false;
  });
}

export function removeDefaultMealEntryForState(targetState, week, day, defaultEntry) {
  if (!week.slots?.[day.id] || typeof week.slots[day.id][defaultEntry.meal] === "undefined") return;
  const entries = mealEntryList(slotEntries(week.slots[day.id][defaultEntry.meal]), defaultEntry.meal);
  const expectedValues = defaultMealEntryValuesForState(targetState, defaultEntry.value);
  if (!expectedValues.has(recipeIdForSlot(entries[defaultEntry.index]))
    && !expectedValues.has(entries[defaultEntry.index])) return;
  entries[defaultEntry.index] = "";
  week.slots[day.id][defaultEntry.meal] = compactMealSlotEntries(entries, defaultEntry.meal);
}

export function defaultMealEntryValuesForState(targetState, value) {
  const values = new Set([value]);
  const recipe = (targetState.recipes || []).find((item) => normalize(item.name) === normalize(value));
  if (recipe?.id) values.add(recipe.id);
  const groceryItem = normalizeGroceryBaseItems(targetState.groceryBaseItems || []).find((item) => normalize(item) === normalize(value));
  if (groceryItem) values.add(groceryMealSlotId(groceryItem));
  return values;
}

export function mergeMealPlanConfig(newer, older) {
  if (!newer && !older) return undefined;
  if (!newer) return older;
  if (!older) return newer;
  const nMembers = newer.members || [];
  const oMembers = older.members || [];
  // A completely empty newer household must never erase a saved one — a fresh
  // device starts with zero members and is not an intentional "delete all".
  // When newer HAS members, its list is authoritative (deletes respected),
  // with newer's fields winning per member.
  const authoritative = nMembers.length ? nMembers : oMembers;
  // Match by a STABLE identity: a linked account's user id survives even when
  // the member list is rebuilt from group membership (which mints fresh member
  // ids and comes back with dob:""). Matching by id alone lost the birthday on
  // every such rebuild. Fall back to id for unlinked members.
  const keyOf = (m) => (m.linkedUserId ? `u:${m.linkedUserId}` : `i:${m.id}`);
  const oByKey = new Map(oMembers.map((m) => [keyOf(m), m]));
  const members = authoritative.map((n) => {
    const o = oByKey.get(keyOf(n));
    if (!o) return n;
    const merged = { ...o, ...n };
    // Empty-never-erases: a member rebuilt from group membership carries dob:""
    // — don't let that blank a saved birthday.
    if (!n.dob && o.dob) merged.dob = o.dob;
    return merged;
  });
  // Meal-type ORDER is meaningful (it lays out the day: breakfast, AM snack,
  // lunch, …), so the most recent writer must be authoritative for both the
  // ordering AND deletions — exactly like members above. The old union-of-ids
  // approach rebuilt the list in OLDER's order and appended newer-only types at
  // the end, which silently shoved freshly-inserted meals (e.g. AM/PM snack)
  // back to the bottom of the day after a sync. Empty-never-erases still holds:
  // a fresh device with no types must not wipe a saved list.
  const nTypes = newer.mealTypes || [];
  const oTypes = older.mealTypes || [];
  const oTypeById = new Map(oTypes.map((t) => [t.id, t]));
  const authoritativeTypes = nTypes.length ? nTypes : oTypes;
  const mealTypes = authoritativeTypes.map((n) => ({ ...(oTypeById.get(n.id) || {}), ...n }));
  // notifView is a plain scalar preference — the most recent writer wins.
  const notifView = newer.notifView || older.notifView;
  return { members, mealTypes, notifView };
}

export function defaultMealPlanConfig() {
  return {
    // No seeded household — a fresh account starts with just the signed-in
    // user (offered automatically in Household settings from their profile).
    members: [],
    mealTypes: [
      { id: "mealtype-breakfast", label: "Breakfast" },
      { id: "mealtype-lunch", label: "Lunch" },
      { id: "mealtype-dinner", label: "Dinner" }
    ],
    // How the recipe-notifications window presents: "list" (compact rows) or
    // "swipe" (one full-window card at a time — swipe left to dismiss, right to
    // add, up/down to browse). Swipe is only offered on touch devices.
    notifView: "list"
  };
}

export function normalizeMealPlanConfig(config) {
  const defaults = defaultMealPlanConfig();
  const rawMembers = Array.isArray(config?.members) ? config.members : [];
  const rawTypes = Array.isArray(config?.mealTypes) ? config.mealTypes : [];
  const seenMemberIds = new Set();
  const members = rawMembers.length
    ? rawMembers.map(m => ({ id: String(m?.id || createId("member")), label: String(m?.label || "").trim(), dob: String(m?.dob || "").trim(), linkedUserId: m?.linkedUserId || null })).filter(m => m.label && !seenMemberIds.has(m.id) && seenMemberIds.add(m.id))
    : defaults.members;
  const mealTypes = rawTypes.length
    ? rawTypes.map(t => ({ id: String(t?.id || createId("mealtype")), label: String(t?.label || "").trim() })).filter(t => t.label)
    : defaults.mealTypes;
  const notifView = config?.notifView === "swipe" ? "swipe" : "list";
  return {
    members: members.length ? members : defaults.members,
    mealTypes: mealTypes.length ? mealTypes : defaults.mealTypes,
    notifView
  };
}

export function recomputeMealPlanLayout(config) {
  const cfg = config || normalizeMealPlanConfig(_appState.mealPlanConfig);
  const memberLabels = cfg.members.map(m => m.label);
  const keysByType = {};
  cfg.mealTypes.forEach(type => {
    keysByType[type.id] = memberLabels.map(m => `${m} ${type.label}`);
  });
  const firstType = cfg.mealTypes[0];
  const lastType = cfg.mealTypes[cfg.mealTypes.length - 1];
  const secondType = cfg.mealTypes[1];
  const allKeys = cfg.mealTypes.flatMap(t => keysByType[t.id]);
  const lastKeys = lastType ? keysByType[lastType.id] : [];
  const allButLastKeys = cfg.mealTypes.slice(0, -1).flatMap(t => keysByType[t.id]);

  breakfastMeals.length = 0;
  (firstType ? keysByType[firstType.id] : []).forEach(k => breakfastMeals.push(k));
  lunchMeals.length = 0;
  (secondType ? keysByType[secondType.id] : []).forEach(k => lunchMeals.push(k));
  dinnerMeals.length = 0;
  lastKeys.forEach(k => dinnerMeals.push(k));

  meals.length = 0;
  allKeys.forEach(k => meals.push(k));

  Object.keys(combinedMealSections).forEach(k => delete combinedMealSections[k]);
  cfg.mealTypes.forEach(type => {
    combinedMealSections[`Combined ${type.label}`] = {
      label: type.label,
      members: keysByType[type.id]
    };
  });

  mealColumnConfigs.length = 0;
  cfg.mealTypes.forEach(type => {
    mealColumnConfigs.push({
      label: type.label,
      meals: keysByType[type.id],
      combinedMeal: `Combined ${type.label}`
    });
  });

  autoRuleMealKeys.length = 0;
  [...meals, ...Object.keys(combinedMealSections)].forEach(k => autoRuleMealKeys.push(k));

  prepDays.forEach(day => {
    if (day.id === "friday-start") {
      day.meals.length = 0;
      lastKeys.forEach(k => day.meals.push(k));
    } else if (day.id === "friday-finish") {
      day.meals.length = 0;
      allButLastKeys.forEach(k => day.meals.push(k));
    }
  });
}

export function defaultAutoGenerateRules() {
  return meals.map(slotKey =>
    autoRule(createId("rule"), prepDays.map(d => d.id), slotKey, 0, "skip")
  );
}

export function autoRule(id, dayIds, meal, index, action = "any", folderName = "", value = "") {
  return {
    id,
    dayIds,
    meal,
    index,
    action,
    folderName,
    value,
    tags: [],
    tagMatchMode: "any",
    selectionMode: "random"
  };
}

export function normalizeAutoGenerateRules(rules) {
  const source = Array.isArray(rules) && rules.length ? rules : defaultAutoGenerateRules();
  return source
    .map((rule) => normalizeAutoGenerateRule(rule))
    .filter(Boolean);
}

export function normalizeAutoGenerateRule(rule) {
  const migrated = migrateLegacyAutoRuleTarget(rule);
  if (!migrated) return null;
  const legacyFolderTag = rule.folderName ? [rule.folderName] : [];
  const action = ["folder", "folderSame"].includes(rule.action) ? "tags" : rule.action;
  return {
    id: rule.id || createId("rule"),
    dayIds: Array.isArray(rule.dayIds) && rule.dayIds.length ? rule.dayIds.filter((dayId) => prepDays.some((day) => day.id === dayId)) : prepDays.map((day) => day.id),
    meal: autoRuleMealKeys.includes(migrated.meal) ? migrated.meal : (autoRuleMealKeys[0] || ""),
    index: Number.isInteger(migrated.index) ? migrated.index : 0,
    action: ["any", "custom", "ingredient", "skip", "tags"].includes(action) ? action : "any",
    folderName: rule.folderName || "",
    value: rule.value || "",
    tags: normalizeRecipeTagSelection([...(Array.isArray(rule.tags) ? rule.tags : []), ...legacyFolderTag]),
    tagMatchMode: rule.tagMatchMode === "all" ? "all" : "any",
    selectionMode: rule.selectionMode === "leastRecent" ? "leastRecent" : "random"
  };
}

export function migrateLegacyAutoRuleTarget(rule) {
  if (autoRuleMealKeys.includes(rule.meal)) return { meal: rule.meal, index: Number.isInteger(rule.index) ? rule.index : 0 };
  const index = Number.isInteger(rule.index) ? rule.index : 0;
  const legacyTargets = {
    Breakfast: breakfastMeals,
    Lunch: lunchMeals,
    Dinner: dinnerMeals
  };
  if (legacyTargets[rule.meal]?.[index]) return { meal: legacyTargets[rule.meal][index], index: 0 };
  if (rule.meal === "Extras") return { meal: "Extras", index: 0 };
  return null;
}

export function mealEntryList(entries, meal) {
  const visibleEntries = entries.length ? [...entries] : [""];
  const minSlots = minimumMealEntryCount(meal);
  while (visibleEntries.length < minSlots) visibleEntries.push("");
  return visibleEntries;
}

export function minimumMealEntryCount(meal) {
  return 1;
}

export function groceryMealSlotId(item, servings = 1) {
  return `${groceryMealPrefix}${encodeURIComponent(String(item || "").trim())}::${Math.max(1, Number(servings) || 1)}`;
}

// ══════════════════════════════════════════════════════════════════════════
export function createMealplanModule(deps) {
  const {
    state, elements, meals, prepDays, breakfastMeals, lunchMeals, dinnerMeals, PLAN_COLORS, mealColumnConfigs, combinedMealSections, autoRuleMealKeys, getActiveAppArea, getAuthSession, getCurrentWeek, getDraggedDoTask, getDraggedPlayTask, getActivePlannerDayId, setActivePlannerDayId, getLastMealDragPoint, setLastMealDragPoint, getRestaurantSearchPending, setRestaurantSearchPending, getRestaurantSearchSuggestions, setRestaurantSearchSuggestions, getSuppressNextWeekLabelClick, setSuppressNextWeekLabelClick, getPendingMealRecipeSelection, setPendingMealRecipeSelection, getPendingMealIngredientSelection, setPendingMealIngredientSelection, getPendingAutoRuleRecipeSelection, setPendingAutoRuleRecipeSelection, getPendingAutoRuleIngredientSelection, setPendingAutoRuleIngredientSelection, getMealPlanNotifOpen, setMealPlanNotifOpen, getMealPlanRecipes, setMealPlanRecipes, getRestaurantInfoPopoverContext, setRestaurantInfoPopoverContext, acquireGroceryStoreSearchLocation, activeDayEventsTemplate, activeRecipes, addDays, autoEstimateNutrition, bindConfigListDrag, calendarTabStyle, callGmailApi, clearDoTaskDragState, clearPlayTaskDragState, cloneCombinedMealSections, cloneMealSlots, closeFloatingMenus, closeFolderMenu, closeSettingsMenu, closeWeekJumpMenu, combinedMealSectionsForWeek, combinedRecipeTime, compactDayLabel, compactMealSlotEntries, compactSlotEntries, dateFromWeekKey, dateKeyFromDate, defaultCollapsedSections, deleteDraggedDoTask, deleteDraggedPlayTask, displayMealName, doBacklogTasks, ensureCombinedMealSectionShape, ensureMealSlotShape, escapeHtml, focusGroceryLibraryInput, folderName, formatDailyDozenServings, formatWeekRange, getAppName, getGroceryStoreSearchLocation, groceryBaseItems, groceryPlacesApiUrl, groceryPlacesRequestOptions, grocerySuggestionItems, importViaGateway, isDescendantFolder, isPlannedRecipeEntry, isPublishedMealPlanView, makeSortable, mealEntryValue, mealKeysForDay, mealSlotsForWeek, minutesOfDay, normalizeCookLog, normalizeDoTasks, normalizeGroceryBaseItems, normalizeIngredients, normalizeInstructionSteps, normalizeNutritionFacts, normalizePublishedWeeks, normalizeRecipeTagSelection, normalizeRecipeUrlInput, normalizedFolders, openDailyDozenPage, openGroceriesPage, openGroceryReviewItems, openPlanEventDialog, openPublishedGroceryReview, openRecipeBoxPage, openRecipeView, persist, persistImmediately, planEventOccursOn, plannedEntryAtLocation, plannedServingsForEntry, plannerDayIdForDate, recipeDefaultServings, recipeForSlot, recipeIdForSlot, recipeTags, render, renderCollapsedSections, renderDoPlanner, renderFolders, renderGroceries, renderGroceryLibrary, renderPlayPlanner, renderTasksPage, saveRecipeRow, scaledIngredientToText, setCombinedMealSection, setPageNotifCount, setPageTitle, showMailToast, slotEntries, startOfPrepWindow, storeDirectionsUrl, syncedCalendarEventsForDate, unlistedGroceryItemsForWeek, updateTabIndicator, weekKey, weekState,
  } = deps;
  _appState = state;

  let activeAutoRuleDayId = activePlannerDayId;
  let autoRulePointerDrag = null;
  let autoRuleSwipeGesture = null;
  let copiedAutoRuleValue = null;
  let copiedMealEntry = "";
  let copiedMealSlot = null;
  let draggedAutoRuleEntry = null;
  let draggedMealEntry = null;
  let draggedMealSection = null;
  let editingMealEntry = null;
  let mealEntryClickTimer = null;
  let mealPlanContextPressStart = null;
  let mealPlanContextPressTimer = null;
  let mealPlanNotifWired = false;
  let mealPlanSwipeIndex = 0;
  let mealPointerDeleteGesture = null;
  let pendingAutoRuleCompaction = null;
  let restaurantSearchSessionToken = "";
  let suppressAutoRuleClick = false;
  let suppressMealEntryClick = false;
  let suppressNextDayTabClickId = "";

function createPlannedRecipeEntry(recipe, dayId = "", meal = "", plannedServings = null) {
  const day = prepDays.find((item) => item.id === dayId);
  const date = day ? dateKeyFromDate(addDays(getCurrentWeek(), day.offset)) : "";
  return LiveMealPlanServings.createMealPlanRecipe(recipe, {
    id: createId("meal-plan-recipe"),
    date,
    mealType: meal,
    plannedServings: plannedServings ?? recipeDefaultServings(recipe)
  });
}

function normalizePlannedRecipeEntry(entry) {
  if (!isPlannedRecipeEntry(entry)) return entry;
  return LiveMealPlanServings.normalizeMealPlanRecipe(entry, activeRecipes().find((recipe) => recipe.id === entry.recipeId));
}

function mergeCombinedMealSections(newer, older) {
  const n = newer || {};
  const o = older || {};
  const out = {};
  for (const dayId of new Set([...Object.keys(o), ...Object.keys(n)])) {
    const nDay = n[dayId] || {};
    const oDay = o[dayId] || {};
    const day = {};
    for (const meal of new Set([...Object.keys(oDay), ...Object.keys(nDay)])) {
      const nv = nDay[meal];
      const ov = oDay[meal];
      const nComb = Array.isArray(nv) && nv.length >= 2;
      const oComb = Array.isArray(ov) && ov.length >= 2;
      day[meal] = nComb ? nv : oComb ? ov : (nv !== undefined ? nv : ov);
    }
    out[dayId] = day;
  }
  return out;
}

function tagAutoRule(id, dayIds, meal, index, tags = [], tagMatchMode = "any", selectionMode = "random") {
  const rule = autoRule(id, dayIds, meal, index, "tags");
  rule.tags = normalizeRecipeTagSelection(tags);
  rule.tagMatchMode = tagMatchMode === "all" ? "all" : "any";
  rule.selectionMode = selectionMode === "leastRecent" ? "leastRecent" : "random";
  return rule;
}

function warmMealPlanRecipes() {
  if (!getAuthSession()?.access_token) return;
  callGmailApi({ action: "pendingRecipes" }).then((d) => {
    if (!d?.recipes) return;
    setMealPlanRecipes(d.recipes);
    setPageNotifCount("eat", getMealPlanRecipes().length);
    if (getActiveAppArea() === "eat") renderPlanner();
  });
}

function restoreMealPlanSwipeScroll() {
  const deck = elements.plannerGrid.querySelector(".eat-swipe-deck");
  if (!deck) return;
  const idx = Math.min(mealPlanSwipeIndex, deck.children.length - 1);
  if (idx > 0) deck.scrollTop = idx * deck.clientHeight;
}

function dismissMealPlanRecipe(url) {
  if (!getMealPlanRecipes()) return;
  // Keep the notifications window where the user was scrolled — renderPlanner()
  // rebuilds the whole grid, which would otherwise snap it back to the top. In
  // list view the panel itself scrolls; swipe view is handled by index (above).
  const panel = elements.plannerGrid.querySelector(".eat-notif-panel:not(.eat-notif-panel-swipe)");
  const savedScroll = panel?.scrollTop || 0;
  setMealPlanRecipes(getMealPlanRecipes().filter((r) => r.url !== url));
  setPageNotifCount("eat", getMealPlanRecipes().length);
  renderPlanner();
  const newPanel = elements.plannerGrid.querySelector(".eat-notif-panel:not(.eat-notif-panel-swipe)");
  if (newPanel) newPanel.scrollTop = savedScroll;
  callGmailApi({ action: "dismissRecipe", url });
}

function swipeAddMealPlanRecipe(url) {
  const recipe = (getMealPlanRecipes() || []).find((r) => r.url === url);
  dismissMealPlanRecipe(url); // remove from the deck + server-side dismiss
  if (!recipe) return;
  importMealPlanRecipeDirect(recipe).then((ok) => {
    showMailToast(ok
      ? `Added “${recipe.title || "recipe"}” to your recipe book.`
      : `Couldn't read “${recipe.title || "that recipe"}” — open it to add manually.`);
  });
}

async function importMealPlanRecipeDirect(recipe) {
  const url = normalizeRecipeUrlInput(recipe.url) || recipe.url;
  try {
    // Use the SAME import gateway as the interactive dialog. (The old call to
    // fetchRecipeWithBestAvailableMethod referenced a function that no longer
    // exists — it threw, was swallowed, and every swipe-add reported "couldn't
    // read", so a tapped/approved recipe never actually imported.)
    const result = await importViaGateway(url);
    const fetched = result?.type === "recipe" ? result.data : null;
    if (!fetched || (!fetched.name && !(fetched.ingredients || []).length)) return false;
    const id = createId("recipe");
    const prepTime = (fetched.prepTime || "").trim();
    const cookTime = (fetched.cookTime || "").trim();
    const servings = Number(fetched.servings) || 1;
    const saved = {
      id,
      name: (fetched.name || recipe.title || "Untitled recipe").trim(),
      prepTime,
      cookTime,
      time: combinedRecipeTime({ prepTime, cookTime }) || (fetched.time || "").trim(),
      servings,
      defaultServings: servings,
      folderId: "",
      sourceUrl: (fetched.sourceUrl || url || "").trim(),
      photoUrl: recipe.image || fetched.photoUrl || "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cookLog: [],
      tags: [],
      ingredients: normalizeIngredients(fetched.ingredients),
      nutrition: normalizeNutritionFacts(fetched.nutrition),
      nutritionEstimate: null,
      ingredientNutritionMatches: [],
      steps: normalizeInstructionSteps(fetched.steps).join("\n")
    };
    activeRecipes().push(saved);
    persist();
    saveRecipeRow(saved);
    render();
    if (saved.ingredients?.length) autoEstimateNutrition(saved.id);
    return true;
  } catch {
    return false;
  }
}

function mealPlanNotifSwipeBodyHtml(recipes) {
  if (!recipes.length) return `<div class="eat-notif-head">New recipes</div><div class="eat-notif-empty">No new recipes.</div>`;
  const fallbackSvg = `<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 2v7a3 3 0 0 0 6 0V2M6 2v20M17 2c-1.7 0-3 2.7-3 6s1.3 5 3 5 3 .6 3 2v7"/></svg>`;
  return `
    <div class="eat-swipe-deck" data-eat-swipe-deck>
      ${recipes.map((r) => `
        <div class="eat-swipe-card" data-swipe-url="${escapeHtml(r.url)}">
          <div class="eat-swipe-action eat-swipe-action-del" aria-hidden="true">Dismiss</div>
          <div class="eat-swipe-action eat-swipe-action-add" aria-hidden="true">Add</div>
          <div class="eat-swipe-card-inner">
            <div class="eat-swipe-flip">
              <div class="eat-swipe-face eat-swipe-front">
                <button class="eat-swipe-media" type="button" data-eat-notif-flip="${escapeHtml(r.url)}" aria-label="Show recipe">
                  ${r.image ? `<img src="${escapeHtml(r.image)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">` : ""}
                  <span class="eat-swipe-media-fallback" aria-hidden="true">${fallbackSvg}</span>
                  <span class="eat-swipe-flip-hint">Tap for recipe ⟳</span>
                </button>
                <div class="eat-swipe-meta">
                  <div class="eat-swipe-title">${escapeHtml(r.title)}</div>
                  ${r.source ? `<div class="eat-swipe-source">${escapeHtml(r.source)}</div>` : ""}
                </div>
                <div class="eat-swipe-buttons">
                  <button class="secondary-btn eat-swipe-btn" type="button" data-eat-notif-dismiss="${escapeHtml(r.url)}">Dismiss</button>
                  <button class="primary-btn eat-swipe-btn" type="button" data-eat-notif-swipe-add="${escapeHtml(r.url)}">Add</button>
                </div>
              </div>
              <div class="eat-swipe-face eat-swipe-back">
                <div class="eat-swipe-back-head">
                  <button class="eat-swipe-flip-back" type="button" data-eat-notif-flip-back aria-label="Back to photo">← Photo</button>
                  <a class="eat-swipe-view" href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">Source ↗</a>
                </div>
                <div class="eat-swipe-recipe" data-eat-recipe-body></div>
              </div>
            </div>
          </div>
        </div>`).join("")}
    </div>`;
}

function mealPlanRecipePreviewHtml(r) {
  const ings = normalizeIngredients(r.ingredients).map((i) => scaledIngredientToText(i, 1)).filter(Boolean);
  const steps = normalizeInstructionSteps(r.steps).filter(Boolean);
  const meta = [combinedRecipeTime(r) || (r.time || "").trim(), Number(r.servings) ? `${Number(r.servings)} servings` : ""].filter(Boolean).join(" · ");
  return `
    <h3 class="eat-swipe-recipe-title">${escapeHtml(r.name || "Recipe")}</h3>
    ${meta ? `<div class="eat-swipe-recipe-meta">${escapeHtml(meta)}</div>` : ""}
    ${ings.length ? `<h4 class="eat-swipe-recipe-h">Ingredients</h4>
      <ul class="eat-swipe-recipe-ings">${ings.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : ""}
    ${steps.length ? `<h4 class="eat-swipe-recipe-h">Steps</h4>
      <ol class="eat-swipe-recipe-steps">${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>` : ""}
    ${!ings.length && !steps.length ? `<p class="eat-swipe-recipe-empty">No ingredients or steps could be read.</p>` : ""}`;
}

async function flipMealPlanCard(url, cardEl) {
  const flip = cardEl.querySelector(".eat-swipe-flip");
  const deck = cardEl.closest(".eat-swipe-deck");
  if (!flip) return;
  flip.classList.add("is-flipped");
  deck?.classList.add("is-card-flipped");
  const body = cardEl.querySelector("[data-eat-recipe-body]");
  if (!body || body.dataset.loaded) return; // fetch once, then it's cached in the DOM
  const errHtml = `<div class="eat-swipe-recipe-err">Couldn't read this recipe automatically. <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open the source ↗</a></div>`;
  body.innerHTML = `<div class="eat-swipe-recipe-loading">Reading recipe…</div>`;
  try {
    const result = await importViaGateway(normalizeRecipeUrlInput(url) || url);
    const data = result?.type === "recipe" ? result.data : null;
    if (!data || (!data.name && !(data.ingredients || []).length)) { body.innerHTML = errHtml; return; }
    body.innerHTML = mealPlanRecipePreviewHtml(data);
    body.dataset.loaded = "1";
  } catch { body.innerHTML = errHtml; }
}

function unflipMealPlanCard(cardEl) {
  cardEl.querySelector(".eat-swipe-flip")?.classList.remove("is-flipped");
  const deck = cardEl.closest(".eat-swipe-deck");
  if (deck && !deck.querySelector(".eat-swipe-flip.is-flipped")) deck.classList.remove("is-card-flipped");
}

function mealPlanNotifBellHtml() {
  const recipes = getMealPlanRecipes() || [];
  const count = recipes.length;
  const bellSvg = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
  return `
    <div class="eat-notif-wrap">
      <button class="icon-btn eat-notif-btn" type="button" data-eat-notif-toggle title="New recipes" aria-label="New recipes" aria-expanded="${getMealPlanNotifOpen()}">
        ${bellSvg}
        ${count ? `<span class="eat-notif-badge">${count}</span>` : ""}
      </button>
      ${getMealPlanNotifOpen() ? `
      <div class="eat-notif-panel eat-notif-panel-swipe">
        ${mealPlanNotifSwipeBodyHtml(recipes)}
      </div>` : ""}
    </div>`;
}

function wireMealPlanNotifDelegation() {
  if (mealPlanNotifWired) return;
  mealPlanNotifWired = true;
  elements.plannerGrid.addEventListener("click", (e) => {
    if (e.target.closest("[data-eat-notif-toggle]")) { setMealPlanNotifOpen(!getMealPlanNotifOpen()); if (getMealPlanNotifOpen()) mealPlanSwipeIndex = 0; renderPlanner(); return; }
    const flip = e.target.closest("[data-eat-notif-flip]");
    if (flip) { const card = flip.closest(".eat-swipe-card"); if (card) flipMealPlanCard(flip.dataset.eatNotifFlip, card); return; }
    const flipBack = e.target.closest("[data-eat-notif-flip-back]");
    if (flipBack) { const card = flipBack.closest(".eat-swipe-card"); if (card) unflipMealPlanCard(card); return; }
    // A tap anywhere on the recipe (flipped) side — except a link/button — flips
    // back to the photo. Scrolling the recipe never fires a click, so browsing
    // the recipe still works; only a genuine tap returns to the photo.
    const backFace = e.target.closest(".eat-swipe-back");
    if (backFace && !e.target.closest("a, button")) { const card = backFace.closest(".eat-swipe-card"); if (card) unflipMealPlanCard(card); return; }
    const swipeAdd = e.target.closest("[data-eat-notif-swipe-add]");
    if (swipeAdd) { swipeAddMealPlanRecipe(swipeAdd.dataset.eatNotifSwipeAdd); return; }
    const dismiss = e.target.closest("[data-eat-notif-dismiss]");
    if (dismiss) { dismissMealPlanRecipe(dismiss.dataset.eatNotifDismiss); return; }
  });
  document.addEventListener("click", (e) => {
    if (!getMealPlanNotifOpen()) return;
    if (e.target.closest(".eat-notif-wrap")) return;
    setMealPlanNotifOpen(false);
    renderPlanner();
  }, { capture: true });

  // Track the centered card as the deck scrolls. scroll doesn't bubble, but the
  // capture phase still reaches this ancestor listener on the way to the deck.
  elements.plannerGrid.addEventListener("scroll", (e) => {
    const deck = e.target.closest?.(".eat-swipe-deck");
    if (!deck || !deck.clientHeight) return;
    mealPlanSwipeIndex = Math.round(deck.scrollTop / deck.clientHeight);
  }, { capture: true });

  // Swipe-card gestures (touch only). A horizontal drag past threshold flings
  // the card off and acts on it; a vertical drag is left to the deck's native
  // scroll-snap so up/down browses between recipes.
  let swipeCard = null, swipeStartX = 0, swipeStartY = 0, swipeAxis = null;
  const swipeLabels = (card) => ({
    add: card.querySelector(".eat-swipe-action-add"),
    del: card.querySelector(".eat-swipe-action-del"),
    inner: card.querySelector(".eat-swipe-card-inner")
  });
  elements.plannerGrid.addEventListener("touchstart", (e) => {
    const card = e.target.closest(".eat-swipe-card");
    // A flipped card shows the recipe (scrolls vertically on its own) — the
    // dismiss/add fling belongs to the photo side only.
    if (card && card.querySelector(".eat-swipe-flip.is-flipped")) { swipeCard = null; return; }
    swipeCard = card || null;
    if (!card) return;
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    swipeAxis = null;
  }, { passive: true });
  elements.plannerGrid.addEventListener("touchmove", (e) => {
    if (!swipeCard) return;
    const dx = e.touches[0].clientX - swipeStartX;
    const dy = e.touches[0].clientY - swipeStartY;
    if (!swipeAxis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      swipeAxis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (swipeAxis !== "x") return; // vertical → let the deck scroll natively
    e.preventDefault(); // we own this horizontal gesture now
    const { add, del, inner } = swipeLabels(swipeCard);
    if (inner) { inner.style.transition = "none"; inner.style.transform = `translateX(${dx}px) rotate(${dx * 0.02}deg)`; }
    const t = Math.min(1, Math.abs(dx) / 120);
    if (add) add.style.opacity = dx > 0 ? t : 0;
    if (del) del.style.opacity = dx < 0 ? t : 0;
  }, { passive: false });
  elements.plannerGrid.addEventListener("touchend", (e) => {
    if (!swipeCard) return;
    const card = swipeCard; const axis = swipeAxis;
    swipeCard = null; swipeAxis = null;
    if (axis !== "x") return;
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const { add, del, inner } = swipeLabels(card);
    const url = card.dataset.swipeUrl;
    const THRESH = 90;
    if (dx > THRESH) {
      if (inner) { inner.style.transition = "transform 0.18s ease"; inner.style.transform = "translateX(120%) rotate(6deg)"; }
      setTimeout(() => swipeAddMealPlanRecipe(url), 170); // let the fling show before the re-render
    } else if (dx < -THRESH) {
      if (inner) { inner.style.transition = "transform 0.18s ease"; inner.style.transform = "translateX(-120%) rotate(-6deg)"; }
      setTimeout(() => dismissMealPlanRecipe(url), 170);
    } else {
      if (inner) { inner.style.transition = "transform 0.18s ease"; inner.style.transform = ""; }
      if (add) add.style.opacity = 0;
      if (del) del.style.opacity = 0;
    }
  }, { passive: true });
}

function positionMealPlanNotifPanel() {
  const bell = elements.plannerGrid.querySelector(".eat-notif-btn");
  const panel = elements.plannerGrid.querySelector(".eat-notif-panel");
  if (!bell || !panel) return;
  const r = bell.getBoundingClientRect();
  const gap = Math.max(8, Math.round(window.innerWidth - r.right)); // current distance from the right edge
  panel.style.left = gap + "px";
  panel.style.right = gap + "px";
  panel.style.bottom = gap + "px";
  panel.style.top = Math.round(r.bottom + 6) + "px"; // just under the bell = where it opened before
}

function applyInitialMealPlanFocus() {
  if (!state.collapsedSections) state.collapsedSections = defaultCollapsedSections();
  Object.keys(defaultCollapsedSections()).forEach((sectionId) => {
    state.collapsedSections[sectionId] = sectionId !== "mealPrep";
  });
  setActivePlannerDayId(plannerDayIdForDate(new Date()));
  persist();
  renderCollapsedSections();
  renderPlanner();
}

function openMealEntryMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();

  const entry = event.currentTarget;
  const day = entry.dataset.day;
  const meal = entry.dataset.meal;
  const index = Number(entry.dataset.index);
  if (!day || !meal || Number.isNaN(index)) return;
  const recipe = recipeForMealEntry(day, meal, index);
  const canMakeAhead = recipe && !recipe.virtualGroceryRecipe;
  const canCopyAsLeftovers = Boolean(nameForMealEntryLeftovers(day, meal, index));

  const menu = document.createElement("div");
  menu.className = "folder-context-menu meal-entry-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    ${canMakeAhead ? `
      <button type="button" role="menuitem" data-make-ahead-meal-entry-menu data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}" data-index="${index}">
        Make ahead
      </button>
      <button type="button" role="menuitem" data-prep-ahead-meal-entry-menu data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}" data-index="${index}">
        Prep ahead
      </button>
    ` : ""}
    <button type="button" role="menuitem" data-copy-meal-entry-menu data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}" data-index="${index}">
      Copy meal
    </button>
    ${canCopyAsLeftovers ? `
      <button type="button" role="menuitem" data-copy-leftovers-meal-entry-menu data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}" data-index="${index}">
        Copy as leftovers
      </button>
    ` : ""}
    <button type="button" role="menuitem" data-remove-meal-entry-menu data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}" data-index="${index}">
      Delete
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

  const makeAheadButton = menu.querySelector("[data-make-ahead-meal-entry-menu]");
  let didMakeAhead = false;
  const makeAheadFromMenu = (makeAheadEvent) => {
    makeAheadEvent.preventDefault();
    makeAheadEvent.stopPropagation();
    if (didMakeAhead) return;
    didMakeAhead = true;
    suppressMealEntryClick = true;
    const target = makeAheadEvent.currentTarget;
    closeFolderMenu();
    addMakeAheadTaskForMealEntry(target.dataset.day, target.dataset.meal, Number(target.dataset.index));
    window.setTimeout(() => {
      suppressMealEntryClick = false;
    }, 120);
  };
  makeAheadButton?.addEventListener("pointerdown", makeAheadFromMenu);
  makeAheadButton?.addEventListener("mousedown", makeAheadFromMenu);
  makeAheadButton?.addEventListener("click", makeAheadFromMenu);

  const prepAheadButton = menu.querySelector("[data-prep-ahead-meal-entry-menu]");
  let didPrepAhead = false;
  const prepAheadFromMenu = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (didPrepAhead) return; didPrepAhead = true;
    suppressMealEntryClick = true;
    const target = e.currentTarget;
    closeFolderMenu();
    addPrepAheadTaskForMealEntry(target.dataset.day, target.dataset.meal, Number(target.dataset.index));
    window.setTimeout(() => { suppressMealEntryClick = false; }, 120);
  };
  prepAheadButton?.addEventListener("pointerdown", prepAheadFromMenu);
  prepAheadButton?.addEventListener("mousedown", prepAheadFromMenu);
  prepAheadButton?.addEventListener("click", prepAheadFromMenu);

  const removeButton = menu.querySelector("[data-remove-meal-entry-menu]");
  let didRemove = false;
  const removeFromMenu = (removeEvent) => {
    removeEvent.preventDefault();
    removeEvent.stopPropagation();
    if (didRemove) return;
    didRemove = true;
    suppressMealEntryClick = true;
    const target = removeEvent.currentTarget;
    closeFolderMenu();
    removeMealEntry(target.dataset.day, target.dataset.meal, Number(target.dataset.index));
    window.setTimeout(() => {
      suppressMealEntryClick = false;
    }, 120);
  };
  removeButton.addEventListener("pointerdown", removeFromMenu);
  removeButton.addEventListener("mousedown", removeFromMenu);
  removeButton.addEventListener("click", removeFromMenu);

  const copyButton = menu.querySelector("[data-copy-meal-entry-menu]");
  let didCopy = false;
  const copyFromMenu = (copyEvent) => {
    copyEvent.preventDefault();
    copyEvent.stopPropagation();
    if (didCopy) return;
    didCopy = true;
    suppressMealEntryClick = true;
    const target = copyEvent.currentTarget;
    closeFolderMenu();
    copyMealEntry(target.dataset.day, target.dataset.meal, Number(target.dataset.index));
    window.setTimeout(() => {
      suppressMealEntryClick = false;
    }, 120);
  };
  copyButton.addEventListener("pointerdown", copyFromMenu);
  copyButton.addEventListener("mousedown", copyFromMenu);
  copyButton.addEventListener("click", copyFromMenu);

  const copyLeftoversButton = menu.querySelector("[data-copy-leftovers-meal-entry-menu]");
  let didCopyLeftovers = false;
  const copyLeftoversFromMenu = (copyEvent) => {
    copyEvent.preventDefault();
    copyEvent.stopPropagation();
    if (didCopyLeftovers) return;
    didCopyLeftovers = true;
    suppressMealEntryClick = true;
    const target = copyEvent.currentTarget;
    closeFolderMenu();
    copyMealEntryAsLeftovers(target.dataset.day, target.dataset.meal, Number(target.dataset.index));
    window.setTimeout(() => {
      suppressMealEntryClick = false;
    }, 120);
  };
  copyLeftoversButton?.addEventListener("pointerdown", copyLeftoversFromMenu);
  copyLeftoversButton?.addEventListener("mousedown", copyLeftoversFromMenu);
  copyLeftoversButton?.addEventListener("click", copyLeftoversFromMenu);
}

function openEmptyMealEntryMenu(event) {
  if (!copiedMealEntry) return;
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();

  const entry = event.currentTarget;
  const day = entry.dataset.day;
  const meal = entry.dataset.meal;
  const index = Number(entry.dataset.index);
  if (!day || !meal || Number.isNaN(index)) return;

  const menu = document.createElement("div");
  menu.className = "folder-context-menu meal-entry-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-paste-meal-entry-menu data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}" data-index="${index}">
      Paste meal
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

  const pasteButton = menu.querySelector("[data-paste-meal-entry-menu]");
  let didPaste = false;
  const pasteFromMenu = (pasteEvent) => {
    pasteEvent.preventDefault();
    pasteEvent.stopPropagation();
    if (didPaste) return;
    didPaste = true;
    const target = pasteEvent.currentTarget;
    closeFolderMenu();
    pasteMealEntry(target.dataset.day, target.dataset.meal, Number(target.dataset.index));
  };
  pasteButton.addEventListener("pointerdown", pasteFromMenu);
  pasteButton.addEventListener("mousedown", pasteFromMenu);
  pasteButton.addEventListener("click", pasteFromMenu);
}

function openMealSlotMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();

  const slotEl = event.currentTarget;
  const day = slotEl.dataset.day;
  const meal = slotEl.dataset.meal;
  if (!day || !meal) return;

  const week = weekState();
  const entries = slotEntries(week.slots?.[day]?.[meal]).filter(Boolean);
  const hasCopied = !!copiedMealSlot;
  if (!entries.length && !hasCopied) return;

  const menu = document.createElement("div");
  menu.className = "folder-context-menu meal-entry-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    ${entries.length ? `<button type="button" role="menuitem" data-copy-meal-slot-menu>Copy meal</button>` : ""}
    ${hasCopied ? `<button type="button" role="menuitem" data-paste-meal-slot-menu>Paste meal</button>` : ""}
  `;

  document.body.append(menu);
  const sourceRect = slotEl.getBoundingClientRect();
  const rawX = event.clientX || sourceRect.right || 10;
  const rawY = event.clientY || sourceRect.bottom || 10;
  const x = Math.min(rawX, window.innerWidth - menu.offsetWidth - 10);
  const y = Math.min(rawY, window.innerHeight - menu.offsetHeight - 10);
  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${Math.max(10, y)}px`;

  const runAction = (fn) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeFolderMenu();
    fn();
  };

  menu.querySelector("[data-copy-meal-slot-menu]")?.addEventListener("pointerdown", runAction(() => copyMealSlot(day, meal)));
  menu.querySelector("[data-copy-meal-slot-menu]")?.addEventListener("mousedown", runAction(() => copyMealSlot(day, meal)));
  menu.querySelector("[data-copy-meal-slot-menu]")?.addEventListener("click", runAction(() => copyMealSlot(day, meal)));

  menu.querySelector("[data-paste-meal-slot-menu]")?.addEventListener("pointerdown", runAction(() => pasteMealSlot(day, meal)));
  menu.querySelector("[data-paste-meal-slot-menu]")?.addEventListener("mousedown", runAction(() => pasteMealSlot(day, meal)));
  menu.querySelector("[data-paste-meal-slot-menu]")?.addEventListener("click", runAction(() => pasteMealSlot(day, meal)));
}

function copyMealSlot(day, meal) {
  const week = weekState();
  const entries = slotEntries(week.slots?.[day]?.[meal]).filter(Boolean);
  if (!entries.length) return;
  copiedMealSlot = entries.map((entry) =>
    isPlannedRecipeEntry(entry) ? { ...entry, id: createId("meal-plan-recipe") } : entry
  );
}

function pasteMealSlot(day, meal) {
  if (!copiedMealSlot) return;
  const entries = copiedMealSlot.map((entry) =>
    isPlannedRecipeEntry(entry)
      ? plannedEntryAtLocation({ ...entry, id: createId("meal-plan-recipe") }, day, meal)
      : entry
  );
  setMeal(day, meal, compactMealSlotEntries(entries, meal));
}

function recipeForMealEntry(day, meal, index) {
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
  return recipeForSlot(entries[index]);
}

function copyMealEntry(day, meal, index) {
  const entry = mealEntryValue(day, meal, index);
  copiedMealEntry = isPlannedRecipeEntry(entry)
    ? { ...entry, id: createId("meal-plan-recipe") }
    : entry;
}

function nameForMealEntryLeftovers(day, meal, index) {
  const entry = mealEntryValue(day, meal, index);
  if (!entry || isSpecialMealSlot(entry)) return null;
  const recipe = recipeForSlot(entry);
  if (recipe) return recipe.name;
  return typeof entry === "string" ? entry.trim() || null : null;
}

function copyMealEntryAsLeftovers(day, meal, index) {
  const name = nameForMealEntryLeftovers(day, meal, index);
  if (!name) return;
  copiedMealEntry = specialMealSlotId("leftovers", name);
}

function pasteMealEntry(day, meal, index) {
  if (!copiedMealEntry) return;
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
  entries[index] = plannedEntryAtLocation(
    isPlannedRecipeEntry(copiedMealEntry) ? { ...copiedMealEntry, id: createId("meal-plan-recipe") } : copiedMealEntry,
    day,
    meal
  );
  setMeal(day, meal, compactMealSlotEntries(entries, meal));
}

function addMakeAheadTaskForMealEntry(day, meal, index) {
  const recipe = recipeForMealEntry(day, meal, index);
  if (!recipe || recipe.virtualGroceryRecipe) return;
  const key = weekKey();
  const title = `Make Ahead: ${recipe.name}`;
  const tasks = doBacklogTasks();
  const alreadyExists = tasks.some((task) => (
    normalize(task.title) === normalize(title)
    && (!task.weekKey || task.weekKey === key)
  ));
  if (!alreadyExists) {
    tasks.push({
      id: createId("task"),
      title,
      done: false,
      weekKey: key,
      sourceRecipeId: recipe.id,
      sourceMealDay: day,
      sourceMealName: meal,
      createdAt: new Date().toISOString()
    });
  }
  persist();
  renderDoPlanner();
  renderTasksPage();
}

function addPrepAheadTaskForMealEntry(day, meal, index) {
  const recipe = recipeForMealEntry(day, meal, index);
  if (!recipe || recipe.virtualGroceryRecipe) return;
  const key = weekKey();
  const title = `Prep: ${recipe.name}`;
  const tasks = doBacklogTasks();
  const alreadyExists = tasks.some((task) => (
    normalize(task.title) === normalize(title)
    && (!task.weekKey || task.weekKey === key)
  ));
  if (!alreadyExists) {
    tasks.push({
      id: createId("task"),
      title,
      notes: "",
      taskType: "one-off",
      done: false,
      weekKey: key,
      sourceRecipeId: recipe.id,
      sourceMealDay: day,
      sourceMealName: meal,
      createdAt: new Date().toISOString()
    });
  }
  persist();
  renderDoPlanner();
  renderTasksPage();
}

function openAutoRuleEntryMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();

  const entry = event.currentTarget;
  const day = entry.dataset.day;
  const meal = entry.dataset.meal;
  const index = Number(entry.dataset.index);
  if (!day || !meal || Number.isNaN(index)) return;
  const rule = autoGenerateRuleForSlot({ id: day }, meal, index);
  const hasValue = Boolean(autoRuleInputValue(rule));

  if (!hasValue && !copiedAutoRuleValue) return;

  const menu = document.createElement("div");
  menu.className = "folder-context-menu meal-entry-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    ${hasValue ? `
      <button type="button" role="menuitem" data-copy-auto-rule-menu data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}" data-index="${index}">
        Copy meal
      </button>
      <button type="button" role="menuitem" data-copy-leftovers-auto-rule-menu data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}" data-index="${index}">
        Copy as leftovers
      </button>
    ` : ""}
    ${copiedAutoRuleValue ? `
      <button type="button" role="menuitem" data-paste-auto-rule-menu data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}" data-index="${index}">
        Paste meal
      </button>
    ` : ""}
    ${hasValue ? `
      <button type="button" role="menuitem" data-remove-auto-rule-menu data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}" data-index="${index}">
        Remove
      </button>
    ` : ""}
  `;

  elements.autoRulesDialog.append(menu);
  const sourceRect = event.currentTarget?.getBoundingClientRect?.();
  const rawX = event.clientX || sourceRect?.right || 10;
  const rawY = event.clientY || sourceRect?.bottom || 10;
  const x = Math.min(rawX, window.innerWidth - menu.offsetWidth - 10);
  const y = Math.min(rawY, window.innerHeight - menu.offsetHeight - 10);
  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${Math.max(10, y)}px`;

  function bindAction(selector, fn) {
    const btn = menu.querySelector(selector);
    if (!btn) return;
    let fired = false;
    const handle = (e) => { e.preventDefault(); e.stopPropagation(); if (fired) return; fired = true; closeFolderMenu(); fn(e.currentTarget); };
    btn.addEventListener("pointerdown", handle);
    btn.addEventListener("mousedown", handle);
    btn.addEventListener("click", handle);
  }

  bindAction("[data-copy-auto-rule-menu]", (btn) => copyAutoRuleEntry(btn.dataset.day, btn.dataset.meal, Number(btn.dataset.index)));
  bindAction("[data-copy-leftovers-auto-rule-menu]", (btn) => copyAutoRuleEntryAsLeftovers(btn.dataset.day, btn.dataset.meal, Number(btn.dataset.index)));
  bindAction("[data-paste-auto-rule-menu]", (btn) => pasteAutoRuleEntry(btn.dataset.day, btn.dataset.meal, Number(btn.dataset.index)));
  bindAction("[data-remove-auto-rule-menu]", (btn) => removeAutoRuleSlot(btn.dataset.day, btn.dataset.meal, Number(btn.dataset.index)));
}

function copyAutoRuleEntry(day, meal, index) {
  const rule = autoGenerateRuleForSlot({ id: day }, meal, index);
  if (!rule || rule.action === "skip") return;
  copiedAutoRuleValue = {
    action: rule.action,
    value: rule.value || "",
    folderName: rule.folderName || "",
    tags: rule.tags ? [...rule.tags] : [],
    tagMatchMode: rule.tagMatchMode || "any",
    selectionMode: rule.selectionMode || "random"
  };
}

function copyAutoRuleEntryAsLeftovers(day, meal, index) {
  const rule = autoGenerateRuleForSlot({ id: day }, meal, index);
  if (!rule || rule.action === "skip") return;
  let recipeName = "";
  if (rule.action === "ingredient") {
    recipeName = parseGroceryMealSlot(rule.value)?.item || String(rule.value || "").trim();
  } else if (rule.action === "custom" && !isSpecialMealSlot(rule.value)) {
    recipeName = parseGroceryMealSlot(rule.value)?.item || activeRecipes().find((r) => r.id === rule.value)?.name || rule.value || "";
  }
  copiedAutoRuleValue = { action: "custom", value: specialMealSlotId("leftovers", recipeName), folderName: "", tags: [], tagMatchMode: "any", selectionMode: "random" };
}

function pasteAutoRuleEntry(day, meal, index) {
  if (!copiedAutoRuleValue) return;
  const { action, value, folderName, tags, tagMatchMode, selectionMode } = copiedAutoRuleValue;
  removeAutoRulesForDaySlot(day, meal, index);
  let rule;
  if (action === "tags") {
    rule = autoRule(createId("rule"), [day], meal, index, "tags");
    rule.tags = [...tags];
    rule.tagMatchMode = tagMatchMode;
    rule.selectionMode = selectionMode;
  } else {
    rule = autoRule(createId("rule"), [day], meal, index, action, folderName, value);
  }
  state.autoGenerateRules.unshift(rule);
  persist();
  renderAutoRules();
}

function startMealPlanContextPress(event, scope, dayId = "") {
  if (event.pointerType !== "touch") return;
  mealPlanContextPressStart = { x: event.clientX, y: event.clientY };
  window.clearTimeout(mealPlanContextPressTimer);
  mealPlanContextPressTimer = window.setTimeout(() => {
    setSuppressNextWeekLabelClick(scope === "week");
    suppressNextDayTabClickId = scope === "day" ? dayId : "";
    openMealPlanContextMenu(event, scope, dayId, { fromLongPress: true });
  }, 560);
}

function handleMealPlanContextPressMove(event) {
  if (!mealPlanContextPressStart) return;
  const moved = Math.hypot(event.clientX - mealPlanContextPressStart.x, event.clientY - mealPlanContextPressStart.y);
  if (moved > 12) cancelMealPlanContextPress();
}

function cancelMealPlanContextPress() {
  window.clearTimeout(mealPlanContextPressTimer);
  mealPlanContextPressTimer = null;
  mealPlanContextPressStart = null;
}

function openMealPlanContextMenu(event, scope, dayId = "", options = {}) {
  if (getActiveAppArea() !== "eat") return;
  event.preventDefault();
  event.stopPropagation();
  cancelMealPlanContextPress();
  closeFolderMenu();
  closeWeekJumpMenu();

  const isDay = scope === "day";
  const day = isDay ? prepDays.find((item) => item.id === dayId) : null;
  if (isDay && !day) return;

  const menu = document.createElement("div");
  menu.className = "folder-context-menu meal-plan-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = isDay
    ? `
      <button type="button" role="menuitem" data-clear-planner-day="${escapeHtml(day.id)}">Clear day</button>
      <button type="button" role="menuitem" data-autofill-planner-day="${escapeHtml(day.id)}">Auto-fill day</button>
    `
    : `
      <button type="button" role="menuitem" data-clear-planner-week>Clear week</button>
      <button type="button" role="menuitem" data-autofill-planner-week>Auto-fill week</button>
    `;

  document.body.append(menu);
  const sourceRect = event.currentTarget?.getBoundingClientRect?.();
  const rawX = event.clientX || sourceRect?.left || 10;
  const rawY = event.clientY || sourceRect?.bottom || 10;
  const x = Math.min(rawX, window.innerWidth - menu.offsetWidth - 10);
  const y = Math.min(rawY, window.innerHeight - menu.offsetHeight - 10);
  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${Math.max(10, y)}px`;

  const runMenuAction = (action) => (menuEvent) => {
    menuEvent.preventDefault();
    menuEvent.stopPropagation();
    closeFolderMenu();
    action();
  };

  menu.querySelector("[data-clear-planner-week]")?.addEventListener("click", runMenuAction(clearPlannerWeek));
  menu.querySelector("[data-autofill-planner-week]")?.addEventListener("click", runMenuAction(autoGenerateMealPlan));
  menu.querySelector("[data-clear-planner-day]")?.addEventListener("click", runMenuAction(() => clearPlannerDay(day.id, { confirm: true })));
  menu.querySelector("[data-autofill-planner-day]")?.addEventListener("click", runMenuAction(() => autoGeneratePlannerDay(day.id)));

  if (options.fromLongPress) {
    window.setTimeout(() => {
      setSuppressNextWeekLabelClick(false);
      suppressNextDayTabClickId = "";
    }, 350);
  }
}

function openAutoRulesDialog(event) {
  event?.stopPropagation();
  closeSettingsMenu();
  activeAutoRuleDayId = getActivePlannerDayId();
  renderAutoRules();
  elements.autoRulesDialog.showModal();
}

function closeAutoRulesDialog() {
  persist();
  elements.autoRulesDialog.close();
}

function createRestaurantSearchSessionToken() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function openRestaurantInfoPopover(restaurant, day, meal, index, anchorEl) {
  setRestaurantInfoPopoverContext({ day, meal, index });
  const mapsUrl = restaurant.googleMapsUri || storeDirectionsUrl(restaurant);
  elements.restaurantInfoPopoverName.textContent = restaurant.name;
  elements.restaurantInfoDirectionsLink.href = mapsUrl || "";
  elements.restaurantInfoDirectionsLink.hidden = !mapsUrl;
  elements.restaurantInfoMenuLink.href = restaurant.websiteUri || "";
  elements.restaurantInfoMenuLink.hidden = !restaurant.websiteUri;
  elements.restaurantInfoPopover.hidden = false;
  requestAnimationFrame(() => {
    const rect = anchorEl.getBoundingClientRect();
    const popover = elements.restaurantInfoPopover;
    const pw = popover.offsetWidth;
    const ph = popover.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.left;
    if (left + pw > vw - 8) left = vw - pw - 8;
    if (left < 8) left = 8;
    let top = rect.bottom + 4;
    if (top + ph > vh - 8) top = rect.top - ph - 4;
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  });
}

function closeRestaurantInfoPopover() {
  elements.restaurantInfoPopover.hidden = true;
  setRestaurantInfoPopoverContext(null);
}

function openRestaurantSearchDialog(day, meal, index) {
  setRestaurantSearchPending({ day, meal, index });
  restaurantSearchSessionToken = createRestaurantSearchSessionToken();
  setRestaurantSearchSuggestions([]);
  renderRestaurantSuggestions();
  elements.restaurantSearchInput.value = "";
  if (!elements.restaurantSearchDialog.open) elements.restaurantSearchDialog.showModal();
  requestAnimationFrame(() => elements.restaurantSearchInput.focus());

  if (!state.locationSharingEnabled) {
    elements.restaurantSearchStatus.textContent = "Enable location sharing in Settings for local results.";
  } else if (!getGroceryStoreSearchLocation()) {
    elements.restaurantSearchStatus.textContent = "Getting your location…";
    acquireGroceryStoreSearchLocation().then((loc) => {
      if (!elements.restaurantSearchDialog.open) return;
      if (!elements.restaurantSearchInput.value.trim()) {
        elements.restaurantSearchStatus.textContent = loc ? "" : "Location unavailable. Results may not be local.";
      }
    });
  } else {
    elements.restaurantSearchStatus.textContent = "";
  }
}

async function searchRestaurantLocations(query) {
  try {
    if (state.locationSharingEnabled && !getGroceryStoreSearchLocation()) {
      await acquireGroceryStoreSearchLocation();
    }
    const response = await fetch(groceryPlacesApiUrl({
      action: "restaurant-autocomplete",
      input: query,
      sessionToken: restaurantSearchSessionToken,
      ...(getGroceryStoreSearchLocation() || {})
    }), groceryPlacesRequestOptions());
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Restaurant search is unavailable.");
    if (elements.restaurantSearchInput.value.trim() !== query) return;
    setRestaurantSearchSuggestions(Array.isArray(body.suggestions) ? body.suggestions : []);
    renderRestaurantSuggestions();
    const locationNote = !getGroceryStoreSearchLocation() ? " (Enable location sharing for local results.)" : "";
    elements.restaurantSearchStatus.textContent = getRestaurantSearchSuggestions().length
      ? `Choose a restaurant below.${locationNote}`
      : "No matching restaurants found. Try a different name.";
  } catch (error) {
    setRestaurantSearchSuggestions([]);
    renderRestaurantSuggestions();
    elements.restaurantSearchStatus.textContent = error.message || "Search unavailable.";
  }
}

function renderRestaurantSuggestions() {
  const el = elements.restaurantSearchSuggestionsEl;
  el.hidden = !getRestaurantSearchSuggestions().length;
  el.innerHTML = getRestaurantSearchSuggestions().length ? `
    ${getRestaurantSearchSuggestions().map((s) => `
      <button type="button" role="option" data-restaurant-place="${escapeHtml(s.placeId)}">
        <strong>${escapeHtml(s.name)}</strong>
        <small>${escapeHtml(s.address || "")}</small>
      </button>
    `).join("")}
    <div class="grocery-store-google-attribution">
      <img src="https://storage.googleapis.com/geo-devrel-public-buckets/powered_by_google_on_white.png" alt="Powered by Google" />
    </div>
  ` : "";
  el.querySelectorAll("[data-restaurant-place]").forEach((btn) => {
    btn.addEventListener("click", () => selectRestaurantForMeal(btn.dataset.restaurantPlace));
  });
}

async function selectRestaurantForMeal(placeId) {
  const suggestion = getRestaurantSearchSuggestions().find((s) => s.placeId === placeId);
  if (!suggestion || !getRestaurantSearchPending()) return;
  elements.restaurantSearchStatus.textContent = "Linking restaurant…";
  elements.restaurantSearchInput.disabled = true;
  try {
    const response = await fetch(groceryPlacesApiUrl({
      action: "restaurant-details",
      placeId,
      name: suggestion.name,
      sessionToken: restaurantSearchSessionToken
    }), groceryPlacesRequestOptions());
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Restaurant details could not be fetched.");
    const r = body.restaurant;
    if (!r?.name) throw new Error("Restaurant details could not be loaded.");
    const { day, meal, index } = getRestaurantSearchPending();
    const week = weekState();
    const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
    const specialMeal = specialMealForSlot(entries[index]);
    if (specialMeal) {
      entries[index] = specialMealSlotId(specialMeal.type, r.name, {
        name: r.name,
        placeId: r.placeId,
        address: r.address,
        websiteUri: r.websiteUri || "",
        googleMapsUri: r.googleMapsUri || ""
      });
      setMeal(day, meal, compactMealSlotEntries(entries, meal));
    }
    elements.restaurantSearchDialog.close();
  } catch (error) {
    elements.restaurantSearchStatus.textContent = error.message || "Could not link restaurant.";
  } finally {
    elements.restaurantSearchInput.disabled = false;
  }
}

function clearMealRestaurant(day, meal, index) {
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
  const specialMeal = specialMealForSlot(entries[index]);
  if (!specialMeal) return;
  entries[index] = specialMealSlotId(specialMeal.type, specialMeal.note);
  setMeal(day, meal, compactMealSlotEntries(entries, meal));
}

function renderMealRestaurantArea(restaurant, day, meal, index) {
  if (restaurant?.placeId) {
    const mapsUrl = restaurant.googleMapsUri || storeDirectionsUrl(restaurant);
    return `
      <div class="meal-restaurant-bar">
        <svg class="meal-restaurant-pin-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <span class="meal-restaurant-bar-name">${escapeHtml(restaurant.name)}</span>
        ${mapsUrl ? `<a class="meal-restaurant-bar-link" href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer" title="Get directions">Directions</a>` : ""}
        ${restaurant.websiteUri ? `<a class="meal-restaurant-bar-link" href="${escapeHtml(restaurant.websiteUri)}" target="_blank" rel="noopener noreferrer" title="Restaurant website / menu">Menu</a>` : ""}
        <button class="meal-restaurant-unlink-btn" type="button" data-unlink-restaurant data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Unlink restaurant" aria-label="Unlink restaurant">×</button>
      </div>
    `;
  }
  return "";
}

function saveMealPlanMembers() {
  const rows = elements.familyMembersDialog.querySelectorAll("[data-member-row]");
  const newMembers = [];
  rows.forEach(row => {
    const id = row.dataset.memberId;
    const linkedUserId = row.dataset.memberLinkedUserId || null;
    const label = (row.querySelector("input[type='text']")?.value || "").trim();
    const dob = (row.querySelector("[data-member-dob]")?.value || "").trim();
    if (label) newMembers.push({ id, label, dob, linkedUserId: linkedUserId || null });
  });
  if (!newMembers.length) { alert("At least one family member is required."); return; }
  const oldConfig = normalizeMealPlanConfig(state.mealPlanConfig);
  state.mealPlanConfig = normalizeMealPlanConfig({ ...state.mealPlanConfig, members: newMembers });
  const newConfig = normalizeMealPlanConfig(state.mealPlanConfig);
  recomputeMealPlanLayout();
  applyMealPlanConfigChange(oldConfig, newConfig);
  persist();
  render();
  if (getActiveAppArea() === "home") setPageTitle(getAppName());
  elements.familyMembersDialog.close();
}

function openMealPlanSettingsDialog() {
  closeSettingsMenu();
  renderMealTypesList();
  elements.mealPlanSettingsDialog.showModal();
}

function renderMealTypesList() {
  const config = normalizeMealPlanConfig(state.mealPlanConfig);
  const list = elements.mealPlanSettingsDialog.querySelector("[data-mealtypes-list]");
  list.innerHTML = config.mealTypes.map(t => `
    <div class="config-row" data-mealtype-row data-mealtype-id="${escapeHtml(t.id)}">
      <span class="drag-handle" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M9 5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-6 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-6 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>
      </span>
      <input type="text" class="config-input" value="${escapeHtml(t.label)}" placeholder="Meal type" />
      <button type="button" class="icon-btn config-remove-btn" data-remove-mealtype aria-label="Remove">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  `).join("");
  list.querySelectorAll("[data-remove-mealtype]").forEach(btn => {
    btn.addEventListener("click", () => btn.closest("[data-mealtype-row]").remove());
  });
  bindConfigListDrag(list, "[data-mealtype-row]");
}

function addMealType() {
  const list = elements.mealPlanSettingsDialog.querySelector("[data-mealtypes-list]");
  const id = createId("mealtype");
  const div = document.createElement("div");
  div.className = "config-row";
  div.setAttribute("data-mealtype-row", "");
  div.setAttribute("data-mealtype-id", id);
  div.setAttribute("draggable", "true");
  div.innerHTML = `
    <span class="drag-handle" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M9 5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-6 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-6 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>
    </span>
    <input type="text" class="config-input" value="" placeholder="Meal type" />
    <button type="button" class="icon-btn config-remove-btn" data-remove-mealtype aria-label="Remove">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
  `;
  div.querySelector("[data-remove-mealtype]").addEventListener("click", () => div.remove());
  list.appendChild(div);
  bindConfigListDrag(list, "[data-mealtype-row]");
  div.querySelector("input").focus();
}

function saveMealPlanMealTypes() {
  const rows = elements.mealPlanSettingsDialog.querySelectorAll("[data-mealtype-row]");
  const newTypes = [];
  rows.forEach(row => {
    const id = row.dataset.mealtypeId;
    const label = row.querySelector("input").value.trim();
    if (label) newTypes.push({ id, label });
  });
  if (!newTypes.length) { alert("At least one meal type is required."); return; }
  const oldConfig = normalizeMealPlanConfig(state.mealPlanConfig);
  state.mealPlanConfig = normalizeMealPlanConfig({ ...state.mealPlanConfig, mealTypes: newTypes });
  const newConfig = normalizeMealPlanConfig(state.mealPlanConfig);
  recomputeMealPlanLayout();
  applyMealPlanConfigChange(oldConfig, newConfig);
  persist();
  render();
  elements.mealPlanSettingsDialog.close();
}

function applyMealPlanConfigChange(oldConfig, newConfig) {
  const renameMap = {};
  oldConfig.mealTypes.forEach(oldType => {
    const newType = newConfig.mealTypes.find(t => t.id === oldType.id);
    const newTypeLabel = newType?.label || oldType.label;
    oldConfig.members.forEach(oldMember => {
      const newMember = newConfig.members.find(m => m.id === oldMember.id);
      const newMemberLabel = newMember?.label || oldMember.label;
      const oldKey = `${oldMember.label} ${oldType.label}`;
      const newKey = `${newMemberLabel} ${newTypeLabel}`;
      if (oldKey !== newKey) renameMap[oldKey] = newKey;
    });
  });

  const validNewKeys = new Set(
    newConfig.members.flatMap(m => newConfig.mealTypes.map(t => `${m.label} ${t.label}`))
  );
  const oldKeys = new Set(
    oldConfig.members.flatMap(m => oldConfig.mealTypes.map(t => `${m.label} ${t.label}`))
  );

  Object.values(state.plans || {}).forEach(week => {
    if (!week?.slots) return;
    Object.keys(week.slots).forEach(dayId => {
      const daySlots = week.slots[dayId];
      const keysToProcess = Object.keys(daySlots).filter(k => oldKeys.has(k));
      keysToProcess.forEach(oldKey => {
        const entries = daySlots[oldKey];
        delete daySlots[oldKey];
        const newKey = renameMap[oldKey] || oldKey;
        if (validNewKeys.has(newKey) && entries) {
          daySlots[newKey] = entries;
        }
      });
    });
    if (week.combinedMealSections) week.combinedMealSections = {};
    if (week.publishedCombinedMealSections) week.publishedCombinedMealSections = {};
  });

  state.autoGenerateRules = (state.autoGenerateRules || []).map(rule => ({
    ...rule,
    meal: renameMap[rule.meal] || rule.meal
  })).filter(rule => autoRuleMealKeys.includes(rule.meal) || Object.keys(combinedMealSections).includes(rule.meal));
}

function missingRestoreAutoRules(backupState) {
  if (!Array.isArray(backupState?.autoGenerateRules) || !backupState.autoGenerateRules.length) return [];
  const current = new Set(normalizeAutoGenerateRules(state.autoGenerateRules).map(autoRuleSignature));
  return normalizeAutoGenerateRules(backupState?.autoGenerateRules).filter((rule) => !current.has(autoRuleSignature(rule)));
}

function autoRuleSignature(rule) {
  return [
    [...(rule.dayIds || [])].sort().join(","),
    rule.meal,
    rule.index,
    rule.action,
    normalize(rule.value || ""),
    normalizeRecipeTagSelection(rule.tags).map(normalize).join(","),
    rule.tagMatchMode || "any",
    rule.selectionMode || "random"
  ].join("|");
}

function collapseAllPlannerDays() {
  setActivePlannerDayId(prepDays[0].id);
}

function renderPlanner() {
  const previousCarouselState = currentPlannerCarouselState();
  const week = weekState();
  const activeDay = ensureActivePlannerDay();
  const visibleSlots = mealSlotsForWeek(week);
  const combinedState = combinedMealSectionsForWeek(week);
  const mealPlanColumns = mealColumnConfigs
    .map((column) => {
      const slotsHtml = columnMealsForDay(activeDay, column, combinedState).filter(Boolean).map((meal) => (
        slotTemplate(activeDay, meal, visibleSlots?.[activeDay.id]?.[meal] || "", {
          displayMeal: displayMealName(meal),
          combined: isCombinedMealKey(meal)
        })
      )).join("");
      // One context card per column (Breakfast/Lunch/Dinner), above its meal(s) —
      // never per person, even when the column is split into individual meals.
      const columnHtml = slotsHtml.trim() ? mealContextCardTemplate(activeDay, column) + slotsHtml : "";
      return { column, html: columnHtml };
    })
    .filter((column) => column.html.trim());
  const mealPlanColumnCount = Math.max(1, mealPlanColumns.length);

  elements.plannerGrid.innerHTML = `
    <div class="eat-top-row">
    <div class="day-tabs" role="tablist" aria-label="Meal plan days">
      ${prepDays.map((day) => {
        const date = addDays(getCurrentWeek(), day.offset);
        const isActive = day.id === activeDay.id;
        const calendarEventsForDay = syncedCalendarEventsForDate(date);
        const eventClass = calendarEventsForDay.length ? "has-synced-calendar" : "";
        const eventStyle = calendarEventsForDay.length ? ` style="${escapeHtml(calendarTabStyle(calendarEventsForDay))}"` : "";
        const tabLabel = `${day.name} ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
        const longDateLabel = date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
        const shortDateLabel = date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
        return `
          <button class="day-tab ${eventClass} ${isActive ? "is-active" : ""}" type="button" role="tab" id="tab-${day.id}" data-day-tab="${day.id}" aria-selected="${isActive ? "true" : "false"}" aria-controls="panel-${day.id}" title="${escapeHtml(tabLabel)}"${eventStyle}>
            <span class="day-tab-day day-tab-full">${escapeHtml(day.name)}</span>
            <span class="day-tab-day day-tab-short">${escapeHtml(day.name.slice(0, 3))}</span>
            <span class="day-tab-day day-tab-compact">${escapeHtml(compactDayLabel(day))}</span>
            <strong class="day-tab-date day-tab-date-long">${escapeHtml(longDateLabel)}</strong>
            <strong class="day-tab-date day-tab-date-short">${escapeHtml(shortDateLabel)}</strong>
          </button>
        `;
      }).join("")}
    </div>
    ${mealPlanNotifBellHtml()}
    </div>
    <section class="day-column planner-day-panel" role="tabpanel" id="panel-${activeDay.id}" aria-labelledby="tab-${activeDay.id}">
      ${activeDayEventsTemplate(activeDay)}
      <div class="day-slots-carousel" style="--meal-column-count: ${mealPlanColumnCount};" aria-label="${escapeHtml(activeDay.name)} meals">
        ${mealPlanColumns.map(({ html }) => `
          <div class="meal-plan-column">
            ${html}
          </div>
        `).join("")}
      </div>
      <div class="meal-plan-publish-row">
        <div class="meal-plan-page-actions">
          <div class="meal-plan-btns-left">
            <button class="secondary-btn planner-page-btn" type="button" data-open-recipe-box-page title="Recipe Book" aria-label="Recipe Book">
              ${ldeIcon("recipeBook", { size: 20, cls: "planner-icon" })}
            </button>
            <button class="secondary-btn planner-page-btn" type="button" data-open-groceries-page title="Groceries" aria-label="Groceries">
              ${ldeIcon("groceryList", { size: 20, cls: "planner-icon" })}
            </button>
          </div>
          <div class="meal-plan-btns-right">
            <button class="secondary-btn planner-page-btn" type="button" data-open-daily-dozen-page title="Nutrition" aria-label="Nutrition">
              ${ldeIcon("nutrition", { size: 20, cls: "planner-icon" })}
            </button>
            <button class="primary-btn icon-primary-btn planner-page-btn" type="button" data-open-meal-autofill title="Auto-fill" aria-label="Auto-fill">
              ${ldeIcon("autoGenerate", { size: 20, cls: "planner-icon" })}
            </button>
          </div>
        </div>
      </div>
    </section>
  `;

  elements.plannerGrid.querySelectorAll("[data-day-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      if (suppressNextDayTabClickId === button.dataset.dayTab) {
        suppressNextDayTabClickId = "";
        return;
      }
      selectPlannerDay(button.dataset.dayTab);
    });
    button.addEventListener("contextmenu", (event) => openMealPlanContextMenu(event, "day", button.dataset.dayTab));
    button.addEventListener("pointerdown", (event) => startMealPlanContextPress(event, "day", button.dataset.dayTab));
    button.addEventListener("pointermove", handleMealPlanContextPressMove);
    button.addEventListener("pointerup", cancelMealPlanContextPress);
    button.addEventListener("pointercancel", cancelMealPlanContextPress);
    button.addEventListener("dragover", handleMealDayTabDragOver);
    button.addEventListener("dragleave", () => button.classList.remove("meal-day-drop-over"));
    button.addEventListener("drop", handleMealDayTabDrop);
  });

  elements.plannerGrid.querySelectorAll("[data-meal-input]").forEach((input) => {
    input.addEventListener("change", () => commitMealInput(input));
    input.addEventListener("blur", () => commitMealInput(input));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
  });

  elements.plannerGrid.querySelectorAll("[data-edit-meal-entry]").forEach((button) => {
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.clearTimeout(mealEntryClickTimer);
      openMealEntryEditor(button.dataset.day, button.dataset.meal, Number(button.dataset.index));
    });
  });

  elements.plannerGrid.querySelectorAll("[data-add-meal-entry]").forEach((button) => {
    button.addEventListener("click", () => addMealEntry(button.dataset.day, button.dataset.meal));
  });

  elements.plannerGrid.querySelectorAll("[data-pick-meal-entry]").forEach((button) => {
    button.addEventListener("click", () => openMealRecipePicker(button.dataset.day, button.dataset.meal, Number(button.dataset.index)));
  });

  elements.plannerGrid.querySelectorAll("[data-pick-ingredient-entry]").forEach((button) => {
    button.addEventListener("click", () => openMealIngredientPicker(button.dataset.day, button.dataset.meal, Number(button.dataset.index)));
  });

  elements.plannerGrid.querySelectorAll("[data-special-meal-choice]").forEach((button) => {
    button.addEventListener("click", () => setSpecialMealEntry(button.dataset.day, button.dataset.meal, Number(button.dataset.index), button.dataset.specialMealChoice));
  });

  elements.plannerGrid.querySelectorAll("[data-empty-meal-entry]").forEach((entry) => {
    entry.addEventListener("contextmenu", openEmptyMealEntryMenu);
  });

  elements.plannerGrid.querySelectorAll("[data-special-meal-note]").forEach((input) => {
    input.addEventListener("change", () => updateSpecialMealNote(input));
    input.addEventListener("blur", () => updateSpecialMealNote(input));
  });

  elements.plannerGrid.querySelectorAll("[data-meal-context-toggle]").forEach((button) => {
    button.addEventListener("click", () => toggleMealContext(button.dataset.day, button.dataset.meal));
  });

  elements.plannerGrid.querySelectorAll("[data-meal-note]").forEach((textarea) => {
    autosizeMealNote(textarea);
    textarea.addEventListener("input", () => autosizeMealNote(textarea));
    textarea.addEventListener("change", () => setMealNote(textarea.dataset.day, textarea.dataset.meal, textarea.value));
    textarea.addEventListener("blur", () => setMealNote(textarea.dataset.day, textarea.dataset.meal, textarea.value));
  });

  elements.plannerGrid.querySelectorAll("[data-meal-event-id]").forEach((button) => {
    button.addEventListener("click", () => openPlanEventDialog(button.dataset.mealEventDate || null, button.dataset.mealEventId));
  });

  elements.plannerGrid.querySelectorAll("[data-link-restaurant]").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); openRestaurantSearchDialog(btn.dataset.day, btn.dataset.meal, Number(btn.dataset.index)); });
  });

  elements.plannerGrid.querySelectorAll("[data-unlink-restaurant]").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); clearMealRestaurant(btn.dataset.day, btn.dataset.meal, Number(btn.dataset.index)); });
  });

  elements.plannerGrid.querySelectorAll("[data-show-restaurant-info]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const week = weekState();
      const { day, meal } = btn.dataset;
      const index = Number(btn.dataset.index);
      const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
      const specialMeal = specialMealForSlot(entries[index]);
      if (specialMeal?.restaurant) {
        openRestaurantInfoPopover(specialMeal.restaurant, day, meal, index, btn);
      }
    });
  });

  elements.plannerGrid.querySelectorAll("[data-planned-servings]").forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.addEventListener("change", () => updateMealPlannedServings(input));
    input.addEventListener("blur", () => updateMealPlannedServings(input));
  });

  elements.plannerGrid.querySelectorAll("[data-generate-meal-section]").forEach((button) => {
    button.addEventListener("click", () => autoGenerateMealSection(button.dataset.day, button.dataset.meal));
  });

  elements.plannerGrid.querySelectorAll("[data-clear-meal-section]").forEach((button) => {
    button.addEventListener("click", () => clearMealSection(button.dataset.day, button.dataset.meal));
  });

  elements.plannerGrid.querySelectorAll("[data-remove-meal-entry]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeMealEntry(button.dataset.day, button.dataset.meal, Number(button.dataset.index));
    });
  });

  elements.plannerGrid.querySelectorAll("[data-view-recipe]").forEach((button) => {
    button.addEventListener("click", (event) => {
      if (suppressMealEntryClick) return;
      if (event.detail > 1) return;
      window.clearTimeout(mealEntryClickTimer);
      mealEntryClickTimer = window.setTimeout(() => {
        if (!suppressMealEntryClick) {
          const mealContext = button.dataset.day
            ? { day: button.dataset.day, meal: button.dataset.meal, index: Number(button.dataset.index) }
            : null;
          openRecipeView(button.dataset.viewRecipe, mealContext);
        }
      }, 300);
    });
  });

  elements.plannerGrid.querySelectorAll("[data-open-recipe-box-page]").forEach((button) => {
    button.addEventListener("click", openRecipeBoxPage);
  });

  elements.plannerGrid.querySelectorAll("[data-open-groceries-page]").forEach((button) => {
    button.addEventListener("click", openGroceriesPage);
  });

  elements.plannerGrid.querySelectorAll("[data-open-daily-dozen-page]").forEach((button) => {
    button.addEventListener("click", () => openDailyDozenPage());
  });

  elements.plannerGrid.querySelector("[data-open-meal-autofill]")?.addEventListener("click", () => {
    elements.mealAutoFillDialog.showModal();
  });

  elements.plannerGrid.querySelectorAll("[data-meal-entry]").forEach((entry) => {
    entry.addEventListener("contextmenu", openMealEntryMenu);
  });
  // Meal entries — shared sortable primitive in COMBINED grouped + move mode:
  //  • reorder within a slot / move between slots  → onGroupedDrop (index-based:
  //    reorderMealEntry same-slot, moveMealEntryToSlot cross-slot)
  //  • drop onto a day-tab                          → onDropZone (moveMealEntryToDay)
  // Replaces the old HTML5 DnD + bespoke touch pointer path. Bound once (delegated).
  if (!elements.plannerGrid.__sortableBound) {
    elements.plannerGrid.__sortableBound = true;
    makeSortable(elements.plannerGrid, {
      rowSelector: "[data-meal-entry]",
      getId: (e) => `${e.dataset.day}:${e.dataset.meal}:${e.dataset.index}`,
      groupSelector: "[data-meal-slot]",
      dropZoneSelector: "[data-day-tab]",
      onGroupedDrop: ({ row, toContainer }) => {
        const source = { day: row.dataset.day, meal: row.dataset.meal, index: Number(row.dataset.index) };
        const targetDay = toContainer.dataset.day, targetMeal = toContainer.dataset.meal;
        const targetIndex = [...toContainer.querySelectorAll("[data-meal-entry]")].indexOf(row);
        if (targetDay === source.day && targetMeal === source.meal) reorderMealEntry(source.day, source.meal, source.index, targetIndex);
        else moveMealEntryToSlot(source, targetDay, targetMeal, targetIndex);
      },
      onDropZone: ({ row, zone }) => {
        const source = { day: row.dataset.day, meal: row.dataset.meal, index: Number(row.dataset.index) };
        const targetDay = zone.dataset.dayTab;
        if (targetDay && mealForDayTabDrop(source.meal, targetDay)) moveMealEntryToDay(source, targetDay);
      },
      itemLabel: (e) => (e.textContent || "meal").trim().slice(0, 40),
    });
  }

  elements.plannerGrid.querySelectorAll("[data-meal-slot]").forEach((slot) => {
    slot.addEventListener("dragover", handleMealSlotDragOver);
    slot.addEventListener("dragleave", () => slot.classList.remove("drag-over"));
    slot.addEventListener("drop", handleMealSlotDrop);
    slot.addEventListener("contextmenu", openMealSlotMenu);
  });

  elements.plannerGrid.querySelectorAll("[data-meal-section-drag]").forEach((handle) => {
    handle.addEventListener("dragstart", handleMealSectionDragStart);
    handle.addEventListener("dragend", clearMealSectionDragState);
  });

  elements.plannerGrid.querySelectorAll("[data-meal-section-target]").forEach((slot) => {
    slot.addEventListener("dragover", handleMealSectionDragOver);
    slot.addEventListener("dragleave", () => slot.classList.remove("section-drag-over"));
    slot.addEventListener("drop", handleMealSectionDrop);
  });

  restorePlannerCarouselState(previousCarouselState, activeDay.id);
  updateTabIndicator(elements.plannerGrid);
  wireMealPlanNotifDelegation();
  if (getMealPlanNotifOpen()) { positionMealPlanNotifPanel(); restoreMealPlanSwipeScroll(); }
}

function currentPlannerCarouselState() {
  const panel = elements.plannerGrid.querySelector(".planner-day-panel");
  const carousel = elements.plannerGrid.querySelector(".day-slots-carousel");
  return {
    dayId: panel?.id?.replace(/^panel-/, "") || "",
    scrollLeft: carousel?.scrollLeft || 0
  };
}

function restorePlannerCarouselState(previousState, activeDayId) {
  if (!previousState?.dayId || previousState.dayId !== activeDayId) return;
  const carousel = elements.plannerGrid.querySelector(".day-slots-carousel");
  if (!carousel) return;
  window.requestAnimationFrame(() => {
    carousel.scrollLeft = previousState.scrollLeft;
  });
}

function mealNoteValue(dayId, meal) {
  return weekState().mealNotes?.[dayId]?.[meal] || "";
}

function setMealNote(dayId, meal, text) {
  const week = weekState();
  if (!week.mealNotes) week.mealNotes = {};
  if (!week.mealNotes[dayId]) week.mealNotes[dayId] = {};
  const value = String(text || "");
  if (value.trim()) week.mealNotes[dayId][meal] = value;
  else {
    delete week.mealNotes[dayId][meal];
    if (!Object.keys(week.mealNotes[dayId]).length) delete week.mealNotes[dayId];
  }
  persist();
}

function eventCoversMeal(event, meal) {
  const win = MEAL_TIME_WINDOWS[meal];
  if (!win) return false;
  if (event.allDay || !event.startTime) return true;
  const start = minutesOfDay(event.startTime);
  if (start == null) return true;
  const end = minutesOfDay(event.endTime);
  const eEnd = (end != null && end > start) ? end : start;
  // A point (no real end) covers the window containing it; a span overlaps any
  // window it intersects.
  if (eEnd === start) return start >= win[0] && start < win[1];
  return start < win[1] && eEnd > win[0];
}

function mealContextEvents(dateKey, meal) {
  return (state.planEvents || [])
    .filter((e) => e.showInMealPlan && planEventOccursOn(e, dateKey) && eventCoversMeal(e, meal))
    .sort((a, b) => String(a.startTime || "").localeCompare(String(b.startTime || "")));
}

function autosizeMealNote(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function mealContextCardTemplate(day, column) {
  // Keyed by the column (Breakfast/Lunch/Dinner) so a single card serves the
  // whole meal, independent of any per-person split.
  const key = column.label;
  const ctxKey = `${day.id}|${key}`;
  const expanded = expandedMealContext.has(ctxKey);
  const dateKey = dateKeyFromDate(addDays(getCurrentWeek(), day.offset));
  const note = mealNoteValue(day.id, key);
  const events = mealContextEvents(dateKey, key);
  const chips = events.map((e) => {
    const color = e.color || PLAN_COLORS[0];
    return `<button type="button" class="meal-context-event" data-meal-event-id="${escapeHtml(e.id)}" data-meal-event-date="${escapeHtml(dateKey)}" title="Edit event">
        <span class="meal-context-event-dot" style="background:${escapeHtml(color)}"></span>
        <span class="meal-context-event-title">${escapeHtml(e.title)}</span>
      </button>`;
  }).join("");
  // A quiet summary on the collapsed header hints at what's inside.
  const summaryParts = [];
  if (events.length) summaryParts.push(`${events.length} event${events.length > 1 ? "s" : ""}`);
  if (note.trim()) summaryParts.push("note");
  const summary = summaryParts.join(" · ");
  return `
    <div class="meal-context-card${expanded ? " is-expanded" : ""}" data-meal-context data-day="${day.id}" data-meal="${escapeHtml(key)}">
      <button type="button" class="meal-context-toggle" data-meal-context-toggle data-day="${day.id}" data-meal="${escapeHtml(key)}" aria-expanded="${expanded}">
        <span class="slot-label meal-context-label">Events &amp; Notes</span>
        ${summary ? `<span class="meal-context-summary">${escapeHtml(summary)}</span>` : ""}
        <svg class="meal-context-chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="meal-context-body">
        ${events.length ? `<div class="meal-context-events">${chips}</div>` : ""}
        <textarea class="meal-context-note" data-meal-note data-day="${day.id}" data-meal="${escapeHtml(key)}" rows="1" placeholder="Add notes…" aria-label="Notes for ${escapeHtml(key)}">${escapeHtml(note)}</textarea>
      </div>
    </div>
  `;
}

function toggleMealContext(dayId, key) {
  const ctxKey = `${dayId}|${key}`;
  const card = elements.plannerGrid.querySelector(`.meal-context-card[data-day="${CSS.escape(dayId)}"][data-meal="${CSS.escape(key)}"]`);
  const expand = !expandedMealContext.has(ctxKey);
  if (expand) expandedMealContext.add(ctxKey);
  else expandedMealContext.delete(ctxKey);
  if (!card) return;
  card.classList.toggle("is-expanded", expand);
  card.querySelector("[data-meal-context-toggle]")?.setAttribute("aria-expanded", String(expand));
  if (expand) {
    const textarea = card.querySelector("[data-meal-note]");
    if (textarea) autosizeMealNote(textarea);
  }
}

function renderAutoRules() {
  state.autoGenerateRules = normalizeAutoGenerateRules(state.autoGenerateRules);
  if (!elements.autoRuleList) return;
  renderAutoRuleOptions();
  const activeDay = ensureActiveAutoRuleDay();
  const autoRuleColumns = mealColumnConfigs
    .map((column) => {
      const columnHtml = autoRuleColumnMealsForDay(activeDay, column).filter(Boolean).map((meal) => (
        autoRuleSlotTemplate(activeDay, meal, displayMealName(meal))
      )).join("");
      return { column, html: columnHtml };
    })
    .filter((column) => column.html.trim());
  const autoRuleColumnCount = Math.max(1, autoRuleColumns.length);
  elements.autoRuleList.innerHTML = `
    <div class="day-tabs auto-rule-tabs" role="tablist" aria-label="Auto-fill rule days">
      ${prepDays.map((day) => autoRuleDayTabTemplate(day, activeDay)).join("")}
    </div>
    <section class="day-column planner-day-panel auto-rule-day-panel" role="tabpanel" id="auto-rule-panel-${activeDay.id}" aria-labelledby="auto-rule-tab-${activeDay.id}">
      <div class="day-slots-carousel" style="--meal-column-count: ${autoRuleColumnCount};" aria-label="${escapeHtml(activeDay.name)} auto-fill rules">
        ${autoRuleColumns.map(({ html }) => `
          <div class="meal-plan-column">
            ${html}
          </div>
        `).join("")}
      </div>
    </section>
  `;

  elements.autoRuleList.querySelectorAll("[data-auto-rule-day-tab]").forEach((button) => {
    button.addEventListener("click", () => selectAutoRuleDay(button.dataset.autoRuleDayTab));
  });

  elements.autoRuleList.querySelectorAll("[data-auto-slot-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ok = toggleAutoSlot(btn.dataset.day, btn.dataset.meal);
      if (!ok) {
        btn.classList.add("shake");
        setTimeout(() => btn.classList.remove("shake"), 400);
      }
    });
  });

  elements.autoRuleList.querySelectorAll("[data-auto-rule-input]").forEach((input) => {
    input.addEventListener("change", () => commitAutoRuleInput(input));
    input.addEventListener("blur", () => commitAutoRuleInput(input));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
  });

  elements.autoRuleList.querySelectorAll("[data-clear-auto-rule]").forEach((button) => {
    button.addEventListener("click", () => clearAutoRule(button.dataset.day, button.dataset.meal, Number(button.dataset.index)));
  });

  elements.autoRuleList.querySelectorAll("[data-pick-auto-rule-recipe]").forEach((button) => {
    button.addEventListener("click", () => {
      if (suppressAutoRuleClick) return;
      openAutoRuleRecipePicker(button.dataset.day, button.dataset.meal, Number(button.dataset.index));
    });
  });

  elements.autoRuleList.querySelectorAll("[data-pick-auto-rule-ingredient]").forEach((button) => {
    button.addEventListener("click", () => {
      if (suppressAutoRuleClick) return;
      openAutoRuleIngredientPicker(button.dataset.day, button.dataset.meal, Number(button.dataset.index));
    });
  });

  elements.autoRuleList.querySelectorAll("[data-create-tag-auto-rule]").forEach((button) => {
    button.addEventListener("click", () => createTagAutoRule(button.dataset.day, button.dataset.meal, Number(button.dataset.index)));
  });

  elements.autoRuleList.querySelectorAll("[data-auto-rule-match-mode]").forEach((select) => {
    select.addEventListener("change", () => updateTagAutoRule(select.dataset.day, select.dataset.meal, Number(select.dataset.index), (rule) => {
      rule.tagMatchMode = select.value === "all" ? "all" : "any";
    }));
  });

  elements.autoRuleList.querySelectorAll("[data-auto-rule-selection-mode]").forEach((select) => {
    select.addEventListener("change", () => updateTagAutoRule(select.dataset.day, select.dataset.meal, Number(select.dataset.index), (rule) => {
      rule.selectionMode = select.value === "leastRecent" ? "leastRecent" : "random";
    }));
  });

  elements.autoRuleList.querySelectorAll("[data-add-auto-rule-tag]").forEach((select) => {
    select.addEventListener("change", () => {
      const tag = select.value;
      if (!tag) return;
      updateTagAutoRule(select.dataset.day, select.dataset.meal, Number(select.dataset.index), (rule) => {
        rule.tags = normalizeRecipeTagSelection([...(rule.tags || []), tag]);
      });
    });
  });

  elements.autoRuleList.querySelectorAll("[data-remove-auto-rule-tag]").forEach((button) => {
    button.addEventListener("click", () => updateTagAutoRule(button.dataset.day, button.dataset.meal, Number(button.dataset.index), (rule) => {
      rule.tags = normalizeRecipeTagSelection(rule.tags).filter((tag) => normalize(tag) !== normalize(button.dataset.removeAutoRuleTag));
    }));
  });

  elements.autoRuleList.querySelectorAll("[data-create-leftovers-auto-rule]").forEach((button) => {
    button.addEventListener("click", () => setAutoRuleFromValue(button.dataset.day, button.dataset.meal, Number(button.dataset.index), "leftovers"));
  });

  elements.autoRuleList.querySelectorAll("[data-add-auto-rule]").forEach((button) => {
    button.addEventListener("click", () => {
      if (suppressAutoRuleClick) return;
      addAutoRuleSlot(button.dataset.day, button.dataset.meal);
    });
  });

  elements.autoRuleList.querySelectorAll("[data-auto-rule-entry][draggable='true']").forEach((entry) => {
    entry.addEventListener("dragstart", handleAutoRuleDragStart);
    entry.addEventListener("drag", handleAutoRuleDrag);
    entry.addEventListener("dragend", handleAutoRuleDragEnd);
    entry.addEventListener("pointerdown", handleAutoRulePointerDown);
    entry.addEventListener("pointermove", handleAutoRulePointerMove);
    entry.addEventListener("pointerup", handleAutoRulePointerEnd);
    entry.addEventListener("pointercancel", handleAutoRulePointerEnd);
    entry.addEventListener("mousedown", handleAutoRuleMouseDown);
    entry.addEventListener("contextmenu", openAutoRuleEntryMenu);
  });

  elements.autoRuleList.querySelectorAll("[data-remove-auto-rule]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeAutoRuleSlot(button.dataset.day, button.dataset.meal, Number(button.dataset.index));
    });
  });
}

function renderAutoRuleOptions() {
  if (!elements.autoRuleOptions) return;
  elements.autoRuleOptions.innerHTML = [
    `<option value="Do not fill"></option>`,
    ...recipeTags().map((tag) => `<option value="Tag: ${escapeHtml(tag)}"></option>`),
    ...activeRecipes()
      .filter((recipe) => recipe.name)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((recipe) => `<option value="${escapeHtml(recipe.name)}"></option>`),
    ...mealPlanCustomOptions.map((option) => `<option value="${escapeHtml(option)}"></option>`)
  ].join("");
}

function autoRuleDayTabTemplate(day, activeDay) {
  const isActive = day.id === activeDay.id;
  return `
    <button class="day-tab auto-rule-day-tab ${isActive ? "is-active" : ""}" type="button" role="tab" id="auto-rule-tab-${day.id}" data-auto-rule-day-tab="${day.id}" aria-selected="${isActive ? "true" : "false"}" aria-controls="auto-rule-panel-${day.id}" title="${escapeHtml(day.name)}">
      <span class="day-tab-day day-tab-full">${escapeHtml(day.name)}</span>
      <span class="day-tab-day day-tab-short">${escapeHtml(day.name.slice(0, 3))}</span>
      <span class="day-tab-day day-tab-compact">${escapeHtml(compactDayLabel(day))}</span>
    </button>
  `;
}

function autoRuleColumnMealsForDay(day, column) {
  const visibleMeals = column.meals.filter((meal) => day.meals.includes(meal));
  if (!column.combinedMeal) return visibleMeals;
  const group = combinedMealSections[column.combinedMeal];
  const hasMembers = group.members.some((meal) => day.meals.includes(meal));
  return hasMembers ? [column.combinedMeal, ...visibleMeals] : visibleMeals;
}

function autoRuleSlotTemplate(day, meal, displayMeal = meal) {
  const entries = Array.from({ length: autoRuleEntryCount(day.id, meal) }, (_item, index) => index);
  const hasOpenEntry = entries.some((index) => !autoRuleInputValue(autoGenerateRuleForSlot(day, meal, index)));
  const hasSkipRule = entries.some((index) => autoGenerateRuleForSlot(day, meal, index)?.action === "skip");
  const addDisabled = hasOpenEntry || hasSkipRule;
  const addTitle = hasSkipRule
    ? "Remove Do not fill before adding another rule"
    : hasOpenEntry
      ? "Fill the open slot before adding another rule"
      : "Add another rule slot";
  const isEnabled = isAutoSlotEnabled(day.id, meal);
  const toggleTitle = isEnabled
    ? "Auto-fill active — click to disable for this day"
    : "Auto-fill disabled — click to enable for this day";
  return `
    <div class="slot-card auto-rule-slot meal-${mealToken(meal)} ${isEnabled ? "" : "is-slot-disabled"}">
      <div class="slot-topline">
        <button class="auto-slot-toggle" type="button" data-auto-slot-toggle data-day="${day.id}" data-meal="${escapeHtml(meal)}" aria-pressed="${String(isEnabled)}" title="${escapeHtml(toggleTitle)}" aria-label="${escapeHtml(toggleTitle)}">
          <span class="auto-slot-toggle-thumb"></span>
        </button>
        <div class="slot-label">${escapeHtml(displayMeal)}</div>
        <div class="slot-actions">
          <button class="slot-generate-btn auto-rule-skip-btn" type="button" data-create-tag-auto-rule data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="0" title="Choose tags" aria-label="Choose tags for ${escapeHtml(displayMeal)}">#</button>
          <button class="slot-add-btn auto-rule-add-btn" type="button" data-add-auto-rule data-day="${day.id}" data-meal="${escapeHtml(meal)}" title="${addTitle}" aria-label="Add another ${escapeHtml(displayMeal)} rule slot" ${addDisabled ? "disabled" : ""}>${ldeIcon("add", { size: 16 })}</button>
        </div>
      </div>
      <div class="meal-entry-list">
        ${entries.map((index) => autoRuleInputTemplate(day, meal, index, displayMeal)).join("")}
      </div>
    </div>
  `;
}

function ensureActiveAutoRuleDay() {
  const activeDay = prepDays.find((day) => day.id === activeAutoRuleDayId) || prepDays[0];
  activeAutoRuleDayId = activeDay.id;
  return activeDay;
}

function selectAutoRuleDay(dayId) {
  if (!prepDays.some((day) => day.id === dayId)) return;
  activeAutoRuleDayId = dayId;
  renderAutoRules();
}

function autoRuleInputTemplate(day, meal, index, displayMeal = meal) {
  const rule = autoGenerateRuleForSlot(day, meal, index);
  const placeholder = index === 0 ? displayMeal : mealEntryPlaceholder(meal, index);
  const value = autoRuleInputValue(rule);
  const hasRule = Boolean(value);
  const isEmpty = !value;
  if (hasRule) {
    const entryLabel = escapeHtml(value);
    return `
      <div class="meal-entry auto-rule-entry has-rule" data-auto-rule-entry data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" draggable="true">
        <button class="recipe-meal-link custom-meal-link auto-rule-selected" type="button" data-pick-auto-rule-recipe data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Click to change. Right-click to remove.">
          ${entryLabel}
        </button>
        ${rule.action === "tags" ? autoRuleTagControlsTemplate(day.id, meal, index, rule) : ""}
        <button class="meal-swipe-delete" type="button" data-remove-auto-rule data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" aria-label="Delete ${entryLabel}">Delete</button>
      </div>
    `;
  }
  return `
    <div class="meal-entry auto-rule-entry ${isEmpty ? "auto-rule-entry-empty" : ""}" data-auto-rule-entry data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" draggable="true">
      <div class="meal-pick-group auto-rule-pick-group auto-rule-empty-group">
        <button class="meal-pick-slot auto-rule-pick-slot" type="button" data-pick-auto-rule-recipe data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Choose ${escapeHtml(placeholder)} rule" aria-label="Choose ${escapeHtml(placeholder)} rule">
          ${stackedDishesIconTemplate()}
        </button>
        <button class="meal-special-choice meal-ingredient-choice" type="button" data-pick-auto-rule-ingredient data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Choose ingredient" aria-label="Choose ingredient for ${escapeHtml(placeholder)} rule">
          ${broccoliIconTemplate()}
        </button>
        <button class="meal-special-choice meal-leftover-choice" type="button" data-create-leftovers-auto-rule data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Leftovers" aria-label="Set as leftovers for ${escapeHtml(placeholder)} rule">
          ${leftoversIconTemplate()}
        </button>
      </div>
    </div>
  `;
}

function autoRuleTagControlsTemplate(dayId, meal, index, rule) {
  const tags = normalizeRecipeTagSelection(rule.tags);
  const availableTags = recipeTags().filter((tag) => !tags.some((selected) => normalize(selected) === normalize(tag)));
  return `
    <div class="auto-rule-tag-controls">
      <div class="auto-rule-tag-control-row">
        <label>
          Match
          <select data-auto-rule-match-mode data-day="${dayId}" data-meal="${escapeHtml(meal)}" data-index="${index}">
            <option value="any" ${rule.tagMatchMode === "all" ? "" : "selected"}>Any tag</option>
            <option value="all" ${rule.tagMatchMode === "all" ? "selected" : ""}>All tags</option>
          </select>
        </label>
        <label>
          Pick
          <select data-auto-rule-selection-mode data-day="${dayId}" data-meal="${escapeHtml(meal)}" data-index="${index}">
            <option value="random" ${rule.selectionMode === "leastRecent" ? "" : "selected"}>Random</option>
            <option value="leastRecent" ${rule.selectionMode === "leastRecent" ? "selected" : ""}>Least recent</option>
          </select>
        </label>
      </div>
      <div class="auto-rule-tag-chip-list">
        ${tags.map((tag) => `
          <span class="tag-library-item auto-rule-tag-chip">
            ${escapeHtml(tag)}
            <button type="button" data-remove-auto-rule-tag="${escapeHtml(tag)}" data-day="${dayId}" data-meal="${escapeHtml(meal)}" data-index="${index}" aria-label="Remove ${escapeHtml(tag)}">×</button>
          </span>
        `).join("")}
      </div>
      <select data-add-auto-rule-tag data-day="${dayId}" data-meal="${escapeHtml(meal)}" data-index="${index}">
        <option value="">Add tag</option>
        ${availableTags.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join("")}
      </select>
    </div>
  `;
}

function autoRuleEntryCount(dayId, meal) {
  const exactIndexes = state.autoGenerateRules
    .filter((rule) => rule.meal === meal
      && rule.dayIds.includes(dayId)
      && (rule.index === 0 || rule.action !== "any" || rule.value === autoRuleBlankSlotValue))
    .map((rule) => rule.index)
    .filter(Number.isInteger);
  const highestIndex = exactIndexes.length ? Math.max(...exactIndexes) : 0;
  return Math.max(minimumMealEntryCount(meal), highestIndex + 1);
}

function autoRuleInputValue(rule) {
  if (!rule) return "";
  if (rule.action === "skip") return "Do not fill";
  if (["folder", "folderSame"].includes(rule.action)) return autoRuleFolderValue(rule.folderName);
  if (rule.action === "tags") return autoRuleTagValue(rule);
  if (rule.action === "ingredient") return parseGroceryMealSlot(rule.value)?.item || rule.value || "";
  if (rule.action === "custom") {
    const special = specialMealForSlot(rule.value);
    if (special) return specialMealDisplayText(special);
    return parseGroceryMealSlot(rule.value)?.item || activeRecipes().find((recipe) => recipe.id === rule.value)?.name || rule.value || "";
  }
  return "";
}

function autoRuleTagValue(rule) {
  const tags = normalizeRecipeTagSelection(rule.tags);
  if (!tags.length) return "Tags";
  const mode = rule.tagMatchMode === "all" ? "all" : "any";
  return `Tags (${mode}): ${tags.join(", ")}`;
}

function autoRuleFolderValue(folderName) {
  return folderName ? `Folder: ${folderName}` : "";
}

function commitAutoRuleInput(input) {
  const dayId = input.dataset.day;
  const meal = input.dataset.meal;
  const index = Number(input.dataset.index);
  const value = input.value.trim();
  setAutoRuleFromValue(dayId, meal, index, value);
}

function setAutoRuleFromValue(dayId, meal, index, value) {
  const previousRule = autoGenerateRuleForSlot({ id: dayId }, meal, index);
  removeAutoRulesForDaySlot(dayId, meal, index);
  const rule = autoGenerateRuleFromInput(dayId, meal, index, value, previousRule);
  if (rule) state.autoGenerateRules.unshift(rule);
  if (!value && pendingAutoRuleCompaction?.dayId === dayId && pendingAutoRuleCompaction?.meal === meal && pendingAutoRuleCompaction?.index === index) {
    compactAutoRuleEmptySlots(dayId, meal);
  }
  pendingAutoRuleCompaction = null;
  persist();
  renderAutoRules();
}

function clearAutoRule(dayId, meal, index) {
  const previousRule = autoGenerateRuleForSlot({ id: dayId }, meal, index);
  removeAutoRulesForDaySlot(dayId, meal, index);
  if (previousRule) state.autoGenerateRules.unshift(autoRule(createId("rule"), [dayId], meal, index, "any"));
  persist();
  renderAutoRules();
}

function createTagAutoRule(dayId, meal, index) {
  const tags = recipeTags();
  removeAutoRulesForDaySlot(dayId, meal, index);
  const rule = autoRule(createId("rule"), [dayId], meal, index, "tags");
  rule.tags = tags[0] ? [tags[0]] : [];
  state.autoGenerateRules.unshift(rule);
  persist();
  renderAutoRules();
}

function updateTagAutoRule(dayId, meal, index, updater) {
  const rule = autoGenerateRuleForSlot({ id: dayId }, meal, index);
  if (!rule || rule.action !== "tags") return;
  state.autoGenerateRules = state.autoGenerateRules.filter((item) => !isExactAutoRuleForSlot(item, dayId, meal, index));
  const nextRule = normalizeAutoGenerateRule({
    ...rule,
    id: isExactAutoRuleForSlot(rule, dayId, meal, index) ? rule.id : createId("rule"),
    dayIds: [dayId],
    meal,
    index
  });
  updater(nextRule);
  state.autoGenerateRules.unshift(normalizeAutoGenerateRule(nextRule));
  persist();
  renderAutoRules();
}

function removeAutoRuleSlot(dayId, meal, index) {
  removeAutoRulesForDaySlot(dayId, meal, index);
  state.autoGenerateRules.unshift(autoRule(createId("rule"), [dayId], meal, index, "any", "", autoRuleBlankSlotValue));
  compactAutoRuleEmptySlots(dayId, meal);
  persist();
  renderAutoRules();
}

function removeAutoRulesForDaySlot(dayId, meal, index) {
  state.autoGenerateRules = state.autoGenerateRules.flatMap((rule) => {
    if (rule.meal !== meal || rule.index !== index || !rule.dayIds.includes(dayId)) return [rule];
    if (rule.dayIds.length <= 1) return [];
    const remainingRule = normalizeAutoGenerateRule({
      ...rule,
      dayIds: rule.dayIds.filter((id) => id !== dayId)
    });
    return remainingRule ? [remainingRule] : [];
  });
}

function compactAutoRuleEmptySlots(dayId, meal) {
  const minimumCount = minimumMealEntryCount(meal);
  const exactRules = state.autoGenerateRules
    .filter((rule) => rule.meal === meal && rule.dayIds.includes(dayId))
    .sort((a, b) => a.index - b.index);
  const visibleRules = exactRules.filter((rule) => rule.index === 0 || rule.action !== "any" || rule.value === autoRuleBlankSlotValue);
  const filledRules = visibleRules.filter((rule) => autoRuleInputValue(rule));
  const explicitBlankRules = visibleRules.filter((rule) => rule.action === "any" && rule.value === autoRuleBlankSlotValue);
  let keepBlankIndexes = [];

  if (filledRules.length < minimumCount) {
    const needed = minimumCount - filledRules.length;
    keepBlankIndexes = explicitBlankRules.slice(0, needed).map((rule) => rule.index);
  }

  state.autoGenerateRules = state.autoGenerateRules.filter((rule) => {
    if (rule.meal !== meal || !rule.dayIds.includes(dayId)) return true;
    if (rule.action !== "any" || rule.value !== autoRuleBlankSlotValue) return true;
    return keepBlankIndexes.includes(rule.index);
  });

  normalizeAutoRuleSlotIndexes(dayId, meal);
}

function normalizeAutoRuleSlotIndexes(dayId, meal) {
  const exactRules = state.autoGenerateRules
    .filter((rule) => rule.meal === meal && rule.dayIds.includes(dayId))
    .sort((a, b) => a.index - b.index);
  const visibleRules = exactRules.filter((rule) => rule.index === 0 || rule.action !== "any" || rule.value === autoRuleBlankSlotValue);
  const nextIndexes = new Map(visibleRules.map((rule, nextIndex) => [rule.id, nextIndex]));
  state.autoGenerateRules = state.autoGenerateRules.map((rule) => (
    nextIndexes.has(rule.id) ? { ...rule, index: nextIndexes.get(rule.id) } : rule
  ));
}

function addAutoRuleSlot(dayId, meal) {
  if (!dayId || !meal) return;
  const day = prepDays.find((item) => item.id === dayId) || { id: dayId };
  const indexes = Array.from({ length: autoRuleEntryCount(dayId, meal) }, (_item, index) => index);
  if (indexes.some((index) => autoGenerateRuleForSlot(day, meal, index)?.action === "skip")) return;
  const nextIndex = autoRuleEntryCount(dayId, meal);
  state.autoGenerateRules.unshift(autoRule(createId("rule"), [dayId], meal, nextIndex, "any", "", autoRuleBlankSlotValue));
  persist();
  renderAutoRules();
}

function openAutoRuleRecipePicker(day, meal, index) {
  if (!day || !meal || Number.isNaN(index)) return;
  pendingAutoRuleCompaction = { dayId: day, meal, index };
  setPendingAutoRuleRecipeSelection({ day, meal, index });
  openRecipeBoxPage();
  renderFolders();
}

function chooseRecipeForPendingAutoRule(recipeId) {
  if (!getPendingAutoRuleRecipeSelection() || !recipeId) return;
  const recipe = activeRecipes().find((item) => item.id === recipeId);
  if (!recipe) return;
  const { day, meal, index } = getPendingAutoRuleRecipeSelection();
  setPendingAutoRuleRecipeSelection(null);
  setAutoRuleFromValue(day, meal, index, recipe.id);
  elements.recipeBoxPageDialog.close();
  if (elements.autoRulesDialog.open) renderAutoRules();
}

function openAutoRuleIngredientPicker(day, meal, index) {
  if (!day || !meal || Number.isNaN(index)) return;
  setPendingAutoRuleIngredientSelection({ day, meal, index });
  closeFloatingMenus();
  elements.groceryLibraryInput.placeholder = "Search items…";
  renderGroceryLibrary();
  elements.groceryLibraryInput.value = "";
  elements.groceryLibraryDialog.showModal();
  focusGroceryLibraryInput();
}

function chooseIngredientForPendingAutoRule(item) {
  if (!getPendingAutoRuleIngredientSelection() || !item) return;
  const { day, meal, index } = getPendingAutoRuleIngredientSelection();
  setPendingAutoRuleIngredientSelection(null);
  removeAutoRulesForDaySlot(day, meal, index);
  state.autoGenerateRules.unshift(autoRule(createId("rule"), [day], meal, index, "ingredient", "", item));
  persist();
  elements.groceryLibraryDialog.close();
  if (elements.autoRulesDialog.open) renderAutoRules();
}

function isExactAutoRuleForSlot(rule, dayId, meal, index) {
  return rule.meal === meal && rule.index === index && rule.dayIds.length === 1 && rule.dayIds[0] === dayId;
}

function autoGenerateRuleFromInput(dayId, meal, index, value, previousRule = null) {
  if (!value) {
    return previousRule && !isExactAutoRuleForSlot(previousRule, dayId, meal, index)
      ? autoRule(createId("rule"), [dayId], meal, index, "any")
      : null;
  }
  if (normalize(value) === "do not fill") return autoRule(createId("rule"), [dayId], meal, index, "skip");

  const tagPrefix = "tag:";
  const tagName = normalize(value).startsWith(tagPrefix)
    ? value.slice(tagPrefix.length).trim()
    : value;
  const tag = recipeTags().find((item) => normalize(item) === normalize(tagName));
  if (tag) return tagAutoRule(createId("rule"), [dayId], meal, index, [tag]);

  const folderPrefix = "folder:";
  const folderName = normalize(value).startsWith(folderPrefix)
    ? value.slice(folderPrefix.length).trim()
    : value;
  const folder = normalizedFolders().find((item) => normalize(item.name) === normalize(folderName));
  if (folder) return tagAutoRule(createId("rule"), [dayId], meal, index, [folder.name]);

  return autoRule(createId("rule"), [dayId], meal, index, "custom", "", value);
}

function columnMealsForDay(day, column, combinedState) {
  if (!column.combinedMeal) return column.meals.map((meal) => (day.meals.includes(meal) ? meal : ""));
  const combinedMeal = column.combinedMeal;
  const group = combinedMealSections[combinedMeal];
  const combinedMembers = combinedMealMembersForDay(day, combinedState, combinedMeal);
  const isCombined = combinedMembers.length >= 2;
  const hasMembers = group.members.some((meal) => day.meals.includes(meal));
  if (!isCombined || !hasMembers) {
    return column.meals.map((meal) => (day.meals.includes(meal) ? meal : ""));
  }
  return [
    combinedMeal,
    ...column.meals
      .filter((meal) => !combinedMembers.includes(meal))
      .map((meal) => (day.meals.includes(meal) ? meal : ""))
  ];
}

function combinedMealMembersForDay(day, combinedState, combinedMeal) {
  const group = combinedMealSections[combinedMeal];
  if (!group || !day) return [];
  const rawValue = combinedState?.[day.id]?.[combinedMeal];
  if (Array.isArray(rawValue)) {
    return rawValue.filter((meal) => group.members.includes(meal) && day.meals.includes(meal));
  }
  if (rawValue) {
    return group.members.filter((meal) => day.meals.includes(meal));
  }
  return [];
}

function isAutoSlotEnabled(dayId, meal) {
  return state.autoSlotEnabled?.[dayId]?.[meal] !== false;
}

function canToggleAutoSlot(dayId, meal, wouldBeEnabled) {
  const day = prepDays.find((d) => d.id === dayId);
  if (!day) return false;
  const column = mealColumnConfigs.find((c) => c.combinedMeal === meal || c.meals.includes(meal));
  if (!column) return false;
  const personMeals = column.meals.filter((m) => day.meals.includes(m));
  const allColumnMeals = [column.combinedMeal, ...personMeals].filter(Boolean);
  const simEnabled = (m) => m === meal ? wouldBeEnabled : isAutoSlotEnabled(dayId, m);
  if (!allColumnMeals.some(simEnabled)) return false;
  if (column.combinedMeal && simEnabled(column.combinedMeal)) {
    if (personMeals.filter((m) => !simEnabled(m)).length < 2) return false;
  }
  return true;
}

function toggleAutoSlot(dayId, meal) {
  const wouldBeEnabled = !isAutoSlotEnabled(dayId, meal);
  if (!canToggleAutoSlot(dayId, meal, wouldBeEnabled)) return false;
  if (!state.autoSlotEnabled) state.autoSlotEnabled = {};
  if (!state.autoSlotEnabled[dayId]) state.autoSlotEnabled[dayId] = {};
  state.autoSlotEnabled[dayId][meal] = wouldBeEnabled;
  persist();
  renderAutoRules();
  return true;
}

function slotTemplate(day, meal, slotValue, options = {}) {
  const readOnly = Boolean(options.readOnly);
  const displayMeal = options.displayMeal || meal;
  const isCombined = Boolean(options.combined);
  const canCombine = !readOnly && isCombinableMeal(meal);
  const entries = slotEntries(slotValue);
  const visibleEntries = mealEntryList(entries, meal);
  const filledEntries = entries.filter(Boolean);
  const hasOpenEntry = visibleEntries.some((entry) => !entry);
  if (readOnly && !filledEntries.length) return "";

  return `
    <div class="slot-card meal-${mealToken(meal)} ${filledEntries.length ? "filled" : ""} ${readOnly ? "published-slot" : ""}" ${readOnly ? "" : `data-meal-slot data-meal-section-target data-day="${day.id}" data-meal="${meal}"`}>
      <div class="slot-topline">
        <div class="slot-label" ${canCombine ? `draggable="true" data-meal-section-drag data-day="${day.id}" data-meal="${meal}" title="Drag onto another ${escapeHtml(displayMealName(combineGroupKeyForMeal(meal) || meal).toLowerCase())} section to combine"` : ""}>${escapeHtml(displayMeal)}</div>
        ${readOnly ? "" : `<div class="slot-actions">
          <button class="slot-delete-btn" type="button" data-clear-meal-section data-day="${day.id}" data-meal="${meal}" title="${isCombined ? `Clear and split ${displayMeal}` : `Clear ${displayMeal}`}" aria-label="${isCombined ? `Clear and split ${displayMeal}` : `Clear ${displayMeal}`}">
            ${ldeIcon("trash", { size: 16 })}
          </button>
          <button class="slot-generate-btn" type="button" data-generate-meal-section data-day="${day.id}" data-meal="${meal}" title="Auto-generate ${displayMeal}" aria-label="Auto-generate ${displayMeal}">
            ${ldeIcon("autoGenerate", { size: 16 })}
          </button>
          <button class="slot-add-btn" type="button" data-add-meal-entry data-day="${day.id}" data-meal="${meal}" title="${hasOpenEntry ? `Fill the open slot before adding another recipe` : `Add another recipe`}" aria-label="Add another recipe to ${displayMeal}" ${hasOpenEntry ? "disabled" : ""}>${ldeIcon("add", { size: 16 })}</button>
        </div>`}
      </div>
      <div class="meal-entry-list">
        ${visibleEntries.map((entry, index) => mealEntryTemplate(day, meal, entry, index, visibleEntries.length, entries, { readOnly })).join("")}
      </div>
    </div>
  `;
}

function mealEntryTemplate(day, meal, entry, index, entryCount, slotEntries, options = {}) {
  const readOnly = Boolean(options.readOnly);
  const recipe = recipeForSlot(entry);
  const specialMeal = specialMealForSlot(entry);
  const listId = `recipe-options-${day.id}-${mealToken(meal)}-${index}`;
  const isEditing = isEditingMealEntry(day.id, meal, index);
  const draggable = entry && !isEditing ? `data-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}"` : "";

  if (readOnly) {
    if (!entry) {
      return `<div class="meal-entry meal-entry-empty" aria-hidden="true"></div>`;
    }
    if (recipe) {
      return `
        <div class="meal-entry published-meal-entry">
          <button class="recipe-meal-link" type="button" data-view-recipe="${escapeHtml(recipe.id)}">
            ${escapeHtml(recipe.name)}
          </button>
          <span class="meal-planned-servings">${escapeHtml(formatPlannedServings(plannedServingsForEntry(entry, recipe)))}</span>
        </div>
      `;
    }
    if (specialMeal) {
      return `
        <div class="meal-entry published-meal-entry">
          <span class="recipe-meal-link custom-meal-link meal-entry-static">
            ${escapeHtml(specialMealDisplayText(specialMeal))}
          </span>
        </div>
      `;
    }
    return `
      <div class="meal-entry published-meal-entry">
        <span class="recipe-meal-link custom-meal-link meal-entry-static">${escapeHtml(mealInputValue(entry))}</span>
      </div>
    `;
  }

  if (isEditing || !entry) {
    if (!entry && !isEditing) {
      return `
        <div class="meal-entry" data-empty-meal-entry data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}">
          <div class="meal-pick-group">
            <button class="meal-pick-slot" type="button" data-pick-meal-entry data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Choose recipe" aria-label="Choose recipe">
              ${stackedDishesIconTemplate()}
            </button>
            <button class="meal-special-choice meal-ingredient-choice" type="button" data-pick-ingredient-entry data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Choose ingredient" aria-label="Choose ingredient">
              ${broccoliIconTemplate()}
            </button>
            <button class="meal-special-choice" type="button" data-special-meal-choice="out" data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Out" aria-label="Out">
              ${outMealIconTemplate()}
            </button>
            <button class="meal-special-choice" type="button" data-special-meal-choice="leftovers" data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Leftovers" aria-label="Leftovers">
              ${leftoversIconTemplate()}
            </button>
          </div>
        </div>
      `;
    }
    return `
      <div class="meal-entry ${entry ? "editing-meal-entry" : ""}" ${draggable}>
        <input class="meal-search" list="${escapeHtml(listId)}" data-meal-input data-day="${day.id}" data-meal="${meal}" data-index="${index}" value="${escapeHtml(mealInputValue(entry))}" placeholder="${escapeHtml(mealEntryPlaceholder(meal, index))}" />
        <datalist id="${escapeHtml(listId)}">
          ${recipeOptionsTemplate(slotEntries, entry)}
        </datalist>
      </div>
    `;
  }

  if (recipe) {
    return `
      <div class="meal-entry draggable-meal-entry" data-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}">
        <button class="recipe-meal-link" type="button" data-view-recipe="${escapeHtml(recipe.id)}" data-edit-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" title="Double-click to edit">
          ${escapeHtml(recipe.name)}
        </button>
        <button class="meal-swipe-delete" type="button" data-remove-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" aria-label="Delete ${escapeHtml(recipe.name)}">Delete</button>
      </div>
    `;
  }

  if (specialMeal) {
    const restaurantLinked = specialMeal.type === "out" && specialMeal.restaurant?.placeId;
    const pinTitle = restaurantLinked ? "Change restaurant" : "Link restaurant";
    return `
      <div class="meal-entry draggable-meal-entry special-meal-entry" data-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}">
        <div class="special-meal-card special-meal-${escapeHtml(specialMeal.type)}">
          <div class="special-meal-label-row">
            <strong>${escapeHtml(specialMealLabel(specialMeal.type))}${specialMeal.note && !restaurantLinked ? " -" : ""}</strong>
            ${restaurantLinked
              ? `<button class="meal-restaurant-name-btn" type="button" data-show-restaurant-info data-day="${escapeHtml(day.id)}" data-meal="${escapeHtml(meal)}" data-index="${index}">${escapeHtml(specialMeal.restaurant.name)}</button>`
              : `<input data-special-meal-note data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" value="${escapeHtml(specialMeal.note)}" placeholder="${escapeHtml(specialMealPlaceholder(specialMeal.type))}" />`}
            ${specialMeal.type === "out" ? `<button class="meal-restaurant-pin-btn" type="button" data-link-restaurant data-day="${escapeHtml(day.id)}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="${pinTitle}" aria-label="${pinTitle}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></button>` : ""}
          </div>
        </div>
        <button class="meal-swipe-delete" type="button" data-remove-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" aria-label="Delete ${escapeHtml(specialMealLabel(specialMeal.type))}">Delete</button>
      </div>
    `;
  }

  return `
    <div class="meal-entry draggable-meal-entry" data-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}">
      <button class="recipe-meal-link custom-meal-link" type="button" data-edit-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" title="Double-click to edit">
        ${escapeHtml(mealInputValue(entry))}
      </button>
      <button class="meal-swipe-delete" type="button" data-remove-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" aria-label="Delete meal entry">Delete</button>
    </div>
  `;
}

function formatPlannedServings(value) {
  const servings = Number(value) || 1;
  return `${formatDailyDozenServings(servings)} serving${servings === 1 ? "" : "s"}`;
}

function isEditingMealEntry(dayId, meal, index) {
  return editingMealEntry
    && editingMealEntry.day === dayId
    && editingMealEntry.meal === meal
    && editingMealEntry.index === index;
}

function openMealEntryEditor(day, meal, index) {
  editingMealEntry = { day, meal, index };
  renderPlanner();
  const input = elements.plannerGrid.querySelector(`[data-meal-input][data-day="${CSS.escape(day)}"][data-meal="${CSS.escape(meal)}"][data-index="${index}"]`);
  if (input) {
    input.focus();
    input.select();
  }
}

function recipeOptionsTemplate(entries, currentEntry) {
  const selectedRecipeIds = new Set(
    entries
      .filter((entry) => entry !== currentEntry)
      .map((entry) => recipeForSlot(entry)?.id)
      .filter(Boolean)
  );
  const recipeOptions = [...activeRecipes()]
    .filter((recipe) => !selectedRecipeIds.has(recipe.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((recipe) => `<option value="${escapeHtml(recipe.name)}"></option>`);
  const groceryOptions = grocerySuggestionItems()
    .filter((item) => !selectedRecipeIds.has(groceryMealSlotId(item)))
    .map((item) => `<option value="${escapeHtml(item)}"></option>`);
  const customOptions = mealPlanCustomOptions.map((option) => `<option value="${escapeHtml(option)}"></option>`);
  return [...recipeOptions, ...groceryOptions, ...customOptions].join("");
}

function mealToken(meal) {
  return normalize(meal).replace(/\s+/g, "-");
}

function mealEntryPlaceholder(meal, index) {
  if (index === 0) return displayMealName(meal);
  return "Search or type meal";
}

function stackedDishesIconTemplate() {
  return ldeIcon("selectDish", { size: 22, cls: "stacked-dishes-icon" });
}

function broccoliIconTemplate() {
  return ldeIcon("ingredient", { size: 18 });
}

function outMealIconTemplate() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <path d="M15 10 A3 3 0 0 0 9 10 A3 3 0 0 0 15 10Z" />
    </svg>
  `;
}

function leftoversIconTemplate() {
  return ldeIcon("leftovers", { size: 18 });
}

function handleMealEntryDragStart(event) {
  if (event.currentTarget.querySelector("[data-meal-input]")
    || event.target.closest("[data-special-meal-note], [data-planned-servings], [data-link-restaurant], [data-unlink-restaurant], [data-show-restaurant-info], .meal-restaurant-bar-link")) {
    event.preventDefault();
    return;
  }
  suppressMealEntryClick = true;
  window.clearTimeout(mealEntryClickTimer);
  draggedMealEntry = {
    day: event.currentTarget.dataset.day,
    meal: event.currentTarget.dataset.meal,
    index: Number(event.currentTarget.dataset.index)
  };
  setLastMealDragPoint({ x: event.clientX, y: event.clientY });
  event.currentTarget.classList.add("is-dragging");
  document.body.classList.add("meal-entry-drag-active");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", JSON.stringify(draggedMealEntry));
}

function handleMealEntryDrag(event) {
  if (!draggedMealEntry) return;
  updateMealDragPoint(event);
  elements.mealTrashTarget.classList.toggle("drag-over", isMealDragEndingInTrash());
}

function handleMealEntryDragOver(event) {
  if (!draggedMealEntry) return;
  updateMealDragPoint(event);
  const target = event.currentTarget;
  event.preventDefault();
  target.classList.add("drag-over");
  event.dataTransfer.dropEffect = "move";
}

function handleMealEntryDrop(event) {
  event.preventDefault();
  updateMealDragPoint(event);
  const target = event.currentTarget;
  target.classList.remove("drag-over");
  if (!draggedMealEntry) return;
  if (target.dataset.day === draggedMealEntry.day && target.dataset.meal === draggedMealEntry.meal) {
    reorderMealEntry(draggedMealEntry.day, draggedMealEntry.meal, draggedMealEntry.index, Number(target.dataset.index));
  } else {
    moveMealEntryToSlot(draggedMealEntry, target.dataset.day, target.dataset.meal, Number(target.dataset.index));
  }
  clearMealEntryDragState();
}

function handleMealDayTabDragOver(event) {
  if (!draggedMealEntry) return;
  const targetDay = event.currentTarget.dataset.dayTab;
  if (!mealForDayTabDrop(draggedMealEntry.meal, targetDay)) return;
  updateMealDragPoint(event);
  event.preventDefault();
  event.currentTarget.classList.add("meal-day-drop-over");
  event.dataTransfer.dropEffect = "move";
}

function handleMealDayTabDrop(event) {
  if (!draggedMealEntry) return;
  event.preventDefault();
  event.stopPropagation();
  updateMealDragPoint(event);
  event.currentTarget.classList.remove("meal-day-drop-over");
  moveMealEntryToDay(draggedMealEntry, event.currentTarget.dataset.dayTab);
  clearMealEntryDragState();
}

function handleMealSlotDragOver(event) {
  if (!draggedMealEntry) return;
  updateMealDragPoint(event);
  event.preventDefault();
  event.currentTarget.classList.add("drag-over");
  event.dataTransfer.dropEffect = "move";
}

function handleMealSlotDrop(event) {
  event.preventDefault();
  updateMealDragPoint(event);
  event.currentTarget.classList.remove("drag-over");
  if (!draggedMealEntry) return;
  moveMealEntryToSlot(draggedMealEntry, event.currentTarget.dataset.day, event.currentTarget.dataset.meal);
  clearMealEntryDragState();
}

function handleMealSectionDragStart(event) {
  draggedMealSection = {
    day: event.currentTarget.dataset.day,
    meal: event.currentTarget.dataset.meal
  };
  event.stopPropagation();
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", JSON.stringify(draggedMealSection));
  const carousel = event.currentTarget.closest(".day-slots-carousel");
  if (carousel) {
    carousel.classList.add("is-combining");
    carousel.scrollLeft = 0;
  }
}

function handleMealSectionDragOver(event) {
  if (!draggedMealSection) return;
  const target = event.currentTarget;
  if (!canCombineMealSections(draggedMealSection.day, draggedMealSection.meal, target.dataset.day, target.dataset.meal)) return;
  event.preventDefault();
  target.classList.add("section-drag-over");
  event.dataTransfer.dropEffect = "move";
}

function handleMealSectionDrop(event) {
  if (!draggedMealSection) return;
  const target = event.currentTarget;
  target.classList.remove("section-drag-over");
  if (!canCombineMealSections(draggedMealSection.day, draggedMealSection.meal, target.dataset.day, target.dataset.meal)) return;
  event.preventDefault();
  combineMealSections(draggedMealSection.day, draggedMealSection.meal, target.dataset.meal);
  clearMealSectionDragState();
}

function clearMealSectionDragState() {
  draggedMealSection = null;
  elements.plannerGrid.querySelectorAll(".section-drag-over").forEach((slot) => slot.classList.remove("section-drag-over"));
  elements.plannerGrid.querySelectorAll(".day-slots-carousel.is-combining").forEach((c) => c.classList.remove("is-combining"));
}

function handleMealTrashDragOver(event) {
  if (draggedAutoRuleEntry) {
    handleAutoRuleTrashDragOver(event);
    return;
  }
  if (!draggedMealEntry && !getDraggedPlayTask() && !getDraggedDoTask()) return;
  updateMealDragPoint(event);
  event.preventDefault();
  elements.mealTrashTarget.classList.add("drag-over");
  event.dataTransfer.dropEffect = "move";
}

function handleMealTrashDragLeave() {
  activeTrashTarget().classList.remove("drag-over");
}

function handleAutoRuleTrashDragOver(event) {
  updateMealDragPoint(event);
  event.preventDefault();
  activeTrashTarget().classList.add("drag-over");
  event.dataTransfer.dropEffect = "move";
}

function handleMealTrashDrop(event) {
  event.preventDefault();
  updateMealDragPoint(event);
  activeTrashTarget().classList.remove("drag-over");
  if (draggedAutoRuleEntry) {
    deleteDraggedAutoRuleEntry();
    return;
  }
  if (!draggedMealEntry && !getDraggedPlayTask() && !getDraggedDoTask()) return;
  deleteDraggedMealEntry();
  deleteDraggedPlayTask();
  deleteDraggedDoTask();
}

function handleMealTrashOverlayDragOver(event) {
  if (draggedAutoRuleEntry) {
    updateMealDragPoint(event);
    event.preventDefault();
    activeTrashTarget().classList.toggle("drag-over", isPointInMealTrash(event.clientX, event.clientY));
    event.dataTransfer.dropEffect = isPointInMealTrash(event.clientX, event.clientY) ? "move" : "none";
    return;
  }
  if (!draggedMealEntry && !getDraggedPlayTask() && !getDraggedDoTask()) return;
  updateMealDragPoint(event);
  event.preventDefault();
  elements.mealTrashTarget.classList.toggle("drag-over", isPointInMealTrash(event.clientX, event.clientY));
  event.dataTransfer.dropEffect = isPointInMealTrash(event.clientX, event.clientY) ? "move" : "none";
}

function handleMealTrashOverlayDrop(event) {
  if (draggedAutoRuleEntry) {
    updateMealDragPoint(event);
    event.preventDefault();
    if (isMealDragEndingInTrash()) {
      deleteDraggedAutoRuleEntry();
    } else {
      clearAutoRuleDragState();
    }
    return;
  }
  if (!draggedMealEntry && !getDraggedPlayTask() && !getDraggedDoTask()) return;
  updateMealDragPoint(event);
  event.preventDefault();
  if (isMealDragEndingInTrash()) {
    deleteDraggedMealEntry();
    deleteDraggedPlayTask();
    deleteDraggedDoTask();
  } else {
    clearMealEntryDragState();
    clearPlayTaskDragState();
    clearDoTaskDragState();
  }
}

function handleDocumentMealDragOver(event) {
  if (draggedAutoRuleEntry) {
    updateMealDragPoint(event);
    if (!isPointInMealTrash(event.clientX, event.clientY)) {
      activeTrashTarget().classList.remove("drag-over");
      return;
    }
    event.preventDefault();
    activeTrashTarget().classList.add("drag-over");
    event.dataTransfer.dropEffect = "move";
    return;
  }
  if (!draggedMealEntry && !getDraggedPlayTask() && !getDraggedDoTask()) return;
  updateMealDragPoint(event);
  if (!isPointInMealTrash(event.clientX, event.clientY)) {
    elements.mealTrashTarget.classList.remove("drag-over");
    return;
  }
  event.preventDefault();
  elements.mealTrashTarget.classList.add("drag-over");
  event.dataTransfer.dropEffect = "move";
}

function handleDocumentMealDrop(event) {
  if (draggedAutoRuleEntry) {
    updateMealDragPoint(event);
    if (!isPointInMealTrash(event.clientX, event.clientY)) return;
    event.preventDefault();
    deleteDraggedAutoRuleEntry();
    return;
  }
  if (!draggedMealEntry && !getDraggedPlayTask() && !getDraggedDoTask()) return;
  updateMealDragPoint(event);
  if (!isPointInMealTrash(event.clientX, event.clientY)) return;
  event.preventDefault();
  deleteDraggedMealEntry();
  deleteDraggedPlayTask();
  deleteDraggedDoTask();
}

function handleMealEntryDragEnd(event) {
  updateMealDragPoint(event);
  if (isMealDragEndingInTrash() || elements.mealTrashTarget.classList.contains("drag-over")) {
    deleteDraggedMealEntry();
    return;
  }
  clearMealEntryDragState();
}

function handleAutoRuleDragStart(event) {
  draggedAutoRuleEntry = {
    day: event.currentTarget.dataset.day,
    meal: event.currentTarget.dataset.meal,
    index: Number(event.currentTarget.dataset.index)
  };
  setLastMealDragPoint({ x: event.clientX, y: event.clientY });
  event.currentTarget.classList.add("is-dragging");
  document.body.classList.add("meal-entry-drag-active");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", JSON.stringify(draggedAutoRuleEntry));
}

function handleAutoRuleDrag(event) {
  if (!draggedAutoRuleEntry) return;
  updateMealDragPoint(event);
  activeTrashTarget().classList.toggle("drag-over", isMealDragEndingInTrash());
}

function handleAutoRuleDragEnd(event) {
  updateMealDragPoint(event);
  if (isMealDragEndingInTrash() || activeTrashTarget().classList.contains("drag-over")) {
    deleteDraggedAutoRuleEntry();
    return;
  }
  clearAutoRuleDragState();
}

function deleteDraggedAutoRuleEntry() {
  if (!draggedAutoRuleEntry) return;
  const entry = { ...draggedAutoRuleEntry };
  removeAutoRuleSlot(entry.day, entry.meal, entry.index);
  clearAutoRuleDragState();
  window.requestAnimationFrame(clearAutoRuleDragState);
}

function clearAutoRuleDragState() {
  draggedAutoRuleEntry = null;
  autoRulePointerDrag = null;
  setLastMealDragPoint(null);
  document.body.classList.remove("meal-entry-drag-active");
  elements.mealTrashTarget.classList.remove("drag-over");
  elements.autoRuleTrashTarget?.classList.remove("drag-over");
  elements.autoRuleList?.querySelectorAll(".is-dragging, .drag-over").forEach((entry) => {
    entry.classList.remove("is-dragging", "drag-over");
  });
  window.setTimeout(() => {
    suppressAutoRuleClick = false;
  }, 120);
}

function handleAutoRulePointerDown(event) {
  if (event.pointerType === "touch") {
    const entry = event.currentTarget;
    elements.autoRuleList.querySelectorAll(".auto-rule-entry.is-swiped").forEach((item) => {
      if (item !== entry) item.classList.remove("is-swiped");
    });
    autoRuleSwipeGesture = {
      entry,
      startX: event.clientX,
      startY: event.clientY,
      active: false
    };
    return;
  }
  if (event.button !== 0) return;
  autoRulePointerDrag = {
    entry: event.currentTarget,
    day: event.currentTarget.dataset.day,
    meal: event.currentTarget.dataset.meal,
    index: Number(event.currentTarget.dataset.index),
    startX: event.clientX,
    startY: event.clientY,
    active: false
  };
}

function handleAutoRulePointerMove(event) {
  if (event.pointerType === "touch" && autoRuleSwipeGesture?.entry === event.currentTarget) {
    handleAutoRuleSwipeMove(event);
    return;
  }
  if (!autoRulePointerDrag || autoRulePointerDrag.entry !== event.currentTarget) return;
  const distance = Math.hypot(event.clientX - autoRulePointerDrag.startX, event.clientY - autoRulePointerDrag.startY);
  if (!autoRulePointerDrag.active && distance < 10) return;
  autoRulePointerDrag.active = true;
  draggedAutoRuleEntry = {
    day: autoRulePointerDrag.day,
    meal: autoRulePointerDrag.meal,
    index: autoRulePointerDrag.index
  };
  setLastMealDragPoint({ x: event.clientX, y: event.clientY });
  autoRulePointerDrag.entry.classList.add("is-dragging");
  document.body.classList.add("meal-entry-drag-active");
  activeTrashTarget().classList.toggle("drag-over", isPointInMealTrash(event.clientX, event.clientY));
}

function handleAutoRulePointerEnd(event) {
  if (event.pointerType === "touch" && autoRuleSwipeGesture?.entry === event.currentTarget) {
    handleAutoRuleSwipeEnd();
    return;
  }
  if (!autoRulePointerDrag) return;
  const wasActive = autoRulePointerDrag.active;
  if (wasActive) {
    event.preventDefault();
    event.stopPropagation();
    suppressAutoRuleClick = true;
    setLastMealDragPoint({ x: event.clientX, y: event.clientY });
    if (isMealDragEndingInTrash()) {
      deleteDraggedAutoRuleEntry();
      return;
    }
  }
  clearAutoRuleDragState();
}

function handleAutoRuleSwipeMove(event) {
  const deltaX = event.clientX - autoRuleSwipeGesture.startX;
  const deltaY = event.clientY - autoRuleSwipeGesture.startY;
  if (Math.abs(deltaY) > 28 && Math.abs(deltaY) > Math.abs(deltaX)) {
    autoRuleSwipeGesture = null;
    return;
  }
  if (deltaX < -28) {
    autoRuleSwipeGesture.active = true;
    autoRuleSwipeGesture.entry.classList.add("is-swiped");
    suppressAutoRuleClick = true;
  } else if (deltaX > 18) {
    autoRuleSwipeGesture.entry.classList.remove("is-swiped");
  }
}

function handleAutoRuleSwipeEnd() {
  if (!autoRuleSwipeGesture.active) {
    autoRuleSwipeGesture.entry.classList.remove("is-swiped");
  }
  autoRuleSwipeGesture = null;
  window.setTimeout(() => {
    suppressAutoRuleClick = false;
  }, 120);
}

function handleAutoRuleMouseDown(event) {
  if (event.button !== 0 || autoRulePointerDrag) return;
  autoRulePointerDrag = {
    entry: event.currentTarget,
    day: event.currentTarget.dataset.day,
    meal: event.currentTarget.dataset.meal,
    index: Number(event.currentTarget.dataset.index),
    startX: event.clientX,
    startY: event.clientY,
    active: false
  };
}

function handleDocumentAutoRuleMouseMove(event) {
  if (!autoRulePointerDrag) return;
  const distance = Math.hypot(event.clientX - autoRulePointerDrag.startX, event.clientY - autoRulePointerDrag.startY);
  if (!autoRulePointerDrag.active && distance < 10) return;
  autoRulePointerDrag.active = true;
  draggedAutoRuleEntry = {
    day: autoRulePointerDrag.day,
    meal: autoRulePointerDrag.meal,
    index: autoRulePointerDrag.index
  };
  setLastMealDragPoint({ x: event.clientX, y: event.clientY });
  autoRulePointerDrag.entry.classList.add("is-dragging");
  document.body.classList.add("meal-entry-drag-active");
  activeTrashTarget().classList.toggle("drag-over", isPointInMealTrash(event.clientX, event.clientY));
}

function handleDocumentAutoRuleMouseUp(event) {
  if (!autoRulePointerDrag) return;
  const wasActive = autoRulePointerDrag.active;
  if (wasActive) {
    event.preventDefault();
    suppressAutoRuleClick = true;
    setLastMealDragPoint({ x: event.clientX, y: event.clientY });
    if (isMealDragEndingInTrash()) {
      deleteDraggedAutoRuleEntry();
      return;
    }
  }
  clearAutoRuleDragState();
}

function updateMealDragPoint(event) {
  if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY) && (event.clientX || event.clientY)) {
    setLastMealDragPoint({ x: event.clientX, y: event.clientY });
  }
}

function isMealDragEndingInTrash() {
  return Boolean(getLastMealDragPoint() && isPointInMealTrash(getLastMealDragPoint().x, getLastMealDragPoint().y));
}

function isPointInMealTrash(x, y) {
  const rect = activeTrashTarget().getBoundingClientRect();
  const padding = 180;
  return x >= rect.left - padding
    && x <= rect.right + padding
    && y >= rect.top - padding
    && y <= rect.bottom + padding;
}

function deleteDraggedMealEntry() {
  if (!draggedMealEntry) return;
  const entry = { ...draggedMealEntry };
  removeMealEntry(entry.day, entry.meal, entry.index);
  clearMealEntryDragState();
  window.requestAnimationFrame(clearMealEntryDragState);
}

function clearMealEntryDragState() {
  draggedMealEntry = null;
  setLastMealDragPoint(null);
  document.body.classList.remove("meal-entry-drag-active");
  elements.mealTrashTarget.classList.remove("drag-over");
  elements.autoRuleTrashTarget?.classList.remove("drag-over");
  elements.plannerGrid.querySelectorAll(".is-dragging, .drag-over").forEach((entry) => {
    entry.classList.remove("is-dragging", "drag-over");
  });
  elements.plannerGrid.querySelectorAll(".meal-day-drop-over").forEach((tab) => {
    tab.classList.remove("meal-day-drop-over");
  });
  window.setTimeout(() => {
    suppressMealEntryClick = false;
  }, 120);
}

function activeTrashTarget() {
  return draggedAutoRuleEntry && elements.autoRuleTrashTarget ? elements.autoRuleTrashTarget : elements.mealTrashTarget;
}

function handleMealEntryPointerDown(event) {
  // Touch swipe-to-delete was removed here: it fought the horizontal swipe
  // that pages between meals within a day. Mobile deletes go through the
  // long-press entry menu instead; mouse drag-to-trash is unaffected.
  if (event.pointerType === "mouse") {
    if (event.button !== 0 || event.currentTarget.querySelector("[data-meal-input]") || event.target.closest("[data-special-meal-note], [data-link-restaurant], [data-unlink-restaurant], [data-show-restaurant-info], .meal-restaurant-bar-link")) return;
    startMealPointerDeleteGesture(event.currentTarget, event.clientX, event.clientY);
  }
}

function handleMealEntryMouseDown(event) {
  if (event.button !== 0 || event.currentTarget.querySelector("[data-meal-input]") || event.target.closest("[data-special-meal-note], [data-link-restaurant], [data-unlink-restaurant], [data-show-restaurant-info], .meal-restaurant-bar-link") || mealPointerDeleteGesture) return;
  startMealPointerDeleteGesture(event.currentTarget, event.clientX, event.clientY);
}

function startMealPointerDeleteGesture(entry, startX, startY) {
  document.body.classList.add("meal-entry-drag-active");
  setLastMealDragPoint({ x: startX, y: startY });
  mealPointerDeleteGesture = {
    day: entry.dataset.day,
    meal: entry.dataset.meal,
    index: Number(entry.dataset.index),
    startX,
    startY,
    active: false
  };
  window.addEventListener("pointermove", handleMealPointerDeleteMove);
  window.addEventListener("pointerup", handleMealPointerDeleteEnd, { once: true });
  window.addEventListener("mousemove", handleMealPointerDeleteMove);
  window.addEventListener("mouseup", handleMealPointerDeleteEnd, { once: true });
}

function handleMealPointerDeleteMove(event) {
  if (!mealPointerDeleteGesture) return;
  const deltaX = event.clientX - mealPointerDeleteGesture.startX;
  const deltaY = event.clientY - mealPointerDeleteGesture.startY;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance < 8 && !mealPointerDeleteGesture.active) return;
  mealPointerDeleteGesture.active = true;
  suppressMealEntryClick = true;
  setLastMealDragPoint({ x: event.clientX, y: event.clientY });
  document.body.classList.add("meal-entry-drag-active");
  elements.mealTrashTarget.classList.toggle("drag-over", isPointInMealTrash(event.clientX, event.clientY));
}

function handleMealPointerDeleteEnd(event) {
  window.removeEventListener("pointermove", handleMealPointerDeleteMove);
  window.removeEventListener("mousemove", handleMealPointerDeleteMove);
  if (!mealPointerDeleteGesture) return;
  const gesture = { ...mealPointerDeleteGesture };
  mealPointerDeleteGesture = null;
  elements.mealTrashTarget.classList.remove("drag-over");
  document.body.classList.remove("meal-entry-drag-active");
  updateMealDragPoint(event);
  if ((gesture.active || isMealDragEndingInTrash()) && isMealDragEndingInTrash()) {
    removeMealEntry(gesture.day, gesture.meal, gesture.index);
  }
  setLastMealDragPoint(null);
  window.setTimeout(() => {
    suppressMealEntryClick = false;
  }, 120);
}

function reorderMealEntry(day, meal, fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  const week = weekState();
  const entries = slotEntries(week.slots?.[day]?.[meal]);
  if (!entries[fromIndex] || !entries[toIndex]) return;
  const [moved] = entries.splice(fromIndex, 1);
  entries.splice(toIndex, 0, moved);
  setMeal(day, meal, compactMealSlotEntries(entries, meal));
}

function moveMealEntryToSlot(source, targetDay, targetMeal, targetIndex = null) {
  if (!targetDay || !targetMeal) return;
  if (source.day === targetDay && source.meal === targetMeal) {
    if (targetIndex === null) return;
    reorderMealEntry(source.day, source.meal, source.index, targetIndex);
    return;
  }

  const week = weekState();
  const sourceEntries = mealEntryList(slotEntries(week.slots?.[source.day]?.[source.meal]), source.meal);
  const movedEntry = sourceEntries[source.index];
  if (!movedEntry) return;

  if (source.index < minimumMealEntryCount(source.meal)) {
    sourceEntries[source.index] = "";
  } else {
    sourceEntries.splice(source.index, 1);
  }
  week.slots[source.day][source.meal] = compactMealSlotEntries(sourceEntries, source.meal);

  const targetEntries = mealEntryList(slotEntries(week.slots?.[targetDay]?.[targetMeal]), targetMeal);
  const resolvedTargetIndex = targetIndex === null ? firstAvailableMealEntryIndex(targetEntries) : targetIndex;
  if (resolvedTargetIndex < targetEntries.length && !targetEntries[resolvedTargetIndex]) {
    targetEntries[resolvedTargetIndex] = plannedEntryAtLocation(movedEntry, targetDay, targetMeal);
  } else if (resolvedTargetIndex < targetEntries.length) {
    targetEntries.splice(resolvedTargetIndex, 0, plannedEntryAtLocation(movedEntry, targetDay, targetMeal));
  } else {
    targetEntries.push(plannedEntryAtLocation(movedEntry, targetDay, targetMeal));
  }
  week.slots[targetDay][targetMeal] = compactMealSlotEntries(targetEntries, targetMeal);

  syncMakeAheadTasksForWeek(weekKey(), week);
  persist();
  renderPlanner();
  renderGroceries();
}

function moveMealEntryToDay(source, targetDay) {
  const targetMeal = mealForDayTabDrop(source.meal, targetDay);
  if (!targetMeal) return;
  if (source.day === targetDay && source.meal === targetMeal) return;

  const week = weekState();
  const sourceEntries = mealEntryList(slotEntries(week.slots?.[source.day]?.[source.meal]), source.meal);
  const movedEntry = sourceEntries[source.index];
  if (!movedEntry) return;

  const targetEntriesBeforeMove = mealEntriesForDayDropTarget(week, targetDay, targetMeal);
  const targetHasEntries = targetEntriesBeforeMove.some(Boolean);
  if (targetHasEntries && !window.confirm(`${displayMealName(targetMeal)} already has an entry on ${displayMealDayName(targetDay)}. Replace it?`)) {
    return;
  }

  if (source.index < minimumMealEntryCount(source.meal)) {
    sourceEntries[source.index] = "";
  } else {
    sourceEntries.splice(source.index, 1);
  }
  week.slots[source.day][source.meal] = compactMealSlotEntries(sourceEntries, source.meal);

  if (isCombinedMealKey(targetMeal)) {
    activateCombinedMealForDayDrop(week, targetDay, targetMeal);
  }

  const targetEntries = targetHasEntries
    ? [plannedEntryAtLocation(movedEntry, targetDay, targetMeal)]
    : mealEntryList(slotEntries(week.slots?.[targetDay]?.[targetMeal]), targetMeal);
  if (!targetHasEntries) {
    const targetIndex = firstAvailableMealEntryIndex(targetEntries);
    targetEntries[targetIndex] = plannedEntryAtLocation(movedEntry, targetDay, targetMeal);
  }
  week.slots[targetDay][targetMeal] = compactMealSlotEntries(targetEntries, targetMeal);

  setActivePlannerDayId(targetDay);
  syncMakeAheadTasksForWeek(weekKey(), week);
  persist();
  renderPlanner();
  renderGroceries();
}

function mealForDayTabDrop(sourceMeal, targetDayId) {
  const targetDay = prepDays.find((day) => day.id === targetDayId);
  if (!targetDay) return "";
  if (isCombinedMealKey(sourceMeal)) {
    return combinedMealSections[sourceMeal].members.some((meal) => targetDay.meals.includes(meal)) ? sourceMeal : "";
  }
  return targetDay.meals.includes(sourceMeal) ? sourceMeal : "";
}

function mealEntriesForDayDropTarget(week, targetDay, targetMeal) {
  if (!isCombinedMealKey(targetMeal)) return slotEntries(week.slots?.[targetDay]?.[targetMeal]);
  const day = prepDays.find((item) => item.id === targetDay);
  const members = combinedMealSections[targetMeal].members.filter((meal) => day?.meals.includes(meal));
  return [
    ...slotEntries(week.slots?.[targetDay]?.[targetMeal]),
    ...members.flatMap((meal) => slotEntries(week.slots?.[targetDay]?.[meal]))
  ];
}

function activateCombinedMealForDayDrop(week, targetDay, targetMeal) {
  const day = prepDays.find((item) => item.id === targetDay);
  const members = combinedMealSections[targetMeal].members.filter((meal) => day?.meals.includes(meal));
  if (members.length < 2) return;
  if (!week.slots[targetDay]) week.slots[targetDay] = {};
  members.forEach((meal) => {
    week.slots[targetDay][meal] = "";
  });
  setCombinedMealSection(week, targetDay, targetMeal, members);
}

function displayMealDayName(dayId) {
  return prepDays.find((day) => day.id === dayId)?.name || "that day";
}

function firstAvailableMealEntryIndex(entries) {
  const index = entries.findIndex((entry) => !entry);
  return index >= 0 ? index : entries.length;
}

function isCombinedMealKey(meal) {
  return Boolean(combinedMealSections[meal]);
}

function combineGroupKeyForMeal(meal) {
  if (isCombinedMealKey(meal)) return meal;
  return Object.keys(combinedMealSections).find((key) => combinedMealSections[key].members.includes(meal)) || "";
}

function isCombinableMeal(meal) {
  const key = combineGroupKeyForMeal(meal);
  return Boolean(key && (meal === key || combinedMealSections[key].members.includes(meal)));
}

function canCombineMealSections(sourceDay, sourceMeal, targetDay, targetMeal) {
  if (!sourceDay || sourceDay !== targetDay || sourceMeal === targetMeal) return false;
  const sourceGroup = combineGroupKeyForMeal(sourceMeal);
  const targetGroup = combineGroupKeyForMeal(targetMeal);
  if (!sourceGroup || sourceGroup !== targetGroup) return false;
  const members = combinedMealSections[sourceGroup].members;
  return (sourceMeal === sourceGroup || members.includes(sourceMeal))
    && (targetMeal === targetGroup || members.includes(targetMeal));
}

function combineMealSections(dayId, sourceMeal, targetMeal) {
  const combinedMeal = combineGroupKeyForMeal(sourceMeal);
  if (!canCombineMealSections(dayId, sourceMeal, dayId, targetMeal) || !combinedMeal) return;
  const week = weekState();
  const slots = week.slots;
  if (!slots[dayId]) slots[dayId] = {};
  const members = combinedMealSections[combinedMeal].members;
  const day = prepDays.find((item) => item.id === dayId);
  const currentMembers = combinedMealMembersForDay(day, week.combinedMealSections, combinedMeal);
  const sourceMembers = sourceMeal === combinedMeal ? currentMembers : members.includes(sourceMeal) ? [sourceMeal] : [];
  const targetMembers = targetMeal === combinedMeal ? currentMembers : members.includes(targetMeal) ? [targetMeal] : [];
  const nextMembers = [...new Set([...currentMembers, ...sourceMembers, ...targetMembers])]
    .filter((meal) => members.includes(meal) && day?.meals.includes(meal));
  if (nextMembers.length < 2) return;
  const combinedEntries = [
    ...slotEntries(slots[dayId][combinedMeal]),
    ...nextMembers
      .filter((meal) => meal === sourceMeal || meal === targetMeal || !currentMembers.includes(meal))
      .flatMap((meal) => slotEntries(slots[dayId][meal]))
  ];
  slots[dayId][combinedMeal] = compactMealSlotEntries(
    combinedEntries.map((entry) => plannedEntryAtLocation(entry, dayId, combinedMeal)),
    combinedMeal
  );
  nextMembers.forEach((meal) => {
    slots[dayId][meal] = "";
  });
  setCombinedMealSection(week, dayId, combinedMeal, nextMembers);
  syncMakeAheadTasksForWeek(weekKey(), week);
  persist();
  renderPlanner();
  renderGroceries();
}

function commitMealInput(input) {
  const rawValue = input.value.trim();
  const recipe = activeRecipes().find((item) => normalize(item.name) === normalize(rawValue));
  const groceryItem = recipe ? "" : grocerySuggestionItems().find((item) => normalize(item) === normalize(rawValue));
  const week = weekState();
  const currentEntries = slotEntries(week.slots?.[input.dataset.day]?.[input.dataset.meal]);
  const index = Number(input.dataset.index || 0);
  const nextEntries = mealEntryList(currentEntries, input.dataset.meal);
  const currentEntry = nextEntries[index];
  const nextValue = recipe
    ? recipeIdForSlot(currentEntry) === recipe.id && isPlannedRecipeEntry(currentEntry)
      ? currentEntry
      : createPlannedRecipeEntry(recipe, input.dataset.day, input.dataset.meal)
    : groceryItem ? groceryMealSlotId(groceryItem) : rawValue;
  nextEntries[index] = nextValue;
  editingMealEntry = null;
  setMeal(input.dataset.day, input.dataset.meal, compactMealSlotEntries(nextEntries, input.dataset.meal));
}

function updateMealPlannedServings(input) {
  const day = input.dataset.day;
  const meal = input.dataset.meal;
  const index = Number(input.dataset.index);
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
  const recipe = recipeForSlot(entries[index]);
  if (!recipe || recipe.virtualGroceryRecipe) return;
  const currentEntry = isPlannedRecipeEntry(entries[index])
    ? entries[index]
    : createPlannedRecipeEntry(recipe, day, meal);
  currentEntry.plannedServings = Math.max(0.25, Number(input.value) || recipeDefaultServings(recipe));
  entries[index] = normalizePlannedRecipeEntry(currentEntry);
  input.value = String(entries[index].plannedServings);
  setMeal(day, meal, compactMealSlotEntries(entries, meal));
}

function mealInputValue(slotValue) {
  if (!slotValue) return "";
  const specialMeal = specialMealForSlot(slotValue);
  if (specialMeal) return specialMealDisplayText(specialMeal);
  return recipeForSlot(slotValue)?.name || slotValue;
}

function isSpecialMealSlot(slotValue) {
  return String(slotValue || "").startsWith(specialMealPrefix);
}

function specialMealSlotId(type, note = "", restaurant = null) {
  const base = `${specialMealPrefix}${encodeURIComponent(String(type || "").trim())}::${encodeURIComponent(String(note || "").trim())}`;
  if (!restaurant) return base;
  return `${base}::${encodeURIComponent(JSON.stringify(restaurant))}`;
}

function specialMealForSlot(slotValue) {
  if (!isSpecialMealSlot(slotValue)) return null;
  const parts = String(slotValue).slice(specialMealPrefix.length).split("::");
  const type = decodeURIComponent(parts[0] || "").trim();
  if (!["out", "leftovers"].includes(type)) return null;
  let restaurant = null;
  if (parts[2]) { try { restaurant = JSON.parse(decodeURIComponent(parts[2])); } catch {} }
  return {
    type,
    note: decodeURIComponent(parts[1] || "").trim(),
    restaurant
  };
}

function specialMealLabel(type) {
  return type === "out" ? "Out" : "Leftovers";
}

function specialMealDisplayText(specialMeal) {
  return [specialMealLabel(specialMeal.type), specialMeal.note].filter(Boolean).join(" - ");
}

function specialMealPlaceholder(type) {
  return type === "out" ? "Where are you eating?" : "What leftovers?";
}

function isGroceryMealSlot(slotValue) {
  return String(slotValue || "").startsWith(groceryMealPrefix);
}

function parseGroceryMealSlot(slotValue) {
  if (!isGroceryMealSlot(slotValue)) return null;
  const parts = String(slotValue).slice(groceryMealPrefix.length).split("::");
  const item = decodeURIComponent(parts[0] || "").trim();
  if (!item) return null;
  return {
    item,
    servings: Math.max(1, Number(parts[1]) || 1)
  };
}

function addMealEntry(day, meal) {
  const week = weekState();
  const entries = slotEntries(week.slots?.[day]?.[meal]);
  if (mealEntryList(entries, meal).some((entry) => !entry)) return;
  setMeal(day, meal, [...entries, ""]);
}

function openMealRecipePicker(day, meal, index) {
  if (!day || !meal || Number.isNaN(index)) return;
  setPendingMealRecipeSelection({ day, meal, index });
  openRecipeBoxPage();
  renderFolders();
}

function openMealIngredientPicker(day, meal, index) {
  if (!day || !meal || Number.isNaN(index)) return;
  setPendingMealIngredientSelection({ day, meal, index });
  closeFloatingMenus();
  elements.groceryLibraryInput.placeholder = "Search items…";
  renderGroceryLibrary();
  elements.groceryLibraryInput.value = "";
  elements.groceryLibraryDialog.showModal();
  focusGroceryLibraryInput();
}

function chooseRecipeForPendingMeal(recipeId) {
  if (!getPendingMealRecipeSelection() || !recipeId) return;
  const { day, meal, index } = getPendingMealRecipeSelection();
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
  const recipe = activeRecipes().find((item) => item.id === recipeId);
  if (!recipe) return;
  entries[index] = createPlannedRecipeEntry(recipe, day, meal);
  setPendingMealRecipeSelection(null);
  setMeal(day, meal, compactMealSlotEntries(entries, meal));
  elements.recipeBoxPageDialog.close();
}

function chooseIngredientForPendingMeal(item) {
  if (!getPendingMealIngredientSelection() || !item) return;
  const { day, meal, index } = getPendingMealIngredientSelection();
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
  entries[index] = groceryMealSlotId(item);
  setPendingMealIngredientSelection(null);
  setMeal(day, meal, compactMealSlotEntries(entries, meal));
  elements.groceryLibraryDialog.close();
}

function setSpecialMealEntry(day, meal, index, type) {
  if (!["out", "leftovers"].includes(type)) return;
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
  entries[index] = specialMealSlotId(type);
  setMeal(day, meal, compactMealSlotEntries(entries, meal));
  window.requestAnimationFrame(() => {
    const input = elements.plannerGrid.querySelector(`[data-special-meal-note][data-day="${CSS.escape(day)}"][data-meal="${CSS.escape(meal)}"][data-index="${index}"]`);
    input?.focus();
  });
}

function updateSpecialMealNote(input) {
  const day = input.dataset.day;
  const meal = input.dataset.meal;
  const index = Number(input.dataset.index);
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
  const specialMeal = specialMealForSlot(entries[index]);
  if (!specialMeal) return;
  entries[index] = specialMealSlotId(specialMeal.type, input.value);
  setMeal(day, meal, compactMealSlotEntries(entries, meal));
}

function removeMealEntry(day, meal, index) {
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
  if (index < minimumMealEntryCount(meal)) {
    entries[index] = "";
  } else {
    entries.splice(index, 1);
  }
  setMeal(day, meal, compactMealSlotEntries(entries, meal));
}

function syncMakeAheadTasksForWeek(key = weekKey(), week = weekState()) {
  const plannedRecipeIds = mealPlanRecipeIdsForWeek(week);
  const shouldKeepTask = (task) => {
    if (!isMakeAheadTask(task) || !task.sourceRecipeId) return true;
    return task.weekKey !== key || plannedRecipeIds.has(task.sourceRecipeId);
  };
  state.doBacklog = normalizeDoTasks(state.doBacklog).filter(shouldKeepTask);
  if (state.doPlans?.[key]) {
    prepDays.forEach((day) => {
      state.doPlans[key][day.id] = normalizeDoTasks(state.doPlans[key][day.id]).filter(shouldKeepTask);
    });
  }
}

function mealPlanRecipeIdsForWeek(week) {
  const ids = new Set();
  prepDays.forEach((day) => {
    [...day.meals, ...Object.keys(combinedMealSections)].forEach((meal) => {
      slotEntries(week.slots?.[day.id]?.[meal]).forEach((entry) => {
        const recipe = recipeForSlot(entry);
        if (recipe && !recipe.virtualGroceryRecipe) ids.add(recipe.id);
      });
    });
  });
  return ids;
}

function isMakeAheadTask(task) {
  return normalize(task?.title || "").startsWith("make ahead:");
}

function emptyMealSlotTemplate() {
  return `<div class="slot-card placeholder-slot" aria-hidden="true"></div>`;
}

function ensureActivePlannerDay() {
  const activeDay = prepDays.find((day) => day.id === getActivePlannerDayId()) || prepDays[0];
  setActivePlannerDayId(activeDay.id);
  return activeDay;
}

function selectPlannerDay(dayId) {
  if (!prepDays.some((day) => day.id === dayId)) return;
  setActivePlannerDayId(dayId);
  editingMealEntry = null;
  if (getActiveAppArea() === "do") {
    renderDoPlanner();
    renderTasksPage();
  } else if (getActiveAppArea() === "play") {
    renderPlayPlanner();
  } else {
    renderPlanner();
  }
}

function clearPlannerDay(dayId, options = {}) {
  const day = prepDays.find((item) => item.id === dayId);
  if (!day) return;
  if (options.confirm && !window.confirm(`Clear all meals for ${day.name}?`)) return;
  const week = weekState();
  clearPlannerDaySlots(week, day);
  syncMakeAheadTasksForWeek(weekKey(), week);
  persist();
  renderPlanner();
  renderGroceries();
}

function clearPlannerDaySlots(week, day) {
  [...day.meals, ...Object.keys(combinedMealSections)].forEach((meal) => {
    week.slots[day.id][meal] = "";
  });
  if (week.combinedMealSections?.[day.id]) {
    Object.keys(combinedMealSections).forEach((meal) => {
      week.combinedMealSections[day.id][meal] = false;
    });
  }
  week.mealPlanView = "edit";
}

function clearPlannerWeek() {
  if (!window.confirm("Clear all meals for this week?")) return;
  const week = weekState();
  clearPlannerWeekSlots(week);
  syncMakeAheadTasksForWeek(weekKey(), week);
  persist();
  renderPlanner();
  renderGroceries();
}

function clearPlannerWeekSlots(week) {
  prepDays.forEach((day) => clearPlannerDaySlots(week, day));
  week.mealPlanView = "edit";
  week.publishedSlots = null;
  week.publishedCombinedMealSections = {};
  if (state.publishedWeeks?.[weekKey()]) delete state.publishedWeeks[weekKey()];
}

function clearMealSection(dayId, meal) {
  const day = prepDays.find((item) => item.id === dayId);
  if (!day || (!day.meals.includes(meal) && !isCombinedMealKey(meal))) return;
  const displayMeal = displayMealName(meal);
  if (!window.confirm(isCombinedMealKey(meal) ? `Clear "${displayMeal}" and restore separate sections?` : `Clear all entries in ${displayMeal}?`)) return;
  const week = weekState();
  week.slots[day.id][meal] = "";
  if (isCombinedMealKey(meal)) setCombinedMealSection(week, day.id, meal, false);
  syncMakeAheadTasksForWeek(weekKey(), week);
  persist();
  renderPlanner();
  renderGroceries();
}

function autoGenerateMealSection(dayId, meal) {
  const day = prepDays.find((item) => item.id === dayId);
  if (!day || (!day.meals.includes(meal) && !isCombinedMealKey(meal))) return;
  const recipes = autoGenerateCandidateRecipes();
  if (!recipes.length) {
    window.alert("Add recipes to the Recipe Box before auto-generating a meal.");
    return;
  }

  const week = weekState();
  week.mealPlanView = "edit";
  const previousSlots = JSON.stringify(week.slots);
  const recipeQueue = shuffled(recipes);
  const context = createAutoGenerateContext(recipes);
  const result = autoGenerateMealEntries(week, day, meal, recipeQueue, 0, context);

  if (context.missingFolders.size) {
    try { week.slots = JSON.parse(previousSlots); } catch { /* state unchanged if restore fails */ }
    window.alert(missingFolderMessage(context.missingFolders));
    return;
  }

  if (!result.filledCount) {
    window.alert(`${displayMealName(meal)} already has an entry. Clear it first to auto-fill it.`);
    return;
  }

  persist();
  renderPlanner();
  renderGroceries();
}

function autoGeneratePlannerDay(dayId) {
  const day = prepDays.find((item) => item.id === dayId);
  if (!day) return;
  const recipes = autoGenerateCandidateRecipes();
  if (!recipes.length) {
    window.alert("Add recipes to the Recipe Box before auto-generating a meal plan.");
    return;
  }

  const week = weekState();
  week.mealPlanView = "edit";
  const previousSlots = JSON.stringify(week.slots);
  const previousCombined = JSON.stringify(week.combinedMealSections || {});
  clearPlannerDaySlots(week, day);
  const recipeQueue = shuffled(recipes);
  const context = createAutoGenerateContext(recipes);
  const combinedState = combinedMealSectionsForWeek(week);

  let queueIndex = 0;
  let filledCount = 0;
  mealKeysForDay(day, combinedState).forEach((meal) => {
    const result = autoGenerateMealEntries(week, day, meal, recipeQueue, queueIndex, context);
    queueIndex = result.nextIndex;
    filledCount += result.filledCount;
  });

  if (context.missingFolders.size) {
    try { week.slots = JSON.parse(previousSlots); } catch { /* leave as-is */ }
    try { week.combinedMealSections = JSON.parse(previousCombined); } catch { /* leave as-is */ }
    window.alert(missingFolderMessage(context.missingFolders));
    return;
  }

  if (!filledCount) {
    window.alert("No eligible Auto-Fill Rules filled this day.");
    return;
  }

  persist();
  renderPlanner();
  renderGroceries();
}

function updateMealPlannedServingsFromContext(servings, mealContext) {
  if (!mealContext?.day || !mealContext?.meal || Number.isNaN(mealContext.index)) return;
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[mealContext.day]?.[mealContext.meal]), mealContext.meal);
  const recipe = recipeForSlot(entries[mealContext.index]);
  if (!recipe || recipe.virtualGroceryRecipe) return;
  const entry = isPlannedRecipeEntry(entries[mealContext.index])
    ? entries[mealContext.index]
    : createPlannedRecipeEntry(recipe, mealContext.day, mealContext.meal);
  entry.plannedServings = Math.max(0.25, Number(servings) || recipeDefaultServings(recipe));
  entries[mealContext.index] = normalizePlannedRecipeEntry(entry);
  week.slots[mealContext.day][mealContext.meal] = compactMealSlotEntries(entries, mealContext.meal);
  persist();
  renderPlanner();
  renderGroceries();
}

function updateGroceryMealServing(item, servings, mealContext) {
  if (!item || !mealContext?.day || !mealContext?.meal || Number.isNaN(mealContext.index)) return;
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[mealContext.day]?.[mealContext.meal]), mealContext.meal);
  entries[mealContext.index] = groceryMealSlotId(item, servings);
  week.slots[mealContext.day][mealContext.meal] = compactMealSlotEntries(entries, mealContext.meal);
  persist();
  renderGroceries();
}

function setMeal(day, meal, recipeId) {
  const week = weekState();
  if (!week.slots[day]) week.slots[day] = {};
  week.slots[day][meal] = recipeId;
  syncMakeAheadTasksForWeek(weekKey(), week);
  persist();
  renderPlanner();
  renderGroceries();
}

function removeRecipeFromMealSlots(slots, recipeId) {
  if (!slots) return;
  prepDays.forEach((day) => {
    [...day.meals, ...Object.keys(combinedMealSections)].forEach((meal) => {
      const slotValue = slots?.[day.id]?.[meal];
      if (Array.isArray(slotValue)) {
        slots[day.id][meal] = compactSlotEntries(slotValue.filter((entry) => recipeIdForSlot(entry) !== recipeId));
      } else if (recipeIdForSlot(slotValue) === recipeId) {
        slots[day.id][meal] = "";
      }
    });
  });
}

function autoGenerateMealPlan() {
  const recipes = autoGenerateCandidateRecipes();
  if (!recipes.length) {
    window.alert("Add recipes to the Recipe Box before auto-generating a meal plan.");
    return;
  }

  const week = weekState();
  week.mealPlanView = "edit";
  const previousSlots = JSON.stringify(week.slots);
  const previousCombined = JSON.stringify(week.combinedMealSections || {});
  const previousPublishedSlots = JSON.stringify(week.publishedSlots || null);
  const previousPublishedCombined = JSON.stringify(week.publishedCombinedMealSections || {});
  clearPlannerWeekSlots(week);
  const recipeQueue = shuffled(recipes);
  const context = createAutoGenerateContext(recipes);
  const combinedState = combinedMealSectionsForWeek(week);

  let queueIndex = 0;
  let filledCount = 0;

  prepDays.forEach((day) => {
    mealKeysForDay(day, combinedState).forEach((meal) => {
      const result = autoGenerateMealEntries(week, day, meal, recipeQueue, queueIndex, context);
      queueIndex = result.nextIndex;
      filledCount += result.filledCount;
    });
  });

  if (context.missingFolders.size) {
    try { week.slots = JSON.parse(previousSlots); } catch { /* leave as-is */ }
    try { week.combinedMealSections = JSON.parse(previousCombined); } catch { /* leave as-is */ }
    try { week.publishedSlots = JSON.parse(previousPublishedSlots); } catch { /* leave as-is */ }
    try { week.publishedCombinedMealSections = JSON.parse(previousPublishedCombined); } catch { /* leave as-is */ }
    window.alert(missingFolderMessage(context.missingFolders));
    return;
  }

  if (!filledCount) {
    window.alert("No eligible Auto-Fill Rules filled this week.");
    return;
  }

  persist();
  renderPlanner();
  renderGroceries();
}

function nextGeneratedRecipe(recipeQueue, startIndex, meal, rule, context) {
  const eligibleRecipes = eligibleRecipesForMeal(recipeQueue, meal, rule);
  if (!eligibleRecipes.length && rule && ["folder", "folderSame"].includes(rule.action)) {
    context.missingFolders.add(rule.folderName || "selected folder");
    return { id: "", nextIndex: startIndex };
  }
  if (!eligibleRecipes.length && rule?.action === "tags") {
    return { id: "", nextIndex: startIndex };
  }
  if (!eligibleRecipes.length) return { id: recipeQueue[startIndex % recipeQueue.length].id, nextIndex: startIndex + 1 };
  const recipe = pickAutoGeneratedRecipe(eligibleRecipes, startIndex, rule);
  return { id: recipe.id, nextIndex: startIndex + 1 };
}

function autoGenerateMealEntries(week, day, meal, recipeQueue, startIndex, context) {
  const entries = mealEntryList(slotEntries(week.slots[day.id][meal]), meal);
  const targetEntryCount = Math.max(entries.length, autoRuleEntryCount(day.id, meal));
  while (entries.length < targetEntryCount) entries.push("");
  let nextIndex = startIndex;
  let filledCount = 0;

  entries.forEach((entry, index) => {
    const rule = autoGenerateRuleForSlot(day, meal, index);
    if (entry || rule?.action === "skip") return;
    if (rule?.action === "ingredient") {
      if (!rule.value) return;
      entries[index] = isGroceryMealSlot(rule.value) ? rule.value : groceryMealSlotId(rule.value);
    } else if (rule?.action === "custom") {
      if (!rule.value) return;
      const value = recipeOrCustomMealValue(rule.value, day.id, meal);
      if (!value) return;
      entries[index] = value;
    } else if (rule?.action === "folderSame") {
      const recipe = sharedAutoGenerateRecipe(rule, recipeQueue, context);
      if (!recipe) return;
      entries[index] = createPlannedRecipeEntry(recipe, day.id, meal);
    } else if (rule?.action === "tags") {
      const recipe = nextGeneratedRecipe(recipeQueue, nextIndex, meal, rule, context);
      if (!recipe.id) return;
      entries[index] = createPlannedRecipeEntry(
        activeRecipes().find((item) => item.id === recipe.id),
        day.id,
        meal
      );
      nextIndex = recipe.nextIndex;
    } else {
      const recipe = nextGeneratedRecipe(recipeQueue, nextIndex, meal, rule, context);
      if (!recipe.id) return;
      entries[index] = createPlannedRecipeEntry(
        activeRecipes().find((item) => item.id === recipe.id),
        day.id,
        meal
      );
      nextIndex = recipe.nextIndex;
    }
    filledCount += 1;
  });

  if (filledCount) {
    week.slots[day.id][meal] = compactMealSlotEntries(entries, meal);
  }
  return { nextIndex, filledCount };
}

function createAutoGenerateContext(recipes) {
  return {
    recipes,
    sharedSelections: new Map(),
    missingFolders: new Set()
  };
}

function autoGenerateRuleForSlot(day, meal, index) {
  state.autoGenerateRules = normalizeAutoGenerateRules(state.autoGenerateRules);
  const rules = state.autoGenerateRules.filter((rule) => (
    rule.meal === meal && rule.index === index && rule.dayIds.includes(day.id)
  ));
  return rules.find((rule) => rule.dayIds.length === 1 && rule.dayIds[0] === day.id) || rules[0] || null;
}

function sharedAutoGenerateRecipe(rule, recipeQueue, context) {
  if (context.sharedSelections.has(rule.id)) return context.sharedSelections.get(rule.id);
  const eligibleRecipes = eligibleRecipesForMeal(recipeQueue, rule.meal, rule);
  const recipe = pickAutoGeneratedRecipe(eligibleRecipes, 0, rule) || null;
  if (!recipe) {
    context.missingFolders.add(rule.folderName || "selected folder");
    return null;
  }
  context.sharedSelections.set(rule.id, recipe);
  return recipe;
}

function eligibleRecipesForMeal(recipes, meal, rule = null) {
  const candidateRecipes = recipes;
  if (rule?.action === "tags") return eligibleRecipesForTags(candidateRecipes, rule);
  if (!rule || !["folder", "folderSame"].includes(rule.action)) return candidateRecipes;
  const folderId = folderIdByName(rule.folderName);
  if (!folderId) return [];
  const eligibleFolderIds = autoEligibleFolderIds(folderId);
  return shuffled(candidateRecipes.filter((recipe) => eligibleFolderIds.has(recipe.folderId)));
}

function autoGenerateCandidateRecipes() {
  return activeRecipes().filter((recipe) => recipe.name);
}

function eligibleRecipesForTags(recipes, rule) {
  const tags = normalizeRecipeTagSelection(rule.tags);
  if (!tags.length) return [];
  return recipes.filter((recipe) => {
    const recipeTags = normalizeRecipeTagSelection(recipe.tags).map(normalize);
    const ruleTags = tags.map(normalize);
    return rule.tagMatchMode === "all"
      ? ruleTags.every((tag) => recipeTags.includes(tag))
      : ruleTags.some((tag) => recipeTags.includes(tag));
  });
}

function pickAutoGeneratedRecipe(recipes, startIndex, rule = null) {
  if (!recipes.length) return null;
  if (rule?.selectionMode === "leastRecent") {
    const oldestTime = Math.min(...recipes.map(recipeLastCookedTime));
    const leastRecent = recipes.filter((recipe) => recipeLastCookedTime(recipe) === oldestTime);
    return shuffled(leastRecent)[0] || null;
  }
  return recipes[startIndex % recipes.length];
}

function recipeLastCookedTime(recipe) {
  const logs = normalizeCookLog(recipe.cookLog);
  if (!logs.length) return 0;
  const latest = Math.max(...logs.map((entry) => Date.parse(entry.cookedAt)).filter((time) => !Number.isNaN(time)));
  return Number.isFinite(latest) ? latest : 0;
}

function autoEligibleFolderIds(folderId) {
  const folder = normalizedFolders().find((item) => item.id === folderId);
  if (!folder) return new Set();
  const folderIds = new Set([folderId]);
  normalizedFolders().forEach((candidate) => {
    if (isDescendantFolder(candidate.id, folderId)) {
      folderIds.add(candidate.id);
    }
  });
  return folderIds;
}

function missingFolderMessage(folderNames) {
  const names = [...folderNames].map((name) => `"${name}"`).join(", ");
  return `Add at least one recipe to ${names} before auto-generating meals that use that folder.`;
}

function folderIdByName(name) {
  return normalizedFolders().find((folder) => normalize(folder.name) === normalize(name))?.id || "";
}

function isWeekdayBreakfastSlot(day, meal) {
  return meal === "MJ Breakfast" && weekdayBreakfastDayIds.has(day.id);
}

function slotHasMealSelection(slotValue) {
  return slotEntries(slotValue).some(Boolean);
}

function shuffled(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function repeatMeal(day, meal) {
  const week = weekState();
  const recipeId = week.slots[day][meal];
  if (!slotEntries(recipeId).length) return;

  const dayIndex = prepDays.findIndex((item) => item.id === day);
  const nextDay = prepDays[dayIndex + 1];
  if (nextDay?.meals.includes(meal)) {
    week.slots[nextDay.id][meal] = Array.isArray(recipeId) ? [...recipeId] : recipeId;
    persist();
    renderPlanner();
    renderGroceries();
  }
}

async function toggleMealPlanView() {
  const week = weekState();
  editingMealEntry = null;
  let justPublished = false;
  if (isPublishedMealPlanView(week)) {
    week.mealPlanView = "edit";
  } else {
    const reviewItems = unlistedGroceryItemsForWeek(week);
    if (reviewItems.length) {
      openGroceryReviewItems(reviewItems, "Add these to Grocery Items, or edit the source recipe if there is a typo. Then press Publish again.");
      return;
    }
    week.publishedSlots = cloneMealSlots(week.slots);
    week.publishedCombinedMealSections = cloneCombinedMealSections(week.combinedMealSections);
    ensureMealSlotShape(week.publishedSlots);
    ensureCombinedMealSectionShape(week.publishedCombinedMealSections);
    week.mealPlanView = "published";
    archivePublishedWeek(week);
    justPublished = true;
  }
  persist();
  if (justPublished) {
    await persistImmediately("published week");
  }
  renderPlanner();
  renderGroceries();
  if (isPublishedMealPlanView(week)) openPublishedGroceryReview();
}

function archivePublishedWeek(week) {
  if (!state.publishedWeeks || Array.isArray(state.publishedWeeks)) {
    state.publishedWeeks = normalizePublishedWeeks(state.publishedWeeks);
  }
  const key = weekKey();
  const start = dateFromWeekKey(key);
  state.publishedWeeks[key] = {
    weekKey: key,
    startDate: key,
    endDate: dateKeyFromDate(addDays(start, 7)),
    rangeLabel: formatWeekRange(start),
    publishedAt: new Date().toISOString(),
    slots: cloneMealSlots(week.publishedSlots || week.slots),
    combinedMealSections: cloneCombinedMealSections(week.publishedCombinedMealSections || week.combinedMealSections),
    manualGroceries: Array.isArray(week.manualGroceries) ? [...week.manualGroceries] : [],
    notes: week.notes || ""
  };
}

function applyDefaultMealEntries(week) {
  if (week.defaultMealEntriesApplied) return;
  prepDays.forEach((day) => {
    if (!weekdayDefaultDayIds.has(day.id)) return;
    defaultMealEntries.forEach((defaultEntry) => {
      applyDefaultMealEntry(week, day, defaultEntry);
    });
  });
  daySpecificDefaultMealEntries.forEach((defaultEntry) => {
    const day = prepDays.find((item) => item.id === defaultEntry.dayId);
    if (day) applyDefaultMealEntry(week, day, defaultEntry);
  });
  week.defaultMealEntriesApplied = true;
}

function applyDefaultMealEntry(week, day, defaultEntry) {
  if (!day.meals.includes(defaultEntry.meal)) return;
  const entries = mealEntryList(slotEntries(week.slots[day.id][defaultEntry.meal]), defaultEntry.meal);
  if (entries[defaultEntry.index]) return;
  entries[defaultEntry.index] = recipeOrCustomMealValue(defaultEntry.value, day.id, defaultEntry.meal);
  week.slots[day.id][defaultEntry.meal] = compactMealSlotEntries(entries, defaultEntry.meal);
}

function recipeOrCustomMealValue(value, dayId = "", meal = "") {
  if (isPlannedRecipeEntry(value)) return normalizePlannedRecipeEntry(value);
  if (isGroceryMealSlot(value)) return value;
  const recipeById = activeRecipes().find((item) => item.id === value);
  if (recipeById) return createPlannedRecipeEntry(recipeById, dayId, meal);
  const recipe = activeRecipes().find((item) => normalize(item.name) === normalize(value));
  if (!recipe) {
    const groceryItem = grocerySuggestionItems({ includeCurrentGroceries: false }).find((item) => normalize(item) === normalize(value));
    return groceryItem ? groceryMealSlotId(groceryItem) : value;
  }
  return createPlannedRecipeEntry(recipe, dayId, meal);
}

function mealPlanNutritionTotals(week = weekState()) {
  const entries = [];
  const slots = mealSlotsForWeek(week);
  const combinedState = combinedMealSectionsForWeek(week);
  prepDays.forEach((day) => mealKeysForDay(day, combinedState).forEach((meal) => {
    slotEntries(slots?.[day.id]?.[meal]).forEach((entry) => {
      const recipe = recipeForSlot(entry);
      if (recipe && !recipe.virtualGroceryRecipe) entries.push(entry);
    });
  }));
  return LiveMealPlanServings.sumMealPlanNutrition(
    entries,
    (recipeId) => activeRecipes().find((recipe) => recipe.id === recipeId)
  );
}

  return {
    addMealType,
    applyInitialMealPlanFocus,
    applyMealPlanConfigChange,
    autoGenerateMealPlan,
    cancelMealPlanContextPress,
    chooseIngredientForPendingAutoRule,
    chooseIngredientForPendingMeal,
    chooseRecipeForPendingAutoRule,
    chooseRecipeForPendingMeal,
    clearMealRestaurant,
    closeAutoRulesDialog,
    closeRestaurantInfoPopover,
    columnMealsForDay,
    combinedMealMembersForDay,
    createPlannedRecipeEntry,
    ensureActivePlannerDay,
    handleDocumentAutoRuleMouseMove,
    handleDocumentAutoRuleMouseUp,
    handleDocumentMealDragOver,
    handleDocumentMealDrop,
    handleMealPlanContextPressMove,
    handleMealTrashDragLeave,
    handleMealTrashDragOver,
    handleMealTrashDrop,
    handleMealTrashOverlayDragOver,
    handleMealTrashOverlayDrop,
    isAutoSlotEnabled,
    isMealDragEndingInTrash,
    mealContextCardTemplate,
    mealInputValue,
    mealPlanNotifBellHtml,
    mergeCombinedMealSections,
    missingRestoreAutoRules,
    normalizePlannedRecipeEntry,
    openAutoRulesDialog,
    openMealPlanContextMenu,
    openMealPlanSettingsDialog,
    parseGroceryMealSlot,
    removeRecipeFromMealSlots,
    renderAutoRules,
    renderPlanner,
    renderRestaurantSuggestions,
    restoreMealPlanSwipeScroll,
    saveMealPlanMealTypes,
    saveMealPlanMembers,
    searchRestaurantLocations,
    selectPlannerDay,
    setMeal,
    slotHasMealSelection,
    startMealPlanContextPress,
    updateGroceryMealServing,
    updateMealDragPoint,
    updateMealPlannedServingsFromContext,
    warmMealPlanRecipes,
  };
}
