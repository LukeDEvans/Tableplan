# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-09-30 (commit 51efeca, PRs #8–#24)._

## Native Apple Music in the iOS app (PR #25)
PR: https://github.com/LukeDEvans/Tableplan/pull/25

The phone side is already live through TestFlight (build 20260930.0247, verified by Luke).
What the website deploy adds:
- Settings → Apple Music shows a diagnostic line (which path Apple Music takes, plugins, bundle).
- In the iOS app, Apple Music is only offered when the native plugin is present; on the web,
  nothing changes (MusicKit JS as before).
- The TestFlight workflow now builds the branch it's started from (takes effect on merge).

**After deploying:**
1. Web: Settings → Apple Music shows "Using: web (MusicKit JS)", and sign-in still works.
2. Next TestFlight build from `main` (not the branch): Apple Music still signs in natively.


## Podcasts: large feeds no longer fail (PR #26)
PR: https://github.com/LukeDEvans/Tableplan/pull/26

White Coat Investor (and likely NPR Politics) stopped getting new episodes because their
feeds grew past the 5 MB fetch cap. The feed fetcher now reads the first 2 MB and keeps the
newest complete episodes. Subscribe buttons show the real error instead of "Failed", and a
show whose feed keeps failing gets a "Not updating since…" note.

**After deploying:**
1. Open White Coat Investor; recent episodes (late Sept) appear after the next refresh.
2. Re-subscribe to NPR Politics; it should succeed (or show the actual error).

## Sync, auth and service-worker fixes (PR #27)
PR: https://github.com/LukeDEvans/Tableplan/pull/27

Shared-infrastructure fixes from the full-app audit (INF-1 to INF-11): edits made during a
save are no longer lost (P0, finance especially); only changed sections are written after a
load; no cloud snapshot is posted when nothing changed; a failed group lookup no longer shows
the "set up your group" dialog or writes to the wrong rows; sign-out flushes pending edits and
drops this device's push subscription; boot failures show a message instead of hanging on
"Checking sign-in"; supabase-js pinned to 2.117.2; the service worker caches only static
files (cache v36).

**After deploying:**
1. Sign in on web and phone; edit something on each and confirm it appears on the other.
2. Make an edit and immediately another; reload; both are there.
3. Hard-refresh once so the new service worker (v36) takes over; the app still loads offline.

## Full-app audit fixes (PR #22)
PR: https://github.com/LukeDEvans/Tableplan/pull/22

Security: Gmail sign-in state is HMAC-signed with an expiry; email, show notes and article
HTML go through one allowlist sanitizer; ics-proxy uses the SSRF-guarded fetch; the TTS
pre-synthesis worker requires a key only the cron sends; the travel-map-url function that
returned the raw Maps key is deleted; path-traversal and prompt-size guards. Plus data-loss and
correctness fixes across finance, calendar/ICS, meal plan, shop, recipes, travel, weather,
music, contacts and health. Inbox triage has a Mail AI toggle (on by default).

**After deploying:**
1. Mail: open an HTML newsletter; it renders (images and links) with nothing broken.
2. Settings → Mail: reconnect Gmail once to confirm sign-in still completes.
3. Calendar: a subscribed ICS calendar shows events at the right local times.
4. Next morning: the presynth cron log shows "triggered worker → 202" (not 403).

## Refresh changed data when the app returns (PR #21)
PR: https://github.com/LukeDEvans/Tableplan/pull/21

When a tab or the iPhone app comes back to the foreground, it now checks which synced
sections changed on the server (a few KB) and pulls in just those. So newsletters the mail
sweep saved, or edits from another device, show up without restarting. At most once every
2 minutes, only on return to the foreground (no polling).

**After deploying:**
1. Leave the iPhone app in the background, edit something on the web, reopen the app after
   2+ minutes: the edit is there without a restart.

## Pre-deploy fixes: deleted trip/chore items no longer come back, Explore on phones (PR #31)
PR: https://github.com/LukeDEvans/Tableplan/pull/31

- Changing a trip's dates no longer risks a duplicate trip bar on the calendar after another
  device syncs: the replaced calendar event is now recorded as deleted.
- Removing a chore from a calendar event (or turning off its To-Do) no longer has the task
  come back after a sync and then disappear again. Only the current week onward; past weeks
  are unchanged until the chore-retention decision is made.
- Explore on a phone: the trip list opens full-width, so the empty-state text no longer
  peeks out beside it.

**After deploying:**
1. Change a trip's dates on the web, then open Calendar on the phone: one trip bar, not two.
2. Explore on the phone: open and close the trip list; nothing peeks out beside it.

Checks for work that's already live are in [POST_DEPLOY_CHECKS.md](POST_DEPLOY_CHECKS.md).
