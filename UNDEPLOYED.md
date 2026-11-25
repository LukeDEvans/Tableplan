# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Finance: accounts listed by category, then person** · PR #318 · client only (TestFlight / next deploy). Accounts tab groups by category (Retirement, Credit cards…) with people as subsections; category rename/delete apply across everyone. Post-deploy: Claude checks the Accounts tab (view + ⋯ › Edit accounts) in Luke's Chrome.
- **Listen: series hold fixes from the first real early-access episode** · PR (podcast-upcoming-fixes) · client only (TestFlight / next deploy). Numbered feed titles (`725. …`) now match Apple's, and a series stays held after the announced part lands until the next morning's check. Post-deploy: nothing extra beyond the #271 entry; Claude checks the Captain Cook hold in Luke's Chrome if a series is mid-release.
