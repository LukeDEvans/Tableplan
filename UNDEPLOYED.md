# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Nothing undeployed. Last deploy: 2026-09-30 (commit 51efeca, PRs #8–#24)._

Checks for work that's already live are in [POST_DEPLOY_CHECKS.md](POST_DEPLOY_CHECKS.md).
