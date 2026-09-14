# Recipes (+ Cook) Extraction — Pre-Check Plan (STOP-and-confirm before any code)

**Target:** move the **Recipes** domain — recipe library / folders / tags, recipe view,
recipe editor + import/scan/parse, the relational `eat_recipes`/`eat_folders` data layer,
recipe timer, AI cleanup, trash/restore — plus **Cook** (active-cooking + cook log, which
folds in as a feature per CLAUDE.md Decision #2a) into `recipes-ui.js` as
`createRecipesModule(deps)`. Same pattern as groceries/finance: curated allowlist move
(recipes is scattered across 10+ regions, not contiguous), pure normalizers exported
top-level, nav/glue stays in app.js, structural verification.

**Status:** planning only. No code written; `app.js` untouched. This is the review artifact.
There are **several genuine boundary decisions** (recipes↔meal-plan, nutrition/daily-dozen,
ingredient-options, the recipe-view→meal seam) — flagged at the end for your call.

Prereqs read: RECIPES_SPLIT_MAP.md, CLAUDE.md Decision #2 (amended) + #3 (nutrition),
GROCERIES_EXTRACTION.md (the pattern this follows). Line numbers are current-app.js
(48,558 lines after the groceries extraction) and will drift.

---

## 1. Recipes + Cook code — functions/regions to move

**Contiguity: SCATTERED across 10+ regions** (L175 → L42261). Curated allowlist move like
groceries, verified by pre/post function-inventory diff.

### R1 — normalizers / migrate / model (L5661–6020, scattered up top)
`normalizeActiveCooking` [5661], `defaultRecipeTags` [5682], `normalizeRecipeTags` [5686],
`normalizeRecipeTagSelection` [5698], `recipeTags` [5710], `migrateRecipeFoldersToTags`
[5716], `migrateLegacyRecipeOrganization` [5732], `recipeDefaultServings` [5762],
`normalizeRecipe` [5967], `normalizeCookLog` [5991], `normalizeTrashedRecipe` [6006],
`activeRecipes` [6015], `trashedRecipes` [6020]. `recipePhotoProxyUrl` [175].
*Boot-called from `normalizeState` (→ top-level exports): `normalizeRecipe`,
`normalizeTrashedRecipe`, `normalizeActiveCooking`, `normalizeRecipeTags`, `seedFolders`,
`migrateRecipeFoldersToTags` (+ their pure callees `normalizeCookLog`, `defaultRecipeTags`).*

### R2 — relational data layer (L7063–7268) — see §2
`hydrateRecipeRowsFromSupabase` [7063], `loadFolderRowsFromSupabase` [7093],
`loadRecipeRowsFromSupabase` [7104], `recipeFromRow` [7138], `recipeToRow` [7169],
`writeAllRecipeRowsToSupabase` [7191], `saveFolderRow` [7199], `saveRecipeRow` [7204],
`deleteFolderRow` [7217], `deleteRecipeRow` [7222], `upsertFolderRows` [7231],
`upsertRecipeRows` [7250]. Folders: `seedFolders` [7525], `normalizedFolders` [7533],
`compareFolders` [7542], `folderName` [7553].

### R3 — recipe box / folders / tags / cards (L15100–16357, 18739–18750)
`openRecipeBoxPage` [15100] … `closeRecipeBoxPage` [15134], `renderFolders` [16063],
`recipeBoxTags`/tag-filter templates [16077–16157], `bindRecipeCards` [16157],
`recipesByFolder` [16190], folder-tree templates + search [16206–16296], `startFolderRename`
[16297], `openFolderMenu` [16304], `openRecipeMenu` [16357], `closeFolderMenu` [16895],
`addRecipeTag`/`removeRecipeTag` [18739–18750].

### R4 — trash / restore / folder ops / render (L19824–21193)
`restoreTrashedRecipe` [19824], `permanentlyDeleteTrashedRecipe` [19840],
`isMissingRestoreRecipe` [20044], `mergeMissingRecipesFromBackup` [20555],
`normalizeRestoreFolder` [20969], `deleteFolder` [20978], `saveFolderRename` [21002],
folder drag [21025–21032], `renderRecipes` [21076] … `isAncestorFolder` [21193].
*(Note: `missingRestore*` for nutrition/ingredient-options are health/shared — §4.)*

### R5 — recipe view / cook-log display / scaling (L23930–24396)
`openRecipeDialog` [23930], scroll/scroller [23936–23946], `openRecipeView` [23955],
`openActiveRecipeView` [24009], side-nav/swipe [24028–24057], `recipeViewTemplate` [24066],
`activeRecipeViewTemplate` [24133], `activeIngredientChecklistTemplate` [24174],
**cook-log display** `cookLogTemplate` [24192], `cookLogPhotoTemplate` [24211],
`useCookLogPhotoAsRecipePhoto` [24220], `formatCookLogDate` [24234], view controls +
serving controls [24240–24356], `scaledIngredient*`/`recipeTimePills`/`combinedRecipeTime`/
`scaleIngredientAmount` [24357–24396].

### R6 — recipe form / cook-log rows / steps / nutrition-editor (L24396–25050)
`populateRecipeForm` [24396], photo [24420–24432], tag choices [24440], `saveRecipeFromForm`
[24455], `autoEstimateNutrition` [24521], `collectRecipeTags` [24552], **cook-log edit rows**
`renderCookLogRows` [24556] … `parseCookingDuration` [24652], step rows [24675–24743],
**recipe nutrition editor** (facts rows + AI estimate dialog) [24743–25050] — see §4 nutrition.

### R7 — import / scan / parse / ingredient rows (L25050–25758)
`openImportDialog` [25050], `importRecipeFromUrl` [25061], gateway [25096–25120], scan dialog
+ files [25165–25204], `scanRecipeFromImages` [25204], scan previews/edits [25249–25345]
(⚠ `prepareScanImage` [25345] is the **shared scan primitive** — §4), photo upload/resize
[25393–25439], `parseRecipeHtml`/`parseJsonLd`/`parseRecipeText`/`parseServings` [25443–25539],
ingredient rows + `normalizeIngredients`/`parseIngredientLine` [25543–25703], `addRecipeFolder`
[25708], `deleteRecipeFromForm`/`deleteRecipeById` [25730–25736], `renameRecipeFromMenu` [25758].

### R8 — Cook (active-cooking widget + session; L15845–16063)
`renderActiveCooking` [15845], `activeCookingTemplate` [15866], `startCookingRecipe` [15884],
`requestFinishCooking` [15913], `finishCookingRecipe` [15921], `completeCookingWithoutLog`
[15933], cook-session-notes dialog [15940–15987], `addCookingLogEntry` [15994],
`syncActiveCookingClock` [16014], `recipeDurationMinutes` [16025], `cookingTimerText` [16040],
`elapsedCookingSeconds` [16044], `formatCookingDuration` [16050]. **Cook has no page** — it
renders into the eat shell + the recipe view; it moves in with recipes.

### R9 — AI cleanup + recipe timer (L41982–42261)
`initAiRecipeToolbar` [41982], `runAiRecipeCleanup` [41992], AI review [42037–42150],
timer [42151–42261] (`startRecipeTimer`, `tickRecipeTimer`, `fireTimerDone`, `closeRecipeTimer`).

**Rough size:** ~180–200 functions / ~3,000–3,300 lines.

---

## 2. Relational data layer (`eat_recipes` / `eat_folders`) — scope + mechanism

**Confirmed recipes-owned, but mechanically different from the rest of the app.**

- **Different from the STATE_SECTIONS pattern.** Everything else syncs as JSONB section rows
  (`{stateId}:{section}` blobs via the state-sync layer). Recipes+folders are **also** stored
  as *individual relational rows* in Postgres tables `eat_recipes` / `eat_folders`, accessed
  by **direct PostgREST `fetch`** (`${supabaseBaseUrl()}/rest/v1/eat_recipes?...`,
  `on_conflict=id` upserts, column-fallback selects for older schemas) — R2's 16 functions.
  `state.recipes`/`state.folders` (JSONB `eat` section) is the in-memory mirror; the relational
  tables are the durable per-row store hydrated at boot.
- **Shared Supabase primitives it rides on** (STAY in app.js — used by other relational
  tables too, per the comment "the eat_recipes pattern"): `supabaseBaseUrl()` [7323],
  `supabaseHeaders()` [7333], `deleteSupabaseRow()` [7286]. **Inject these into recipes.**
- **Boot/sync callers (STAY in app.js — the hydration/auth flow):**
  `hydrateRecipeRowsFromSupabase()` is called at [2704] and [2836] (boot + re-auth). After the
  move, those app.js call sites invoke it via the module interface.
- **One cross-domain writer:** `saveRecipeRow` is called by **`importMealPlanRecipeDirect`**
  [8165] (a meal-plan function that imports a recipe straight into a meal slot). Meal-plan
  stays in app.js, so `saveRecipeRow` must be **exposed in the recipes interface** (like
  groceries exposing `groceryPlacesApiUrl`). All other `saveRecipeRow` callers are recipe/cook
  functions that move in.
- **Does it touch meal-plan/groceries data?** No — it reads/writes only `state.recipes` /
  `state.folders` and the two tables. Meal-plan references recipes **by id** (no relational
  writes except the one importMealPlanRecipeDirect above). Groceries reads recipe *ingredients*
  through the injected `recipeForSlot`/`activeRecipes` bridge (already in place from its
  extraction) — it does not touch the relational layer.

---

## 3. Module-level shared `let`s — the 5 flagged cross-area vars

| Var | Recipes/Cook usage | Verdict |
|---|---|---|
| **`pendingCookLogId`** [1506] | **read/write, but 100% inside Cook** — every ref (`startCookingRecipe` sets it, `finishCookingRecipe`/`completeCookingWithLog` read+clear it) is a Cook function moving in. **No non-cook code touches it.** | **Moves into `recipes-ui.js` as a private let.** Clean ownership — this is the "does it move entirely?" answer: **yes, entirely.** |
| **`recipeViewMealContext`** [735] | **read/write** — `openRecipeView` (R5, moves) sets it; the recipe-view serving controls (R5, move) read it; **but a `bindEvents` handler at [2506–2513] (stays in app.js) reads+clears it** and calls `updateMealPlannedServingsFromContext`. | **Moves into `recipes-ui.js`** (private let); expose a seam accessor (`getRecipeViewMealContext` + a clear) for the bindEvents handler — OR move that ~6-line handler body into a module function bindEvents calls. See boundary Q3. |
| **`currentWeek`** [591] | **not used** by any recipe/cook function. | n/a — meal-plan/grocery only. |
| **`prepOptions`** [169] | **read-only** — recipe ingredient rows (`renderIngredientSuggestions`, `ingredientRowTemplate`) read ingredient-options. | Ingredient-options are **shared recipe↔grocery** (groceries left them in app.js). Keep in app.js, **inject** `openIngredientOptionsDialog` + the option accessors. See boundary Q2. |
| **`shopSpace`** | **not used** (grocery-owned now). | n/a. |

**Answer to the ownership question in the brief:** `pendingCookLogId` moves into `recipes-ui.js`
**entirely** — it is only ever touched by Cook functions, all of which move. Nothing needs to
stay accessible to app.js for it. (`recipeViewMealContext` is the one that needs a small seam,
not `pendingCookLogId`.)

---

## 4. Touchpoints to other domains (active grep pass — preserve as injected interfaces)

### → meal-plan (the big boundary — see Q1)
Many recipe-*referencing* functions are **meal-plan**, not recipes, and STAY in app.js,
calling the recipes interface: recipe/ingredient pickers (`openMealRecipePicker`,
`chooseRecipeForPendingMeal`, `chooseRecipeForPendingAutoRule`, …), slot resolution
(`recipeForSlot` [23378], `groceryRecipeForSlot` [23447], `recipeForMealEntry` [16649]),
auto-generate (`nextGeneratedRecipe`, `eligibleRecipesForMeal`, `pickAutoGeneratedRecipe`,
`autoGenerateCandidateRecipes`, `eligibleRecipesForTags`, `recipeLastCookedTime`,
`autoEligibleFolderIds`, `folderIdByName`, `missingFolderMessage`), meal-plan recipe cards
(`warmMealPlanRecipes`, `dismissMealPlanRecipe`, `swipeAddMealPlanRecipe`,
`importMealPlanRecipeDirect`, `mealPlanRecipePreviewHtml`), `recipeOptionsTemplate`,
`recipeOrCustomMealValue`, `removeRecipeFromMealSlots`, and the recipe-view→meal writeback
`updateMealPlannedServingsFromContext` [24330] / `updateGroceryMealServing` [24347].
**Recipes exposes** (interface): `activeRecipes`, `trashedRecipes`, `openRecipeView`,
`openRecipeDialog`, `recipeTags`, `renderRecipes`/`renderFolders`, `saveRecipeRow`,
`recipeDefaultServings`, `folderName`, `scaleIngredientAmount`/`scaledIngredientToText`,
`normalizeIngredients`, and the recipe/folder normalizers used at boot. **Recipes injects
FROM meal-plan** the writeback targets it calls from the recipe view (Q3).

### → groceries (already extracted)
`buildGroceryItems` (grocery-ui) reads recipe ingredients via the injected `recipeForSlot`/
`activeRecipes` bridge — already wired. `updateGroceryMealServing` writes grocery serving from
the recipe view — a recipe-view→grocery seam (Q3). No new grocery coupling.

### → nutrition / daily-dozen (Decision #3 — see Q4)
**Recipe-embedded nutrition moves with recipes:** the recipe-form nutrition-facts editor +
the per-recipe AI estimate dialog (`renderNutritionRows`/`collectNutritionRows`/
`normalizeNutritionFacts`/`nutritionRecipeSignature`/`openNutritionEstimateDialog`/
`autoEstimateNutrition`/`saveNutritionEstimate` …, R6). **Health-page daily-dozen + food-log
UI STAYS in app.js** (not a recipes surface, not being extracted): `openDailyDozenPage`,
`renderDailyDozen`, `renderFoodHealthNutrition`, `renderFoodLogNutritionInputs`,
`dailyDozenEntries`, `dailyDozenCategories`. **Bridge to flag:** `dailyDozenRecipeSuggestions`
[15272] (recipe suggestions for a daily-dozen category) + `renderDailyDozenRecipeSuggestion`
are read by the health page but query the recipe library — keep recipe-owned + inject, or
leave in app.js + inject `activeRecipes`? (Q4).

### → shared scan seam
`prepareScanImage` [25345] currently lives in the recipe region but is **app-wide** (article
scan, **finance receipt scan — injected into `createFinanceModule`**, grocery receipt scan,
recipe scan). Same as the groceries pass treated it. **Decision: it must stay reachable by
finance/groceries/article.** Options: keep in app.js as shared infra + inject into recipes
(cleanest, and finance already consumes it from app.js), or move to a shared scan module.
Recommend **keep in app.js, inject** (Q5). Same for `getScanContent` [39360],
`retainScanImageEdits`/`renderScanImagePreviews`/`applyScanImageAction` if shared.

### → shared Supabase + utils (inject)
`supabaseBaseUrl`, `supabaseHeaders`, `deleteSupabaseRow`, `createId`, `escapeHtml`, `persist`,
`state`, `elements`, `normalize`, `callNetlifyFunction`, `trackUsage`, `showMailToast`,
`recordDeletion`, `fileToDataUrl`, date utils, `closeFloatingMenus`, `makeSortable`, etc.
(exact list finalized against an esbuild + static-undefined pass during impl, as groceries was).

---

## 5. Contiguity verdict → move strategy

**Not contiguous — 10+ regions**, interleaved with meal-plan functions (R3/R4 sit among
meal-plan pickers; R5/R6 recipe-view interleaves with meal-plan serving writeback). This is
**groceries-class**: a curated **name-allowlist whole-module move** (one commit) with:
- pure normalizers → **top-level exports** (boot-called by `normalizeState`),
- state/DOM functions → the **factory**,
- `createId`/`normalize` as module-scope copies,
- the one-line-function span fix already in the tooling,
- structural verification (pre/post inventory: each fn exactly once, no drops/dupes/orphans;
  static undefined-identifier scan; build + full test suite).

**The critical work is drawing the recipes↔meal-plan line precisely** (Q1) — misclassifying a
meal-plan function as recipes (or vice-versa) is the main risk, caught by the static scan +
inventory diff before commit.

---

## Decisions (confirmed 2026-09-13) + extraction result

**Confirmed:** (1) recipes↔meal-plan split as recommended — recipes owns library/view/editor/
import/scan/cook/timer/AI/trash/relational; meal-plan stays in app.js and calls the interface.
(2) Nutrition: recipe-embedded nutrition moves with recipes; health-page daily-dozen/food-log
stays in app.js (`dailyDozenRecipeSuggestions` injected). (3) Shared seams (ingredient-options,
`prepareScanImage`/scan seam, serving writeback) kept in app.js + injected; the recipe-view
close handler moved into the module as `onRecipeViewDialogClose`. (4) Whole move, one commit.

**What landed:**
- `recipes-ui.js` — `createRecipesModule(deps)` with **227** recipe+cook functions. **17 pure
  normalizers** are top-level `export`s (boot-called); the other **210** are in the factory.
  `createId` + `normalize` are module-scope copies; **no `_appState` needed** (no pure export
  touches app state — `recipeTags`/`trashedRecipes` are factory accessors, not exports).
  `preferredFolderOrder`/`recipePhotoBucket`/`TIMER_RE`/`activeRecipeScrollPositions` +
  25 recipe/cook private lets moved in. `makeSortable` imported from `./sortable.js`.
- **Cook folds in** (R8): active-cooking widget + session + cook-log display/edit. `pendingCookLogId`
  is fully cook-owned → private let (nothing in app.js touches it).
- **Seams:** getters `getActiveAppArea`/`getAuthSession`/`getSupabaseClient`; `setRowStorageReady`
  (moved relational hydrate writes it); shared ingredient-option getters; meal-plan pending-
  selection get/clear; the recipe-view close handler encapsulated as `onRecipeViewDialogClose`
  (so `currentActiveRecipeViewId`/`recipeViewMealContext` stay fully private). ~50 injected
  functions incl. the meal-plan bridge, shared scan seam, Supabase primitives, restore helpers,
  and 3 grocery helpers (`formatGroceryAmount`/`groceryAmountToNumber`/`renderGroceries`).
- **Restore/backup machinery stays in app.js** (`mergeMissingRecipesFromBackup` — a general
  restore orchestrator, `isMissingRestoreRecipe`, `normalizeRestoreFolder`); recipe accessors injected.
- **Interface:** 64 factory functions app.js still calls + `onRecipeViewDialogClose`; 13 boot
  normalizers imported directly.
- `app.js`: **48,559 → 45,603 lines** (227 fns removed).

**Verification (structural move, no behavior change):**
- Function inventory diff: each of the 227 moved fns appears **exactly once** in `recipes-ui.js`,
  **none** remain in `app.js`, **no duplicates**, **no functions lost** (only new symbol =
  `createRecipesModule`).
- Static undefined-identifier scan: no missing injected dep (surfaced + fixed
  `makeSortable`/`formatGroceryAmount`/`groceryAmountToNumber`/`renderGroceries` mid-pass).
- No orphaned recipe call left in app.js; moved private vars fully removed; seam rewrites present.
- **`npm run build` passes; full suite 1444/1444 green.**

**⚠️ Known latent bug, preserved (NOT introduced here):** `parseJsonLd` references
`readableDuration`, which is **undefined in the client** (only exists in `server.js`) — it was
already a free/undefined reference in `app.js` before this move (verified). Per the
structural-move rule it is left exactly as-is; it throws a `ReferenceError` only if a recipe-
import JSON-LD ISO-8601 duration path executes. Flag for a future fix if desired.

**⚠️ No UI test coverage** for recipe/cook render/handlers — the green suite proves the pure
logic modules + that nothing else regressed, not the recipe UI. Needs manual click-through.
