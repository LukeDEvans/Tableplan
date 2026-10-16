# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-10-15 (dock ticker, settings trim, page settings trim, Halloween purple + dark-mode mail)._

- **Scores: Conference League, league tables, full team schedules** · PR #120
  - UEFA Conference League added (on by default). League tables from the table button in the Scores bar, each league heading's **Table** link, or a game. Team pages list a team's whole season; soccer teams span every competition. Tables and team pages sit inside Scores with ‹ Back. New `scores` actions `standings` and `team` (CDN-cached, no Supabase). See SPORTS_SCORES_DESIGN.md.
  - **Never checked against live ESPN** (the preview fetch wasn't approved), so check first after deploy: open `/.netlify/functions/scores?action=standings&league=nhl` and confirm the season is 2026-27 with games played. Then `?action=standings&league=eredivisie` (qualification notes) and `?action=team&league=eredivisie&team=espn:139` (Ajax: Eredivisie and Conference League games, past and upcoming). If a table shows last season, see `espnSeason` in `_scores-espn.mjs`.
  - In the app: News → Sports → the table button: NFL by division, your teams highlighted. Tap Ajax in the Eredivisie table → its season. Tap a game → that day in Scores, ‹ Back returns. Needs a TestFlight build for the iPhone app.

- **Clear button on every text box** · PR #125 · Once you type into a text box, an x on a shaded circle at its right edge empties it (app-wide, automatic for new boxes; not textareas, passwords, numbers or dates; recipe/music/radio search keep their own). Client-only, no function changes. Post-deploy: needs a TestFlight build. On the phone, type in Shop's add-item box and Calendar search, tap the x: the box empties and the keyboard stays up.

- **Cold start: theme and icon hold, ticker shows with the dock** · PR #119
  - Theme: the last theme is applied before first paint; the iPhone icon only changes once this person's prefs have loaded (no "icon changed" alert on launch).
  - Ticker: the last headlines (and recent finals) show with the dock; fresh ones replace them as soon as sign-in is confirmed, without waiting for the full state load.
  - Post-deploy: needs a TestFlight build (the iPhone app bundles the web code). On the phone, with Halloween on: fully close and reopen — no classic flash, no icon alert, ticker visible with the dock. The very first launch after updating can still open classic once (no saved theme yet), but without any icon alert.

- **Watch settings + sidebar, Mail Automation, News pull-to-refresh, Shop tidy** · PR #121 · Mail AI is now Mail → gear → Automation. Watch gear menu: Streaming Services (Sync-Settings-style rows, (i)) and Theaters (Google theater search that saves the website; + adds a typed name; no tabs/hint/URL box). Watch has a three-bar sidebar with Archive at the bottom. Calendar month title reads "October 2026". News: no gear/refresh by search, pull-to-refresh, Front page without Briefings or The Athletic. Shop: no Receipts/+ under the list; urgent toggle is a warning triangle. Verified: full suite, boot check, mail-frame check, `npm run qa:settings` (all), simulated pulls, mocked theater search, 360px screenshots. **Needs a deploy** for the theater search (new `google-places` actions) and the server-side Athletic filter. **After deploy/TestFlight:** Watch gear → Theaters, type a nearby theater, pick it, check Website ↗; News → pull down from the top; Mail gear → Automation.

- **Shop list: (i) on each item; names on one line** · PR #123 · Rows are checkbox · name · quantity · (i). The (i) shows From (Manual / Meal Plan), the recipes that call for it, prep ("chopped") and the price estimate; that small print is gone from under the name. Names get the full row, so "Toothbrush Head Replacement" fits on one line at iPhone width. Verified: full suite, boot check, `npm run qa:settings`. **After deploy/TestFlight:** Shop → tap (i) on a meal-plan item and a typed item; tapping (i) shouldn't tick it.

- **Email attachments open inside the app** · PR #127 · Every attachment, not just PDFs. iPhone app: Quick Look (new `AttachmentPreview` plugin) — PDF, images, Word/Excel/PowerPoint, Pages/Numbers/Keynote, text, audio/video — with Share for Files/AirDrop. Web: an in-app viewer (PDF, images, text inline; Download + Open in Gmail for the rest). New `gmail-attachment` function streams raw bytes, so the limit rises from 3.5MB to ~19.5MB; bigger files still open Gmail. HTML/SVG attachments are never rendered in the page. Verified: unit tests (view rules + the function), `npm run qa:mail-attachments` (30 checks, real chips at 360px, deployed and not-deployed paths), boot check, mail-frame check, full suite. **Not verified:** Quick Look on a real iPhone (Swift is compile-checked by the iOS build only).
  - **Needs a deploy** for `gmail-attachment` (until then the app falls back to the old action: up to 3.5MB, still opening in-app) **and a TestFlight build** for Quick Look.
  - After both: on the phone, open an email with a PDF, a photo and a Word file — each opens in the viewer; Share → Save to Files works; a 5–15MB attachment opens. On the laptop, a PDF opens in the viewer over Mail, not a new tab.
