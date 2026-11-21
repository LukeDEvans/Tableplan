# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Listen: one search bar, Best result, full artist pages** · #288 · client only (no Swift change). Listen's top bar searches music first on every tab, then your podcasts & books, then "Find podcasts and radio"; Music › Discover loses its own bar; a Best result card leads; artist pages show Top songs, Albums, Singles & EPs and All songs loading as you scroll (LISTEN_SEARCH_DESIGN.md). Reaches the iPhone by TestFlight; the web on the next deploy. Post-deploy, Claude (Luke's Chrome): search "Olivia Rodrigo" from Podcasts → her artist card first; open it, scroll All songs to the end; Back returns to the results; clearing returns to Podcasts. Luke (iPhone): "Olivia Rodrigo" → her artist card on top; Mumford & Sons → scroll All songs down to their oldest albums; play a song from All songs.
- **Wallet: barcodes that scan** · #278 · client only. The live Wallet draws Code 128 and QR codes with the app's global svg outline, which fills the white spaces, so a till scanner probably can't read them. Fixed, and a new card's barcode now follows a pasted number. Reaches the iPhone by TestFlight; the web on the next deploy. Post-deploy, Claude (Luke's Chrome): add a Household card, open it, the bars are crisp black and white, delete it. Luke (iPhone): show a Wallet card at a till.
- **Utilities polish** · #281 · client only. "Talk to Liv" removed from the menu (Chat with Liv does both; hold-to-talk stays); Scan opens the scanner at once; Photos photo view gets a **Receipt** button; Calculator and Clock rebuilt to look and work like the iPhone's (Clock adds World Clock, alarm switches, wheel pickers, lap colours, timer Recents); Shazam listens on open and has a History button (UTILITIES_MENU_DESIGN.md §12). Reaches the iPhone by TestFlight; the web on the next deploy. Post-deploy, Claude (Luke's Chrome): the laptop menu shows Chat, Scan, Calculator, Clock, Wallet; Scan opens the file picker; Calculator types 1200+3×2= → 1,206 with the expression above; Clock has World Clock / Stopwatch / Timers. Luke (iPhone): Scan opens the camera straight away; Photos › a receipt photo › Receipt; add an alarm, switch it off and on; Shazam starts listening on open, History lists songs.
