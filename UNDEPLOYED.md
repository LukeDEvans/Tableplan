# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-10-11 #2 (News: Sports always shows)._

- **Shop: the blue window border is back** · PR #82 · The 2026-10-06 change that slimmed the Shop window also removed its navy border; the border is restored. The buffer and shadow stay off and the trimmed list gutter stays, so the list keeps its extra width. CSS only. Verified in the browser at 390px: 2px navy border, no sideways scroll. **After deploy + TestFlight:** open Shop on the phone and check the border.
