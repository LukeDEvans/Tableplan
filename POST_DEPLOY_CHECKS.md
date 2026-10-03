# Post-deploy checks

Checks to do after a deploy — everything here is already **live**. (Work that has NOT
shipped yet is listed in [UNDEPLOYED.md](UNDEPLOYED.md).) When deploying, move each
UNDEPLOYED.md entry's "After deploying" steps here under a heading for that deploy.
Tick items off as they're done; delete a deploy's section once it's all ticked.

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
