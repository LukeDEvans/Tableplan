# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Tools menu closes on an outside tap** · #285 · client only. Opening Settings (or tapping/clicking anywhere else, or Esc) now closes the nine-dot tools menu. Post-deploy, Claude (Luke's Chrome): open the tools menu, click Settings → only Settings is open. Luke (iPhone): same check.
