# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Listen: upcoming episodes from Apple + a series hold that works** · #271 · Server side is **already live** (migration `20261119160000 podcast_upcoming` applied; Edge Function `podcast-upcoming`; pg_cron 09:23 UTC). The app side (show panel "Coming …" rows, held-series card, the hold in every show, the old per-show switch removed) reaches the iPhone by TestFlight and the web app on the next deploy. Nothing shows until a series is in early access on Apple (PODCAST_UPCOMING_DESIGN.md §6). **After deploying:** Claude — in Luke's Chrome, open Listen › Podcasts › Shows, open The Rest Is History: no switch, no errors; check `podcastupcoming_status` (17 feeds, 0 failed). Luke (iPhone) — nothing to check until the next Rest Is History series; then its panel should list the coming parts and the released ones should stay out of Up Next.
- **News: team names from the real favorites; no Athletic team feed for Minnesota Morris** · #187 · Server only (`_news-rank.js`, `_news-feeds.js`); no TestFlight build. Ajax matches "Ajax" (not any "Amsterdam"); "Cougars" alone no longer pulls in BYU/Houston stories for Minnesota Morris; the two Athletic 404s each hour stop. **After deploying:** the next hourly `newsfeeds_status` has no `college-football/minnesota*` team feeds and no Athletic 404s.
- **Exercise: editable, sortable workout history** · #270 · client only (reaches the iPhone by TestFlight; the web app on the next deploy). Fixes History drawing the time/distance wheels over the list; tap an entry to edit (date, values) or delete it; sort by Date or the kind's measures (Cardio Time/Distance/Speed, Strength Sets done/Heaviest, Games Rating/Event). Post-deploy: Claude — in Luke's Chrome, open a Cardio workout → History → sort, edit an entry's date, confirm it moves. Luke (iPhone) — open Bike → History: list reads cleanly, tap an entry, change it, Save Changes.
- **The spreadsheet in the Document page** (Google Sheets replacement) · PR #224 · new spreadsheets from the Document page's +; the in-house formula engine (~300 functions checked against Google Sheets' answers) in a calculation worker; live co-editing, offline, version history in R2 (migration `2026-11-09b-documents-sheet-versions.sql`, already applied 2026-11-09); filters and filter views, sorting, conditional formatting and data validation, charts, pivot tables, comments, Excel in/out, CSV, print / PDF, and Google Sheets in (the `gdocs` function's new `sheetMeta` / `sheetRows` actions, read-only Drive scope already granted). See SPREADSHEET_DESIGN.md §15–16.
  - Post-deploy, Claude (Luke's Chrome): make a spreadsheet, type formulas, add a chart, filter, sort, a pivot table; download as Excel and import it back; print preview; check the `gdocs` function's logs for errors.
  - Post-deploy, Claude (Luke's Chrome): bring over one of Luke's real Google Sheets, compare it tab by tab with Google, and close the ISSUES entry "Google Sheets import is tested only against answers shaped from the API docs".
  - Post-deploy, Luke (iPhone, next TestFlight build): open a spreadsheet, edit a few cells with the keyboard, tick a checkbox, and Print or save as PDF; edit the same spreadsheet with Marijane at the same time.
