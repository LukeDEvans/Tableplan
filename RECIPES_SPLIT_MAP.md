# Recipes / Meal-Plan / Groceries / Cook — Split Map

**Status:** investigation + documentation only. No code was changed; `app.js` was
not touched. This is the prerequisite map for any future extraction of the
recipes / meal-plan / groceries / cook cluster (CLAUDE.md Architecture Decision #2).

**Scope of the read:** `app.js` (52,791 lines) plus the state model. Line numbers are
as of this commit and will drift; treat them as anchors, not addresses.

---

## TL;DR for the impatient

- **Total scope:** ~7,500–9,000 lines across **~200 functions**, spread through the
  whole file (from L165 to L52406), not in four tidy blocks.
- **This is a finance-class extraction, or harder — for all four areas at once.** None
  of the four is a clean contiguous range like contacts/weather/inventory were.
- **The four-way split is real at the *data* and *conceptual* level but leaky at the
  *code* level.** Three hard entanglements complicate it (below): the shared `eat`
  shell + state section; the `manualGroceries` straddle; and cook having no standalone
  surface (it's woven into the recipe view).
- **~35+ module-level `let` variables** thread through these areas (finance had ~8–15).
- Recommended sequencing is at the bottom. Short version: **groceries is the most
  separable; cook cannot be its own module; recipes and meal-plan are co-dependent and
  should likely be planned as a pair even if shipped as two modules.**

---

## Data model (the foundation the split has to respect)

State is sectioned (`STATE_SECTIONS`, [app.js:321](app.js#L321)); each section is one
Supabase row `{stateId}:{section}`.

| Section | Owner area(s) | Keys (abridged) |
|---|---|---|
| `eat` | **recipes + meal-plan + cook — all three share this one section** | `recipes, trashedRecipes, folders, plans, publishedWeeks, recipeTags, ingredientOptions, autoGenerateRules, mealPlanConfig, activeCooking` |
| `grocery` | groceries | `groceryStores, groceryBaseItems, groceryAliases, grocerySplitPreferences, groceryItemLocations, groceryStoreItemSections, groceryPriceObservations, groceryPricingSettings, pantry, persistentManualGroceries, checkedGroceries, grocerySkippedStores, groceryItemWeekOverride, groceryCleared, groceryDailyDozenTags, groceryReviewDismissed, receipts, receiptItemMappings, priceHistory, groceryChecklist, nextStopItems` |
| `health` | nutrition (a *separate* domain, owned elsewhere) | `dailyDozen*, foodLogEntries, nutritionIngredientMappings, …` |

Two data-model facts that shape everything:

1. **Recipes/folders have a second, relational data layer.** `state.recipes` /
   `state.folders` (JSONB) are *mirrored* to relational **`eat_recipes`** and
   **`eat_folders`** Postgres tables. Hydrate/write/delete path:
   `hydrateRecipeRowsFromSupabase` [7331](app.js#L7331), `loadFolderRowsFromSupabase`
   [7361](app.js#L7361), `loadRecipeRowsFromSupabase` [7372](app.js#L7372) (with a
   4-level column-fallback for older schemas), `recipeFromRow`/`recipeToRow`
   [7406](app.js#L7406)/[7437](app.js#L7437), `saveFolderRow`/`saveRecipeRow`
   [7467](app.js#L7467)/[7472](app.js#L7472), `deleteFolderRow`/`deleteRecipeRow`,
   `upsertFolderRows`/`upsertRecipeRows` [7499](app.js#L7499)/[7518](app.js#L7518).
   **Only recipes + folders are relational.** Meal plans (`plans`, `publishedWeeks`),
   `recipeTags`, `ingredientOptions`, `autoGenerateRules`, `mealPlanConfig`,
   `activeCooking` are JSONB-only inside `eat`. This is the "different data layer"
   the assessment named — it belongs to **recipes**, and confirmed scope is
   recipes+folders only.

2. **`manualGroceries` is grocery data stored inside the meal-plan week object.**
   `createBlankWeek()` [29484](app.js#L29484) puts `manualGroceries: []` (grocery) next
   to `slots`, `mealNotes`, `combinedMealSections`, `mealPlanView` (meal-plan) in the
   same per-week record under `state.plans[weekKey]` (the `eat` section). Merge logic
   for it lives in `mergeCombinedMealSections` [6507](app.js#L6507) (see
   [6491](app.js#L6491)). **So a grocery concept is physically embedded in a meal-plan
   record in the eat section — the meal-plan ⇄ groceries boundary is not clean in the
   stored shape, not just in code.**

---

## Shared week infrastructure (used by meal-plan AND groceries)

Not owned by any single area — the weekly cursor + per-week store both areas read:

- `currentWeek` (module `let`, [598](app.js#L598)) — the active week cursor; **21 refs**
  across meal-plan, groceries, and general week nav.
- `weekKey()` [30570](app.js#L30570), `weekState()` [29475](app.js#L29475),
  `createBlankWeek()` [29484](app.js#L29484), `prepDays` [239](app.js#L239),
  `startOfPrepWindow()` [30589](app.js#L30589), `ensurePrepWindowShape()`
  [29498](app.js#L29498).
- `setWeekToolsMode(mode)` [7874](app.js#L7874) — the shared week-tools header, with
  branches for `plan`, `shop`, `today`, `finance`. Already read by finance via a getter.

**Implication:** any split of meal-plan vs groceries must decide who *owns* the week
cursor + week store, and inject it to the other. This is exactly the "shared mutable
var threaded through the boundary" problem finance had, but across two extracted
modules instead of module↔app.js.

---

## Area 1 — RECIPES (recipe library, editing, import/scan, tags, folders)

**Contiguity: SCATTERED across the whole file** — normalizers up top, data layer at
~7.3k, box/folders at ~15–16k, view/form/import at ~27–29k, AI + timer at ~46k.

**Code regions (representative, not exhaustive):**
- Normalize/migrate: `defaultRecipeTags`/`normalizeRecipeTags`/`migrateRecipeFolders…`
  [5592–5646](app.js#L5592), `recipeDefaultServings` [5703](app.js#L5703),
  `normalizeRecipe` [6228](app.js#L6228), `normalizeTrashedRecipe` [6267](app.js#L6267),
  `activeRecipes`/`trashedRecipes` [6276–6281](app.js#L6276).
- **Relational data layer:** [7331–7599](app.js#L7331) (see Data model §1).
- Folders model: `seedFolders`/`normalizedFolders`/`compareFolders`/`folderName`
  [7793–7821](app.js#L7793).
- Recipe box page + search: `openRecipeBoxPage`…`closeRecipeBoxPage`
  [15368–15402](app.js#L15368).
- Folders + tag filters + tiles + menus: `renderFolders`…`openRecipeMenu`
  [16331–16664](app.js#L16331), folder rename/menu [16565–16625](app.js#L16565),
  add/remove recipe tag [19007–19029](app.js#L19007).
- Trash restore + missing-restore merge: [21692–22837](app.js#L21692) (large;
  `restoreTrashedRecipe`, `permanentlyDeleteTrashedRecipe`, `mergeMissingRecipesFromBackup`,
  `isMissingRestoreRecipe` + many `missingRestore*` helpers — note several `missingRestore*`
  helpers are **grocery**-owned, listed under Area 3).
- Render recipes + folder drag/drop: `renderRecipes`…`isAncestorFolder`
  [22930–23068](app.js#L22930).
- Recipe view / dialog / scaling / cook-log display: [27358–27818](app.js#L27358)
  (`openRecipeView`, `recipeViewTemplate`, `activeRecipeViewTemplate`,
  `scaledIngredient*`, `scaleIngredientAmount`, `combinedRecipeTime`).
- Recipe form + save + cook-log rows: [27824–28080](app.js#L27824)
  (`populateRecipeForm`, `saveRecipeFromForm`, `renderCookLogRows`, `addCookLogRow`,
  `parseCookingDuration`).
- Import / URL / scan / parse / ingredient rows: [28489–29186](app.js#L28489)
  (`importRecipeFromUrl`, `scanRecipeFromImages`, `parseRecipeHtml`, `parseIngredientLine`,
  `renderIngredientRows`, `deleteRecipeById`, `renameRecipeFromMenu`).
- AI cleanup + timer: [46215–46341](app.js#L46215), [46421–46494](app.js#L46421).
- `recipePhotoProxyUrl` [174](app.js#L174), `uploadRecipePhoto`/`resizeRecipePhoto`
  [28821–28870](app.js#L28821).

**Shared mutable state it owns:** `activeFolder` [596], `activeRecipeTag` [597],
`folderClickTimer` [606], `editingFolderId`/`folderMenuId` [613–614],
`draggedRecipeId`/`draggedFolderId` [731–732], `folderDragOpenTimer`/`folderDragOpenTarget`/`dragOpenFolderId`
[733–735], `currentActiveRecipeViewId` [751], `recipeViewMealContext` [752] (⚠ points
back into meal-plan), `scanRecipeFiles`/`scanRecipeImageEdits` [754–756],
`pendingRecipePhotoFile` [769], `recipeTimer` [46202], `pendingAiRecipeResult` [46213],
`pendingCookLogId` [1538] (⚠ shared with cook).

**Touchpoints out:**
- → **cook**: the recipe *view* hosts cook mode — `activeRecipeViewTemplate(recipe,
  cookingItem)` [27561](app.js#L27561), `cookLogTemplate` [27620](app.js#L27620),
  `renderCookLogRows` [27984](app.js#L27984). See Area 4.
- → **meal-plan**: `recipeViewMealContext` + `updateMealPlannedServingsFromContext`
  [27758](app.js#L27758), `updateGroceryMealServing` [27775](app.js#L27775); recipes are
  referenced by id from meal slots.
- → **nutrition/health**: `nutritionRecipeSignature` [28288](app.js#L28288),
  `pendingNutritionRecipeId` [761], `normalizeIngredientNutritionMatches`
  [28249](app.js#L28249), `dailyDozenRecipeSuggestions` [15540](app.js#L15540) (read
  from recipe view [27501](app.js#L27501)).
- → **shared scan seam**: `prepareScanImage` [28773](app.js#L28773) — see Shared §.

---

## Area 2 — MEAL-PLAN (weekly planning, slots, drag/drop, auto-generate)

**Contiguity: SCATTERED, but with a dominant block** — one very large contiguous region
[23069–25663](app.js#L23069) (planner render + meal entry drag/drop/edit + slot ops),
plus config/normalizers up top and auto-generate + notif card cluster elsewhere.

**Code regions:**
- Default/normalize: `cleanup/remove/defaultMealEntry*` [4998–5025](app.js#L4998),
  `createPlannedRecipeEntry`/`normalizePlannedRecipeEntry` [5719–5824](app.js#L5719),
  `mergeCombinedMealSections`/`mergeMealPlanConfig` [6507–6631](app.js#L6507),
  `mealSlotsHaveEntries` [7039](app.js#L7039), `defaultMealPlanConfig`/`normalizeMealPlanConfig`/`recomputeMealPlanLayout`
  [7625–7792](app.js#L7625).
- Meal-plan notification card (recipe suggestions on home/notif):
  `warmMealPlanRecipes`…`positionMealPlanNotifPanel` [8336–8700](app.js#L8336).
- Meal entry/slot menus + context press: [16664–17191](app.js#L16664)
  (`openMealEntryMenu`, `openMealSlotMenu`, `copy/pasteMealSlot`, `addMakeAheadTaskForMealEntry`
  [16962] ⚠ → Tasks, `addPrepAheadTaskForMealEntry` [16989] ⚠ → Tasks).
- Meal-plan settings dialog: [21512–21691](app.js#L21512).
- **Dominant block** [23069–25663](app.js#L23069): `renderPlanner` [23069], meal context
  cards + calendar reads [23379–23484], auto-rule columns [23827–24179], the entire meal
  entry template + drag/drop/pointer-delete machinery [24180–25160], combine/commit/
  serving ops [25166–25460], planner-day selection + clear + auto-generate-section
  [25478–25663].
- Auto-generate plan: [29200–29498](app.js#L29200) (`autoGenerateMealPlan`,
  `nextGeneratedRecipe`, `eligibleRecipesForMeal`, `pickAutoGeneratedRecipe`).
- Week/slot shape + view toggle: `ensureMealSlotShape`/`migrateLegacyMealSlots`/
  `weekState`/`toggleMealPlanView`/`applyDefaultMealEntries` [29498–29708](app.js#L29498).
- `applyInitialMealPlanFocus` [16102](app.js#L16102), `collapseAllPlannerDays`
  [22930](app.js#L22930).

**Shared mutable state it owns:** `currentWeek` [598] (⚠ shared w/ groceries),
`activePlannerDayId`/`activeAutoRuleDayId` [603–604], `mealEntryClickTimer` [607],
`editingMealEntry` [608], `suppressMealEntryClick` [609], `copiedMealEntry`/`copiedMealSlot`
[610–611], `draggedMealEntry` [615], `mealPointerDeleteGesture`/`lastMealDragPoint`
[660–661], `pendingMealRecipeSelection`/`pendingMealIngredientSelection` [722–723],
`pendingAutoRuleRecipeSelection`/`pendingAutoRuleIngredientSelection` [724–725],
`draggedMealSection` [730], `mealPlanContextPressTimer`/`mealPlanContextPressStart`
[808–809], `mealPlanRecipes` [1543], `mealPlanNotifOpen`/`mealPlanNotifWired` [1544–1545],
`mealPlanSwipeIndex` [1547].

**Touchpoints out:**
- → **groceries**: `buildGroceryItems(week)` [29709](app.js#L29709) reads
  `weekState().slots`; `mealPlanRecipeIdsForWeek` [25461](app.js#L25461); `hasMealPlanSlots`
  [26999](app.js#L26999); `manualGroceries` embedded in the week record (Data model §2);
  `updateGroceryMealServing`/`groceryRecipeForSlot` [25315](app.js#L25315). **This is the
  tightest cross-area coupling in the cluster.**
- → **calendar (plan domain)**: `showInMealPlan` (event flag surfaced in the planner),
  `eventCoversMeal` [23422](app.js#L23422), `mealContextEvents` [23436](app.js#L23436)
  read `state.planEvents`; `selectRestaurantForMeal` [19496](app.js#L19496) /
  `renderMealRestaurantArea` [19543](app.js#L19543).
- → **Tasks (do domain)**: `addMakeAheadTaskForMealEntry` [16962], `addPrepAheadTaskForMealEntry`
  [16989] create `do` tasks from meal entries.
- → **recipes**: references recipes by id; opens the recipe view/editor.
- → **nutrition/health**: `mealPlanNutritionTotals` [30022](app.js#L30022).

---

## Area 3 — GROCERIES (shopping list, stores, pricing, receipts, checklist)

**Contiguity: SCATTERED, with two large blocks** — [19030–20993](app.js#L19030)
(stores/pricing/receipts/library dialogs) and [25663–30589](app.js#L25663) (shop nav +
store tabs + item rows + move/review + build/aggregate) — plus normalizers up top and
`renderShopPage` at ~36.9k.

**Code regions:**
- Normalizers/migrate (large cluster up top): `defaultGroceryBaseItems`/`ensureGroceryCatalog`/
  `normalizeGroceryBaseItems` [5647–5703](app.js#L5647), daily-dozen/split/aliases/stores/
  sections/checklist/locations/prices normalizers [5824–6193](app.js#L5824),
  `mergeGroceryStoreItemSections` [6632](app.js#L6632).
- Stores + pricing + receipts + library dialogs: [19030–20993](app.js#L19030)
  (`openGroceryStoresDialog`, store search/geocode [19174–19387], `selectRestaurantForMeal`
  ⚠ meal-plan-facing, `openShopReceiptsDialog` [19904], `openGroceryLibraryDialog`
  [20433], `autoTagGroceryWithAI` [20895], `openIngredientOptionsDialog`/`saveIngredientOptions`
  [20956–20992] ⚠ ingredient options shared w/ recipes).
- Missing-restore (grocery half): `missingRestoreIngredientOptions`/`missingRestoreGroceryAliases`/
  `…GrocerySplitPreferences`/`…GroceryStores`/`…GroceryStoreLayouts`/`…GroceryItemLocations`/
  `…GroceryStoreItemSections`/`…GroceryPriceObservations`/`shouldRestoreGroceryPricingSettings`
  [22171–22282](app.js#L22171).
- Shop space nav + store tabs + item rows + move/review: [25663–27337](app.js#L25663)
  (`renderShopSpaceNav`, `setShopSpace`, `renderGroceryStoreTabs`, `optimizeGroceryBasket`
  [26040], `groceryStoreSections` [26192], `groceryItemTemplate` [26300], move-sheet
  [26486–26590], drag/drop, `learnGroceryItemMerge`/`Split` [26718–26755], review flow
  [27164–27337]).
- Pantry: `renderPantry` [27337](app.js#L27337), `addPantryItem` [29460](app.js#L29460).
- Build/aggregate/range/checklist: [29709–30589](app.js#L29709) (`buildGroceryItems`,
  `buildGroceryRows`, `initGroceryRange`, range menus [29910–30021], `mealPlanNutritionTotals`
  [30022] ⚠ nutrition, `groceryChecklist*` [30104–30338], `aggregateGroceryRows` [30406],
  amount parsing/formatting [30450–30588]).
- Shopping-list + shop page render: `shoppingListHas`/`addToShoppingList`/`removeFromShoppingList`
  [36866–36884](app.js#L36866), `renderShopPage`/`renderShopReceipts` [36885–36890](app.js#L36885),
  `renderGroceries` [25773](app.js#L25773).
- Chat context: `buildChatShopContext` [52406](app.js#L52406).

**Shared mutable state it owns:** `grocerySwipeGesture` [657], `pendingGroceryReview`/
`pendingGroceryReviewItems` [736–737], `selectedGroceryWeekKey` [740], `activeGroceryStoreTab`
[741], `shopSpace` [744], `groceryRangeStart`/`groceryRangeEnd` [745–746],
`editingDailyDozenGroceryItem` [765], `draggedGroceryItem` [812], `groceryStoreSearch*`
(timer/token/suggestions/location/promise) [813–817], `draggedGroceryStoreId` [823],
`activeGroceryStoreLayoutId` [824], `draggedGroceryStoreSectionId` [826], `groceryMoveSheetEl`/
`groceryMoveDragCleanup` [26471–26472], `groceryMoveConfirmEl` [26596], `groceryAddNextStop`
[27041], `groceryChecklistDialogEl` [30270].

**Touchpoints out:**
- → **meal-plan**: reads `weekState()`/`state.plans[week].slots` and `manualGroceries`
  via `buildGroceryItems` [29709]; `groceryRecipeForSlot` [25315]; shares `currentWeek`.
- → **inventory**: `seedGroceryChecklistFromInventory` [30256](app.js#L30256);
  `shopSpace` includes an `"inventory"` value [744]; `showShopApp`/`renderShopSpaceNav`
  toggle between shop/checklist/inventory spaces.
- → **recipes**: `ingredientOptions` + `openIngredientOptionsDialog` are shared (see
  Shared §); review flow can jump to a recipe (`goToGroceryReviewRecipe` [27281],
  `openGroceryReviewRecipeEditor` [27296]).
- → **nutrition/health**: `groceryDailyDozenTags` [5824–5863], `mealPlanNutritionTotals`
  [30022], daily-dozen grocery suggestions.
- → **finance/shop receipts**: `renderShopReceipts` [36890] + `openShopReceiptsDialog`
  [19904] use `state.receipts` (grocery section) — distinct from finance txn-receipts,
  but both are "receipts"; keep them straight during any extraction.

---

## Area 4 — COOK (active cooking + cook log)

**Contiguity: small; one widget block + woven-in view code.** Cook has **no standalone
page or nav area** — no `activeAppArea === "cook"`. It is (a) a small active-cooking strip
rendered into the eat shell and (b) state layered onto the **recipe view**.

**Code regions:**
- `normalizeActiveCooking` [5571](app.js#L5571), `normalizeCookLog` [6252](app.js#L6252).
- Active-cooking widget + session flow: [16113–16326](app.js#L16113)
  (`renderActiveCooking`, `activeCookingTemplate`, `startCookingRecipe`, `finishCookingRecipe`,
  `completeCookingWithLog`, cook-session-notes dialog, `syncActiveCookingClock`,
  `cookingTimerText`, `formatCookingDuration`).
- Cook-log **display inside the recipe view**: `cookLogTemplate` [27620](app.js#L27620),
  `cookLogPhotoTemplate` [27639](app.js#L27639), `useCookLogPhotoAsRecipePhoto` [27648],
  `formatCookLogDate` [27662]; `activeRecipeViewTemplate(recipe, cookingItem)` [27561]
  takes the cooking item; cook-log **edit rows in the recipe form**: `renderCookLogRows`
  [27984], `addCookLogRow` [28007], `collectCookLogRows` [28056], `parseCookingDuration`
  [28080].

**Shared mutable state it owns:** `activeCookingInterval` [739], `pendingCookSessionPhotoFile`
[770], `pendingCookLogId` [1538] (⚠ also touched by the recipe form).

**Touchpoints out:**
- → **recipes (deep):** cook state (`state.activeCooking`, `cookLog`) is rendered *inside*
  the recipe view/form; `renderActiveCooking` is called from the eat shell and from recipe
  view controls. `state.activeCooking` referenced 49× across the file. Cook is effectively
  a **feature of recipes**, not a peer module.

---

## Shared / ambiguous — does NOT cleanly sort into one area

- **`prepareScanImage`** [28773](app.js#L28773) — physically sits in the recipe region but
  is **app-wide scan infra**: used by article scan (media) [3473/3492], **finance receipt
  scan** (where it is *injected* into `createFinanceModule`, [1623](app.js#L1623)) [20136],
  recipe scan [28647], and another scan site [51602]. **Treat as shared infra, not
  recipe-owned** — extracting recipes must leave this reachable (keep in app.js or move to
  a shared scan module and inject, as finance already consumes it).
- **`ingredientOptions` / prep options** — `defaultPrepOptions` [165], `prepOptions` [168],
  `defaultIngredientOptions`/`normalizeIngredientOptions`/`syncIngredientOptionGlobals`
  [5455–5570](app.js#L5455), `openIngredientOptionsDialog`/`saveIngredientOptions`
  [20956–20992]. Used by **both** recipe ingredient rows and grocery library. Ambiguous
  owner; leans recipes but consumed by groceries.
- **Ingredient → grocery-row conversion**: `ingredientToGroceryRow` [30038], `buildGroceryItems`
  [29709] — the meal-plan→grocery bridge; genuinely straddles meal-plan and groceries.
- **`manualGroceries`** (Data model §2) — grocery data stored in the meal-plan week record.
- **Shared week infra** (`currentWeek`, `weekKey`, `weekState`, `prepDays`, `setWeekToolsMode`)
  — meal-plan + groceries.
- **`recipeViewMealContext`** [752] — a recipe-view var whose whole purpose is to write back
  into meal-plan planned servings.
- **Nutrition/health** (`dailyDozenRecipeSuggestions` [15540], `renderFoodHealthMeals`
  [15615], `mealPlanNutritionTotals` [30022], `nutritionRecipeSignature` [28288],
  `normalizeNutritionIngredientMappings` [6076]) — a *separate* `health` section/domain that
  recipes, meal-plan, and groceries all reach into. Per Decision #3, nutrition/daily-dozen
  stays with recipes for now, but note it also couples to meal-plan and groceries.

---

## Consolidated shared-mutable-state ledger

**~35+ module-level `let`s** touch this cluster (finance had ~8–15). The cross-area ones
are the dangerous part of any split:

| Variable | Line | Read/written by |
|---|---|---|
| `currentWeek` | 598 | **meal-plan + groceries + general week nav** |
| `pendingCookLogId` | 1538 | **cook + recipes (form)** |
| `recipeViewMealContext` | 752 | **recipes (view) + meal-plan (servings write-back)** |
| `prepOptions` | 168 | **recipes + groceries (ingredient options)** |
| `shopSpace` | 744 | **groceries + inventory** (shop/checklist/inventory) |

The remaining ~30 (`activeFolder`, `editingMealEntry`, `draggedGroceryItem`, the
`grocery*Search*` cluster, drag/gesture timers, `pending*Selection` pairs, `mealPlan*Notif*`,
etc.) are each single-area but sit interleaved at the top-of-file `let` block
([596–826](app.js#L596), [1538–1547](app.js#L1538)) and at scattered later lines
([26471](app.js#L26471), [27041](app.js#L27041), [30270](app.js#L30270), [46202](app.js#L46202)).
Like finance, any partial (compute-only) carve-out would straddle these and require
getter/setter plumbing — a **whole-module-per-area** move (finance approach A) is the
realistic pattern.

---

## Contiguity verdict per area

| Area | Lines (approx) | Fns | Contiguous? | Comparable to |
|---|---|---|---|---|
| Recipes | ~2,800–3,300 | ~85 | **No** — 8+ separate regions L174→L46494 | worse than finance |
| Meal-plan | ~2,200–2,600 | ~70 | **Partly** — one big block 23069–25663 + 4 outliers | finance-like |
| Groceries | ~2,300–2,700 | ~95 | **Partly** — two big blocks (19030–20993, 25663–30589) + normalizers | finance-like |
| Cook | ~350–450 | ~20 | **No** — small widget + woven into recipe view | not independently extractable |

None qualifies for the clean single-contiguous-range pattern that
contacts/weather/inventory used.

---

## Three complications to the four-way split itself

1. **The `eat` shell + `eat` state section are shared by recipes + meal-plan + cook.**
   `activateEatShell()` [7963](app.js#L7963) renders `renderActiveCooking()` +
   `renderPlanner()` together, and `renderRecipes()` is part of the same page. Three of
   the four "modules" would share one page shell and one Supabase section. Splitting them
   into three modules means either (a) three modules co-owning one section (needs a clear
   sub-key ownership convention), or (b) accepting that the eat shell stays glue in app.js
   and each module owns only its render + logic (the finance pattern — factory returns
   `renderX`, app.js's shell calls them). **(b) is the viable path.**

2. **Cook cannot be its own module cleanly.** It has no page, its display lives inside the
   recipe view template, and it shares `pendingCookLogId`. Realistic options: fold cook into
   **recipes** (recommended — it's a recipe feature), or extract it only as a thin
   sub-module that recipes imports. A standalone peer `cook.js` would immediately need
   circular access to the recipe view.

3. **Meal-plan ⇄ groceries is entangled in the stored data shape, not just code.**
   `manualGroceries` lives in the meal-plan week record; `buildGroceryItems` reads meal-plan
   slots; both share `currentWeek`/`weekState`. These two can still become separate modules,
   but one must own the week store and inject it to the other (getter/bridge), and the
   `manualGroceries` straddle should be called out (and possibly migrated) before or during
   the split — changing its storage location is a data migration, not a code move, so it is
   a **stop-and-confirm** item, not something to do silently.

---

## Recommended sequencing (for a later pass — NOT started here)

1. **Groceries first** — most separable (own `grocery` section, two big blocks, mostly
   self-contained state). Inject `currentWeek`/`weekState`/`weekKey`, `buildGroceryItems`'s
   meal-plan reads, and the shared scan/receipt bits. Whole-module (finance approach A).
2. **Recipes + Cook together** — cook folds into recipes. Watch the relational data layer
   (eat_recipes/eat_folders) and `prepareScanImage` (leave shared/injected).
3. **Meal-plan last** — it's the hub: it references recipes by id, drives grocery
   generation, and reads the calendar. Extract once its two neighbors are modules so its
   injected surface is known.
4. Before any of this, decide the two **stop-and-confirm** data questions: (a) the
   `manualGroceries` straddle, (b) how three modules co-own the `eat` section.

Every prior extraction (contacts/weather/inventory/finance) surfaced touchpoints the
initial assessment missed; this pass found: the **`manualGroceries` storage straddle**,
`prepareScanImage` **already injected into finance**, the **Tasks** touchpoints
(`addMakeAheadTaskForMealEntry`/`addPrepAheadTaskForMealEntry`), the **inventory** touchpoint
(`seedGroceryChecklistFromInventory` + the shared `shopSpace`), and the **restaurant** seam
(`selectRestaurantForMeal`). Re-grep before extracting each area.
