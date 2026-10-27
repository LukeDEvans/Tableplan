# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Exercise: new lift pictograms (Chest & Back, Arms & Shoulders, Legs)** · #180 · After deploy: open Exercise and check each Strength card shows its own picture (transparent background intact); other Strength cards still show the general weightlifting one. Web code only — the iPhone app needs a TestFlight build to show it.
- **Explore: trip pictures; New trip leads each row** · #178 · After deploy: on the phone, open a trip → 🖼️ Add picture → choose one of the pictograms; check the card shows it (transparent background intact) and that Use row picture puts the default back. Then check each row starts with New trip showing its row picture. Web code only — the iPhone app needs a TestFlight build to show it.
- **Views: stop Personal data leaking into Household rows** · #179 · The local copy carries the scopes its data belongs to; two switch-time races guarded. **Post-deploy:** ship a TestFlight build (the iPhone app bundles its web code, and it's the device that leaked); once both phones have it, clean Household's Listen row (and Watch, if Luke says it's a copy) with Luke's OK — ISSUES.md P0. For a few days, check the Supabase API logs: no write to `<groupId>:media` right after a boot load that then switches Listen to Personal.
- **Views: test that every switchable section is leak-guarded** · #181 · Test and ISSUES.md only; nothing to check after deploy.
