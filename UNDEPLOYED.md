# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Newspaper sign-in: hint + honest status** — Sync Settings, the reader and the in-app sign-in sheet say to use email and password (Google sign-in doesn't work in the app); the phone's sign-in check now loads each paper's subscriber page even when a session cookie is there, so a leftover cookie no longer shows "Signed in"; a cut-off article while "Signed in" re-checks and says the sign-in may have expired · PR (this one) · **TestFlight build** (the sheet's hint is native; the rest is in the bundled web code). After it: News › Sync Settings on the phone should show The Economist's real state.

- **Dutch card picture** — the Leisure page's Dutch hobby card shows the windmill picture (`activity-dutch.png`) instead of the translate icon · PR (this one) · none; web only, and the iPhone picks it up with the next TestFlight build.

- **Household Listen and Watch reset** — one-time row reset marker (`views.js` `applyRowReset`) so the emptied Household Listen and Watch rows can't be merged back from a device's old copy · PR (this one) · **post-deploy, in this order:** (1) TestFlight build too (the phone bundles the code); (2) reload every open web tab (laptop Chrome, laptop app, Marijane's browser); (3) write the reset rows (Luke OK'd "start empty", 2026-10-28) with `execute_sql` — see the SQL in the PR description; (4) next day, check both rows are still empty and still carry the marker.

- **News titles** — stories show real headlines instead of the bit of newsletter text that was linked ("your most pressing questions" → the El Niño FAQ's headline); NYT live-blog "Here’s the latest." items read "Live: <blog>"; feed titles with inline markup keep all their words; the hourly job fixes weak titles in the last 3 days (NEWS_TITLES_DESIGN.md) · PR #191 · **Netlify deploy only** (server). After it: once the next hourly run has gone, read `newsfeeds_status` → `titles` (`pagesFound` says whether Netlify can read the papers' pages; `fixed` / `from` say what changed), and check the News Front page and the dock ticker for fragment titles.
