# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Themes: Thanksgiving; Seasonal covers November** · #211 · **TestFlight build** (client-only;
  the laptop needs a Netlify deploy). Settings › Display › Holiday gains Thanksgiving (brown,
  pumpkin, gold, olive, cranberry; light and dark). Seasonal now shows Thanksgiving all of
  November, and its line names what comes next. No migration, no new env vars.
  Post-deploy: pick Thanksgiving in Light and Dark — Calendar, Meal Plan, Shop, Finance, News
  read clearly and the dock is brown. Anyone on Seasonal sees Thanksgiving until Dec 1.
- **Watch: cross episodes off, services from the right, plainer seasons and Next** · #203 ·
  Posters show only the title (year/seasons stay in the panel); episodes are crossed off by
  tapping (no check boxes); services start at the right with "Other services" last; the
  season menu says only "Season N" (no bar, no "All"); NEXT shows "S1 E1" beside it and a
  plain ✓. Post-deploy: open a show on the phone and cross an episode off and back.
- **Watch: hide the NEXT box** · #204 · The show panel no longer shows the Next-episode
  line (code kept behind `WATCH_SHOW_NEXT_BOX`); a season that's loading keeps the
  episode list's height so the screen doesn't move. Post-deploy: open a show — no NEXT box.
- **Watch: services as links under the year line; light panel; one season box** · #205 ·
  Services / Other services are plain links in the theme's link colour, left-aligned with
  Other services first, right under the year line; the panel is the light surface and the
  season menu heads one box with its episodes. Post-deploy: open a show in light and dark.
- **Watch: per-tick merge; episode lists live on the device** · #206 · Each episode tick, tab change and edit carries its own time and merges on its own, so two people's ticks both stick (`watch-merge.js`); season episode lists stay in each device's storage, not the synced row (`watch-episodes.js`). Post-deploy: tick an episode on the phone and a different one of the same show on the laptop before either refreshes — both stay ticked.
- **Sync: a view switch no longer re-sends every section row** · #207 · Shared state-sync fix (WATCH_AUDIT D2). Post-deploy (and after the TestFlight build): in the Supabase edge logs, one change → one or two `tableplan_states` PATCHes, not ~15.
- **Watch: seasons panel polish; week-old shows refresh on view** · #208 · Whole season shows (no inner scroll), ~30px one-line rows, the next episode marked, not-yet-aired episodes dated and untappable, load errors with Try again; where-to-watch and season counts refresh when over 7 days old. Post-deploy: open a show — next episode highlighted; a show added months ago gets fresh services.
- **Watch: Archive actions open with a tap on the phone** · #209 · Tapping an archived show or its ⋯ opens Edit · Back to Watch list · Delete (was right-click only). Post-deploy: on the laptop, Watch › Archive › tap a show → the menu; Back to Watch list returns it.
- **Watch: a show opens where you are, not at Season 1** · #210 · Your place = the episode crossed off most recently: the panel opens on its season, next = the one after it (earlier unticked ones are skipped), the poster bar shows that season. Never-started talk / reality / news shows open on their latest aired season. **Needs the deploy** for that last part (`tmdb-watch-providers` returns showType / genreIds / lastAiredSeason). Post-deploy: open SNL — Season 51 (or its latest), not Season 1.
