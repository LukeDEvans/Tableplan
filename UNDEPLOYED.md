# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Shared order screenshots kept in Document** · branch `claude/share-screenshots-documents` ·
  **TestFlight build** (Swift + web code; App Group `group.com.mrlukedevans.live` registered by Luke
  2026-11-12 and enabled on both App IDs). After a share succeeds, the extension keeps the screenshots
  (or the order-summary PDF) in the App Group; the app files them into Document › Receipts with their
  receipt next time it opens (several screenshots become one PDF; a Personal receipt's file then moves to
  Personal). Matches its receipt by total and date until the deploy; `share-receipt` now also returns
  the receipt id (used after the next Netlify deploy, not required). Post-TestFlight: share an Amazon
  order screenshot to Live, open Live, open Document › Receipts.
