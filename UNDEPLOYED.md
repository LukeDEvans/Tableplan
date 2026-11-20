# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **News: pinned section header, Saved sidebar, Front page + For you blended** · #283 · client + server, no migration. The header and sidebar are client only (TestFlight build from the branch on 2026-11-20). The blended Front page needs the deploy: until then the app keeps For you as a section and shows the plain Front page. Post-deploy, Claude (Luke's Chrome): open News → the Front page reply has `blend: true`, shows "Top stories" then "For you", For you is gone from the header and "What News has learned" is at the foot of the section menu; check the function log for `[news] blend:` warnings. Luke (iPhone): swipe the header, open the Saved list, glance at the blended Front page — are the lifted "For you" stories ones you'd want?
- **Wallet: barcodes that scan** · #278 · client only. The live Wallet draws Code 128 and QR codes with the app's global svg outline, which fills the white spaces, so a till scanner probably can't read them. Fixed, and a new card's barcode now follows a pasted number. Reaches the iPhone by TestFlight; the web on the next deploy. Post-deploy, Claude (Luke's Chrome): add a Household card, open it, the bars are crisp black and white, delete it. Luke (iPhone): show a Wallet card at a till.
- **Utilities polish** · #281 · client only. "Talk to Liv" removed from the menu (Chat with Liv does both; hold-to-talk stays); Scan opens the scanner at once; Photos photo view gets a **Receipt** button; Calculator and Clock rebuilt to look and work like the iPhone's (Clock adds World Clock, alarm switches, wheel pickers, lap colours, timer Recents); Shazam listens on open and has a History button (UTILITIES_MENU_DESIGN.md §12). Reaches the iPhone by TestFlight; the web on the next deploy. Post-deploy, Claude (Luke's Chrome): the laptop menu shows Chat, Scan, Calculator, Clock, Wallet; Scan opens the file picker; Calculator types 1200+3×2= → 1,206 with the expression above; Clock has World Clock / Stopwatch / Timers. Luke (iPhone): Scan opens the camera straight away; Photos › a receipt photo › Receipt; add an alarm, switch it off and on; Shazam starts listening on open, History lists songs.
