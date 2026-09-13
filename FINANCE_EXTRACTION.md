# Finance extraction map (Commit 0)

The safety net for the staged extraction of the Finance domain from `app.js` into
`finance-ui.js`, mirroring the `contacts.js` / `weather-ui.js` / `inventory-ui.js`
pattern (dependency-injected `createFinanceModule(deps)`; nav glue stays in app.js).

**Scope of this pass:** the embedded Finance **UI / render / handler glue** only
(~4,200 lines, scattered across several regions). The pure logic modules and the
sync/hydration machinery are **left untouched**. **Receipts are deferred entirely**
(option c) — no receipt code moves, no finance/shop receipt boundary is decided.

Line numbers are as of Commit 0 and will drift as commits land; treat them as
anchors to re-locate, not fixed addresses.

---

## 1. Pure logic modules — STAY AS-IS (imported, never edited)

Already extracted + tested; `finance-ui.js` imports what it needs, app.js keeps its
own imports for the sync machinery:

| Module | Exports used | Tests |
|---|---|---|
| `finance-actuals.js` | `financeMonthsToSnapshot`, `financeOffsettingPairIds` | `finance-actuals.test.js` |
| `finance-csv.js` | `parseCsvRows`, `aggregateCsvBackfill` (CSV import/export) | `finance-csv.test.js` |
| `finance-review-gesture.js` | `reviewGestureAxis`, `reviewGestureAction`, `REVIEW_GESTURE` | `finance-review-gesture.test.js` |
| `finance-sync.js` | `mergeFinanceBudgetGroups`, `mergeFinancePeople`, `mergeFinancePersonal`, `dedupeFinanceRecurring`, `guardBootEmptyFinance` | `finance-sync.test.js` |
| `receipt-domain.js`, `receipt-scan.js` | receipt scan/parse seam (shared with Shop) | `receipt-*.test.js` (4) |

---

## 2. ⛔ LOAD-BEARING SYNC / HYDRATION MACHINERY — DO NOT MOVE

All of this lives in the **shared state-sync / boot code**, NOT in the finance UI.
It is the guard against the recurring budget-category wipe. **Relocate nothing here;**
it stays byte-for-byte in app.js. The finance module never touches it.

| What | Line(s) | Role |
|---|---|---|
| `financeSectionHydrated` flag | `let` @6972; read @2861, 7008, 7010, 7016, 7018, 7027, **7526** | gate: boot-empty finance must not overwrite the cloud copy, and finance is skipped in push until hydrated |
| `guardBootEmptyFinance(...)` calls | 7008, 7016 (+ `@import` 27) | the boot-empty guard, in the loadState/write path |
| `mergeStates` finance deep-merge | 6653–6660 (`dedupeFinanceRecurring`, `mergeFinanceBudgetGroups/People/Personal`) | union-by-id + nested child-array union in the cross-device merge |
| account-status `financeHydrated` | 2861 | surfaced in the account/status object |
| account-reset residue note | 3652 | clears the flag on account switch |
| `dedupeFinanceRecurring` in `defaultState` | 4612 | boot normalization of `financeRecurring` |

**tp_protect_finance_merge** is the **Postgres trigger** (DB-side, empty-never-erases
LIVE) that backs the same invariant — there is no app.js code to move; nothing about
it changes.

> If anything below turns out to touch this machinery, leave it in place and flag it
> rather than moving it.

---

## 3. Finance UI regions to extract (this pass)

Classified from a full `function` inventory. `showFinanceApp` (the nav/router entry)
**stays in app.js** like every other `show*App`.

| Region | Lines | ~fns | Contents | Commit |
|---|---|---|---|---|
| **A. defaults + normalizers** | 5294–5595 | 20 | `defaultFinanceBudgetGroups`, `normalizeFinance{LineItems,People,BudgetGroups,Accounts,Goals,SubLabels,Personal,TxnReceipts}`, pure helpers (`financeDebtPayoff`, `financeAccountKind/Balance`, `financeSumBy*`, `retirementTargetMultiple`), CSV entrypoints (`exportFinanceCsv`, `financeImportCsvBackfill`, `startFinanceCsvImport`) | 1 (normalizers as top-level exports, createId threaded) |
| **B. nav + services** | 8320–8695 | ~18 | `showFinanceApp` **(STAYS)**; month nav (`financeCurrentMonthKey`, `navigateFinanceMonth`); Supabase/Netlify data layer (`loadFinanceHistory`, `checkFinanceLinkStatus`, `refreshFinanceLive`, `linkFinanceBanks`); merchant/label logic (`financeMerchant*`, `financeSuggestedNote`, `financeTxnRuleGuess`, `financeLabeledTxns`, `invalidateFinanceLabeled`) | 2 (services), showFinanceApp stays |
| **C. main block** | 8691–10406 | ~98 | the core: txn form/edit/split/label/link, the **review deck** (`renderFinanceReviewDeck`, `financeReviewGroups`, `commit*ReviewCard*`), accounts (`financeAccountStatus/Health`, `renderFinanceAccountsPanel`), income/scenarios (`scenario*`, `financeIncomeTotal`), budget (`financeCategoryTotal`, `financeGroupTotal`, `financeExpensesTotal`), notifications/alerts, and `renderFinancePage` (10406) | 2/3/4 (split by sub-area) |
| **D. render/menus/grid** | 10410–~12360 | ~10 | tab render (`financeTabNav`), context menus (`showFinAcctMenu`, `showFinTxnMenu`), grid handlers (`onFinanceGridClick`, `onFinanceGridChange`), scope helpers | 3/4/5 |
| **E. month menu + settings** | 20229–20262, 21787 | 3 | `renderFinanceMonthMenu`, `jumpToFinanceMonth`, `refreshFinanceSettingsIfOpen` | 5 |

**State keys (the `finance` STATE_SECTION, app.js:336 — Supabase-only, never
localStorage):** `financePeople, financeBudgetGroups, financeAccounts,
financeAccountLabels, financeAccountSubLabels, financePersonal, financeTxnLabels,
financeTxnRules, financeMonthActuals, financeRecurring, financeMerchantNames,
financeTxnLinks, financeTxnSignFlips, financeTxnNoteOverrides, financeTxnNoteCounts,
financeManualTxns, financeEmergencyMonths, financeBirthYear, financeAnnualIncome,
financeCashAccountIds, financeEmergencyAccountIds, financeRetirementAccountIds,
financeDismissedAlerts, financeLabelSkips, financeLabelSnoozes, financeNotifDismissed,
financeTxnConfirmed, financeGoals, financeTxnReceipts`. Plus `financeAlertPrefs`
(config section). **Confirmed: no `localStorage.setItem(...financ...)` anywhere.**

Module-level finance vars that move into the factory closure: `financeTab` (8462),
`financeExpanded`, `financeLabeledCache`, `financeLive` (8342), `financeLinkStatus`,
etc. (finalized per-commit).

---

## 4. ⏸ RECEIPTS — DEFERRED (option c): stay in app.js, injected where finance calls them

Two distinct receipt subsystems; **neither is touched this pass.**

- **Finance txn-receipts** (attach/scan a receipt image to a transaction) — embedded
  in the finance regions and **finance-only** (verified: not called by Shop):
  `loadFinanceReceipts` (8368), `financeReceiptForTxn` (8376), and the consecutive
  cluster `startScanReceiptForTxn` (9763) → `scanReceiptIntoSplit` → `uploadReceiptImage`
  → `getReceiptImageUrl` → `deleteReceiptImage` → `viewReceiptImage` → `financeBatchMatchTxn`
  → `financeBatchScanReceipts` (~9920). **CORRECTION (decided after Commit 0):** because
  they are finance-owned with no shop boundary to protect, these **MOVE into
  `finance-ui.js` like any other finance code — they are NOT injected and do NOT stay
  behind.** They land in **Commit 3 (Transactions UI)**, since they are part of the
  transaction detail/split/scan flow. They will import the shared `receipt-scan.js` /
  `receipt-domain.js` modules and use injected Storage/scan helpers
  (`prepareScanImage`, `callNetlifyFunction`, the Supabase client) — those seams stay
  shared, but the finance receipt *functions* belong to finance.
- **Shop receipts** (grocery receipt scanning) — a separate, Shop-owned cluster at
  24239–24728 (`openShopReceiptsDialog`, `openReceiptScanDialog`, `saveReviewedReceipt`,
  `renderReceiptPriceTrends`, …), plus `renderShopReceipts` (31134), `receiptSignature`/
  `missingRestoreReceipts` (26623–26640), `renameReceiptPriceHistory` (25180). **Not
  finance UI; untouched.**

They use the shared `receipt-scan.js` / `document-scan` seam + the private
`receipt-attachments` Supabase Storage bucket. The finance/shop receipt boundary is a
**separate future task**.

---

## 5. Cross-domain touchpoints (the full pass)

**INBOUND — external code that calls a finance function (→ must be exposed by the module):**
- `render()` (8115) → `if (activeAppArea === "finance") renderFinancePage()` (8147) — the
  boot/render dispatch. → **`renderFinancePage` exposed** (destructure above `render()`, TDZ-safe).
- `renderContextSettingsDialog(...)` (21899) → `renderFinancePage()` (21979, 22053) — the
  settings dialog re-renders finance when a finance setting changes. → same exposed const.

**INBOUND — Calendar reads a finance compute fn (found during Commit-2 prep — the map's
"no other domain calls finance" was incomplete):**
- `paydaysByDate()` (Calendar, ~39159) → `financePaydaysInRange(startKey, endKey)` — the
  calendar's read-only "payday dots" read finance's payday schedule. → `financePaydaysInRange`
  must be exposed by the module (destructured const; calendar calls it after boot, TDZ-safe).
- `applyStoredState()` (state-sync, ~7163) → `invalidateFinanceLabeled()` — a cloud state
  replacement nudges the finance labeled-txn cache. → `invalidateFinanceLabeled` exposed too.

**INBOUND — external reads of finance STATE (shared `state`, NOT a UI touchpoint — no injection needed):**
- `STATE_SECTIONS.finance` (336) + `defaultState` (4426+) + `mergeStates` (6653–6660) reference
  the finance state keys — that's state config + the sync machinery (§2), not the UI.
- No other **domain** (travel/shop/AI/calendar) calls a finance UI function or reaches into
  finance internals; they only ever read `state.finance*` via the shared state object.

**OUTBOUND — finance calling into other domains: NONE FOUND.** The primary finance regions
do not call `renderPlanPage` / `renderTravel*` / `renderGroceries` / `renderShopSpaceNav` /
`scanDocument` / other-domain state. Finance is outbound-clean (unlike Inventory's two-way
grocery coupling). The only cross-cutting calls are to the **deferred receipt** functions (§4)
and to **shared shell helpers** (deps, §6).

**FALSE POSITIVES — cleared:**
- `renderTravelBudget` (54129) — **Travel**, not finance (matched on "budget").
- `renderPlanPage()` @12358 — inside `showPlanApp` (**Calendar** nav entry), not a finance
  call. **Cleared** (this was the one flagged in the pre-extraction assessment).
- Shop receipts (24239+), `renderShopReceipts`, price-history — **Shop**, deferred (§4).

---

## 6. Injected-deps contract (`createFinanceModule(deps)`)

Finalized per-commit, but the expected set:

- **Shell primitives:** `state`, `elements`, `persist`, `createId`, `escapeHtml`,
  `recordDeletion`, `showMailToast`, `getActiveAppArea` (for the `activeAppArea === "finance"`
  guards inside moved code).
- **Backend / shared services:** `callNetlifyFunction` (finance is Supabase/Netlify-backed —
  bank link, live refresh, history/receipts load), `trackUsage` (API-usage metering),
  `dateKeyFromDate` (shared date helper), `prepareScanImage`/`fileToDataUrl` (only if a moved
  fn needs them; most are on the deferred receipt side).
- **Finance txn-receipt fns MOVE into the module (Commit 3, §4)** — not injected. They
  import `receipt-scan.js` / `receipt-domain.js` and use the injected scan/Storage helpers
  (`prepareScanImage`, `callNetlifyFunction`, Supabase client). Only **Shop** receipts
  (24239+) stay in app.js this pass.
- **Imported directly by `finance-ui.js`** (not injected): the finance logic-module exports
  (`finance-actuals`, `finance-csv`, `finance-review-gesture`, and `dedupeFinanceRecurring`
  from `finance-sync`), plus `makeSortable` if the finance grid uses it.
- **Nav helpers** (`hideAllPages`, `isPageEnabled`, `setPageTitle`, `setPageHash`,
  `closeAppMenu`, `closePageTitleMenu`, `showHomeApp`, `setWeekToolsMode`, `setPageNotifCount`)
  are used **only by `showFinanceApp`, which stays in app.js** — so they are NOT module deps.

---

## 7. Staged commit sequence (stop for review after each)

- **Commit 0** — this map. *(review before Commit 1)*
- **Commit 1** — scaffold `finance-ui.js` + move Region A normalizers/defaults as pure
  top-level exports (createId threaded; wired into `defaultState`). Small, low-risk.
- **Commit 2** — core finance services + non-render state helpers (Region B services + the
  data/compute helpers from Region C: labels/rules/merchant, income/scenarios, budget/account
  math). Receipt fns injected, not moved.
- **Commit 3** — Transactions tab UI (form/edit/split/label/link + the review deck) **+
  the finance txn-receipt subsystem** (`loadFinanceReceipts`, `financeReceiptForTxn`, and
  the `startScanReceiptForTxn`…`financeBatchScanReceipts` scan/upload/view cluster) — all
  moved into `finance-ui.js`, not injected. Shop receipts (24239+) untouched.
- **Commit 4** — Budget + Accounts tabs UI (`renderFinanceAccountsPanel`, budget rendering,
  goals/net-worth).
- **Commit 5** — Insights/Reports + month nav + settings glue + `renderFinancePage` +
  the grid handlers/menus; finalize the factory + destructure above `render()`.

Each commit: `npm run build` + full `vitest` green before the next. **Never push.**

## 8. Test coverage note

Finance has **8 test files** (`finance-actuals`, `finance-csv`, `finance-review-gesture`,
`finance-sync`, and 4 `receipt-*`). They cover the **pure logic modules only** — none import
app.js or exercise the embedded UI/render/handler glue being moved. So each commit is verified
by "it builds + the full suite stays green"; the moved **UI** remains unverified beyond that and
needs a manual click-through before it's trusted at runtime.
