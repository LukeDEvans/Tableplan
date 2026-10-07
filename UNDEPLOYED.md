# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-10-07 (PRs #59–#70)._

- **Meal plan: events land on the meal they take up; Events & Notes open by default** · PR #72
  - A "Meal Plan" event shows whichever Calendar view (household / personal) is open; events show
    only on the meals they take up (8–4 workday → Lunch; evening / overnight shift → Dinner);
    Events & Notes cards start open; on a phone, dragging one person's meal onto another's shows
    only that meal's column.
  - **After deploy:** on the phone, open Meal Plan on a workday and check "Work 8a–4p" is under
    Lunch only, with the Calendar on each of its two views. Merge two people's lunch by dragging
    (a real finger drag was not tested) and check only the Lunch cards show during the drag.
