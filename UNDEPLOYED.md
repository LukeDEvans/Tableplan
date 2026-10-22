# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Explore moves to Household, with shared trips** · #163 · **Netlify deploy + TestFlight build** (client-only; your wife uses only the web app, so she gets Explore at the next deploy). Explore is listed only in Household, and its trips are the household's shared list in every view. The shared trips were already set to your Türkiye 2026 and Grand Rapids (done 2026-10-22 by SQL); everyone's own trips are unchanged. No migration, no new env vars.
  Post-deploy:
  1. Personal: no Explore in the list. Household: Explore is last; it shows Türkiye 2026 and Grand Rapids, each once.
  2. Your wife (web): Household lists Explore with the same two trips. Without a home in her profile she sees "Add your home…" and the trips sit under Not sorted yet.
  3. Add or move a trip on one login; it shows on the other after a refresh.

- **Explore: Local / Regional / National / Global, with pictures; All trips retired** · #161 · **TestFlight build** (client-only; the laptop web app picks it up at the next deploy). Rows renamed (saved moves keep their row); each row's trip cards show its picture; the All trips button and trips list are gone, so the rows are the only way between trips. Edit / Delete trip are on a card's hold / right-click menu. No migration, no new env vars.
  Post-deploy:
  1. iPhone, Personal › Explore: rows read Local, Regional, National, Global; each trip card shows its row's picture (also in dark mode).
  2. No All trips button; tap a card → that trip, with only back and the bell above it; back returns to the rows.
  3. Hold a card → Move / Edit / Delete trip all work.

- **Dutch practice on Leisure** · #153 · **TestFlight build** (client-only; Luke prefers TestFlight for this; the laptop web app picks it up at the next deploy). Timed Dutch↔English matching game as a Dutch row on Leisure (Personal view), with lessons, unit and review rounds; progress saved in the personal `recreate` section. It was built 2026-10-20 but never merged, so builds from `main` since then dropped it; rebased onto `main` 2026-10-21. Word list still provisional until the Rosetta Stone list arrives. No migration, no new env vars.
  Post-deploy:
  1. Leisure: a Dutch row with lessons; start one, match a few pairs, finish or leave. The summary shows and the lesson's progress is kept after reopening the app.
  2. Earlier practice from the 2026-10-20 TestFlight build is still counted.

- **News: opening a story no longer saves it** · #159 · **Netlify deploy + TestFlight build** (client-only). Only ⋯ → Save puts a story in News → Saved. Tapping a story, Open, Listen and ticker headlines just mark it read and open the reader from a copy kept for that session only (saving it afterwards keeps the loaded text). No migration, no new env vars. Not checked in a browser yet (no Chromium in the cloud sandbox): run `npm run check:boot` before deploying.
  Post-deploy:
  1. News: tap a story, read it, close. It's marked read and Saved's count doesn't change.
  2. Listen to an unsaved story from ⋯ → Listen: it plays; still not in Saved.
  3. ⋯ → Save on a story: it appears in Saved, and opens with its text.

- **Music search: Apple Music only** · #158 · **TestFlight build** (client-only; Luke: iPhone only, no Netlify deploy needed for this). Internet Archive and Musopen are no longer searched, so results come straight from Apple Music. Music already saved from them still plays. No migration, no new env vars.
  Post-deploy:
  1. iPhone, Listen › Music, search anything: Apple Music results in a second or two, no "Free & open sources" section.

- **Music search no longer sticks on "Searching…"** · #156 · **Netlify deploy + TestFlight build** (client-only). Each source in Listen › Music search gets 12 s; one that doesn't answer is named in the note ("… unavailable — showing the rest") and the others' results show. No migration, no new env vars.
  Post-deploy:
  1. iPhone, Listen › Music, search "beethoven": results appear within about 12 s.
  2. Note which source the line above the results names (if any) and add it to the ISSUES.md entry so that source gets fixed.

- **Flat menus; shorter Personal list; Scores back in News** · #155 · **Netlify deploy + TestFlight build** (client-only). No group headings in any view; the landing box back to its old width. Personal lists Overview, Calendar, News, Finance, Watch, Listen, Mail, Explore, Exercise, Leisure. Meal Plan and Shop only in Household; Tasks only inside the Calendar; Weather only from the dock; Scores back in News → Sports. No migration, no new env vars.
  Post-deploy:
  1. Landing (Personal): a plain list, no Plan / Inform / … headings; the white box hugs the links; no sideways scroll.
  2. News → Sports: Scores and Stories tabs; tables and team schedules open from Scores. A ticker game opens there.
  3. Weather from the dock still opens; Tasks from the Calendar still opens.
  4. Household: Calendar, Meal Plan, Finance, Shop, Watch, Listen as before.

- **Business calendar: only its own events** · #154 · **Netlify deploy + TestFlight build** (client-only). The Business calendar no longer shows Bills, Meal Plan, Exercise, Tasks or Birthdays (entries the Calendar adds from other pages), and its sidebar drops their switches. Personal and Household unchanged. No migration, no new env vars.
  Post-deploy:
  1. Business calendar: empty (nothing added there yet); sidebar has no Meal Plan / Exercise / Tasks / Birthdays / Bills rows.
  2. Personal calendar: Bills and the rest still show as before.
- **Watch redraws when the view changes** · #154 · same deploy. Switching views from Watch (or any change merged from another device) now redraws the Watch list; it used to keep the previous view's list until you left the page.
  Post-deploy:
  1. On Watch in Personal, open the page menu, swipe to Household, tap Watch: the list is Household's (empty today), not yours.
