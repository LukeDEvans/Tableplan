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

- **Shop: the blue window border is back** · PR #82 · The 2026-10-06 change that slimmed the Shop window also removed its navy border; the border is restored. The buffer and shadow stay off and the trimmed list gutter stays, so the list keeps its extra width. CSS only. Verified in the browser at 390px: 2px navy border, no sideways scroll. **After deploy + TestFlight:** open Shop on the phone and check the border.

- **Finance: decluttered top of page + no sideways scroll on Insights** · branch `claude/finance-declutter` (no PR — merged directly) · Removed the Net worth / Cash on hand / This month cards and the alert-chip row (to review, bank connection error, stale, large purchase, low balance, over budget, to itemize); those figures live in Accounts, and the Transactions/Accounts tab dots + the bell still flag attention. Dropped the matching overview-only toggles (over budget, large purchase, low balance) from Settings › Finance › Alerts. Insights' Cash flow In/Out/Net row now wraps instead of pushing the page ~80px sideways at phone width. Verified at 360px in headless Chromium on every finance tab. **After deploy + TestFlight:** open Finance on the phone — tabs at the top, no cards/chips; swipe sideways on Insights and confirm it doesn't move.
