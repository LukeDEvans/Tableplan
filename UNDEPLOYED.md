# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

**Dock ticker — headlines and followed teams' games** · #109 · A strip along the top of the bottom dock (⅓ of its height), one item at a time: News's lead stories, then every game of a followed team (before noon yesterday's + today's, from noon today's + tomorrow's). Tap a story → reader; tap a game → News → Sports → Scores on that day, expanded. Web + iPhone app code (no server or DB change), so it needs a deploy for the browser and a TestFlight build for the phone.
- After deploy / TestFlight: the strip shows above the weather / player slides with real headlines, then your teams' games (follow at least one team in News → Sports → Scores → Teams).
- Before noon it shows yesterday's results; after noon tomorrow's games instead.
- Tap a game → Scores opens on that day with it expanded; tap a headline → the reader opens and closing it returns you.
- During a live game the score updates within ~30 s; windows (notifications, Finance review, Meal Plan trash…) still stop above the dock, now above the strip too.

**Dock ticker: white in light mode, team logos** · #110, #111 · Light mode strip is white with text in the dock's blue (dark mode unchanged); each team's logo sits beside its abbreviation. Web + iPhone app code.
- After deploy / TestFlight: in light mode the strip is white with dock-blue text; in dark mode it stays dock blue.
- A game shows both teams' logos next to their abbreviations (ESPN logos — not testable in the sandbox).

_Last deploy: 2026-10-14 (Apple Music restored)._

- **Settings trim** · PR #112 · Gear menu says User Profile. Settings: Display, Pages, Household, Mail AI, Voice, Export My Data; Admin: Global Pages, Users, Households, Restore Backup, API Usage, Beta (Assistant, AI Action Log). Back arrows everywhere. Removed Notifications, Email (weekly review + its functions), Mail Reading (images always on), Import from AI Chat, Location Services (searches ask the phone and fall back to Home), Backup Health, App Name. Mail AI write-ups open from an (i). Household is read-only until Edit, names wrap, no sideways scroll; page lists show only real pages. Verified: full suite, build, boot check, `npm run qa:settings` (all), mail-frame check, 360px screenshots. **Removes three Netlify functions, so it needs a deploy**; a TestFlight build also picks up the new location prompt text. **After deploy/TestFlight:** gear → User Profile; Settings → Household on the phone (names readable, Edit, Members can access lists 9 pages); Mail AI → tap an (i); open a store search and check it finds nearby stores.

- **Page settings trim** · PR #114 · Finance has no gear-menu items: the Accounts tab gets the Emergency savings "Months of Needs to cover" field and an Alerts card; Link a bank / Track manually go to the Accounts tab. News drops Publications and the subscriber-cookie section (saved cookies still count); the sign-ins write-up opens from an (i). Recreate always shows every hobby. Shop's gear menu is Preferred Stores, Receipts (with Scan receipt), Price History; Checklist stays under Configure. Verified: full suite, boot check, `npm run qa:settings` (all), 360px screenshots. Client-only: **a deploy or a TestFlight build** carries it. **After deploy/TestFlight:** Finance → Accounts → open Emergency savings, change the months; Shop gear → Receipts and Price History; News gear → Sync Settings on the phone, tap the (i).
