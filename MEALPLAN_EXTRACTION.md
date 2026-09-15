# Meal-plan Extraction — Pre-Check Plan (STOP-and-confirm before any code)

**Target:** move the **Meal-plan** domain — the planner (render + drag/drop + meal-entry
editing), auto-rules (UI + logic), meal-context, the meal-plan settings, the meal-plan
recipe cards, the restaurant seam, auto-generate, the recipe/ingredient pickers, and the
serving writeback — into `mealplan-ui.js` as `createMealplanModule(deps)`. Same pattern as
groceries/recipes: curated allowlist move (one dominant block + ~12 outliers), pure
normalizers exported top-level, structural verification, nav/glue stays in app.js.

**Status:** planning only. No meal-plan code written yet. This is the review artifact. Meal-plan
is the **hub** the other two just-extracted modules depend on, so this pass carries real
cross-module wiring decisions — flagged at the end.

Prereqs read: RECIPES_SPLIT_MAP.md, GROCERIES_EXTRACTION.md, RECIPES_EXTRACTION.md, CLAUDE.md
Decision #1/#2. Line numbers are current-app.js (45,602 lines) and will drift.

---

## 0. ⚠️ Prerequisite already fixed this session (context)

While mapping the cross-module wiring I found a **latent TDZ bug the groceries + recipes
extractions had introduced**: `_inventory` and `_groceries` factory-deps objects referenced
functions (`renderGroceries`, `normalizeIngredients`, `activeRecipes`, …) that are `const`-
destructured from a **later** factory (`_groceries`/`_recipes`), throwing a `ReferenceError`
at app.js load in the browser (tests never execute app.js's body, so it slipped through).
**Fixed in commit `3f764d8`** by deferring each forward cross-module reference to a thunk
`name: (...a) => name(...a)` (14 references; structural forward-ref scan now zero). The
meal-plan extraction uses the same thunk pattern for its new cross-module wiring, so it will
not reintroduce this.

---

## 1. Meal-plan code — functions/regions to move

**Contiguity: one DOMINANT block (L20061–23740, ~237 fns) + ~12 scattered outliers.** Curated
allowlist move, one commit, like groceries/recipes.

### M1 — normalizers / config / model (scattered outliers up top)
`cleanupAutoAppliedFutureMealDefaults` [5124], `removeDefaultMealEntryForState` [5141],
`defaultMealEntryValuesForState` [5151]; `isPlannedRecipeEntry` [5730], `recipeIdForSlot` [5734],
`createPlannedRecipeEntry` [5742], `normalizePlannedRecipeEntry` [5753], `plannedEntryAtLocation`
[5758]; `mergeCombinedMealSections` [6157], `mergeMealPlanConfig` [6177]; `mealSlotsHaveEntries`
[6682]; `defaultMealPlanConfig` [7061], `normalizeMealPlanConfig` [7078], `recomputeMealPlanLayout`
[7097]; `defaultAutoGenerateRules` [7161], `autoRule` [7167], `tagAutoRule` [7182],
`normalizeAutoGenerateRules` [7190], `normalizeAutoGenerateRule` [7197], `migrateLegacyAutoRuleTarget`
[7216]. *Boot-called from `normalizeState` → top-level exports (see §3).*

### M2 — meal-plan recipe cards (home/notif swipe deck) (L7743–8049)
`warmMealPlanRecipes` [7743], `restoreMealPlanSwipeScroll` [7763], `dismissMealPlanRecipe` [7770],
`swipeAddMealPlanRecipe` [7788], `importMealPlanRecipeDirect` [7803], `mealPlanNotifSwipeBodyHtml`
[7853], `mealPlanRecipePreviewHtml` [7894], `flipMealPlanCard` [7911], `unflipMealPlanCard` [7930],
`mealPlanNotifBellHtml` [7936], `wireMealPlanNotifDelegation` [7953], `positionMealPlanNotifPanel` [8049].
(`importMealPlanRecipeDirect` calls the recipes interface `saveRecipeRow` — injected.)

### M3 — meal-entry menus + context press (L15474–16054)
`applyInitialMealPlanFocus` [15474], `openMealEntryMenu` [15531], `openEmptyMealEntryMenu` [15671],
`openMealSlotMenu` [15717], copy/paste slot+entry [15765–15974] (incl. `recipeForMealEntry`,
`mealEntryValue`, `addMakeAheadTaskForMealEntry`/`addPrepAheadTaskForMealEntry` ⚠ Tasks seam),
auto-rule entry menu [15885–15974], context-press [16031–16054].

### M4 — auto-rules dialog + restaurant seam + settings (L17833–18843)
`openAutoRulesDialog`/`closeAutoRulesDialog` [17833–17841]; **restaurant seam**
`selectRestaurantForMeal` [18026], `clearMealRestaurant` [18064], `renderMealRestaurantArea` [18073]
(⚠ moved to meal-plan — currently in app.js, uses groceries' `groceryPlacesApiUrl`/`Options` via the
grocery interface); meal-plan settings `saveMealPlanMembers`/`openMealPlanSettingsDialog`/
`renderMealTypesList`/`addMealType`/`saveMealPlanMealTypes`/`applyMealPlanConfigChange` [18739–18843].

### M5 — restore helpers (meal-plan half)
`missingRestoreAutoRules` [19212], `autoRuleSignature` [19264]. *(The `missingRestorePlayAutoRules`/
`playAutoRuleSignature` are the Play domain — excluded.)* Note the general restore orchestrator
(`mergeMissingRecipesFromBackup` etc.) STAYS in app.js (as with recipes); these two are meal-plan-
specific detectors it calls — confirm during impl whether they move or stay+inject.

### M6 — the dominant block: planner render + auto-rules UI + meal-entry drag/drop + slots (L20061–22637)
`collapseAllPlannerDays` [20061], `renderPlanner` [20088], carousel/mealNote/meal-context
[20377–20503], **auto-rules UI** `renderAutoRules` [20686] … `autoGenerateRuleFromInput` [21174],
`columnMealsForDay`/`combinedMealMembersForDay`/auto-slot toggles [21199–21260], `mealKeysForDay`
[21260], `displayMealName` [21266], slot/entry templates [21270–21492], the **entire meal-entry +
auto-rule drag/drop + pointer-delete machinery** [21492–21958], reorder/move/combine [22042–22229],
`commitMealInput`/`updateMealPlannedServings` [22229–22248], special-meal + grocery-meal slot helpers
[22279–22334], `addMealEntry`/**pickers** (`openMealRecipePicker`, `chooseRecipeForPendingMeal`,
`openMealIngredientPicker`, `chooseIngredientForPendingMeal`) [22382–22443], `removeMealEntry` [22455],
`mealPlanRecipeIdsForWeek` [22480], planner-day select/clear + `autoGenerateMealSection`/
`autoGeneratePlannerDay` [22497–22637].

### M7 — serving writeback + setMeal + auto-generate (L22837–23360)
`updateMealPlannedServingsFromContext` [22837], `updateGroceryMealServing` [22854] (⚠ writes grocery
serving — recipes injects these two today), `setMeal` [23099], `removeRecipeFromMealSlots` [23109],
**auto-generate** `autoGenerateMealPlan` [23123] … `pickAutoGeneratedRecipe` [23289],
`isWeekdayBreakfastSlot`/`slotHasMealSelection`/`repeatMeal` [23327–23344].

### M8 — meal-plan view toggle + defaults + nutrition totals (L23474–23635)
`mealPlanViewMode`/`isPublishedMealPlanView` [23474–23478], `toggleMealPlanView` [23510],
`applyDefaultMealEntries`/`applyDefaultMealEntry`/`recipeOrCustomMealValue` [23558–23581],
`mealPlanNutritionTotals` [23635] (⚠ reads nutrition — health-adjacent; stays meal-plan-owned per map).

**Excluded (false positives / other domains):** `normalizePlayAutoRules` + all Play auto-rules
(13157–14452), `renderDoPlanner`/`doRealWeekKey` (Tasks), `renderPlayPlanner`/`renderWatchPlanner`/
`renderReadingPlanner`, `renderFoodHealthMeals`/`currentCalendarWeekKey` (health/calendar),
`setWeekToolsMode` (shared week-tools header — stays in app.js, injected).

**Rough size:** ~230–250 functions.

---

## 2. Interface consumption of the two just-extracted modules (the #2b mismatch check)

**Groceries — what meal-plan calls, cross-checked against groceries' returned interface:**
`renderGroceries` (20 sites — meal-plan refreshes the list after slot edits), `selectedGroceryWeek`,
`navigateGroceryWeek`, `renderShopPage`. **All four ARE exposed by `createGroceriesModule`'s return.
✅ No mismatch.** (Meal-plan does not call `buildGroceryItems` directly — that lives in groceries and
reads the slots via the injected meal-plan bridge.)

**Recipes — what meal-plan calls, cross-checked against recipes' returned interface:**
`activeRecipes` (29 sites), `openRecipeView`, `openRecipeBoxPage`, `recipeDefaultServings`,
`scaledIngredientToText`, `scaleIngredientAmount`, `normalizeIngredients`, `saveRecipeRow`,
`renderRecipes`, `recipeTags`, `folderName`, `openRecipeDialog`, `renderIngredientSuggestions`,
`parseIngredientLine`. **All ARE exposed by `createRecipesModule`'s return. ✅ No mismatch.**

**The reverse — what groceries/recipes need FROM meal-plan (currently injected from app.js):**
- **Groceries injects:** `weekState`, `weekKey`, `mealSlotsForWeek`, `combinedMealSectionsForWeek`,
  `mealKeysForDay`, `slotEntries`, `recipeForSlot`, `groceryRecipeForSlot`, `prepDays`.
- **Recipes injects:** `recipeForSlot`, `plannedServingsForEntry`, `mealEntryValue`, `displayMealName`,
  `renderPlanner`, `removeRecipeFromMealSlots`, `chooseRecipeForPendingMeal`,
  `chooseRecipeForPendingAutoRule`, `updateMealPlannedServingsFromContext`, `updateGroceryMealServing`,
  `formatServingsLabel`.

Whichever of these move into `mealplan-ui.js` must appear in **mealplan's returned interface**, and the
`_groceries`/`_recipes` deps that reference them become forward-refs (mealplan instantiated last) →
**thunked** (same fix as commit `3f764d8`). No interface *mismatch* exists; it's a *wiring* task.

---

## 3. Module-level shared `let`s (esp. currentWeek + prepOptions)

| Var | Meal-plan usage | Verdict |
|---|---|---|
| **`currentWeek`** [561] | read + **written** (week nav) — but **also driven by Tasks** (`tasksWeekSession`, `doRealWeekKey`) and read by shop. Genuinely shared. | **Stays a `let` in app.js**; inject `getCurrentWeek`/`setCurrentWeek` (or a nav thunk). Not moved. |
| **`prepOptions`** [~167] | **not used** by meal-plan (it's recipe/grocery ingredient-options). | n/a. |
| `activePlannerDayId` [566], `activeAutoRuleDayId`, meal drag/gesture/copy/pending-selection lets, `mealPlanContext*`, `mealPlanNotif*`, `mealPlanSwipeIndex`, etc. | meal-plan-only | **Move into `mealplan-ui.js`** as private lets. |

**Module-load-time calls (critical):** the top-level initializers `let currentWeek = startOfPrepWindow(new Date())`
[561] and `let activePlannerDayId = plannerDayIdForDate(new Date())` [566] run at module load, before any
factory. So **`startOfPrepWindow` and `plannerDayIdForDate` must be top-level exports** (imported, hoisted) —
or stay in app.js. See §6.

---

## 4. manualGroceries / the week record (#4)

Confirmed: `createBlankWeek()` still puts a legacy **`manualGroceries: []`** field in the per-week record,
and `ensurePrepWindowShape` still normalizes it. Per Decision #2b this is **not migrated** — the *live*
list is `state.persistentManualGroceries` (grocery section) and groceries' boot normalizer folds the legacy
field in. **Meal-plan owns `createBlankWeek`/`ensurePrepWindowShape` and keeps the legacy field untouched.**
No other grocery-owned data is embedded in the week record (the rest is `slots`, `combinedMealSections`,
`mealNotes`, `mealPlanView`, `publishedSlots`, `notes`). **No change to the week-record shape.**

## 5. Calendar touchpoint (#5)

Meal-plan reads calendar data for the planner: `eventCoversMeal` [20441]/`mealContextEvents` [20455] read
`state.planEvents`; the planner also pulls synced calendar events via `loadCalendarEvents` (boot + calendar
dialog). The **dual list** (`state.calendars` linked + `state.planCalendars` ICS) is **still un-unified**
(Decision #1 pending). **This extraction preserves the current dual-list behavior exactly** — it injects the
calendar readers (`loadCalendarEvents`, and whatever the planner uses to resolve synced events) and does
**not** touch `state.calendars`/`state.planCalendars` structure or attempt any unification. The
`state.calendars` writes (`openCalendarsDialog`/`saveCalendarSettings`, ~L18233) are **calendar-settings
code, not meal-plan** — they stay in app.js.

## 6. The eat shell / section (#6)

`activateEatShell()` (app.js glue) calls `renderPlanner()` (+ `renderActiveCooking()` from recipes). It
**stays in app.js** as the shared eat-shell entry, calling the injected `renderPlanner` (mealplan interface),
consistent with how groceries/recipes left the shell in place. The shared `eat` Supabase section is not
split; meal-plan's keys (`plans`, `publishedWeeks`, `mealPlanConfig`, `autoGenerateRules`) live there
alongside recipes' — no section change.

## 7. Other touchpoints (active grep)

- **Tasks/"do" seam:** `addMakeAheadTaskForMealEntry`/`addPrepAheadTaskForMealEntry` create `do` tasks
  from meal entries — they move with meal-plan and call the injected task-creation path (`doBacklogTasks`,
  `createId`, `weekKey`).
- **Restaurant seam:** now folds INTO meal-plan (it writes meal slots); it consumes groceries'
  `groceryPlacesApiUrl`/`groceryPlacesRequestOptions` (exposed) + a `restaurantSearch*` state cluster.
- **Grocery-meal slots:** `isGroceryMealSlot`/`groceryMealSlotId`/`parseGroceryMealSlot`/`groceryRecipeForSlot`
  are meal-plan slot helpers that encode a grocery item as a meal — meal-plan-owned; groceries reads
  `groceryRecipeForSlot` via the bridge.
- **Shared week-tools header:** `setWeekToolsMode` stays in app.js (finance/shop/tasks/plan all use it),
  injected into meal-plan.

## 8. Contiguity → one commit

One dominant block + ~12 outliers → a single curated whole-module commit (like groceries/recipes), verified
by pre/post inventory diff + static undefined scan + build + tests + a **forward-reference (TDZ) scan** of
the factory wiring (now part of the toolkit).

---

## Decisions for you (blocking — I will not write code until answered)

**(a) The #2 ownership question — recipe pickers / auto-generate / slot-resolution / serving-writeback.**
My recommended split:
- **MOVE into meal-plan** (they're meal-plan operations that happen to read recipe data): the recipe/
  ingredient **pickers** (`openMealRecipePicker`, `chooseRecipeForPendingMeal`, `chooseRecipeForPendingAutoRule`,
  `openMealIngredientPicker`, `chooseIngredientForPendingMeal`, `chooseIngredientForPendingAutoRule`),
  **auto-generate** (`autoGenerateMealPlan`, `eligibleRecipesForMeal`, `pickAutoGeneratedRecipe`,
  `autoGenerateCandidateRecipes`, `sharedAutoGenerateRecipe`, …), and the **serving writeback**
  (`updateMealPlannedServingsFromContext`, `updateGroceryMealServing`). Recipes then gets these injected
  (thunked) from mealplan instead of owning them. **This completes Decision #2's intent.**
- **KEEP in app.js as shared week/plan-record infra** (used by groceries + tasks + shop, not just
  meal-plan): the **slot-resolution accessors** `weekState`, `weekKey`, `mealSlotsForWeek`,
  `combinedMealSectionsForWeek`, `mealKeysForDay`, `slotEntries`, `recipeForSlot`, `groceryRecipeForSlot`,
  plus `createBlankWeek`/`ensurePrepWindowShape`/`ensureMealSlotShape`/clone/reconcile and the week-cursor
  primitives (`currentWeek`, `dateFromWeekKey`, `startOfPrepWindow`, `plannerDayIdForDate`, `prepDays`,
  `meals`). Rationale: these are the shared week-record data layer (like the eat shell), and moving them
  would force `startOfPrepWindow`/`plannerDayIdForDate` (called at module load) and the Tasks week-cursor
  onto meal-plan.

  → **Confirm this hybrid**, or choose **full ownership (Option A)**: move the slot accessors + week-record
  helpers into meal-plan too, and thunk them into groceries (heavier churn, and the module-load/Tasks
  primitives still can't move).

**(b) Interface mismatches found:** **none** — everything meal-plan needs from groceries and recipes is
already exposed (§2). The only work is *wiring* (thunk the forward mealplan refs in groceries/recipes deps,
since mealplan instantiates last). Flagging that this is wiring, not a mismatch, per your request.

## Decisions (confirmed 2026-09-14) + extraction result

**Confirmed:** (a) **Hybrid** — the pickers, auto-generate, and serving-writeback move into
meal-plan; the shared slot-resolution accessors (`weekState`/`mealSlotsForWeek`/`slotEntries`/
`recipeForSlot`/`groceryRecipeForSlot`/`createBlankWeek`/`ensurePrepWindowShape`) + week-cursor
primitives (`currentWeek`/`startOfPrepWindow`/`plannerDayIdForDate`/`prepDays`/`meals`) stay in
app.js as shared week/plan-record infra. (b) Whole move, one commit, dual-calendar preserved.

**What landed:**
- `mealplan-ui.js` — `createMealplanModule(deps)` with **246** functions. **15 pure normalizers**
  are top-level `export`s (boot); the other **231** are in the factory. `createId`/`normalize`
  module-scope; `normalizeGroceryItemName`-style impurity handled via `_appState` (1 export,
  `recomputeMealPlanLayout`). 10 meal-plan-owned consts moved in; `ldeIcon` imported from
  `live-icons.js`; `autoRuleMealKeys` (derived from injected `meals`) stays injected.
- **Instantiated LAST** (inventory → groceries → recipes → **meal-plan**), so it consumes the
  groceries/recipes interfaces directly, and the forward references those earlier factories make
  to meal-plan functions are deferred via thunks (the general forward-ref fixer thunked 8 refs).
- **~99 injected function deps** (the shared week/slot infra, calendar readers, Tasks seam
  `renderDoPlanner`/`doBacklogTasks`/`normalizeDoTasks`, recipe + grocery interfaces, shared utils)
  + shared consts (`meals`/`prepDays`/`breakfastMeals`/… ) + **17 shared mutable lets kept in
  app.js via injected get/set accessors** (`currentWeek`, `activePlannerDayId`, the 4 pending picker
  selections, `lastMealDragPoint`, `draggedDoTask`/`draggedPlayTask`, restaurant-search state, …).
- **Kept in app.js** (hybrid + shared): the slot/week-record accessors, calendar readers (dual list
  untouched — Decision #1 not applied), the restore machinery, the eat shell (`activateEatShell`),
  and the legacy `week.manualGroceries` field (Decision #2b).
- `app.js`: **45,603 → 41,775 lines** (246 fns removed).

**Interface mismatches (§2b):** **none.** Everything meal-plan needs from groceries
(`renderGroceries`/`selectedGroceryWeek`/`navigateGroceryWeek`/`renderShopPage`) and recipes
(`activeRecipes`/`openRecipeView`/`normalizeIngredients`/…) is already exposed. The only work was
wiring (thunks), as predicted.

**Verification:** function-inventory diff — each of the 246 moved fns appears **exactly once** in
`mealplan-ui.js`, **none** remain in app.js, no dups, none lost (only new symbol =
`createMealplanModule`). Static undefined-identifier scan clean (surfaced + fixed a wrongly-swept
shared `prepareScanImage` and the `ldeIcon` import mid-pass). **Forward-reference (TDZ) scan: 0
violations.** `npm run build` passes; full suite **1444/1444** green.

**Also fixed this session (prerequisite, commit `3f764d8`):** a latent TDZ bug the groceries +
recipes extractions had introduced (earlier factories referencing later-destructured module consts),
which would have broken the app at browser load. The meal-plan wiring uses the same thunk pattern.

**⚠️ No UI test coverage** for the planner render/handlers — the green suite proves the pure logic +
no regression elsewhere, not the meal-plan UI. Needs manual click-through (planner render, meal-entry
drag/drop + editing, auto-rules, pickers, auto-generate, restaurant search, meal-plan settings,
grocery-list refresh from the plan).


## Post-extraction fix (2026-09-14) — boot hang on "Checking sign-in…"

The first pass mis-classified 10 meal-plan config/model/boot functions as top-level exports of
`mealplan-ui.js`, but they read/mutate the shared meal-layout arrays (`meals`, `prepDays`,
`breakfastMeals`, `lunchMeals`, `dinnerMeals`, `combinedMealSections`, `mealColumnConfigs`,
`autoRuleMealKeys`) that stayed in `app.js` and are only **injected into the factory** — a
top-level export can't see injected deps. `recomputeMealPlanLayout` (called unconditionally from
`normalizeState` during `const state = loadState()` at module-eval) hit `meals.length = 0` with
`meals` undefined → `ReferenceError` → module evaluation aborted before `render()`/`initializeApp()`
ran → the sign-in gate stuck on "Checking sign-in…".

**Fix:** moved these 10 back to `app.js` (they belong with the shared arrays they own):
`recomputeMealPlanLayout`, `mergeMealPlanConfig`, `defaultAutoGenerateRules`,
`normalizeAutoGenerateRule`, `normalizeAutoGenerateRules`, `migrateLegacyAutoRuleTarget`,
`cleanupAutoAppliedFutureMealDefaults`, `removeDefaultMealEntryForState`,
`defaultMealEntryValuesForState`, `normalizePlannedRecipeEntry`. The factory injects the 3 of
these its runtime code calls. `mealplan-ui.js` now has **6** clean top-level exports + **230**
factory fns (236 moved total).

**Verification tooling added:** an export-scope guard that flags any top-level module export
referencing an injected-only name via *any* access form (call, property, mutation) — the exact
gap that let this through. Re-scanned all modules: `mealplan-ui.js`, `recipes-ui.js`,
`groceries-ui.js`, `finance-ui.js` (+ contacts/weather/inventory) are all clean.
