# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Wallet: barcodes that scan** · #278 · client only. The live Wallet draws Code 128 and QR codes with the app's global svg outline, which fills the white spaces, so a till scanner probably can't read them. Fixed, and a new card's barcode now follows a pasted number. Reaches the iPhone by TestFlight; the web on the next deploy. Post-deploy, Claude (Luke's Chrome): add a Household card, open it, the bars are crisp black and white, delete it. Luke (iPhone): show a Wallet card at a till.
