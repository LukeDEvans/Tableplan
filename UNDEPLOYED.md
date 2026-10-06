# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-10-03 #2 (PR #49)._

- **Weather (and other server features) in the iPhone app: real root cause** · PR #51 · In the app `canUseLocalBackend()` is true (`capacitor://localhost`), so URL helpers used local-dev `/api/<name>` paths that 404 on the live site — weather showed "outside NWS coverage"/"couldn't reach location search", and TMDB/showtimes/YouTube search, calendar ICS, travel time, booking/recipe/article scans, recipe import and nutrition estimate were hit the same way. The native fetch shim now maps them to the deployed functions (`nativeApiPath`, native-bridge.js). The app bundles its web code, so this ships to the phone **only via a TestFlight build**. Post-deploy (after the TestFlight build): the dock's weather slide shows local weather; Weather → search "Minneapolis" returns results; spot-check Watch search and a recipe import in the app.
- **News page** · PR #52 · New top-level News page (news-ui.js; spec NEWS_PAGE_DESIGN.md). It shows articles linked in NYT / Economist / Star Tribune / The Athletic emails, sorted by section, with a ⋯ menu (Send to Media, Open, Listen, Share, Hide) and a 3-day window. Only papers with a working subscriber sign-in are collected (status row `mailnewssubs_<user>`). Also: the Media bell is back to "coming soon"; Queue has one Publications tile; Sync Settings has a Star Tribune sign-in field; Home buttons are alphabetical. Server changes (gmail.js `newsFeed`/`updateNews`/`verifyNewsSignIns`, sweep gate) need the **Netlify deploy**; the iPhone app needs a **TestFlight build** too. Post-deploy: (1) **open News right away**: until the first sign-in check runs, the sweep collects nothing for News; (2) Sync Settings → re-save the Economist cookie and confirm the Economist doesn't show "Sign in again" (the Economist check is untested against the live site; ISSUES.md); (3) after the next NYT / Star Tribune email, confirm stories land in sensible sections. Unknown Star Tribune labels go to More.
- **News: every section via RSS + the news_articles table** · PR (this branch) · News takes every section feed of NYT / The Economist / Star Tribune / The Athletic hourly (`news-feeds`, :07), on top of email. Stories now live in the `news_articles` table instead of the `mailnews_` JSONB row (egress), and the page loads one view at a time. **Order matters:** (1) apply `migrations/2026-10-06-news-articles.sql` in the Supabase SQL editor **before** deploying (the page, the sweep and the feed job all use the table); (2) deploy; (3) open News once so the first sign-in check runs (the feed job only collects for signed-in papers); (4) after the next hour, read the `newsfeeds_status` row in `tableplan_states` and remove feed URLs that failed (_news-feeds.js FEEDS), especially the Star Tribune's; (5) check News shows stories across sections.
