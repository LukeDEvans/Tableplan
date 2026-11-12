# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Listen: Podcasts' Shows and Books match the Watch page** · #226 · **TestFlight build**
  (client-only; the laptop needs a Netlify deploy). Four covers a row on a phone; tapping a show
  opens a panel under its row with its 5 most recent episodes (All episodes opens the full list,
  Back returns with the panel open); tapping a book opens its panel with library / Libby / Audible
  links. Post-TestFlight: Listen › Podcasts › Shows — four per row, tap a show, play an episode
  from the panel; Books — tap a book, check the links; no sideways scroll.
- **Listen (iPhone): tapping the episode that's playing no longer jumps it back** · #228 ·
  **TestFlight build** (bundled web code; nothing changes on the laptop, no Netlify deploy). A tap
  on the row of the episode the phone is already playing just shows it; if it was paused it carries
  on from the same spot. Post-TestFlight: while an episode plays, tap its row in the show's list,
  in Recent and in the queue (no jump back); pause it, tap its row (it resumes where it was).
- **Mail: no more "Quota exceeded" on fast folder switching** · #221 · **Both a TestFlight build
  and a Netlify deploy** (client + Netlify function; either can land first — each side ignores the
  other's new fields, so nothing breaks in between). Client (TestFlight / laptop deploy): read-ahead
  stops when you switch folders; folders you return to come from an always-fresh cache. Server
  (deploy): one safe retry on Gmail rate limits, no parallel fan-out on a refused batch, unloaded
  rows shown as "Couldn't load — tap to open", and the 2-unit "anything changed?" check that makes
  the cache work (the cache stays off until this is deployed). No env vars, no migration.
  Post-deploy: switch Inbox → AI Trash → Inbox quickly several times (no error; returning is
  instant); archive something, go to another folder and back (it's gone); get a new email while
  in another folder, go back to Inbox (it's there).
- **Listen: Podcasts' Shows and Books match the Watch page** · #226 · **Both a TestFlight build
  (iPhone) and a Netlify deploy (laptop web)** — client only (`app.js` + `styles.css`); no function,
  env var or migration. Shows and Books use Watch's cover grid, four a row on a phone. Tapping a show
  opens a panel under its row with its 5 most recent episodes; "All episodes" there opens the full
  list (bundle settings). Tapping a book opens a panel with author, format, library availability and
  the library / Libby / Audible links; its ⋯ is Shelves & options. Not yet tried on a real iPhone.
  Post-TestFlight / post-deploy: on Podcasts › Shows, check four covers a row, tap a show (panel
  opens under its row, grid stays), play an episode from the panel, open another show in the same
  row and one in a lower row, then All episodes and Back; on Books, tap a cover (panel, library
  availability fills in), open its ⋯ menu, and drag a cover onto a wishlist tab on the laptop.
- **Listen (iPhone): podcasts download to the phone and play from the file** · #227 · **TestFlight
  build** (native only; no Netlify deploy, nothing changes on the laptop). An episode with a file on
  the phone plays from it; a new episode started from the beginning plays from its download as it
  arrives; one picked up part-way with no file streams as before and is downloaded for next time. The
  next queued episode is fetched ahead on Wi-Fi only. Files go when the episode finishes, after 3
  weeks unplayed, or over 2 GB. Anything that goes wrong falls back to streaming at the same spot.
  Post-TestFlight: start a new episode, lock the phone and walk out of Wi-Fi range (it should keep
  playing with no jump back); pause, come back later, resume (same spot); let one episode run into the
  next with the phone locked; check an episode you finish is marked played.
- **Listen (iPhone): a podcast no longer sticks a few seconds before its end** · #225 · **TestFlight
  build** (native only; no Netlify deploy, nothing changes on the laptop). An episode stuck in its
  last stretch with the network up counts as finished (marked played, the queue moves on); one stuck
  earlier reconnects at the same spot; play after a stall reopens the episode there. Post-TestFlight:
  play the last minute of a few episodes, phone unlocked and locked, and check each ends and the
  next one starts; the Weekly Show episode that stuck at 1:21:21 should finish within about 15 s.
- **Listen (iPhone): an interrupted read carries on; skip within an article** · #220 · **TestFlight
  build** (native + bundled web code; the laptop's web voice is unchanged). After a text or other short
  interruption the article resumes by itself, and play always works (fresh synthesizer from the last
  word). Now Playing back/forward, the seek bar and the lock screen's ±skip move within the article by
  sentences. Post-TestFlight: text yourself mid-article; skip back and forward; drag the bar.
- **Display: each view's own logo and name; plain theme cards; holiday and game-day themes** ·
  #219 · **TestFlight build** (client-only; the laptop needs a Netlify deploy). Settings ›
  Display per view: upload a logo that replaces the sailboat (stored like the profile photo) and
  rename the view; theme cards lose the color-name lines; new Automatic section — Holidays (the
  holiday's theme all day) and Game days (a switched-on favorite's colors while it plays, higher
  rank wins; favorites reorderable). Migration `migrations/2026-11-04-view-logos.sql` (the
  `avatars` bucket takes PNGs) **applied to prod 2026-11-05**. No new env vars. Post-deploy:
  upload a logo in Household and rename it; turn on Game days with one team and
  check its colors during a live game, and that they go away after the final.
- **The Amplifier (iPhone): keeps going after a song with the phone locked** · #217 · **TestFlight
  build only** (Swift; nothing for Netlify). A silent mixable keep-alive holds the app awake while a
  show's song plays, so the next write-up starts when the song ends. Post-TestFlight: play a show
  through two songs with the phone locked; pause and resume from the lock screen during a song.
- **Radio (iPhone): web-player fallback and failure reason** · #216 · **TestFlight build**
  (client + native; the laptop's web player is unchanged apart from a clearer toast). A station
  the native player can't start is retried in the web view's player before the "unavailable"
  toast, and the toast says why. Post-deploy: on the laptop, play MPR News and The Current.
- **Themes: Thanksgiving; Seasonal covers November** · #211 · **TestFlight build** (client-only;
  the laptop needs a Netlify deploy). Settings › Display › Holiday gains Thanksgiving (brown,
  pumpkin, gold, olive, cranberry; light and dark). Seasonal now shows Thanksgiving all of
  November, and its line names what comes next. No migration, no new env vars.
  Post-deploy: pick Thanksgiving in Light and Dark — Calendar, Meal Plan, Shop, Finance, News
  read clearly and the dock is brown. Anyone on Seasonal sees Thanksgiving until Dec 1.
- **Watch: cross episodes off, services from the right, plainer seasons and Next** · #203 ·
  Posters show only the title (year/seasons stay in the panel); episodes are crossed off by
  tapping (no check boxes); services start at the right with "Other services" last; the
  season menu says only "Season N" (no bar, no "All"); NEXT shows "S1 E1" beside it and a
  plain ✓. Post-deploy: open a show on the phone and cross an episode off and back.
- **Watch: hide the NEXT box** · #204 · The show panel no longer shows the Next-episode
  line (code kept behind `WATCH_SHOW_NEXT_BOX`); a season that's loading keeps the
  episode list's height so the screen doesn't move. Post-deploy: open a show — no NEXT box.
- **Watch: services as links under the year line; light panel; one season box** · #205 ·
  Services / Other services are plain links in the theme's link colour, left-aligned with
  Other services first, right under the year line; the panel is the light surface and the
  season menu heads one box with its episodes. Post-deploy: open a show in light and dark.
- **Watch: per-tick merge; episode lists live on the device** · #206 · Each episode tick, tab change and edit carries its own time and merges on its own, so two people's ticks both stick (`watch-merge.js`); season episode lists stay in each device's storage, not the synced row (`watch-episodes.js`). Post-deploy: tick an episode on the phone and a different one of the same show on the laptop before either refreshes — both stay ticked.
- **Sync: a view switch no longer re-sends every section row** · #207 · Shared state-sync fix (WATCH_AUDIT D2). Post-deploy (and after the TestFlight build): in the Supabase edge logs, one change → one or two `tableplan_states` PATCHes, not ~15.
- **Watch: seasons panel polish; week-old shows refresh on view** · #208 · Whole season shows (no inner scroll), ~30px one-line rows, the next episode marked, not-yet-aired episodes dated and untappable, load errors with Try again; where-to-watch and season counts refresh when over 7 days old. Post-deploy: open a show — next episode highlighted; a show added months ago gets fresh services.
- **Watch: Archive actions open with a tap on the phone** · #209 · Tapping an archived show or its ⋯ opens Edit · Back to Watch list · Delete (was right-click only). Post-deploy: on the laptop, Watch › Archive › tap a show → the menu; Back to Watch list returns it.
- **Watch: a show opens where you are, not at Season 1** · #210 · Your place = the episode crossed off most recently: the panel opens on its season, next = the one after it (earlier unticked ones are skipped), the poster bar shows that season. Never-started talk / reality / news shows open on their latest aired season. **Needs the deploy** for that last part (`tmdb-watch-providers` returns showType / genreIds / lastAiredSeason). Post-deploy: open SNL — Season 51 (or its latest), not Season 1.
- **Documents: encrypted Household and Personal documents** · #213 · New Documents page in Household (shared, Receipts first) and Personal, end-to-end encrypted (DOCUMENTS_DESIGN.md): Face ID on every open on the iPhone, scanning up to 30 pages, upload/drag-and-drop, viewer and share sheet, Recently deleted, recovery code, lost-phone recovery through the other member's devices, receipt scans filed into Household › Receipts. Already live without a deploy: the `doc_` tables, the `doc-storage` Edge Function and the R2 bucket; on the iPhone it works from the TestFlight build (Luke tested 2026-11-03). **The deploy adds the web/laptop pages.** Pre-deploy: the 360 px pass on Documents (and `npm run qa:documents-ui`). Post-deploy: on the laptop, link the browser in Messages, open Household Documents (it waits until the phone opens it once), drag a PDF in, open it on the phone; check the `doc-storage` logs show 200s and no 403s for your scopes.
- **Documents: web passkey lock, sign out other sessions, Apple's viewer, kept copies + review fixes** · #215 · **TestFlight build** (the Swift viewer changed). Removing a device, a Messages reset, a restore and the lost-phone re-key sign out every other Live session; only the Sign out button wipes a device's Messages/Documents (a remote or expired sign-out keeps them); a device whose Documents was reset gets the keys again only after Allow on the phone; iPhone **Open** shows the file in Quick Look (40 MB, closed when the app stops being active); recently opened files kept encrypted on the device. **The deploy adds** the browser passkey lock (⚙ › Lock with a passkey). Post-TestFlight: open a document › Open › swipe to the app switcher — it closes and isn't in the snapshot. Post-deploy: on the laptop, turn the passkey lock on with a second tab open (that tab locks), leave and come back (Touch ID asks), turn it off; remove a test device and check the other devices sign in again but keep their Messages.
- **Document page: everyday documents with the Safe inside** · #218 · **TestFlight build** for the iPhone. Documents is renamed **Document**. Everyday documents (Household: Receipts, Home, Vehicles; Personal: empty) are kept like the rest of Live and open with no Face ID on any signed-in device. The encrypted part is now the **Safe**, a sidebar entry with Face ID on every open (Household Safe: IDs & Records, Insurance, Medical). Receipts scanned in Shop go straight into everyday Receipts. Already live (Luke OK'd 2026-11-04): the `doc_pfolders` / `doc_pfiles` tables and `doc-storage` v6. **The deploy adds** the laptop/web page. Post-TestFlight: open Household on the phone with no Face ID; add a file; open the Safe (Face ID asks) and tap **Move them** to bring Receipts / Home / Vehicles out; scan a receipt in Shop and find it in Receipts; Marijane sees the everyday files at once. Post-deploy: the same on the laptop; check the `doc-storage` logs show 200s for `p/` links.
