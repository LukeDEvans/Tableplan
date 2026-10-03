# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-10-03 (PRs #41–#47)._

_Nothing undeployed._
- **Weather + store search work in the iPhone app** · PR #TBD · Root cause of "couldn't reach location search" in the app: the `weather`, `google-places` and `instacart-list` functions answer only an origin allowlist, and the iPhone app's requests (replayed natively by CapacitorHttp, with no Origin) got no `Access-Control-Allow-Origin`, so iOS discarded every reply. Requests with no Origin now get `*`, and `capacitor://localhost` is on the list; other websites' pages stay blocked. Server-only: no TestFlight build needed. Post-deploy: in the iPhone app, the dock's weather slide shows local weather; Weather → search "Minneapolis" returns results; Shop → store search still finds stores; Shop → "Send to Instacart" shows as available.
