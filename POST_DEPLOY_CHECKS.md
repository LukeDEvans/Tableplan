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

- [ ] **Google Calendar: connect it** (#90) — `gcal_accounts` is empty, so the Google API
      sync was never connected; Calendar reads Google only through old iCal links. Calendar
      › Add Calendar › Connect Google Calendar (Luke approves Google's screen); then check
      timed events, a new Google event appearing within ~5 min, and the severance report.
- [ ] **Word processor + attachments** (#223, #234, #235) — open the email with the Word
      file: opens in the editor "From email · view only"; Save to Document; a .csv / .ics /
      .vcf open as a table / event / contact.
- [ ] **Document on the laptop** (#213, #215, #218) — Household Document opens; drag a PDF
      in (then check it on the phone); passkey lock on/off.
- [ ] **Deletes stay per view** (#229) — same title in Personal and Household Watch; remove
      from Household; still in Personal; remove there; gone from both after a refresh.
- [ ] **Two people's Watch ticks both stick** (#206) — tick an episode on the laptop while
      Luke ticks a different one on the phone.
- [ ] **Mail folder switching** (#221) — Inbox → AI Trash → Inbox fast, several times: no
      "Quota exceeded"; archive, switch away and back: it's gone.
- [ ] **Watch: a show opens where you are** (#210) — SNL opens on its latest season.
- [ ] **Display per view** (#219) — Household: upload a logo, rename the view.
- [ ] **Version stamp** (#176) — Settings shows "Version <commit> · <date>" for the last deploy.
- [ ] **Link the laptop browser in Messages** (#201) — Link this browser → Luke scans the QR.

## Claude, server

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
