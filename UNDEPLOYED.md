# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Watch & Scores open the right streaming app** (STREAMING_HANDOFF_DESIGN.md) · #173 · New `LinkOut` iOS plugin; Watch's Open buttons try the service's app first; live / about-to-start games in Scores and the dock's game card get Watch buttons (Xfinity Stream first for TV channels); Streaming Services › Sports apps; Admin › Beta › Link Test. The `stream-links` function is new and stays off until `STREAMING_AVAILABILITY_KEY` is set.
  Post-deploy: (1) TestFlight build — the plugin needs it. (2) On the phone: Settings › Admin › Beta › Link Test, tap each service, "Copy results", paste into a chat so the unverified schemes in `link-out.js` can be fixed. (3) During a live game: Scores › the game › Watch → Xfinity Stream opens. (4) Once the key is in Netlify (and deployed): open a Watch-list show's service → the app opens on the next episode; Netlify logs show one `stream-links` upstream line per title, not per tap.
- **Calendar: phone month view lists the tapped day under the grid** · #170 · Phone only (≤560px): dots in the grid (max three, tasks as a hollow dot), the selected day listed below, + adds an event, the date opens the day view. Reaches the iPhone with the next TestFlight build; the web app on a phone needs a deploy. Post-deploy: on the phone, open Calendar › Month — today is outlined and listed; tap a busy day and check its events, tap one to open it, try + and the date.
- **Dutch learning build** (LANGUAGE_PRACTICE.md §8–19) · #171 · Add words (paste from Rosetta Stone), spaced-repetition flashcards, Match upgrade (due words, Listen mode), de/het, Listen, Sentences, Speak; new `LiveLanguage` iOS plugin + mic/speech-recognition strings.
  Post-deploy: (1) TestFlight build (`npm run ios:sync`, Xcode) — the plugin and Info.plist need it. (2) On the phone: Leisure › Dutch → Speak: allow the mic and speech prompts, say a word → "Understood"; play your recording; then check a podcast still plays normally. (3) On the laptop: paste a Rosetta Stone lesson in Add words; check it appears first and on the phone after a refresh. (4) Supabase API logs (`service: api`) 48h: the personal `recreate` row is written once per practice round, not per tap.
- **Receipts: code does the math, scan and go, iPhone text recognition** · #172 · server + web + phone (TestFlight)
  - The AI transcribes; `receipt-reconcile.js` checks the math (savings/fees before or after the subtotal, store profiles); a second look with the stronger model when it doesn't add up. Scan, send, close the app: `scan-receipt-background` + `receipt-scans`, results in `receiptscan_<group>_<id>` rows. "Needs a look" on receipts that don't add up. iPhone text recognition in the DocumentScanner plugin.
  - Post-deploy: (1) in a browser, Shop › Receipts › Scan receipt › Send receipt with a photo → toast "Receipt sent ✓", then within ~1 min the receipt appears (and the toast says whether it adds up). (2) Netlify log for `scan-receipt-background`: one line per read ("ok"/"check", "(second look)" when used, duration). (3) Supabase: `select id from tableplan_states where id like 'receiptscan_%'` shows the result row. (4) Re-open an old Costco receipt: its edit view says "Adds up". (5) Then a TestFlight build: scan with the camera and close the app straight after the toast; reopen later and check it arrived; a library photo too.
