# Post-deploy checks

Checks for work that is already **live**. (Work that has NOT shipped yet is in
[UNDEPLOYED.md](UNDEPLOYED.md).) When deploying, move each UNDEPLOYED.md entry's
post-deploy steps here, **sorted by who can do them** (below). Tick items off as
they're done; delete them once ticked. The full history of every deploy's notes is in
git (this file before 2026-11-17).

**Who does what** (Luke, 2026-11-17 — "I don't have the time to do the testing myself"):
- **Claude, server** — database, Supabase/Netlify logs, status rows, the `liv_health`
  connector tool. Done in any session without Luke.
- **Claude, laptop** — anything on the web app, done by Claude in Luke's own Chrome
  (Claude in Chrome, already signed in) while Luke's laptop is on.
- **Luke, iPhone** — only what needs the phone itself (TestFlight build, lock screen,
  Face ID, native players, the camera). Kept short and batched: one pass per TestFlight build.


## Deploy 2026-11-17 night (all of UNDEPLOYED.md as of #266)
Steps copied from UNDEPLOYED.md; Claude sorts them into the sections above after the deploy and does the server and Chrome ones. Entries whose step is "none" can be deleted.
- [ ] **Listen: one queue and player per person** (#237): reload every open web tab (an old tab keeps writing positions to the media rows). In the API logs, look for one `tableplan_states?id=in.(…:media,…:media)&select=id,podcastProgress:state->…` read per device and a new `u-<uid>:listen` row for Luke and for Marijane. On the phone, start an episode in Personal, switch to Household and let it finish: it should be gone from the queue in both views.
- [ ] **News: the Front page leads with the day's biggest events** (#238): open News on the phone — the lead card and the dock ticker should show the biggest current story, with "Lead story" on it. In the API logs, one `news_articles?select=id,url,title,subtitle,paper,section,origin,published_at,lead_at` read per Front page open (at most one per 5 minutes per warm function). If the order looks wrong, set `NEWS_FRONT_RANK_DISABLED=1` in Netlify to go back to newsletter leads.
- [ ] **News: NPR as a paper, BBC / AP as ranking signals, and a check when News opens** (#239): after the next hourly run read `newsfeeds_status` — the nine `feeds.npr.org` feeds and the three `signal: true` feeds (two BBC, one Flipboard/AP) should be `ok`; fix or drop any that aren't. Check the `news_signals` row has `items` and a fresh `checkedAt`. Open News twice within ten minutes: the API logs should show one `tableplan_states?on_conflict=id` claim and one round of feed reads, not two. Open an NPR story in the reader. Switches if needed: `NEWS_NPR_DISABLED=1`, `NEWS_OPEN_CHECK_DISABLED=1`. **2026-11-18 (server part done):** the hourly job failed every run after the deploy because `news_articles_paper_check` didn't allow `npr`. Fixed by migration 20261118170000 (#268). The 12:07 run was fine: 187 new stories, 46 of them NPR, and only 2 of all the feeds failing (Athletic Gophers / Minnesota-Morris, 404). Still to do: the `news_signals` row, the open-check timing, and an NPR story in the reader (in Chrome).
- [ ] **Photos: count the iPhone's library (step 1)** (#240): nothing on the web beyond the Beta panel saying it's a check for the iPhone app. On the phone: Settings › Beta › Photos Check › Count my library, allow full access, then "Copy results".
- [ ] **Photos: the stage 1 tables** (#241): none. (Same day, the never-applied `supabase-nutrition-estimates.sql` columns were added to `eat_recipes`, so recipe loads and saves stop failing once and retrying; watch the API logs for `eat_recipes` 400s going away — no deploy needed for that.)
- [ ] **Photos step 2: the first sync into Personal** (#242): (web): nothing beyond the Settings sheet fix; the sync is phone-only. On the phone: run Sync to Personal on Wi-Fi with the screen open; check the totals and the newest thumbnails; Supabase API logs show no repeated reads of `photo_items`.
- [ ] **iPhone uploads around CapacitorHttp** (#244): on the phone, Photos Check › Sync again (thumbnails appear under the button); add a file to Document from the phone and open it.
- [ ] **Photos: device keys + sync protocol** (#246): none for the web.
- [ ] **Photos: native background sync** (#247): none for the web (the panel's native part only shows in a build with the engine).
- [ ] **Photos: the page (step 3)** (#249): on the laptop, open Personal › Photos: thumbnails load, a photo opens with "Full size is on your iPhone", a laptop delete is carried out on the phone next time Photos opens there.
- [ ] **Photos: the landing and page-menu buttons open the page** (#251): tap Photos on the landing page and from the page menu (Personal view) — both open the Photos page.
- [ ] **Listen: music playlists and favourites merge instead of newest-copy-wins** (#252): reload every open web tab (an old tab can still overwrite the library). On the phone, make a playlist, then open Listen › Music on the laptop: it should appear and survive the laptop saving something in Listen. Delete a test playlist on one device: it stays gone on the other.
- [ ] **Landing: logo and page list use the top of the screen** (#254, #255): on the phone, the landing page shows every Personal page centred, without scrolling; tap the settings gear and the scan button; swipe across the logo to change views.
- [ ] **Issues sweep: boot re-send fix, stamped lists, news feeds** (#256): liv_health — history writes per day drop (was ~13 bursts of 12 rows from the iPhone); the API logs show no PATCH burst ~3 s after a cold boot (the console's `[sync] after load, rewriting changed sections` line names any section still re-sent). After the next nightly news run, `newsfeeds_status` has no failing feeds. Remove a radio favourite on one device, open the other: it stays gone.
- [ ] **Claude Duet connector (`liv-mcp`) and `liv_health`** (#253): none.
- [ ] **News: the Star Tribune's Politics, Nation, World and Health stories come back** (#257): after the next hourly run, `newsfeeds_status` shows every startribune feed 200, and `news_articles` has fresh startribune rows in politics / us / world. **2026-11-18:** the 12:07 run stored 20 Star Tribune stories (mn, sports, culture, opinion, science, business), but none in politics, us or world yet. Recheck after a few more runs before calling it done.
- [ ] **The page menu stays open over an open email** (#258): in Mail, open an email, tap the page title: the menu stays open.
- [ ] **Functions refuse a sign-in that skipped the authenticator code** (#261): (Claude): in the function logs, no new 401s from signed-in use; open Mail, News and Shop in Chrome and check they load. The security-definer RPCs got the same check in #264 (migration 20261117240000, applied). Before Luke turns the code on: the Chrome extension has no code step (ISSUES.md).
- [ ] **Settings › Beta › Connected Assistants** (#262): (Claude, in Chrome): open the panel, check the Duet key is listed, make a throwaway key, revoke it; undo one harmless change. (Luke, iPhone): open the panel once to check it fits.
- [ ] **Mail: emptying the search box puts the folder back; a search covers all mail** (#263, #265): (Claude, in Chrome): search Mail for something archived and check it's found; clear the box with the x and check the folder comes back.
- [ ] **Duet: review fixes** (this branch): none.

## Luke, iPhone (one pass, ~15 min)

Do these once your phone has the newest TestFlight build.

- [ ] **Face ID + sign-in code** (#222) — open the app: Face ID asks. Leave it 5+ min, come
      back: it asks again. Marijane's phone asks too.
- [ ] **Podcasts download and keep going** (#225, #227, #228) — start a new episode, lock
      the phone, walk out of Wi-Fi: no jump back. Let one episode run into the next while
      locked. Tap the playing episode's row: it doesn't jump back.
- [ ] **An interrupted article carries on** (#220) — text yourself mid-article: it resumes;
      skip back/forward on the lock screen moves by sentences.
- [ ] **The Amplifier with the phone locked** (#217) — play a show through two songs locked;
      pause/resume from the lock screen during a song.
- [ ] **Reminders** (#95, #99) — Settings › Notifications › Turn on (none are set up yet:
      `live_notification_prefs` is empty). Set a reminder 5 min out, lock the phone: it
      arrives; tapping it opens the event.
- [ ] **Messages on Marijane's phone** (#201) — only your device is set up. She installs the
      build, Message › Messages › Set up on this iPhone; send each other a message and a
      recipe card; compare safety numbers.
- [ ] **Document on the phone** (#215, #218, #244) — open Household Document (no Face ID);
      add a file from the phone and open it; open the Safe (Face ID asks); a file's **Open**
      → swipe to the app switcher: it closes and isn't in the snapshot.
- [ ] **Receipt → Personal** (11-12) — mark a scanned receipt Personal; a few seconds later
      it's in Personal › Document › Receipts and gone from Household.
- [ ] **Link Test** (#173, #186) — Settings › Admin › Beta › Link Test: tap each service,
      bank, store and maps row → Copy results → paste into a chat so wrong links get fixed.
- [ ] **Both phones on a current build** — tell Claude once Marijane's phone has a build
      from 2026-11-12 or later; that unblocks two server clean-ups below.

## Claude, laptop (tonight, in Luke's Chrome)

- [x] **Google Calendar: connect it** (#90) — **done 2026-11-17 (Luke approved Google's screen; connected in Personal, his choice):** 1 account, 4 calendars linked; Personal shows them with timed events; a test event made in Google appeared in ~4 min at the right time (then deleted). The "Ready to leave Google?" severance report wasn't opened yet.
- [x] **Word processor + attachments** (#223, #234, #235) — **checked 2026-11-17 in Luke's Chrome:** the 2027Holiday .docx opened "From email · view only", Save to Document made a working doc (but the Document page showed blank until reopened — ISSUES); an .ics opened as an event card with Add to Calendar. No .csv / .vcf email handy, so those weren't tried.
- [ ] **Document on the laptop** (#213, #215, #218) — (2026-11-17: Household Document opens and lists its receipts; the PDF drag and passkey lock still need Luke) — Household Document opens; drag a PDF
      in (then check it on the phone); passkey lock on/off.
- [x] **Deletes stay per view** (#229) — **checked 2026-11-17:** Nosferatu (1922) added to Personal and Household; removed from Household, still in Personal (server rows checked); removed there; gone from both rows and after a reload.
- [x] **Two people's Watch ticks both stick** (#206) — **retired 2026-11-17 (Luke): rare in practice and hard to test; trusted.**
- [x] **Mail folder switching** (#221) — **checked 2026-11-17:** Inbox ↔ Trash three times about a second apart: no error; archive, switch away and back: gone. Ten switches 200 ms apart right after opening an email still hit "Quota exceeded" (recovers within a minute) — ISSUES P3.
- [x] **Watch: a show opens where you are** (#210) — **checked 2026-11-17:** SNL opens on Season 52 with watched episodes struck through.
- [ ] **Display per view** (#219) — Household: upload a logo, rename the view.
- [x] **Version stamp** (#176) — **checked 2026-11-17:** Settings shows "Version 0fec005 · Nov 13, 1:57 PM", the last [deploy] commit.
- [x] **Link the laptop browser in Messages** (#201) — **done 2026-11-17:** Luke scanned the QR; the laptop shows the Marijane conversation.
- [ ] **Take `receipts` out of the grocery row** (11-12) — after both phones run a build
      from 2026-11-12+: the row still holds 27 receipts, `fin_receipts` has the same 27.
- [ ] **Sync re-sends every row ~13×/day** — the #207 check fails (ISSUES.md P2); re-check
      after the fix with `liv_health` and the edge logs.
- [ ] **News feeds** — 23 of 88 failing (ISSUES.md P2); re-check `newsfeeds_status` after the fix.
- [ ] **Recipe load 400s from the iPhone** — ISSUES.md P3; gone once fixed.

## Decisions for Luke (not tests)

- **Drop the unused `publications` / `feeds` / `articles` tables** (2026-09-30) —
  `migrations/2026-09-29-drop-publications.sql`, irreversible; `publications` has 0 rows.
- **Instacart** — `INSTACART_API_KEY` can't be set until Instacart opens developer
  sign-ups again (closed as of Oct 2026).
- **Google / Apple sign-in providers** — need a look in the Supabase dashboard (ISSUES.md).
- **Google Docs import** — turn on the Drive and Docs APIs and the two read-only scopes in
  the Google Cloud project behind `GOOGLE_CLIENT_ID` (#223).

## Verified by Claude, 2026-11-17 (server)

- Finance nightly job: ran 11:40 UTC, ok, 14 accounts, 147 transactions upserted, snapshot taken.
- Messages: `msg_inbox` empty (rows deleted on delivery, as designed).
- Household Listen / Watch reset (10-30): both rows still carry the reset marker; the
  household Watch list has since been filled on purpose (46 titles), Listen podcasts 0.
- News: For you on, AI tagging ok (12 tagged, no errors), title fixing reads pages
  (`pagesFound` 1), 207 new stories in 24 h — except the failing feeds above.
- Recipes no longer upserted on every open (#176): 0 `eat_recipes` POSTs in 24 h.
- Receipt scans write their result rows (#172).
- Shop checklist intact (10-07 worry): 23 items.
- Finance account-view reads (#146, #148): 44 small reads in 24 h, none on a timer.
- `doc-storage`: no 403s in 24 h.
- `memberDiets` present in the eat row (#100).
- History log recording: 138 rows in 7 days (media_play, article_read).

## Retired 2026-11-17

Every check from the 2026-09-30 → 2026-10-30 deploys not listed above, and the UI-only
checks from 11-11 that Luke has used daily since, were retired: most describe screens that
have since been redesigned (grouped menus → flat, Recreate → Leisure, Media → Listen,
Contacts inside Mail, the Watch panel's several rounds, the dock's dots and auto-advance),
and the rest (weather in the app, receipt scan, Mail rendering and zoom, Shop sweep, queue
order, notification windows, theme sync) have been exercised by daily use for weeks with
no open issue. Anything that breaks shows up in ISSUES.md or `liv_health` instead.
