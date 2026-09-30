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

Checks for work that's already live are in [POST_DEPLOY_CHECKS.md](POST_DEPLOY_CHECKS.md).
