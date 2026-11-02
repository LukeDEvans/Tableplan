# Post-deploy checks

Checks to do after a deploy — everything here is already **live**. (Work that has NOT
shipped yet is listed in [UNDEPLOYED.md](UNDEPLOYED.md).) When deploying, move each
UNDEPLOYED.md entry's "After deploying" steps here under a heading for that deploy.
Tick items off as they're done; delete a deploy's section once it's all ticked.

## 2026-10-30 deploy (Messaging; Watch panel and YouTube; NYT reader; newspaper sign-in; News titles; The Amplifier music shows; Household Listen/Watch reset; Dutch card picture)
Web deploy from `main` (#191–#201) plus a TestFlight build started from `main` the same day (it carries the messaging plugins, the NYT reader and the music-show player). Messaging migrations **already applied** (2026-10-30, 2026-10-31). Service worker cache bumped to v54 (hard-refresh once on the laptop). No new env vars.

- **Messaging steps 2–7: the Messages tab** — the Mail page becomes **Message** with Messages | Mail tabs; end-to-end encrypted messages between household (and business) people: phone setup, linking a browser by QR or code, one-on-one and group conversations, app cards, disappearing messages (1 week by default), read receipts, delete for everyone, safety numbers; the second review's fixes (MESSAGING_DESIGN.md §17–§18). Both migrations are **already applied** (2026-10-30 tables; 2026-10-31 limits) · #201 · **Netlify deploy** (web + `msg_prune` in the daily job) **and a TestFlight build** (Keychain + QR scanner plugins). After both, on Luke's iPhone: Message › Messages › Set up on this iPhone; ⋯ › Run crypto check (should say all checks passed); link the laptop browser (Link this browser → scan the QR with the phone). Then Marijane installs TestFlight, sets up on her phone and links her browser; send a message each way, a recipe card, and compare safety numbers. Next day: `select count(*) from msg_inbox` stays small (rows are deleted on receipt).
- **Messaging step 1: encryption core** — Signal's protocol (X3DH + Double Ratchet) on libsodium in `messaging/crypto/`, plus the message envelope; not wired into the app yet, so nothing visible changes and the app's bundle is unchanged (MESSAGING_DESIGN.md §15–16) · #200 · none.
- **Watch: episode lengths, no TV/M badge** — each episode in a show's panel shows its length when TMDB has it (`tmdb-season` now returns `runtime`; older saved lists reload once per session); posters drop the TV / M badge · #199 · **needs the Netlify deploy** for lengths (server function; the phone calls it too); badge removal is on the iPhone via TestFlight now. After the deploy: open a TV show — its episodes show lengths.
- **Watch: YouTube page, menu text, full poster ring, no service bubble** — "YouTube" in the Watch sidebar (YouTube-only search, saved videos, tap to play in the app; the Watch list's search leaves YouTube out); Watch menu text matches Listen's; the open poster's ring isn't cut off at the row ends; no streaming-service bubble on posters · #198 · iPhone via TestFlight now; on the web after the deploy: Watch › menu › YouTube, search, bookmark a video, clear the search (it's listed), tap it (it plays).
- **Watch: season menu, ⋯ menu, no scroll bars** — the open panel shows one season at a time from a menu (opens on the next episode's season); Watched · Tabs · Remove moved into a ⋯ menu at the panel's top-right; no scroll bar on the Watch list or its tab strip · #197 · iPhone via TestFlight now; on the web after the deploy: open a show, pick another season, use ⋯ → Tabs.
- **Watch: screen stays put, compact season tracker** — opening a season or ticking an episode no longer jumps the list to the top; Watched is a check in a circle; episode rows sit close together; season boxes are ~2/3 the old height · #196 · iPhone via TestFlight now; on the web after the deploy: scroll down to a show, open a season and tick an episode (the screen stays put).
- **Watch: short list at the top, no "+", Other services button** — a short Watch list starts at the top of the screen (was mid-screen; also closes the Movies/TV gap); the "+" beside the tabs is gone (the search bar adds shows); the open panel drops the services headings and folds services outside yours into an "Other services" button that opens a window naming them · #195 · iPhone via TestFlight now; on the web after the deploy: open Watch with a few shows (they start at the top), open a show with services outside yours, tap Other services.
- **Watch: show panel, phone actions, Next episode, Undo, link a plain title** — tapping a poster opens its panel under the whole row (row stays put; a pointer marks the poster and slides within the row); Watched · Tabs · Remove in the panel (they work on the iPhone now); "Next: S3 E6 [✓ Watched]" for TV and a fixed season tracker; Remove waits ~6 s with Undo; "Find the right title" links a plain title; the + window tags "In your list" (WATCH_AUDIT.md decisions 1–4) · #194 · iPhone via TestFlight now; on the web after the deploy: open Watch on the laptop, tap a poster in a full row (the row stays put), tap its neighbour (the pointer slides), Remove → Undo.
- **NYT articles blocked on the phone** — the hidden article reader now identifies as Safari like the sign-in sheet (NYT's bot check blocks a page whose identity differs from the one the session was made with); the reader names the real cause (bot check / sign-in wall / phone error) instead of the server's "HTTP 403", and adds "Open article in the app" (the article in the in-app browser, same cookies, then reload) · PR (this one) · **TestFlight build** (native change). Then open an NYT article: it should load; if NYT shows its check, use "Open article in the app".
- **Newspaper sign-in: hint + honest status** — Sync Settings, the reader and the in-app sign-in sheet say to use email and password (Google sign-in doesn't work in the app); the phone's sign-in check now loads each paper's subscriber page even when a session cookie is there, so a leftover cookie no longer shows "Signed in"; a cut-off article while "Signed in" re-checks and says the sign-in may have expired · PR (this one) · **TestFlight build** (the sheet's hint is native; the rest is in the bundled web code). After it: News › Sync Settings on the phone should show The Economist's real state.
- **Dutch card picture** — the Leisure page's Dutch hobby card shows the windmill picture (`activity-dutch.png`) instead of the translate icon · PR (this one) · none; web only, and the iPhone picks it up with the next TestFlight build.
- **Household Listen and Watch reset** — one-time row reset marker (`views.js` `applyRowReset`) so the emptied Household Listen and Watch rows can't be merged back from a device's old copy · PR (this one) · **post-deploy, in this order:** (1) TestFlight build too (the phone bundles the code); (2) reload every open web tab (laptop Chrome, laptop app, Marijane's browser); (3) write the reset rows (Luke OK'd "start empty", 2026-10-28) with `execute_sql` — see the SQL in the PR description; (4) next day, check both rows are still empty and still carry the marker.
- **News titles** — stories show real headlines instead of the bit of newsletter text that was linked ("your most pressing questions" → the El Niño FAQ's headline); NYT live-blog "Here’s the latest." items read "Live: <blog>"; feed titles with inline markup keep all their words; the hourly job fixes weak titles in the last 3 days (NEWS_TITLES_DESIGN.md) · PR #191 · **Netlify deploy only** (server). After it: once the next hourly run has gone, read `newsfeeds_status` → `titles` (`pagesFound` says whether Netlify can read the papers' pages; `fixed` / `from` say what changed), and check the News Front page and the dock ticker for fragment titles.
- **The Amplifier → Listen bell (music shows)** — NYT's playlist newsletter becomes a show under the Listen bell instead of a queue article: on the iPhone, Play reads the intro and each song's write-up and plays each song from Apple Music in between, with the phone locked too (AMPLIFIER_DESIGN.md). Mail → Automation toggle "“The Amplifier” → Listen bell" · PR #192 · **Netlify deploy** (inbox sweep + `gmail.js` `importMusicShows`) **and a TestFlight build** (native player + bundled web code). After both: open Listen once on the phone (the last ~3 weeks of issues are fetched once per device); check the bell; play a show through two songs with the screen locked; pause and resume from the lock screen during a song and during speech; after the next issue arrives, check the sweep log line `[music-show] … M Apple Music ids` (how many NYT links resolved). Old plain copies of earlier issues may still be in the queue — remove by hand.

## 2026-10-28 deploy (News For you + AI tags + The Athletic for favorite teams; briefings on Haiku 5.5; app links; Views leak fix; Explore and Exercise pictures)
Web deploy from `main` (#178–#186). Migration `2026-10-28-news-for-you.sql` applied before the deploy. New: `news_interest` table; `_news-rank.js` / `_news-tags.js` (AI tags use the existing `ANTHROPIC_API_KEY`; kill switch `NEWS_AI_TAGS_DISABLED=1`). Service worker cache not bumped (page loads are network-first, bundle hashed). **TestFlight build needed** for #179 (Views leak fix), #186 (new URL schemes) and #184's new ⋯ items on the phone.

- **Exercise: new lift pictograms (Chest & Back, Arms & Shoulders, Legs)** · #180 · After deploy: open Exercise and check each Strength card shows its own picture (transparent background intact); other Strength cards still show the general weightlifting one. Web code only — the iPhone app needs a TestFlight build to show it.
- **Explore: trip pictures; New trip leads each row** · #178 · After deploy: on the phone, open a trip → 🖼️ Add picture → choose one of the pictograms; check the card shows it (transparent background intact) and that Use row picture puts the default back. Then check each row starts with New trip showing its row picture. Web code only — the iPhone app needs a TestFlight build to show it.
- **Views: stop Personal data leaking into Household rows** · #179 · The local copy carries the scopes its data belongs to; two switch-time races guarded. **Post-deploy:** ship a TestFlight build (the iPhone app bundles its web code, and it's the device that leaked); once both phones have it, clean Household's Listen row (and Watch, if Luke says it's a copy) with Luke's OK — ISSUES.md P0. For a few days, check the Supabase API logs: no write to `<groupId>:media` right after a boot load that then switches Listen to Personal.
- **Views: test that every switchable section is leak-guarded** · #181 · Test and ISSUES.md only; nothing to check after deploy.
- **Agents: views, settings and leisure agents; reviewer checks view leaks** · #182 · Agent docs, CLAUDE.md and the agent-coverage test only (now also scans `music/`); nothing to check after deploy, no TestFlight build needed.
- **App links: banks, bills, stores, News, Calendar, Contacts, Explore** (APP_LINKS_DESIGN.md) · #186 · Finance's Your banks + bill Pay; Shop store buttons + Find at <store>; News ⋯ → Open in <paper> app; Calendar directions / Join meeting / Google Calendar / Pay; Contacts Text + FaceTime; Explore destination → Maps and Open <airline/hotel/rental>; Link Test lists them all. New URL schemes in `LinkOutPlugin.swift`. **Post-deploy:** (1) TestFlight build (new schemes; the iPhone bundles the web code). (2) On the phone: Settings › Admin › Beta › Link Test → tap each bank, store, store search and maps row → Copy results → paste into a chat so wrong app links get fixed. (3) The Google event buttons need the Netlify deploy (`_gcal.js`); after a day, open a Google event with a location / Meet link and check Directions, Join meeting and Google Calendar.
- **News: For you ranking, AI topic tags, The Athletic for favorite teams; What News has learned; skips** (NEWS_RANKING_DESIGN.md) · #184 · Migration `2026-10-28-news-for-you.sql` **already applied** (2026-10-28). Functions + web code. **Post-deploy:** (1) Open News once on each device so its Scores favorites reach the server (`newsTeams`). (2) After the next hourly run (:07), read `tableplan_states` row `newsfeeds_status`: `forYou: true`; `tagging` has tagged > 0 and no `http`/`refusal` errors (input/output tokens give the real AI cost); every `feeds[]` entry with a `team` is `ok` — fix any 404 slug in `_news-feeds.js` `ATHLETIC_KNOWN_SLUGS` (ISSUES.md P2). (3) Open For you: stories ranked with a reason line; ⋯ → More / Less / Mute shows a toast naming what it learned; What News has learned lists it. (4) Sports / The Athletic show only your teams' Athletic stories. Kill switch for AI tags: env `NEWS_AI_TAGS_DISABLED=1`. iPhone: TestFlight build for the new ⋯ items if the app bundles its web code.
  - [x] 2026-10-28 7:07 run (checked 7:17): `forYou: true`; AI tags 20/20 stories, no errors, 1,697 input + 1,599 output tokens (~$0.001 a run, about $0.50–0.70 a month — output runs ~80 tokens a story, double the estimate). Luke's 11 favorites arrived at 7:11, after that run, so team feeds start with the 8:07 run.
  - [x] Found from the real favorites: "Ajax Amsterdam" would have matched any "Amsterdam" headline and missed "Ajax"; "Cougars" (Minnesota Morris) would have let in BYU / Houston stories. Fixed in #187 (needs a deploy).
  - [x] 8:07 run (checked 8:26): team feeds for the Vikings, Timberwolves, Wild, Twins, Lynx, Netherlands and United States answer. The Gophers, Minnesota United and Ajax feeds 404'd (Morris has none); those teams are still caught by name in the league feeds. New guesses for them in #187. AI tags: 5/6, no errors, 729 + 224 tokens.
  - [ ] After #187 is deployed: which of the new Gophers / Minnesota United / Ajax guesses answer (`newsfeeds_status.feeds[]`).
- **Newsletter briefings on Claude Haiku 5.5** · #185 · `_news-articles.js` + `_claude.js` (refusal now throws for every caller; continuation skipped for Haiku 5.5). **Post-deploy:** the next newsletter briefing in Listen (The Morning / The world in brief) reads complete, start to end; Netlify function logs show no `[news-article] … failed` for it.

## 2026-10-26 deploy (ISSUES sweep and decisions; streaming hand-off; phone month view; Dutch builds; receipts)
Web deploy from `main` (#170–#177) plus a TestFlight build. Service worker cache bumped to v53 (hard-refresh once on the laptop). New functions: `stream-links` (off until `STREAMING_AVAILABILITY_KEY` is set), `dutch-reader`, `scan-receipt-background`/`receipt-scans`, `household-role`. No migrations, no new env vars required.

- **ISSUES.md sweep: recipe write-back, build stamp, briefing recipients, small fixes** · #176 · Recipes write back only changed rows on open; Settings shows the build ("Version …") and the web app offers Reload when a newer deploy is live (`/version.json`); the daily briefing push reaches only the admin's devices; server group lookups ordered; a dead podcast link moves the queue on; assistant grocery adds clear old bought marks; toasts show inside open windows; phone layout fixes (Add Calendar buttons, receipt labels).
  Post-deploy: (1) Settings on the laptop shows "Version <commit> · <date>" matching the deploy. (2) Leave a tab open, deploy something later, come back after 30+ min: a "new version … Reload" toast appears. (3) Supabase API logs (`service: api`): opening the app no longer sends a 256-row `eat_recipes` upsert each time (at most the few rows that changed). (4) iPhone (TestFlight): Settings shows the stamp; no Reload prompt there.
- **Watch & Scores open the right streaming app** (STREAMING_HANDOFF_DESIGN.md) · #173 · New `LinkOut` iOS plugin; Watch's Open buttons try the service's app first; live / about-to-start games in Scores and the dock's game card get Watch buttons (Xfinity Stream first for TV channels); Streaming Services › Sports apps; Admin › Beta › Link Test. The `stream-links` function is new and stays off until `STREAMING_AVAILABILITY_KEY` is set.
  Post-deploy: (1) TestFlight build — the plugin needs it. (2) On the phone: Settings › Admin › Beta › Link Test, tap each service, "Copy results", paste into a chat so the unverified schemes in `link-out.js` can be fixed. (3) During a live game: Scores › the game › Watch → Xfinity Stream opens. (4) Once the key is in Netlify (and deployed): open a Watch-list show's service → the app opens on the next episode; Netlify logs show one `stream-links` upstream line per title, not per tap.
- **Calendar: phone month view lists the tapped day under the grid** · #170 · Phone only (≤560px): dots in the grid (max three, tasks as a hollow dot), the selected day listed below, + adds an event, the date opens the day view. Reaches the iPhone with the next TestFlight build; the web app on a phone needs a deploy. Post-deploy: on the phone, open Calendar › Month — today is outlined and listed; tap a busy day and check its events, tap one to open it, try + and the date.
- **Dutch learning build** (LANGUAGE_PRACTICE.md §8–19) · #171 · Add words (paste from Rosetta Stone), spaced-repetition flashcards, Match upgrade (due words, Listen mode), de/het, Listen, Sentences, Speak; new `LiveLanguage` iOS plugin + mic/speech-recognition strings.
  Post-deploy: (1) TestFlight build (`npm run ios:sync`, Xcode) — the plugin and Info.plist need it. (2) On the phone: Leisure › Dutch → Speak: allow the mic and speech prompts, say a word → "Understood"; play your recording; then check a podcast still plays normally. (3) On the laptop: paste a Rosetta Stone lesson in Add words; check it appears first and on the phone after a refresh. (4) Supabase API logs (`service: api`) 48h: the personal `recreate` row is written once per practice round, not per tap.
- **Receipts: code does the math, scan and go, iPhone text recognition** · #172 · server + web + phone (TestFlight)
  - The AI transcribes; `receipt-reconcile.js` checks the math (savings/fees before or after the subtotal, store profiles); a second look with the stronger model when it doesn't add up. Scan, send, close the app: `scan-receipt-background` + `receipt-scans`, results in `receiptscan_<group>_<id>` rows. "Needs a look" on receipts that don't add up. iPhone text recognition in the DocumentScanner plugin.
  - Post-deploy: (1) in a browser, Shop › Receipts › Scan receipt › Send receipt with a photo → toast "Receipt sent ✓", then within ~1 min the receipt appears (and the toast says whether it adds up). (2) Netlify log for `scan-receipt-background`: one line per read ("ok"/"check", "(second look)" when used, duration). (3) Supabase: `select id from tableplan_states where id like 'receiptscan_%'` shows the result row. (4) Re-open an old Costco receipt: its edit view says "Adds up". (5) Then a TestFlight build: scan with the camera and close the app straight after the toast; reopen later and check it arrived; a library photo too.
- **Dutch learning, part 3** · #175 · Verbs (conjugation drill), Word order, Fill in the blank, problem words with notes, and **Read the news** (easy Dutch from NOS Jeugdjournaal, tap a word for its meaning, save it to your flashcards) — new function `dutch-reader` (needs the deploy; uses the existing `ANTHROPIC_API_KEY`, stores nothing). Post-deploy: on the phone open Leisure › Dutch › Read the news; check Easy and Regular list articles, open two (full text, or the summary + "Open on NOS"), tap a few words for sensible meanings, save one and see it under "From your reading". Then try Verbs (Mixed), Word order and Fill in once each.
- **ISSUES decisions: review card, household roles, Household tasks in Personal, iPhone dev paths, queue windows** · #177 · Finance review card with pinned Approve/Skip; Household › Edit role picker backed by `household-role.js` (new function, service role, admin-checked; the creator can't be changed); Personal's Tasks list shows a tickable Household group when the layer is on; "Past 2/3 months" queue windows removed; the iPhone app no longer runs local-dev paths (and Scan and go turns on there); background jobs pick the first admin.
  Post-deploy: (1) Finance › bell on the phone: Approve and Skip sit at the bottom of every card; "Edit details…" shows name and note, then opens the full transaction. (2) Settings › Household › Edit (laptop): your row shows a pill; another member's row has Admin / Member — don't promote anyone unless you mean to (see ISSUES P1). (3) Personal › Calendar with the Household layer on → Tasks: a Household group; tick one, then check it's ticked in Household (and on Marijane's web app). (4) TestFlight: no "Continue in local dev mode" on the lock screen; Shop › Receipts shows "Send receipt" (Scan and go). (5) Supabase API logs: no requests to a `backup` function from the phone.

## 2026-10-25 deploy (Sports themes and grouped Display; Meal Plan Events & Notes +; Watch grid and search; Explore in Household; Dutch practice; News stops auto-saving; Apple Music-only search; flat menus; Business calendar)
Web deploy plus a TestFlight build from `main`. Service worker cache bumped to v52 (hard-refresh once on the laptop; Marijane just reloads). Client-only: no migrations, no new env vars, no Netlify function changes.

- **Themes: Sports row and grouped Display rows** · #167 · **TestFlight build** (client-only; the laptop needs a Netlify deploy). Settings › Display lists themes in Leisure-style rows — General (Classic, Household), Holiday (Halloween, Seasonal), Business (Urban Greens), Sports — and adds seven team themes in light and dark: Vikings, Timberwolves & Lynx, Wild, Twins, Golden Gophers, Ajax, Minnesota United. Classic stays the default. No migration, no new env vars.
  Post-deploy:
  1. Settings › Display: four rows; swipe the Sports row and pick each team, in Light and Dark — Calendar, Meal Plan, Shop, Finance and News read clearly and the dock takes the team colors.
  2. Close and reopen Display — the chosen card is in view in its row.
- **Meal Plan: Events & Notes always open; a + adds an event or note** · #166 · **TestFlight build** (client-only; the laptop web app picks it up at the next deploy). No open/close toggle; where its chevron was, a same-size + offers Event (the editor on that day, timed across the meal's mealtime and ticked Meal Plan) or Note (reveals the note box; an empty one stays hidden). No migration, no new env vars.
  Post-deploy:
  1. iPhone, Household › Meal Plan: every meal's Events & Notes shows its events and note with no toggle; the + sits at the right of the header.
  2. + → Note: the note box appears and the keyboard opens; type, tap away, the note stays. Empty it: the box tucks away.
  3. + → Event: the editor opens on that day with the meal's times and Meal Plan ticked; save it and it shows on that meal.

- **Watch: four posters a row; tap a search result to add it** · #165 · **TestFlight build** (client-only; the laptop web app picks it up at the next deploy). The Watch list fits four posters a row on a phone. The Watch search has no bookmark buttons: tapping a result adds it to the list, clears the search and returns to the list. No migration, no new env vars.
  Post-deploy:
  1. iPhone, Watch: four posters a row, titles and the TV/M and streaming chips readable.
  2. Search a show, tap it: the box empties and the list shows it. Search it again and tap: still one copy ("Already in your Watch list.").
  3. A result's Play/Open buttons still open the service instead of adding.

- **Explore moves to Household, with shared trips** · #163 · **Netlify deploy + TestFlight build** (client-only; your wife uses only the web app, so she gets Explore at the next deploy). Explore is listed only in Household, and its trips are the household's shared list in every view. The shared trips were already set to your Türkiye 2026 and Grand Rapids (done 2026-10-22 by SQL); everyone's own trips are unchanged. No migration, no new env vars.
  Post-deploy:
  1. Personal: no Explore in the list. Household: Explore is last; it shows Türkiye 2026 and Grand Rapids, each once.
  2. Your wife (web): Household lists Explore with the same two trips. Without a home in her profile she sees "Add your home…" and the trips sit under Not sorted yet.
  3. Add or move a trip on one login; it shows on the other after a refresh.

- **Explore: Local / Regional / National / Global, with pictures; All trips retired** · #161 · **TestFlight build** (client-only; the laptop web app picks it up at the next deploy). Rows renamed (saved moves keep their row); each row's trip cards show its picture; the All trips button and trips list are gone, so the rows are the only way between trips. Edit / Delete trip are on a card's hold / right-click menu. No migration, no new env vars.
  Post-deploy:
  1. iPhone, Personal › Explore: rows read Local, Regional, National, Global; each trip card shows its row's picture (also in dark mode).
  2. No All trips button; tap a card → that trip, with only back and the bell above it; back returns to the rows.
  3. Hold a card → Move / Edit / Delete trip all work.

- **Dutch practice on Leisure** · #153 · **TestFlight build** (client-only; Luke prefers TestFlight for this; the laptop web app picks it up at the next deploy). Timed Dutch↔English matching game as a Dutch row on Leisure (Personal view), with lessons, unit and review rounds; progress saved in the personal `recreate` section. It was built 2026-10-20 but never merged, so builds from `main` since then dropped it; rebased onto `main` 2026-10-21. Word list still provisional until the Rosetta Stone list arrives. No migration, no new env vars.
  Post-deploy:
  1. Leisure: a Dutch row with lessons; start one, match a few pairs, finish or leave. The summary shows and the lesson's progress is kept after reopening the app.
  2. Earlier practice from the 2026-10-20 TestFlight build is still counted.

- **News: opening a story no longer saves it** · #159 · **Netlify deploy + TestFlight build** (client-only). Only ⋯ → Save puts a story in News → Saved. Tapping a story, Open, Listen and ticker headlines just mark it read and open the reader from a copy kept for that session only (saving it afterwards keeps the loaded text). No migration, no new env vars. Not checked in a browser yet (no Chromium in the cloud sandbox): run `npm run check:boot` before deploying.
  Post-deploy:
  1. News: tap a story, read it, close. It's marked read and Saved's count doesn't change.
  2. Listen to an unsaved story from ⋯ → Listen: it plays; still not in Saved.
  3. ⋯ → Save on a story: it appears in Saved, and opens with its text.

- **Music search: Apple Music only** · #158 · **TestFlight build** (client-only; Luke: iPhone only, no Netlify deploy needed for this). Internet Archive and Musopen are no longer searched, so results come straight from Apple Music. Music already saved from them still plays. No migration, no new env vars.
  Post-deploy:
  1. iPhone, Listen › Music, search anything: Apple Music results in a second or two, no "Free & open sources" section.

- **Music search no longer sticks on "Searching…"** · #156 · **Netlify deploy + TestFlight build** (client-only). Each source in Listen › Music search gets 12 s; one that doesn't answer is named in the note ("… unavailable — showing the rest") and the others' results show. No migration, no new env vars.
  Post-deploy:
  1. iPhone, Listen › Music, search "beethoven": results appear within about 12 s.
  2. Note which source the line above the results names (if any) and add it to the ISSUES.md entry so that source gets fixed.

- **Flat menus; shorter Personal list; Scores back in News** · #155 · **Netlify deploy + TestFlight build** (client-only). No group headings in any view; the landing box back to its old width. Personal lists Overview, Calendar, News, Finance, Watch, Listen, Mail, Explore, Exercise, Leisure. Meal Plan and Shop only in Household; Tasks only inside the Calendar; Weather only from the dock; Scores back in News → Sports. No migration, no new env vars.
  Post-deploy:
  1. Landing (Personal): a plain list, no Plan / Inform / … headings; the white box hugs the links; no sideways scroll.
  2. News → Sports: Scores and Stories tabs; tables and team schedules open from Scores. A ticker game opens there.
  3. Weather from the dock still opens; Tasks from the Calendar still opens.
  4. Household: Calendar, Meal Plan, Finance, Shop, Watch, Listen as before.

- **Business calendar: only its own events** · #154 · **Netlify deploy + TestFlight build** (client-only). The Business calendar no longer shows Bills, Meal Plan, Exercise, Tasks or Birthdays (entries the Calendar adds from other pages), and its sidebar drops their switches. Personal and Household unchanged. No migration, no new env vars.
  Post-deploy:
  1. Business calendar: empty (nothing added there yet); sidebar has no Meal Plan / Exercise / Tasks / Birthdays / Bills rows.
  2. Personal calendar: Bills and the rest still show as before.
- **Watch redraws when the view changes** · #154 · same deploy. Switching views from Watch (or any change merged from another device) now redraws the Watch list; it used to keep the previous view's list until you left the page.
  Post-deploy:
  1. On Watch in Personal, open the page menu, swipe to Household, tap Watch: the list is Household's (empty today), not yours.

## 2026-10-20 deploy #2 (Overview window, landing swipes, menu-only view switching)
Web deploy plus a TestFlight build from `main`. Service worker cache bumped to v51 (hard-refresh once on the laptop; Marijane just reloads). No migrations, no new env vars.

- **Overview, landing swipes, menu-only switching** · #151 · Overview (the day's write-up) is no longer under the landing links: it's "Overview" at the top of the landing list and the page menu, Personal only, and opens a window. No chevrons on the landing band; a swipe anywhere on the landing page switches views. From a page, switching views in the open menu changes only the menu until a page is picked.
  Post-deploy:
  1. iPhone, landing page in Personal: Overview at the top of the list; no sideways scroll; tap it → the window with today's write-up; Close.
  2. Swipe left/right anywhere on the landing page (logo, list, empty space): the view changes. Overview disappears in Household and Business.
  3. On Calendar, open the page menu, swipe the band to Household: the menu lists Household's pages but the Calendar behind is unchanged; tap Calendar → Household's Calendar. Close the menu without picking → nothing changes.
  4. Marijane (web): no Overview, no chevrons, nothing else different.

## 2026-10-20 deploy (views: Personal / Household / Business; finance split steps 1–2; Household and Urban Greens themes; page-menu polish)
Web deploy plus a TestFlight build from `main`. Service worker cache bumped to v50, so hard-refresh once on the laptop; Marijane uses the web app, so she only needs to reload. Migrations already applied (views spaces, finance account views); no new env vars. Changed Netlify functions: `simplefin`, `daily-briefing`.

- **Finance follows the view (step 2)** · #148 · **Netlify deploy + TestFlight build** (client-only). Personal shows the person's own Finance only once they own a personal account (none do until step 3), so **nothing visible changes**: Personal and Household both show the household's Finance as today. One tiny read of the person's own `live_finance_account_views` rows with the business-space load. No migration, no schema bump, no new env vars.
  Post-deploy:
  1. Finance opens as before in Personal and Household for Luke, and for Marijane.
  2. Supabase API logs: one `live_finance_account_views?owner_id=eq.…&limit=1` read per app start, nothing on a timer.

- **Finance: personal accounts split on the server (step 1)** · #146 · **Netlify deploy** (server functions only; no app change). The `live_finance_account_views` table is **already applied** (2026-10-20) and empty, so nothing changes until accounts are marked Personal (step 3). No new env vars.
  Post-deploy:
  1. Finance opens as before for Luke and Marijane: same accounts, balances, transactions.
  2. The next morning, the daily snapshot ran (Netlify function logs: `[fin-snapshot] recorded N balances`, no "account views unreadable").
  3. Supabase API logs: one small read of `live_finance_account_views` per Finance load / bank pull, nothing on a timer.
- **Views: each view reads its own data; Business calendar; layers; game card** · #143 · **Netlify deploy + TestFlight build** (client-only; the database change, #142, is already applied). Household reads the household rows (Calendar, Tasks, Watch, Listen, Shop), Personal your own (Shop stays the household list), Business its own Calendar. Personal's Calendar can show Household and Business as layers (Calendar sidebar › Show in my Personal calendar). A ticker tap in Household/Business opens a small game card. **Luke's wife's Calendar/Tasks/Watch/Listen switch to the household rows** (hers are empty today). No migration, no new env vars.
  Post-deploy:
  1. Personal: your 4 calendar events, 16 podcasts and Watch list look as before.
  2. Swipe to Household: Calendar is empty (the household calendar), Listen shows the household's podcast list, Shop's list is the same in both.
  3. Swipe to Business: add an event; it shows only in Business. Back in Personal, turn on Business under Show in my Personal calendar: it appears, marked; tap it → Open in Business.
  4. Play a podcast, swipe views: it keeps playing (check Up Next).
  5. Marijane (web app): the same Meal Plan, Shop, Finance; Calendar/Tasks show the household's.
  6. Supabase API logs for 48h: no repeated full reads of tableplan_states on view switches.
- **Views: Personal, Household, Business (the view shell)** · #140 · **Netlify deploy + TestFlight build** (client-only). The view band under the landing logo and in the open page menu; swipe on it, its ‹ ›, or ←/→ to switch views. Household (six pages, flat) and Business (Calendar) for the admin; **Luke's wife sees Household only** (its six pages) once this is live. Each view keeps its own Display look. Same data in every view for now. No migration, no new env vars.
  Post-deploy:
  1. iPhone: landing page — swipe the band right: Household (navy/blush), again: Business (Urban Greens), again: Personal. Chevrons and the swipe both work; the band doesn't crowd anything.
  2. Open Calendar, open the page menu — the band replaces the title; swipe it; Calendar stays. Switch to Household from News — you land on the Household landing page.
  3. Close and reopen the app — it opens in the last view used.
  4. Marijane (web app, reload once): "Household" band, no chevrons, Calendar / Meal Plan / Finance / Shop / Watch / Listen only; her theme unchanged.
  5. Settings › Display in Household changes Household's look only.
- **Themes: Household and Urban Greens** · #138 · **TestFlight build** (client-only; the laptop needs a Netlify deploy). Two new themes in Settings › Display, each with light and dark: Household (navy, dusty blue, blush, sage) and Urban Greens (the logo's green and gray, with black and white). Classic stays the default. No migration, no new env vars.
  Post-deploy:
  1. Settings › Display: pick Household, then Urban Greens, in Light and Dark — Calendar, Meal Plan, Shop, Finance and News read clearly.
  2. Open an email in Dark mode with each theme — the white reading surface keeps readable buttons and links.
- **Page menus: groups slide open and closed** · #137 · **TestFlight build** (client-only; the laptop needs a Netlify deploy). Tapping a group heading slides the old group shut while the new one slides open (~0.2s), with the pages fading in. Off when the phone's Reduce Motion is on. No migration, no new env vars.
  Post-deploy:
  1. Landing page: tap Plan, then Inform — Plan slides closed while Inform slides open. Same in the page menu.
  2. Tap the open heading — it slides shut.
- **Page menus: no arrows on the group headings** · #136 · **TestFlight build** (client-only; the laptop needs a Netlify deploy). The Plan / Inform / Resource / Media / Message / Recreate headings on the landing page and in the page menu no longer show a ▾ arrow; tapping them still opens and closes the group. No migration, no new env vars.
  Post-deploy:
  1. Landing page and page menu: headings are plain words; tapping one opens it and closes the other.

## 2026-10-17 deploy (page groups + Recreate pages, mail pinch zoom, briefings out of News, long receipts, recipe photos)
Web deploy plus a TestFlight build from `main`. Service worker cache bumped to v49, so hard-refresh once on the laptop. No migrations, no new env vars. New Netlify function `recipe-website-photo`; `scan-receipt` changed.

- **Grouped page menus; Recreate → Explore, Exercise, Leisure, Scores** · #134 · **Netlify deploy** (web; the iPhone app gets it with the TestFlight build). Landing links and the page menu are six groups that open one at a time (Plan, Inform, Resource, Media, Message, Recreate); Listen and Weather are back in the menus; Scores is its own page under Recreate (News → Sports is stories only); Exercise and Leisure are rows of cards; Explore opens on Local / State / Country / World rows of trips. No migration, no new env vars.
  Post-deploy:
  1. iPhone, landing page: tap Plan, then Inform — only one group is open at a time; each page opens. Tasks opens its window over the Calendar.
  2. Page menu from any page: it opens on that page's group with the page highlighted.
  3. Recreate → Scores shows today's games; tap a game in the dock ticker — it opens on the Scores page. News → Sports has stories only.
  4. Explore (with a home set in the profile): trips move into Local / State / Country / World within a few seconds; hold a card → Move to …; a row's + starts a trip there. Check "Not sorted yet" for anything misread.
  5. Exercise: Strength / Cardio / Games rows; hold a card for Edit / Delete. Leisure: Sailing and Piano rows.
  6. A mail or finance notification underlines the closed group's heading (Message / Resource).

- **Mail: pinch to zoom an email** · #133 · **Netlify deploy** (web; the iPhone app gets it with the TestFlight build). Two fingers zoom an email from its fitted size up to 4×; laptop trackpad pinch works too. Zoomed in, a sideways drag pans instead of paging. No migration, no new env vars.
  Post-deploy:
  1. iPhone: open an image-heavy newsletter, pinch out on a headline — it grows around your fingers and stays sharp; drag around in every direction; pinch back in to the fitted view.
  2. While zoomed in, a one-finger sideways drag moves the email, not to the next email. Zoomed out, the swipe to the next email still works.
  3. Laptop (Chrome): trackpad pinch over an email zooms only the email, not the whole page.

- **Briefings out of News (Listen only)** · #132 · **Netlify deploy** (web; the iPhone app gets it with the TestFlight build). News has no Briefings view, and Saved leaves out The Morning / The world in brief; they still join Listen's queue. No migration, no new env vars.
  Post-deploy:
  1. News sidebar: Front page · Saved · sections · papers (no Briefings).
  2. News → Saved (Recent and Email tabs, search, archive): no The Morning / The world in brief.
  3. Listen's queue still lists today's briefings, and one plays.

- **Receipt scan: long receipts no longer time out** · #131 · **Netlify deploy** (server + web; the server half reaches the iPhone app with the deploy). The AI now writes a compact reply per line, and if a read still runs long it stops at ~26 s with "This receipt took too long to read…" instead of a bare 504. No migration, no new env vars.
  Post-deploy:
  1. Rescan the long (30+ line) receipt that failed on 2026-10-16: the review opens with every line, prices, quantities for weighed items, and budget categories filled where expected.
  2. In Netlify's function logs, `scan-receipt` for that scan finishes well under 26 s.
  3. Scan a short receipt too and check nothing looks different in the review.

- **Recipe photos** (RECIPE_PHOTOS_DESIGN.md steps 1–4) · #130 · **Netlify deploy + TestFlight build.** Own photos load from public Storage and are cached on each device; uploads add a thumbnail; broken photos are hidden; imported recipes carry the website's photo; removing your own photo brings the website's back; a one-time backfill adds website photos to recipes with a source link and no photo. No migration, no new env vars.
  Post-deploy:
  1. Open a recipe with your own photo: the request goes to `…/storage/v1/object/public/recipe-photos/…` (not `/.netlify/functions/recipe-photo`); after a reload it's served by the service worker.
  2. Check the Storage response has `Access-Control-Allow-Origin`. If it doesn't, photos still load but the service worker won't cache them.
  3. The first device to open the app logs `Website photo backfill: N of M recipe pages had a photo.` (about 15 s after load), and recipes from websites show photos.
  4. Import a recipe by URL: the review card and saved recipe show the site's photo. Add your own photo, then remove it: the site's photo comes back.
  5. For 48 hours, watch Supabase API logs (`service: storage`) for repeated hits on one object from one client.
  6. On the iPhone (after the TestFlight build): photos show, and a recipe with a blocked website photo shows no broken image.

_Last deploy: 2026-10-16 (mail attachments in-app, text-box clear, Scores tables, cold-start theme, Watch/Mail/News/Shop tweaks, Shop (i))._

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
