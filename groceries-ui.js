// groceries-ui.js — Groceries domain extracted from app.js (createGroceriesModule).
// Pattern mirrors finance-ui.js / inventory-ui.js: pure normalizers exported top-level
// (called by app.js defaultState/normalizeState/mergeStates at boot, before the factory
// exists); the whole grocery UI lives in createGroceriesModule(deps).
//
// NOT here (stays in app.js): the boot/hydration + sync machinery, meal-plan & recipe
// code, the restaurant seam (uses this module's exposed groceryPlacesApiUrl/Options),
// and the legacy week.manualGroceries fold-in normalizer (normalizePersistentManual-
// Groceries). manualGroceries storage is unchanged (Decision #2b) — the live list is
// state.persistentManualGroceries (grocery section), which this module reads via `state`.
import * as LiveGroceryCatalog from './grocery-catalog.js';
import * as LiveGrocerySources from './grocery-sources.js';
import * as LiveReceiptDomain from './receipt-domain.js';
import * as LiveDailyDozen from './daily-dozen.js';
import * as LiveMealPlanServings from './meal-plan-servings.js';
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

// Live app state reference, set by the factory. Null before instantiation so the
// boot-time pure exports (normalizeGroceryItemName via normalizeState) see no aliases,
// matching app.js's pre-hydration behavior; `state` is a const in app.js (never
// reassigned), so this reference stays valid for the app's lifetime once set.
let _appState = null;

// Grocery constant data (moved verbatim from app.js).
const commonGroceryItems = [
  "apples", "arugula", "avocados", "baby spinach", "bagels", "bananas", "basil", "bell peppers", "black beans", "blueberries",
  "bread", "broccoli", "butter", "carrots", "cauliflower", "celery", "cheddar cheese", "chicken breasts", "chicken thighs",
  "cilantro", "coffee", "corn", "cucumbers", "eggs", "flour", "garlic", "ginger", "Greek yogurt", "green onions", "ground beef",
  "heavy cream", "hummus", "lemons", "lettuce", "limes", "milk", "mushrooms", "oats", "olive oil", "onions", "oranges",
  "pasta", "peanut butter", "potatoes", "rice", "salmon", "salsa", "salt", "shallots", "sour cream", "strawberries",
  "sweet potatoes", "tomatoes", "tortillas", "turkey", "yellow onions", "yogurt", "zucchini"
];

const groceryPriceProviders = {
  manual: {
    id: "manual",
    label: "Manual",
    async fetchPrices() {
      return [];
    }
  },
  receipt: {
    id: "receipt",
    label: "Past receipt",
    async fetchPrices() {
      return [];
    }
  }
};

// ── Pure normalizers / helpers (top-level exports; boot-safe) ──────────────
export function defaultGroceryBaseItems() {
  return normalizeGroceryBaseItems([
    ...commonGroceryItems,
    ...LiveGroceryCatalog.catalogEntries().map((entry) => entry.name)
  ]);
}

export function ensureGroceryCatalog(targetState) {
  if (targetState.groceryCatalogVersion >= 1) return;
  targetState.groceryBaseItems = normalizeGroceryBaseItems([
    ...(targetState.groceryBaseItems || []),
    ...LiveGroceryCatalog.catalogEntries().map((entry) => entry.name)
  ]);
  targetState.groceryCatalogVersion = 1;
}

export function normalizeGroceryBaseItems(items) {
  const normalizedItems = new Map();
  (Array.isArray(items) ? items : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .forEach((item) => {
      const identity = LiveGroceryCatalog.normalizeGroceryItemName(item);
      const key = identity.canonicalName || normalize(item);
      const displayName = identity.category === "Other" ? item : identity.displayName;
      if (!normalizedItems.has(key)) normalizedItems.set(key, displayName);
    });
  return [...normalizedItems.values()].sort((a, b) => normalize(a).localeCompare(normalize(b)));
}

export function defaultGroceryDailyDozenTags() {
  return LiveDailyDozen.seededTagMap((item) => LiveGroceryCatalog.normalizeGroceryItemName(item).canonicalName);
}

export function normalizeGroceryDailyDozenTags(tags) {
  return LiveDailyDozen.normalizeTagMap(tags, LiveDailyDozen.categories);
}

export function normalizeGrocerySplitPreferences(preferences) {
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) return {};
  return Object.fromEntries(Object.entries(preferences)
    .map(([key, value]) => [
      LiveGroceryCatalog.normalizeGroceryItemName(key).normalizedName,
      LiveGroceryCatalog.normalizeGroceryItemName(value).normalizedName
    ])
    .filter(([key, value]) => key && value));
}

export function normalizeGroceryAliases(aliases) {
  const normalizedAliases = {};
  Object.entries(aliases && typeof aliases === "object" && !Array.isArray(aliases) ? aliases : {}).forEach(([item, values]) => {
    const key = baseGroceryItemKey(item);
    if (!key) return;
    const seen = new Set();
    const list = (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .filter((value) => {
        const aliasKey = baseGroceryItemKey(value);
        if (!aliasKey || aliasKey === key || seen.has(aliasKey)) return false;
        seen.add(aliasKey);
        return true;
      });
    if (list.length) normalizedAliases[key] = list.sort((a, b) => normalize(a).localeCompare(normalize(b)));
  });
  return normalizedAliases;
}

export function normalizeGroceryStores(stores) {
  const seenNames = new Set();
  const seenIds = new Set();
  const seenPlaceIds = new Set();
  return (Array.isArray(stores) ? stores : [])
    .map((store) => {
      const id = String(store?.id || createId("store"));
      return {
        id,
        name: String(store?.name || "").trim(),
        chainName: String(store?.chainName || store?.name || "").trim(),
        address: String(store?.address || "").trim(),
        placeId: String(store?.placeId || "").trim(),
        latitude: normalizeStoreCoordinate(store?.latitude),
        longitude: normalizeStoreCoordinate(store?.longitude),
        types: Array.isArray(store?.types) ? store.types.map((type) => String(type || "").trim()).filter(Boolean) : [],
        sections: normalizeGroceryStoreSections(store?.sections, id),
        enabled: store?.enabled !== false
      };
    })
    .filter((store) => {
      const nameKey = normalize(store.name);
      const duplicateName = !store.placeId && seenNames.has(nameKey);
      const duplicatePlace = store.placeId && seenPlaceIds.has(store.placeId);
      if (!nameKey || duplicateName || duplicatePlace || seenIds.has(store.id)) return false;
      seenNames.add(nameKey);
      seenIds.add(store.id);
      if (store.placeId) seenPlaceIds.add(store.placeId);
      return true;
    });
}

export function defaultGroceryStoreSections(storeId) {
  return ["Produce", "Bakery", "Deli", "Dairy", "Dry Goods", "Frozen", "Household", "Other"]
    .map((name, index) => ({
      id: `${storeId}-section-${normalize(name).replace(/\s+/g, "-")}`,
      name,
      sortOrder: (index + 1) * 10
    }));
}

export function normalizeGroceryStoreSections(sections, storeId) {
  const source = Array.isArray(sections) && sections.length ? sections : defaultGroceryStoreSections(storeId);
  const seenIds = new Set();
  const seenNames = new Set();
  return source
    .map((section, index) => ({
      id: String(section?.id || `${storeId}-section-${index + 1}`),
      name: String(section?.name || "").trim(),
      sortOrder: Number.isFinite(Number(section?.sortOrder)) ? Number(section.sortOrder) : (index + 1) * 10
    }))
    .filter((section) => {
      const nameKey = normalize(section.name);
      if (!nameKey || seenIds.has(section.id) || seenNames.has(nameKey)) return false;
      seenIds.add(section.id);
      seenNames.add(nameKey);
      return true;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || normalize(a.name).localeCompare(normalize(b.name)))
    .map((section, index) => ({ ...section, sortOrder: (index + 1) * 10 }));
}

export function normalizeGroceryChecklist(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const seen = new Set();
  const config = (Array.isArray(src.config) ? src.config : [])
    .map((entry) => {
      const name = String((entry && entry.name) || (typeof entry === "string" ? entry : "")).trim();
      if (!name) return null;
      const id = String((entry && entry.id) || "").trim() || `cl_${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      return { id, name };
    })
    .filter((entry) => entry && !seen.has(entry.id) && seen.add(entry.id));
  const provisional = src.provisional && typeof src.provisional === "object" ? src.provisional : {};
  const submissions = src.submissions && typeof src.submissions === "object" ? src.submissions : {};
  return { config, provisional, submissions, seeded: Boolean(src.seeded) };
}

export function normalizeStoreCoordinate(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeGroceryItemLocations(locations, stores = []) {
  const validStoreIds = new Set(normalizeGroceryStores(stores).map((store) => store.id));
  const normalizedLocations = {};
  Object.entries(locations && typeof locations === "object" && !Array.isArray(locations) ? locations : {}).forEach(([itemKey, location]) => {
    const key = baseGroceryItemKey(itemKey);
    if (!key || !location || typeof location !== "object") return;
    const storeId = validStoreIds.has(String(location.storeId || "")) ? String(location.storeId) : "";
    const order = Number(location.order);
    const existingRank = Array.isArray(location.storeRank)
      ? location.storeRank.map(String).filter((id) => validStoreIds.has(id))
      : [];
    const storeRank = storeId
      ? [storeId, ...existingRank.filter((id) => id !== storeId)]
      : existingRank;
    normalizedLocations[key] = {
      storeId,
      storeRank,
      order: Number.isFinite(order) ? order : 0
    };
  });
  return normalizedLocations;
}

export function normalizeGroceryStoreItemSections(mappings, stores = []) {
  const normalized = {};
  const normalizedStores = normalizeGroceryStores(stores);
  const storeById = new Map(normalizedStores.map((store) => [store.id, store]));
  Object.entries(mappings && typeof mappings === "object" && !Array.isArray(mappings) ? mappings : {}).forEach(([storeId, itemMappings]) => {
    const store = storeById.get(storeId);
    if (!store || !itemMappings || typeof itemMappings !== "object" || Array.isArray(itemMappings)) return;
    const validSectionIds = new Set(store.sections.map((section) => section.id));
    Object.entries(itemMappings).forEach(([itemName, sectionId]) => {
      const itemKey = baseGroceryItemKey(itemName);
      if (!itemKey || !validSectionIds.has(String(sectionId || ""))) return;
      if (!normalized[storeId]) normalized[storeId] = {};
      normalized[storeId][itemKey] = String(sectionId);
    });
  });
  return normalized;
}

export function normalizeReceipts(receipts) {
  return (Array.isArray(receipts) ? receipts : []).map((receipt) => LiveReceiptDomain.normalizeReceipt(receipt, createId));
}

export function normalizePriceHistory(history, stores = []) {
  const validStoreIds = new Set(normalizeGroceryStores(stores).map((store) => store.id));
  return (Array.isArray(history) ? history : [])
    .map((entry) => ({
      id: String(entry?.id || createId("price-history")),
      storeId: validStoreIds.has(String(entry?.storeId || "")) ? String(entry.storeId) : "",
      storeName: String(entry?.storeName || "").trim(),
      normalizedItemName: String(entry?.normalizedItemName || "").trim(),
      category: String(entry?.category || "").trim(),
      unitPrice: Math.max(0, Number(entry?.unitPrice) || 0),
      packagePrice: Math.max(0, Number(entry?.packagePrice) || 0),
      quantity: Math.max(0.001, Number(entry?.quantity) || 1),
      unit: normalizePriceUnit(entry?.unit),
      observedAt: validDateIso(entry?.observedAt) || new Date().toISOString(),
      sourceReceiptLineItemId: String(entry?.sourceReceiptLineItemId || ""),
      source: entry?.source === "manual" ? "manual" : "receipt",
      confidenceScore: clampNumber(entry?.confidenceScore, 0, 1, 0.7)
    }))
    .filter((entry) => entry.normalizedItemName);
}

export function normalizeGroceryPriceObservations(observations, stores = []) {
  const validStoreIds = new Set(normalizeGroceryStores(stores).map((store) => store.id));
  return (Array.isArray(observations) ? observations : [])
    .map((observation) => {
      const price = Number(observation?.price);
      const packageQuantity = Number(observation?.packageQuantity || 1);
      const source = String(observation?.source || "manual");
      return {
        id: String(observation?.id || createId("price")),
        itemKey: baseGroceryItemKey(observation?.itemKey || observation?.normalizedName || observation?.itemName),
        itemName: String(observation?.itemName || observation?.name || "").trim(),
        storeId: String(observation?.storeId || ""),
        productName: String(observation?.productName || observation?.itemName || "").trim(),
        price,
        unitPrice: Number.isFinite(Number(observation?.unitPrice))
          ? Number(observation.unitPrice)
          : price / packageQuantity,
        packageQuantity,
        packageUnit: normalizePriceUnit(observation?.packageUnit),
        source: groceryPriceProviders[source] ? source : "manual",
        observedAt: validDateIso(observation?.observedAt) || new Date().toISOString(),
        confidenceScore: clampNumber(observation?.confidenceScore, 0, 1, 1)
      };
    })
    .filter((observation) => observation.itemKey
      && validStoreIds.has(observation.storeId)
      && Number.isFinite(observation.price)
      && observation.price > 0
      && Number.isFinite(observation.packageQuantity)
      && observation.packageQuantity > 0);
}

export function normalizeGroceryPricingSettings(settings) {
  return {
    enabled: Boolean(settings?.enabled),
    extraStoreCost: clampNumber(settings?.extraStoreCost, 0, 100, 5)
  };
}

export function normalizePriceUnit(value) {
  const unit = String(value || "each").trim().toLowerCase();
  return ["each", "oz", "lb", "fl oz", "pt", "qt", "gal", "g", "kg", "ml", "l", "count"].includes(unit) ? unit : "each";
}

export function validDateIso(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function mergeGroceryStoreItemSections(newer, older) {
  const result = { ...(older || {}) };
  for (const [storeId, nItems] of Object.entries(newer || {})) {
    result[storeId] = { ...(result[storeId] || {}), ...nItems };
  }
  return result;
}

export function normalizeGroceryItemName(item) {
  return LiveGroceryCatalog.normalizeGroceryItemName(item, {
    aliases: _appState?.groceryAliases || {},
    splitPreferences: _appState?.grocerySplitPreferences || {}
  });
}

export function baseGroceryItemKey(item) {
  return LiveGroceryCatalog.normalizeGroceryItemName(item).canonicalName;
}

// ══════════════════════════════════════════════════════════════════════════
export function createGroceriesModule(deps) {
  const {
    state, elements, persist, meals, prepDays, getActiveAppArea, getAuthSession, getPendingMealIngredientSelection, getPendingAutoRuleIngredientSelection, clearPendingMealIngredientSelection, clearPendingAutoRuleIngredientSelection, activeRecipes, applyScanImageAction, canUseLocalBackend, chooseIngredientForPendingAutoRule, chooseIngredientForPendingMeal, closeFloatingMenus, closeFloatingMenusOnPageScroll, closeFolderMenu, closeSettingsMenu, combinedMealSectionsForWeek, dailyDozenCategories, dailyDozenItemKey, dateFromWeekKey, dateKeyFromDate, escapeHtml, fileToDataUrl, formatShortDate, formatWeekRange, getScanContent, groceryRecipeForSlot, maybeWriteCloudSnapshot, mealKeysForDay, mealSlotsForWeek, normalizeIngredients, openRecipeDialog, parseIngredientLine, prepareScanImage, priceObservationAgeDays, recipeForSlot, recordDeletion, renderDailyDozen, renderIngredientSuggestions, renderScanImagePreviews, retainScanImageEdits, scaleIngredientAmount, scaledIngredientToText, sectionScope, setWeekToolsMode, showInventoryApp, showMailToast, showShopApp, slotEntries, storeDirectionsUrl, trackUsage, updateTabIndicator, weekKey, weekState, inventoryItemList, renderInventoryPage,
  } = deps;
  _appState = state; // wire the module-scope live-state ref used by pure exports

  let grocerySwipeGesture = null;
  let pendingGroceryReview = null;
  let pendingGroceryReviewItems = [];
  let selectedGroceryWeekKey = "";
  let activeGroceryStoreTab = "all";
  let groceryRangeStart = "";
  let groceryRangeEnd = "";
  let editingDailyDozenGroceryItem = "";
  let draggedGroceryItem = null;
  let groceryStoreSearchTimer = null;
  let groceryStoreSearchSessionToken = "";
  let groceryStoreSearchSuggestions = [];
  let groceryStoreSearchLocation = null;
  let groceryStoreLocationPromise = null;
  let draggedGroceryStoreId = "";
  let activeGroceryStoreLayoutId = "";
  let draggedGroceryStoreSectionId = "";
  let groceryMoveSheetEl = null;
  let groceryMoveDragCleanup = null;
  let groceryMoveConfirmEl = null;
  let groceryAddNextStop = false;
  let groceryChecklistDialogEl = null;
  let receiptScanFiles = [];
  let receiptImageEdits = new Map();
  let pendingReceiptDraft = null;
  let editingReceiptId = null;
  let _receiptThumbUrls = [];
  let receiptValidationFlags = [];
  let storeRankItemKey = "";
  let showClearedGroceries = false; // (legacy) global reveal — superseded by per-store below
  const groceryBoughtShownStores = new Set();
  let shopSpace = "shop"; // "shop" | "checklist" | "inventory"

function groceryBaseItems() {
  if (!Array.isArray(state.groceryBaseItems)) state.groceryBaseItems = defaultGroceryBaseItems();
  return state.groceryBaseItems;
}

function groceryDailyDozenTags() {
  state.groceryDailyDozenTags = normalizeGroceryDailyDozenTags(state.groceryDailyDozenTags);
  return state.groceryDailyDozenTags;
}

function grocerySplitPreferences() {
  state.grocerySplitPreferences = normalizeGrocerySplitPreferences(state.grocerySplitPreferences);
  return state.grocerySplitPreferences;
}

function groceryAliases() {
  state.groceryAliases = normalizeGroceryAliases(state.groceryAliases);
  return state.groceryAliases;
}

function groceryStores() {
  state.groceryStores = normalizeGroceryStores(state.groceryStores);
  return state.groceryStores;
}

function groceryItemLocations() {
  state.groceryItemLocations = normalizeGroceryItemLocations(state.groceryItemLocations, groceryStores());
  return state.groceryItemLocations;
}

function groceryStoreItemSections() {
  state.groceryStoreItemSections = normalizeGroceryStoreItemSections(state.groceryStoreItemSections, groceryStores());
  return state.groceryStoreItemSections;
}

function receiptPriceHistory() {
  state.priceHistory = normalizePriceHistory(state.priceHistory, groceryStores());
  return state.priceHistory;
}

function receiptItemMappings() {
  state.receiptItemMappings = LiveReceiptDomain.normalizeMappings(state.receiptItemMappings);
  return state.receiptItemMappings;
}

function groceryPriceObservations() {
  state.groceryPriceObservations = normalizeGroceryPriceObservations(state.groceryPriceObservations, groceryStores());
  return state.groceryPriceObservations;
}

function groceryPricingSettings() {
  state.groceryPricingSettings = normalizeGroceryPricingSettings(state.groceryPricingSettings);
  return state.groceryPricingSettings;
}

function priceObservationFreshness(observation) {
  const age = priceObservationAgeDays(observation);
  if (age > 365) return "expired";
  if (age > 120) return "stale";
  return "fresh";
}

function currentGroceryPriceObservations() {
  const latestByProduct = new Map();
  const receiptObservations = receiptPriceHistory().map((entry) => ({
    id: entry.id,
    itemKey: canonicalGroceryItemKey(entry.normalizedItemName),
    itemName: entry.normalizedItemName,
    storeId: entry.storeId,
    productName: entry.normalizedItemName,
    price: entry.packagePrice,
    unitPrice: entry.unitPrice,
    packageQuantity: entry.quantity,
    packageUnit: entry.unit,
    source: "receipt",
    observedAt: entry.observedAt,
    confidenceScore: entry.confidenceScore
  }));
  [...groceryPriceObservations(), ...receiptObservations]
    .filter((observation) => priceObservationFreshness(observation) !== "expired")
    .forEach((observation) => {
      const key = [
        observation.storeId,
        canonicalGroceryItemKey(observation.itemKey),
        observation.source,
        normalize(observation.productName),
        observation.packageQuantity,
        observation.packageUnit
      ].join("|");
      const existing = latestByProduct.get(key);
      if (!existing || new Date(observation.observedAt) > new Date(existing.observedAt)) {
        latestByProduct.set(key, observation);
      }
    });
  return [...latestByProduct.values()];
}

function openGroceryStoresDialog(event) {
  event?.stopPropagation();
  closeSettingsMenu();
  elements.groceryStoreInput.value = "";
  groceryStoreSearchSuggestions = [];
  groceryStoreSearchSessionToken = createGroceryStoreSearchSessionToken();
  renderGroceryStoreSuggestions();
  setGroceryStoreSearchStatus(state.locationSharingEnabled ? "Preparing nearby store suggestions..." : "");
  renderGroceryStoresSettings();
  elements.groceryStoresDialog.showModal();
  if (state.locationSharingEnabled && !groceryStoreSearchLocation) acquireGroceryStoreSearchLocation();
  window.requestAnimationFrame(() => elements.groceryStoreInput.focus());
}

function renderGroceryStoresSettings() {
  const stores = groceryStores();
  elements.groceryStoresList.innerHTML = stores.length
    ? stores.map((store) => `
      <div class="grocery-store-setting${store.enabled ? "" : " is-disabled"}" data-grocery-store-setting="${escapeHtml(store.id)}" title="Drag or long-press to reorder">
        <span class="grocery-store-setting-details">
          <strong>${escapeHtml(store.name)}</strong>
          <small>${escapeHtml(store.address || "Manually added store")}</small>
        </span>
        <span class="grocery-store-setting-actions">
          <label class="grocery-store-toggle" title="${store.enabled ? "Hide from shop list" : "Show in shop list"}">
            <input type="checkbox" data-store-toggle="${escapeHtml(store.id)}" ${store.enabled ? "checked" : ""} />
          </label>
        </span>
      </div>
    `).join("")
    : `<div class="empty-state">Search for a store location or add one manually.</div>`;

  elements.groceryStoresList.querySelectorAll("[data-grocery-store-setting]").forEach((row) => {
    row.addEventListener("contextmenu", openGroceryStoreMenu);
  });
  // Store-order reorder — shared sortable primitive (single list; delegates to the
  // existing neighbour-based reorderGroceryStore). Bound once (delegated).
  if (!elements.groceryStoresList.__sortableBound) {
    elements.groceryStoresList.__sortableBound = true;
    makeSortable(elements.groceryStoresList, {
      rowSelector: "[data-grocery-store-setting]",
      getId: (row) => row.dataset.groceryStoreSetting,
      onGroupedDrop: ({ itemId, targetId, position }) => reorderGroceryStore(itemId, targetId, position),
      itemLabel: (row) => (row.querySelector(".grocery-store-name, .store-name")?.textContent || row.textContent || "store").trim().slice(0, 40),
    });
  }
  elements.groceryStoresList.querySelectorAll("[data-store-toggle]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const storeId = checkbox.dataset.storeToggle;
      state.groceryStores = groceryStores().map((s) =>
        s.id === storeId ? { ...s, enabled: checkbox.checked } : s
      );
      persist();
      renderGroceryStoresSettings();
      renderGroceries();
    });
  });
}

function handleGroceryStoreOrderDragStart(event) {
  if (event.target.closest("a, button")) {
    event.preventDefault();
    return;
  }
  draggedGroceryStoreId = event.currentTarget.dataset.groceryStoreSetting || "";
  if (!draggedGroceryStoreId) return;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-live-grocery-store", draggedGroceryStoreId);
  event.dataTransfer.setData("text/plain", draggedGroceryStoreId);
  event.currentTarget.classList.add("is-dragging");
  closeFolderMenu();
}

function handleGroceryStoreOrderDragOver(event) {
  if (!draggedGroceryStoreId) return;
  const targetId = event.currentTarget.dataset.groceryStoreSetting;
  if (!targetId || targetId === draggedGroceryStoreId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  const rect = event.currentTarget.getBoundingClientRect();
  const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  clearGroceryStoreOrderDropTarget();
  event.currentTarget.classList.add(position === "before" ? "drop-before" : "drop-after");
}

function clearGroceryStoreOrderDropTarget() {
  elements.groceryStoresList.querySelectorAll(".drop-before, .drop-after").forEach((row) => {
    row.classList.remove("drop-before", "drop-after");
  });
}

function handleGroceryStoreOrderDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const targetId = event.currentTarget.dataset.groceryStoreSetting;
  const position = event.currentTarget.classList.contains("drop-before") ? "before" : "after";
  reorderGroceryStore(draggedGroceryStoreId, targetId, position);
}

function clearGroceryStoreOrderDragState() {
  draggedGroceryStoreId = "";
  clearGroceryStoreOrderDropTarget();
  elements.groceryStoresList.querySelectorAll(".is-dragging").forEach((row) => row.classList.remove("is-dragging"));
}

function reorderGroceryStore(sourceId, targetId, position) {
  if (!sourceId || !targetId || sourceId === targetId) {
    clearGroceryStoreOrderDragState();
    return;
  }
  const stores = [...groceryStores()];
  const sourceIndex = stores.findIndex((store) => store.id === sourceId);
  if (sourceIndex < 0) return;
  const [source] = stores.splice(sourceIndex, 1);
  const targetIndex = stores.findIndex((store) => store.id === targetId);
  if (targetIndex < 0) return;
  stores.splice(targetIndex + (position === "after" ? 1 : 0), 0, source);
  state.groceryStores = stores;
  draggedGroceryStoreId = "";
  persist();
  renderGroceryStoresSettings();
  renderGroceries();
}

function addGroceryStore(event) {
  event.preventDefault();
  const name = elements.groceryStoreInput.value.trim();
  if (!name) return;
  if (groceryStores().some((store) => !store.placeId && normalize(store.name) === normalize(name))) {
    window.alert("That store already exists.");
    return;
  }
  state.groceryStores = [...groceryStores(), { id: createId("store"), name }];
  elements.groceryStoreInput.value = "";
  groceryStoreSearchSuggestions = [];
  groceryStoreSearchSessionToken = createGroceryStoreSearchSessionToken();
  renderGroceryStoreSuggestions();
  setGroceryStoreSearchStatus("Store added manually.");
  persist();
  renderGroceryStoresSettings();
  renderGroceries();
  elements.groceryStoreInput.focus();
}

function scheduleGroceryStoreSearch() {
  window.clearTimeout(groceryStoreSearchTimer);
  const query = elements.groceryStoreInput.value.trim();
  if (query.length < 2) {
    groceryStoreSearchSuggestions = [];
    renderGroceryStoreSuggestions();
    setGroceryStoreSearchStatus("");
    return;
  }
  setGroceryStoreSearchStatus("Searching store locations...");
  groceryStoreSearchTimer = window.setTimeout(() => searchGroceryStoreLocations(query), 280);
}

function acquireGroceryStoreSearchLocation({ settingsInput = null } = {}) {
  if (groceryStoreSearchLocation) return Promise.resolve(groceryStoreSearchLocation);
  if (groceryStoreLocationPromise) return groceryStoreLocationPromise;
  if (!navigator.geolocation) {
    state.locationSharingEnabled = false;
    if (settingsInput) settingsInput.checked = false;
    persist();
    window.alert("Location sharing is not available in this browser.");
    return Promise.resolve(null);
  }
  if (elements.groceryStoresDialog.open) setGroceryStoreSearchStatus("Finding stores near your current location...");
  groceryStoreLocationPromise = new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        groceryStoreSearchLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };
        if (elements.groceryStoresDialog.open) {
          setGroceryStoreSearchStatus("Suggestions will use stores near your current location.");
        }
        resolve(groceryStoreSearchLocation);
      },
      (error) => {
        groceryStoreSearchLocation = null;
        if (error.code === 1) {
          state.locationSharingEnabled = false;
          if (settingsInput) settingsInput.checked = false;
          persist();
        }
        const messages = {
          1: "Location permission was not granted. The setting has been turned off.",
          2: "Your current location could not be determined.",
          3: "Location lookup timed out. Please try again."
        };
        const message = messages[error.code] || "Your current location could not be determined.";
        if (elements.groceryStoresDialog.open) setGroceryStoreSearchStatus(message);
        else if (elements.restaurantSearchDialog?.open) elements.restaurantSearchStatus.textContent = message;
        else window.alert(message);
        resolve(null);
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 5 * 60 * 1000
      }
    );
  }).finally(() => {
    groceryStoreLocationPromise = null;
  });
  return groceryStoreLocationPromise;
}

async function searchGroceryStoreLocations(query) {
  try {
    if (state.locationSharingEnabled && !groceryStoreSearchLocation) {
      setGroceryStoreSearchStatus("Finding stores near your current location...");
      const location = await acquireGroceryStoreSearchLocation();
      if (elements.groceryStoreInput.value.trim() !== query) return;
      if (!location) return;
    }
    const response = await fetch(groceryPlacesApiUrl({
      action: "autocomplete",
      input: query,
      sessionToken: groceryStoreSearchSessionToken,
      ...(groceryStoreSearchLocation || {})
    }), groceryPlacesRequestOptions());
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Store search is unavailable.");
    if (elements.groceryStoreInput.value.trim() !== query) return;
    groceryStoreSearchSuggestions = Array.isArray(body.suggestions) ? body.suggestions : [];
    renderGroceryStoreSuggestions();
    setGroceryStoreSearchStatus(groceryStoreSearchSuggestions.length
      ? "Choose the exact store location below."
      : "No matching locations found. You can add the typed name manually.");
  } catch (error) {
    groceryStoreSearchSuggestions = [];
    renderGroceryStoreSuggestions();
    setGroceryStoreSearchStatus(error.message || "Store search is unavailable. You can still add manually.");
  }
}

function renderGroceryStoreSuggestions() {
  const suggestions = groceryStoreSearchSuggestions;
  elements.groceryStoreSuggestions.hidden = !suggestions.length;
  elements.groceryStoreInput.setAttribute("aria-expanded", String(Boolean(suggestions.length)));
  elements.groceryStoreSuggestions.innerHTML = suggestions.length ? `
    ${suggestions.map((suggestion) => `
      <button type="button" role="option" data-grocery-store-place="${escapeHtml(suggestion.placeId)}">
        <strong>${escapeHtml(suggestion.name)}</strong>
        <small>${escapeHtml(suggestion.address || "")}</small>
      </button>
    `).join("")}
    <div class="grocery-store-google-attribution">
      <img src="https://storage.googleapis.com/geo-devrel-public-buckets/powered_by_google_on_white.png" alt="Powered by Google" />
    </div>
  ` : "";
  elements.groceryStoreSuggestions.querySelectorAll("[data-grocery-store-place]").forEach((button) => {
    button.addEventListener("click", () => selectGroceryStoreLocation(button.dataset.groceryStorePlace));
  });
}

async function selectGroceryStoreLocation(placeId) {
  const suggestion = groceryStoreSearchSuggestions.find((item) => item.placeId === placeId);
  if (!suggestion) return;
  setGroceryStoreSearchStatus("Saving store location...");
  elements.groceryStoreInput.disabled = true;
  try {
    const response = await fetch(groceryPlacesApiUrl({
      action: "details",
      placeId,
      name: suggestion.name,
      sessionToken: groceryStoreSearchSessionToken
    }), groceryPlacesRequestOptions());
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "The store location could not be saved.");
    const store = normalizeGroceryStores([{
      id: createId("store"),
      ...body.store,
      chainName: suggestion.name
    }])[0];
    if (!store) throw new Error("The store location did not include usable details.");
    if (groceryStores().some((item) => item.placeId && item.placeId === store.placeId)) {
      throw new Error("That store location is already on your list.");
    }
    state.groceryStores = [...groceryStores(), store];
    elements.groceryStoreInput.value = "";
    groceryStoreSearchSuggestions = [];
    groceryStoreSearchSessionToken = createGroceryStoreSearchSessionToken();
    renderGroceryStoreSuggestions();
    setGroceryStoreSearchStatus("Store location linked.");
    persist();
    renderGroceryStoresSettings();
    renderGroceries();
  } catch (error) {
    setGroceryStoreSearchStatus(error.message || "The store location could not be saved.");
  } finally {
    elements.groceryStoreInput.disabled = false;
    elements.groceryStoreInput.focus();
  }
}

function handleGroceryStoreSearchKeydown(event) {
  if (event.key !== "Escape") return;
  groceryStoreSearchSuggestions = [];
  renderGroceryStoreSuggestions();
  setGroceryStoreSearchStatus("");
}

function setGroceryStoreSearchStatus(message) {
  elements.groceryStoreSearchStatus.textContent = message;
}

function createGroceryStoreSearchSessionToken() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function groceryPlacesApiUrl(params) {
  const query = new URLSearchParams(params);
  if (canUseLocalBackend()) return `https://effervescent-malabi-e0af55.netlify.app/.netlify/functions/google-places?${query}`;
  if (window.location.protocol.startsWith("http")) return `/.netlify/functions/google-places?${query}`;
  return `/api/google-places?${query}`;
}

function groceryPlacesRequestOptions() {
  const headers = {};
  if (getAuthSession()?.access_token) headers.Authorization = `Bearer ${getAuthSession().access_token}`;
  return { cache: "no-store", headers };
}

function openGroceryStoreMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();

  const source = event.target.closest("[data-grocery-store-setting]");
  const storeId = source?.dataset.groceryStoreSetting;
  const store = groceryStores().find((item) => item.id === storeId);
  if (!store) return;

  const menu = document.createElement("div");
  menu.className = "folder-context-menu grocery-store-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-skip-grocery-store="${escapeHtml(store.id)}">Skip this week</button>
    <button type="button" role="menuitem" data-edit-grocery-store="${escapeHtml(store.id)}">Edit</button>
    <button type="button" role="menuitem" data-remove-grocery-store-menu="${escapeHtml(store.id)}">Remove</button>
  `;

  const menuHost = source.closest("dialog[open]") || document.body;
  menuHost.append(menu);
  const sourceRect = source.getBoundingClientRect();
  const rawX = event.clientX || sourceRect.right;
  const rawY = event.clientY || sourceRect.bottom;
  const x = Math.min(rawX, window.innerWidth - menu.offsetWidth - 10);
  const y = Math.min(rawY, window.innerHeight - menu.offsetHeight - 10);
  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${Math.max(10, y)}px`;

  menu.querySelector("[data-skip-grocery-store]").addEventListener("click", (clickEvent) => {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
    closeFolderMenu();
    setGroceryStoreSkipped(store.id, true);
  });
  menu.querySelector("[data-edit-grocery-store]").addEventListener("click", (clickEvent) => {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
    closeFolderMenu();
    editGroceryStore(store.id);
  });
  menu.querySelector("[data-remove-grocery-store-menu]").addEventListener("click", (clickEvent) => {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
    closeFolderMenu();
    removeGroceryStore(store.id);
  });
}

function editGroceryStore(storeId) {
  const store = groceryStores().find((item) => item.id === storeId);
  if (!store) return;
  activeGroceryStoreLayoutId = store.id;
  elements.groceryStoreLayoutName.value = store.name;
  elements.groceryStoreLayoutAddress.value = store.address || "";
  elements.groceryStoreSectionInput.value = "";
  renderGroceryStoreLayoutEditor(store.sections);
  elements.groceryStoreLayoutDialog.showModal();
  window.requestAnimationFrame(() => elements.groceryStoreLayoutName.focus());
}

function renderGroceryStoreLayoutEditor(sections) {
  elements.groceryStoreLayoutList.innerHTML = normalizeGroceryStoreSections(sections, activeGroceryStoreLayoutId)
    .map((section) => groceryStoreLayoutRowTemplate(section))
    .join("");
  bindGroceryStoreLayoutRows();
}

function groceryStoreLayoutRowTemplate(section) {
  return `
    <div class="grocery-store-layout-row" data-store-section-row="${escapeHtml(section.id)}">
      <span class="grocery-store-section-grip" aria-hidden="true">⋮⋮</span>
      <input value="${escapeHtml(section.name)}" aria-label="Section name" />
      <button class="icon-btn" type="button" data-remove-store-section="${escapeHtml(section.id)}" title="Remove section" aria-label="Remove ${escapeHtml(section.name)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
      </button>
    </div>
  `;
}

function bindGroceryStoreLayoutRows() {
  // Store-section layout reorder — shared sortable primitive. The reorder is
  // DOM-only here (saveGroceryStoreLayout reads the section order + names on submit),
  // so onReorder is a no-op; the primitive just moves the row. Bound once (delegated).
  if (!elements.groceryStoreLayoutList.__sortableBound) {
    elements.groceryStoreLayoutList.__sortableBound = true;
    makeSortable(elements.groceryStoreLayoutList, {
      rowSelector: "[data-store-section-row]",
      getId: (row) => row.dataset.storeSectionRow,
      onReorder: () => {},
      itemLabel: (row) => (row.querySelector("input")?.value || "section").trim().slice(0, 40),
    });
  }
  elements.groceryStoreLayoutList.querySelectorAll("[data-remove-store-section]:not([data-bound])").forEach((button) => {
    button.dataset.bound = "true";
    button.addEventListener("click", () => removeGroceryStoreSectionRow(button.dataset.removeStoreSection));
  });
}

function addGroceryStoreSection() {
  const name = elements.groceryStoreSectionInput.value.trim();
  if (!name) return;
  const currentNames = [...elements.groceryStoreLayoutList.querySelectorAll("[data-store-section-row] input")]
    .map((input) => normalize(input.value));
  if (currentNames.includes(normalize(name))) {
    window.alert("That section already exists.");
    return;
  }
  const section = { id: createId("store-section"), name };
  elements.groceryStoreLayoutList.insertAdjacentHTML("beforeend", groceryStoreLayoutRowTemplate(section));
  elements.groceryStoreSectionInput.value = "";
  bindGroceryStoreLayoutRows();
  elements.groceryStoreSectionInput.focus();
}

function removeGroceryStoreSectionRow(sectionId) {
  const rows = elements.groceryStoreLayoutList.querySelectorAll("[data-store-section-row]");
  if (rows.length <= 1) {
    window.alert("A store needs at least one section.");
    return;
  }
  elements.groceryStoreLayoutList.querySelector(`[data-store-section-row="${CSS.escape(sectionId)}"]`)?.remove();
}

function handleStoreSectionDragStart(event) {
  if (event.target.closest("input, button")) {
    event.preventDefault();
    return;
  }
  draggedGroceryStoreSectionId = event.currentTarget.dataset.storeSectionRow || "";
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedGroceryStoreSectionId);
  event.currentTarget.classList.add("is-dragging");
}

function handleStoreSectionDragOver(event) {
  if (!draggedGroceryStoreSectionId || event.currentTarget.dataset.storeSectionRow === draggedGroceryStoreSectionId) return;
  event.preventDefault();
  const rect = event.currentTarget.getBoundingClientRect();
  const before = event.clientY < rect.top + rect.height / 2;
  clearStoreSectionDropTarget();
  event.currentTarget.classList.add(before ? "drop-before" : "drop-after");
}

function clearStoreSectionDropTarget() {
  elements.groceryStoreLayoutList.querySelectorAll(".drop-before, .drop-after").forEach((row) => {
    row.classList.remove("drop-before", "drop-after");
  });
}

function handleStoreSectionDrop(event) {
  event.preventDefault();
  const source = elements.groceryStoreLayoutList.querySelector(`[data-store-section-row="${CSS.escape(draggedGroceryStoreSectionId)}"]`);
  const target = event.currentTarget;
  if (!source || source === target) return;
  if (target.classList.contains("drop-before")) target.before(source);
  else target.after(source);
  clearStoreSectionDragState();
}

function clearStoreSectionDragState() {
  draggedGroceryStoreSectionId = "";
  clearStoreSectionDropTarget();
  elements.groceryStoreLayoutList.querySelectorAll(".is-dragging").forEach((row) => row.classList.remove("is-dragging"));
}

function saveGroceryStoreLayout(event) {
  event.preventDefault();
  const stores = groceryStores();
  const store = stores.find((item) => item.id === activeGroceryStoreLayoutId);
  if (!store) return;
  const name = elements.groceryStoreLayoutName.value.trim();
  if (!name) return;
  const sections = [...elements.groceryStoreLayoutList.querySelectorAll("[data-store-section-row]")]
    .map((row, index) => ({
      id: row.dataset.storeSectionRow,
      name: row.querySelector("input").value.trim(),
      sortOrder: (index + 1) * 10
    }))
    .filter((section) => section.name);
  if (!sections.length) {
    window.alert("Add at least one store section.");
    return;
  }
  const address = elements.groceryStoreLayoutAddress.value.trim();
  const addressChanged = address !== store.address;
  state.groceryStores = stores.map((item) => item.id === store.id ? {
    ...item,
    name,
    chainName: name,
    address,
    sections,
    ...(addressChanged ? { placeId: "", latitude: null, longitude: null, types: [] } : {})
  } : item);
  state.groceryStoreItemSections = normalizeGroceryStoreItemSections(state.groceryStoreItemSections, state.groceryStores);
  activeGroceryStoreLayoutId = "";
  persist();
  elements.groceryStoreLayoutDialog.close();
  renderGroceryStoresSettings();
  renderGroceries();
}

function removeGroceryStore(storeId) {
  const store = groceryStores().find((item) => item.id === storeId);
  if (!store || !window.confirm(`Remove ${store.name}? Its grocery items will move to Unassigned.`)) return;
  recordDeletion("groceryStores", storeId);
  state.groceryStores = groceryStores().filter((item) => item.id !== storeId);
  const locations = groceryItemLocations();
  Object.values(locations).forEach((location) => {
    if (location.storeId === storeId) location.storeId = "";
  });
  state.groceryItemLocations = normalizeGroceryItemLocations(locations, state.groceryStores);
  const itemSections = { ...groceryStoreItemSections() };
  delete itemSections[storeId];
  state.groceryStoreItemSections = normalizeGroceryStoreItemSections(itemSections, state.groceryStores);
  state.groceryPriceObservations = groceryPriceObservations().filter((observation) => observation.storeId !== storeId);
  state.receipts = normalizeReceipts(state.receipts).map((receipt) => (
    receipt.storeId === storeId ? { ...receipt, storeId: "" } : receipt
  ));
  state.priceHistory = receiptPriceHistory().map((entry) => (
    entry.storeId === storeId ? { ...entry, storeId: "" } : entry
  ));
  persist();
  renderGroceryStoresSettings();
  renderGroceries();
}

function openGroceryPricingDialog(event) {
  event?.stopPropagation();
  closeSettingsMenu();
  const settings = groceryPricingSettings();
  elements.groceryStopPenalty.value = settings.extraStoreCost;
  elements.groceryPriceRoutingEnabled.checked = settings.enabled;
  elements.groceryPriceStore.innerHTML = groceryStores()
    .map((store) => `<option value="${escapeHtml(store.id)}">${escapeHtml(store.name)}</option>`)
    .join("");
  elements.groceryPriceItem.value = "";
  elements.groceryPriceProduct.value = "";
  elements.groceryPriceAmount.value = "";
  elements.groceryPricePackageQuantity.value = "1";
  elements.groceryPricePackageUnit.value = "each";
  elements.groceryPriceConfidence.value = "1";
  renderGroceryPriceObservations();
  renderReceiptPriceTrends();
  elements.groceryPricingDialog.showModal();
  window.requestAnimationFrame(() => elements.groceryPriceItem.focus());
}

function saveGroceryPricingSettings() {
  state.groceryPricingSettings = normalizeGroceryPricingSettings({
    enabled: elements.groceryPriceRoutingEnabled.checked,
    extraStoreCost: elements.groceryStopPenalty.value
  });
  persist();
  renderGroceries();
  elements.groceryPricingDialog.close();
}

function saveManualGroceryPrice(event) {
  event.preventDefault();
  const storeId = elements.groceryPriceStore.value;
  const itemName = elements.groceryPriceItem.value.trim();
  const price = Number(elements.groceryPriceAmount.value);
  const packageQuantity = Number(elements.groceryPricePackageQuantity.value);
  if (!storeId || !itemName || !Number.isFinite(price) || price <= 0 || !Number.isFinite(packageQuantity) || packageQuantity <= 0) return;
  state.groceryPriceObservations = normalizeGroceryPriceObservations([
    ...groceryPriceObservations(),
    {
      id: createId("price"),
      itemKey: groceryRowKey(itemName),
      itemName,
      storeId,
      productName: elements.groceryPriceProduct.value.trim() || itemName,
      price,
      unitPrice: price / packageQuantity,
      packageQuantity,
      packageUnit: elements.groceryPricePackageUnit.value,
      source: "manual",
      observedAt: new Date().toISOString(),
      confidenceScore: Number(elements.groceryPriceConfidence.value)
    }
  ], groceryStores());
  elements.groceryPriceItem.value = "";
  elements.groceryPriceProduct.value = "";
  elements.groceryPriceAmount.value = "";
  persist();
  renderGroceryPriceObservations();
  renderGroceries();
  elements.groceryPriceItem.focus();
}

function renderGroceryPriceObservations() {
  const stores = new Map(groceryStores().map((store) => [store.id, store.name]));
  const observations = [...groceryPriceObservations()]
    .sort((a, b) => new Date(b.observedAt) - new Date(a.observedAt));
  elements.groceryPriceObservations.innerHTML = observations.length ? `<h3>Manual estimates</h3>${observations.map((observation) => {
    const freshness = priceObservationFreshness(observation);
    return `
      <div class="grocery-price-observation ${freshness}">
        <span>
          <strong>${escapeHtml(observation.itemName || observation.itemKey)}</strong>
          <small>${escapeHtml(stores.get(observation.storeId) || "Store")} · ${escapeHtml(observation.productName)}</small>
        </span>
        <span class="grocery-price-observation-value">
          <strong>${formatCurrency(observation.price)}</strong>
          <small>${formatCurrency(observation.unitPrice)}/${escapeHtml(observation.packageUnit)} · ${freshness}</small>
        </span>
        <button class="icon-btn" type="button" data-remove-price-observation="${escapeHtml(observation.id)}" title="Remove price" aria-label="Remove price">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
        </button>
      </div>
    `;
  }).join("")}` : `<div class="empty-state">No manual estimates saved.</div>`;
  elements.groceryPriceObservations.querySelectorAll("[data-remove-price-observation]").forEach((button) => {
    button.addEventListener("click", () => {
      state.groceryPriceObservations = groceryPriceObservations().filter((item) => item.id !== button.dataset.removePriceObservation);
      persist();
      renderGroceryPriceObservations();
      renderGroceries();
    });
  });
}

function openShopReceiptsDialog() {
  renderShopReceipts();
  elements.shopReceiptsDialog.showModal();
}

function closeShopReceiptsDialog() {
  closeReceiptEditView();
  elements.shopReceiptsDialog.close();
}

function openReceiptEditView(receiptId) {
  const receipt = (state.receipts || []).find((r) => r.id === receiptId);
  if (!receipt) return;
  editingReceiptId = receiptId;
  elements.editReceiptStoreName.value = receipt.storeName || "";
  elements.editReceiptStoreId.innerHTML = [
    `<option value="">Unlinked store</option>`,
    ...groceryStores().map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`)
  ].join("");
  elements.editReceiptStoreId.value = receipt.storeId || "";
  elements.editReceiptPurchaseDate.value = receipt.purchaseDate || "";
  elements.editReceiptSubtotal.value = receipt.subtotal || "";
  elements.editReceiptDiscounts.value = receipt.discounts || "";
  elements.editReceiptTax.value = receipt.tax || "";
  elements.editReceiptFees.value = receipt.fees || "";
  elements.editReceiptTotal.value = receipt.total || "";
  elements.editReceiptLineList.innerHTML = "";
  (receipt.lineItems || []).forEach((line) => addEditReceiptLine(line));
  elements.shopReceiptsListView.hidden = true;
  elements.shopReceiptsEditView.hidden = false;
}

function closeReceiptEditView() {
  editingReceiptId = null;
  if (elements.shopReceiptsListView) elements.shopReceiptsListView.hidden = false;
  if (elements.shopReceiptsEditView) elements.shopReceiptsEditView.hidden = true;
}

function addEditReceiptLine(line = {}) {
  const id = line.id || createId("rl");
  const row = document.createElement("div");
  row.className = "receipt-line-row";
  row.dataset.receiptLineId = id;
  row.dataset.originalName = line.normalizedName || "";
  row.dataset.originalCategory = line.category || "";
  row.innerHTML = `
    <input data-receipt-raw value="${escapeHtml(line.rawText || "")}" aria-label="Raw receipt text" />
    <input data-receipt-name value="${escapeHtml(line.normalizedName || "")}" placeholder="Item name" aria-label="Item name" />
    <input data-receipt-category value="${escapeHtml(line.category || "")}" placeholder="Category" aria-label="Category" />
    <input data-receipt-quantity type="number" min="0.001" step="0.001" value="${escapeHtml(String(line.quantity ?? 1))}" aria-label="Quantity" />
    <select data-receipt-unit aria-label="Unit">
      ${["each", "count", "oz", "lb", "g", "kg", "ml", "l", "fl oz"].map((unit) => (
        `<option value="${unit}" ${(line.unit || "each") === unit ? "selected" : ""}>${unit}</option>`
      )).join("")}
    </select>
    <input data-receipt-price type="number" min="0" step="0.01" value="${escapeHtml(String(line.totalPrice ?? 0))}" aria-label="Total price" />
    <input data-receipt-discount type="number" min="0" step="0.01" value="${escapeHtml(String(line.discountAmount ?? 0))}" aria-label="Discount" />
    <button class="icon-btn" type="button" data-remove-receipt-line title="Remove" aria-label="Remove line">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></svg>
    </button>
    <input type="hidden" data-receipt-confidence value="${escapeHtml(String(line.confidenceScore ?? 0.9))}" />
  `;
  row.querySelector("[data-remove-receipt-line]").addEventListener("click", () => row.remove());
  elements.editReceiptLineList.append(row);
}

function editedReceiptFromForm() {
  const original = (state.receipts || []).find((r) => r.id === editingReceiptId) || {};
  const lineItems = [...elements.editReceiptLineList.querySelectorAll("[data-receipt-line-id]")].map((row) => {
    const normalizedName = row.querySelector("[data-receipt-name]").value.trim();
    const category = row.querySelector("[data-receipt-category]").value.trim();
    const quantity = Math.max(0.001, Number(row.querySelector("[data-receipt-quantity]").value) || 1);
    const totalPrice = Math.max(0, Number(row.querySelector("[data-receipt-price]").value) || 0);
    return {
      id: row.dataset.receiptLineId,
      rawText: row.querySelector("[data-receipt-raw]").value.trim(),
      normalizedName,
      category,
      quantity,
      unit: row.querySelector("[data-receipt-unit]").value,
      totalPrice,
      unitPrice: quantity ? totalPrice / quantity : 0,
      discountAmount: Math.max(0, Number(row.querySelector("[data-receipt-discount]").value) || 0),
      confidenceScore: Number(row.querySelector("[data-receipt-confidence]").value) || 0.9,
      userCorrected: true
    };
  });
  return LiveReceiptDomain.normalizeReceipt({
    ...original,
    storeName: elements.editReceiptStoreName.value.trim(),
    storeId: elements.editReceiptStoreId.value,
    purchaseDate: elements.editReceiptPurchaseDate.value,
    subtotal: elements.editReceiptSubtotal.value,
    discounts: elements.editReceiptDiscounts.value,
    tax: elements.editReceiptTax.value,
    fees: elements.editReceiptFees.value,
    total: elements.editReceiptTotal.value,
    lineItems
  }, createId);
}

function saveReceiptEdit(event) {
  event.preventDefault();
  const receipt = editedReceiptFromForm();
  if (!receipt.storeName || !receipt.purchaseDate) return;
  const oldLineItemIds = new Set(
    ((state.receipts || []).find((r) => r.id === editingReceiptId)?.lineItems || []).map((li) => li.id)
  );
  state.receipts = normalizeReceipts((state.receipts || []).map((r) => r.id === editingReceiptId ? receipt : r));
  state.receiptItemMappings = LiveReceiptDomain.correctedMappingsFromReceipt(receipt, receiptItemMappings());
  state.priceHistory = normalizePriceHistory([
    ...receiptPriceHistory().filter((ph) => !oldLineItemIds.has(ph.sourceReceiptLineItemId)),
    ...LiveReceiptDomain.priceHistoryFromReceipt(receipt, createId)
  ], groceryStores());
  state.groceryBaseItems = normalizeGroceryBaseItems([
    ...groceryBaseItems(),
    ...receipt.lineItems.map((li) => li.normalizedName)
  ]);
  persist();
  maybeWriteCloudSnapshot({ force: true }).catch(() => {});
  renderShopReceipts();
  closeReceiptEditView();
}

function deleteReceipt() {
  if (!editingReceiptId) return;
  const receipt = (state.receipts || []).find((r) => r.id === editingReceiptId);
  const lineItemIds = new Set((receipt?.lineItems || []).map((li) => li.id));
  // Deleting the receipt deletes its preserved source image(s) — retention is
  // "until the receipt is deleted" (best-effort local purge; cloud is RLS-scoped).
  const deletedReceiptId = editingReceiptId;
  const imageCount = Math.max(1, (receipt?.imageRefs || []).length);
  getScanContent().then((sc) => sc && sc.removeImages(deletedReceiptId, imageCount)).catch(() => {});
  recordDeletion("receipts", editingReceiptId);
  state.receipts = (state.receipts || []).filter((r) => r.id !== editingReceiptId);
  state.priceHistory = normalizePriceHistory(
    receiptPriceHistory().filter((ph) => !lineItemIds.has(ph.sourceReceiptLineItemId)),
    groceryStores()
  );
  persist();
  maybeWriteCloudSnapshot({ force: true }).catch(() => {});
  renderShopReceipts();
  closeReceiptEditView();
}

function openReceiptScanDialog() {
  receiptScanFiles = [];
  receiptImageEdits = new Map();
  pendingReceiptDraft = null;
  elements.receiptImages.value = "";
  elements.receiptCameraImage.value = "";
  renderReceiptImagePreviews();
  elements.receiptReviewForm.hidden = true;
  elements.scanReceiptImagesBtn.hidden = false;
  setReceiptScanStatus("Upload a clear receipt photo, then review every line before saving.");
  elements.groceryPricingDialog.close();
  if (elements.shopReceiptsDialog.open) elements.shopReceiptsDialog.close();
  elements.receiptScanDialog.showModal();
}

function replaceReceiptScanFiles() {
  receiptScanFiles = [...(elements.receiptImages.files || [])].slice(0, 6);
  receiptImageEdits = retainScanImageEdits(receiptScanFiles, receiptImageEdits);
  updateReceiptScanSelectionStatus();
}

function appendReceiptCameraFile() {
  const files = [...(elements.receiptCameraImage.files || [])];
  if (files.length) receiptScanFiles = [...receiptScanFiles, ...files].slice(0, 6);
  receiptImageEdits = retainScanImageEdits(receiptScanFiles, receiptImageEdits);
  elements.receiptCameraImage.value = "";
  updateReceiptScanSelectionStatus();
}

function clearReceiptScanFiles() {
  receiptScanFiles = [];
  receiptImageEdits = new Map();
  elements.receiptImages.value = "";
  elements.receiptCameraImage.value = "";
  renderReceiptImagePreviews();
  pendingReceiptDraft = null;
  elements.receiptReviewForm.hidden = true;
  elements.scanReceiptImagesBtn.hidden = false;
  setReceiptScanStatus("Upload a clear receipt photo, then review every line before saving.");
}

function updateReceiptScanSelectionStatus() {
  renderReceiptImagePreviews();
  if (!receiptScanFiles.length) {
    setReceiptScanStatus("Upload a clear receipt photo, then review every line before saving.");
    return;
  }
  setReceiptScanStatus(`${receiptScanFiles.length} receipt photo${receiptScanFiles.length === 1 ? "" : "s"} selected.`);
}

function averageReceiptConfidence(receipt) {
  const lines = Array.isArray(receipt?.lineItems) ? receipt.lineItems : [];
  if (!lines.length) return 0;
  return lines.reduce((sum, line) => sum + (Number(line?.confidenceScore) || 0), 0) / lines.length;
}

async function storeScanImages(receiptId, blobs) {
  try {
    const sc = await getScanContent();
    if (!sc) return [];
    const refs = [];
    for (let i = 0; i < blobs.length; i++) {
      try {
        const bytes = new Uint8Array(await blobs[i].arrayBuffer());
        const ref = await sc.saveImage(receiptId, i, bytes, blobs[i].type || "image/jpeg");
        if (ref) refs.push(ref);
      } catch { /* per-image best-effort */ }
    }
    return refs;
  } catch { return []; }
}

async function scanReceiptImages() {
  if (!receiptScanFiles.length) {
    setReceiptScanStatus("Choose at least one receipt photo first.");
    return;
  }
  trackUsage("claude_receipt_scan");
  setReceiptScanStatus("Reading receipt...");
  elements.scanReceiptImagesBtn.disabled = true;
  try {
    const helperUrl = receiptScanHelperUrl();
    if (!helperUrl) throw new Error("Receipt scanning needs the local helper or live app.");
    const prepared = await Promise.all(receiptScanFiles.map((file) =>
      prepareScanImage(file, receiptImageEdits.get(file), { maxDimension: 1600, quality: 0.82 })));
    const images = await Promise.all(prepared.map(fileToDataUrl));
    const response = await fetch(helperUrl, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${getAuthSession()?.access_token || ""}` },
      body: JSON.stringify({ images })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Receipt scan failed with status ${response.status}`);
    // Interpretation + the independent EXTRACTION record (engine/model/raw output).
    const draft = LiveReceiptDomain.normalizeReceipt({
      ...payload.receipt,
      fileRef: receiptScanFiles.map((file) => file.name).join(", "),
      extraction: {
        engine: "claude-vision",
        model: payload.model || "",
        kind: "receipt",
        rawOutput: payload.rawText || "",
        extractedAt: new Date().toISOString(),
        status: "ok",
        confidence: averageReceiptConfidence(payload.receipt)
      }
    }, createId);
    // SOURCE: preserve the original image(s) locally (best-effort), keyed by the
    // receipt id, so the receipt can be re-reviewed/re-parsed without a rescan.
    draft.imageRefs = await storeScanImages(draft.id, prepared);
    pendingReceiptDraft = LiveReceiptDomain.applyReceiptMappings(draft, receiptItemMappings());
    renderReceiptReview();
    elements.receiptReviewForm.hidden = false;
    elements.scanReceiptImagesBtn.hidden = true;
    setReceiptScanStatus("Review the extracted receipt. Correct any uncertain line before saving.");
  } catch (error) {
    setReceiptScanStatus(error.message || "The receipt scan failed.");
  } finally {
    elements.scanReceiptImagesBtn.disabled = false;
  }
}

function receiptScanHelperUrl() {
  if (canUseLocalBackend()) return "/api/scan-receipt";
  if (window.location.protocol.startsWith("http")) return "/.netlify/functions/scan-receipt";
  return "";
}

function renderReceiptImagePreviews() {
  renderScanImagePreviews(receiptScanFiles, receiptImageEdits, elements.receiptImagePreviewList, "receipt");
}

function handleReceiptImagePreviewAction(event) {
  const button = event.target.closest("[data-scan-image-action]");
  if (!button) return;
  const index = Number(button.dataset.scanImageIndex);
  if (!Number.isInteger(index) || !receiptScanFiles[index]) return;
  const result = applyScanImageAction(
    receiptScanFiles,
    receiptImageEdits,
    index,
    button.dataset.scanImageAction
  );
  receiptScanFiles = result.files;
  receiptImageEdits = result.edits;
  elements.receiptImages.value = "";
  updateReceiptScanSelectionStatus();
}

function renderReceiptReview() {
  if (!pendingReceiptDraft) return;
  const receipt = pendingReceiptDraft;
  elements.receiptStoreName.value = receipt.storeName;
  elements.receiptStoreId.innerHTML = [
    `<option value="">Unlinked store</option>`,
    ...groceryStores().map((store) => `<option value="${escapeHtml(store.id)}">${escapeHtml(store.name)}</option>`)
  ].join("");
  elements.receiptStoreId.value = receipt.storeId || matchReceiptStoreId(receipt.storeName);
  elements.receiptPurchaseDate.value = receipt.purchaseDate;
  elements.receiptSubtotal.value = receipt.subtotal || "";
  elements.receiptDiscounts.value = receipt.discounts || "";
  elements.receiptTax.value = receipt.tax || "";
  elements.receiptFees.value = receipt.fees || "";
  elements.receiptTotal.value = receipt.total || "";
  elements.receiptLineList.innerHTML = "";
  receipt.lineItems.forEach((line) => addReceiptReviewLine(line));
  refreshReceiptValidation();
  renderReceiptSourceImages(receipt);
}

async function renderReceiptSourceImages(receipt) {
  const container = elements.receiptSourceImages;
  if (!container) return;
  _receiptThumbUrls.forEach((u) => { try { URL.revokeObjectURL(u); } catch { /* noop */ } });
  _receiptThumbUrls = [];
  container.innerHTML = "";
  const refs = Array.isArray(receipt?.imageRefs) ? receipt.imageRefs : [];
  if (!refs.length) { container.hidden = true; return; }
  try {
    const sc = await getScanContent();
    if (!sc) { container.hidden = true; return; }
    for (const ref of refs) {
      const bytes = await sc.loadImage(receipt.id, ref.index, { ref });
      if (!bytes) continue;
      const url = URL.createObjectURL(new Blob([bytes], { type: ref.mimeType || "image/jpeg" }));
      _receiptThumbUrls.push(url);
      const img = document.createElement("img");
      img.className = "receipt-source-thumb";
      img.src = url;
      img.alt = "Scanned receipt photo";
      img.loading = "lazy";
      img.title = "Open the full receipt photo";
      img.addEventListener("click", () => { try { window.open(url, "_blank", "noopener"); } catch { /* popup blocked */ } });
      container.appendChild(img);
    }
    container.hidden = container.childElementCount === 0;
  } catch { container.hidden = true; }
}

function refreshReceiptValidation() {
  const banner = elements.receiptReconcileBanner;
  if (!banner || !pendingReceiptDraft) return;
  let receipt;
  try { receipt = reviewedReceiptFromForm(); } catch { return; }
  const v = LiveReceiptDomain.validateReceipt(receipt);
  receiptValidationFlags = v.flags;
  // Per-line highlighting: clear prior marks, then flag rows that need a look.
  elements.receiptLineList?.querySelectorAll(".receipt-line--flagged").forEach((row) => {
    row.classList.remove("receipt-line--flagged");
    row.removeAttribute("title");
  });
  const messagesByLine = new Map();
  v.flags.filter((f) => f.lineId).forEach((f) => {
    messagesByLine.set(f.lineId, [...(messagesByLine.get(f.lineId) || []), f.message]);
  });
  messagesByLine.forEach((messages, lineId) => {
    const row = elements.receiptLineList?.querySelector(`[data-receipt-line-id="${(window.CSS && CSS.escape) ? CSS.escape(lineId) : lineId}"]`);
    if (row) { row.classList.add("receipt-line--flagged"); row.title = messages.join(" "); }
  });
  const lineIssues = messagesByLine.size;
  if (v.reconciles && !v.flags.length) {
    banner.hidden = false;
    banner.className = "receipt-reconcile is-ok";
    banner.textContent = "✓ Line items reconcile with the total.";
    return;
  }
  const parts = [];
  const totalsFlag = v.flags.find((f) => f.type === "totals-mismatch" || f.type === "subtotal-mismatch");
  if (totalsFlag) parts.push(totalsFlag.message);
  if (lineIssues) parts.push(`${lineIssues} line${lineIssues === 1 ? "" : "s"} may need a look.`);
  banner.hidden = false;
  banner.className = "receipt-reconcile is-warn";
  banner.textContent = "⚠ " + (parts.join(" ") || "Double-check the extracted values.");
}

function matchReceiptStoreId(storeName) {
  const target = normalize(storeName);
  if (!target) return "";
  return groceryStores().find((store) => {
    const storeText = normalize(store.name);
    return storeText === target || storeText.includes(target) || target.includes(storeText);
  })?.id || "";
}

function addReceiptReviewLine(line = {}) {
  const normalized = LiveReceiptDomain.normalizeReceiptLineItem(line, pendingReceiptDraft?.id || "", createId);
  const row = document.createElement("div");
  row.className = "receipt-line-row";
  row.dataset.receiptLineId = normalized.id;
  row.dataset.originalName = normalized.normalizedName;
  row.dataset.originalCategory = normalized.category;
  row.innerHTML = `
    <input data-receipt-raw value="${escapeHtml(normalized.rawText)}" aria-label="Raw receipt text" />
    <input data-receipt-name value="${escapeHtml(normalized.normalizedName)}" placeholder="Corrected item name" aria-label="Corrected item name" />
    <input data-receipt-category value="${escapeHtml(normalized.category)}" placeholder="Category" aria-label="Category" />
    <input data-receipt-quantity type="number" min="0.001" step="0.001" value="${escapeHtml(normalized.quantity)}" aria-label="Quantity" />
    <select data-receipt-unit aria-label="Unit">
      ${["each", "count", "oz", "lb", "g", "kg", "ml", "l", "fl oz"].map((unit) => (
        `<option value="${unit}" ${normalized.unit === unit ? "selected" : ""}>${unit}</option>`
      )).join("")}
    </select>
    <input data-receipt-price type="number" min="0" step="0.01" value="${escapeHtml(normalized.totalPrice)}" aria-label="Total price" />
    <input data-receipt-discount type="number" min="0" step="0.01" value="${escapeHtml(normalized.discountAmount)}" aria-label="Discount" />
    <span class="receipt-line-confidence" title="OCR confidence">${Math.round(normalized.confidenceScore * 100)}%</span>
    <button class="icon-btn" type="button" data-remove-receipt-line title="Remove line" aria-label="Remove receipt line">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></svg>
    </button>
    <input type="hidden" data-receipt-confidence value="${escapeHtml(normalized.confidenceScore)}" />
  `;
  row.querySelector("[data-remove-receipt-line]").addEventListener("click", () => row.remove());
  elements.receiptLineList.append(row);
}

function reviewedReceiptFromForm() {
  const base = pendingReceiptDraft || {};
  const lineItems = [...elements.receiptLineList.querySelectorAll("[data-receipt-line-id]")].map((row) => {
    const normalizedName = row.querySelector("[data-receipt-name]").value.trim();
    const category = row.querySelector("[data-receipt-category]").value.trim();
    const quantity = Math.max(0.001, Number(row.querySelector("[data-receipt-quantity]").value) || 1);
    const totalPrice = Math.max(0, Number(row.querySelector("[data-receipt-price]").value) || 0);
    return {
      id: row.dataset.receiptLineId,
      rawText: row.querySelector("[data-receipt-raw]").value.trim(),
      normalizedName,
      category,
      quantity,
      unit: row.querySelector("[data-receipt-unit]").value,
      totalPrice,
      unitPrice: totalPrice / quantity,
      discountAmount: Math.max(0, Number(row.querySelector("[data-receipt-discount]").value) || 0),
      confidenceScore: Number(row.querySelector("[data-receipt-confidence]").value) || 0.7,
      userCorrected: normalizedName !== row.dataset.originalName || category !== row.dataset.originalCategory
    };
  });
  return LiveReceiptDomain.normalizeReceipt({
    ...base,
    storeName: elements.receiptStoreName.value,
    storeId: elements.receiptStoreId.value,
    purchaseDate: elements.receiptPurchaseDate.value,
    subtotal: elements.receiptSubtotal.value,
    discounts: elements.receiptDiscounts.value,
    tax: elements.receiptTax.value,
    fees: elements.receiptFees.value,
    total: elements.receiptTotal.value,
    lineItems
  }, createId);
}

function saveReviewedReceipt(event) {
  event.preventDefault();
  const receipt = reviewedReceiptFromForm();
  if (!receipt.storeName || !receipt.purchaseDate || !receipt.lineItems.length) return;
  state.receipts = normalizeReceipts([...(state.receipts || []), receipt]);
  state.receiptItemMappings = LiveReceiptDomain.correctedMappingsFromReceipt(receipt, receiptItemMappings());
  state.priceHistory = normalizePriceHistory([
    ...receiptPriceHistory(),
    ...LiveReceiptDomain.priceHistoryFromReceipt(receipt, createId)
  ], groceryStores());
  state.groceryBaseItems = normalizeGroceryBaseItems([
    ...groceryBaseItems(),
    ...receipt.lineItems.map((line) => line.normalizedName)
  ]);
  persist();
  maybeWriteCloudSnapshot({ force: true }).catch(() => {});
  renderGroceries();
  renderShopReceipts();
  elements.receiptScanDialog.close();
  openGroceryPricingDialog();
}

function setReceiptScanStatus(message) {
  elements.receiptScanStatus.textContent = message;
}

function renderReceiptPriceTrends() {
  const history = receiptPriceHistory();
  if (!history.length) {
    elements.receiptPriceTrends.innerHTML = `<div class="empty-state">No receipt price history yet.</div>`;
    return;
  }
  const grouped = new Map();
  history.forEach((entry) => {
    const key = LiveReceiptDomain.normalizedName(entry.normalizedItemName);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  });
  const rows = [...grouped.values()]
    .filter((entries) => entries.length > 1)
    .sort((a, b) => b.length - a.length || normalize(a[0].normalizedItemName).localeCompare(normalize(b[0].normalizedItemName)))
    .slice(0, 12);
  elements.receiptPriceTrends.innerHTML = rows.length ? `
    <h3>Common item trends</h3>
    <div class="receipt-trend-grid">
      ${rows.map((entries) => {
        const sorted = [...entries].sort((a, b) => new Date(a.observedAt) - new Date(b.observedAt));
        const latest = sorted.at(-1);
        const previous = sorted.at(-2);
        const delta = latest.packagePrice - previous.packagePrice;
        return `
          <div class="receipt-trend-item">
            <strong>${escapeHtml(latest.normalizedItemName)}</strong>
            <span>${formatCurrency(latest.packagePrice)}</span>
            <small>${delta === 0 ? "No change" : `${delta > 0 ? "+" : ""}${formatCurrency(delta)} since prior receipt`}</small>
          </div>
        `;
      }).join("")}
    </div>
  ` : `<div class="empty-state">Scan an item more than once to see price trends.</div>`;
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function openGroceryLibraryDialog(event) {
  event?.stopPropagation();
  clearPendingMealIngredientSelection();
  clearPendingAutoRuleIngredientSelection();
  closeSettingsMenu();
  elements.groceryLibraryInput.placeholder = "Add grocery item";
  renderGroceryLibrary();
  elements.groceryLibraryInput.value = "";
  elements.groceryLibraryDialog.showModal();
  focusGroceryLibraryInput();
}

function focusGroceryLibraryInput() {
  window.requestAnimationFrame(() => {
    elements.groceryLibraryInput.focus();
    elements.groceryLibraryInput.select();
  });
}

function renderGroceryLibrary(query = "") {
  const items = groceryBaseItems();
  const isPickingGrocery = getPendingMealIngredientSelection() || getPendingAutoRuleIngredientSelection();
  const q = normalize(query);
  const filteredItems = q ? items.filter((item) => normalize(item).includes(q)) : items;
  if (!filteredItems.length) {
    elements.groceryLibraryList.innerHTML = q
      ? `<div class="empty-state">No items match "${escapeHtml(query)}".</div>`
      : `<div class="empty-state">No grocery items yet.</div>`;
    return;
  }

  const categories = new Map();
  filteredItems.forEach((item) => {
    const identity = normalizeGroceryItemName(item);
    if (!categories.has(identity.category)) categories.set(identity.category, new Map());
    const subcategories = categories.get(identity.category);
    if (!subcategories.has(identity.subcategory)) subcategories.set(identity.subcategory, []);
    subcategories.get(identity.subcategory).push(item);
  });
  elements.groceryLibraryList.innerHTML = [...categories.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, subcategories]) => `
      <section class="grocery-catalog-category">
        <h3>${escapeHtml(category)}</h3>
        ${[...subcategories.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([subcategory, groupItems]) => `
          <section class="grocery-catalog-group">
            <h4>${escapeHtml(subcategory)}</h4>
            <div class="grocery-catalog-items">
              ${groupItems.map((item) => isPickingGrocery ? `
                <button class="grocery-library-item grocery-library-pick" type="button" data-pick-grocery-library="${escapeHtml(item)}">
                  ${escapeHtml(item)}
                </button>
              ` : `
                <span class="grocery-library-item" data-grocery-library-item="${escapeHtml(item)}">
                  ${escapeHtml(item)}
                  <button type="button" data-remove-grocery-library="${escapeHtml(item)}" aria-label="Remove ${escapeHtml(item)}">×</button>
                </span>
              `).join("")}
            </div>
          </section>
        `).join("")}
      </section>
    `).join("");

  elements.groceryLibraryList.querySelectorAll("[data-pick-grocery-library]").forEach((button) => {
    button.addEventListener("click", () => {
      if (getPendingAutoRuleIngredientSelection()) {
        chooseIngredientForPendingAutoRule(button.dataset.pickGroceryLibrary);
        return;
      }
      chooseIngredientForPendingMeal(button.dataset.pickGroceryLibrary);
    });
    button.addEventListener("contextmenu", openGroceryLibraryItemMenu);
  });
  elements.groceryLibraryList.querySelectorAll("[data-remove-grocery-library]").forEach((button) => {
    button.addEventListener("click", () => removeGroceryLibraryItem(button.dataset.removeGroceryLibrary));
  });
  elements.groceryLibraryList.querySelectorAll("[data-grocery-library-item]").forEach((chip) => {
    chip.addEventListener("contextmenu", openGroceryLibraryItemMenu);
    chip.addEventListener("dblclick", () => startInlineGroceryRename(chip));
  });
}

function addGroceryLibraryItem(event) {
  event.preventDefault();
  const isPickingGrocery = getPendingMealIngredientSelection() || getPendingAutoRuleIngredientSelection();
  const typed = elements.groceryLibraryInput.value.trim();
  if (!typed) return;

  if (isPickingGrocery) {
    const q = normalize(typed);
    const existing = groceryBaseItems();
    const match = existing.find((i) => normalize(i) === q)
      || existing.find((i) => normalize(i).startsWith(q))
      || existing.find((i) => normalize(i).includes(q));
    const item = match || typed;
    if (!match) {
      state.groceryBaseItems = normalizeGroceryBaseItems([...existing, item]);
      clearDismissedGroceryReviewsForItem(item);
      persist();
    }
    elements.groceryLibraryInput.value = "";
    if (getPendingAutoRuleIngredientSelection()) chooseIngredientForPendingAutoRule(item);
    else chooseIngredientForPendingMeal(item);
    return;
  }

  state.groceryBaseItems = normalizeGroceryBaseItems([...groceryBaseItems(), typed]);
  clearDismissedGroceryReviewsForItem(typed);
  elements.groceryLibraryInput.value = "";
  persist();
  refreshGroceryLibraryViews();
}

function removeGroceryLibraryItem(item) {
  state.groceryBaseItems = groceryBaseItems().filter((existing) => normalize(existing) !== normalize(item));
  removeGroceryAliasesForItem(item);
  removeGroceryItemLocation(item);
  persist();
  refreshGroceryLibraryViews();
}

function openGroceryLibraryItemMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();

  const item = event.currentTarget.dataset.groceryLibraryItem || event.currentTarget.dataset.pickGroceryLibrary;
  if (!item) return;

  const menu = document.createElement("div");
  menu.className = "folder-context-menu grocery-library-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-rename-grocery-library-item="${escapeHtml(item)}">Rename</button>
    <button type="button" role="menuitem" data-aliases-grocery-library-item="${escapeHtml(item)}">Aliases</button>
    <button type="button" role="menuitem" data-daily-dozen-grocery-library-item="${escapeHtml(item)}">Daily Dozen tags</button>
    <button type="button" role="menuitem" data-separate-grocery-library-item="${escapeHtml(item)}">
      ${grocerySplitPreferences()[LiveGroceryCatalog.normalizeGroceryItemName(item).normalizedName] ? "Use automatic matching" : "Keep separate"}
    </button>
  `;

  elements.groceryLibraryDialog.append(menu);
  const sourceRect = event.currentTarget?.getBoundingClientRect?.();
  const rawX = event.clientX || sourceRect?.right || 10;
  const rawY = event.clientY || sourceRect?.bottom || 10;
  const x = Math.min(rawX, window.innerWidth - menu.offsetWidth - 10);
  const y = Math.min(rawY, window.innerHeight - menu.offsetHeight - 10);
  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${Math.max(10, y)}px`;

  menu.querySelector("[data-rename-grocery-library-item]").addEventListener("click", (renameEvent) => {
    renameEvent.preventDefault();
    renameEvent.stopPropagation();
    const original = renameEvent.currentTarget.dataset.renameGroceryLibraryItem;
    closeFolderMenu();
    renameGroceryLibraryItem(original);
  });
  menu.querySelector("[data-aliases-grocery-library-item]").addEventListener("click", (aliasEvent) => {
    aliasEvent.preventDefault();
    aliasEvent.stopPropagation();
    const original = aliasEvent.currentTarget.dataset.aliasesGroceryLibraryItem;
    closeFolderMenu();
    editGroceryLibraryAliases(original);
  });
  menu.querySelector("[data-separate-grocery-library-item]").addEventListener("click", (splitEvent) => {
    splitEvent.preventDefault();
    splitEvent.stopPropagation();
    const original = splitEvent.currentTarget.dataset.separateGroceryLibraryItem;
    closeFolderMenu();
    toggleGroceryLibrarySplitPreference(original);
  });
  menu.querySelector("[data-daily-dozen-grocery-library-item]").addEventListener("click", (tagEvent) => {
    tagEvent.preventDefault();
    tagEvent.stopPropagation();
    const original = tagEvent.currentTarget.dataset.dailyDozenGroceryLibraryItem;
    closeFolderMenu();
    openDailyDozenTagEditor(original);
  });
}

function openDailyDozenTagEditor(item) {
  const canonicalName = dailyDozenItemKey(item);
  if (!canonicalName) return;
  editingDailyDozenGroceryItem = canonicalName;
  elements.dailyDozenTagTitle.textContent = `Daily Dozen tags: ${normalizeGroceryItemName(item).displayName || item}`;
  const selected = new Map((groceryDailyDozenTags()[canonicalName] || []).map((tag) => [tag.categoryId, tag]));
  elements.dailyDozenTagList.innerHTML = dailyDozenCategories().map((category) => {
    const tag = selected.get(category.id);
    return `
      <label class="daily-dozen-tag-row">
        <input type="checkbox" data-daily-dozen-tag-category="${escapeHtml(category.id)}" ${tag ? "checked" : ""} />
        <span>
          <strong>${escapeHtml(category.name)}</strong>
          <small>${escapeHtml(category.servingGuidance)}</small>
        </span>
        <select data-daily-dozen-tag-confidence="${escapeHtml(category.id)}" aria-label="${escapeHtml(category.name)} confidence">
          <option value="1" ${!tag || tag.confidenceScore >= 0.85 ? "selected" : ""}>High</option>
          <option value="0.7" ${tag && tag.confidenceScore < 0.85 && tag.confidenceScore >= 0.5 ? "selected" : ""}>Medium</option>
          <option value="0.4" ${tag && tag.confidenceScore < 0.5 ? "selected" : ""}>Low</option>
        </select>
        <input data-daily-dozen-tag-notes="${escapeHtml(category.id)}" value="${escapeHtml(tag?.notes || "")}" placeholder="Notes" aria-label="${escapeHtml(category.name)} tag notes" />
      </label>
    `;
  }).join("");
  elements.dailyDozenTagDialog.showModal();
}

function closeDailyDozenTagEditor() {
  editingDailyDozenGroceryItem = "";
  elements.dailyDozenTagDialog.close();
}

function saveDailyDozenTagEditor() {
  if (!editingDailyDozenGroceryItem) return;
  const tags = [...elements.dailyDozenTagList.querySelectorAll("[data-daily-dozen-tag-category]")]
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => {
      const categoryId = checkbox.dataset.dailyDozenTagCategory;
      return {
        groceryItemId: editingDailyDozenGroceryItem,
        categoryId,
        confidenceScore: Number(elements.dailyDozenTagList.querySelector(`[data-daily-dozen-tag-confidence="${categoryId}"]`)?.value) || 1,
        notes: elements.dailyDozenTagList.querySelector(`[data-daily-dozen-tag-notes="${categoryId}"]`)?.value.trim() || ""
      };
    });
  const tagMap = { ...groceryDailyDozenTags() };
  if (tags.length) tagMap[editingDailyDozenGroceryItem] = tags;
  else delete tagMap[editingDailyDozenGroceryItem];
  state.groceryDailyDozenTags = LiveDailyDozen.normalizeTagMap(tagMap, dailyDozenCategories());
  persist();
  closeDailyDozenTagEditor();
  if (elements.dailyDozenPageDialog.open) renderDailyDozen();
}

function toggleGroceryLibrarySplitPreference(item) {
  const identity = LiveGroceryCatalog.normalizeGroceryItemName(item);
  const preferences = grocerySplitPreferences();
  if (preferences[identity.normalizedName]) delete preferences[identity.normalizedName];
  else preferences[identity.normalizedName] = identity.normalizedName;
  state.grocerySplitPreferences = normalizeGrocerySplitPreferences(preferences);
  persist();
  refreshGroceryLibraryViews();
  renderGroceries();
}

function applyGroceryItemRename(oldItem, newItem) {
  state.groceryBaseItems = normalizeGroceryBaseItems(groceryBaseItems().map((existing) => (
    normalize(existing) === normalize(oldItem) ? newItem : existing
  )));
  renameGroceryAliasKey(oldItem, newItem);
  renameGroceryItemLocation(oldItem, newItem);
  renameGroceryStoreItemSection(oldItem, newItem);
  renameGroceryDailyDozenTags(oldItem, newItem);
  renameGroceryPriceObservations(oldItem, newItem);
  renameReceiptPriceHistory(oldItem, newItem);
}

function renameGroceryLibraryItem(item) {
  const nextName = window.prompt("Rename grocery item", item);
  if (nextName === null) return;
  const trimmed = nextName.trim();
  if (!trimmed || normalize(trimmed) === normalize(item)) return;
  if (groceryBaseItems().some((existing) => normalize(existing) === normalize(trimmed))) {
    window.alert("That grocery item already exists.");
    return;
  }
  applyGroceryItemRename(item, trimmed);
  persist();
  refreshGroceryLibraryViews();
}

function startInlineGroceryRename(chip) {
  if (chip.dataset.editing) return;
  chip.dataset.editing = "1";
  const oldName = chip.dataset.groceryLibraryItem;
  const input = document.createElement("input");
  input.className = "grocery-library-rename-input";
  input.value = oldName;
  input.size = Math.max(10, oldName.length + 4);
  chip.innerHTML = "";
  chip.appendChild(input);
  input.focus();
  input.select();
  let settled = false;
  function commit() {
    if (settled) return;
    settled = true;
    const newName = input.value.trim();
    if (newName && normalize(newName) !== normalize(oldName)) {
      const conflict = groceryBaseItems().some((e) => normalize(e) === normalize(newName));
      if (!conflict) {
        applyGroceryItemRename(oldName, newName);
        persist();
        refreshGroceryLibraryViews();
        return;
      }
    }
    refreshGroceryLibraryViews();
  }
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { settled = true; refreshGroceryLibraryViews(); }
  });
  input.addEventListener("blur", commit);
}

function editGroceryLibraryAliases(item) {
  const aliases = groceryAliasesForItem(item);
  const nextAliases = window.prompt(`Aliases for ${item}\nUse commas or separate lines.`, aliases.join(", "));
  if (nextAliases === null) return;
  setGroceryAliasesForItem(item, parseGroceryAliasInput(nextAliases));
  persist();
  refreshGroceryLibraryViews();
  renderGroceries();
}

function parseGroceryAliasInput(value) {
  const seen = new Set();
  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const key = baseGroceryItemKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function groceryAliasesForItem(item) {
  return groceryAliases()[baseGroceryItemKey(item)] || [];
}

function setGroceryAliasesForItem(item, aliases) {
  const key = baseGroceryItemKey(item);
  if (!key) return;
  const next = { ...groceryAliases() };
  const normalized = normalizeGroceryAliases({ [key]: aliases })[key] || [];
  if (normalized.length) next[key] = normalized;
  else delete next[key];
  state.groceryAliases = normalizeGroceryAliases(next);
}

function renameGroceryAliasKey(oldItem, newItem) {
  const oldKey = baseGroceryItemKey(oldItem);
  const newKey = baseGroceryItemKey(newItem);
  if (!oldKey || !newKey || oldKey === newKey) return;
  const aliases = groceryAliases();
  const oldAliases = aliases[oldKey] || [];
  delete aliases[oldKey];
  aliases[newKey] = [...(aliases[newKey] || []), ...oldAliases];
  state.groceryAliases = normalizeGroceryAliases(aliases);
}

function removeGroceryAliasesForItem(item) {
  const key = baseGroceryItemKey(item);
  if (!key) return;
  const aliases = groceryAliases();
  delete aliases[key];
  state.groceryAliases = normalizeGroceryAliases(aliases);
}

function renameGroceryItemLocation(oldItem, newItem) {
  const oldKey = baseGroceryItemKey(oldItem);
  const newKey = baseGroceryItemKey(newItem);
  if (!oldKey || !newKey || oldKey === newKey) return;
  const locations = groceryItemLocations();
  if (!locations[oldKey]) return;
  locations[newKey] = locations[newKey] || locations[oldKey];
  delete locations[oldKey];
  state.groceryItemLocations = normalizeGroceryItemLocations(locations, groceryStores());
}

function renameGroceryStoreItemSection(oldItem, newItem) {
  const oldKey = groceryRowKey(oldItem);
  const newKey = groceryRowKey(newItem);
  if (!oldKey || !newKey || oldKey === newKey) return;
  const mappings = groceryStoreItemSections();
  Object.values(mappings).forEach((storeMappings) => {
    if (!storeMappings[oldKey]) return;
    storeMappings[newKey] = storeMappings[newKey] || storeMappings[oldKey];
    delete storeMappings[oldKey];
  });
  state.groceryStoreItemSections = normalizeGroceryStoreItemSections(mappings, groceryStores());
}

function renameGroceryPriceObservations(oldItem, newItem) {
  const oldKey = canonicalGroceryItemKey(oldItem);
  const newKey = canonicalGroceryItemKey(newItem);
  if (!oldKey || !newKey || oldKey === newKey) return;
  state.groceryPriceObservations = groceryPriceObservations().map((observation) => (
    canonicalGroceryItemKey(observation.itemKey) === oldKey
      ? { ...observation, itemKey: newKey, itemName: normalize(observation.itemName) === normalize(oldItem) ? newItem : observation.itemName }
      : observation
  ));
}

function renameGroceryDailyDozenTags(oldItem, newItem) {
  const oldKey = dailyDozenItemKey(oldItem);
  const newKey = dailyDozenItemKey(newItem);
  if (!oldKey || !newKey || oldKey === newKey) return;
  const tags = groceryDailyDozenTags();
  if (!tags[oldKey]) return;
  tags[newKey] = tags[newKey] || tags[oldKey];
  delete tags[oldKey];
  state.groceryDailyDozenTags = normalizeGroceryDailyDozenTags(tags);
}

function renameReceiptPriceHistory(oldItem, newItem) {
  const oldKey = canonicalGroceryItemKey(oldItem);
  const newKey = canonicalGroceryItemKey(newItem);
  if (!oldKey || !newKey || oldKey === newKey) return;
  state.priceHistory = receiptPriceHistory().map((entry) => (
    canonicalGroceryItemKey(entry.normalizedItemName) === oldKey
      ? { ...entry, normalizedItemName: newItem }
      : entry
  ));
  state.receipts = normalizeReceipts(state.receipts).map((receipt) => ({
    ...receipt,
    lineItems: receipt.lineItems.map((line) => (
      canonicalGroceryItemKey(line.normalizedName) === oldKey
        ? { ...line, normalizedName: newItem, userCorrected: true }
        : line
    ))
  }));
}

function removeGroceryItemLocation(item) {
  const key = baseGroceryItemKey(item);
  if (!key) return;
  const locations = groceryItemLocations();
  delete locations[key];
  state.groceryItemLocations = normalizeGroceryItemLocations(locations, groceryStores());
  const itemKey = groceryRowKey(item);
  const mappings = groceryStoreItemSections();
  Object.values(mappings).forEach((storeMappings) => delete storeMappings[itemKey]);
  state.groceryStoreItemSections = normalizeGroceryStoreItemSections(mappings, groceryStores());
  const tags = groceryDailyDozenTags();
  delete tags[dailyDozenItemKey(item)];
  state.groceryDailyDozenTags = normalizeGroceryDailyDozenTags(tags);
}

function resetGroceryLibrary() {
  state.groceryBaseItems = defaultGroceryBaseItems();
  state.groceryAliases = {};
  state.groceryItemLocations = {};
  state.groceryStoreItemSections = {};
  state.groceryDailyDozenTags = defaultGroceryDailyDozenTags();
  persist();
  refreshGroceryLibraryViews();
}

function refreshGroceryLibraryViews() {
  renderGroceryLibrary();
  renderIngredientSuggestions();
  renderGroceries();
}

async function autoTagGroceryWithAI() {
  const lib = Array.isArray(state.groceryBaseItems) ? state.groceryBaseItems : [];
  const existingTags = state.groceryDailyDozenTags || {};
  const untagged = lib.filter(item => {
    const key = normalizeGroceryItemName(item.name || item || "");
    return !existingTags[key] || !existingTags[key].length;
  });

  if (!untagged.length) {
    alert("All grocery items already have Daily Dozen tags.");
    return;
  }

  const btn = elements.autoTagGroceryBtn;
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "Tagging…";

  try {
    const endpoint = canUseLocalBackend()
      ? "/api/auto-tag-grocery"
      : "/.netlify/functions/auto-tag-grocery";
    const names = untagged.map(item => item.name || item || "").filter(Boolean);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${getAuthSession()?.access_token || ""}` },
      body: JSON.stringify({ items: names })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }
    const { tags } = await res.json();

    let count = 0;
    const updated = { ...existingTags };
    for (const [itemName, itemTags] of Object.entries(tags || {})) {
      if (!Array.isArray(itemTags) || !itemTags.length) continue;
      const key = normalizeGroceryItemName(itemName);
      if (!key) continue;
      updated[key] = itemTags;
      count++;
    }

    state.groceryDailyDozenTags = normalizeGroceryDailyDozenTags(updated);
    persist();
    renderGroceryLibrary();

    const skipped = names.length - count;
    alert(count === 0
      ? "No tags found — items may not match any Daily Dozen category."
      : `Tagged ${count} item${count !== 1 ? "s" : ""}${skipped ? ` (${skipped} didn't match any category)` : ""}.`
    );
  } catch (err) {
    alert(`Auto-tag failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function renderShopSpaceNav() {
  const bars = [document.getElementById("groceryStoreTabBar"), document.getElementById("inventorySpaceTabBar")].filter(Boolean);
  if (!bars.length) return;
  const spaces = [
    { id: "checklist", label: "Checklist" },
    { id: "shop", label: "Shop" },
    { id: "inventory", label: "Inventory" }
  ];
  const html = `
    <div class="watch-category-tabs shop-space-tabs" role="tablist" aria-label="Shop section">
      ${spaces.map((s) => `
        <button class="watch-category-tab${shopSpace === s.id ? " is-active" : ""}" type="button" role="tab" aria-selected="${shopSpace === s.id}" data-shop-space="${s.id}">${s.label}</button>
      `).join("")}
    </div>
  `;
  bars.forEach((el) => {
    el.innerHTML = html;
    el.querySelectorAll("[data-shop-space]").forEach((btn) => {
      btn.addEventListener("click", () => setShopSpace(btn.dataset.shopSpace));
    });
  });
}

function setShopSpace(space) {
  if (!["shop", "checklist", "inventory"].includes(space)) return;
  if (space === "inventory") {
    shopSpace = "inventory";
    if (getActiveAppArea() !== "inventory") showInventoryApp();
    else renderInventoryPage();
    return;
  }
  shopSpace = space;
  if (getActiveAppArea() !== "shop") showShopApp();
  else renderGroceries();
}

function syncGroceryFormForSpace() {
  const form = document.getElementById("groceryForm");
  if (form) form.hidden = shopSpace !== "shop";
  const actions = document.querySelector(".shop-page-actions");
  if (actions) actions.hidden = shopSpace !== "shop";
}

function nextStopItemTemplate(item) {
  return `
    <div class="grocery-item-wrap grocery-nextstop-item" data-nextstop-id="${escapeHtml(item.id)}">
      <label class="grocery-item">
        <input type="checkbox" data-nextstop-purchase="${escapeHtml(item.id)}" />
        <span class="grocery-name">${escapeHtml(item.name)}</span>
        <span class="grocery-quantity">${escapeHtml(item.quantity || "")}</span>
      </label>
      <div class="grocery-swipe-actions">
        <button class="grocery-swipe-btn grocery-swipe-delete" type="button" data-nextstop-remove="${escapeHtml(item.id)}" aria-label="Remove">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>
  `;
}

function renderGroceryStoreTabs() {
  const el = document.getElementById("groceryStoreTabBar");
  if (!el) return;
  const skippedIds = skippedGroceryStoreIds();
  const stores = groceryStores().filter((s) => s.enabled !== false && !skippedIds.has(s.id));
  if (!stores.length) { el.innerHTML = ""; return; }
  if (!stores.some((s) => s.id === activeGroceryStoreTab) && activeGroceryStoreTab !== "all") {
    activeGroceryStoreTab = "all";
  }
  el.innerHTML = `
    <div class="watch-category-tabs" role="tablist" aria-label="Store">
      <button class="watch-category-tab${activeGroceryStoreTab === "all" ? " is-active" : ""}" type="button" role="tab" data-grocery-tab="all">All</button>
      ${stores.map((store) => `
        <button class="watch-category-tab${activeGroceryStoreTab === store.id ? " is-active" : ""}" type="button" role="tab" data-grocery-tab="${escapeHtml(store.id)}" data-grocery-store-setting="${escapeHtml(store.id)}">${escapeHtml(store.name)}</button>
      `).join("")}
    </div>
  `;
  el.querySelectorAll("[data-grocery-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeGroceryStoreTab = btn.dataset.groceryTab;
      renderGroceries();
    });
    if (btn.dataset.groceryTab !== "all") {
      btn.addEventListener("contextmenu", openGroceryStoreMenu);
      btn.addEventListener("dragover", (event) => {
        if (!draggedGroceryItem?.itemKey) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        btn.classList.add("drag-over");
      });
      btn.addEventListener("dragleave", () => btn.classList.remove("drag-over"));
      btn.addEventListener("dragend", () => btn.classList.remove("drag-over"));
      btn.addEventListener("drop", (event) => {
        btn.classList.remove("drag-over");
        if (!draggedGroceryItem?.itemKey) return;
        event.preventDefault();
        event.stopPropagation();
        const targetStoreId = btn.dataset.groceryTab;
        const itemKey = draggedGroceryItem.itemKey;
        moveGroceryItem(itemKey, targetStoreId, "", "after", "");
      });
    }
  });
  updateTabIndicator(el);
}

function renderGroceries() {
  renderShopSpaceNav();
  syncGroceryFormForSpace();
  // Checklist is the other in-page space (Inventory navigates to its own page via
  // setShopSpace). Shop is the default. Header/date bar stays above (setWeekToolsMode).
  if (shopSpace === "checklist") { renderShopChecklistSpace(); return; }

  renderGroceryWeekOptions();
  if (!groceryRangeStart || !groceryRangeEnd) initGroceryRange();
  const rangeKey = groceryCycleKey();
  const isCheckedRow = (rowKey) => Boolean(state.checkedGroceries[groceryCheckedKey(rangeKey, rowKey)]);

  const withFlags = (row) => ({
    ...row,
    checkedKey: groceryCheckedKey(rangeKey, row.key),
    checked: isCheckedRow(row.key),
    cleared: isGroceryCleared(row.key)
  });

  // Shop is a dynamic projection of active household needs: Meal Plan + Checklist
  // + Manual reconciled into ONE row per item (source independence lives in
  // buildActiveNeedRows / grocery-sources.js). No manual "refresh" step.
  const allNeeds = buildActiveNeedRows().map(withFlags);
  const activeNeeds = allNeeds.filter((r) => !r.cleared);
  const clearedCount = allNeeds.filter((r) => r.cleared).length;

  // Next Stop — store- and date-independent persistent intents (bypass routing).
  const nextStopRows = nextStopItemsList();

  const pricePlan = optimizeGroceryBasket(activeNeeds);
  // Route active AND bought rows together; anything with no usable store falls
  // into Other (storeId ""), never silently into the first store.
  const storeSections = groceryStoreSections(allNeeds, pricePlan.assignments, pricePlan.estimates, { otherFallback: true });

  if (!nextStopRows.length && !activeNeeds.length && !clearedCount) {
    elements.groceryList.innerHTML = `<div class="empty-state">Add meals to your plan and groceries will appear here.</div>`;
    return;
  }

  const sortCheckedLast = (rows) => {
    const unchecked = rows.filter((r) => !r.checked);
    const checked = rows.filter((r) => r.checked);
    return [...unchecked, ...checked];
  };

  // "Show N bought" toggle for a store heading — placed to the right of the
  // store name. storeId "" is the Miscellaneous/unassigned section.
  const boughtToggleBtn = (storeId, boughtRows) => {
    if (!boughtRows.length) return "";
    const shown = groceryBoughtShownStores.has(storeId || "");
    return `<button class="grocery-cleanup-link grocery-store-bought-toggle" type="button" data-grocery-toggle-bought="${escapeHtml(storeId)}" aria-pressed="${shown}">${shown ? "Hide" : "Show"} ${boughtRows.length} bought</button>`;
  };

  // Next Stop: rendered first, above everything. Store-independent; each item is
  // purchased (removed, with Undo) or removed outright — never routed or regenerated.
  const nextStopSection = nextStopRows.length ? `
    <section class="grocery-store-section grocery-nextstop-section" data-grocery-store-section="__nextstop">
      <div class="grocery-store-heading">
        <span class="grocery-store-name grocery-nextstop-name">Next Stop</span>
      </div>
      <div class="grocery-store-list">
        ${nextStopRows.map(nextStopItemTemplate).join("")}
      </div>
    </section>
  ` : "";

  const storeSection = ({ storeId, name, store, sectionGroups }) => {
    // Flatten groups preserving section order, then split active vs bought.
    const flatRows = sectionGroups.flatMap((group) => group.rows);
    const activeRows = sortCheckedLast(flatRows.filter((r) => !r.cleared));
    const boughtRows = flatRows.filter((r) => r.cleared);
    const showBought = groceryBoughtShownStores.has(storeId || "");
    const rowsToRender = showBought ? [...activeRows, ...boughtRows] : activeRows;
    const collapseKey = `groceryStore:${storeId || "unassigned"}`;
    const isCollapsed = activeGroceryStoreTab === "all" && Boolean(state.collapsedSections?.[collapseKey]);
    const storeChecked = activeRows.filter((r) => r.checked).length;
    const broomBtn = storeChecked
      ? `<button class="icon-btn grocery-store-clear" type="button" data-grocery-clear-store="${escapeHtml(storeId)}" title="Sweep ${storeChecked} checked" aria-label="Sweep ${storeChecked} checked items into bought">${groceryBroomSvg()}</button>`
      : "";
    return `
      <section class="grocery-store-section${isCollapsed ? " is-collapsed" : ""}" data-grocery-store-section="${escapeHtml(storeId)}">
        ${activeGroceryStoreTab === "all" ? `
          <div class="grocery-store-heading" ${storeId ? `data-grocery-store-setting="${escapeHtml(storeId)}"` : ""}>
            <button class="watch-section-head" type="button" data-grocery-collapse="${escapeHtml(collapseKey)}" title="${isCollapsed ? "Expand" : "Collapse"} ${escapeHtml(name)}" aria-expanded="${!isCollapsed}">
              <svg class="watch-section-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
              <span>${escapeHtml(name)}${isCollapsed ? ` <span class="grocery-collapsed-count">(${activeRows.length})</span>` : ""}</span>
            </button>
            ${boughtToggleBtn(storeId, boughtRows)}
            ${storeDirectionsUrl(store) ? `
              <a class="icon-btn grocery-store-directions" href="${escapeHtml(storeDirectionsUrl(store))}" target="_blank" rel="noopener" title="Directions to ${escapeHtml(name)}" aria-label="Directions to ${escapeHtml(name)}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 5 6 6-6 6v-4H8a4 4 0 0 0-4 4V9a4 4 0 0 1 4-4h5Z" /></svg>
              </a>
            ` : ""}
            ${broomBtn}
          </div>
        ` : `<div class="grocery-store-solo-actions">${boughtToggleBtn(storeId, boughtRows)}${broomBtn}</div>`}
        <div class="grocery-store-list ${rowsToRender.length ? "" : "is-empty"}"
          data-grocery-store-list="${escapeHtml(storeId)}"
          data-grocery-store-section-list="">
          ${rowsToRender.length ? rowsToRender.map(groceryItemTemplate).join("") : `<div class="grocery-store-empty">Drop items here</div>`}
        </div>
      </section>
    `;
  };

  const skippedIds = skippedGroceryStoreIds();
  const skippedStrip = skippedIds.size ? `
    <div class="grocery-skipped-strip">
      ${groceryStores().filter((s) => skippedIds.has(s.id)).map((s) => `
        <span class="grocery-skipped-chip">
          ${escapeHtml(s.name)} skipped this week
          <button type="button" data-unskip-grocery-store="${escapeHtml(s.id)}">Shop it</button>
        </span>
      `).join("")}
    </div>
  ` : "";

  // Shop view order (spec): Next Stop → Other → Stores. "Other" is the storeId=""
  // section (needs with no usable store); it renders right below Next Stop, then
  // the household's stores in their existing preference/optimization order.
  const otherEntry = storeSections.find((s) => s.storeId === "");
  const storeEntries = storeSections.filter((s) => s.storeId !== "");
  const planSections = `
    ${nextStopSection}
    ${otherEntry ? storeSection({ ...otherEntry, name: "Other" }) : ""}
    ${storeEntries.map(storeSection).join("")}
    ${skippedStrip}
  `;

  elements.groceryList.innerHTML = planSections;

  elements.groceryList.querySelectorAll("[data-grocery-clear-store]").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); clearCheckedGroceriesForStore(btn.dataset.groceryClearStore); });
  });
  elements.groceryList.querySelectorAll("[data-nextstop-purchase]").forEach((cb) => {
    cb.addEventListener("change", () => purchaseNextStopItem(cb.dataset.nextstopPurchase));
  });
  elements.groceryList.querySelectorAll("[data-nextstop-remove]").forEach((btn) => {
    btn.addEventListener("click", () => { removeNextStopItem(btn.dataset.nextstopRemove); persist(); renderGroceries(); });
  });
  elements.groceryList.querySelectorAll("[data-grocery-toggle-bought]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.groceryToggleBought || "";
      if (groceryBoughtShownStores.has(id)) groceryBoughtShownStores.delete(id);
      else groceryBoughtShownStores.add(id);
      renderGroceries();
    });
  });

  elements.groceryList.querySelectorAll("[data-grocery]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      state.checkedGroceries[checkbox.dataset.grocery] = checkbox.checked;
      // Unchecking a bought/cleared item (visible only while reviewing) brings
      // it back to the active list — the intuitive per-item "restore".
      if (!checkbox.checked) {
        const rowKey = checkbox.closest("[data-grocery-row-key]")?.dataset.groceryRowKey;
        if (rowKey && isGroceryCleared(rowKey)) setGroceryCleared(rowKey, false);
      }
      // Auto-collapse a store's section the moment every item in it is
      // checked — persisted, so it's still collapsed next time the page
      // loads. Never auto-expands: unchecking an item just leaves whatever
      // collapsed state was already there (the user's own toggle, or none).
      if (checkbox.checked && activeGroceryStoreTab === "all") {
        const section = checkbox.closest(".grocery-store-section");
        const collapseBtn = section?.querySelector("[data-grocery-collapse]");
        const collapseKey = collapseBtn?.dataset.groceryCollapse;
        const allChecked = section && [...section.querySelectorAll("[data-grocery]")].every((cb) => cb.checked);
        if (collapseKey && allChecked) {
          if (!state.collapsedSections || typeof state.collapsedSections !== "object") state.collapsedSections = {};
          state.collapsedSections[collapseKey] = true;
        }
      }
      persist();
      renderGroceries();
    });
  });
  elements.groceryList.querySelectorAll("[data-grocery-wrap-key]").forEach((wrap) => {
    wrap.addEventListener("contextmenu", openGroceryItemMenu);
    wrap.addEventListener("pointerdown", handleGrocerySwipePointerDown);
    wrap.addEventListener("pointermove", handleGrocerySwipePointerMove);
    wrap.addEventListener("pointerup", handleGrocerySwipePointerEnd);
    wrap.addEventListener("pointercancel", handleGrocerySwipePointerEnd);
  });
  elements.groceryList.querySelectorAll("[data-grocery-action-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeGrocerySwipe();
      editGroceryItem(btn.dataset.groceryActionEdit);
    });
  });
  elements.groceryList.querySelectorAll("[data-grocery-action-delete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeGrocerySwipe();
      deleteGroceryItem(btn.dataset.groceryActionDelete);
    });
  });
  // Grocery item reorder — shared sortable primitive (mouse drag + touch long-press +
  // continuous edge auto-scroll + Alt+Arrow keyboard), grouped so an item reorders
  // within its aisle AND moves between aisles. Persistence is UNCHANGED: every drop
  // delegates to moveGroceryItem (targetStore/section + neighbour + before/after).
  // groceryList persists across renders and the primitive delegates, so it binds ONCE.
  if (!elements.groceryList.__sortableBound) {
    elements.groceryList.__sortableBound = true;
    makeSortable(elements.groceryList, {
      rowSelector: "[data-grocery-row-key]",
      getId: (row) => row.dataset.groceryRowKey,
      groupSelector: "[data-grocery-store-list]",
      // Rows share the touch with swipe-to-reveal (horizontal) + scroll (vertical),
      // so give the long-press a little more drift tolerance than the default — a
      // resting thumb wobbles past 9px before the hold completes. Still well under a
      // deliberate scroll flick, which cancels the pending drag as before.
      longPressMs: 400,
      touchTolerancePx: 13,
      onGroupedDrop: ({ itemId, toContainer, targetId, position }) =>
        moveGroceryItem(itemId, toContainer?.dataset.groceryStoreList || "", targetId, position, toContainer?.dataset.groceryStoreSectionList || ""),
      itemLabel: (row) => (row.querySelector(".grocery-item-name, .grocery-item-label")?.textContent || row.textContent || "item").trim().slice(0, 40),
    });
  }
  elements.groceryList.querySelectorAll("[data-grocery-store-setting]").forEach((heading) => {
    heading.addEventListener("contextmenu", openGroceryStoreMenu);
  });
  elements.groceryList.querySelectorAll("[data-unskip-grocery-store]").forEach((btn) => {
    btn.addEventListener("click", () => setGroceryStoreSkipped(btn.dataset.unskipGroceryStore, false));
  });
  elements.groceryList.querySelectorAll("[data-grocery-collapse]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!state.collapsedSections || typeof state.collapsedSections !== "object") state.collapsedSections = {};
      const key = btn.dataset.groceryCollapse;
      state.collapsedSections[key] = !state.collapsedSections[key];
      persist();
      renderGroceries();
    });
  });
}

function groceryFallbackRoutingTemplate(rows, priceAssignments = {}) {
  const stores = groceryStores();
  if (!stores.length) return "";
  const locations = groceryItemLocations();
  const fallbackCount = rows.filter((row) => (
    !locations[row.key]?.storeId && !priceAssignments[row.key]
  )).length;
  if (!fallbackCount) return "";
  return `
    <div class="grocery-price-summary muted">
      ${fallbackCount} item${fallbackCount === 1 ? "" : "s"} without a saved price or store defaulted to ${escapeHtml(stores[0].name)}.
      Drag an item to another store once to remember that choice.
    </div>
  `;
}

function groceryPricePlanTemplate(plan) {
  if (!groceryPricingSettings().enabled) return "";
  if (!plan.pricedItemCount) return `<div class="grocery-price-summary muted">No past receipt prices or manual estimates match this grocery list.</div>`;
  const stores = plan.storeIds
    .map((storeId) => groceryStores().find((store) => store.id === storeId)?.name)
    .filter(Boolean)
    .join(", ");
  return `
    <div class="grocery-price-summary">
      <span><strong>Estimated basket ${formatCurrency(plan.merchandiseTotal)}</strong><small>Based on past receipts${plan.manualItemCount ? ` and ${plan.manualItemCount} manual estimate${plan.manualItemCount === 1 ? "" : "s"}` : ""} · ${plan.pricedItemCount} item${plan.pricedItemCount === 1 ? "" : "s"} · ${escapeHtml(stores)}</small></span>
      <span><strong>${formatCurrency(plan.adjustedTotal)}</strong><small>including ${formatCurrency(plan.stopCost)} stop cost</small></span>
    </div>
  `;
}

function optimizeGroceryBasket(rows) {
  const settings = groceryPricingSettings();
  const empty = { assignments: {}, estimates: {}, merchandiseTotal: 0, adjustedTotal: 0, stopCost: 0, storeIds: [], pricedItemCount: 0, manualItemCount: 0 };
  if (!settings.enabled) return empty;
  const locations = groceryItemLocations();
  const observations = currentGroceryPriceObservations();
  const availableStoreIds = [...new Set(observations.map((observation) => observation.storeId))];
  if (!availableStoreIds.length) return empty;

  let best = null;
  const subsetCount = 2 ** availableStoreIds.length;
  for (let mask = 1; mask < subsetCount; mask += 1) {
    const storeIds = availableStoreIds.filter((_, index) => mask & (1 << index));
    const assignments = {};
    const estimates = {};
    let merchandiseTotal = 0;
    let pricedItemCount = 0;
    let manualItemCount = 0;
    rows.forEach((row) => {
      const fixedStoreId = locations[row.key]?.storeId || "";
      const eligibleStores = fixedStoreId ? [fixedStoreId] : storeIds;
      const candidates = observations
        .filter((observation) => canonicalGroceryItemKey(observation.itemKey) === row.key
          && eligibleStores.includes(observation.storeId))
        .map((observation) => ({
          observation,
          cost: estimatedObservationCost(row, observation)
        }))
        .sort((a, b) => a.cost - b.cost
          || b.observation.confidenceScore - a.observation.confidenceScore
          || new Date(b.observation.observedAt) - new Date(a.observation.observedAt));
      if (!candidates.length) return;
      const chosen = candidates[0];
      assignments[row.key] = chosen.observation.storeId;
      estimates[row.key] = {
        cost: chosen.cost,
        source: chosen.observation.source,
        observedAt: chosen.observation.observedAt,
        storeId: chosen.observation.storeId
      };
      merchandiseTotal += chosen.cost;
      pricedItemCount += 1;
      if (chosen.observation.source === "manual") manualItemCount += 1;
    });
    const usedStoreIds = [...new Set(Object.values(assignments))];
    const stopCost = Math.max(0, usedStoreIds.length - 1) * settings.extraStoreCost;
    const adjustedTotal = merchandiseTotal + stopCost;
    const candidate = { assignments, estimates, merchandiseTotal, adjustedTotal, stopCost, storeIds: usedStoreIds, pricedItemCount, manualItemCount };
    if (!best
      || candidate.pricedItemCount > best.pricedItemCount
      || (candidate.pricedItemCount === best.pricedItemCount && candidate.adjustedTotal < best.adjustedTotal)) {
      best = candidate;
    }
  }
  return best || empty;
}

function estimatedObservationCost(row, observation) {
  const desired = groceryQuantityForPrice(row);
  if (!desired || desired.unit !== observation.packageUnit) return observation.price;
  return Math.max(1, Math.ceil(desired.quantity / observation.packageQuantity)) * observation.price;
}

function groceryQuantityForPrice(row) {
  const quantity = groceryAmountToNumber(row.amount);
  const unit = normalizeComparablePriceUnit(row.unit);
  if (!Number.isFinite(quantity) || !unit) return null;
  const conversions = {
    lb: { unit: "oz", factor: 16 },
    kg: { unit: "g", factor: 1000 },
    gal: { unit: "fl oz", factor: 128 },
    qt: { unit: "fl oz", factor: 32 },
    pt: { unit: "fl oz", factor: 16 },
    l: { unit: "ml", factor: 1000 }
  };
  const converted = conversions[unit];
  return converted
    ? { quantity: quantity * converted.factor, unit: converted.unit }
    : { quantity, unit };
}

function normalizeComparablePriceUnit(value) {
  const unit = normalize(value);
  const aliases = {
    c: "",
    cup: "",
    cups: "",
    tbsp: "",
    tsp: "",
    package: "each",
    packages: "each",
    each: "each",
    count: "count",
    oz: "oz",
    ounce: "oz",
    ounces: "oz",
    lb: "lb",
    lbs: "lb",
    pound: "lb",
    pounds: "lb",
    g: "g",
    gram: "g",
    grams: "g",
    kg: "kg",
    ml: "ml",
    l: "l",
    pt: "pt",
    qt: "qt",
    gal: "gal"
  };
  return aliases[unit] ?? unit;
}

function grocerySkipKey(storeId) {
  return `${groceryCycleKey()}::${storeId}`;
}

function skippedGroceryStoreIds() {
  const map = state.grocerySkippedStores && typeof state.grocerySkippedStores === "object" ? state.grocerySkippedStores : {};
  const prefix = `${groceryCycleKey()}::`;
  return new Set(Object.entries(map).filter(([k, v]) => v && k.startsWith(prefix)).map(([k]) => k.slice(prefix.length)));
}

function setGroceryStoreSkipped(storeId, skipped) {
  if (!state.grocerySkippedStores || typeof state.grocerySkippedStores !== "object") state.grocerySkippedStores = {};
  state.grocerySkippedStores[grocerySkipKey(storeId)] = !!skipped;
  if (skipped && activeGroceryStoreTab === storeId) activeGroceryStoreTab = "all";
  persist();
  renderGroceries();
}

function resolveItemEffectiveStoreId(itemKey, locations, enabledStoreIds) {
  // A this-trip-only override (added while viewing a specific store tab, or
  // defaulted to the preferred store from the All tab) wins over the item's
  // actual preferred-store ranking below — see setGroceryItemStoreForTrip.
  const override = groceryItemWeekOverrides()[groceryItemWeekOverrideKey(itemKey)];
  if (override && enabledStoreIds.has(override)) return override;
  const loc = locations[itemKey];
  if (!loc) return null;
  const rank = loc.storeRank?.length ? loc.storeRank : (loc.storeId ? [loc.storeId] : []);
  for (const id of rank) {
    if (enabledStoreIds.has(id)) return id;
  }
  return null;
}

function groceryStoreSections(rows, priceAssignments = {}, priceEstimates = {}, options = {}) {
  const locations = groceryItemLocations();
  const itemSections = groceryStoreItemSections();
  const skippedIds = skippedGroceryStoreIds();
  const enabledStores = groceryStores().filter((s) => s.enabled !== false && !skippedIds.has(s.id));
  const enabledStoreIds = new Set(enabledStores.map((s) => s.id));
  const stores = enabledStores.map((store) => ({ storeId: store.id, name: store.name, store }));
  // In the redesigned Shop, an item with no usable store assignment belongs in
  // Other (storeId ""), NOT silently dropped into the first store. Legacy callers
  // (buildGroceryText) keep the old first-store fallback.
  const fallbackStoreId = options.otherFallback ? "" : (stores[0]?.storeId || "");
  const sections = [...stores, { storeId: "", name: "Unassigned", store: null }];
  return sections
    .map((section) => {
      const storeRows = rows
        .filter((row) => {
          const effective = resolveItemEffectiveStoreId(row.key, locations, enabledStoreIds);
          // Price-plan assignments to a skipped store must not strand the item
          const assigned = enabledStoreIds.has(priceAssignments[row.key]) ? priceAssignments[row.key] : "";
          return (effective || assigned || fallbackStoreId) === section.storeId;
        })
        .map((row) => ({ ...row, priceEstimate: priceEstimates[row.key] || null }))
        .sort((a, b) => Number(a.checked) - Number(b.checked)
          || groceryRowStoreOrder(a, locations) - groceryRowStoreOrder(b, locations)
          || normalize(a.item).localeCompare(normalize(b.item)));
      const sectionGroups = section.store && storeRows.length
        ? section.store.sections.map((storeSection) => ({
          sectionId: storeSection.id,
          name: storeSection.name,
          rows: storeRows.filter((row) => grocerySectionIdForItem(section.store, row, itemSections) === storeSection.id)
        }))
        : [{ sectionId: "", name: "", rows: storeRows }];
      return { ...section, rows: storeRows, sectionGroups };
    })
    .filter((section) => section.storeId || section.rows.length || !stores.length);
}

function grocerySectionIdForItem(store, row, mappings = groceryStoreItemSections()) {
  const learnedSectionId = mappings[store.id]?.[row.key];
  if (learnedSectionId && store.sections.some((section) => section.id === learnedSectionId)) return learnedSectionId;
  return fallbackGrocerySection(store, row.item)?.id || store.sections.at(-1)?.id || "";
}

function fallbackGrocerySection(store, item) {
  const itemText = normalize(item);
  const category = groceryItemCategory(itemText);
  const categoryTerms = {
    produce: ["produce", "fruit", "vegetable"],
    bakery: ["bakery", "bread"],
    deli: ["deli"],
    dairy: ["dairy", "milk", "cheese", "yogurt"],
    frozen: ["frozen", "freezer"],
    household: ["household", "cleaning", "paper", "soap"],
    dry: ["dry", "pantry", "pasta", "rice", "canned", "aisle"],
    other: ["other", "misc"]
  };
  const itemWords = itemText.split(/\s+/).filter((word) => word.length > 3);
  const direct = store.sections.find((section) => {
    const sectionName = normalize(section.name);
    return itemWords.some((word) => sectionName.includes(word));
  });
  if (direct) return direct;
  const categoryMatch = store.sections.find((section) => {
    const sectionName = normalize(section.name);
    return (categoryTerms[category] || []).some((term) => sectionName.includes(term));
  });
  if (categoryMatch) return categoryMatch;
  return store.sections.find((section) => categoryTerms.other.some((term) => normalize(section.name).includes(term)))
    || store.sections.at(-1)
    || null;
}

function groceryItemCategory(item) {
  const matches = (terms) => terms.some((term) => item.includes(term));
  if (matches(["apple", "banana", "berry", "berries", "fruit", "vegetable", "lettuce", "spinach", "kale", "onion", "tomato", "pepper", "broccoli", "cauliflower", "carrot", "celery", "avocado", "lemon", "lime", "garlic", "herb", "greens", "potato"])) return "produce";
  if (matches(["bread", "bagel", "bun", "roll", "pita", "croissant", "muffin"])) return "bakery";
  if (matches(["deli", "hummus", "prepared", "rotisserie"])) return "deli";
  if (matches(["milk", "yogurt", "cheese", "butter", "cream", "egg"])) return "dairy";
  if (matches(["frozen", "ice cream"])) return "frozen";
  if (matches(["toilet paper", "paper towel", "soap", "cleaner", "detergent", "trash bag", "foil", "parchment"])) return "household";
  if (matches(["pasta", "rice", "bean", "lentil", "canned", "can ", "flour", "sugar", "oil", "vinegar", "spice", "salt", "cereal", "oat", "nut", "sauce", "broth", "stock", "tortilla"])) return "dry";
  return "other";
}

function groceryRowStoreOrder(row, locations) {
  const order = Number(locations[row.key]?.order);
  return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
}

function groceryRowSourceLabel(row) {
  if (!Array.isArray(row.sources) || !row.sources.length) return "";
  const order = ["mealplan", "checklist", "manual"];
  return row.sources
    .slice()
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((s) => {
      if (s === "mealplan") {
        const c = row.sourceMeta?.mealplan?.count;
        return c && c > 1 ? `Meal Plan · ${c}` : "Meal Plan";
      }
      return s === "checklist" ? "Checklist" : "Manual";
    })
    .join(" · ");
}

function groceryItemTemplate(row) {
  return `
    <div class="grocery-item-wrap" data-grocery-wrap-key="${escapeHtml(row.key)}">
      <label class="grocery-item ${row.checked ? "checked" : ""}${row.cleared ? " grocery-item--cleared" : ""}" data-grocery-row-key="${escapeHtml(row.key)}" title="Drag or long-press to organize; Alt+Arrow to reorder" aria-roledescription="Sortable item">
        <input type="checkbox" data-grocery="${escapeHtml(row.checkedKey)}" ${row.checked ? "checked" : ""} />
        <span class="grocery-name">
          ${escapeHtml(row.displayName || row.item)}
          ${row.notes?.length ? `<small>${escapeHtml(row.notes.join(" · "))}</small>` : ""}
          ${groceryRowSourceLabel(row) ? `<small class="grocery-source-tag">${escapeHtml(groceryRowSourceLabel(row))}</small>` : ""}
          ${row.priceEstimate ? `
            <small>${formatCurrency(row.priceEstimate.cost)} estimated · ${row.priceEstimate.source === "receipt" ? `based on receipt ${escapeHtml(formatReceiptObservationDate(row.priceEstimate.observedAt))}` : "manual estimate"}</small>
          ` : ""}
        </span>
        <span class="grocery-quantity">${escapeHtml(row.quantity || "")}</span>
      </label>
      <div class="grocery-swipe-actions">
        <button class="grocery-swipe-btn grocery-swipe-edit" type="button" data-grocery-action-edit="${escapeHtml(row.key)}" aria-label="Edit">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="grocery-swipe-btn grocery-swipe-delete" type="button" data-grocery-action-delete="${escapeHtml(row.key)}" aria-label="Delete">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>
  `;
}

function openGroceryItemMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();
  const key = event.currentTarget.dataset.groceryWrapKey;
  const groceryWeek = selectedGroceryWeek();
  const row = groceryWeek
    ? buildGroceryRowsWithManual(groceryWeek.week).find((item) => item.key === key)
    : null;
  if (!row) return;
  const menu = document.createElement("div");
  menu.className = "folder-context-menu grocery-library-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-move-grocery-item>Move to store…</button>
    <button type="button" role="menuitem" data-edit-grocery-item>Edit</button>
    <button type="button" role="menuitem" data-store-rank-grocery-item>Preferred stores</button>
    <button type="button" role="menuitem" data-delete-grocery-item>Delete</button>
  `;
  document.body.append(menu);
  const x = Math.min(event.clientX || 10, window.innerWidth - menu.offsetWidth - 10);
  const y = Math.min(event.clientY || 10, window.innerHeight - menu.offsetHeight - 10);
  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${Math.max(10, y)}px`;
  menu.querySelector("[data-move-grocery-item]").addEventListener("click", () => {
    closeFolderMenu();
    openGroceryMoveSheet(key);
  });
  menu.querySelector("[data-edit-grocery-item]").addEventListener("click", () => {
    closeFolderMenu();
    editGroceryItem(key);
  });
  menu.querySelector("[data-store-rank-grocery-item]").addEventListener("click", () => {
    closeFolderMenu();
    openStoreRankDialog(key);
  });
  menu.querySelector("[data-delete-grocery-item]").addEventListener("click", () => {
    closeFolderMenu();
    deleteGroceryItem(key);
  });
}

function openStoreRankDialog(itemKey) {
  const locations = groceryItemLocations();
  const loc = locations[itemKey];
  const label = itemKey.replace(/-/g, " ");
  storeRankItemKey = itemKey;
  elements.storeRankTitle.textContent = label.charAt(0).toUpperCase() + label.slice(1);
  renderStoreRankList();
  elements.storeRankDialog.showModal();
}

function renderStoreRankList() {
  const locations = groceryItemLocations();
  const loc = locations[storeRankItemKey];
  const allStores = groceryStores();
  const storeMap = new Map(allStores.map((s) => [s.id, s]));
  const rank = loc?.storeRank?.length
    ? loc.storeRank.filter((id) => storeMap.has(id))
    : (loc?.storeId ? [loc.storeId] : []);

  elements.storeRankList.innerHTML = rank.length
    ? rank.map((storeId, i) => {
        const store = storeMap.get(storeId);
        const disabled = store?.enabled === false;
        return `
          <div class="store-rank-row" data-rank-store-id="${escapeHtml(storeId)}">
            <span class="store-rank-index">${i + 1}</span>
            <span class="store-rank-name${disabled ? " is-hidden-store" : ""}">${escapeHtml(store?.name || storeId)}${disabled ? " <small>(hidden)</small>" : ""}</span>
            <span class="store-rank-actions">
              ${i > 0 ? `<button class="icon-btn" type="button" data-rank-up="${escapeHtml(storeId)}" aria-label="Move up"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg></button>` : ""}
              ${i < rank.length - 1 ? `<button class="icon-btn" type="button" data-rank-down="${escapeHtml(storeId)}" aria-label="Move down"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>` : ""}
              ${rank.length > 1 ? `<button class="icon-btn" type="button" data-rank-remove="${escapeHtml(storeId)}" aria-label="Remove"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>` : ""}
            </span>
          </div>
        `;
      }).join("")
    : `<p class="muted-label">No store preference set. Drag items in the shop list to assign stores.</p>`;

  const rankedIds = new Set(rank);
  const available = allStores.filter((s) => !rankedIds.has(s.id));
  elements.storeRankStoreSelect.innerHTML = available.length
    ? `<option value="">Add a fallback store…</option>${available.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("")}`
    : `<option value="">All stores ranked</option>`;
  elements.addStoreRankBtn.disabled = !available.length;

  elements.storeRankList.querySelectorAll("[data-rank-up]").forEach((btn) => {
    btn.addEventListener("click", () => moveStoreRank(btn.dataset.rankUp, -1));
  });
  elements.storeRankList.querySelectorAll("[data-rank-down]").forEach((btn) => {
    btn.addEventListener("click", () => moveStoreRank(btn.dataset.rankDown, 1));
  });
  elements.storeRankList.querySelectorAll("[data-rank-remove]").forEach((btn) => {
    btn.addEventListener("click", () => removeStoreFromRank(btn.dataset.rankRemove));
  });
}

function moveStoreRank(storeId, dir) {
  const locations = groceryItemLocations();
  const loc = locations[storeRankItemKey];
  if (!loc) return;
  const rank = [...(loc.storeRank || [])];
  const idx = rank.indexOf(storeId);
  if (idx < 0) return;
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= rank.length) return;
  [rank[idx], rank[swapIdx]] = [rank[swapIdx], rank[idx]];
  locations[storeRankItemKey] = { ...loc, storeId: rank[0] || loc.storeId, storeRank: rank };
  state.groceryItemLocations = normalizeGroceryItemLocations(locations, groceryStores());
  persist();
  renderStoreRankList();
  renderGroceries();
}

function removeStoreFromRank(storeId) {
  const locations = groceryItemLocations();
  const loc = locations[storeRankItemKey];
  if (!loc) return;
  const rank = (loc.storeRank || []).filter((id) => id !== storeId);
  locations[storeRankItemKey] = { ...loc, storeId: rank[0] || "", storeRank: rank };
  state.groceryItemLocations = normalizeGroceryItemLocations(locations, groceryStores());
  persist();
  renderStoreRankList();
  renderGroceries();
}

function addStoreToRank() {
  const storeId = elements.storeRankStoreSelect.value;
  if (!storeId) return;
  const locations = groceryItemLocations();
  const loc = locations[storeRankItemKey] || { storeId: "", storeRank: [], order: 0 };
  const rank = [...(loc.storeRank || []), storeId];
  locations[storeRankItemKey] = { ...loc, storeId: rank[0] || storeId, storeRank: rank };
  state.groceryItemLocations = normalizeGroceryItemLocations(locations, groceryStores());
  persist();
  renderStoreRankList();
  renderGroceries();
}

function groceryMoveItemLabel(itemKey) {
  const gw = selectedGroceryWeek();
  const row = gw ? buildGroceryRowsWithManual(gw.week).find((r) => r.key === itemKey) : null;
  return row?.displayName || row?.item || itemKey.replace(/-/g, " ");
}

function currentEffectiveStoreForItem(itemKey) {
  const skippedIds = skippedGroceryStoreIds();
  const enabledIds = new Set(groceryStores().filter((s) => s.enabled !== false && !skippedIds.has(s.id)).map((s) => s.id));
  return resolveItemEffectiveStoreId(itemKey, groceryItemLocations(), enabledIds) || "";
}

function openGroceryMoveSheet(itemKey) {
  const skippedIds = skippedGroceryStoreIds();
  const enabledStores = groceryStores().filter((s) => s.enabled !== false && !skippedIds.has(s.id));
  const loc = groceryItemLocations()[itemKey];
  const rank = loc?.storeRank?.length ? loc.storeRank : (loc?.storeId ? [loc.storeId] : []);
  const currentStoreId = currentEffectiveStoreForItem(itemKey);
  const destinations = LiveGrocerySources.moveDestinations({ stores: enabledStores, rank, currentStoreId });
  const label = groceryMoveItemLabel(itemKey);

  if (!groceryMoveSheetEl) {
    groceryMoveSheetEl = document.createElement("div");
    groceryMoveSheetEl.className = "shop-move-sheet";
    document.body.appendChild(groceryMoveSheetEl);
  }
  const sheet = groceryMoveSheetEl;
  sheet.innerHTML = `
    <div class="shop-move-panel" role="dialog" aria-label="Move ${escapeHtml(label)}">
      <div class="shop-move-head">
        <div class="shop-move-chip" data-move-chip>Moving: <strong>${escapeHtml(label)}</strong></div>
        <button class="icon-btn" type="button" data-move-cancel aria-label="Cancel">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="shop-move-targets" data-move-targets>
        ${destinations.map((d) => `
          <button class="shop-move-target${d.current ? " is-current" : ""}" type="button" data-move-target="${escapeHtml(d.id)}">
            <span>${escapeHtml(d.name)}</span>
            ${d.current ? `<span class="shop-move-current-tag">Current</span>` : ""}
          </button>
        `).join("")}
      </div>
    </div>
  `;
  sheet.classList.add("is-open");
  sheet.querySelector("[data-move-cancel]").addEventListener("click", closeGroceryMoveSheet);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeGroceryMoveSheet(); });
  sheet.querySelectorAll("[data-move-target]").forEach((btn) => {
    btn.addEventListener("click", () => requestGroceryItemMove(itemKey, btn.dataset.moveTarget));
  });
  const chip = sheet.querySelector("[data-move-chip]");
  const targetsEl = sheet.querySelector("[data-move-targets]");
  groceryMoveDragCleanup = attachPointerDragToTargets(chip, targetsEl, "[data-move-target]", (el) => {
    if (el) requestGroceryItemMove(itemKey, el.dataset.moveTarget);
  });
}

function closeGroceryMoveSheet() {
  if (groceryMoveDragCleanup) { groceryMoveDragCleanup(); groceryMoveDragCleanup = null; }
  if (groceryMoveSheetEl) { groceryMoveSheetEl.classList.remove("is-open"); groceryMoveSheetEl.innerHTML = ""; }
}

function requestGroceryItemMove(itemKey, targetStoreId) {
  const currentStoreId = currentEffectiveStoreForItem(itemKey);
  if (targetStoreId === currentStoreId) { closeGroceryMoveSheet(); return; }
  if (LiveGrocerySources.moveNeedsConfirmation({ currentStoreId, targetStoreId })) {
    openMoveConfirmDialog(itemKey, targetStoreId);
    return;
  }
  // From Other → a store: establish it as the preferred store (nothing to protect).
  // To Other: clear the preference so the item drops into Other.
  if (targetStoreId === "") clearItemStorePreference(itemKey);
  else setItemStorePermanent(itemKey, targetStoreId);
  closeGroceryMoveSheet();
  persist();
  renderGroceries();
}

function setItemStoreThisWeek(itemKey, storeId) {
  setGroceryItemStoreForTrip(itemKey, storeId);
  const locations = groceryItemLocations();
  const loc = locations[itemKey] || { storeId: "", storeRank: [], order: 0 };
  const rank = [...(loc.storeRank || (loc.storeId ? [loc.storeId] : []))];
  if (!rank.includes(storeId)) rank.push(storeId);
  locations[itemKey] = { ...loc, storeId: rank[0] || storeId, storeRank: rank };
  state.groceryItemLocations = normalizeGroceryItemLocations(locations, groceryStores());
}

function setItemStorePermanent(itemKey, storeId) {
  const locations = groceryItemLocations();
  const loc = locations[itemKey] || { storeId: "", storeRank: [], order: 0 };
  const priorRank = loc.storeRank || (loc.storeId ? [loc.storeId] : []);
  const rank = [storeId, ...priorRank.filter((id) => id !== storeId)];
  locations[itemKey] = { ...loc, storeId, storeRank: rank };
  state.groceryItemLocations = normalizeGroceryItemLocations(locations, groceryStores());
  clearGroceryItemWeekOverride(itemKey);
}

function clearItemStorePreference(itemKey) {
  const locations = groceryItemLocations();
  if (locations[itemKey]) {
    locations[itemKey] = { ...locations[itemKey], storeId: "", storeRank: [] };
    state.groceryItemLocations = normalizeGroceryItemLocations(locations, groceryStores());
  }
  clearGroceryItemWeekOverride(itemKey);
}

function clearGroceryItemWeekOverride(itemKey) {
  if (!state.groceryItemWeekOverride || typeof state.groceryItemWeekOverride !== "object") return;
  const key = groceryItemWeekOverrideKey(itemKey);
  if (key in state.groceryItemWeekOverride) state.groceryItemWeekOverride[key] = "";
}

function openMoveConfirmDialog(itemKey, targetStoreId) {
  const store = groceryStores().find((s) => s.id === targetStoreId);
  if (!store) return;
  const label = groceryMoveItemLabel(itemKey);
  if (!groceryMoveConfirmEl) {
    groceryMoveConfirmEl = document.createElement("dialog");
    groceryMoveConfirmEl.className = "recipe-dialog std-form-dialog shop-move-confirm-dialog";
    document.body.appendChild(groceryMoveConfirmEl);
    groceryMoveConfirmEl.addEventListener("click", (e) => { if (e.target === groceryMoveConfirmEl) groceryMoveConfirmEl.close(); });
  }
  const dlg = groceryMoveConfirmEl;
  dlg.innerHTML = `
    <div class="recipe-form std-form">
      <h2 style="margin:0 0 14px">Move ${escapeHtml(label)} to ${escapeHtml(store.name)}?</h2>
      <div class="shop-move-confirm-actions">
        <button class="shop-move-choice" type="button" data-move-week>
          <strong>This week only</strong>
          <small>Use ${escapeHtml(store.name)} for this shopping cycle; keep the usual preference.</small>
        </button>
        <button class="shop-move-choice is-primary" type="button" data-move-permanent>
          <strong>Make permanent</strong>
          <small>Always prefer ${escapeHtml(store.name)} for ${escapeHtml(label)}.</small>
        </button>
      </div>
      <details class="shop-move-prefs">
        <summary>Preferred store order</summary>
        <p class="muted-label" style="margin:8px 0 0">Reorder this item's fallback stores.</p>
        <button class="grocery-cleanup-link" type="button" data-move-edit-prefs>Edit preferred stores…</button>
      </details>
      <div class="shop-move-confirm-foot">
        <button class="secondary-btn" type="button" data-move-confirm-cancel>Cancel</button>
      </div>
    </div>
  `;
  dlg.querySelector("[data-move-week]").addEventListener("click", () => {
    setItemStoreThisWeek(itemKey, targetStoreId); persist(); dlg.close(); closeGroceryMoveSheet(); renderGroceries();
  });
  dlg.querySelector("[data-move-permanent]").addEventListener("click", () => {
    setItemStorePermanent(itemKey, targetStoreId); persist(); dlg.close(); closeGroceryMoveSheet(); renderGroceries();
  });
  dlg.querySelector("[data-move-confirm-cancel]").addEventListener("click", () => dlg.close());
  dlg.querySelector("[data-move-edit-prefs]").addEventListener("click", () => { dlg.close(); closeGroceryMoveSheet(); openStoreRankDialog(itemKey); });
  if (!dlg.open) dlg.showModal();
}

function attachPointerDragToTargets(handleEl, scrollContainer, targetSelector, onDrop) {
  if (!handleEl || !scrollContainer) return () => {};
  let dragging = false, ghost = null, current = null, rafId = 0, lastY = 0;

  const targetUnder = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const t = el && el.closest(targetSelector);
    return t && scrollContainer.contains(t) ? t : null;
  };
  const setCurrent = (t) => {
    if (current === t) return;
    if (current) current.classList.remove("is-drop-target");
    current = t;
    if (current) current.classList.add("is-drop-target");
  };
  const autoscrollLoop = () => {
    if (!dragging) return;
    const v = LiveGrocerySources.autoscrollVelocity(lastY, scrollContainer.getBoundingClientRect());
    if (v) { scrollContainer.scrollTop += v; setCurrent(targetUnder(ghost?._x ?? 0, lastY)); }
    rafId = requestAnimationFrame(autoscrollLoop);
  };
  const onDown = (e) => {
    if (dragging) return;
    dragging = true;
    // Pointer capture keeps events flowing to the handle mid-drag; guard it —
    // a synthetic or already-released pointer would otherwise throw and abort.
    try { handleEl.setPointerCapture?.(e.pointerId); } catch { /* no active pointer */ }
    document.body.classList.add("shop-move-dragging");
    ghost = handleEl.cloneNode(true);
    ghost.classList.add("shop-move-ghost");
    document.body.appendChild(ghost);
    moveGhost(e.clientX, e.clientY);
    lastY = e.clientY;
    rafId = requestAnimationFrame(autoscrollLoop);
  };
  const moveGhost = (x, y) => { if (ghost) { ghost._x = x; ghost.style.left = `${x}px`; ghost.style.top = `${y}px`; } };
  const onMove = (e) => {
    if (!dragging) return;
    e.preventDefault();
    lastY = e.clientY;
    moveGhost(e.clientX, e.clientY);
    setCurrent(targetUnder(e.clientX, e.clientY));
  };
  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    cancelAnimationFrame(rafId);
    document.body.classList.remove("shop-move-dragging");
    const dropped = targetUnder(e.clientX, e.clientY);
    if (ghost) { ghost.remove(); ghost = null; }
    if (current) current.classList.remove("is-drop-target");
    const target = dropped || current;
    current = null;
    if (target && typeof onDrop === "function") onDrop(target);
  };
  handleEl.addEventListener("pointerdown", onDown);
  handleEl.addEventListener("pointermove", onMove);
  handleEl.addEventListener("pointerup", onUp);
  handleEl.addEventListener("pointercancel", onUp);
  return () => {
    cancelAnimationFrame(rafId);
    if (ghost) ghost.remove();
    document.body.classList.remove("shop-move-dragging");
    handleEl.removeEventListener("pointerdown", onDown);
    handleEl.removeEventListener("pointermove", onMove);
    handleEl.removeEventListener("pointerup", onUp);
    handleEl.removeEventListener("pointercancel", onUp);
  };
}

function learnGroceryItemMerge(row) {
  const target = window.prompt("Merge this item with which grocery item?", row.displayName || row.item);
  if (target === null) return;
  const trimmed = target.trim();
  if (!trimmed) return;
  const aliases = [...new Set([...(row.rawNames || []), row.displayName || row.item])];
  state.groceryBaseItems = normalizeGroceryBaseItems([...groceryBaseItems(), trimmed]);
  setGroceryAliasesForItem(trimmed, [...groceryAliasesForItem(trimmed), ...aliases]);
  aliases.forEach((name) => {
    const normalizedName = LiveGroceryCatalog.normalizeGroceryItemName(name).normalizedName;
    if (state.grocerySplitPreferences) delete state.grocerySplitPreferences[normalizedName];
  });
  rekeyGroceryIdentityState();
  persist();
  refreshGroceryLibraryViews();
  renderGroceries();
}

function learnGroceryItemSplit(row) {
  const choices = [...new Set(row.rawNames || [])];
  if (!choices.length) return;
  const selected = window.prompt(
    `Which name should remain separate?\n${choices.join("\n")}`,
    choices[0]
  );
  if (selected === null) return;
  const matched = choices.find((name) => normalize(name) === normalize(selected)) || selected.trim();
  if (!matched) return;
  const identity = LiveGroceryCatalog.normalizeGroceryItemName(matched);
  state.grocerySplitPreferences = {
    ...grocerySplitPreferences(),
    [identity.normalizedName]: identity.normalizedName
  };
  rekeyGroceryIdentityState();
  persist();
  renderGroceries();
}

function rekeyGroceryIdentityState() {
  const nextChecked = {};
  Object.entries(state.checkedGroceries || {}).forEach(([key, checked]) => {
    const separator = key.indexOf("|");
    if (separator < 0) {
      nextChecked[key] = Boolean(nextChecked[key] || checked);
      return;
    }
    const week = key.slice(0, separator);
    const itemKey = key.slice(separator + 1);
    const nextKey = groceryCheckedKey(week, canonicalGroceryItemKey(itemKey));
    nextChecked[nextKey] = Boolean(nextChecked[nextKey] || checked);
  });
  state.checkedGroceries = nextChecked;

  const nextLocations = {};
  Object.entries(state.groceryItemLocations || {}).forEach(([itemKey, location]) => {
    const nextKey = canonicalGroceryItemKey(itemKey);
    if (!nextKey) return;
    nextLocations[nextKey] = nextLocations[nextKey] || location;
  });
  state.groceryItemLocations = normalizeGroceryItemLocations(nextLocations, groceryStores());

  const nextSections = {};
  Object.entries(state.groceryStoreItemSections || {}).forEach(([storeId, itemMappings]) => {
    Object.entries(itemMappings || {}).forEach(([itemKey, sectionId]) => {
      const nextKey = canonicalGroceryItemKey(itemKey);
      if (!nextKey) return;
      if (!nextSections[storeId]) nextSections[storeId] = {};
      if (!nextSections[storeId][nextKey]) nextSections[storeId][nextKey] = sectionId;
    });
  });
  state.groceryStoreItemSections = normalizeGroceryStoreItemSections(nextSections, groceryStores());

  const nextDailyDozenTags = {};
  Object.entries(state.groceryDailyDozenTags || {}).forEach(([itemKey, tags]) => {
    const nextKey = canonicalGroceryItemKey(itemKey);
    if (!nextKey) return;
    nextDailyDozenTags[nextKey] = nextDailyDozenTags[nextKey] || tags;
  });
  state.groceryDailyDozenTags = normalizeGroceryDailyDozenTags(nextDailyDozenTags);
}

function formatReceiptObservationDate(value) {
  const dateKey = String(value || "").slice(0, 10);
  const date = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(date.getTime()) ? dateKey : date.toLocaleDateString();
}

function handleGroceryItemDragStart(event) {
  const itemKey = event.currentTarget.dataset.groceryRowKey;
  const sourceList = event.currentTarget.closest("[data-grocery-store-list]");
  const storeId = sourceList?.dataset.groceryStoreList || "";
  const sectionId = sourceList?.dataset.groceryStoreSectionList || "";
  if (!itemKey) return;
  draggedGroceryItem = { itemKey, sourceStoreId: storeId, sourceSectionId: sectionId };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-live-grocery", JSON.stringify(draggedGroceryItem));
    event.dataTransfer.setData("text/plain", itemKey);
  }
  event.currentTarget.classList.add("is-dragging");
}

function handleGroceryItemDragOver(event) {
  if (!groceryDragPayload(event)) return;
  event.preventDefault();
  event.stopPropagation();
  const target = event.currentTarget;
  if (target.dataset.groceryRowKey === draggedGroceryItem?.itemKey) return;
  const rect = target.getBoundingClientRect();
  const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  elements.groceryList.querySelectorAll(".grocery-item.drop-before, .grocery-item.drop-after").forEach((item) => {
    if (item !== target) item.classList.remove("drop-before", "drop-after");
  });
  target.classList.toggle("drop-before", position === "before");
  target.classList.toggle("drop-after", position === "after");
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

function handleGroceryItemDrop(event) {
  const payload = groceryDragPayload(event);
  if (!payload) return;
  event.preventDefault();
  event.stopPropagation();
  const target = event.currentTarget;
  const targetKey = target.dataset.groceryRowKey;
  const targetList = target.closest("[data-grocery-store-list]");
  const targetStoreId = targetList?.dataset.groceryStoreList || "";
  const targetSectionId = targetList?.dataset.groceryStoreSectionList || "";
  const position = target.classList.contains("drop-before") ? "before" : "after";
  moveGroceryItem(payload.itemKey, targetStoreId, targetKey, position, targetSectionId);
}

function clearGroceryItemDropTarget(event) {
  event.currentTarget.classList.remove("drop-before", "drop-after");
}

function handleGroceryStoreDragOver(event) {
  if (!groceryDragPayload(event) || event.target.closest("[data-grocery-row-key]")) return;
  event.preventDefault();
  event.currentTarget.classList.add("drag-over");
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

function handleGroceryStoreDrop(event) {
  if (event.target.closest("[data-grocery-row-key]")) return;
  const payload = groceryDragPayload(event);
  if (!payload) return;
  event.preventDefault();
  const storeId = event.currentTarget.dataset.groceryStoreList || "";
  const sectionId = event.currentTarget.dataset.groceryStoreSectionList || "";
  moveGroceryItem(payload.itemKey, storeId, "", "after", sectionId);
}

function clearGroceryStoreDropTarget(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return;
  event.currentTarget.classList.remove("drag-over");
}

function groceryDragPayload(event) {
  if (draggedGroceryItem?.itemKey) return draggedGroceryItem;
  try {
    const payload = JSON.parse(event.dataTransfer.getData("application/x-live-grocery") || "{}");
    return payload.itemKey ? payload : null;
  } catch {
    return null;
  }
}

function moveGroceryItem(itemKey, targetStoreId, targetKey = "", position = "after", targetSectionId = "") {
  if (!itemKey || (targetKey && itemKey === targetKey)) {
    clearGroceryItemDragState();
    return;
  }
  const validStoreId = groceryStores().some((store) => store.id === targetStoreId) ? targetStoreId : "";
  const locations = groceryItemLocations();
  const sourceStoreId = locations[itemKey]?.storeId || draggedGroceryItem?.sourceStoreId || "";
  const sourceKeys = orderedGroceryKeysForStore(sourceStoreId, locations).filter((key) => key !== itemKey);
  const targetKeys = (sourceStoreId === validStoreId
    ? sourceKeys
    : orderedGroceryKeysForStore(validStoreId, locations).filter((key) => key !== itemKey));
  const targetIndex = targetKey ? targetKeys.indexOf(targetKey) : -1;
  const insertAt = targetIndex < 0 ? targetKeys.length : targetIndex + (position === "after" ? 1 : 0);
  targetKeys.splice(insertAt, 0, itemKey);
  reindexGroceryStore(sourceStoreId, sourceKeys, locations);
  reindexGroceryStore(validStoreId, targetKeys, locations);
  state.groceryItemLocations = normalizeGroceryItemLocations(locations, groceryStores());
  if (validStoreId && targetSectionId) {
    const mappings = groceryStoreItemSections();
    if (!mappings[validStoreId]) mappings[validStoreId] = {};
    mappings[validStoreId][itemKey] = targetSectionId;
    state.groceryStoreItemSections = normalizeGroceryStoreItemSections(mappings, groceryStores());
  }
  persist();
  clearGroceryItemDragState();
  renderGroceries();
}

function orderedGroceryKeysForStore(storeId, locations) {
  const storedKeys = Object.entries(locations)
    .filter(([, location]) => (location.storeId || "") === storeId)
    .sort((a, b) => Number(a[1].order || 0) - Number(b[1].order || 0) || a[0].localeCompare(b[0]))
    .map(([key]) => key);
  const visibleLists = [...elements.groceryList.querySelectorAll("[data-grocery-store-list]")]
    .filter((list) => (list.dataset.groceryStoreList || "") === storeId);
  visibleLists.flatMap((list) => [...list.querySelectorAll("[data-grocery-row-key]")]).forEach((item) => {
    if (!storedKeys.includes(item.dataset.groceryRowKey)) storedKeys.push(item.dataset.groceryRowKey);
  });
  return storedKeys;
}

function reindexGroceryStore(storeId, keys, locations) {
  keys.forEach((key, index) => {
    const existing = locations[key];
    const oldRank = existing?.storeRank || (existing?.storeId ? [existing.storeId] : []);
    const storeRank = storeId
      ? [storeId, ...oldRank.filter((id) => id !== storeId)]
      : oldRank;
    locations[key] = { storeId, storeRank, order: (index + 1) * 100 };
  });
}

function clearGroceryItemDragState() {
  draggedGroceryItem = null;
  elements.groceryList.querySelectorAll(".is-dragging, .drop-before, .drop-after, .drag-over").forEach((item) => {
    item.classList.remove("is-dragging", "drop-before", "drop-after", "drag-over");
  });
}

function renderGroceryWeekOptions() {
  const weeks = liveGroceryWeekOptions();
  if (!weeks.some((week) => week.key === selectedGroceryWeekKey)) {
    const activeKey = weekKey();
    selectedGroceryWeekKey = weeks.find((week) => week.key === activeKey)?.key || weeks[0]?.key || "";
  }
  if (getActiveAppArea() === "shop") {
    const label = groceryRangeStart && groceryRangeEnd
      ? `${formatShortDate(groceryRangeStart)} – ${formatShortDate(groceryRangeEnd)}`
      : (weeks.find((w) => w.key === selectedGroceryWeekKey)?.label || "");
    elements.weekLabel.textContent = label;
  }
}

function navigateGroceryWeek(delta) {
  if (getActiveAppArea() === "shop") {
    shiftGroceryRange(delta * 7);
    return;
  }
  const weeks = liveGroceryWeekOptions();
  const idx = weeks.findIndex((w) => w.key === selectedGroceryWeekKey);
  const next = weeks[idx - delta];
  if (next) {
    selectedGroceryWeekKey = next.key;
    renderGroceries();
  }
}

function liveGroceryWeekOptions() {
  const currentKey = weekKey();
  const seen = new Set();
  const result = [];
  Object.entries(state.plans || {}).forEach(([key, plan]) => {
    if (!plan || seen.has(key)) return;
    if (key === currentKey || hasMealPlanSlots(plan.slots)) {
      seen.add(key);
      result.push({
        key,
        label: plan.rangeLabel || formatWeekRange(dateFromWeekKey(key)),
        week: plan
      });
    }
  });
  if (!seen.has(currentKey)) {
    result.push({
      key: currentKey,
      label: formatWeekRange(dateFromWeekKey(currentKey)),
      week: weekState()
    });
  }
  return result.sort((a, b) => String(b.key).localeCompare(String(a.key)));
}

function hasMealPlanSlots(slots) {
  if (!slots) return false;
  return Object.values(slots).some((daySlots) =>
    daySlots && Object.values(daySlots).some((v) => String(v || "").trim())
  );
}

function selectedGroceryWeek() {
  const weeks = liveGroceryWeekOptions();
  return weeks.find((week) => week.key === selectedGroceryWeekKey) || weeks[0] || null;
}

function groceryCheckedKey(weekKeyValue, rowKey) {
  return `${weekKeyValue || "week"}|${rowKey}`;
}

function addManualGroceryItem(event) {
  event.preventDefault();
  const item = elements.groceryInput.value.trim();
  if (!item) return;
  // Next Stop designation (spec #32): a spontaneous, store-independent need.
  if (groceryAddNextStop) {
    addNextStopItem(item);
    elements.groceryInput.value = "";
    setGroceryAddNextStop(false);
    persist();
    renderGroceries();
    return;
  }
  if (!Array.isArray(state.persistentManualGroceries)) state.persistentManualGroceries = [];
  if (!state.persistentManualGroceries.some((existing) => normalize(existing) === normalize(item))) {
    state.persistentManualGroceries.push(item);
    state.persistentManualGroceries.sort((a, b) => normalize(a).localeCompare(normalize(b)));
  }
  // A brand-new item with no known store lands in Other (spec) — we set no
  // this-trip override, so resolveItemEffectiveStoreId returns null → Other.
  // An item that already carries a saved store preference keeps routing to it.
  elements.groceryInput.value = "";
  persist();
  renderGroceries();
}

function setGroceryAddNextStop(on) {
  groceryAddNextStop = !!on;
  const btn = document.getElementById("groceryNextStopToggle");
  if (btn) btn.setAttribute("aria-pressed", String(groceryAddNextStop));
  const input = document.getElementById("groceryInput");
  if (input) input.placeholder = groceryAddNextStop ? "Add to Next Stop" : "Add item";
}

function groceryItemWeekOverrideKey(itemKey) {
  return `${groceryCycleKey()}::${itemKey}`;
}

function groceryItemWeekOverrides() {
  const map = state.groceryItemWeekOverride;
  return map && typeof map === "object" ? map : {};
}

function setGroceryItemStoreForTrip(itemKey, storeId) {
  if (!itemKey || !groceryStores().some((s) => s.id === storeId)) return;
  if (!state.groceryItemWeekOverride || typeof state.groceryItemWeekOverride !== "object") state.groceryItemWeekOverride = {};
  state.groceryItemWeekOverride[groceryItemWeekOverrideKey(itemKey)] = storeId;
}

function removeManualGroceryItem(item) {
  state.persistentManualGroceries = (state.persistentManualGroceries || []).filter((existing) => existing !== item);
  const itemKey = manualGroceryRow(item).key;
  Object.keys(state.checkedGroceries).forEach((key) => {
    if (key.endsWith(`|${itemKey}`)) delete state.checkedGroceries[key];
  });
  persist();
  renderGroceries();
}

function editGroceryItem(key) {
  const groceryWeek = selectedGroceryWeek();
  if (!groceryWeek) return;
  const row = buildGroceryRowsWithManual(groceryWeek.week).find((r) => r.key === key);
  if (!row) return;
  if (row.manual) {
    const updated = window.prompt("Edit item:", row.manualValue);
    if (updated === null) return;
    const trimmed = updated.trim();
    if (!trimmed || trimmed === row.manualValue) return;
    state.persistentManualGroceries = (state.persistentManualGroceries || []).map((v) => (v === row.manualValue ? trimmed : v));
    persist();
    renderGroceries();
  } else {
    learnGroceryItemMerge(row);
  }
}

function deleteGroceryItem(key) {
  // Check manual items first
  const manualRow = manualGroceryItems().map(manualGroceryRow).find((r) => r.key === key);
  if (manualRow) {
    removeManualGroceryItem(manualRow.manualValue);
    return;
  }
  // For plan-derived items, add to skippedGroceryKeys for every week overlapping the current range
  let saved = false;
  Object.entries(state.plans || {}).forEach(([planKey, weekPlan]) => {
    if (!weekPlan) return;
    const ws = dateFromWeekKey(planKey);
    if (isNaN(ws.getTime())) return;
    const wsISO = dateKeyFromDate(ws);
    const weDate = new Date(ws); weDate.setDate(ws.getDate() + 7);
    const weISO = dateKeyFromDate(weDate);
    if (weISO < groceryRangeStart || wsISO > groceryRangeEnd) return;
    weekPlan.skippedGroceryKeys = [...new Set([...(weekPlan.skippedGroceryKeys || []), key])];
    saved = true;
  });
  if (saved) {
    persist();
    renderGroceries();
  }
}

function closeGrocerySwipe() {
  document.querySelectorAll(".grocery-item-wrap.is-swiped").forEach((el) => el.classList.remove("is-swiped"));
  grocerySwipeGesture = null;
}

function handleGrocerySwipePointerDown(event) {
  if (event.pointerType === "mouse") return;
  grocerySwipeGesture = { id: event.pointerId, startX: event.clientX, startY: event.clientY, wrap: event.currentTarget };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function handleGrocerySwipePointerMove(event) {
  if (!grocerySwipeGesture || grocerySwipeGesture.id !== event.pointerId) return;
  const dx = event.clientX - grocerySwipeGesture.startX;
  const dy = event.clientY - grocerySwipeGesture.startY;
  const wrap = grocerySwipeGesture.wrap;
  if (Math.abs(dy) > Math.abs(dx) + 5 && !wrap.classList.contains("is-swiped")) {
    grocerySwipeGesture = null;
    return;
  }
  if (dx < -30) {
    document.querySelectorAll(".grocery-item-wrap.is-swiped").forEach((el) => { if (el !== wrap) el.classList.remove("is-swiped"); });
    wrap.classList.add("is-swiped");
  } else if (dx > 10) {
    wrap.classList.remove("is-swiped");
  }
}

function handleGrocerySwipePointerEnd(event) {
  if (!grocerySwipeGesture || grocerySwipeGesture.id !== event.pointerId) return;
  grocerySwipeGesture = null;
}

function scheduleGroceryItemReview(rows) {
  if (pendingGroceryReview || elements.groceryReviewDialog.open) return;
  const reviewRow = rows.find(shouldReviewGroceryRow);
  if (!reviewRow) return;
  window.setTimeout(() => openGroceryItemReview(reviewRow), 100);
}

function openPublishedGroceryReview() {
  const reviewItems = unlistedPublishedGroceryItems();
  openGroceryReviewItems(reviewItems, "Add these to Grocery Items so future grocery lists can recognize them.");
}

function openGroceryReviewItems(reviewItems, contextText) {
  if (!reviewItems.length || document.querySelector("dialog[open]")) return;
  pendingGroceryReview = null;
  pendingGroceryReviewItems = reviewItems;
  elements.groceryReviewItem.textContent = `${reviewItems.length} unlisted ingredient${reviewItems.length === 1 ? "" : "s"}`;
  elements.groceryReviewContext.textContent = contextText || "Add these to Grocery Items so future grocery lists can recognize them.";
  elements.goToGroceryReviewRecipeBtn.hidden = true;
  elements.groceryReviewList.innerHTML = reviewItems
    .map((item, index) => `
      <div class="grocery-review-row">
        <label>
          <input type="checkbox" data-grocery-review-index="${index}" checked />
          <span>
            <strong>${escapeHtml(item.item)}</strong>
            ${item.sources.length ? `<small>${escapeHtml(item.sources.map((source) => source.name).join(", "))}</small>` : ""}
          </span>
        </label>
        ${item.sources.some((source) => source.id) ? `
          <div class="grocery-review-source-actions">
            ${item.sources
              .filter((source) => source.id)
              .map((source) => `<button class="secondary-btn compact-btn" type="button" data-grocery-review-recipe="${escapeHtml(source.id)}">Edit ${escapeHtml(source.name)}</button>`)
              .join("")}
          </div>
        ` : ""}
      </div>
    `)
    .join("");
  bindGroceryReviewRecipeButtons();
  elements.groceryReviewDialog.showModal();
}

function unlistedPublishedGroceryItems() {
  return unlistedGroceryItemsForWeek(weekState());
}

function unlistedGroceryItemsForWeek(week) {
  const items = new Map();
  buildRawGroceryRows(week).forEach((row) => {
    if (!row.item || groceryBaseHasItem(row.item)) return;
    const key = normalize(row.item);
    if (!items.has(key)) items.set(key, { item: row.item, sources: new Map() });
    if (row.sourceRecipeName) {
      const sourceKey = row.sourceRecipeId || row.sourceRecipeName;
      items.get(key).sources.set(sourceKey, {
        id: row.sourceRecipeId || "",
        name: row.sourceRecipeName
      });
    }
  });
  return [...items.values()]
    .map((item) => ({
      item: item.item,
      sources: [...item.sources.values()].sort((a, b) => a.name.localeCompare(b.name))
    }))
    .sort((a, b) => normalize(a.item).localeCompare(normalize(b.item)));
}

function shouldReviewGroceryRow(row) {
  return Boolean(
    row.sourceRecipeId
    && row.item
    && !groceryBaseHasItem(row.item)
    && !state.groceryReviewDismissed?.[groceryReviewKey(row)]
  );
}

function groceryBaseHasItem(item) {
  const itemKey = groceryRowKey(item);
  return groceryBaseItems().some((existing) => groceryRowKey(existing) === itemKey);
}

function groceryReviewKey(row) {
  return [row.sourceRecipeId || "", row.item].map(normalize).join("|");
}

function openGroceryItemReview(row) {
  if (!shouldReviewGroceryRow(row) || document.querySelector("dialog[open]")) return;
  pendingGroceryReviewItems = [];
  pendingGroceryReview = row;
  elements.groceryReviewItem.textContent = row.item;
  elements.groceryReviewContext.textContent = row.sourceRecipeName
    ? `"${row.item}" is not in Grocery Items. It came from ${row.sourceRecipeName}.`
    : `"${row.item}" is not in Grocery Items.`;
  elements.groceryReviewList.innerHTML = "";
  elements.goToGroceryReviewRecipeBtn.hidden = !row.sourceRecipeId;
  elements.goToGroceryReviewRecipeBtn.textContent = "Edit recipe";
  elements.groceryReviewDialog.showModal();
}

function dismissCurrentGroceryReview() {
  if (pendingGroceryReviewItems.length) {
    pendingGroceryReviewItems = [];
    elements.groceryReviewDialog.close();
    return;
  }
  if (pendingGroceryReview) {
    if (!state.groceryReviewDismissed) state.groceryReviewDismissed = {};
    state.groceryReviewDismissed[groceryReviewKey(pendingGroceryReview)] = true;
    persist();
  }
  pendingGroceryReview = null;
  elements.groceryReviewDialog.close();
}

function goToGroceryReviewRecipe() {
  const recipeId = pendingGroceryReview?.sourceRecipeId;
  if (recipeId) openGroceryReviewRecipeEditor(recipeId);
}

function bindGroceryReviewRecipeButtons() {
  elements.groceryReviewList.querySelectorAll("[data-grocery-review-recipe]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openGroceryReviewRecipeEditor(button.dataset.groceryReviewRecipe);
    });
  });
}

function openGroceryReviewRecipeEditor(recipeId) {
  pendingGroceryReview = null;
  pendingGroceryReviewItems = [];
  elements.groceryReviewDialog.close();
  if (recipeId) openRecipeDialog(recipeId);
}

function addCurrentGroceryReviewItem() {
  if (pendingGroceryReviewItems.length) {
    const selected = [...elements.groceryReviewList.querySelectorAll("[data-grocery-review-index]:checked")]
      .map((checkbox) => pendingGroceryReviewItems[Number(checkbox.dataset.groceryReviewIndex)]?.item)
      .filter(Boolean);
    if (!selected.length) {
      dismissCurrentGroceryReview();
      return;
    }
    state.groceryBaseItems = normalizeGroceryBaseItems([...groceryBaseItems(), ...selected]);
    selected.forEach(clearDismissedGroceryReviewsForItem);
    pendingGroceryReviewItems = [];
    persist();
    refreshGroceryLibraryViews();
    renderGroceries();
    elements.groceryReviewDialog.close();
    return;
  }
  if (!pendingGroceryReview?.item) return;
  state.groceryBaseItems = normalizeGroceryBaseItems([...groceryBaseItems(), pendingGroceryReview.item]);
  clearDismissedGroceryReviewsForItem(pendingGroceryReview.item);
  pendingGroceryReview = null;
  persist();
  refreshGroceryLibraryViews();
  elements.groceryReviewDialog.close();
}

function clearDismissedGroceryReviewsForItem(item) {
  if (!state.groceryReviewDismissed) state.groceryReviewDismissed = {};
  Object.keys(state.groceryReviewDismissed).forEach((key) => {
    if (key.endsWith(`|${normalize(item)}`)) delete state.groceryReviewDismissed[key];
  });
}

function renderPantry() {
  if (!elements.pantryList) return;
  if (!state.pantry.length) {
    elements.pantryList.innerHTML = `<div class="empty-state">Add staple ingredients to keep them off your grocery list.</div>`;
    return;
  }

  elements.pantryList.innerHTML = state.pantry
    .map((item) => `<span class="chip">${escapeHtml(item)} <button data-pantry="${escapeHtml(item)}" aria-label="Remove ${escapeHtml(item)}">×</button></span>`)
    .join("");

  elements.pantryList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.pantry = state.pantry.filter((item) => item !== button.dataset.pantry);
      persist();
      renderPantry();
      renderGroceries();
    });
  });
}

function addPantryItem(event) {
  event.preventDefault();
  if (!elements.pantryInput) return;
  const item = elements.pantryInput.value.trim();
  if (!item) return;
  if (!state.pantry.some((existing) => normalize(existing) === normalize(item))) {
    state.pantry.push(item);
    state.pantry.sort((a, b) => a.localeCompare(b));
  }
  elements.pantryInput.value = "";
  persist();
  renderPantry();
  renderGroceries();
}

function buildGroceryItems(week = weekState()) {
  const groceryRows = [];
  const slots = mealSlotsForWeek(week);
  const combinedState = combinedMealSectionsForWeek(week);
  prepDays.forEach((day) => mealKeysForDay(day, combinedState).forEach((meal) => {
    slotEntries(slots?.[day.id]?.[meal]).forEach((entry) => {
      const groceryRecipe = groceryRecipeForSlot(entry);
      if (groceryRecipe) {
        groceryRows.push(...normalizeIngredients(groceryRecipe.ingredients).map((ingredient) => scaledIngredientToText(ingredient, groceryRecipe.groceryMealServings)));
        return;
      }
      const recipe = recipeForSlot(entry);
      if (!recipe) return;
      const scale = LiveMealPlanServings.scalingFactor(entry, recipe);
      groceryRows.push(...normalizeIngredients(recipe.ingredients)
        .map((ingredient) => scaledIngredientToText(ingredient, scale)));
    });
  }));

  return groceryRows.filter(Boolean).sort((a, b) => normalize(a).localeCompare(normalize(b)));
}

function buildGroceryRows(week = weekState()) {
  return aggregateGroceryRows(buildRawGroceryRows(week));
}

function buildRawGroceryRows(week = weekState()) {
  const rows = [];
  const slots = mealSlotsForWeek(week);
  const combinedState = combinedMealSectionsForWeek(week);
  prepDays.forEach((day) => mealKeysForDay(day, combinedState).forEach((meal) => {
    slotEntries(slots?.[day.id]?.[meal]).forEach((entry) => {
      const groceryRecipe = groceryRecipeForSlot(entry);
      if (groceryRecipe) {
        normalizeIngredients(groceryRecipe.ingredients)
          .map((ingredient) => ingredientToGroceryRow({
            ...ingredient,
            amount: scaleIngredientAmount(ingredient.amount, groceryRecipe.groceryMealServings)
          }, groceryRecipe))
          .filter((row) => row.item)
          .forEach((row) => rows.push(row));
        return;
      }
      const recipe = recipeForSlot(entry);
      if (!recipe) return;
      const scale = LiveMealPlanServings.scalingFactor(entry, recipe);
      normalizeIngredients(recipe.ingredients)
        .map((ingredient) => ingredientToGroceryRow({
          ...ingredient,
          amount: scaleIngredientAmount(ingredient.amount, scale)
        }, recipe))
        .filter((row) => row.item)
        .forEach((row) => rows.push(row));
    });
  }));

  return rows;
}

function buildRawGroceryRowsForRange(startISO, endISO) {
  if (!startISO || !endISO) return buildRawGroceryRows();
  const rows = [];
  Object.entries(state.plans || {}).forEach(([key, weekPlan]) => {
    if (!weekPlan) return;
    const weekStart = dateFromWeekKey(key);
    if (isNaN(weekStart.getTime())) return;
    prepDays.forEach((day) => {
      const dayDate = new Date(weekStart);
      dayDate.setDate(weekStart.getDate() + day.offset);
      const dayISO = dateKeyFromDate(dayDate);
      if (dayISO < startISO || dayISO > endISO) return;
      const slots = mealSlotsForWeek(weekPlan);
      const combinedState = combinedMealSectionsForWeek(weekPlan);
      mealKeysForDay(day, combinedState).forEach((meal) => {
        slotEntries(slots?.[day.id]?.[meal]).forEach((entry) => {
          const groceryRecipe = groceryRecipeForSlot(entry);
          if (groceryRecipe) {
            normalizeIngredients(groceryRecipe.ingredients)
              .map((ingredient) => ingredientToGroceryRow({
                ...ingredient,
                amount: scaleIngredientAmount(ingredient.amount, groceryRecipe.groceryMealServings)
              }, groceryRecipe))
              .filter((row) => row.item)
              .forEach((row) => rows.push(row));
            return;
          }
          const recipe = recipeForSlot(entry);
          if (!recipe) return;
          const scale = LiveMealPlanServings.scalingFactor(entry, recipe);
          normalizeIngredients(recipe.ingredients)
            .map((ingredient) => ingredientToGroceryRow({
              ...ingredient,
              amount: scaleIngredientAmount(ingredient.amount, scale)
            }, recipe))
            .filter((row) => row.item)
            .forEach((row) => rows.push(row));
        });
      });
    });
  });
  return rows;
}

function upcomingFriday(from) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const add = (5 - d.getDay() + 7) % 7 || 7; // 5 = Friday; strictly after today, so Friday → +7
  d.setDate(d.getDate() + add);
  return d;
}

function initGroceryRange(force = false) {
  if (!force && groceryRangeStart && groceryRangeEnd) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  groceryRangeStart = dateKeyFromDate(today);
  groceryRangeEnd = dateKeyFromDate(upcomingFriday(today));
  syncGroceryRangeInputs();
}

function groceryCycleKey() {
  return groceryRangeEnd || dateKeyFromDate(upcomingFriday(new Date()));
}

function groceryClearedKey(rowKey) {
  return `${groceryCycleKey()}::${rowKey}`;
}

function isGroceryCleared(rowKey) {
  return Boolean(state.groceryCleared?.[groceryClearedKey(rowKey)]);
}

function setGroceryCleared(rowKey, cleared) {
  if (!state.groceryCleared || typeof state.groceryCleared !== "object") state.groceryCleared = {};
  // Restore writes an explicit `false` rather than deleting — same merge-safety
  // trick the store-skip map uses, so a stale device's `true` can't resurrect a
  // clear the user has since undone (newer stateUpdatedAt wins the merge).
  state.groceryCleared[groceryClearedKey(rowKey)] = Boolean(cleared);
}

function groceryBroomSvg() {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 4.5 12 12"/><path d="m11 10 3 3-4.6 4.6a3 3 0 0 1-1.8.85l-3.9.45.45-3.9a3 3 0 0 1 .85-1.8L11 10Z"/><path d="m6.5 15.5 2 2"/></svg>`;
}

function clearCheckedGroceriesForStore(storeId) {
  const section = elements.groceryList.querySelector(`[data-grocery-store-section="${(window.CSS && CSS.escape) ? CSS.escape(storeId || "") : (storeId || "")}"]`);
  if (!section) return;
  const keys = new Set();
  section.querySelectorAll("input[data-grocery]:checked").forEach((cb) => {
    const rowKey = cb.closest("[data-grocery-row-key]")?.dataset.groceryRowKey;
    if (rowKey) keys.add(rowKey);
  });
  if (!keys.size) return;
  keys.forEach((k) => setGroceryCleared(k, true));
  persist();
  renderGroceries();
}

function restoreClearedGroceries() {
  const prefix = `${groceryCycleKey()}::`;
  if (state.groceryCleared) {
    Object.keys(state.groceryCleared).forEach((k) => { if (k.startsWith(prefix)) state.groceryCleared[k] = false; });
  }
  showClearedGroceries = false;
  persist();
  renderGroceries();
}

function syncGroceryRangeInputs() {
  const startBtn = document.getElementById("groceryRangeStartBtn");
  const endBtn = document.getElementById("groceryRangeEndBtn");
  if (startBtn) startBtn.textContent = groceryRangeStart ? formatRangeDate(groceryRangeStart) : "—";
  if (endBtn) endBtn.textContent = groceryRangeEnd ? formatRangeDate(groceryRangeEnd) : "—";
  if (getActiveAppArea() === "shop") {
    const label = groceryRangeStart && groceryRangeEnd
      ? `${formatShortDate(groceryRangeStart)} – ${formatShortDate(groceryRangeEnd)}`
      : "";
    if (elements.weekLabel) elements.weekLabel.textContent = label;
  }
}

function formatRangeDate(iso) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function toggleGroceryRangeMenu(which) {
  const menuId = which === "start" ? "groceryRangeStartMenu" : "groceryRangeEndMenu";
  const btnId = which === "start" ? "groceryRangeStartBtn" : "groceryRangeEndBtn";
  const menu = document.getElementById(menuId);
  const btn = document.getElementById(btnId);
  if (!menu || !btn) return;
  const willOpen = menu.hidden;
  closeFloatingMenus();
  if (!willOpen) return;
  renderGroceryRangeMenu(which, menu);
  menu.hidden = false;
  btn.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    const selected = menu.querySelector(".grocery-range-option.is-selected");
    // Scroll WITHIN the menu, not via scrollIntoView — the latter scrolls the
    // page, which fires the window scroll listener (closeFloatingMenusOnPageScroll)
    // and instantly closes the menu on mobile ("opens briefly then disappears").
    // A scroll of the menu itself is target-guarded, so it stays open.
    if (selected) menu.scrollTop = selected.offsetTop - menu.clientHeight / 2 + selected.offsetHeight / 2;
  });
}

function closeGroceryRangeMenus() {
  ["groceryRangeStartMenu", "groceryRangeEndMenu"].forEach((id) => {
    const menu = document.getElementById(id);
    if (menu) menu.hidden = true;
  });
  document.getElementById("groceryRangeStartBtn")?.setAttribute("aria-expanded", "false");
  document.getElementById("groceryRangeEndBtn")?.setAttribute("aria-expanded", "false");
}

function renderGroceryRangeMenu(which, menu) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayISO = dateKeyFromDate(today);

  // Start: 1 week back → 4 weeks out. End: chosen start → start + 4 weeks.
  let cursor;
  let count;
  if (which === "start") {
    cursor = new Date(today); cursor.setDate(today.getDate() - 7);
    count = 36;
  } else {
    const anchor = groceryRangeStart ? new Date(groceryRangeStart + "T00:00:00") : today;
    cursor = new Date(anchor);
    count = 29;
  }

  const currentISO = which === "start" ? groceryRangeStart : groceryRangeEnd;
  const rows = [];

  for (let i = 0; i < count; i++) {
    const iso = dateKeyFromDate(cursor);
    const isSelected = iso === currentISO;
    const label = cursor.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    rows.push(`<button type="button" class="grocery-range-option${isSelected ? " is-selected" : ""}" data-range-pick="${escapeHtml(iso)}" data-range-which="${which}">${escapeHtml(label)}</button>`);
    cursor.setDate(cursor.getDate() + 1);
  }

  menu.innerHTML = `<div class="grocery-range-menu-inner">${rows.join("")}</div>`;
  menu.addEventListener("click", handleGroceryRangePick, { once: true });
}

function weekLabelForDate(date) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((date - today) / 86400000);
  if (diffDays < -7) return "Earlier";
  if (diffDays < 0) return "Last week";
  if (diffDays < 7) return "This week";
  if (diffDays < 14) return "Next week";
  if (diffDays < 21) return "In 2 weeks";
  if (diffDays < 28) return "In 3 weeks";
  return "In 4 weeks";
}

function handleGroceryRangePick(event) {
  const btn = event.target.closest("[data-range-pick]");
  if (!btn) {
    // re-attach if user clicked non-option area
    event.currentTarget.addEventListener("click", handleGroceryRangePick, { once: true });
    return;
  }
  const iso = btn.dataset.rangePick;
  const which = btn.dataset.rangeWhich;
  if (which === "start") {
    groceryRangeStart = iso;
    if (groceryRangeEnd < groceryRangeStart) groceryRangeEnd = groceryRangeStart;
  } else {
    groceryRangeEnd = iso;
    if (groceryRangeStart > groceryRangeEnd) groceryRangeStart = groceryRangeEnd;
  }
  closeGroceryRangeMenus();
  syncGroceryRangeInputs();
  renderGroceries();
}

function shiftGroceryRange(days) {
  if (!groceryRangeStart || !groceryRangeEnd) initGroceryRange();
  const start = new Date(groceryRangeStart + "T00:00:00");
  const end = new Date(groceryRangeEnd + "T00:00:00");
  start.setDate(start.getDate() + days);
  end.setDate(end.getDate() + days);
  groceryRangeStart = dateKeyFromDate(start);
  groceryRangeEnd = dateKeyFromDate(end);
  syncGroceryRangeInputs();
  renderGroceries();
}

function ingredientToGroceryRow(ingredient, recipe = null) {
  const normalized = typeof ingredient === "string" ? parseIngredientLine(ingredient) : ingredient;
  const item = normalized.item || "";
  const identity = normalizeGroceryItemName(item);
  const amount = normalized.amount || "";
  const unit = normalized.quantity || "";
  const quantity = [amount, unit].filter(Boolean).join(" ");
  const prep = normalized.prep || "";
  return {
    key: identity.canonicalName,
    item: identity.displayName || item,
    displayName: identity.displayName || item,
    canonicalName: identity.canonicalName,
    rawNames: [item].filter(Boolean),
    amount,
    unit,
    quantity,
    prep,
    notes: [...new Set([...identity.notes, prep].filter(Boolean))],
    category: identity.category,
    subcategory: identity.subcategory,
    manual: false,
    sourceRecipeId: recipe?.id || "",
    sourceRecipeName: recipe?.name || "",
    sourceRecipeIds: recipe?.id ? [recipe.id] : []
  };
}

function grocerySuggestionItems({ includeCurrentGroceries = true } = {}) {
  const suggestions = new Map();
  [
    ...groceryBaseItems(),
    ...Object.values(groceryAliases()).flat(),
    ...(includeCurrentGroceries ? buildGroceryItemsWithManual() : []),
    ...activeRecipes().flatMap((recipe) => normalizeIngredients(recipe.ingredients).map((ingredient) => ingredient.item)),
    ...state.pantry
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .forEach((item) => {
      const key = normalize(item);
      if (!suggestions.has(key)) suggestions.set(key, item);
    });
  return [...suggestions.values()].sort((a, b) => normalize(a).localeCompare(normalize(b)));
}

function manualGroceryItems(week = weekState()) {
  return Array.isArray(state.persistentManualGroceries) ? state.persistentManualGroceries : [];
}

function buildGroceryItemsWithManual(week = weekState()) {
  return [...new Set([...buildGroceryItems(week), ...manualGroceryItems(week)])]
    .sort((a, b) => normalize(a).localeCompare(normalize(b)));
}

function buildGroceryRowsWithManual(week = weekState()) {
  return aggregateGroceryRows([...buildRawGroceryRows(week), ...manualGroceryItems(week).map(manualGroceryRow)]);
}

function groceryChecklistState() {
  if (!state.groceryChecklist || typeof state.groceryChecklist !== "object") {
    state.groceryChecklist = { config: [], provisional: {}, submissions: {} };
  }
  const cl = state.groceryChecklist;
  if (!Array.isArray(cl.config)) cl.config = [];
  if (!cl.provisional || typeof cl.provisional !== "object") cl.provisional = {};
  if (!cl.submissions || typeof cl.submissions !== "object") cl.submissions = {};
  return cl;
}

function groceryChecklistConfig() { return groceryChecklistState().config; }

function groceryChecklistCurrentSubmission() { return groceryChecklistState().submissions[groceryCycleKey()] || null; }

function groceryChecklistCurrentAnswers() {
  const cl = groceryChecklistState();
  const cycle = groceryCycleKey();
  if (cl.provisional[cycle] && typeof cl.provisional[cycle] === "object") return cl.provisional[cycle];
  const sub = cl.submissions[cycle];
  return sub && sub.checked ? { ...sub.checked } : {};
}

function setGroceryChecklistAnswer(id, checked) {
  const cl = groceryChecklistState();
  const cycle = groceryCycleKey();
  if (!cl.provisional[cycle] || typeof cl.provisional[cycle] !== "object") cl.provisional[cycle] = { ...groceryChecklistCurrentAnswers() };
  cl.provisional[cycle][id] = !!checked;
  persist();
}

function groceryChecklistHasPendingChanges() {
  return LiveGrocerySources.checklistHasPendingChanges(groceryChecklistConfig(), groceryChecklistCurrentSubmission(), groceryChecklistCurrentAnswers());
}

function submitGroceryChecklist() {
  const cl = groceryChecklistState();
  const cycle = groceryCycleKey();
  const submission = LiveGrocerySources.buildChecklistSubmission(groceryChecklistConfig(), groceryChecklistCurrentAnswers(), new Date().toISOString());
  cl.submissions[cycle] = submission;
  cl.provisional[cycle] = { ...submission.checked };
  persist();
  renderShopPage();
}

function checklistSourceRows() {
  return LiveGrocerySources.checklistContribution(groceryChecklistConfig(), groceryChecklistCurrentSubmission())
    .map((entry) => ({ ...manualGroceryRow(entry.name), checklistId: entry.id }));
}

function nextStopItemsList() {
  if (!Array.isArray(state.nextStopItems)) state.nextStopItems = [];
  return state.nextStopItems;
}

function addNextStopItem(name, quantity = "") {
  const clean = String(name || "").trim();
  if (!clean) return false;
  const list = nextStopItemsList();
  if (list.some((it) => normalize(it.name) === normalize(clean))) return false;
  list.push({ id: `ns_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, name: clean, quantity: String(quantity || "").trim() });
  state.nextStopItems = LiveGrocerySources.normalizeNextStopItems(list);
  return true;
}

function removeNextStopItem(id) {
  state.nextStopItems = nextStopItemsList().filter((it) => it.id !== id);
}

function purchaseNextStopItem(id) {
  const item = nextStopItemsList().find((it) => it.id === id);
  if (!item) return;
  const snapshot = { ...item };
  removeNextStopItem(id);
  persist();
  renderGroceries();
  showMailToast(`${snapshot.name} marked purchased`, () => {
    const list = nextStopItemsList();
    if (!list.some((it) => normalize(it.name) === normalize(snapshot.name))) list.push(snapshot);
    state.nextStopItems = LiveGrocerySources.normalizeNextStopItems(list);
    persist();
    renderGroceries();
  });
}

function renderShopChecklistSpace() {
  ensureGroceryChecklistSeeded();
  const config = groceryChecklistConfig();
  const answers = groceryChecklistCurrentAnswers();
  const pending = groceryChecklistHasPendingChanges();
  const submission = groceryChecklistCurrentSubmission();
  if (!config.length) {
    elements.groceryList.innerHTML = `<div class="empty-state">No checklist items yet.<br><button class="secondary-btn" type="button" data-open-checklist-config style="margin-top:10px">Configure checklist</button></div>`;
    elements.groceryList.querySelector("[data-open-checklist-config]")?.addEventListener("click", openGroceryChecklistDialog);
    return;
  }
  elements.groceryList.innerHTML = `
    <div class="shop-checklist">
      <p class="muted-label shop-checklist-hint">Check anything you don't need this week, then Submit. Starts fresh every Friday.</p>
      <div class="shop-checklist-list">
        ${config.map((entry) => `
          <label class="grocery-item shop-checklist-row ${answers[entry.id] ? "is-checked" : ""}">
            <input type="checkbox" data-checklist-toggle="${escapeHtml(entry.id)}" ${answers[entry.id] ? "checked" : ""} />
            <span class="grocery-name">${escapeHtml(entry.name)}</span>
          </label>
        `).join("")}
      </div>
      <div class="shop-checklist-footer">
        <button class="grocery-cleanup-link" type="button" data-open-checklist-config>Configure</button>
        <span class="muted-label shop-checklist-status">${submission ? "Submitted this week" : "Not submitted yet this week"}${pending ? " · unsaved changes" : ""}</span>
        <button class="primary-btn shop-checklist-submit" type="button" data-checklist-submit ${pending ? "" : "disabled"}>Submit</button>
      </div>
    </div>
  `;
  elements.groceryList.querySelector("[data-open-checklist-config]")?.addEventListener("click", openGroceryChecklistDialog);
  elements.groceryList.querySelectorAll("[data-checklist-toggle]").forEach((cb) => {
    cb.addEventListener("change", () => { setGroceryChecklistAnswer(cb.dataset.checklistToggle, cb.checked); renderGroceries(); });
  });
  const submitBtn = elements.groceryList.querySelector("[data-checklist-submit]");
  if (submitBtn) submitBtn.addEventListener("click", submitGroceryChecklist);
}

function addGroceryChecklistItem(name) {
  const clean = String(name || "").trim();
  if (!clean) return false;
  const cl = groceryChecklistState();
  if (cl.config.some((e) => normalize(e.name) === normalize(clean))) return false;
  cl.config.push({ id: `cl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, name: clean });
  persist();
  return true;
}

function removeGroceryChecklistItem(id) {
  const cl = groceryChecklistState();
  cl.config = cl.config.filter((e) => e.id !== id);
  persist();
}

function moveGroceryChecklistItem(id, dir) {
  const cl = groceryChecklistState();
  const i = cl.config.findIndex((e) => e.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cl.config.length) return;
  [cl.config[i], cl.config[j]] = [cl.config[j], cl.config[i]];
  persist();
}

function seedGroceryChecklistFromInventory() {
  const cl = groceryChecklistState();
  let added = 0;
  inventoryItemList().filter((i) => i.trackWeekly).forEach((i) => { if (addGroceryChecklistItem(i.name)) added++; });
  return added;
}

function ensureGroceryChecklistSeeded() {
  const cl = groceryChecklistState();
  if (cl.seeded) return;
  if (!cl.config.length) seedGroceryChecklistFromInventory();
  cl.seeded = true;
  persist();
}

function openGroceryChecklistDialog() {
  if (!groceryChecklistDialogEl) {
    groceryChecklistDialogEl = document.createElement("dialog");
    groceryChecklistDialogEl.className = "recipe-dialog std-form-dialog grocery-checklist-config-dialog";
    document.body.appendChild(groceryChecklistDialogEl);
    groceryChecklistDialogEl.addEventListener("click", (e) => { if (e.target === groceryChecklistDialogEl) groceryChecklistDialogEl.close(); });
  }
  ensureGroceryChecklistSeeded();
  renderGroceryChecklistConfig();
  if (!groceryChecklistDialogEl.open) groceryChecklistDialogEl.showModal();
}

function renderGroceryChecklistConfig() {
  const dlg = groceryChecklistDialogEl;
  if (!dlg) return;
  const config = groceryChecklistConfig();
  const trackWeeklyCount = inventoryItemList().filter((i) => i.trackWeekly).length;
  const canSeed = trackWeeklyCount > 0;
  dlg.innerHTML = `
    <div class="recipe-form std-form">
      <div class="dialog-head">
        <div>
          <h2 style="margin:0">Checklist</h2>
          <p class="muted-label" style="margin:2px 0 0">Recurring weekly items you review on the Shop page. Restarts every Friday.</p>
        </div>
        <button class="icon-btn" type="button" data-checklist-config-close aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <form class="inline-form std-add-btn-form" data-checklist-add-form>
        <input type="text" data-checklist-add-input placeholder="Add checklist item" autocomplete="off" maxlength="64" />
        <button class="icon-btn std-add-btn" type="submit" aria-label="Add item"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
      </form>
      <div class="grocery-checklist-config-list">
        ${config.length ? config.map((e, i) => `
          <div class="grocery-checklist-config-row" data-checklist-config-id="${escapeHtml(e.id)}">
            <span class="grocery-checklist-config-name">${escapeHtml(e.name)}</span>
            <div class="grocery-checklist-config-actions">
              <button class="icon-btn" type="button" data-checklist-move="up" ${i === 0 ? "disabled" : ""} aria-label="Move up"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg></button>
              <button class="icon-btn" type="button" data-checklist-move="down" ${i === config.length - 1 ? "disabled" : ""} aria-label="Move down"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
              <button class="icon-btn" type="button" data-checklist-remove aria-label="Remove"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg></button>
            </div>
          </div>
        `).join("") : `<p class="empty-state">No items yet. Add recurring household items above${canSeed ? ", or import the ones you already track in Inventory." : "."}</p>`}
      </div>
      ${canSeed ? `<button class="secondary-btn" type="button" data-checklist-seed>Import ${trackWeeklyCount} from Inventory</button>` : ""}
    </div>
  `;
  dlg.querySelector("[data-checklist-config-close]").addEventListener("click", () => dlg.close());
  dlg.querySelector("[data-checklist-add-form]").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const input = dlg.querySelector("[data-checklist-add-input]");
    if (addGroceryChecklistItem(input.value)) { input.value = ""; renderGroceryChecklistConfig(); syncShopAfterChecklistConfig(); }
    dlg.querySelector("[data-checklist-add-input]").focus();
  });
  dlg.querySelectorAll("[data-checklist-config-id]").forEach((row) => {
    const id = row.dataset.checklistConfigId;
    row.querySelector("[data-checklist-remove]").addEventListener("click", () => { removeGroceryChecklistItem(id); renderGroceryChecklistConfig(); syncShopAfterChecklistConfig(); });
    row.querySelectorAll("[data-checklist-move]").forEach((btn) => btn.addEventListener("click", () => { moveGroceryChecklistItem(id, btn.dataset.checklistMove === "up" ? -1 : 1); renderGroceryChecklistConfig(); }));
  });
  const seedBtn = dlg.querySelector("[data-checklist-seed]");
  if (seedBtn) seedBtn.addEventListener("click", () => { seedGroceryChecklistFromInventory(); renderGroceryChecklistConfig(); syncShopAfterChecklistConfig(); });
}

function syncShopAfterChecklistConfig() {
  if (getActiveAppArea() === "shop" && shopSpace === "checklist") renderGroceries();
}

function plannedSkippedGroceryKeys() {
  const skippedKeys = new Set();
  Object.entries(state.plans || {}).forEach(([key, weekPlan]) => {
    if (!weekPlan) return;
    const ws = dateFromWeekKey(key);
    if (isNaN(ws.getTime())) return;
    const wsISO = dateKeyFromDate(ws);
    const weDate = new Date(ws); weDate.setDate(ws.getDate() + 7);
    const weISO = dateKeyFromDate(weDate);
    if (weISO < groceryRangeStart || wsISO > groceryRangeEnd) return;
    (weekPlan.skippedGroceryKeys || []).forEach((k) => skippedKeys.add(k));
  });
  return skippedKeys;
}

function buildActiveNeedRows() {
  const scope = sectionScope("grocery");
  const mealplanRaw = scope === "personal" ? [] : buildRawGroceryRowsForRange(groceryRangeStart, groceryRangeEnd);
  const manualRaw = manualGroceryItems().map(manualGroceryRow);
  const checklistRaw = checklistSourceRows();
  const { rows } = LiveGrocerySources.reconcileSources([
    { source: LiveGrocerySources.SOURCE.MEALPLAN, rows: mealplanRaw },
    { source: LiveGrocerySources.SOURCE.CHECKLIST, rows: checklistRaw },
    { source: LiveGrocerySources.SOURCE.MANUAL, rows: manualRaw }
  ], { mergeRows: aggregateGroceryRows, keyOf: (r) => r.key || canonicalGroceryItemKey(r.item) });

  const pantrySet = new Set((state.pantry || []).map(groceryRowKey));
  const skippedKeys = plannedSkippedGroceryKeys();
  const hasExplicitSource = (row) => row.sources.includes("manual") || row.sources.includes("checklist");
  return rows.filter((row) => {
    // Pantry staples are hidden unless an explicit source (Manual/Checklist) asks for them.
    if (pantrySet.has(groceryRowKey(row.item)) && !hasExplicitSource(row)) return false;
    // A meal-plan-only week-skip drops the need; an explicit source keeps it.
    if (skippedKeys.has(row.key) && !hasExplicitSource(row)) return false;
    return true;
  });
}

function manualGroceryRow(value) {
  const parsed = parseIngredientLine(value);
  const item = parsed.item || value;
  const identity = normalizeGroceryItemName(item);
  const amount = parsed.amount || "";
  const unit = parsed.quantity || "";
  const quantity = [amount, unit].filter(Boolean).join(" ");
  return {
    key: identity.canonicalName,
    item: identity.displayName || item,
    displayName: identity.displayName || item,
    canonicalName: identity.canonicalName,
    rawNames: [item].filter(Boolean),
    amount,
    unit,
    quantity,
    prep: parsed.prep || "",
    notes: [...new Set([...identity.notes, parsed.prep].filter(Boolean))],
    category: identity.category,
    subcategory: identity.subcategory,
    manual: true,
    manualValue: value,
    sourceRecipeIds: []
  };
}

function aggregateGroceryRows(rows) {
  return LiveGroceryCatalog.mergeGroceryRows(rows, {
    aliases: groceryAliases(),
    splitPreferences: grocerySplitPreferences()
  })
    .sort((a, b) => normalize(a.item).localeCompare(normalize(b.item)) || normalize(a.quantity).localeCompare(normalize(b.quantity)));
}

function addQuantityToGroceryGroup(group, row) {
  const amountValue = groceryAmountToNumber(row.amount);
  const unit = row.unit || "";
  if (amountValue !== null) {
    const existing = group.quantityParts.get(unit) || 0;
    group.quantityParts.set(unit, existing + amountValue);
    return;
  }
  if (row.quantity) group.looseQuantities.push(row.quantity);
}

function finalizeGroceryGroup(group) {
  const quantityParts = [...group.quantityParts.entries()]
    .map(([unit, amount]) => [unit, formatGroceryAmount(amount)])
    .filter(([, amount]) => amount)
    .map(([unit, amount]) => [amount, unit].filter(Boolean).join(" "));
  const looseQuantities = [...new Set(group.looseQuantities.filter(Boolean))];
  return {
    key: group.key,
    item: group.displayName,
    displayName: group.displayName,
    canonicalName: group.canonicalName,
    rawNames: [...group.rawNames],
    quantity: [...quantityParts, ...looseQuantities].join(" + "),
    prep: "",
    notes: [...group.notes],
    category: group.category,
    subcategory: group.subcategory,
    manual: group.manual && Boolean(group.manualValue),
    manualValue: group.manualValue,
    sourceRecipeId: group.sourceRecipeId,
    sourceRecipeName: group.sourceRecipeName,
    sourceRecipeIds: [...group.sourceRecipeIds]
  };
}

function groceryAmountToNumber(amount) {
  const text = String(amount || "").trim();
  if (!text || text === "pinch") return null;
  const parts = text.split(/\s+/);
  if (parts.length === 2) {
    const whole = Number(parts[0]);
    const fraction = groceryFractionToNumber(parts[1]);
    return Number.isFinite(whole) && fraction !== null ? whole + fraction : null;
  }
  return groceryFractionToNumber(text) ?? (Number.isFinite(Number(text)) ? Number(text) : null);
}

function groceryFractionToNumber(value) {
  const match = String(value || "").match(/^(\d+)\/(\d+)$/);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return denominator ? numerator / denominator : null;
}

function formatGroceryAmount(value) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const roundedWhole = Math.round(value);
  if (Math.abs(value - roundedWhole) < 0.01) return String(roundedWhole);
  const whole = Math.floor(value);
  const remainder = value - whole;
  const fraction = closestGroceryFraction(remainder);
  if (!whole && !fraction) return "";
  if (!fraction) return String(whole);
  return [whole || "", fraction].filter(Boolean).join(" ");
}

function closestGroceryFraction(value) {
  const fractions = [
    ["1/8", 1 / 8],
    ["1/4", 1 / 4],
    ["1/3", 1 / 3],
    ["1/2", 1 / 2],
    ["2/3", 2 / 3],
    ["3/4", 3 / 4]
  ];
  const match = fractions.find(([, fractionValue]) => Math.abs(value - fractionValue) < 0.01);
  if (match) return match[0];
  if (value > 0.99) return "";
  return value < 0.01 ? "" : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function groceryRowKey(item) {
  return canonicalGroceryItemKey(item);
}

function canonicalGroceryItemKey(item) {
  return normalizeGroceryItemName(item).canonicalName;
}

function canonicalGroceryWord(word) {
  return LiveGroceryCatalog.singularizeWord(word);
}

function preferGroceryDisplayItem(candidate, current) {
  const candidateText = String(candidate || "").trim();
  const currentText = String(current || "").trim();
  if (!candidateText) return false;
  if (!currentText) return true;
  const candidateNormalized = normalize(candidateText);
  const currentNormalized = normalize(currentText);
  if (candidateNormalized === currentNormalized) return candidateText.length < currentText.length;
  if (groceryRowKey(candidateText) !== groceryRowKey(currentText)) return false;
  const candidateWords = candidateNormalized.split(" ");
  const currentWords = currentNormalized.split(" ");
  const candidatePluralWords = candidateWords.filter((word) => word.endsWith("s") && canonicalGroceryWord(word) !== word).length;
  const currentPluralWords = currentWords.filter((word) => word.endsWith("s") && canonicalGroceryWord(word) !== word).length;
  if (candidatePluralWords !== currentPluralWords) return candidatePluralWords > currentPluralWords;
  return candidateText.length > currentText.length;
}

function isManualGroceryItem(item) {
  return manualGroceryItems().some((manualItem) => manualItem === item);
}

function buildGroceryText() {
  const groceryWeek = selectedGroceryWeek();
  if (!groceryWeek) return "No groceries yet.";
  const pantrySet = new Set(state.pantry.map(groceryRowKey));
  const items = buildGroceryRowsWithManual(groceryWeek.week)
    .filter((row) => !pantrySet.has(groceryRowKey(row.item)))
    .map((row) => ({
      ...row,
      checked: Boolean(state.checkedGroceries[groceryCheckedKey(groceryWeek.key, row.key)])
    }));
  if (!items.length) return "No groceries needed yet.";
  const pricePlan = optimizeGroceryBasket(items);
  const sections = groceryStoreSections(items, pricePlan.assignments).filter((section) => section.rows.length);
  if (sections.length === 1 && sections[0].storeId === "") {
    return sections[0].rows.map((row) => `- ${[row.quantity, row.item].filter(Boolean).join(" ")}`).join("\n");
  }
  return sections
    .map((section) => [
      section.name,
      ...section.rows.map((row) => `- ${[row.quantity, row.item].filter(Boolean).join(" ")}`)
    ].join("\n"))
    .join("\n\n");
}

function shoppingListHas(name) {
  const n = normalize(name);
  return (state.persistentManualGroceries || []).some((x) => normalize(x) === n);
}

function addToShoppingList(name) {
  if (!Array.isArray(state.persistentManualGroceries)) state.persistentManualGroceries = [];
  if (!shoppingListHas(name)) {
    state.persistentManualGroceries.push(name);
    state.persistentManualGroceries.sort((a, b) => normalize(a).localeCompare(normalize(b)));
  }
}

function removeFromShoppingList(name) {
  const n = normalize(name);
  state.persistentManualGroceries = (state.persistentManualGroceries || []).filter((x) => normalize(x) !== n);
}

function renderShopPage() {
  renderGroceries();
  renderShopReceipts();
}

function renderShopReceipts() {
  const el = elements.shopReceiptsList;
  if (!el) return;
  const receipts = (state.receipts || [])
    .slice()
    .sort((a, b) => (b.purchaseDate || "").localeCompare(a.purchaseDate || ""));
  if (!receipts.length) {
    el.innerHTML = `<div class="empty-state">No receipts yet. Scan a receipt to start tracking prices.</div>`;
    return;
  }
  el.innerHTML = receipts.map((r) => {
    const date = r.purchaseDate
      ? new Date(r.purchaseDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "";
    const total = r.total != null ? Number(r.total).toLocaleString("en-US", { style: "currency", currency: "USD" }) : "";
    const itemCount = Array.isArray(r.lineItems) ? r.lineItems.length : 0;
    return `
      <button class="shop-receipt-card" type="button" data-receipt-id="${escapeHtml(r.id)}">
        <div class="shop-receipt-store">${escapeHtml(r.storeName || "Unknown store")}</div>
        <div class="shop-receipt-meta">
          ${date ? `<span>${escapeHtml(date)}</span>` : ""}
          ${itemCount ? `<span>${itemCount} item${itemCount !== 1 ? "s" : ""}</span>` : ""}
          ${total ? `<span>${escapeHtml(total)}</span>` : ""}
        </div>
      </button>
    `;
  }).join("");
  el.querySelectorAll("[data-receipt-id]").forEach((card) => {
    card.addEventListener("click", () => openReceiptEditView(card.dataset.receiptId));
  });
}

  // ── seam accessors (state shared with app.js nav / settings / bindEvents) ──
  function getShopSpace() { return shopSpace; }
  function setShopSpaceValue(v) { shopSpace = v; }
  function getGroceryStoreSearchLocation() { return groceryStoreSearchLocation; }
  function setGroceryStoreSearchLocation(v) { groceryStoreSearchLocation = v; }
  function getGroceryStoreLocationPromise() { return groceryStoreLocationPromise; }
  function setGroceryStoreLocationPromise(v) { groceryStoreLocationPromise = v; }
  function getReceiptScanFiles() { return receiptScanFiles; }
  function setReceiptScanFiles(v) { receiptScanFiles = v; }
  function getReceiptImageEdits() { return receiptImageEdits; }
  function setReceiptImageEdits(v) { receiptImageEdits = v; }
  function getPendingReceiptDraft() { return pendingReceiptDraft; }
  function setPendingReceiptDraft(v) { pendingReceiptDraft = v; }

  return {
    acquireGroceryStoreSearchLocation,
    addCurrentGroceryReviewItem,
    addEditReceiptLine,
    addGroceryLibraryItem,
    addGroceryStore,
    addGroceryStoreSection,
    addManualGroceryItem,
    addPantryItem,
    addReceiptReviewLine,
    addStoreToRank,
    addToShoppingList,
    appendReceiptCameraFile,
    applyGroceryItemRename,
    attachPointerDragToTargets,
    autoTagGroceryWithAI,
    buildRawGroceryRowsForRange,
    canonicalGroceryItemKey,
    clearReceiptScanFiles,
    closeDailyDozenTagEditor,
    closeGroceryRangeMenus,
    closeReceiptEditView,
    closeShopReceiptsDialog,
    deleteReceipt,
    dismissCurrentGroceryReview,
    focusGroceryLibraryInput,
    formatGroceryAmount,
    getGroceryStoreLocationPromise,
    getGroceryStoreSearchLocation,
    getPendingReceiptDraft,
    getReceiptImageEdits,
    getReceiptScanFiles,
    getShopSpace,
    goToGroceryReviewRecipe,
    groceryAliases,
    groceryAmountToNumber,
    groceryBaseItems,
    groceryDailyDozenTags,
    groceryItemLocations,
    groceryPlacesApiUrl,
    groceryPlacesRequestOptions,
    groceryPriceObservations,
    groceryPricingSettings,
    grocerySkipKey,
    grocerySplitPreferences,
    groceryStoreItemSections,
    groceryStores,
    grocerySuggestionItems,
    handleGroceryStoreSearchKeydown,
    handleReceiptImagePreviewAction,
    initGroceryRange,
    navigateGroceryWeek,
    openGroceryChecklistDialog,
    openGroceryLibraryDialog,
    openGroceryPricingDialog,
    openGroceryReviewItems,
    openGroceryStoresDialog,
    openPublishedGroceryReview,
    openReceiptScanDialog,
    openShopReceiptsDialog,
    receiptItemMappings,
    receiptPriceHistory,
    refreshReceiptValidation,
    removeFromShoppingList,
    renderGroceries,
    renderGroceryLibrary,
    renderPantry,
    renderReceiptReview,
    renderShopPage,
    renderShopSpaceNav,
    replaceReceiptScanFiles,
    resetGroceryLibrary,
    resolveItemEffectiveStoreId,
    saveDailyDozenTagEditor,
    saveGroceryPricingSettings,
    saveGroceryStoreLayout,
    saveManualGroceryPrice,
    saveReceiptEdit,
    saveReviewedReceipt,
    scanReceiptImages,
    scheduleGroceryStoreSearch,
    selectedGroceryWeek,
    setGroceryAddNextStop,
    setGroceryStoreLocationPromise,
    setGroceryStoreSearchLocation,
    setPendingReceiptDraft,
    setReceiptImageEdits,
    setReceiptScanFiles,
    setShopSpaceValue,
    shoppingListHas,
    toggleGroceryRangeMenu,
    unlistedGroceryItemsForWeek,
    updateReceiptScanSelectionStatus,
  };
}
