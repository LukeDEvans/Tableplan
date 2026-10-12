# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-10-11 (PRs #78–#80 + receipt-scan fix)._

- **News: Sports always shows, so Scores can be reached** · direct to `main` · **Fix:** the Sports section only appeared in the News sidebar once a sports article had arrived, and none had, so the Scores view (PR #78) couldn't be opened. Sports now always shows when Scores is available. Client only. Verified in the browser at 1280px and 390px with no sports articles: Sports shows and opens on Scores. **After deploy + TestFlight:** News → sidebar → Sports → Scores loads today's games.
