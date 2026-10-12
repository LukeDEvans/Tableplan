# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Calendar: pinch direction flipped** — fingers apart zooms in (month → week → day), together zooms out. · PR #81 · Post-deploy: on the phone, pinch out from month → week → day and back in to month.

_Last deploy: 2026-10-11 #2 (News: Sports always shows)._
