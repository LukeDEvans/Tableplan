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

Checks for work that's already live are in [POST_DEPLOY_CHECKS.md](POST_DEPLOY_CHECKS.md).
