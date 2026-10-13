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

## Ownership (checked by CI)
<!-- test/architecture-agent-coverage.test.js reads the two lines below. Paths are
     from the repo root; `*` matches within one name. When you add, rename or remove a
     module, function or state key in this domain, update these lines in the same PR. -->
- files: `mealplan-ui.js`, `meal-plan-*.js`
- state: `plans`, `publishedWeeks`, `mealPlanConfig`, `autoGenerateRules`, `mealPlanSharedEvents`

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
- **Pure logic modules (tested — extend with tests):** `meal-plan-servings.js`
  (`scalingFactor`, planned-recipe normalize); `meal-plan-time.js` (which column opens
  for the time of day, and which meals a calendar event lands on — `mealtimeForLabel`,
  `eventDaySpan`, `spanCoversMealtime`, overnight/multi-day aware); `meal-plan-state.js`
  (auto-fill snapshot/rollback, make-ahead/prep-ahead task de-dupe).
- **`app.js` (glue only):** `showEatApp` nav, the `createMealplanModule({...})` instantiation
  (**LAST**, after inventory/groceries/recipes) + destructure, and `bindEvents` wiring.

## Data
- JSONB `eat` section: `plans` (per-week records), `publishedWeeks`, `mealPlanConfig`,
  `autoGenerateRules`. The per-week record holds `slots`, `combinedMealSections`, `mealNotes`,
  `mealPlanView`, `publishedSlots`, and a **legacy `manualGroceries` field** (⚠ NOT yours to
  migrate — Decision #2b; the live grocery list is `state.persistentManualGroceries`, grocery-owned).

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

## Events & notes (Luke's rules — keep them)
- A calendar event shows **only on the meals its time of day covers** (an 8a–4p
  shift shows on lunch; breakfast and dinner are assumed at home). All-day events
  show on every meal. The logic is `meal-plan-time.js`; don't re-derive it in the UI.
- Events & notes cards are **open by default**.
- Which events reach the meal plan is Calendar's call: a calendar's **Show on Meal
  Plan** switch (ICS feeds and Google calendars too), plus each member's personal
  flagged events shared through `state.mealPlanSharedEvents`
  (`calendar/meal-plan-share.js`, Calendar-owned). Read them through the injected
  calendar readers; ask the Calendar agent for changes to what is shared.
- The meal-plan recipe bell follows the notifications-window rules (CLAUDE.md).

## ⚠️ Landmines / do-not-touch
- **Dual calendar list (Decision #1) is NOT unified yet.** Preserve `state.calendars` +
  `state.planCalendars` behavior exactly; read via the injected calendar readers; do not attempt
  unification as part of a feature change — flag it.
- **The shared week/slot/plan-record infra + eat shell stay in app.js** (Tasks + groceries use them).
  Don't move `weekState`/`slotEntries`/etc. into this module; call the injected versions.
- **The restore machinery stays in app.js.** Meal-plan's `missingRestoreAutoRules`/`autoRuleSignature`
  move here, but the general restore orchestrator does not.
- **No UI test coverage:** the meal-plan tests cover the pure modules (`meal-plan-servings`,
  `-time`, `-state`, `calendar-meal-plan-share`), not the planner render/handlers. Verify UI
  changes in headless Chromium at phone width (`npm run dev:local`, dev sign-in) and say so;
  a real finger-drag on iOS still needs Luke's phone.

## Out of scope — flag, don't touch silently
`app.js` is ONE shared file. Keep edits inside Meal-plan. Changes to shared infra — auth/session,
state+sync scaffolding (`STATE_SECTIONS`, `mergeStates`, the boot normalizers, the week/slot infra),
global nav / `activeAppArea`, the calendar readers, the settings-dialog framework — must be
**flagged in your report with rationale, not made silently.** Don't edit other domains' modules.

## Supabase caution
Backend = Supabase (project `noyocjcltrenwdovqrql`) + Netlify functions. **No short-cadence
polling.** Restaurant search / auto-generate go through Netlify functions, never browser→vendor
with a secret.

## New synced state
A new key goes in `STATE_SECTIONS` (app.js) **and** gets an explicit merge rule in
`mergeStates` or a documented `MERGE_NEWER_WINS_KEYS` entry
(`test/architecture-state-merge-coverage.test.js` fails otherwise). A synced setting
or preference also goes in `TRACKED_SETTINGS` (`settings-sync.js`) — see CLAUDE.md
"Settings must sync by their own stamp". **Do not bump `STATE_SCHEMA_VERSION`** for a
non-finance key: it drives the server's finance-protection trigger, and a bump is a
decision for Luke (CLAUDE.md "Decision boundaries").

## UI conventions
Follow CLAUDE.md "UI conventions": the house `live-toggle` switch, and the
notifications-window rules (never open empty, close when the last item is handled).
Fixed windows and popovers size against the bottom dock via `dock-space.js`
(`usableViewportBottom`, `dockInset`, `notificationsWindowBox`). Every page must fit a
~360px phone with no sideways scroll.

## Git & shipping
Follow root **CLAUDE.md → Git / GitHub**. Commit on a branch as work completes;
pushing a verified branch is fine. The main session opens the PR, waits for CI,
merges, and adds the `UNDEPLOYED.md` entry. **Never** make a `[deploy]` commit, apply
a DB migration, or cross a decision boundary without Luke's OK. In your final report,
say how the change reaches Luke: a **Netlify deploy** (anything under `netlify/` or
other server behavior), a **TestFlight build** (the iPhone app bundles its own copy of
the client, and native `ios/` changes only ship this way), or both. Log anything real
you notice but don't fix to `ISSUES.md`.
