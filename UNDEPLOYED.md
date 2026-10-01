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

Checks for work that's already live are in [POST_DEPLOY_CHECKS.md](POST_DEPLOY_CHECKS.md).
