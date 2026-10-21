# Page groups & the Recreate pages — design & as built

Status: **Headings retired 2026-10-20 (Luke: "try going back to not having the tabs"): every view's menu is a flat list (`views.js` `isFlatView` → true); the group markup and `page-groups.js` stay so headings could return in one place. Tasks, Weather and Scores no longer have menu entries; the landing box lost its 240px minimum width. See VIEWS_DESIGN.md decision 28.** Built in PR #134 (2026-10-17). Requested and decided by Luke, 2026-10-17.

## 1. What Luke asked for

- The landing page links and the page-title dropdown become **overarching tabs that open like an accordion**, only one open at a time:
  - **Plan**: Calendar, Meal Plan (and Tasks — see §2)
  - **Inform**: News, Weather
  - **Resource**: Finance, Shop
  - **Media**: Watch, **Listen** (restored to the menus; it was only reachable from the dock)
  - **Message**: Mail (more later)
  - **Recreate**: Explore, Exercise, Leisure, and the new **Scores** page
- Explore, Exercise and Leisure each take the old Recreate page's look: headings over sideways-scrolling rows of cards.
- Explore's rows are **Local, State, Country, World**; the last card of each row is a **+** that adds an entry to that row.
- Sports splits: **stories stay in News**; scores, schedules and standings/tables become their own page in Recreate.

## 2. Decisions (Luke, 2026-10-17)

1. **Tasks** goes under **Plan**. It still opens as the Tasks window over the Calendar (`showDoApp`); it has no page of its own.
2. **Explore cards are trips, sorted automatically** by comparing each destination with the Profile's home. A trip can be moved to another row; the move is kept.
3. **Exercise rows by kind** (Strength, Cardio, Games); **Leisure rows by hobby** (Sailing, Piano) with that hobby's entries or scores as cards and a + at the end.
4. The new page is called **Scores**.

## 3. As built

**Menus** (`page-groups.js`, shared nav infra)
- `PAGE_GROUPS` is the list. The buttons are static markup in `index.html` (old ids kept, so existing code and QA scripts still find them), one `.page-group` per group with a heading and a panel.
- `pageNavButtons()` in `app.js` is one row per page: its two buttons, the page switch that shows it, the app areas that count as "on this page", and how to open it. It drives visibility, wiring and the "current page" mark.
- The page menu opens on the current page's group and marks the current page (it isn't removed, so Message never vanishes).
- A page's notification mark carries up to its group's heading while the group is closed.
- A group with no visible pages (all switched off) is hidden.
- Switching groups **slides** (Luke, 2026-10-18): the old group closes while the new one opens, ~0.2s, pages fading with it (`slidePanel` in `page-groups.js`; off under Reduce Motion). The page menu opening on the current group doesn't slide. No arrows beside the headings (removed 2026-10-18).

**Scores**: `#scoresMainPage`, `showScoresApp`, route `#scores`, `activeAppArea === "scores"`. `scores-ui.js` refreshes only while that area is shown. News no longer takes a `scores` dependency; News → Sports is stories only. The dock ticker opens games on the Scores page. Scores shares **Recreate's** page switch (`accessPageKey`).

**Exercise**: rows Strength (reps), Cardio (timed), Games, each ending in a + that opens a new workout of that kind (`openNewWorkoutDialog(type)`). Hold or right-click a card for Edit / Delete.

**Leisure** (the old Recreate page; area `recreate`, routes `#leisure` / `#recreate`): one row per hobby. First card opens the hobby's full view, then sailing entries (tap to edit) or piano scores (tap to open), then a +. The score list comes from synced state, so the score engine loads only when a score is opened.

**Explore** (`explore-scope.js`, pure; landing in `app.js`)
- Opens on the rows; a card opens the trips view (sidebar + trip), whose back arrow returns. "All trips" opens the trips view with nothing selected.
- Sorting: within **100 km** of home is Local; else same state is State; same country is Country; otherwise World. No destination or no match → **Not sorted yet** (shown only when non-empty).
- A move is saved as `trip.scope` (synced with the trip); "Sort by distance" clears it. A row's + creates the trip with that row's scope.
- Destinations and home are looked up with OpenStreetMap Nominatim, one request a second, cached **on the device only** (`live-explore-places-v1`, cleared on account change). Nothing about sorting is written to Supabase, apart from a user's own move.
- With no home in the Profile, the page says so; trips without a move stay in Not sorted yet.

## 4. Verification

- `test/architecture-page-groups.test.js`: both menus' markup matches `PAGE_GROUPS`; every button is wired.
- `test/travel-explore-scope.test.js`: distances, sorting rules, user choice winning, grouping, Nominatim parsing.
- `scripts/qa-page-groups.mjs` (`npm run qa:page-groups`): 45 checks through the real app at 390px and 360px.
- Boot check, `qa-ticker`, `qa-settings`, full `npm test`, `vite build`.
- **Not verified:** live Nominatim answers (no internet in the build sandbox) and the iPhone app. See ISSUES.md.

## 5. Open / later

- Message holds only Mail for now; Luke plans to add more pages.
- Exercise's old swipe-to-edit handlers are unused now (ISSUES.md, P3).
