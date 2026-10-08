# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-10-07 (PRs #59–#70)._

- **News: sign in to your papers in the iPhone app, no cookie pasting** · PR #PRNUM
  - The app's own newspaper sign-ins (Sync Settings → "Newspaper sign-ins on this device") now turn
    News on. When the sign-in sheet closes, the phone checks each paper itself and sends the server
    only "signed in / not signed in" per paper; the sign-in cookies stay on the phone. The sheet now
    opens sign-in popups properly, which is what Sign in with Apple needs. The News page shows its
    "Open Sync Settings" prompt whenever no paper is signed in (it used to stay hidden until a
    sign-in had been saved, so there was no way to find it). Pasting cookies in a browser still works.
  - **Needs both a deploy and a TestFlight build.** The server change is in the `gmail` function; an
    app on the new build against the old server signs in fine but News stays empty.
  - **After deploy + TestFlight (none of this has run on a phone; the Swift was not compiled):**
    - the TestFlight build succeeds (first compile of the new Swift)
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
