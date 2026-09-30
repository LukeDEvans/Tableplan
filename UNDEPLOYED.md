# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

## Assistant decisions: chat stamps, grocery removals stick, finance setting, Siri via the assistant (PR #24)
PR: https://github.com/LukeDEvans/Tableplan/pull/24

- **Grocery removals stick:** an item removed on one device no longer comes back when another
  device syncs an older list (new `persistentManualGroceryStamps` in the grocery section).
- **Finance "use stored transactions"** stays shared between devices; the latest choice wins.
  ⚠️ **`STATE_SCHEMA_VERSION` 6 → 7.**
- **Siri voice commands run through the assistant** (same tools and saved memory; no deletes by
  voice). Food logged by voice now lands where the app reads it. New assistant tools: add
  workout, add piano song.
- Asking the chat the same question twice now records two history entries.

**After deploying:**
1. ⚠️ **Ship a TestFlight build right after this deploy.** The native app bundles its web code,
   so it stays on schema 6, and the server's finance guard (`tp_protect_finance_merge`) quietly
   reverts finance edits from an older-schema client. Until the new build is installed, make
   finance changes in the web app. Also reload any open browser tabs.
2. Run the Siri shortcut once with a couple of commands (e.g. "add bread and remind me to call
   the plumber") and check both land.
3. Remove a grocery item on the phone, then open the app on the laptop and check it stays gone.

## Issue sweep: honest set_meal, news fixes, music backup, share-sheet saves (PR #23)
PR: https://github.com/LukeDEvans/Tableplan/pull/23

- **Assistant / voice `set_meal`** says "Couldn't add X: <day> has no <meal> slots" instead of
  a false "Added" when the meal layout has no slots.
- **News cards:** a swipe and a mail sweep can no longer overwrite each other's pending cards;
  **Star Tribune** links (Sailthru trackers) are now decoded, so its articles produce cards.
- **Music → Saved → Download my uploaded music** zips the original files + `tracks.csv`.
- **Files save through the iOS share sheet** in the native app (music CSV, MusicXML, contacts
  vCard, finance CSV, data export); downloads as before on the web.
- Apple Music sign-in keeps Safari's popup permission; media hub lists Apple Music, not Jamendo;
  a full restore keeps logins the export left out; CSV import warns about a re-import under a
  new account name; the assistant refetches subscribed calendars older than 3 hours.

**After deploying:**
1. Media bell: check Star Tribune article cards appear after the next newsletter.
2. Native app (next TestFlight build): export a file from Music / Contacts / Finance and check
   the share sheet opens.
3. Safari: Apple Music sign-in from Music settings opens the Apple popup.

## Assistant upgrade: whole-app context, lookups, confirm/undo, suggestions, memory (PR #20)
PR: https://github.com/LukeDEvans/Tableplan/pull/20

- **The chat assistant now sees every area** (tasks, meals, next 7 days of calendar, trips,
  birthdays), not just the open page, and can **look things up**: calendar ranges, tasks,
  contacts, weather — plus email search/read and spending questions **only if you switch
  those on** (both off by default: Settings → Mail AI “Assistant can read email”, Settings →
  AI Notes “Assistant can read Finance”).
- **Deletions ask first** (Confirm / Cancel), and **every change it makes has Undo**.
- **Suggestions** when you open the assistant: a trip with nothing packed, a birthday this
  week, an early start, no dinner planned, bills due (finance on only), a long backlog.
- **Memory:** it can edit/forget its own notes; new “Open Threads” category; edit notes in
  Settings → AI Notes.
- Fixed: chat deletes of calendar events / watchlist / reading items / backlog tasks could
  come back after a sync.

**After deploying:**
1. Open the assistant and ask something cross-area (“what’s my week look like?”) — first
   real model call with the new tools.
2. Decide on the two access toggles above (email default is an open question in ISSUES.md).
3. Optional: set `ASSISTANT_CHAT_MODEL` in Netlify to change the chat model (default unchanged).

## iPhone layout fixes + ISSUES.md cleanup (PR #19)
PR: https://github.com/LukeDEvans/Tableplan/pull/19

- **Mini-player** runs flush to the bottom of the screen (no empty strip under the controls).
- **Full-screen windows and dialogs** stay clear of the notch/status bar and home indicator:
  Recipe Box (its bell / + / × were untappable), Tasks, Nutrition, Receipts, add task, event
  editor, exercise recorder, recipe editor/view, contacts, and others. CSS only.
- **Finance:** old CSV-backfilled months show their per-category amounts again (repaired on
  load); the review-deck swipe hint no longer covers the buttons; new **Relinked accounts**
  merge under Accounts › Bank link (FINANCE_TRANSACTIONS_DESIGN.md §12) — appears only if a
  SimpleFIN relink ever duplicates an account.
- **Mail AI:** every feature now defaults **on** — including the vegetarian-only recipe filter,
  NYT / Economist / Star Tribune articles, and SimpleFIN alert auto-delete. Anything already
  switched off stays off.
- **Meal plan:** a failed Gmail swipe-"Add" puts the card back instead of losing it.
- Publications leftovers removed from the code; iOS minimum raised to 15.0; new
  architecture test for un-injected module names.

**After deploying:**
1. Supabase SQL editor: run `migrations/2026-09-29-drop-publications.sql` (drops the unused
   `publications` / `feeds` / `articles` tables).
2. Settings → Mail AI: check the newly-on features are what you want (the vegetarian filter
   drops meat/fish recipes; SimpleFIN auto-delete trashes those alert emails).
3. On the iPhone (web app and native app): open Recipe Box and a couple of dialogs and check
   the headers sit below the status bar; start audio and check the mini-player.
4. iOS 15 minimum reaches the phone only through the next TestFlight build.

## Recipe Box: "+" fixed, plus a review queue for new recipes (PR #17)
PR: https://github.com/LukeDEvans/Tableplan/pull/17

- The **+** in Meal Plan → Recipe Book opens the Add-recipe form again. It was crashing
  on a function the recipes module was never given.
- A **bell** next to + and × holds recipes that weren't typed in by hand: Gmail finds,
  the Chrome extension, and URL import / paste / scan / share. **Review** opens one in
  the editor, and saving adds it to the book. **×** dismisses it. The Meal Plan Recipe
  Book button shows the count.
- In-app imports still open the editor straight away; closing without saving now keeps
  the recipe in the queue instead of losing it.
- New Netlify function `recipe-review`. It stores the queue in one service-only row per
  user (`recipereview_<userId>`). No DB migration.

**After deploying:**
1. **Reload the Chrome extension.** It now sends recipes to the queue, so until the
   function is live, recipe imports from the extension fail.
2. Import one recipe signed in on the real app, then check it appears under the bell and
   that saving it moves it into the book. The server path was only unit-tested with
   the network mocked.

## Mail: swipe between emails follows your finger (PR #16)
PR: https://github.com/LukeDEvans/Tableplan/pull/16

- Mail on a phone: the open email now moves with your finger while the next or previous one
  slides in beside it, like the meal-plan day swipe. Let go past about a third of the screen
  (or flick) to switch; otherwise it springs back. At the first or last email it bounces.
- The emails either side of the open one are fetched in the background (without marking
  them read), so a swipe usually lands on a loaded email.
- Removes a duplicate old swipe handler. Client-only (`app.js` + `styles.css`).

**After deploying:** try it on the iPhone app (not tested on a real device yet). If flicks
feel too eager or too stiff, the thresholds are in `mailPager` in app.js.

## Instacart: per-store "Send to Instacart" (PR #15)
PR: https://github.com/LukeDEvans/Tableplan/pull/15

- Shop: stores with **Order via Instacart** on (on by default for Aldi, Costco and Cub Foods;
  change it in the store's Edit dialog) get a Send button. It sends that store's unchecked
  items to an Instacart shopping-list page. The store then shows "Sent to Instacart" with
  Mark delivered / Undo. Items Instacart couldn't match are listed under the store.
- The button stays **hidden until an API key is set**, so nothing changes visibly until then.
- New Netlify function `instacart-list`. It adds the `instacartOrders` key to the grocery
  state section.

**After deploying:**
1. Netlify env: set `INSTACART_API_KEY`, plus `INSTACART_ENV=production` for the live
   Instacart API (unset uses the dev server). No redeploy is needed after adding them.
2. Do one real send, then check whether items Instacart didn't match are listed under the
   store (ISSUES.md, "Instacart match failures").

## News intake: email-linked articles → Media bell swipe deck (merged 2026-09-27)
PR: https://github.com/LukeDEvans/Tableplan/pull/7 · spec: NEWS_INTAKE_DESIGN.md

- Articles linked in NYT / Economist / Star Tribune emails become swipe cards behind the
  Media page's 🔔. Right swipe saves the article to Media → Publications; left dismisses it.
  An article is never delivered twice, and nothing older than 7 days is delivered.
- Newsletter → listenable article now runs on every real newsletter from those papers.
- Processed news emails are filed to Apps/AI trash.
- Article scanning moved into Media → Publications (Scan button). The standalone
  Publications page is removed, along with the Home button and the RSS feed code.

**After deploying:**
1. Settings → Mail AI → switch on "NYT / Economist / Star Tribune articles → Media
   notifications". All three are **off by default**, so nothing happens until you do.
2. After the first few real emails, check the Netlify function logs for
   `[news-links] <paper>: N new of M unseen`. `0 of 0` on a newsletter full of articles
   means the link patterns missed (ISSUES.md, "News intake URL/sender patterns").

## Finance: "Use stored transaction history" toggle layout fix (PR #8)
PR: https://github.com/LukeDEvans/Tableplan/pull/8

- Finance › Accounts tab › Accounts card › Bank link: the switch and its label now sit on
  one row (the label used to wrap under the switch on phones). CSS only.
- Also closes the ISSUES.md "verify finance ingest on deployed runtime" item (docs).

**After deploying:** nothing.

## Page windows fit the screen; stop above the mini-player (PR #9)
PR: https://github.com/LukeDEvans/Tableplan/pull/9

- Page windows no longer run past the bottom of the screen on iPhone (Safari toolbars,
  home indicator in the PWA, Explore in the native app). While the audio mini-player is
  showing, every window stops 10px above it. CSS only.

**After deploying:** on an iPhone, check a few pages with and without the mini-player
showing, in both the installed web app and the native app.

## Music: Discover-first redesign, search on every tab, portable library (PR #10)
PR: https://github.com/LukeDEvans/Tableplan/pull/10 · docs: MUSIC.md §3e/§3f

- Media → Music opens on **Discover** (Apple Music / Spotify-style home: top playlists,
  Jump back in, for-you, ranked Top songs, top albums, Browse categories → category pages).
  Tabs: Discover · Saved · Library · one tab per playlist · +.
- One search bar on every tab (Discover = catalog; other tabs filter locally).
- Portability: ISRC saved on songs; a saved song that can't play on its provider is found
  on another by ISRC/title+artist; Saved → "Back up & move your music" CSV export/import.

**After deploying:**
1. With Apple Music connected, open Discover → Pop / Hip-Hop and confirm the Top songs /
   albums are genre-specific (ISSUES.md "Music Discover browse verified only against a
   mocked MusicKit").
2. On the iPhone app, try Saved → Export CSV (ISSUES.md "Music CSV export download").


## Export my data + permanent history log (PR #12)
PR: https://github.com/LukeDEvans/Tableplan/pull/12 · docs: DATA_EXPORT.md

- Settings → **Export My Data** downloads one zip: `live-export.json` (everything, and
  Restore accepts it; logins/tokens removed), ~50 CSVs (one per kind of record, plus the
  other household/personal view), `calendar.ics`, `contacts.vcf`, `attachments.csv` (links).
- Media plays, article reads, piano practice events and AI chat are now also saved to the
  `live_history` table, so the in-app "recent" limits no longer delete history. Existing
  history uploads once per user. Finance monthly totals are no longer trimmed to 36 months.
- DB: `live_history` is **already applied** to production (2026-09-28) — no SQL step.

**After deploying:**
1. Use the app for a minute (play something, open an article), then run
   `select kind, count(*) from live_history group by kind` in the SQL editor — rows should
   appear (media_play / article_read / practice_event / ai_chat).
2. Settings → Export My Data on a computer; open a couple of CSVs and check `README.txt`
   for notes. On the iPhone app, check it opens the share sheet (untested there).

## Native listen queue + app icon (PR #11)
PR: https://github.com/LukeDEvans/Tableplan/pull/11

Mostly **native iOS**. It reaches the phone only through an Xcode/TestFlight build
(`npm run ios:sync`, then Archive in Xcode). A Netlify deploy doesn't update the app.
- Apple-voice article reading keeps going while locked. Lock-screen and AirPod play,
  pause and resume work.
- In the native app with the Apple voice, the Media "All" queue (articles + podcasts)
  runs on the native player. The Podcasts-tab panel and speed follow it.
- Finished articles are marked read (Apple voice too); finished episodes are marked played.
- Info.plist: background audio mode, plus plain-http podcast audio allowed.
- App icon + launch screen are now the web app's sailboat L (were Capacitor placeholders).
- Web app effect only: Apple-voice (Web Speech) reads in the browser now mark articles read.

**After deploying / building:** on the phone, check lock-screen play/pause, an AirPod tap,
auto-advance while locked (article→article, article→podcast, podcast→article), podcast
resume position, and a speed change mid-item. The Swift was never compiled in CI.


## iOS: TestFlight from GitHub Actions + native compile check (PR #13)
PR: https://github.com/LukeDEvans/Tableplan/pull/13 · docs: CAPACITOR.md → "TestFlight from GitHub Actions"

- CI only; nothing changes on the website. Actions → "iOS → TestFlight" → Run workflow
  builds on a hosted Mac and uploads to TestFlight. Repo secrets `ASC_KEY_ID`,
  `ASC_ISSUER_ID` and `ASC_KEY_P8` are set (2026-09-29).
- "iOS compile check" compiles the app unsigned on PRs/pushes that touch native code.

**After deploying:** nothing.
