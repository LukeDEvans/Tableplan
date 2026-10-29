# Watch page audit — look, experience, reliability

## Decisions (Luke, 2026-10-29) — the build list

**Shipping:** build on a branch and ship to the iPhone by **TestFlight**; the web (laptop, Marijane) gets it in **one big Netlify deploy later** (deploys are scarce this month). No deploy for this alone.

**Two lists:** a shared **Household** Watch list (Luke + Marijane) and Luke's own **Personal** list — the existing per-view rows. The 4 leaked shows stay in Personal; Household starts empty via the #189 row reset, which waits for the big deploy (web tabs must have the marker code first). **Until then: add nothing to Household; Personal is safe to use.** Shared tombstones (ISSUES P1): leave as is after the reset; add a check that fails if the two rows ever share an id again. Luke will set his streaming services himself.

| # | Decision |
|---|---|
| 1 · Phone actions (R1) | **B:** Watched · Tabs · Remove buttons in the tapped poster's panel (right-click stays on the laptop). Panel opens **under the whole row** (row stays put; later posters backfill via `grid-auto-flow: dense`), with a **pointer** on the panel's top edge that **slides** between posters in the same row (like the category-tab underline) and the **ring** on the open poster. Tap again closes; scroll the panel into view. No dimming of other posters. |
| 2 · Episode tracker (L1, R7) | **B:** fix the layout (small checks, number + full title, "Season 3 · 5/8" + thin bar) **plus a "Next: S3 E6 · title [✓ Watched]" line** at the top of the panel (▶ to the episode when the stream link exists). Season open/closed state stays per device, not synced. |
| 3 · Remove (R4) | **A:** delayed remove — vanishes at once, ~6 s "Removed *X* · Undo" toast (Mail's toast); nothing saved/synced until it expires. |
| 4 · Link a plain title (R5) | **A:** "Find on TMDB" opens the + search window in link mode, prefilled; tap the right result (progress kept). **+ window dedupe (R8):** titles already on the list show "In your list"; tapping opens that show's panel. |
| 5 · Concurrent edits (R3) | **Per-tick merge:** each episode tick and tab change carries its own time; two people ticking different episodes both stick. Shared merge infra — tests first. |
| 6 · Sync size (R7) | **Cache extras + trim:** episode lists and showtimes in a device cache (refetched as needed); where-to-watch trimmed to service name + id. |
| 7 · Freshness (R6) | **Refresh on view:** shows on screen older than 7 days refresh a few at a time via the Netlify function; clears stale "In theaters". |
| 8 · Posters (L2) | Keep four a row, **two-line titles**, plus a **grid/list toggle** (per device; list rows: poster, title, service, progress). |
| 9 · Tab bar (L4) | Add-title "+" moves into the search row as **"Add"**; **Upcoming / In Theaters show only when non-empty**. |
| 10 · Archive (L6) | **Keep the window**, fix poster placeholders, add **Watch again · Edit rating/notes · Remove** (reachable on the phone). |
| 11 · Housekeeping | Yes, all: remove dead planner code (leave the `watchPlans` key), keep theater `placeId` (R10), tombstone a pristine un-save from search (R8), theme tokens for the ~40 hard-coded colours (L5), close the Movies/TV gap (L7). |
| 12 · Continue watching (U2) | **Row at the top**, only when something's in progress ("Next: S3 E6 · HBO Max ▶"); tap opens the panel. |
| 13 · Finding (U3) | **Sort** (recently added default, A–Z, year) and **Filter** (on my services; movies / TV). Search stays as is — no "in your list first". |
| 14 · Finishing (U4) | Ticking the last episode **offers "Finished — move to Archive?"** with rating, or "Not yet" for shows still airing. |

**Not doing:** no Paste-a-list import — Luke will add his Notes titles one by one with search. No automatic TMDB matching.

---

Status: **First build (2026-10-29): decisions 1–4 built** (panel, tracker + Next, Remove with Undo, link mode + "In your list"). The rest are agreed and not built. Decisions above supersede the suggestions below. Read from code on `main` @ `c262471`, the live database (read-only), and the page at 390 px in headless Chromium with mocked TMDB (`npm run qa:watch-search` 18/18 still passes). Asked for by Luke before moving his watch list from the Notes app into Watch.

---

## 0. Before you move the Notes list (do these first)

1. **The Household/Personal leak is still in the data.** Today both `<household>:watch` and Luke's `u-…:watch` hold the same 4 shows with the same ids (House of the Dragon, The Wire, Midnight Mass, Breaking Bad). The scope-leak fix is deployed (a888d2a), so no new copies are being made, but the cleanup — the one-time row reset (#189) — is **merged, not deployed**, and the reset rows haven't been written.
2. **Import only after the reset.** The reset empties Household Watch ("start empty", 2026-10-28). Anything imported into Household before the reset rows are written is wiped with it.
3. **Don't delete the 4 duplicates by hand.** Deletions go into one shared tombstone list (ISSUES P1), so removing The Wire in Household also removes it in Personal, and the reverse. The reset is the safe way out.
4. **Decide where the list lives.** Decision 16 says Watch is fully shared in Household; Personal also has its own Watch. If you and Marijane watch from one list, import into **Household**; if it's yours alone, **Personal**. Two lists that you both edit will drift.
5. **Mark your services** (Watch › gear › Streaming Services). The saved list is empty today, so every show says "Other services" and nothing is sorted toward what you pay for.

---

## 1. Reliability

| # | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| R1 | **P1** | **On the iPhone there's no way to mark something watched, delete it, file it in a tab, or reload it.** Those actions live only in a `contextmenu` menu (`openWatchItemMenu`). iOS doesn't fire `contextmenu` on a long-press, and a long-press on a poster starts a drag instead. Exercise hit the same thing and got its own long-press (`wireWorkoutCardLongPress`); Watch didn't. Same for the Archive (can't edit or un-archive on the phone). | Headless touch long-press: no menu (0/0). Code: no long-press path for `[data-watch-item]`. Confirm on the phone. | Put the actions in the tapped card's detail (see L3), and add a long-press menu like Exercise's. |
| R2 | **P1** | Shared tombstones (already in ISSUES): a delete in one view removes the same id in the other. | ISSUES P1, `recordDeletion` → `config.tombstones` (household row). | Your call (a) per-row tombstones or (b) new ids for the Personal originals. After the reset there are no shared ids, so it stops mattering unless a leak recurs. |
| R3 | P2 | **An edit can be overwritten by another device's older copy of the same show.** Watch items merge whole-item, and "newer" is the whole app's last-change time, not the show's. If the phone ticks S3 E6 and the laptop (still holding the old copy) edits any other show before it refreshes, the laptop's save-conflict merge keeps its stale House of the Dragon and the tick is lost. More likely once you and Marijane both use a shared list. | `unionById` (state-sync.js) keeps one side's object; `mergeRemoteSectionRow` / save-conflict pick a side by `stateUpdatedAt`. No `updatedAt` on watch items. | Stamp each item (`updatedAt`) on every change and keep the newer item; union episode ticks rather than replacing them. Shared merge infra — flagged, needs care. |
| R4 | P2 | **Delete has no undo**, and is one tap in a menu. | `deleteWatchItem` | Undo toast (5 s), like other pages. |
| R5 | P2 | **"Find on TMDB" does nothing.** It looks for a results box (`[data-watch-search-results]`) that no longer exists on the page. Any title without a TMDB link can't be linked — this matters for a Notes import. | Button present, tap → nothing (headless). | Reuse the "+" search window to link. |
| R6 | P3 | **Where-to-watch goes stale.** Providers are fetched once when a title is added and never again: House of the Dragon's are from July. "In theaters" / "Upcoming" are set once too, so a movie stays "In theaters" forever. | `providersUpdatedAt` on live rows; `loadWatchProviders` only called on add or Reload. | Refresh on view when older than ~7 days, on the device, a few at a time. |
| R7 | P3 | **The synced row carries device-only and bulky data.** A season's open/closed state (`__expanded`) is saved and synced (Marijane would see your seasons open; every tap is a save); showtimes cache and episode lists are synced too. Fine at 4 shows (7 KB), but a 100-title import with overviews, providers and episode lists is ~100–150 KB, re-sent on every tick. | Live row; `toggleWatchSeasonExpand`, `fetchShowtimes`, `loadWatchSeasonEpisodes`. | Keep open/closed in memory; keep episode lists and showtimes in a device cache; trim providers to name + id. |
| R8 | P3 | The "+" window adds duplicates (the page search checks; the window doesn't). Un-saving a pristine video from Discover leaves no tombstone, so another device can bring it back. | `fetchWatchSearchResultsDialog` → `addWatchItemFromTmdb`; `toggleWatchlistSave`. | One `addToWatchList()` that dedupes by TMDB id; record the deletion. |
| R9 | P3 | Leftovers from the old weekly planner: scheduling, day drag-and-drop, `watchPlans` (which can't remove a scheduled show — merges bring it back), plus unused `addWatchItem` and the inline search. | No callers render the planner. | Delete the code; leave the `watchPlans` key in place. |
| R10 | P3 | Saved theaters lose their Google place id on reload, so "already saved" stops working. | `normalizeWatchSettings` keeps only id/name/url. | Keep `placeId`. |

---

## 2. Look

- **L1. The episode tracker is broken on a phone.** The season and episode checkboxes take ~160 px (a site-wide input width rule), so "Season 1" wraps and episode names get ~46 px and disappear. Fix: `width:auto` on these checkboxes (or use the house `live-toggle`/check style). Screenshot in the audit run.
- **L2. Posters are small for a big list.** At four a row each card is 75 px; titles are 11.5 px and cut ("Oppenheime", "A Movie Added Fro…"). Four a row is your decision (2026-10-22), so options: allow two-line titles; or add a **list view** toggle (poster, title, service, progress) that's better for scanning 100 titles.
- **L3. The detail is a strip of controls, not a page for the show.** Tapping a poster opens a full-width panel with service buttons and seasons, but no title (it scrolls away above), no synopsis, and no actions. Suggest a sheet: poster + title + year/runtime, the overview (already stored), **Play** (next episode for TV), progress, and a row of actions: **Watched · Tabs · Remove**.
- **L4. Tab bar:** two "+" buttons side by side (one adds a tab, one adds a title) read the same. Upcoming and In Theaters always show, even empty. Suggest: the add-title "+" moves into the search row (or becomes "Add"), and the two fixed tabs show only when they have something.
- **L5. Colors:** ~40 hard-coded colors in the Watch styles (`#fff` inside `color-mix`), so themes and dark mode don't carry through. Swap for tokens.
- **L6. Archive:** full-screen, poster placeholder is a blank box, no actions on the phone, no "watch again".
- **L7.** A large gap under the Movies row before TV Shows.

---

## 3. Experience

- **U1. Paste a list (the Notes move).** There's no way to add more than one title at a time. Proposal:
  - Watch › Add › **Paste a list**: one title per line; strips bullets, dashes and checklist marks; a trailing "(2019)" or "(TV)" helps matching.
  - Each line is matched through the existing `tmdb-search` function (a few at a time), shown as a review list: best match with poster, a "not this" picker, or **keep as plain title** (linkable later — needs R5).
  - Already on the list (same TMDB id) is skipped; lines ticked off in Notes go straight to the Archive.
  - Where-to-watch loads lazily as cards are seen, not 100 calls at once. Nothing new on Supabase beyond one save.
  - Simpler, no build: copy the note, paste into the page search one title at a time (works today, slow for a long list).
- **U2. Continue watching.** A row at the top for shows with progress: "Next: S3 E6 · HBO Max ▶". The hand-off already knows the next unwatched episode (STREAMING_HANDOFF step 2, once the API key is in).
- **U3. Finding things in a long list.** Sort (recently added, A–Z), filter (on my services, movies/TV); and the search box should show **"In your list"** matches above TMDB results.
- **U4. Finishing.** Ticking the last episode should offer "Finished — move to Archive?"; today a fully watched show stays on the list until you use the (unreachable on the phone) menu.

---

## 4. Suggested order

1. **Data first:** TestFlight + reload web tabs → write the reset rows (UNDEPLOYED) → check next day → pick Household or Personal → set your services.
2. **Phone fixes (TestFlight only):** R1 actions sheet + long-press, L1 episode layout, R5 Find on TMDB, R4 undo, R8 dedupe.
3. **U1 Paste a list** → then move the Notes list.
4. **Reliability:** R3 per-item stamps (shared merge code — careful), R7 slimmer sync, R6 refresh.
5. **Polish:** L2–L7, U2–U4, R9 cleanup.

## 5. Questions for Luke

1. Household or Personal for the list (or both, kept separate)?
2. Keep four posters a row, or add a list view?
3. Tombstones: (a) per row or (b) re-id when needed — or leave it now that the reset removes the shared ids?
