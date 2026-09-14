# Groceries Extraction — Pre-Check Plan (STOP-and-confirm before any code)

**Target:** move the Groceries domain out of `app.js` into `groceries-ui.js` as
`createGroceriesModule(deps)`, following the finance whole-module pattern (approach A —
one contiguous *scope*, assembled from several non-contiguous regions), nav glue staying
in `app.js`.

**Status:** planning only. No code written yet. `app.js` untouched. This doc is the
review artifact requested before implementation. **One correction to the CLAUDE.md
amendment surfaced during this pass — see §3; it needs your call.**

Prereqs read: RECIPES_SPLIT_MAP.md, CLAUDE.md Decision #2 (amended), the inventory row.

---

## 1. Groceries code — functions/regions to move

Grocery code is **NOT one contiguous range** — it's four clusters (matching the map):
scattered normalizers up top, two big mid-file blocks, the shop-page render at ~36.9k,
and the chat-context helper at ~52.4k. Assembled whole-module move, like finance's R1–R4.

### Region G1 — normalizers / merge / defaults (scattered, ~5647–6193, +6382/6632)
`defaultGroceryBaseItems` [5667], `ensureGroceryCatalog` [5674], `normalizeGroceryBaseItems`
[5683], `groceryBaseItems` [5697], `defaultGroceryDailyDozenTags`/`normalize…`/`groceryDailyDozenTags`
[5824–5832], `normalizeGrocerySplitPreferences`/`grocerySplitPreferences` [5864–5878],
`normalizeGroceryAliases`/`groceryAliases` [5879–5903], `normalizeGroceryStores` [5904],
`defaultGroceryStoreSections`/`normalizeGroceryStoreSections` [5936–5945],
`normalizeGroceryChecklist` [5981], `groceryStores` [6003], `normalizeGroceryItemLocations`/`groceryItemLocations`
[6008–6031], `normalizeGroceryStoreItemSections`/`groceryStoreItemSections` [6036–6054],
`normalizeGroceryPriceObservations` [6118], `normalizeGroceryPricingSettings`/`groceryPriceObservations`/`groceryPricingSettings`/`currentGroceryPriceObservations`
[6150–6227], **`normalizePersistentManualGroceries` [5966]** (⚠ see §3),
`mergeGroceryStoreItemSections` [6632]. *Pure normalizers export top-level (finance pattern);
`state.*` merge helpers that live inside `mergeStates` stay put — see §3/§6.*

### Region G2 — stores / pricing / receipts / library dialogs (~19030–20993)
`openGroceryStoresDialog` [19030] → `renderGroceryStoreSettings`, store drag-order
[19089–19153], `addGroceryStore` [19154], store-search + geocode [19174–19387],
`groceryPlacesApiUrl`/`groceryPlacesRequestOptions` [19559–19580] (⚠ Places helpers, also used
by restaurant seam — §4), `openGroceryStoreMenu`/`editGroceryStore`/layout editor
[19581–19807], pricing dialog [19808–19903], `openShopReceiptsDialog`/`closeShopReceiptsDialog`
[19904–19909], `openGroceryLibraryDialog` … `autoTagGroceryWithAI` [20433–20955],
`openIngredientOptionsDialog`/`populate…`/`saveIngredientOptions`/`resetIngredientOptions`
[20956–20992] (⚠ shared with recipes — §4).
**Excluded from G2 (stay in app.js — NOT grocery):** `selectRestaurantForMeal` [19496],
`clearMealRestaurant` [19534], `renderMealRestaurantArea` [19543] — see §4 boundary call.

### Region G3 — shop nav / store tabs / item rows / move / review / pantry (~25663–27358)
`renderShopSpaceNav` [25663], `setShopSpace` [25687], `syncGroceryFormForSpace` [25701],
`renderGroceryStoreTabs` [25727], `renderGroceries` [25773], routing/price-plan/optimize
[26009–26158], skip-store [26159–26191], `groceryStoreSections` [26192] + section resolvers
[26229–26299], `groceryItemTemplate` [26300], `openGroceryItemMenu` [26327], move-sheet
[26474–26596], week-override [26590–26717], merge/split learn [26718–26755],
`rekeyGroceryIdentityState` [26756], item drag/drop [26805–26945], week options/nav
[26946–27011], checked-key [27011], `addManualGroceryItem` [27015], next-stop [27042–27056],
week-override keys [27057–27076], `removeManualGroceryItem` [27077], `editGroceryItem`/`deleteGroceryItem`
[27087–27130], swipe [27131–27163], review flow [27164–27336], `renderPantry` [27337].

### Region G4 — build / aggregate / range / checklist (~29460, 29709–30589)
`addPantryItem` [29460], `buildGroceryItems` [29709] (⚠ reads meal-plan+recipe — §4),
`buildGroceryRows`/`buildRawGroceryRows`/`…ForRange` [29731–29825], range init/menus
[29826–30021], `grocerySuggestionItems` [30066], `manualGroceryItems` [30084],
`buildGroceryItemsWithManual`/`buildGroceryRowsWithManual` [30088–30103], checklist
[30104–30338], `plannedSkippedGroceryKeys` [30339], `manualGroceryRow`/`aggregateGroceryRows`
+ amount math [30380–30588]. *Excludes `mealPlanNutritionTotals` [30022] (nutrition, stays).*

### Region G5 — shop page render + shopping-list ops (36866–36890)
`shoppingListHas` [36866], `addToShoppingList` [36870], `removeFromShoppingList` [36877]
(these already appear on the inventory row as injected into inventory — keep them
grocery-side, expose them), `renderShopPage` [36885], `renderShopReceipts` [36890].

### Region G6 — chat context (52406)
`buildChatShopContext` [52406] (reads `state.persistentManualGroceries` + grocery rows).

**Rough size:** ~2,300–2,700 lines / ~95 functions.

---

## 2. Module-level `let`s Groceries reads/writes

### Groceries-owned (move into the module as private state)
`grocerySwipeGesture` [657], `pendingGroceryReview`/`pendingGroceryReviewItems` [736–737],
`selectedGroceryWeekKey` [740], `activeGroceryStoreTab` [741], `groceryRangeStart`/`groceryRangeEnd`
[745–746], `editingDailyDozenGroceryItem` [765], `draggedGroceryItem` [812], the
`groceryStoreSearch*` cluster [813–817], `draggedGroceryStoreId` [823], `activeGroceryStoreLayoutId`
[824], `draggedGroceryStoreSectionId` [826], `groceryMoveSheetEl`/`groceryMoveDragCleanup` [26471–26472],
`groceryMoveConfirmEl` [26596], `groceryAddNextStop` [27041], `groceryChecklistDialogEl` [30270].
*(All single-area; move cleanly.)*

### The 5 flagged cross-area `let`s — how Groceries touches each
| Var | Groceries' access | Verdict |
|---|---|---|
| **`shopSpace`** [744] | **read/write.** Grocery `renderShopSpaceNav`/`setShopSpace` read it and set it to `"shop"`/`"checklist"`/`"inventory"`; **but app.js nav also writes it** (`showInventoryApp` sets `"inventory"` [8176]; `showShopApp` resets `"inventory"→"shop"` [8197]). | **Stays a module `let` in app.js**; inject `getShopSpace()` + `setShopSpace(v)` (mirrors finance's `getActiveAppArea`). Not grocery-private because nav glue co-writes it. |
| **`currentWeek`** [598] | **read-only, indirect** — only via `weekKey()`/`weekState()` (which read `currentWeek`). No grocery code assigns `currentWeek`. | Inject `weekKey()`/`weekState()` (below); no direct `currentWeek` accessor needed. |
| **`prepOptions`** [168] | **read-only, indirect** — through `normalizeIngredientOptions`/`syncIngredientOptionGlobals` when the ingredient-options dialog saves. | Ingredient-options dialog is shared (§4); inject `openIngredientOptionsDialog`. No direct `prepOptions` accessor. |
| **`pendingCookLogId`** [1538] | **none.** | n/a — recipes/cook only. |
| **`recipeViewMealContext`** [752] | **none.** | n/a — recipes/meal-plan only. |

**Conclusion:** of the 5, Groceries genuinely touches only **`shopSpace`** (read/write, via
injected getter/setter) and **`currentWeek`** (read-only, indirect via `weekKey`/`weekState`).

---

## 3. `manualGroceries` accessor design — **correction to the amendment (needs your call)**

The map (and the CLAUDE.md Decision #2b amendment I just wrote per your instruction) said
grocery-list data (`manualGroceries`) is stored inside meal-plan's week record and Groceries
must reach it via an injected getter/setter. **A closer read shows the runtime reality is
different:**

- **The live manual-grocery list Groceries reads/writes at runtime is
  `state.persistentManualGroceries`** — a key in the **`grocery` section**, which Groceries
  owns. Every runtime path uses it: `manualGroceryItems` [30085], `addManualGroceryItem`
  [27028], `removeManualGroceryItem` [27078], `renameGroceryLibraryItem` [27097],
  `shoppingListHas`/`addToShoppingList`/`removeFromShoppingList` [36866–36884],
  `buildChatShopContext` [52407]. `state` is already an injected dep → **no special accessor
  needed for the live data.**
- **`week.manualGroceries` (inside `state.plans[week]`, the `eat` section) is a *legacy*
  field.** The only thing that reads it is the boot normalizer
  **`normalizePersistentManualGroceries(parsed)`** [5966], called once from `defaultState()`
  [4570], which folds any legacy `parsed.plans[*].manualGroceries` into
  `persistentManualGroceries`. It operates on the **raw parsed blob**, not live meal-plan
  state. The other `week.manualGroceries` sites [5544, 5565, 6491, 22828, 29487, 29499,
  29668] are meal-plan/recipe **normalize/merge/clone** functions that merely *preserve* the
  legacy field — none are grocery-UI runtime code.

**So the earlier "grocery reaches into meal-plan's live week record" model does not match the
code.** Groceries does not need a live getter/setter into `state.plans[week].manualGroceries`.

**Proposed design (my recommendation):**
- Live manual groceries → stay `state.persistentManualGroceries` (grocery-owned; `state`
  injected). **No accessor.**
- The legacy boot fold-in → **leave `normalizePersistentManualGroceries` in `app.js`** as part
  of the boot/hydration normalization glue (consistent with Decision #2c: "the shell/section
  boot machinery stays as glue"). Groceries-ui.js then **never references `week.manualGroceries`
  at all**, so there is nothing to migrate and no straddle in the moved code.
- **Net:** the `manualGroceries` storage stays exactly where it is (honoring Decision #2b's
  "do not migrate"), but the accessor turns out to be unnecessary because the entanglement is
  a boot-time normalizer, not a runtime reach.

**Your call (pick one) — this is the stop-and-confirm item:**
- **(A) Accept the above** — no accessor; `normalizePersistentManualGroceries` stays in app.js;
  I'll update the CLAUDE.md amendment wording to reflect the true mechanism. *(Recommended.)*
- **(B) Still define a formal accessor** — e.g. inject `readLegacyWeekManualGroceries()` and
  keep `normalizePersistentManualGroceries` in the module, for symmetry/future-proofing, even
  though runtime doesn't use it.
- **(C) Something else you specify.**

---

## 4. Touchpoints to other domains (active grep pass — beyond the map)

Preserve every one as an **injected function**, never a direct cross-module reach.

### Inventory seam (already documented on the inventory row — cross-reference, don't re-doc)
- `seedGroceryChecklistFromInventory` [30256] (grocery-owned) calls **`inventoryItemList()`**
  [30259, 30286]; `setShopSpace` [25692] calls **`renderInventoryPage()`**. Both already exist
  in app.js as injected consts from `_inventory` [1612]. → **inject `inventoryItemList` +
  `renderInventoryPage` into Groceries.**
- The `"inventory"` value of `shopSpace` is co-owned with inventory nav — handled by the
  `getShopSpace`/`setShopSpace` injection (§2).

### Restaurant / meal seam — **boundary decision (needs your call)**
`selectRestaurantForMeal` [19496], `clearMealRestaurant` [19534], `renderMealRestaurantArea`
[19543] sit physically in the grocery block but **write meal-plan slots** (`weekState`,
`mealEntryList`, `setMeal`, `specialMealSlotId`, `compactMealSlotEntries`) while using grocery's
Google **Places** helpers (`groceryPlacesApiUrl`/`groceryPlacesRequestOptions`) and a separate
`restaurantSearch*` let cluster. Genuinely straddles groceries ↔ meal-plan.
- **(A) Recommended:** leave the three restaurant functions + `restaurantSearch*` lets in
  `app.js` (they belong with meal editing), and **expose `groceryPlacesApiUrl` +
  `groceryPlacesRequestOptions` from the Groceries interface** so app.js's restaurant code calls
  them. One small outbound seam, mirrors finance exposing `formatFinMoney` to Calendar.
- **(B)** Treat the two Places helpers as shared infra, move them to app.js, inject into
  Groceries. (Reverse of A.)
- **(C)** Move the restaurant seam into Groceries too, injecting the meal-plan writers.

### Meal-plan + recipe reads inside `buildGroceryItems`/`buildRawGroceryRows` [29709/29735]
These grocery builders read meal-plan slots and recipe ingredients. Inject:
`mealSlotsForWeek`, `combinedMealSectionsForWeek`, `mealKeysForDay`, `slotEntries`,
`groceryRecipeForSlot`, `recipeForSlot`, `mealEntryList`, `prepDays`, plus recipe/ingredient
helpers `normalizeIngredients`, `scaledIngredientToText`, `scaleIngredientAmount`,
`ingredientToGroceryRow`, and the `LiveMealPlanServings` module (import directly). All
meal-plan/recipe code stays in app.js until those domains extract.

### Ingredient-options seam (shared recipes ↔ groceries)
`openIngredientOptionsDialog`/`saveIngredientOptions` + `prepOptions`/`normalizeIngredientOptions`
are shared. Recommendation: **keep ingredient-options in app.js** (leans recipes) and inject
`openIngredientOptionsDialog` if the grocery library links to it. Confirm during impl whether
`openGroceryLibraryDialog` actually opens it.

### Calendar / Tasks
No direct grocery→calendar or grocery→tasks calls found (those are meal-plan's). ✅

### Shared utilities to inject (finance-style)
`state`, `persist`, `createId`, `escapeHtml`, `normalize`, `callNetlifyFunction` (Places/AI),
`trackUsage`, `recordDeletion`, toast (`showMailToast`), date/format helpers (`dateKeyFromDate`,
`dateFromWeekKey`, `addDays`, `sameCalendarDate`, `formatWeekRange`, `formatShortDate`),
`setWeekToolsMode`, `weekKey`, `weekState`, `setPageNotifCount` (if used), `getShopSpace`/`setShopSpace`.
*(Exact list finalized against an esbuild parse during impl, exactly as finance was.)*

---

## 5. Contiguity verdict → move strategy

**Not contiguous** — six regions (G1–G6) interleaved with meal-plan/recipe code (restaurant
seam and `groceryRecipeForSlot`/`recipeForSlot` live in meal-plan territory; nutrition totals
sit in G4). This is **finance-class**: a **single whole-module commit** assembling the
grocery-owned regions, with clearly excluded neighbors (restaurant seam, nutrition totals,
ingredient-options) staying in app.js. **No sub-splitting into multiple commits** — one
`createGroceriesModule` move, verified by the same pre/post function inventory + no
drops/dupes/orphans check finance used. The excluded-neighbor list above is the thing to get
exactly right; the byte-move itself is mechanical (region slice by verified `^function`/`^}`
boundaries, `activeAppArea→getActiveAppArea()`-style transforms only).

---

## Decisions (confirmed 2026-09-13) + extraction result

**Confirmed:** §3 manualGroceries → **(A)** no accessor; `normalizePersistentManualGroceries`
stays in app.js; module uses `state.persistentManualGroceries`. §4 restaurant seam → **(A)**
`selectRestaurantForMeal`/`clearMealRestaurant`/`renderMealRestaurantArea` stay in app.js;
Groceries exposes `groceryPlacesApiUrl` + `groceryPlacesRequestOptions`. Full scope moved in
one commit (nothing deferred).

**What landed:**
- `groceries-ui.js` — `createGroceriesModule(deps)` with **290** grocery functions. **24 pure
  normalizers** are top-level `export`s (boot-called by `defaultState`/`normalizeState`/
  `mergeStates`); the other **266** live in the factory. `createId` + `normalize` are
  module-scope copies (standalone); `normalizeGroceryItemName` reads live state via a
  module-scope `_appState` the factory sets (null at boot → empty aliases, matching the old
  pre-hydration behavior). Constants `commonGroceryItems` + `groceryPriceProviders` moved in.
- **Injected deps (~50 fns + `state`/`elements`/`persist`/`meals`/`prepDays`):** the
  meal-plan/recipe bridge (`weekState`, `weekKey`, `mealSlotsForWeek`, `slotEntries`,
  `groceryRecipeForSlot`, `recipeForSlot`, `normalizeIngredients`, `scaledIngredientToText`,
  `scaleIngredientAmount`, …), inventory (`inventoryItemList`, `renderInventoryPage`), scan
  seam (`prepareScanImage`, `getScanContent`, …), `makeSortable`, `storeDirectionsUrl`,
  `dailyDozenItemKey`, plus getters `getActiveAppArea`/`getAuthSession` and the meal-plan
  pending-selection get/clear closures.
- **Seam accessors exposed** (state co-touched by app.js nav/settings/bindEvents): `getShopSpace`
  /`setShopSpaceValue` (nav writes the shop space); `get`/`setGroceryStoreSearchLocation` +
  `…LocationPromise` (settings `testLocationAccess` + restore write these); `get`/`setReceiptScanFiles`,
  `…ReceiptImageEdits`, `…PendingReceiptDraft` (bindEvents receipt-scan handlers). App.js call
  sites rewired to these.
- **Interface returned:** 80 factory functions app.js still calls + the 12 accessors; the 18
  boot-used pure normalizers are imported directly.
- `app.js`: **52,792 → 48,559 lines** (290 fns removed).

**Verification (structural move, no behavior change):**
- Function inventory diff: every one of the 290 moved fns appears **exactly once** in
  `groceries-ui.js`, **none** remain defined in `app.js`, **no duplicates**, **no functions
  lost**; only new symbol is `createGroceriesModule`.
- Static undefined-identifier scan of the module: no missing injected dep (surfaced +
  fixed `inventoryItemList`/`renderInventoryPage`/`makeSortable` mid-pass).
- No orphaned grocery call left in app.js; seam vars fully removed (no stale decls/bare refs).
- **`npm run build` passes; full suite 1444/1444 green.** ⚠️ No UI test coverage for grocery
  render/handlers — needs manual click-through (see the groceries subagent note).
