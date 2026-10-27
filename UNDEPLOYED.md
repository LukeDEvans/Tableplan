# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Exercise: new lift pictograms (Chest & Back, Arms & Shoulders, Legs)** · #PR · After deploy: open Exercise and check each Strength card shows its own picture (transparent background intact); other Strength cards still show the general weightlifting one. Web code only — the iPhone app needs a TestFlight build to show it.
- **Explore: trip pictures; New trip leads each row** · #178 · After deploy: on the phone, open a trip → 🖼️ Add picture → choose one of the pictograms; check the card shows it (transparent background intact) and that Use row picture puts the default back. Then check each row starts with New trip showing its row picture. Web code only — the iPhone app needs a TestFlight build to show it.
