# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Dutch card picture** — the Leisure page's Dutch hobby card shows the windmill picture (`activity-dutch.png`) instead of the translate icon · PR (this one) · none; web only, and the iPhone picks it up with the next TestFlight build.

- **Household Listen and Watch reset** — one-time row reset marker (`views.js` `applyRowReset`) so the emptied Household Listen and Watch rows can't be merged back from a device's old copy · PR (this one) · **post-deploy, in this order:** (1) TestFlight build too (the phone bundles the code); (2) reload every open web tab (laptop Chrome, laptop app, Marijane's browser); (3) write the reset rows (Luke OK'd "start empty", 2026-10-28) with `execute_sql` — see the SQL in the PR description; (4) next day, check both rows are still empty and still carry the marker.
