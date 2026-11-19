# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **News: team names from the real favorites; no Athletic team feed for Minnesota Morris** · #187 · Server only (`_news-rank.js`, `_news-feeds.js`); no TestFlight build. Ajax matches "Ajax" (not any "Amsterdam"); "Cougars" alone no longer pulls in BYU/Houston stories for Minnesota Morris; the two Athletic 404s each hour stop. **After deploying:** the next hourly `newsfeeds_status` has no `college-football/minnesota*` team feeds and no Athletic 404s.
- **Exercise: editable, sortable workout history** · #270 · client only (reaches the iPhone by TestFlight; the web app on the next deploy). Fixes History drawing the time/distance wheels over the list; tap an entry to edit (date, values) or delete it; sort by Date or the kind's measures (Cardio Time/Distance/Speed, Strength Sets done/Heaviest, Games Rating/Event). Post-deploy: Claude — in Luke's Chrome, open a Cardio workout → History → sort, edit an entry's date, confirm it moves. Luke (iPhone) — open Bike → History: list reads cleanly, tap an entry, change it, Save Changes.
