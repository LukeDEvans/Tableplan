# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-10-01 (PRs #21, #22, #25, #26, #27, #31)._

## iPhone app: native player for podcasts + radio; Apple voice per device (PR #28)
PR: https://github.com/LukeDEvans/Tableplan/pull/28

The iPhone side ships through TestFlight. In the app, podcasts, radio and non-Apple music
(Internet Archive, Jamendo, uploaded songs) play on the native player (lock-screen and AirPods
pause/resume), and articles default to the best installed
Apple voice. The voice choice is per device, so choosing one on the phone no longer changes
the web app's voice. The website itself is unchanged.

**After deploying:**
1. Web: Settings → Voice still shows the household voice (not "device").
2. Next TestFlight build from `main`: podcast/radio lock-screen pause and resume still work.

## iPhone app: full NYT / Economist / Star Tribune articles with your login (PR #33)
PR: https://github.com/LukeDEvans/Tableplan/pull/33

Ships through TestFlight. The website is unchanged. In the app, Media → menu → Sync Settings →
"Full articles on this iPhone" signs in to each paper in an in-app browser. Articles from those
papers then load in full on the phone. A cut-off article shows "Sign in" / "Reload full article".

**After the next TestFlight build:**
1. Sign in to The Economist (email + password), then open an Economist article from a news-email
   card. It should load in full. Repeat for NYT and Star Tribune.
2. Sign out of one paper, reopen a new article from it: it should come back cut off with the
   Sign in / Reload buttons.

Checks for work that's already live are in [POST_DEPLOY_CHECKS.md](POST_DEPLOY_CHECKS.md).

## Media "Playlist" → "Queue"; Shop date-button tap colour; weather search (PR #34)
PR: https://github.com/LukeDEvans/Tableplan/pull/34

The main media list is now called "Queue" (sidebar tab, settings menu and modal, add/remove
buttons, toasts). Named podcast/music playlists still say "playlist". The Shop date buttons no
longer stay patina after a tap on a phone. Weather search accepts "City, ST" and shows a
message when nothing matches or the search can't be reached. In the iPhone app, the weather
page now reaches its server function (it was fetching the app's own page).

**After deploying:**
1. Phone: tap a Shop date button, pick a date. The date goes back to dark once your finger lifts.
2. Weather → Search a place: "Portland, OR" and "Austin TX" each list the right city.
3. Next TestFlight build: the Weather page loads a forecast and search returns cities.

## Header receipt scanner (Camera / Photo → Shop + Finance); User moves into Settings (PR #35)
PR: https://github.com/LukeDEvans/Tableplan/pull/35

The top-right button is now a receipt scanner (Camera / Photo). A scanned receipt opens Shop's
review dialog already reading it, and is also read + saved to Finance → Receipts in the background,
where it matches its charge once it posts. "User" (the profile window, now titled "User") is the
first Settings menu item; the Settings button always opens the menu. Shop receipt scan also works
in the iPhone app now.

**After deploying:**
1. Phone: scanner → Camera, photograph a receipt. Shop's review opens with the lines filled in, and
   a toast says it was saved to Finance.
2. Finance → Insights → Receipts: the receipt shows (unmatched until the charge posts). After it
   posts, Itemize builds the split and the transaction shows the receipt photo. If the photo is
   missing, check the `receipt-attachments` bucket's RLS allows `<uid>/scans/…`.
3. Settings → User opens the profile window; log out / log in still work.
4. Next TestFlight build: scanner → Camera, then check that the photo is not in the Photos library.
