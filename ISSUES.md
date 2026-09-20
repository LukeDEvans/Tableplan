# ISSUES

Running log of problems found by the **reviewer** subagent (`.claude/agents/reviewer.md`)
and during work — recorded here instead of halting the main line of work. Fix and
check off (`[x]`) when addressed; delete when resolved and no longer useful as history.

Entry shape:
`- [ ] **[SEV] short title** (area · file:line · YYYY-MM-DD)` + what's wrong → failure
scenario → optional suggestion → Verdict. Severity: **P0** (data loss / boot hang /
security), **P1** (real bug / silent behavior change), **P2** (test gap / scope creep),
**P3** (nit / simplification).

---

## P0
_(none)_

## P1
- [ ] **[P1] Planned meal servings have no reachable UI at all — view or edit — during normal (unpublished) planning** (meal-plan · mealplan-ui.js:1536,2382,2433-2441 · 2026-09-20)
      Found automating mp-serving (the earlier QA skip's stated reason — "the editable control is in the meal-entry editor dialog" — turned out to be wrong; there is no such dialog). `[data-planned-servings]` is fully wired (querySelectorAll + change handler at line 1536, `updateMealPlannedServings()` at 3299, excluded from drag-start at 2545) and the scaling logic is fully implemented and unit-tested (`meal-plan-servings.js`/`.test.js`) — but **no template anywhere renders an element with that attribute.** The only place `plannedServings` is ever displayed is a read-only `<span class="meal-planned-servings">` (line 2382), and that's inside `mealEntryTemplate`'s `readOnly` branch, gated on `isPublishedMealPlanView(week)` — which can only be true via the backup-restore path, since `toggleMealPlanView` (the only live-UI writer of `mealPlanView="published"`, see the mp-publish entry below) has zero call sites. So during ordinary use, a recipe meal entry's normal (non-readOnly) template (line 2433-2441) shows only the recipe name + a delete button — **no servings display, no servings input, editable or otherwise** — and even the read-only span is itself unreachable outside a restored-from-backup week. The data model, the write path, and the grocery-scaling consumer of `plannedServings` all still work correctly (confirmed: mp-grocery's derivation scales correctly off the recipe's default servings) — only the UI to ever CHANGE it away from the default is gone. Likely the same mealplan-ui.js extraction regression window as mp-publish. Suggested: decide where this belongs in the entry UI (a stepper next to the recipe name in the normal template seems the natural spot) and re-wire `data-planned-servings` there. Verdict: CONFIRMED (dead/unreachable code), not fixed here (out of scope for the QA-fixture task that found it).



## P2
- [ ] **[P2] Finance review-deck swipe hint overlaps its action buttons on short mobile viewports** (finance · styles.css:21748 (`.fin-review-hint`) · 2026-09-20)
      `.fin-review-hint` is `position: absolute; bottom: 14px` regardless of the card's actual content height. Found while screenshotting the review-card/txn-detail unification at 360×740: a review card with enough content above it (e.g. the "N matching transactions" merchant-group banner, or a longer note/category state) pushes the Approve/Edit-details/Skip button row down far enough to visually collide with the "← skip / ↑ ↓ browse / approve →" hint text pinned to the bottom. `pointer-events: none` on the hint means it's not actually blocking clicks, so this is cosmetic, not a functional dead-end — but it reads as broken/cluttered on a real short phone screen. Pre-existing (unrelated to the unification's own changes — confirmed by reasoning through the CSS: the fixed bottom offset doesn't depend on facts-line content). Not fixed here (out of scope for this task); a real fix likely means giving `.fin-review-card-inner` a min-height/scroll accommodation or making the hint row part of normal flow below the actions instead of absolutely positioned. Verdict: CONFIRMED (screenshot in hand), not caused by this session's work.

- [ ] **[P2] Meal-plan "publish week" appears to be dead/unreachable code** (meal-plan · mealplan-ui.js:3931 · 2026-09-19)
      `toggleMealPlanView()` — the only function that sets `mealPlanView="published"` from a user action (clones slots, `archivePublishedWeek`, `persistImmediately`) — has **zero call sites** anywhere in the repo: no button, menu item, data-attr, or `addEventListener` binds it, and it's not in the mealplan factory's returned interface. The only other writes of `mealPlanView="published"` are the backup-restore path (`mergeMissingPublishedWeeksFromRestore`). Failure scenario: a user cannot publish a meal-plan week at all (the feature is inert). Likely regression: the trigger was probably dropped during the mealplan-ui.js extraction. Suggested: confirm whether publish is intended to still exist; if so, re-wire a trigger (a planner page-actions button, next to Recipe Book / Groceries / Nutrition / Auto-fill) → `toggleMealPlanView`. Verdict: CONFIRMED (dead code); PLAUSIBLE that it's an unintended regression vs a deliberate removal.

## P3
- [x] **[P3] Finance right-click menus are already fully touch-reachable — no kebab-menu work needed** (finance · finance-ui.js:2269,2967,3778,3846 · 2026-09-20)
      The finance UX overhaul's design proposal flagged `showFinAcctMenu`/`showFinTxnMenu` (contextmenu-only) as a real "unreachable on touch" gap. Re-checking before building a touch affordance for them found every single menu item already has an existing, always-visible touch button doing the identical action: account "Edit"/"Delete" → the ✎ pencil on `finAcctRow` expands the same inline editor with the same "Delete account" button (finance-ui.js:2279,2334); owner/sub-label "Add"/"Rename"/"Delete" → the always-visible `.fin-label-btn` row in `ownerBlocks` dispatches the identical `data-fin-action` values (finance-ui.js:2348-2350,2358-2359 vs 3780-3787); transaction "Rename"/"Edit"/"Delete" → tapping a transaction row already opens `fin-txn-detail`, which has the identical ✎/🗑 buttons (finance-ui.js:3078-3081 vs 3771-3774). Verified live (both tabs render the visible buttons, not just by reading). The right-click menus are a redundant power-user shortcut layered on top of already-complete touch paths, not the only way in. No kebab-menu increment was built. Left checked off since this is a closed finding, not an open todo — kept for history in case the "touch-reachable" gap gets re-flagged later without this context.
