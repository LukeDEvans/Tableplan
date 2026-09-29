# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

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

