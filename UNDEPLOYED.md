# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-10-15 (dock ticker, settings trim, page settings trim, Halloween purple + dark-mode mail)._

- **Cold start: theme and icon hold, ticker shows with the dock** · PR #119
  - Theme: the last theme is applied before first paint; the iPhone icon only changes once this person's prefs have loaded (no "icon changed" alert on launch).
  - Ticker: the last headlines (and recent finals) show with the dock; fresh ones replace them as soon as sign-in is confirmed, without waiting for the full state load.
  - Post-deploy: needs a TestFlight build (the iPhone app bundles the web code). On the phone, with Halloween on: fully close and reopen — no classic flash, no icon alert, ticker visible with the dock. The very first launch after updating can still open classic once (no saved theme yet), but without any icon alert.

- **Watch settings + sidebar, Mail Automation, News pull-to-refresh, Shop tidy** · PR #121 · Mail AI is now Mail → gear → Automation. Watch gear menu: Streaming Services (Sync-Settings-style rows, (i)) and Theaters (Google theater search that saves the website; + adds a typed name; no tabs/hint/URL box). Watch has a three-bar sidebar with Archive at the bottom. Calendar month title reads "October 2026". News: no gear/refresh by search, pull-to-refresh, Front page without Briefings or The Athletic. Shop: no Receipts/+ under the list; urgent toggle is a warning triangle. Verified: full suite, boot check, mail-frame check, `npm run qa:settings` (all), simulated pulls, mocked theater search, 360px screenshots. **Needs a deploy** for the theater search (new `google-places` actions) and the server-side Athletic filter. **After deploy/TestFlight:** Watch gear → Theaters, type a nearby theater, pick it, check Website ↗; News → pull down from the top; Mail gear → Automation.
