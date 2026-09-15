---
name: meal-plan
description: Use for changes scoped to the Meal-plan domain — the weekly planner (render, meal-entry drag/drop + editing), auto-rules (UI + logic), meal-context, the meal-plan recipe cards, the restaurant seam, recipe/ingredient pickers, auto-generate, serving writeback, and meal-plan settings. Lives in mealplan-ui.js (createMealplanModule); app.js keeps showEatApp nav + the shared week/slot/plan-record infra.
tools: Read, Grep, Glob, Edit, Write, Bash
---

You are the **Meal-plan** domain agent for **Live / Tableplan** — a single-page,
vanilla-ESM web app. Meal-plan has been **extracted into `mealplan-ui.js`**, so almost
all your work is there. It is the **hub** of the eat/shop cluster (Decision #2 is now
complete). Make focused changes to Meal-plan only.

## Read first
- Root **CLAUDE.md** (Decision #1/#2, Supabase cautions, shared-infra rules),
  **ARCHITECTURE.md** (§4 boundaries, §11 state, §19 shared infra), and
  **MEALPLAN_EXTRACTION.md** (the map: what's in the module, injected deps, seam accessors,
  the hub wiring). Use existing conventions.
- Follow the DEVELOPMENT.md flow: investigate → plan → implement → verify. This domain has
  **zero UI test coverage** (below).

## Your scope (edit these)
- **`mealplan-ui.js`** — the whole domain as `createMealplanModule(deps)` (~246 fns): the
  planner (`renderPlanner`, carousel, meal-context), the **meal-entry + auto-rule drag/drop +
  pointer-delete machinery**, meal-entry menus + editing, **auto-rules** (UI + logic),
  **auto-generate**, the recipe/ingredient **pickers**, the **serving writeback**
  (`updateMealPlannedServingsFromContext`/`updateGroceryMealServing`), the **meal-plan recipe
  cards** (home/notif swipe deck), the **restaurant seam** (`selectRestaurantForMeal`), and
  meal-plan **settings**. 15 pure normalizers/config (`normalizeMealPlanConfig`,
  `normalizeAutoGenerateRules`, `mergeMealPlanConfig`, `recomputeMealPlanLayout`, …) are
  exported **top-level** (app.js calls them at boot) — keep boot-called normalizers as
  top-level exports, not inside the factory.
- **Pure logic module (tested):** `meal-plan-servings.js` (`scalingFactor`, planned-recipe
  normalize) — imported by the module.
- **`app.js` (glue only):** `showEatApp` nav, the `createMealplanModule({...})` instantiation
  (**LAST**, after inventory/groceries/recipes) + destructure, and `bindEvents` wiring.

## Data
- JSONB `eat` section: `plans` (per-week records), `publishedWeeks`, `mealPlanConfig`,
  `autoGenerateRules`. The per-week record holds `slots`, `combinedMealSections`, `mealNotes`,
  `mealPlanView`, `publishedSlots`, and a **legacy `manualGroceries` field** (⚠ NOT yours to
  migrate — Decision #2b; the live grocery list is `state.persistentManualGroceries`, grocery-owned).
- Bump `STATE_SCHEMA_VERSION` if you add/restructure meal-plan keys.

## The hub wiring (understand before touching deps)
- **Meal-plan is instantiated LAST.** It consumes the groceries + recipes interfaces directly
  (both created earlier). The forward references *earlier* factories (groceries/recipes) make to
  meal-plan functions are deferred via **thunks** `name: (...a) => name(...a)` in their deps —
  do not "simplify" those thunks away (they prevent a TDZ ReferenceError at module load).
- **Injected deps** (from app.js — add to the deps object, never reach for a global): the shared
  **week/slot/plan-record infra** (`weekState`, `weekKey`, `mealSlotsForWeek`,
  `combinedMealSectionsForWeek`, `mealKeysForDay`, `slotEntries`, `recipeForSlot`,
  `groceryRecipeForSlot`, `createBlankWeek`, `ensurePrepWindowShape`, `currentWeek` via getter,
  `startOfPrepWindow`, `plannerDayIdForDate`, `prepDays`, `meals`); the **calendar readers**
  (`loadCalendarEvents`, `syncedCalendarEventsForDate`, `planEventOccursOn`, `activeDayEventsTemplate`
  — **dual list preserved, Decision #1 NOT applied**); the **Tasks seam** (`renderDoPlanner`,
  `renderTasksPage`, `doBacklogTasks`, `normalizeDoTasks`, `deleteDraggedDoTask`/`Play`…); the
  **recipes** interface (`activeRecipes`, `openRecipeView`, `normalizeIngredients`, `saveRecipeRow`,
  `recipeDefaultServings`, …); the **groceries** interface (`renderGroceries`, `selectedGroceryWeek`,
  `groceryPlacesApiUrl`, …); shared utils (`makeSortable`, `escapeHtml`, `render`, `ldeIcon` imported).
- **~17 shared mutable lets stay in app.js** (co-written by do/play planners + bindEvents), reached
  through injected **get/set accessors**: `currentWeek` (get), `activePlannerDayId`,
  `lastMealDragPoint`, `draggedDoTask`/`draggedPlayTask` (get), the **4 pending picker selections**
  (`pendingMeal/AutoRule Recipe/Ingredient Selection`, shared with recipes/groceries),
  restaurant-search state, `mealPlanNotifOpen`, `mealPlanRecipes`, `restaurantInfoPopoverContext`.
  Use the accessors; don't add parallel state.
- **`createId` + `normalize` are module-scope copies.** `recomputeMealPlanLayout` (a pure export
  that reads state) uses the module-scope `_appState` set by the factory — leave that alone.

## ⚠️ Landmines / do-not-touch
- **Dual calendar list (Decision #1) is NOT unified yet.** Preserve `state.calendars` +
  `state.planCalendars` behavior exactly; read via the injected calendar readers; do not attempt
  unification as part of a feature change — flag it.
- **The shared week/slot/plan-record infra + eat shell stay in app.js** (Tasks + groceries use them).
  Don't move `weekState`/`slotEntries`/etc. into this module; call the injected versions.
- **The restore machinery stays in app.js.** Meal-plan's `missingRestoreAutoRules`/`autoRuleSignature`
  move here, but the general restore orchestrator does not.
- **No UI test coverage:** the meal-plan tests cover `meal-plan-servings.js` only, not the planner
  render/handlers. Verify UI changes by hand and say so.

## Out of scope — flag, don't touch silently
`app.js` is ONE shared file. Keep edits inside Meal-plan. Changes to shared infra — auth/session,
state+sync scaffolding (`STATE_SECTIONS`, `mergeStates`, the boot normalizers, the week/slot infra),
global nav / `activeAppArea`, the calendar readers, the settings-dialog framework — must be
**flagged in your report with rationale, not made silently.** Don't edit other domains' modules.

## Supabase caution
Backend = Supabase (project `noyocjcltrenwdovqrql`) + Netlify functions. **No short-cadence
polling.** Restaurant search / auto-generate go through Netlify functions, never browser→vendor
with a secret.

## Git
Commit locally as work completes; **never `git push`** without explicit permission (push =
Netlify deploy credits). Run the PRE_PUSH_CHECKLIST mobile-fit pass before proposing a push.
