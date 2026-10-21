# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Business calendar: only its own events** · #154 · **Netlify deploy + TestFlight build** (client-only). The Business calendar no longer shows Bills, Meal Plan, Exercise, Tasks or Birthdays (entries the Calendar adds from other pages), and its sidebar drops their switches. Personal and Household unchanged. No migration, no new env vars.
  Post-deploy:
  1. Business calendar: empty (nothing added there yet); sidebar has no Meal Plan / Exercise / Tasks / Birthdays / Bills rows.
  2. Personal calendar: Bills and the rest still show as before.
- **Watch redraws when the view changes** · #154 · same deploy. Switching views from Watch (or any change merged from another device) now redraws the Watch list; it used to keep the previous view's list until you left the page.
  Post-deploy:
  1. On Watch in Personal, open the page menu, swipe to Household, tap Watch: the list is Household's (empty today), not yours.
