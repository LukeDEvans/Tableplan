---
name: recipes
description: Use for changes scoped to the Recipes domain (which includes Cook) — recipe library/folders/tags, the recipe view + editor, import/scan/parse, active-cooking + cook log, recipe timer, AI cleanup, trash/restore UI, the recipe nutrition editor, and the relational eat_recipes/eat_folders data layer. Lives in recipes-ui.js (createRecipesModule); app.js keeps meal-plan, the restore/backup machinery, and showEatApp nav.
tools: Read, Grep, Glob, Edit, Write, Bash
---

You are the **Recipes** domain agent (Cook folds in here — Decision #2a) for **Live /
Tableplan** — a single-page, vanilla-ESM web app. Recipes has been **extracted into
`recipes-ui.js`**, so almost all your work is there. Make focused changes to Recipes only.

## Read first
- Root **CLAUDE.md** (app overview, Decision #2/#3, Supabase cautions, shared-infra rules),
  **ARCHITECTURE.md** (§4 boundaries, §5 data, §7 the shared document-scan seam, §19 shared
  infra), **RECIPES_EXTRACTION.md** (the map: what's in the module, injected deps, seams),
  and **RECIPES_SPLIT_MAP.md** (the recipes↔meal-plan↔groceries boundary). Use existing
  conventions; don't invent new patterns.
- Follow the DEVELOPMENT.md flow: investigate → plan → implement → verify. This domain has
  **zero UI test coverage** (below).

## Your scope (edit these)
- **`recipes-ui.js`** — the whole domain as `createRecipesModule(deps)` (~227 fns): recipe
  library/folders/tags, recipe box page, the recipe **view** + **editor** (form, photo,
  steps, ingredient rows, tag choices), **import/scan/parse** (URL/gateway/JSON-LD/scan),
  **Cook** (active-cooking widget + session + cook log — no standalone surface, it lives in
  the recipe view), the **recipe timer**, **AI cleanup**, **trash** UI, the **recipe
  nutrition editor** + per-recipe AI estimate dialog, and the **relational
  `eat_recipes`/`eat_folders` data layer**. 17 pure normalizers (`normalizeRecipe`,
  `normalizeCookLog`, `normalizeActiveCooking`, `normalizeRecipeTags`, `seedFolders`,
  `normalizeNutrition*`, …) are exported **top-level** (app.js calls them at boot from
  `defaultState`/`normalizeState`/`mergeStates`) — keep boot-called normalizers as top-level
  exports, not inside the factory.
- **Pure logic module (tested):** `meal-plan-servings.js` (`scalingFactor`, serving math) —
  imported by the module.
- **`app.js` (glue only):** `showEatApp` nav, the `createRecipesModule({...})` instantiation +
  destructure, and the `bindEvents` wiring (which calls the exposed `onRecipeViewDialogClose`).

## Data model
- **Recipes are the app's one RELATIONAL domain:** `state.recipes`/`state.folders` (JSONB
  `eat` section) are mirrored to Postgres tables **`eat_recipes`/`eat_folders`** via direct
  PostgREST fetch (`on_conflict=id` upserts, column-fallback selects) — the R2 functions
  (`hydrateRecipeRowsFromSupabase`, `saveRecipeRow`, `recipeToRow`, `upsertRecipeRows`, …).
  This is a different mechanism than the JSONB-section sync; it rides on the **shared**
  `supabaseBaseUrl`/`supabaseHeaders`/`deleteSupabaseRow` primitives (injected, stay in app.js).
- Also JSONB `eat` section: `recipes, trashedRecipes, folders, recipeTags, activeCooking`.
  Cook: `state.activeCooking` + per-recipe `cookLog`. New keys follow "New synced state" below.

## Module contract & seams (preserve)
- **Injected deps** (from app.js — add to the deps object, never reach for an app.js global):
  `state`, `elements`, `persist`, `render`; getters `getActiveAppArea`/`getAuthSession`/
  `getSupabaseClient`/`setRowStorageReady`; the shared ingredient-options getters
  `getAmountOptions`/`getQuantityOptions`/`getPrepOptions` + `normalizeIngredientOptions`;
  meal-plan pending-selection get/clear closures; the **shared scan seam**
  (`prepareScanImage`, `retainScanImageEdits`, `renderScanImagePreviews`, `applyScanImageAction`,
  `imageElementFromFile`, `fileToDataUrl`); the **meal-plan bridge** (`recipeForSlot`,
  `plannedServingsForEntry`, `mealEntryValue`, `displayMealName`, `renderPlanner`,
  `updateMealPlannedServingsFromContext`, `removeRecipeFromMealSlots`, the recipe/ingredient
  pickers); **health** (`dailyDozenRecipeSuggestions`, `dailyDozenCategoryName`,
  `openDailyDozenPage`); groceries (`formatGroceryAmount`, `groceryAmountToNumber`,
  `renderGroceries`); Supabase primitives; restore helpers (`tryPreChangeBackup`, …);
  `activateEatShell`, `setPageTitle`, `keepScreenOn`/`allowScreenOff`, `makeSortable` (imported).
- **`createId` + `normalize` are module-scope copies** (not injected).
- **Cross-domain OUT (other code depends on these — keep stable):** the interface exposes
  `activeRecipes`/`trashedRecipes`/`openRecipeView`/`openRecipeDialog`/`saveRecipeRow`/
  `renderRecipes`/`renderFolders`/`scaleIngredientAmount`/`normalizeIngredients`/the boot
  normalizers to **meal-plan** (pickers, auto-generate, slot resolution, import-to-slot) and
  the restore machinery; `saveRecipeRow` is called by meal-plan's `importMealPlanRecipeDirect`.
  `onRecipeViewDialogClose` is wired by bindEvents. Don't rename these without updating callers.
- **No UI test coverage:** the recipe/cook tests cover pure logic only, not `recipes-ui.js`
  render/handlers. Verify UI changes by hand and say so.

## ⚠️ Landmines / do-not-touch
- **The restore/backup machinery STAYS in app.js and is NOT in this module:**
  `mergeMissingRecipesFromBackup` (a general restore orchestrator — recipes + published weeks
  + calendars + settings + tasks), `isMissingRestoreRecipe`, `normalizeRestoreFolder`. Never
  move that into `recipes-ui.js`; it gets recipe accessors injected. If a change seems to need
  it, flag it.
- **The `eat` shell + section are shared** with meal-plan. The eat shell (`activateEatShell`)
  stays glue in app.js; don't split it. Don't touch meal-plan internals — call the injected bridge.
- **Ingredient-options + the scan seam are shared** (groceries/finance/article). Don't fold them
  into recipes; use the injected versions.
- **Known latent bug, preserved (do NOT "fix" silently):** `readableDuration` is referenced by
  `parseJsonLd` but is undefined in the client (only exists in server.js) — it throws only if a
  recipe-import JSON-LD ISO-8601 duration path runs. Left as-is per the structural-move rule;
  flag if you intend to address it.

## Out of scope — flag, don't touch silently
`app.js` is ONE shared file. Keep edits inside Recipes. Changes to shared infra — auth/session,
state+sync scaffolding (`STATE_SECTIONS`, `mergeStates`, the boot normalizers, the restore
machinery), global nav / `activeAppArea`, the settings-dialog framework — must be **flagged in
your report with rationale, not made silently.** Don't edit meal-plan/groceries/other modules.

## Supabase caution
Backend = Supabase (project `noyocjcltrenwdovqrql`) + Netlify functions. **No short-cadence
polling.** Recipe-scan / import / AI-cleanup / nutrition-estimate calls go through a Netlify
function, never browser→vendor with a secret. The relational `eat_*` writes go through the
shared PostgREST primitives.

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
