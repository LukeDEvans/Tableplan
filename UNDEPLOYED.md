# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Wallet: barcodes that scan** · #278 · client only. The live Wallet draws Code 128 and QR codes with the app's global svg outline, which fills the white spaces, so a till scanner probably can't read them. Fixed, and a new card's barcode now follows a pasted number. Reaches the iPhone by TestFlight; the web on the next deploy. Post-deploy, Claude (Luke's Chrome): add a Household card, open it, the bars are crisp black and white, delete it. Luke (iPhone): show a Wallet card at a till.
- **Utilities polish** · #281 · client only. "Talk to Liv" removed from the menu (Chat with Liv does both; hold-to-talk stays); Scan opens the scanner at once; Photos photo view gets a **Receipt** button; Calculator and Clock rebuilt to look and work like the iPhone's (Clock adds World Clock, alarm switches, wheel pickers, lap colours, timer Recents); Shazam listens on open and has a History button (UTILITIES_MENU_DESIGN.md §12). Reaches the iPhone by TestFlight; the web on the next deploy. Post-deploy, Claude (Luke's Chrome): the laptop menu shows Chat, Scan, Calculator, Clock, Wallet; Scan opens the file picker; Calculator types 1200+3×2= → 1,206 with the expression above; Clock has World Clock / Stopwatch / Timers. Luke (iPhone): Scan opens the camera straight away; Photos › a receipt photo › Receipt; add an alarm, switch it off and on; Shazam starts listening on open, History lists songs.
- **Scores: each college sport is its own team** · (this branch) · client only, no migration to run. Following the Gophers now means three favorites — football, basketball, hockey — each with its own games in My Teams and its own next/last row when idle (it used to show only one sport's next game). An existing Gophers favorite turns into all three by itself; their game-day colors stay on. News story ranking is unchanged (still one school). SPORTS_SCORES_DESIGN.md §3a. Reaches the iPhone by TestFlight; the web on the next deploy. Post-deploy, Claude (Luke's Chrome): News › Sports › Scores — My Teams lists Minnesota Basketball and Minnesota Hockey on their own rows with a Next game each; the teams dialog shows Minnesota Football / Basketball / Hockey chips; Settings › Display lists the three. Luke (iPhone): glance at My Teams on a day the Gophers play two sports.
