# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **The spreadsheet in the Document page** (Google Sheets replacement) · PR #224 · new spreadsheets from the Document page's +; the in-house formula engine (~300 functions checked against Google Sheets' answers) in a calculation worker; live co-editing, offline, version history in R2 (migration `2026-11-09b-documents-sheet-versions.sql`, already applied 2026-11-09); filters and filter views, sorting, conditional formatting and data validation, charts, pivot tables, comments, Excel in/out, CSV, print / PDF, and Google Sheets in (the `gdocs` function's new `sheetMeta` / `sheetRows` actions, read-only Drive scope already granted). See SPREADSHEET_DESIGN.md §15–16.
  - Post-deploy, Claude (Luke's Chrome): make a spreadsheet, type formulas, add a chart, filter, sort, a pivot table; download as Excel and import it back; print preview; check the `gdocs` function's logs for errors.
  - Post-deploy, Claude (Luke's Chrome): bring over one of Luke's real Google Sheets, compare it tab by tab with Google, and close the ISSUES entry "Google Sheets import is tested only against answers shaped from the API docs".
  - Post-deploy, Luke (iPhone, next TestFlight build): open a spreadsheet, edit a few cells with the keyboard, tick a checkbox, and Print or save as PDF; edit the same spreadsheet with Marijane at the same time.
