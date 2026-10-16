# Post-deploy checks

Checks to do after a deploy — everything here is already **live**. (Work that has NOT
shipped yet is listed in [UNDEPLOYED.md](UNDEPLOYED.md).) When deploying, move each
UNDEPLOYED.md entry's "After deploying" steps here under a heading for that deploy.
Tick items off as they're done; delete a deploy's section once it's all ticked.

## 2026-10-16 deploy (mail attachments in-app, text-box clear, Scores tables, cold-start theme, Watch/Mail/News/Shop tweaks, Shop (i))
Web deploy plus a TestFlight build from `main`. Service worker cache bumped to v48, so hard-refresh once. No migrations. New Netlify function `gmail-attachment`; new `scores` actions `standings` / `team`; new `google-places` theater actions.

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

- **Scores: Conference League, league tables, team schedules** · PR #120 · Conference League in the catalog (on by default). League tables from the Scores bar's table button, a league heading's Table link, or a game; NFL/NHL/MLB by division, NBA/college by conference, soccer as one table with qualification colours. Team pages list every game of the season across competitions. New `standings` / `team` actions on the scores function (CDN-cached, no Supabase). Verified on the PR's preview against live ESPN: NHL/NFL division tables (2026-27 / 2026), Eredivisie and Conference League tables, AZ's schedule spanning Eredivisie + Europa League, Ajax's spanning Eredivisie + Conference League (40 games). See SPORTS_SCORES_DESIGN.md. **After deploy/TestFlight:** News → Sports → the table button: NFL by division, your teams highlighted. Tap Ajax in the Eredivisie table → its season. Tap a game → that day in Scores, ‹ Back returns.

## 2026-10-15 deploy (dock ticker, settings trim, page settings trim, Halloween purple + dark-mode mail)
Web deploy plus a TestFlight build from `main`. Service worker cache bumped to v47, so hard-refresh once. No migrations. The settings trim removes three Netlify functions, so it needed this deploy, not just TestFlight.

**Dock ticker — headlines and followed teams' games** · #109 · A strip along the top of the bottom dock (⅓ of its height), one item at a time: News's lead stories, then every game of a followed team (before noon yesterday's + today's, from noon today's + tomorrow's). Tap a story → reader; tap a game → News → Sports → Scores on that day, expanded. Web + iPhone app code (no server or DB change), so it needs a deploy for the browser and a TestFlight build for the phone.
- After deploy / TestFlight: the strip shows above the weather / player slides with real headlines, then your teams' games (follow at least one team in News → Sports → Scores → Teams).
- Before noon it shows yesterday's results; after noon tomorrow's games instead.
- Tap a game → Scores opens on that day with it expanded; tap a headline → the reader opens and closing it returns you.
- During a live game the score updates within ~30 s; windows (notifications, Finance review, Meal Plan trash…) still stop above the dock, now above the strip too.

**Dock ticker: white in light mode, team logos** · #110, #111 · Light mode strip is white with text in the dock's blue (dark mode unchanged); each team's logo sits beside its abbreviation. Web + iPhone app code.
- After deploy / TestFlight: in light mode the strip is white with dock-blue text; in dark mode it stays dock blue.
- A game shows both teams' logos next to their abbreviations (ESPN logos — not testable in the sandbox).



- **Settings trim** · PR #112 · Gear menu says User Profile. Settings: Display, Pages, Household, Mail AI, Voice, Export My Data; Admin: Global Pages, Users, Households, Restore Backup, API Usage, Beta (Assistant, AI Action Log). Back arrows everywhere. Removed Notifications, Email (weekly review + its functions), Mail Reading (images always on), Import from AI Chat, Location Services (searches ask the phone and fall back to Home), Backup Health, App Name. Mail AI write-ups open from an (i). Household is read-only until Edit, names wrap, no sideways scroll; page lists show only real pages. Verified: full suite, build, boot check, `npm run qa:settings` (all), mail-frame check, 360px screenshots. **Removes three Netlify functions, so it needs a deploy**; a TestFlight build also picks up the new location prompt text. **After deploy/TestFlight:** gear → User Profile; Settings → Household on the phone (names readable, Edit, Members can access lists 9 pages); Mail AI → tap an (i); open a store search and check it finds nearby stores.

- **Page settings trim** · PR #114 · Finance has no gear-menu items: the Accounts tab gets the Emergency savings "Months of Needs to cover" field and an Alerts card; Link a bank / Track manually go to the Accounts tab. News drops Publications and the subscriber-cookie section (saved cookies still count); the sign-ins write-up opens from an (i). Recreate always shows every hobby. Shop's gear menu is Preferred Stores, Receipts (with Scan receipt), Price History; Checklist stays under Configure. Verified: full suite, boot check, `npm run qa:settings` (all), 360px screenshots. Client-only: **a deploy or a TestFlight build** carries it. **After deploy/TestFlight:** Finance → Accounts → open Emergency savings, change the months; Shop gear → Receipts and Price History; News gear → Sync Settings on the phone, tap the (i).

- **Halloween purple + readable mail in dark mode + snooze menu closes** · PR #116 · Halloween outlines windows and buttons in purple and tints the dock purple-black (orange stays the accent). In dark mode (Classic too) an open email's subject, senders, "Move to …?" chip and Reply now read on the white surface, and the snooze/more menus, mail sidebar, article reader and Recreate cards are dark instead of light-on-white. Mail's move/snooze/more menus close on a tap anywhere else (including on the email), a second tap of their button, or Escape. Client-only: **a deploy or a TestFlight build** carries it. Verified: full suite, boot check, `npm run qa:mail-menus` (10/10), mail-frame check, iOS compile, 390px screenshots in four theme/mode combinations. Not verified: real Gmail on the iPhone. **After deploy/TestFlight:** in Halloween dark, open an email: subject, sender and "Move to" read clearly; tap snooze, then tap the email, and the menu closes; tap snooze twice, and it closes; check Recreate's cards.


## 2026-10-14 deploy #2 (Apple Music restored)
Web deploy **plus a TestFlight build from `main` (`a945404`)**: the iPhone app bundles its web code, so the morning's build (from `ba39e54`) still had Apple Music removed. TestFlight run 38587660517, 2026-10-14. Service worker cache bumped to v46, so hard-refresh once. Apple Music env vars confirmed present in Netlify before the deploy.

- **Restore Apple Music, always on, no Settings panel** · PR #105 · Reverts the Apple Music removal from #101 (Luke: that was a misunderstanding). Apple Music is always on with no switch; Settings has no Apple Music panel; sign-in is the banner in Listen › Music › Discover. **Brings back the `apple-music-token` function, so it needs a deploy.** The `APPLE_MUSIC_*` Netlify env vars must still be set (couldn't confirm from the cloud session). **After deploy:** play a saved Apple Music song (it no longer says "isn't streamable"); if Discover shows "Apple Music isn't reachable", check the env vars; if it shows the Sign in banner, sign in there; check gear → Settings has no Apple Music row.


## 2026-10-14 deploy (Display + Halloween theme, profile redesign, settings cleanup, reminders switch, Amazon PDF receipts)
Web deploy plus a TestFlight build from `main` (#103 adds the app-icon plugin; #97 and #100 have native or phone-side parts). Service worker cache bumped to v45, so hard-refresh once. Profile migration (`2026-10-13-profile-avatars.sql`) was applied 2026-10-14, before this deploy. **Update both phones to the new TestFlight build soon:** an older build drops `memberDiets` when it saves (PR #100).

- **Share sheet: Amazon order-summary PDFs → Finance** · PR #97 · "Live" now appears in the share sheet for a PDF (Amazon → order → Order Summary → Save). The extension reads the PDF's text on the phone (PDFKit) and sends it; a scanned PDF goes as page images. The server reads summary text with an invoice-specific prompt and a 40,000-character limit. **The TestFlight build adds the PDF option and already works against the live server; this deploy only improves the read** (summary prompt, longer text). Verified: server tests, full suite, the iOS compile check. **After TestFlight (+ deploy):** in Amazon open an order → Order Summary → Save → Live; check "Added to Finance" with the right total, then Finance → Insights → Receipts shows the items. If Live isn't in that sheet, Amazon shared a link: use Print → pinch out on the preview → Share → Live, and tell Claude which one it was.

- **Display: Light/Dark/Auto + Halloween theme + seasonal icon** · PR #103 · gear → Settings → **Display**: Mode (Light/Dark/Auto) and Theme (Classic/Halloween/Seasonal), each person's own. Halloween is orange and black in both light and dark, contrast-checked. Seasonal (opt-in) uses Halloween through October. On the iPhone the icon turns orange-on-black with the theme. Client-only: **a TestFlight build is enough for the phone; the laptop web app needs a deploy.** Verified: full suite, build, boot check, iOS compile check, headless screenshots of five pages in both modes, the Display flow including Auto and reload. **After TestFlight/deploy:** Settings → Display → Halloween → check Calendar, Meal Plan, Shop in Light and Dark. On the phone, expect one iOS "icon changed" notice and the orange icon. Then try Seasonal. Report any screen that still looks Classic (ISSUES.md).

- **Reminders switch you can actually find** · PR #99 · The "Reminders on this iPhone" switch was only in a Settings dialog the phone can't reach. It's now at gear → Settings → **Notifications** (and in the calendar's Add Calendar window). In a browser it shows the browser's notification permission. Client-only: **a TestFlight build is enough**, no deploy needed. Verified: `scripts/qa-reminders.mjs` (24/24, including gear → Settings → Notifications), full suite, boot check. **After TestFlight:** gear → Settings → Notifications → Turn on.

- **Profile redesign + Home + diet & allergies + photo** · PR #100 · Profile opens read-only with a small Edit button (About, Food, Household, Account). Home is a city search; the picked city becomes Weather's "Home" place (first, and the fallback when the phone's location isn't available) and store/restaurant search use it when location is off. Per-person diets/allergies (`state.memberDiets`, eat section) show a heads-up on conflicting recipes and go to the assistant. Profile photo: 256px JPEG in the public `avatars` bucket, version in auth metadata, cached per device. **Migration applied 2026-10-14** (`migrations/2026-10-13-profile-avatars.sql`: bucket + 4 own-folder policies, verified). Verified: `scripts/qa-profile.mjs` 47 checks (light + dark, 360px), full suite, boot check. Not verified: real photo upload, iPhone photo picker/HEIC, the recipe heads-up in a browser. **Client-only, so TestFlight or a deploy both work; ship both phones on the new build soon** — older builds drop `memberDiets` when they save the eat section (own entries are restored from auth metadata; a child's are not). **After deploy/TestFlight:** add a photo and check it on the other device; set Home and check Weather shows "Home"; set an allergy and open a recipe with that ingredient.

- **Settings cleanup + Recently deleted recipes** · PR #101 · Step 1 of SETTINGS_AUDIT.md. Removes dead settings code (old full-page Settings, iCal Calendars dialog, duplicate Sync Settings and Family Members dialogs, empty Tasks settings, unreachable panels), Siri/Alexa voice commands (incl. the `voice-command` function), AI Notes (the assistant's saved memory) and in-app Apple Music (incl. the `apple-music-token` function). Trash becomes **Recipe Box › Recently deleted (N)**: 30 days, then purged. Verified: full suite, boot check, `npm run qa:settings` (every Settings row and gear item, plus the Recently deleted flow), 375px look. **Removes two Netlify functions, so it needs a deploy, not just TestFlight**; the Apple Music Swift plugin stays in the iOS project until a Mac session removes it (ISSUES.md). **After deploy/TestFlight:** delete a test recipe, find it under Recipe Box › Recently deleted, restore it; check gear → Settings no longer shows Voice Commands, AI Notes or Apple Music; if any calendar disappears, re-add it through Google Calendar.


## 2026-10-13 deploy (Google Calendar Phase 1, reminders, share-sheet receipts, and everything merged since 10-11)
Web deploy plus a TestFlight build from `main` (the iPhone app bundles its web code, and #93/#95/#84 add native parts). Service worker cache bumped to v44 — hard-refresh once. Migration `2026-10-13-notification-prefs.sql` applied before the deploy.

- **Calendar: pinch direction flipped** — fingers apart zooms in (month → week → day), together zooms out. · PR #81 · Post-deploy: on the phone, pinch out from month → week → day and back in to month.

- **Calendar: a pinch no longer also swipes to another month/week/day** · PR #86 · Swipe now ignores any gesture that had two fingers down (and the moment right after one), measures each finger from its own start, and needs a mostly sideways move. Client-only (TestFlight or deploy). Verified in headless Chromium with multi-touch: 4 sloppy pinches stay in the same month (before: drifted Oct → Aug); one-finger swipes still change month. **After TestFlight/deploy:** on the phone, pinch through month → week → day and back, and check the dates don't jump; one-finger swipes still go to the previous/next period.


- **Google Calendar: read sync via the Google API (Phase 1)** · PR #90 · Connect Google Calendar in the Calendar sidebar's Add Calendar dialog. Google calendars load with real start/end times, new Google calendars are discovered automatically, legacy iCal links migrate in place (same app id + color), Google calendars can be switched to Show on Meal Plan, and Settings has a severance dry-run report. Read-only for now — editing Google events is Phase 2. **Needs a Netlify deploy** (new `gcal-*` functions; migration already applied to prod; no new env vars) **and a TestFlight build** (iPhone connects through the WebAuth sheet). Post-deploy: (1) on the laptop, Connect Google Calendar, approve, and confirm you land back on Plan with your calendars listed; (2) an existing linked Google calendar keeps its color and now shows timed events at the right times; (3) add an event in Google on your phone, then refocus the app — it appears within ~5 min; (4) create a new calendar in Google — it shows up in the list as new; (5) on the iPhone app, connect and confirm the sheet returns to the app; (6) switch a Google calendar to Show on Meal Plan and check an 8a–4p event lands on lunch only; (7) run 'Ready to leave Google?' and read the report.


- **Shop: the blue window border is back** · PR #82 · The 2026-10-06 change that slimmed the Shop window also removed its navy border; the border is restored. The buffer and shadow stay off and the trimmed list gutter stays, so the list keeps its extra width. CSS only. Verified in the browser at 390px: 2px navy border, no sideways scroll. **After deploy + TestFlight:** open Shop on the phone and check the border.

- **Finance: decluttered top of page + no sideways scroll on Insights** · branch `claude/finance-declutter` (no PR — merged directly) · Removed the Net worth / Cash on hand / This month cards and the alert-chip row (to review, bank connection error, stale, large purchase, low balance, over budget, to itemize); those figures live in Accounts, and the Transactions/Accounts tab dots + the bell still flag attention. Dropped the matching overview-only toggles (over budget, large purchase, low balance) from Settings › Finance › Alerts. Insights' Cash flow In/Out/Net row now wraps instead of pushing the page ~80px sideways at phone width. Verified at 360px in headless Chromium on every finance tab. **After deploy + TestFlight:** open Finance on the phone — tabs at the top, no cards/chips; swipe sideways on Insights and confirm it doesn't move.

- **Finance: no more "Requested date range exceeds recommended range of 45 days" banner** · branch `claude/simplefin-window` · The daily bank pull (cron + manual Refresh) now asks SimpleFIN for 44 days instead of 45. Exactly 45 was being flagged as over the limit. The date-range advisory is also dropped from the errors the page shows, including today's cached copy, since the transactions did load. Real connection errors (e.g. "Apple Card … Auth required") still show. Server-side (Netlify functions) only, so **this needs the Netlify deploy; TestFlight alone won't change it.** **After deploy:** open Finance and confirm the 45-day banner is gone. The Apple Card auth message stays until that connection is re-authorized in SimpleFIN.

- **Finance: no category suggestion bubbles under unlabeled transactions** · branch `claude/finance-no-quick-labels` · Removed the row of most-used-category chips (and "More…") under each unlabeled spend in the transaction log. Tapping the transaction opens its card to set the category, as before. Client-only (TestFlight or deploy). Verified in the browser at 360px: unlabeled rows have no chips, and tapping one opens the card with the category picker. **After TestFlight/deploy:** check that the log has no chip rows.

- **Finance: Transactions header = Add · Filter · Bell; filter is a popup window; no bank-message banner** · branch `claude/finance-txn-toolbar` · Add transaction (+) and a new Filter button (funnel icon, accent dot when filters are on) sit left of the notifications bell. Filter opens a window in the same frame as Notifications, with Label, Account and a new **date range** (blank = the viewed month; a range spans every loaded transaction). It has Clear filters and Done. Search and Sort stay above the list. The in-list scan-receipt button and its bulk-scan code are removed; the app's top-right receipt scanner replaces them. The "Couldn't load some transactions — …" banner is removed from Transactions; bank connection messages still show in Accounts (bank-link section + tab dot) and the bell. Client-only. Verified at 360px in headless Chromium: header order, each filter narrows the list, the date range shows September from October, Clear restores, + opens the add form, no sideways scroll, no page errors. **After TestFlight/deploy:** try each filter on the phone, including the native date pickers.


- **Media split: reader + Saved in News, Watch is its own page, Media → Listen** · PR #83 · See MEDIA_SPLIT_DESIGN.md. Back from an article returns you to where you opened it (page, tab, scroll). The article reader and the saved-articles list live in News: one **Saved** view holding stories saved from News, newsletters, extension, URLs, scans and PDFs. A story's menu says **Save**; Mail's action is **Save to News**. Watch is a standalone page on the landing page and in the page menu. Search is split: Watch covers films, shows and videos, and Listen covers podcasts, books and online audio. Media's visible name is **Listen**; the internal keys and the `#media` link are unchanged. Client-only (TestFlight or deploy). Verified: unit suite, build, a happy-dom boot of the unbundled source, and Luke on the deploy preview. Not run: the real-browser `check:boot` (Chromium download blocked in the cloud session). **After TestFlight/deploy:** on the phone, check these:
  - Open a News story, press Back, and land on News.
  - Open an article from Listen's queue, press Back, and land on the queue.
  - Watch opens from the landing page.
  - Save a story and find it in Saved.

- **Finance: the four tabs stay pinned at the top while scrolling** · branch `claude/finance-sticky-tabs` · `.fin-tabs` is `position: sticky` inside the Finance window (its scroller is `#financeMainPage`), with an opaque backing so rows don't show through. CSS only. Verified at 360px in headless Chromium: after scrolling Transactions, Budget and Accounts, the tabs stay at the same spot and are still tappable. **After TestFlight/deploy:** scroll a long Transactions list on the phone and switch tabs without scrolling back up.

- **iPhone app: tap the top of the screen to scroll back to the top** · branch `claude/status-tap-scroll` · Tapping the status bar (clock / battery area) scrolls whatever is in front back to the top: the current page, or an open sheet/dialog instead of the page behind it. iOS does this on its own only when the whole document scrolls, and every Live page scrolls inside its own window, so the tap did nothing. The native shell now forwards the tap to the page (`MainViewController.swift`), and `status-tap-scroll.js` scrolls the scroller under the middle of the screen. Smooth, or instant with Reduce Motion on. **Needs a new TestFlight build** (native change); a Netlify deploy alone does nothing, and the PWA/browser is unchanged. Verified: unit tests, build, `boot:check`, and headless Chrome at 390px on Meal Plan, Calendar, Recreate, Shop, Tasks, Watch, Mail, Finance, News and an open dialog (the dialog scrolled up, the page behind stayed put). Not verifiable here: the real status-bar tap on a device. **After TestFlight:** scroll down a long page, tap the clock, and check it glides to the top; repeat inside an open sheet.

- **Finance: "Updated …" moved to the bottom of the Transactions card** · branch `claude/finance-updated-footer` · The bank-data timestamp ("Updated yesterday" / "Updating…") moved from under the card header to a small centered footer at the very bottom of the month's list. Client-only. Verified in headless Chromium at 360px with a stubbed timestamp: it is the card's last element. **After TestFlight/deploy:** scroll to the end of Transactions and look for the line.

- **Watch: search returns results again** · PR #85 · Since the Watch/Listen split, Watch search showed "No results." for everything: the TMDB adapter read `id` but the `tmdb-search` function returns `tmdbId`, so every movie/show was dropped. The adapter now accepts either. Client-only (TestFlight or deploy). Verified with a regression test on the real response shape + full suite; not yet checked on the phone. **After TestFlight/deploy:** search a title on Watch (e.g. "Dune") and confirm movie/TV results with service buttons appear.

- **Shop: "List" tab, no empty-store box, long-press a store to skip it this week** · PR #87 · The Shop page's "Shop" tab is now **List**. Empty stores show only their heading (no "Drop items here" box; still a drop target while dragging). Holding a store heading or store tab for half a second opens Skip this week / Edit / Remove — right-click already did this on desktop; iOS never sent it a long-press. Skipping now also re-runs the price plan across the stores you're still visiting, so price-routed items go to the next cheapest store instead of Other. Client-only (TestFlight or deploy). Verified: unit suite, `boot:check`, and `scripts/qa-shop-skip-store.mjs` (13/13, touch-emulated headless Chromium). The price re-plan was reviewed, not run (no price history in the QA seed). **After TestFlight/deploy:** on the phone, hold a store heading → Skip this week, check its items move, then "Shop it" to bring it back; make sure a normal tap still collapses the store and scrolling over a heading doesn't open the menu.

- **Shop: pin for store directions, alarm for Next Stop** · PR #88 · The directions button on each store heading uses the meal plan's eating-out pin instead of the turn arrow. The Next Stop (urgent) toggle beside "Add item" is now an alarm clock, so it no longer looks like the directions pin. Icons only, client-only (TestFlight or deploy). Verified: unit suite and a 390px headless screenshot. **After TestFlight/deploy:** glance at the List tab on the phone.

- **Shop: Checklist text trimmed, Inventory weekly checklist removed, Inventory border back** · PR #89 · Checklist no longer shows the "Check anything you don't need… Starts fresh every Friday." hint or "Not submitted yet this week" ("Submitted this week" / "Unsaved changes" still show when they apply). Inventory's old Weekly checklist button, dialog and "Track on weekly checklist" menu item are gone (the Checklist tab replaced them; its "Import from Inventory" still reads items tracked the old way). Inventory now has the same blue window border as Shop, and the Checklist · List · Inventory tabs sit at the same height on all three. Client-only (TestFlight or deploy). Verified: unit suite, `boot:check`, headless Chromium at 390px. **After TestFlight/deploy:** flip between the three tabs on the phone — border stays, tabs don't jump.

- **Per-person event reminders + iPhone local notifications (notifications Phase 1)** · PR #95 · See IOS_NOTIFICATIONS_DESIGN.md. Reminders go only to the person who set them (stored in `live_notification_prefs`, migration applied before this deploy). The app sends reminders for Google events too, using each person's own Google reminder settings, with a **Remind me** picker in a Google event's details. The iPhone app schedules them as local notifications, so they fire with the app closed. Existing shared reminders were folded into Luke's own. Needs this deploy (`gcal-events` returns reminders) **and a TestFlight build** (`@capacitor/local-notifications`). **After deploy + TestFlight:** (1) gear → Settings → **Notifications** → Turn on, and allow (needs the TestFlight build from PR #99; on the 10-13 builds, choose a reminder on an event to get the prompt); (2) set a reminder 5 minutes out on a new event, lock the phone, and check it arrives; (3) tap it, and the event opens; (4) open a Google event's details and check Remind me shows Google's reminder; (5) turn off notifications in the Google Calendar app; (6) on your wife's account, check none of your reminders reach her.

- **Share order screenshots to Finance (iOS Share Extension)** · PR #93 · Share 1–4 order screenshots from the iPhone share sheet → **Live**; they're read and added to Finance's receipt inbox as "Online order" receipts. Adds the `share-receipt` function and a long-lived share token kept in a keychain group the app shares with the extension. CI now archives the iOS app ad hoc. Needs this deploy (new function; no env vars, no migration) **and a TestFlight build** (new extension target and bundle id `com.mrlukedevans.live.ShareExtension`). **After deploy + TestFlight:** (1) open the app once so it mints the token; (2) share an Amazon order screenshot → Live and wait for "Added to Finance"; (3) Finance → Insights → Receipts shows it; (4) if the TestFlight export complains about the new bundle id or the keychain entitlement, register the id in the developer portal (CAPACITOR.md → "Share sheet").

## 2026-10-11 deploy #2 (News: Sports always shows)
Web deploy plus a TestFlight build from `main`. Service worker cache bumped to v43.

- **News: Sports always shows, so Scores can be reached** · direct to `main` · **Fix:** the Sports section only appeared in the News sidebar once a sports article had arrived, and none had, so the Scores view (PR #78) couldn't be opened. Sports now always shows when Scores is available. Client only. Verified in the browser at 1280px and 390px with no sports articles: Sports shows and opens on Scores. **After deploy + TestFlight:** News → sidebar → Sports → Scores loads today's games.

## 2026-10-11 deploy (PRs #78–#80 + receipt-scan fix)
Web deploy plus a TestFlight build from `main`. Service worker cache bumped to v42 — hard-refresh once. The iPhone app bundles its web code, so the client side of every item reaches the phone only through the TestFlight build.

- **Receipt scan: no more "Unexpected token 'export'"** · branch `fix/receipt-scan-esm-bundle` (merged without a PR: the session's GitHub CLI was not signed in) · **Fix:** `scan-receipt` loads `receipt-domain.js`, an ES module. Netlify's default bundler shipped it as-is, and the Node 22 runtime (AWS Lambda) turns off Node's ES-module detection, so Read receipt failed every time. `netlify.toml` now uses esbuild for the four CommonJS functions with this pattern: `scan-receipt`, `estimate-nutrition`, `simplefin`, `voice-command`. Reproduced and verified locally by bundling with Netlify's bundler and running under Lambda's Node flags; `scan-receipt` ran end to end with a mocked AI reply, the other three were only checked to bundle and load. No state changes. **After deploy:** (1) Shop → scan a receipt → Read receipt: the review opens with line items; (2) estimate nutrition on one recipe; (3) Finance → refresh bank accounts and check the daily-briefing / simplefin function log shows `[fin-ingest] … upserted=N`, not `[fin-ingest] failed`; (4) one Siri voice command.

- **News → Sports: Scores view with per-user favorite teams** · PR #78
  - Sports opens on a **Scores** tab (Stories is the second tab): a day's games across the leagues
    you follow, favorites pinned in My Teams, a day strip, collapsible leagues, and a Teams & leagues
    dialog. Favorites are per user (`sportsPrefs`, a new synced setting in the personal `recreate`
    section; no migration, no schema bump).
  - New function `scores` reads ESPN's public feed through a swappable provider layer
    (SPORTS_SCORES_DESIGN.md). No new environment variables are needed.
  - **Needs a deploy** (the `scores` function). The web app is enough to try it; a TestFlight build
    is needed for the iPhone app.
  - **After deploy:** (1) open `/.netlify/functions/scores?action=health` and check ESPN reads
    `"ok": true`; (2) News → Sports: each league loads and the footer names none that failed;
    (3) follow a team from a game and from the Teams & leagues list, and check it shows under My
    Teams on your phone and laptop but not on your wife's account; (4) on the iPhone, check nothing
    scrolls sideways and team logos show.
- **News: Sync Settings moved to News; one Sign in or Sign out per paper; NYT sign-in diagnostics** · PR #80
  - Sync Settings (newspaper sign-ins and subscriber cookies) opens from a new ⚙ button on the News
    page and from the app menu on News. It's gone from Media: Podcast Ad-Block moved to Media →
    Podcasts settings, and the publications list is in Media → Publications (unchanged). The Media
    articles tab no longer has its own Sync Settings gear.
  - In the app, each paper shows its state on this phone and one button: **Sign in** when signed
    out, **Sign out** when signed in ("Checking…" briefly while the phone checks).
  - Star Tribune now has a cookie field too (the old panel only had NYT and Economist).
  - NYT Apple sign-in stalling after Face ID: the sign-in sheet now identifies as Safari, and records
    its steps (host + path only); the server keeps the last attempt's steps (ISSUES.md).
  - **Needs a deploy (the step log is saved by the `gmail` function) and a TestFlight build.**
  - **After deploy + TestFlight:** News → ⚙ → the Economist row shows "Signed in · Sign out", the
    NYT and Star Tribune rows "Not signed in · Sign in". Try NYT → Sign in → Sign in with Apple. If it
    still stalls, tell Claude: it reads `lastTrail` from `mailnewssubs_<user>`. Media → menu has no
    Sync Settings; Media → Podcasts settings has Podcast Ad-Block.
- **Mail: emails open with their images, without the wait** · PR #79 · **Change:** an image-heavy email used to sit unsized until every image had downloaded, which is why images were blocked in July. The email is now fitted as soon as its text is in, and images fill in afterwards, nearest the screen first. Remote images load by default with tracking pixels removed; images embedded in an email (logos, inline photos) now show; Settings → Mail Reading has a "Load images in emails" switch to go back to blocking. New synced setting `mailReadingPrefs` (config section, no schema bump). No Supabase load from images. **After deploy:** (1) fully close and reopen the app; (2) on the iPhone open a picture-heavy newsletter: the text should be readable at once and the pictures should fill in, including ones further down as you scroll to them (the scroll-triggered loading was only tested in Chromium); (3) open an email with a logo or photo embedded in it and check it shows; (4) Settings → Mail Reading: switch "Load images in emails" off, reopen an email, confirm no pictures and that … → Display images brings them back; switch it on again.

## 2026-10-08 deploy (PRs #72–#76)
Web deploy plus a TestFlight build from `main`. Service worker cache bumped to v41 — hard-refresh once. The iPhone app bundles its web code, so the client side of every item reaches the phone only through the TestFlight build. Checked before deploying: full test suite, `vite build`, browser boot check, and every page at 360 px wide in local dev (no sideways scroll; local data, not your real account).

- **Sign in to Liv with Apple or Google in the app (iPhone and Mac)** · PR #76
  - In the app, Apple / Google sign-in now opens in the system sign-in sheet and returns to the app
    signed in. Before, the website's redirect flow left the app and signed in to the website in a
    browser instead (Google), or failed (Apple). The browser sign-in is unchanged.
  - Supabase redirect URL `com.mrlukedevans.live://**` added by Luke (2026-10-07).
  - **Needs a TestFlight build; no Netlify deploy needed** (app code only).
  - **After TestFlight:** sign out, then on the lock screen → Sign in → Continue with Apple →
    the sheet signs you in and the app unlocks with your data. Repeat with Google. Try it on the
    Mac app too. If the app says "didn't finish", the redirect URL above is missing.
- **News: sign in to your papers in the iPhone app, no cookie pasting** · PR #75
  - The app's own newspaper sign-ins (Sync Settings → "Newspaper sign-ins on this device") now turn
    News on. When the sign-in sheet closes, the phone checks each paper itself and sends the server
    only "signed in / not signed in" per paper; the sign-in cookies stay on the phone. The sheet now
    opens sign-in popups properly, which is what Sign in with Apple needs. The News page shows its
    "Open Sync Settings" prompt whenever no paper is signed in (it used to stay hidden until a
    sign-in had been saved, so there was no way to find it). Pasting cookies in a browser still works.
  - **Needs both a deploy and a TestFlight build.** The server change is in the `gmail` function; an
    app on the new build against the old server signs in fine but News stays empty.
  - **After deploy + TestFlight (none of this has run on a phone; the Swift compiles in CI):**
    - News shows "News collects articles only from papers you're signed in to" → Open Sync Settings
    - Sync Settings → New York Times → Sign in → Sign in with Apple completes and the sheet shows you
      signed in; tap Done → toast "Signed in to The New York Times. News will collect its articles." (without the second sentence, the server has not been deployed yet)
    - repeat for The Economist. If the toast says "Not signed in" after a good sign-in, the Economist
      check is wrong, not the sign-in (ISSUES.md)
    - at the next :07 past the hour, read `newsfeeds_status` in `tableplan_states`: `users` should be 1
      and `feeds` non-empty; remove feed URLs that failed (`_news-feeds.js` FEEDS)
    - News fills with stories; Sign out of a paper → its sidebar row shows "Sign in again"

- **Media queue: an item paused mid-play keeps the Now Playing slot** · PR #74 · With nothing loaded in the player (the app was closed or reloaded after a pause), the queue had no Now Playing row, so a new episode from a higher-tier show listed above the one you were part-way through. The episode or article that was last in the player now stays at the top under "Now Playing", marked "Paused", until it is finished or removed; new episodes list under it. An episode paused on another device holds the slot through the synced listening history; an article only on the device it was played on. Playing radio or music releases the slot. Reaches the phone **only via a TestFlight build**. **After deploy:** play a lower-tier episode for a minute, pause, fully close the app, reopen once a higher-tier show has a new episode: the paused one is still on top, and the mini-player's play button resumes it. Do the same with an article (articles were covered by unit tests only).

- **Meal plan: events land on the meal they take up; Events & Notes open by default** · PR #72
  - A "Meal Plan" event shows whichever Calendar view (household / personal) is open; events show
    only on the meals they take up (8–4 workday → Lunch; evening / overnight shift → Dinner);
    Events & Notes cards start open; on a phone, dragging one person's meal onto another's shows
    only that meal's column.
  - **After deploy:** on the phone, open Meal Plan on a workday and check "Work 8a–4p" is under
    Lunch only, with the Calendar on each of its two views. Merge two people's lunch by dragging
    (a real finger drag was not tested) and check only the Lunch cards show during the drag.
- **Meal plan: per-calendar "Show on Meal Plan" switch; shared events reach the whole household** · PR #73
  - Add/Edit Calendar has a "Show on Meal Plan" switch (works for subscribed feeds). Each member's
    personal meal-plan events (title, times, repeat rule) are copied into the shared `eat` section
    (`mealPlanSharedEvents`) so the other person's meal plan shows them.
  - **After deploy / TestFlight:** Calendar → edit "MJ Work" → turn on "Show on Meal Plan"; her shifts
    should appear under Events & Notes on the meals they cover. Then open the app once on Luke's
    phone, and check Marijane's phone (also on the new build) shows "Work" under Lunch on a workday.
    Both phones need the new build: an older one drops the shared events when it saves.

## 2026-10-07 deploy (PRs #59–#70)
Web deploy plus a TestFlight build from `main`. Service worker cache bumped to v40 — hard-refresh once. The iPhone app bundles its web code, so every client change here reaches the phone only with the TestFlight build. **First:** fully close and reopen the app on every device, then check Shop → Checklist still has its 22 items (restored 2026-10-07; ISSUES.md P1).

**Inventory's page access follows Shop's (PR #70)**
PR: https://github.com/LukeDEvans/Tableplan/pull/70

Inventory is a space of the Shop page, so it no longer has its own row under "Members can access" or in personal page visibility: whoever can open Shop can open Inventory. An `inventory` entry left in a saved disabled-pages list is ignored (`accessPageKey` in app.js). No state changes. Reaches the phone **only via a TestFlight build**.

**After deploying:**
- [ ] Settings → household "Members can access": no Inventory row; a member with Shop on can open the Inventory tab.

**Shop: the checklist can no longer be erased by a sync; Inventory is a tab of Shop (PR #69)**
PR: https://github.com/LukeDEvans/Tableplan/pull/69

(1) **Fix (data loss):** the Shop checklist's item list merged as "the newer copy wins", so a device holding an empty list (fresh install, old tab, a boot before the cloud copy arrived) erased the household's list as soon as it saved anything. This happened on 2026-10-01 to all 22 items. The list now merges by id: an item leaves only when it is removed (the removal is recorded), never because one copy lacks it (`mergeChecklistConfig` in grocery-sources.js). (2) Inventory is a space of the Shop page: the title stays "Shop", it shows Shop's date header instead of today's date, it has no window frame, and the three tabs sit in the same place on all three. Switching Inventory → Shop no longer counts as opening Shop (no sweep). No new state keys. Reaches the phone **only via a TestFlight build**.

**After deploying:**
- [ ] (1) fully close and reopen the app on every device; (2) **check the checklist still has its 22 items** (restored 2026-10-07; an old build can erase it again until this is live, see ISSUES.md P1); (3) Shop → Inventory: title and date header don't change, no border.

**Media: the queue plays in Up Next order; − / + speed; episodes kept 30 days; swipe-up when idle; Back to the queue; larger menu tabs (PR #68)**
PR: https://github.com/LukeDEvans/Tableplan/pull/68

**Fix:** when an item ended, the queue played from a copy of the order made when playback started, and only the rows below the one that was started. Playing from the middle, dragging rows or a new episode arriving sent it to items lower in the list. It now plays the top of Up Next as listed when the item ends. Next sends the current item to the back of the line, and an episode that is in the queue carries on into the queue wherever it was started. **Speed** is − / value / + in steps of 0.25 (0.5× to 3×) in the article reader, the episode page and the Now-Playing window. **Stored state** no longer holds a subscription's episodes older than 30 days unless saved, queued, in a playlist or started in the last 30 days (about 550 of 629 episodes in Luke's row today); a show's page fetches its full feed when opened. Episode descriptions stay: stored state already holds none. **Swipe up** on the mini-player opens the Now-Playing window with nothing loaded too. **Mini-player tap** opens the playing episode's page and its Back button returns to the queue. Media's menu tabs are 17px text in 48px rows. Reaches the phone **only via a TestFlight build**.

**After deploying:**
- [ ] (1) fully close and reopen the app; (2) start an item from the middle of the queue and let it end: the top of Up Next should play; (3) on the iPhone, with the queue playing, drag another item to the top of Up Next, lock the phone and let the current one end (the iPhone player's path was read from code, not run on a device: ISSUES.md); (4) with nothing playing, swipe up on the mini-player; (5) open a show with no episode in the last 30 days: its older episodes should appear after a moment, and saving one should keep it after a reload.

**Shop: checked items are swept on open, no window frame, bought manual items stay gone (PR #67)**
PR: https://github.com/LukeDEvans/Tableplan/pull/67

(1) Opening Shop sweeps everything checked into "bought" (what the broom does) and closes any "Show N bought" reveal, so the list opens on what is left to buy; "Show N bought" still brings them back, and un-checking one restores it. (2) The Shop window has no navy border, shadow or inner buffer, and the list's own gutter is 10px instead of 16px: about 36px more width on every screen. CSS only; Inventory keeps its frame. (3) **Fix:** a manually typed item that was checked off came back unchecked each new shopping cycle (every Friday) and whenever the date range was changed, because checked / bought marks are kept per cycle while the manual list is permanent. Now a manual item checked off in a cycle that has ended is taken off the manual list for good the next time Shop is opened (a stamped removal, so it survives a sync), and one checked off in a cycle still ahead stays under "bought". Typing an item in again clears its old marks. Only marks from the cycle ending 2026-10-09 onward count, so nothing already on the list is removed by this change (`grocery-bought.js`). No new state keys. Reaches the phone **only via a TestFlight build**.

**After deploying:**
- [ ] (1) fully close and reopen the app; (2) Shop → check an item, go Home, open Shop: it is under "Show 1 bought", not on the list; (3) the Friday after, open Shop: manual items checked off that week are gone, unchecked ones are still there, meal-plan items are back as usual.

**Page notifications: a thin red underline under the page title, not a red dot (PR #65)**
PR: https://github.com/LukeDEvans/Tableplan/pull/65

On the home links, the page-title menu and Recreate's Travel card, a page with notifications now has its title underlined in thin red; the dot is gone. The Tasks bell and the mini-player art have no title and keep their dot. CSS only. Reaches the phone **only via a TestFlight build**.

**After deploying:**
- [ ] with a Mail suggestion or an unlabeled Finance transaction pending, Home and the page-title menu show that page's name underlined in red with no dot, and the underline clears once the item is addressed.

**Mini-player: no rewind 10 seconds button (PR #66)**
PR: https://github.com/LukeDEvans/Tableplan/pull/66

The back-10-seconds button is gone from the dock's mini-player, so the title and show name get its width (about 58px more on a phone). Rewind is still in the Now-Playing window. Reaches the phone **only via a TestFlight build**.

**After deploying:**
- [ ] with audio playing, the mini-player shows only play/pause on the right and the title runs wider; open Now Playing and confirm its skip buttons still work.

**Finance notifications window: same size as Meal Plan's, close button reachable (PR #64)**
PR: https://github.com/LukeDEvans/Tableplan/pull/64

Fixes a fault from PR #54 (live since the 2026-10-06 deploy): the Finance notifications window opened at the very top of the screen, putting its close button under the phone's status bar. It now opens in the standard notifications-window box (`notificationsWindowBox()`, dock-space.js), the same place and size as Meal Plan's. Reaches the phone **only via a TestFlight build**.

**After deploying:**
- [ ] Finance → bell: the window sits inside the page window and the ✕ closes it. A review card is taller than the window on a phone (ISSUES.md): scroll the card, or swipe right to approve.

**Dock: one standard blue for every slide; wind and UV on the weather slide (PR #63)**
PR: https://github.com/LukeDEvans/Tableplan/pull/63

The dock is now the same blue everywhere (the weather slide's night blue, `--dock-bg1`/`--dock-bg2` on `.bottom-dock`) with white text, in the light and dark themes. The mini-player takes it: white title, controls and progress line. The weather slide no longer changes colour with the weather. It has a new third line with wind speed and direction and the UV index; either one is left out when its reading is missing. CSS and `weather-ui.js` only. Reaches the phone **only via a TestFlight build**.

**After deploying:**
- [ ] the dock is blue with white text on both slides, with audio playing and with nothing playing; the weather slide shows "Wind … · UV …" under the place name and nothing is cut off on the phone; with a weather alert showing, all four lines fit.

**Notifications windows: never open with nothing in them (PR #62)**
PR: https://github.com/LukeDEvans/Tableplan/pull/62

The standard for every bell (CLAUDE.md, UI conventions): an empty bell does not open its window ("You're all caught up." toast), and the window closes by itself when the last item is addressed. Applies to Meal Plan recipes, Recipe Box review, Mail suggestions, Explore proposals and Finance's review deck (which loses its "All caught up" screen). Reaches the phone **only via a TestFlight build**.

**After deploying:**
- [ ] Meal Plan → bell with no badge: nothing opens. With recipes: add or dismiss the last one and the window closes. **Mail** and **Finance** were not checked before merge (ISSUES.md): clear the last suggestion / the last review card and confirm each window closes and the page behind it is up to date.

**Meal Plan notifications: no scrollbar on the side (PR #61)**
PR: https://github.com/LukeDEvans/Tableplan/pull/61

The recipe-notifications window (list and cards) no longer shows a scrollbar; it still scrolls. CSS only. Reaches the phone **only via a TestFlight build**.

**After deploying:**
- [ ] Meal Plan → bell with several new recipes: no scrollbar down the side, and swiping up still moves to the next card.

**Mail: emails no longer render as overlapping, unreadable text (PR #60)**
PR: https://github.com/LukeDEvans/Tableplan/pull/60

**Fix:** with remote images blocked (the default), every email lost its own stylesheet, so phone layouts never applied, the email was shrunk to fit, and the iPhone then enlarged the text past its line spacing. The stylesheet is now kept, the frame stops the iPhone from resizing text, and a wide email is no longer shrunk twice. No state changes.

**After deploying:**
- [ ] (1) fully close and reopen the app; (2) open "This week in Claude Code" (Oct 3) on the iPhone: text should fill the pane with normal line spacing (the iPhone itself was not available to test on); (3) open a few other newsletters with images still blocked and check none is tiny or clipped at the right edge.

**Media: the reader's Play button plays the open article; an add while the queue plays is reached (PR #59)**
PR: https://github.com/LukeDEvans/Tableplan/pull/59

**Fix:** with another article loaded (or, in the iPhone app, a podcast playing), pressing Play in an open article resumed that other audio. It now starts the article that is open, and the button shows Pause only while that article is the one being read. **Fix:** "Add to queue" while the queue was already playing put the item in the list but playback never reached it, because the queue plays from the order captured when it started. The add now joins that running order (and the iPhone app's up-next list). No state changes.

**After deploying:**
- [ ] (1) fully close and reopen the app (or install the new TestFlight build) first; (2) play any article, open a different one, press Play: the second one should start; (3) on the iPhone, with a podcast playing, open an article and press Play (the native path was read from code, not run on a device); (4) with the queue playing, add an older episode and let the queue run to it.

## 2026-10-06 deploy (PRs #51–#56)
Web deploy plus a TestFlight build from `main`. Service worker cache bumped to v39 — hard-refresh once. The iPhone app bundles its web code, so #51, #54 and the client side of #52–#56 reach the phone only through the TestFlight build.

**Weather and other server features in the iPhone app: real root cause (PR #51)**
PR: https://github.com/LukeDEvans/Tableplan/pull/51

In the app, URL helpers used local-dev `/api/<name>` paths that 404 on the live site. The native fetch shim now maps them to the deployed functions (`nativeApiPath`, native-bridge.js).

**After deploying (needs the TestFlight build):**
- [ ] the dock's weather slide shows local weather; Weather → search "Minneapolis" returns results
- [ ] spot-check Watch search and a recipe import in the app

**News page (PR #52) and News via RSS with the `news_articles` table (PR #53)**
PRs: https://github.com/LukeDEvans/Tableplan/pull/52 · https://github.com/LukeDEvans/Tableplan/pull/53

New top-level News page: stories from NYT / The Economist / Star Tribune / The Athletic emails and, hourly at :07, every section feed. Stories live in the `news_articles` table (migration applied 2026-10-06; the table held 496 rows just before this deploy).

**After deploying:**
- [ ] **open News right away** so the first sign-in check runs (the sweep and the feed job only collect for signed-in papers)
- [ ] Sync Settings → re-save the Economist cookie and confirm the Economist doesn't show "Sign in again" (untested against the live site; ISSUES.md)
- [ ] after the next hour, read the `newsfeeds_status` row in `tableplan_states` and remove feed URLs that failed (`_news-feeds.js` FEEDS), especially the Star Tribune's
- [ ] News shows stories across sections; after the next NYT / Star Tribune email, stories land in sensible sections (unknown Star Tribune labels go to More)

**Windows fit the screen above the bottom dock (PR #54)**
PR: https://github.com/LukeDEvans/Tableplan/pull/54

Windows sized to the full screen now end at the dock's top; context menus and popovers clamp to it.

**After deploying (needs the TestFlight build):**
- [ ] Meal Plan → bell: the window's bottom border shows above the dock
- [ ] open the assistant: the text box and send button sit above the dock
- [ ] Mail → bell with many suggestions: the last one is reachable (not checked before merge; ISSUES.md)
- [ ] long-press a row near the bottom of a list: its menu opens fully above the dock

**Settings: each setting syncs by its own stamp and saves within seconds (PR #55)**
PR: https://github.com/LukeDEvans/Tableplan/pull/55

A changed setting could be put back to its old value by a device holding a stale copy. Each tracked setting now carries its own "last changed" stamp, the later stamp wins the merge, and a changed setting is written within about 1–5 s. New keys: `configSettingStamps`, `mediaSettingStamps`, `grocerySettingStamps`, `recreateSettingStamps`. The Supabase write path was tested against the local backend only.

**After deploying:**
- [ ] change the theme on one device, close the app at once, open another device: the new theme arrives and is not put back
- [ ] toggle two different Mail AI settings on two devices: both survive
- [ ] watch Supabase usage for a day: settings writes are capped at one early write per 5 s, dirty sections only
- [ ] a device still on the old code can undo a setting until it reloads — reload every device (and install the TestFlight build)

**Media: long-press menu with "Add to queue"; newsletters back in the queue (PR #56)**
PR: https://github.com/LukeDEvans/Tableplan/pull/56

Press and hold (or right-click) an article, album or song for a menu with Add to queue; added items go to the end of the Media queue. Emailed newsletters whose text had moved to the content store are back in the queue. New keys: `mediaQueueAdded`, `mediaQueueRemoved`.

**After deploying:**
- [ ] open the queue and confirm today's newsletters are listed
- [ ] add one Apple Music or Internet Archive album and play it from the queue (only uploaded-library albums were run locally; ISSUES.md)
- [ ] on the iPhone (TestFlight build), press and hold an album and a publication article: the system text-selection / image callout doesn't appear over the menu

## 2026-10-03 deploy #2 (PR #49)
Server-only deploy (Netlify functions). No client change, no service-worker bump, no TestFlight build — the app already installed picks it up.

**Weather + store search work in the iPhone app (PR #49)**
PR: https://github.com/LukeDEvans/Tableplan/pull/49

Root cause of "couldn't reach location search" in the app: the `weather`, `google-places` and `instacart-list` functions answer only an origin allowlist, and the iPhone app's requests (replayed natively by CapacitorHttp, with no Origin) got no `Access-Control-Allow-Origin`, so iOS discarded every reply. Requests with no Origin now get `*`, and `capacitor://localhost` is on the list; other websites' pages stay blocked. Server-only: no TestFlight build needed.

**After deploying:**
- [ ] in the iPhone app, the dock's weather slide shows local weather; Weather → search "Minneapolis" returns results; Shop → store search still finds stores; Shop → "Send to Instacart" shows as available.

## 2026-10-03 deploy (PRs #41–#47)
Web deploy plus a TestFlight build from `main`. Service worker cache bumped to v38 — hard-refresh once. The Swift changes (#41 voice speed, #47 location) reach the phone only through the TestFlight build.

**On-device voices read far too fast (PR #41)**
PR: https://github.com/LukeDEvans/Tableplan/pull/41

On-device voice previews and read-aloud now follow Settings → Voice "Speaking speed"; the iOS plugin maps speed onto Apple's speech-rate scale with a gentle curve instead of the old linear one.

**After deploying:**
- [ ] **install this deploy's TestFlight build** (the Swift plugin change only ships with a native build), then preview an iPhone voice at 1.0× and 1.5× in Settings → Voice. If the speed is still off, tune the `0.35` exponent in `avSpeechRate()` (`ios/App/App/LiveTtsPlugin.swift`).

**Bottom dock: there from launch; no dots; circular swipe (PR #42)**
PR: https://github.com/LukeDEvans/Tableplan/pull/42

The dock is in the page from first paint instead of appearing after sign-in + the cloud load; the dots pill above it is gone; swiping left/right wraps around the slides (player → weather → player …).

**After deploying:**
- [ ] on the iPhone, cold-launch the app and confirm the dock is there immediately; swipe both ways several times (it should keep cycling, short drags spring back, a swipe never opens Media/Weather); tap the bar → Media, tap the weather slide → Weather, swipe the player up → Now-Playing.

**Bottom dock auto-advances (PR #43)**
PR: https://github.com/LukeDEvans/Tableplan/pull/43

Every 8 s the next dock slide slides in from the right (player → weather → …); touching/swiping/hovering the dock holds it for 30 s; paused in the background and while Now-Playing is open.

**After deploying:**
- [ ] on the iPhone, leave the app idle on any page and watch the dock rotate; tap play and confirm the bar doesn't slide away for ~30 s.

**Media removed from the landing page + page menu (PR #44)**
PR: https://github.com/LukeDEvans/Tableplan/pull/44

Media is reached from the bottom dock's mini-player (tap the bar); its news-article notification dot moved onto the mini-player's art corner. `#media` still routes.

**After deploying:**
- [ ] confirm the home links and the page-title menu no longer list Media, tapping the mini-player opens Media, and a pending news suggestion shows the red dot on the mini-player art.

**Recreate hub: Explore / Exercise / Leisure rows; Exercise + Explore leave the nav (PR #45)**
PR: https://github.com/LukeDEvans/Tableplan/pull/45

Recreate now has three subsections, each a sideways-scrolling row of cards: Explore (a Travel card with new art → the Explore page), Exercise (every workout card + an "Add exercise" card), Leisure (Sailing, Piano). Exercise and Explore are gone from the landing page and page menu (`#sweat` / `#explore` still route); Recreate shows when any of the three is on, and Explore's notification dot moved to Recreate + the Travel card.

**After deploying:**
- [ ] on the iPhone, open Recreate, swipe each row sideways, tap a workout (records), tap Travel (opens trips); in the row, long-press a workout card for Edit / Delete (swipe-to-edit is off in the row so sideways swipes scroll — PR #46).

**Weather: location on by default (iPhone app fix) (PR #47)**
PR: https://github.com/LukeDEvans/Tableplan/pull/47

Root cause: the iOS app's Info.plist had no `NSLocationWhenInUseUsageDescription`, so iOS silently refused location to the app's web view (browsers on the laptop don't need it). Adds the usage string + a native `LiveLocation` plugin (CLLocationManager — one iOS prompt, no second "localhost" prompt), `device-location.js` (native plugin in the app, `navigator.geolocation` elsewhere), and makes current location the default: with no saved place picked, the app asks once per device at launch (the iOS prompt is the agreement), then the weather page and dock ticker follow the device. A "no" isn't asked again; a picked saved place still wins.

**After deploying:**
- [ ] **install this deploy's TestFlight build** (Info.plist + Swift plugin only ship with a native build). Then cold-launch: the iOS "Allow Live to use your location?" prompt appears once → Allow → the dock's weather slide shows local weather; open Weather → "Current location" loads. If you'd already denied it: Settings → Privacy & Security → Location Services → Live → While Using.

## 2026-10-01 deploy #2 (PRs #28, #33, #34–#40)
Web deploy plus a TestFlight build from `main`. Service worker cache bumped to v37 — hard-refresh once.

**iPhone app: native player for podcasts + radio; Apple voice per device (PR #28)**
PR: https://github.com/LukeDEvans/Tableplan/pull/28

The iPhone side ships through TestFlight. In the app, podcasts, radio and non-Apple music
(Internet Archive, Jamendo, uploaded songs) play on the native player (lock-screen and AirPods
pause/resume), and articles default to the best installed
Apple voice. The voice choice is per device, so choosing one on the phone no longer changes
the web app's voice. The website itself is unchanged.

**After deploying:**
- [ ] Web: Settings → Voice still shows the household voice (not "device").
- [ ] Next TestFlight build from `main`: podcast/radio lock-screen pause and resume still work.

**iPhone app: full NYT / Economist / Star Tribune articles with your login (PR #33)**
PR: https://github.com/LukeDEvans/Tableplan/pull/33

Ships through TestFlight. The website is unchanged. In the app, Media → menu → Sync Settings →
"Full articles on this iPhone" signs in to each paper in an in-app browser. Articles from those
papers then load in full on the phone. A cut-off article shows "Sign in" / "Reload full article".

**After the next TestFlight build:**
- [ ] Sign in to The Economist (email + password), then open an Economist article from a news-email
   card. It should load in full. Repeat for NYT and Star Tribune.
- [ ] Sign out of one paper, reopen a new article from it: it should come back cut off with the
   Sign in / Reload buttons.

Checks for work that's already live are in [POST_DEPLOY_CHECKS.md](POST_DEPLOY_CHECKS.md).

**Media "Playlist" → "Queue"; Shop date-button tap colour; weather search (PR #34)**
PR: https://github.com/LukeDEvans/Tableplan/pull/34

The main media list is now called "Queue" (sidebar tab, settings menu and modal, add/remove
buttons, toasts). Named podcast/music playlists still say "playlist". The Shop date buttons no
longer stay patina after a tap on a phone. Weather search accepts "City, ST" and shows a
message when nothing matches or the search can't be reached. In the iPhone app, the weather
page now reaches its server function (it was fetching the app's own page).

**After deploying:**
- [ ] Phone: tap a Shop date button, pick a date. The date goes back to dark once your finger lifts.
- [ ] Weather → Search a place: "Portland, OR" and "Austin TX" each list the right city.
- [ ] Next TestFlight build: the Weather page loads a forecast and search returns cities.

**Header receipt scanner (Camera / Photo → Shop + Finance); User moves into Settings (PR #35)**
PR: https://github.com/LukeDEvans/Tableplan/pull/35

The top-right button is now a receipt scanner (Camera / Photo). A scanned receipt opens Shop's
review dialog already reading it. (The background Finance save this PR first added was replaced
by the one receipts list in the receipts-consolidation PR. A saved receipt reaches Finance from
`state.receipts`.) "User" (the profile window, now titled "User") is the first Settings menu item;
the Settings button always opens the menu. Shop receipt scan also works in the iPhone app now.

**After deploying:**
- [ ] Phone: scanner → Photo, pick a receipt. Shop's review opens with the lines filled in.
- [ ] Settings → User opens the profile window; log out / log in still work.
- [ ] (Receipts in Finance: see the receipts-consolidation entry.)

**iPhone app: header Camera opens Apple's document scanner (PR #36)**
PR: https://github.com/LukeDEvans/Tableplan/pull/36

Ships through TestFlight. The website is unchanged. In the app, scanner → Camera opens Apple's
document camera, which finds the receipt's edges, straightens and crops it, and can take several
pages. Nothing is saved to Photos. It also adds the camera permission (`NSCameraUsageDescription`),
which was missing, so any camera use in the app would have crashed it.

**After the next TestFlight build:**
- [ ] Scanner → Camera: the first time, iOS asks for camera permission. Scan a receipt (try a long
   one with 2 pages). Shop's review should open already reading it.
- [ ] Check the Photos app: the scan is not there.

**Receipts: one list for Shop and Finance (PR #37)**
PR: https://github.com/LukeDEvans/Tableplan/pull/37

Shop's receipts are now the one receipts list (see RECEIPTS.md). One scan reads the grocery lines
and gives each line a Finance budget category, which you can correct in the review. Finance →
Insights → Receipts shows these receipts and matches each to its charge (same total ±2¢, within
4 days). Itemize builds the split, and View opens the receipt in Shop. Email and online-order
receipts are copied into the same list, tagged in Shop, and never touch grocery price history.

**After deploying:**
- [ ] Scan a real receipt: in the review, each line should show a sensible budget category. Save it.
- [ ] Once the charge posts (and the bank refreshes): Finance → Insights → Receipts shows it as
   matched. Itemize gives a split by those categories, and View opens it in Shop.
- [ ] Shop → Receipts: email/online-order receipts appear tagged, and the price-history trends don't
   include Amazon-style items.
- [ ] Delete an imported email receipt in Shop, reload the next day: it doesn't come back.

**Bottom dock: permanent mini-player + weather ticker; idle play + "when the queue ends" pick (PR #38)**
PR: https://github.com/LukeDEvans/Tableplan/pull/38

A permanent, swipeable dock along the bottom of every page: the mini-player and a weather summary,
with a small dots pill above it to switch. Tap the mini-player → Media; swipe it up → Now Playing;
tap the weather → Weather (no longer on the home grid or the page menu). Play with nothing loaded
resumes the last thing, else the next queue item, else the new Media → Queue settings pick
("When the queue ends, play"), which also starts by itself when the queue finishes.

**After deploying:**
- [ ] Phone: the dock shows on every page; swipe between player and weather; the dots follow. Nothing
   on any page is hidden behind it (check Mail, Shop's bottom buttons, toasts, the voice button).
- [ ] Weather slide shows your place's temperature/condition/high-low; tap → Weather page.
- [ ] Stop everything, tap play on the idle bar: it resumes the last radio station / podcast, or the next
   queue item.
- [ ] Media → Queue settings: set "When the queue ends, play" to a playlist; let the last queue item
   finish (phone unlocked, then locked — see ISSUES.md for the locked/native-queue gap).
- [ ] Swipe the mini-player up → the Now-Playing window opens.

**Contacts moves inside Mail (PR #39)**
PR: https://github.com/LukeDEvans/Tableplan/pull/39

Contacts is gone from the home grid and the page menu. It's a "Contacts" item under the mail
folders (and "Open contacts" on the Connect Gmail screen); the contacts list replaces the message
list, with a ‹ back-to-Mail button. Calendar birthdays, the assistant and #contacts open it there.

**After deploying:**
- [ ] Mail (Gmail connected): Contacts sits at the bottom of the folder list (and in the collapsed
   rail on desktop). Tap it → contacts list; tap Inbox or ‹ → back to mail.
- [ ] Phone: one row of contact controls, nothing clipped; the mail drawer still opens from Mail.
- [ ] Tap a birthday on the calendar → that contact opens inside Mail.
- [ ] Settings menu (while in Contacts): Import / Export contacts still work.

**iPhone app: connect Gmail in-app (PR #40)**
PR: https://github.com/LukeDEvans/Tableplan/pull/40

In the app, Mail → Connect Gmail opens Apple's sign-in sheet (Google allows it there), signs in,
closes itself and returns to Mail connected. Server: gmail-auth/gmail-callback carry a signed
"started in the app" marker and send the sheet back to com.mrlukedevans.live://gmail.

**After deploying + the next TestFlight build:**
- [ ] App: Mail → Connect Gmail (disconnect first if already connected) → Google sign-in sheet →
   allow → the sheet closes and the inbox loads with "Gmail connected — <address>".
- [ ] Web: Connect Gmail in a browser still works and lands on Mail (#mail?gm_connected=1).

## 2026-10-01 deploy (PRs #21, #22, #25, #26, #27, #31)
Web deploy plus a TestFlight build from `main`.

**Native Apple Music in the iOS app (PR #25):**
- [ ] Web: Settings → Apple Music shows "Using: web (MusicKit JS)", and sign-in still works.
- [ ] Next TestFlight build from `main` (not the branch): Apple Music still signs in natively.

**Podcasts: large feeds no longer fail (PR #26):**
- [ ] Open White Coat Investor; recent episodes (late Sept) appear after the next refresh.
- [ ] Re-subscribe to NPR Politics; it should succeed (or show the actual error).

**Sync, auth and service-worker fixes (PR #27):**
- [ ] Sign in on web and phone; edit something on each and confirm it appears on the other.
- [ ] Make an edit and immediately another; reload; both are there.
- [ ] Hard-refresh once so the new service worker (v36) takes over; the app still loads offline.

**Full-app audit fixes (PR #22):**
- [ ] Mail: open an HTML newsletter; it renders (images and links) with nothing broken.
- [ ] Settings → Mail: reconnect Gmail once to confirm sign-in still completes.
- [ ] Calendar: a subscribed ICS calendar shows events at the right local times.
- [ ] Next morning: the presynth cron log shows "triggered worker → 202" (not 403).

**Refresh changed data when the app returns (PR #21):**
- [ ] Leave the iPhone app in the background, edit something on the web, reopen the app after
   2+ minutes: the edit is there without a restart.

**Pre-deploy fixes: deleted trip/chore items no longer come back, Explore on phones (PR #31):**
- [ ] Change a trip's dates on the web, then open Calendar on the phone: one trip bar, not two.
- [ ] Explore on the phone: open and close the trip list; nothing peeks out beside it.

**Tasks title readable on phones (PR #29, merged before this deploy):**
- [ ] On the phone, open Tasks: the title reads "Tasks" in full, and the week label may shorten with "…".

## 2026-09-30 deploy (commit 51efeca, PRs #8–#24)
Luke confirmed these 2026-09-30 (native Apple Music working on TestFlight build 20260930.0247).
Still open: the Instacart key + first send, and the drop-publications migration (Luke's call).

**Needs a new TestFlight build** (the builds sent 2026-09-30 01:45–02:25 UTC were built from
`main` — the workflow ignored the branch — so they carry this deploy's web code but not PR #25):
- [x] Phone app on schema 7: any TestFlight build from 2026-09-30 01:45 UTC on is built from
      main, so it already matches the website.
- [x] Native Apple Music (PR #25 — only in a TestFlight build made from its branch, not merged yet): sign in, play a Discover song, let it roll into the next song while
      locked, lock-screen buttons (CAPACITOR.md "Native Apple Music").
- [x] Articles keep reading with the phone locked (the speech plugin is now actually built in).
- [x] Export a file from Music / Contacts / Finance / Settings → Export → share sheet opens.
- [x] Recipe Box and a couple of dialogs sit below the status bar; mini-player flush at bottom.

**Web / accounts:**
- [x] Reload open browser tabs (and the Chrome extension — recipe imports now go to the review
      queue; import one and check it appears under the bell).
- [x] Siri shortcut: "add bread and remind me to call the plumber" — both land.
- [x] Remove a grocery item on one device; it stays gone on the other.
- [x] Assistant: ask something cross-area ("what's my week look like?").
- [x] Settings → Mail AI: the newly-on features are what you want (vegetarian filter; SimpleFIN
      alert auto-delete; NYT / Economist / Star Tribune articles).
- [x] Media bell: Star Tribune cards appear after the next newsletter; Netlify logs show
      `[news-links] <paper>: N new of M unseen`.
- [x] Safari: Apple Music sign-in opens Apple's popup; Discover → Pop shows genre-specific charts.
- [ ] Instacart: set `INSTACART_API_KEY` (+ `INSTACART_ENV=production`) in Netlify, do one send.
- [x] History log is recording (checked 2026-09-30: 87 media_play, 14 article_read rows;
      ai_chat / practice_event appear once used).
- [ ] Supabase SQL editor: run `migrations/2026-09-29-drop-publications.sql` (drops the unused
      publications/feeds/articles tables — irreversible, your call).
