# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-10-08 (PRs #72–#76)._

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
