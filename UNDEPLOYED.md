# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Exercise: editable, sortable workout history** · #270 · client only (reaches the iPhone by TestFlight; the web app on the next deploy). Fixes History drawing the time/distance wheels over the list; tap an entry to edit (date, values) or delete it; sort by Date or the kind's measures (Cardio Time/Distance/Speed, Strength Sets done/Heaviest, Games Rating/Event). Post-deploy: Claude — in Luke's Chrome, open a Cardio workout → History → sort, edit an entry's date, confirm it moves. Luke (iPhone) — open Bike → History: list reads cleanly, tap an entry, change it, Save Changes.
