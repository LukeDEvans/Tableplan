# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

## Mail: more attachments open in the app (PR #234, 2026-11-13)

- **What:** on the web, a CSV opens as a table, a calendar invite as its events with
  **Add to Calendar** (the event editor opens filled in), a contact card with **Add to
  Contacts**, and audio / video in a player. The viewer moved to
  `mail-attachment-viewers.js`. No function, migration or state key.
- **After deploying, check on the laptop:** open a real email with a `.csv`, an `.ics`
  and a `.vcf` attachment; each opens in the app; Add to Calendar fills the editor with
  the right day and time; Add to Contacts adds the person. A Word file still offers
  Download until the word-processor PRs (#223, #235) land.
- **iPhone:** unchanged (Quick Look); no TestFlight build needed for this.
