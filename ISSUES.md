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
_(none)_
