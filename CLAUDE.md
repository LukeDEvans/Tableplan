# Live App — Claude Instructions

## What this app is

**Live** (a.k.a. **"Tableplan"** / "Eat") is a single-page, **vanilla-ESM web app —
no framework**. Its entire UI and most logic live in one very large file,
**`app.js`** (~55k lines), backed by domain-specific helper **modules** at the repo
root (`finance-*.js`, `travel-*.js`, `music-*.js`, `media-*.js`, the `calendar/`
dir, etc.). It spans many domains in one app: **calendar/tasks · recipes /
meal-plan / groceries · finance · travel · health / nutrition · contacts · music &
media · mail · publications · weather**, and more.

Built with **Vite → `dist`**; shipped as a PWA and wrapped as a native iOS app via
Capacitor (see [CAPACITOR.md](CAPACITOR.md)). Backend is **Netlify Functions +
Supabase**. State is a per-user JSONB blob, sectioned and merged (not a relational
model, except recipes). See the domain map and parallel-development rules at the
bottom of this file.

## Backend & infrastructure (Supabase + Netlify)

- **Supabase** is the backend — Postgres + Auth + Storage. **Project ID:
  `noyocjcltrenwdovqrql`** (prod). App state lives in **`tableplan_states.state`**
  (one JSONB row per user/group, sectioned — see [ARCHITECTURE.md](ARCHITECTURE.md)
  §5). Recipes are the one relational domain (`eat_recipes` / `eat_folders`).
- **Netlify** hosts the site (prod: `effervescent-malabi-e0af55.netlify.app`) and
  the serverless functions. **All external API calls and secrets go through a
  Netlify Function** — never browser→vendor with a key (ARCHITECTURE §7).

### Supabase — hard-won cautions (read before writing any data-access code)

- **DO NOT poll Supabase tables aggressively.** A prior **egress blowout** was
  traced to a client **polling `tableplan_states` every 5–15 seconds**. Never add a
  `setInterval`/recursive-`setTimeout` loop that re-reads a Supabase table on a
  short cadence. Instead **throttle/debounce**, **cache** in memory/state, or use
  **Supabase Realtime subscriptions** (push, not poll). Any read loop against a
  Supabase table must be bounded and justified (ARCHITECTURE §8: bounded,
  idempotent, rate-limited, non-self-amplifying).
- **Beware unguarded effect/retry loops around auth.** An **auth request storm**
  was previously caused by an unguarded retry / `useEffect`-style loop re-running
  session/auth checks. When touching auth/session code, guard re-entry, **bound
  retries**, and pin effect dependencies so a session check can't re-trigger itself.
- **Don't trust infra status alone when debugging Supabase.** The Supabase
  `get_project` API can report **`ACTIVE_HEALTHY`** even while the dashboard shows
  billing / quota / egress problems. Cross-check the dashboard (usage, billing,
  logs) — a green API status is **not** proof the project is healthy.
- **Applying DB changes:** the bundled Supabase MCP has been unreliable here
  (crypto errors) and no DB password/PAT ships in the repo, so DDL/migrations and
  Storage RLS policies are applied via the **Supabase SQL editor** (or `migrations/`
  run there). Don't assume programmatic DDL access.

## Architecture

**Before making substantial architectural or cross-domain changes, read [ARCHITECTURE.md](ARCHITECTURE.md) and follow its conventions.** It is the governing architectural reference: system layers, module/data ownership, and the rules for state/sync, integrations, background jobs, AI tools, and adding new modules. When a project convention exists there, use it rather than inventing a new pattern.

## Working style

**Ask questions when you need further guidance.** If a request is ambiguous or a decision could go multiple ways that Luke would care about, ask rather than guessing.

## Development workflow & principles

The recommended flow for substantial work — and the conventions behind it — live in [DEVELOPMENT.md](DEVELOPMENT.md): `INTENT → SPEC → PLAN → IMPLEMENT → ADVERSARIAL REVIEW → FIX → VERIFY → SHIP`, plus the `/recap` loop for resuming long-running work. Core principles that govern every session:

- **Evidence beats assertion.** Distinguish observed fact, verified behavior, inferred behavior, assumption, and proposed change — and label which is which. **"Tests pass" is never proof the whole feature works**; say what you actually verified and how.
- **Decision boundaries.** Make ordinary implementation calls autonomously, but **stop and ask** when a choice materially affects architecture, data integrity, security, auth, secrets, production infra, DB migrations, deployment, destructive/irreversible operations, or major product behavior.
- **Audit ≠ implementation.** When asked for an audit or review, inspect → analyze → report → recommend. **Do not silently start fixing** unless implementation was explicitly authorized.
- **Verification is mandatory.** "Implementation complete" (code written) and "task verified" (evidence it behaves correctly) are different states — a finished task carries verification evidence.
- **Don't restart from zero.** When continuing work, run `/recap` first: inspect git state, artifacts, tests, and memory to establish what's actually done before assuming it isn't.

**Skills:** `/recap` (re-establish reality, read-only) and `/adversarial-review` (fresh subagent attacks a change before it ships). Durable project knowledge lives in `ARCHITECTURE.md` (the constitution) and the file-based memory (`~/.claude/projects/-Users-luke/memory/`) — prefer those over re-deriving context each session.

## UI conventions

**Toggle switches:** the house toggle is `<input type="checkbox" class="live-toggle">` — a 36×20 pill with sliding knob, defined in styles.css (search "House toggle switch"). Use it for every new on/off control instead of inventing a style. Beware the `.recipe-form label` grid rule: labels containing a toggle must be added to its `:not(...)` exclusion list or laid out with their own flex row.

## Mail AI features

Every AI email-processing feature MUST have an on/off toggle in Settings → Mail AI. To add one: (1) add an entry to the `MAIL_AI_FEATURES` registry in app.js (key, label, description) — the toggle UI renders automatically; (2) the server-side function must check its flag in `state.mailAiSettings.<key>` (config section, row `personal:config`) and do nothing when off. Features are off by default.

## Git / GitHub

**Local commits are welcome — commit freely as work completes.** Luke likes reviewing changes locally before they go out.

**Never `git push` without explicit permission — ask first, every time.** Pushing to main auto-triggers a Netlify deploy, which spends limited deploy credits (and GitHub pushes are capped ~20/month). Batch work into local commits, then when ready ask: "OK to push?" Never push automatically as part of a task.

**Before any push, run through [PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md)** — especially the mobile horizontal-fit pass (every page must lay out within a ~360px phone; no sideways scroll, nothing clipped at the right edge). Report anything that fails before pushing.

## Domains & parallel-agent development

This repo is set up for **parallel, multi-agent work** (Claude Code subagents and
cloud/web sessions) — one agent per domain. Per-domain subagents live in
[.claude/agents/](.claude/agents/). [ARCHITECTURE.md](ARCHITECTURE.md) §4 is the
source of truth for boundaries; this table maps the parallel-work domains to their
code. Read **Architecture Decisions** (below the table) before working calendar,
the recipes cluster (recipes / meal-plan / groceries / cook), or health.

| Domain | Dedicated modules | `app.js` area (`activeAppArea`) | Data home |
|---|---|---|---|
| **finance** | `finance-ui.js` (`createFinanceModule(deps)` — the whole finance UI: services, transactions + review deck, txn-receipts, budget/accounts/income, insights) + pure logic in `finance-actuals.js` / `finance-csv.js` / `finance-sync.js` / `finance-review-gesture.js`; `receipt-*.js` shared with Shop — `app.js` keeps only `showFinanceApp`. ⚠️ **sync/hydration gate stays in app.js** (see below) | `"finance"` | `tableplan_states` JSONB (`state.finance*`) — **Supabase-only, never localStorage**. **Cross-domain:** Calendar reads `financePaydaysInRange` + `formatFinMoney` (payday dots / bill display); state-sync calls `invalidateFinanceLabeled` |
| **calendar** | `calendar/` (`recurrence.js`, `model.js`, `projection.js`, `tasks-project.js`, `sources.js`, `reconcile.js`, `normalize.js`, `ics.mjs`) | `"plan"` (calendar) + `"do"` (Tasks) | `state.planEvents`; **`state.calendars` + `state.planCalendars` will be unified into one canonical list (`source: "linked" \| "ics"`) — see Architecture Decision #1** |
| **recipes** *(includes cook — Decision #2a)* | `recipes-ui.js` (`createRecipesModule(deps)` — recipe library/folders/tags, recipe view + editor, import/scan/parse, **cook** (active-cooking + cook log), recipe timer, AI cleanup, trash, recipe nutrition editor + AI estimate, and the **relational `eat_recipes`/`eat_folders` data layer**; ~227 fns) with 17 pure normalizers exported top-level (boot). `app.js` keeps meal-plan (see meal-plan row) + `showEatApp` nav + the restore/backup machinery. See **RECIPES_EXTRACTION.md**. | `"eat"` (recipes + cook — one shared `eat` shell via `activateEatShell`, kept as glue in `app.js`) | **relational** `eat_recipes`/`eat_folders` (direct PostgREST, not the JSONB-section pattern) **plus** JSONB `eat` section (`recipes, trashedRecipes, folders, recipeTags, activeCooking`, …). ⚠️ Shared/injected, NOT recipe-owned: `prepareScanImage` + scan seam (app-wide, also finance/groceries/article), ingredient-options (`prepOptions`/`openIngredientOptionsDialog`, shared with groceries), `supabaseBaseUrl`/`supabaseHeaders`/`deleteSupabaseRow`. **Cross-domain:** exposes `activeRecipes`/`openRecipeView`/`saveRecipeRow`/normalizers to meal-plan; `onRecipeViewDialogClose` wired by bindEvents. **Known latent bug (pre-existing, preserved): `readableDuration` is undefined in the client** — `parseJsonLd` throws only if an ISO-8601 duration path runs |
| **meal-plan** | `mealplan-ui.js` (`createMealplanModule(deps)` — the planner (render + meal-entry drag/drop + editing), auto-rules (UI + logic), meal-context, meal-plan settings, meal-plan recipe cards, restaurant seam, recipe/ingredient pickers, auto-generate, serving writeback; 236 fns) with 6 pure normalizers exported top-level (boot); + `meal-plan-servings.js`. **Instantiated LAST** (it's the hub — groceries/recipes get its bridge via thunks; it consumes their interfaces). `app.js` keeps `showEatApp` nav + the shared week/slot/plan-record infra (`weekState`/`weekKey`/`mealSlotsForWeek`/`slotEntries`/`recipeForSlot`/`groceryRecipeForSlot`/`createBlankWeek`/`currentWeek`/`startOfPrepWindow`, injected) + calendar readers + eat shell. See **MEALPLAN_EXTRACTION.md**. | `"eat"` (meal plan — same shared `eat` shell via `activateEatShell`) | JSONB `eat` section: `plans` (per-week records), `publishedWeeks`, `mealPlanConfig`, `autoGenerateRules`. ⚠️ each week record still carries a legacy `manualGroceries` field — **not** migrated (Decision #2b; the live grocery list is `state.persistentManualGroceries`). **Cross-domain:** creates Tasks via `addMakeAheadTaskForMealEntry`/`addPrepAheadTaskForMealEntry` (`"do"`); reads `state.planEvents` + synced calendars via injected readers (**dual list preserved — Decision #1 not applied**); owns the restaurant seam (consumes groceries' `groceryPlacesApiUrl`); ~17 shared mutable lets (`currentWeek`, `activePlannerDayId`, pending picker selections, drag state) stay in app.js via injected get/set accessors |
| **groceries** | `groceries-ui.js` (`createGroceriesModule(deps)` — shopping list, stores, pricing, receipts + receipt-scan, checklist, next-stop, pantry; 290 fns) with 24 pure normalizers exported top-level (boot-called by `defaultState`/`normalizeState`/`mergeStates`); + `grocery-catalog.js`, `grocery-sources.js`. `app.js` keeps `showShopApp`/`showInventoryApp` nav + the restaurant seam. See **GROCERIES_EXTRACTION.md**. | `"shop"` (a Shop space alongside `"checklist"`/`"inventory"`) | JSONB `grocery` section (`groceryStores, groceryBaseItems, persistentManualGroceries, receipts, groceryChecklist, pantry, priceHistory`, …). The live manual-grocery list is `state.persistentManualGroceries` (grocery-owned). ⚠️ legacy `week.manualGroceries` in meal-plan's `eat` record is **not** migrated (Decision #2b) — only a boot normalizer in app.js folds it in. **Cross-domain (all injected):** `inventoryItemList()` + `seedGroceryChecklistFromInventory` (inventory — see inventory row); exposes `groceryPlacesApiUrl`/`groceryPlacesRequestOptions` to **meal-plan's** restaurant seam (`selectRestaurantForMeal`); reads the shared week cursor (`weekKey`/`weekState`) + `buildGroceryItems` reads meal-plan slots + recipe ingredients; seam accessors for `shopSpace`, store-search location, and the receipt-scan draft |
| **cook** | *(folded into **recipes** / `recipes-ui.js` — not a separate module; Decision #2a)* | `"eat"` (part of the recipes view) | `state.activeCooking` + per-recipe `cookLog` (JSONB `eat` section) |
| **travel** | `travel-*.js` (geo, ingest, interpret, itinerary, mode, model, optimize, refs, transitions) | `"explore"` | `state.travel*` (canonical in `travel-model.js`) |
| **health** *(no health module yet)* | none — nutrition & Daily Dozen (`daily-dozen.js`, `nutrition-domain.js`, `nutrition-provider.js`) are **owned by the recipes cluster** (Decision #3); `food-health*.js` + the `"sweat"` exercise UI stay in `app.js` for now | `"sweat"` (exercise) | state sections |
| **contacts** | `contacts.js` (rendering, editing, groups, photo, vCard import/export, all contacts state) — `app.js` keeps only the `showContactsApp` nav entry + the injected module wiring | `"contacts"` | `state.contacts`, `state.contactGroups` (no canonical `people` model yet — §21) |
| **music** | `music-streaming.js`, `music-provider-*.js` (applemusic/internetarchive/jamendo), `music-canonical.js`, `music-library*.js`, `music-source-resolver.js`, `music-tags.js`, `media-provider-music.js` | `"media"` (music tab) | `state.musicLibrary`, `state.appleMusic`, media state |
| **weather** | `weather-ui.js` (service + page render/handlers + radar map) `createWeatherModule(deps)`; pure logic in `weather-cache.js` / `weather-condition.js` / `weather-art.js` — `app.js` keeps only `showWeatherApp` + the shared `ensureLeaflet` loader | `"weather"` | `state.weatherLocations`, `state.weatherActiveLocationId`. **Cross-domain:** `getCurrentConditions()` is consumed by Travel Mode; `ensureLeaflet` (Leaflet CDN loader) is shared with Travel Mode's map |
| **inventory** | `inventory-ui.js` (rooms/containers/items, weekly checklist, dialogs) `createInventoryModule(deps)` — `app.js` keeps only `showInventoryApp` + the grocery shopping-list ops | `"inventory"` (a Shop "space") | `state.inventoryBoxes`, `state.inventoryItems`, `state.inventoryRoomVisibility`. **Cross-domain (two-way, NOT isolated):** exposes `inventoryItemList()` (read by Groceries + Travel packing) and `renderInventoryPage()` (called by Shop's `setShopSpace`); injects `renderShopSpaceNav`/`renderGroceries` + the grocery `shoppingListHas`/`addToShoppingList`/`removeFromShoppingList` ops (kept on the grocery side, write `state.persistentManualGroceries`) |

**⚠️ The central constraint: `app.js` is ONE shared file.** Every domain's
rendering, event handlers, and state wiring live as *sections inside* `app.js` —
only the helper modules above are physically separate. So two agents on two domains
both edit `app.js` → **merge conflicts are the default failure mode.** Mitigations:
keep each domain's edits inside that domain's own `render*`/handler sections and its
dedicated modules; prefer moving logic *into* a domain module over growing `app.js`;
land small, frequent commits; and treat any `app.js` edit outside your domain's
sections as a shared-infra change (below).

### Architecture Decisions (recorded — do not re-litigate)

Decisions Luke has already made about upcoming extractions. Agents working these
domains **follow them and do not reopen the debate.** None are implemented yet —
they are direction for when the work starts.

**1. Calendar — unify the two calendar lists.**
`state.calendars` (linked / eat-side calendars) and `state.planCalendars`
(ICS-imported calendars) will be merged into a **single canonical list**, with a
field (e.g. `source: "linked" | "ics"`) distinguishing origin. **Prerequisite before
any calendar extraction or refactor begins:** map **every** read and write of both
`state.calendars` and `state.planCalendars` across `app.js` (and record them here or
in a linked doc) — the blast radius is large (`renderPlanPage()` alone has ~42 call
sites), so it must be visible up front, **not discovered mid-refactor.** Do **not**
start the unification opportunistically inside another change, and do not begin it
until that map exists.

**2. Recipes cluster — separate modules, not one domain.**
Recipes, meal-plan, and groceries are **separate modules** — not one "recipes"
domain with internal files — because they evolve independently in practice. Shared
behavior between them (meal-plan generating a grocery list; servings scaling) must be
**explicit injected interfaces between modules** — the same pattern as contacts'
`refreshPlanIfActive` hook — **never** direct cross-module reaches into another
module's internals. The single `recipes` subagent should be **split to match** (one
agent per module: recipes / meal-plan / groceries).

**✅ STATUS: this split is now COMPLETE (2026-09-14).** All four are extracted:
`recipes-ui.js` (+ cook), `mealplan-ui.js`, `groceries-ui.js` (+ `inventory-ui.js`). The
shared week/slot/plan-record infra + calendar readers + the `eat` shell stay in `app.js`
and are injected. The factories are instantiated in dependency order —
inventory → groceries → recipes → **meal-plan last** (it's the hub) — and forward
cross-module references are deferred via `(...a) => name(...a)` thunks to avoid TDZ at
module load. Extraction maps: RECIPES_EXTRACTION.md, MEALPLAN_EXTRACTION.md,
GROCERIES_EXTRACTION.md.

**⚠️ Boot-safety guard — do not bypass.** `test/architecture-boot-safety.test.js` runs on every
`npm test`/CI pass and fails (with the exact file:line) on the two module-load crashes this
extraction repeatedly shipped — neither of which the build or the rest of the suite can catch,
since nothing else executes `app.js`'s module body: **(a)** a top-level module `export` that
references an **injected-only** dep (it runs outside the factory, so the name is undefined) —
this is how `recomputeMealPlanLayout`'s `meals.length = 0` hung the app on "Checking sign-in"; and
**(b)** any code reachable from module-top-level statements or `loadState`/`normalizeState` that
calls a **factory-destructured const before its factory has run** (TDZ) — this is how a stray
top-level `migrateLegacyRecipeOrganization()` threw "Cannot access … before initialization"; and
**(c)** a **factory-body `let`/`const` whose initializer references a name that stayed in `app.js`**
(reachable only via an injected getter) — `let activeAutoRuleDayId = activePlannerDayId;` moved
verbatim into the meal-plan factory threw "activePlannerDayId is not defined" at instantiation
(init such vars from the injected getter/dep, not the bare name); and **(d)** a **factory-
instantiation dep passed immediately (shorthand `X,` or non-thunk `key: EXPR`) that names a
top-level `app.js` const/let declared further down the file** — the deps object is evaluated at
module-load, so `createMealplanModule({ …, PLAN_COLORS, … })` with `const PLAN_COLORS` declared
~22k lines later threw "Cannot access 'PLAN_COLORS' before initialization" at boot (fix: declare
the const **above** the factory instantiations, or inject it via a deferred getter thunk — guards
(b) and (d) treat `name: (...a) => name(...a)` / `getX: () => x` as safe *because* they defer). When
you extract or move a domain: keep boot-called normalizers/config as top-level exports **only if
they close over module scope** (else leave them in `app.js`), run any one-time migration/
cleanup **after** the factory instantiations, and declare any module const you inject into a
factory **above** the instantiations. Keep this test green; don't weaken or delete it. (An esbuild
bundle can't verify this — it hoists top-level `const`→`var`, hiding module-const TDZ; the faithful
check is a native-ESM import of the *unbundled* source, which these static guards stand in for.)

*Amended after RECIPES_SPLIT_MAP.md mapped the actual code (2026-09-13):*

- **(a) Cook is NOT a peer module — it folds into recipes as a feature.** Cook has no
  standalone nav area or surface: it renders inside the recipe-view template
  (`activeRecipeViewTemplate(recipe, cookingItem)`, `cookLogTemplate`) and shares the
  `pendingCookLogId` module var with the recipe form. Extracting it as a peer would
  force circular access into the recipe view. So it moves **with** recipes. There is no
  `cook.js`; the four-way agent split becomes **three** (recipes / meal-plan / groceries).
- **(b) Groceries ⇄ meal-plan share stored data, not just behavior — do NOT migrate it.**
  The `eat`-section per-week record carries a legacy `manualGroceries` field
  (`createBlankWeek()` puts it next to `slots`). **Decision: leave the storage exactly where
  it is** (finance-sync-gate principle — preserve structure, don't fix it mid-extraction).
  *Refined during the extraction (2026-09-13):* the closer read showed the **live**
  manual-grocery list Groceries reads/writes at runtime is `state.persistentManualGroceries`
  (in the **grocery** section, grocery-owned — reached through the injected `state`, no
  special accessor). The `eat`-record `week.manualGroceries` is a **legacy** field touched
  only by a boot normalizer (`normalizePersistentManualGroceries`, called from
  `normalizeState`) that folds it into `persistentManualGroceries`. So **no live getter/setter
  into meal-plan's record is needed**, and that boot normalizer **stays in app.js** as
  hydration glue (Decision #2c). `groceries-ui.js` never references `week.manualGroceries`.
  A future data-migration task can revisit relocating the legacy field; **out of scope** here.
- **(c) One shared `eat` shell + section stays as glue — it is not being split apart.**
  Recipes, meal-plan, and cook(-as-recipes-feature) all render within one shared shell
  (`activateEatShell()`) and store in one shared `eat` Supabase section. That shell/section
  stays as glue in `app.js` (or a shared injected utility); **each module owns its own
  render + logic, but the shell and the section themselves are not split** — mirroring how
  finance's UI moved into `finance-ui.js` while its sync/boot machinery stayed in `app.js`.
- **(d) Additional touchpoints found beyond the original assessment** (preserve as injected
  interfaces, per the no-direct-reach rule above): **Tasks/"do" seam** —
  `addMakeAheadTaskForMealEntry` / `addPrepAheadTaskForMealEntry` create `do` tasks from
  meal entries; **inventory seam** — `seedGroceryChecklistFromInventory` + the shared
  `shopSpace` value (already documented on the **inventory** row — cross-reference it, don't
  re-document); **restaurant seam** — `selectRestaurantForMeal` couples groceries'
  store-search to a meal slot.

**3. Nutrition / Daily Dozen — owned by recipes for now, behind a narrow interface.**
There is **no health/wellness domain today, and none planned soon.** Nutrition and
Daily Dozen tracking (`daily-dozen.js`, `nutrition-domain.js`,
`nutrition-provider.js`) **stay owned by the recipes cluster.** Keep them behind a
**small, narrow public interface** (a limited set of functions / data shapes), not
tangled into recipe internals — so a future health/wellness domain, if one is ever
built, can consume nutrition data through that interface **without re-extracting it.**
**Do not build any health-side abstraction now** — just keep the recipes-side
interface clean.

### Shared infrastructure — flag, don't silently change

Used by every domain; a change here can break another agent's page, so **surface
the intended change (with rationale) rather than editing silently** (ARCHITECTURE
§19): auth/session · state + sync (`STATE_SECTIONS`, `mergeStates`, tombstones,
`state-sync.js`, `finance-sync.js` deep-merge) · global nav / `activeAppArea`
routing · the shared boot/render scaffolding in `app.js` · notifications/push ·
media playback (`playback-engine.js`, `playback-coordinator.js`) · the media hub
(`media-*.js`) · the settings-dialog framework · design tokens (`styles.css`).

**Naming trap:** the root `music-*.js` files + the `"media"` music tab are the
**streaming-music** domain. The `music/` **directory** is a *different* subsystem —
piano-practice / score-following (Cadence). Don't conflate them.
