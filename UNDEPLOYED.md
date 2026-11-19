# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **News: team names from the real favorites; no Athletic team feed for Minnesota Morris** · #187 · Server only (`_news-rank.js`, `_news-feeds.js`); no TestFlight build. Ajax matches "Ajax" (not any "Amsterdam"); "Cougars" alone no longer pulls in BYU/Houston stories for Minnesota Morris; the two Athletic 404s each hour stop. **After deploying:** the next hourly `newsfeeds_status` has no `college-football/minnesota*` team feeds and no Athletic 404s.
