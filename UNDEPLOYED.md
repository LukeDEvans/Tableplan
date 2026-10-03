# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-10-03 #2 (PR #49)._

_Nothing undeployed._
- **Weather (and other server features) in the iPhone app: real root cause** · PR #TBD · In the app `canUseLocalBackend()` is true (`capacitor://localhost`), so URL helpers used local-dev `/api/<name>` paths that 404 on the live site — weather showed "outside NWS coverage"/"couldn't reach location search", and TMDB/showtimes/YouTube search, calendar ICS, travel time, booking/recipe/article scans, recipe import and nutrition estimate were hit the same way. The native fetch shim now maps them to the deployed functions (`nativeApiPath`, native-bridge.js). The app bundles its web code, so this ships to the phone **only via a TestFlight build**. Post-deploy (after the TestFlight build): the dock's weather slide shows local weather; Weather → search "Minneapolis" returns results; spot-check Watch search and a recipe import in the app.
