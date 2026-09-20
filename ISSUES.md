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
_(none)_

## P2
- [ ] **[P2] Meal-plan "publish week" appears to be dead/unreachable code** (meal-plan · mealplan-ui.js:3931 · 2026-09-19)
      `toggleMealPlanView()` — the only function that sets `mealPlanView="published"` from a user action (clones slots, `archivePublishedWeek`, `persistImmediately`) — has **zero call sites** anywhere in the repo: no button, menu item, data-attr, or `addEventListener` binds it, and it's not in the mealplan factory's returned interface. The only other writes of `mealPlanView="published"` are the backup-restore path (`mergeMissingPublishedWeeksFromRestore`). Failure scenario: a user cannot publish a meal-plan week at all (the feature is inert). Likely regression: the trigger was probably dropped during the mealplan-ui.js extraction. Suggested: confirm whether publish is intended to still exist; if so, re-wire a trigger (a planner page-actions button, next to Recipe Book / Groceries / Nutrition / Auto-fill) → `toggleMealPlanView`. Verdict: CONFIRMED (dead code); PLAUSIBLE that it's an unintended regression vs a deliberate removal.

## P3
- [x] **[P3] Finance right-click menus are already fully touch-reachable — no kebab-menu work needed** (finance · finance-ui.js:2269,2967,3778,3846 · 2026-09-20)
      The finance UX overhaul's design proposal flagged `showFinAcctMenu`/`showFinTxnMenu` (contextmenu-only) as a real "unreachable on touch" gap. Re-checking before building a touch affordance for them found every single menu item already has an existing, always-visible touch button doing the identical action: account "Edit"/"Delete" → the ✎ pencil on `finAcctRow` expands the same inline editor with the same "Delete account" button (finance-ui.js:2279,2334); owner/sub-label "Add"/"Rename"/"Delete" → the always-visible `.fin-label-btn` row in `ownerBlocks` dispatches the identical `data-fin-action` values (finance-ui.js:2348-2350,2358-2359 vs 3780-3787); transaction "Rename"/"Edit"/"Delete" → tapping a transaction row already opens `fin-txn-detail`, which has the identical ✎/🗑 buttons (finance-ui.js:3078-3081 vs 3771-3774). Verified live (both tabs render the visible buttons, not just by reading). The right-click menus are a redundant power-user shortcut layered on top of already-complete touch paths, not the only way in. No kebab-menu increment was built. Left checked off since this is a closed finding, not an open todo — kept for history in case the "touch-reachable" gap gets re-flagged later without this context.
