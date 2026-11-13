# Listen: one queue and player per person, libraries per view — design & as built

Status: **Built on branch `claude/listen-queue-per-person` (2026-11-13). Asked for by Luke, 2026-11-13.** Needs a TestFlight build for the phone and, for the laptop web app, the next batched Netlify deploy. No database migration (the new row is an ordinary `u-<uid>` row RLS already covers), no `STATE_SCHEMA_VERSION` bump.

## 1. The problem (confirmed in code)

Luke, 2026-11-13: podcasts started in Personal kept playing while he shopped in Household. They played to the end but stayed in the queue.

The queue isn't a stored list. It's worked out live from the view's `media` row: every unplayed episode of the saved shows inside the time window, sorted by tier, plus unread saved articles, unfinished books, and hand-added items (`getAutoPlaylist` / `getAllListenList`). "Played" was saved in `podcastProgress` in **the `media` row of the view on screen**. The episode finished in Household, so Household's row got the played mark and Personal's didn't, and the episode stayed in Personal's queue.

## 2. Decisions (Luke, 2026-11-13)

1. The mini-player and queue are **one per person, the same in every view**.
2. Saved shows and episodes stay **per view**.
3. Listen play positions are **per person**. Watch stays shared in Household.
4. The queue fills automatically from **Personal shows only** (for someone who has Personal; Marijane, who has only Household, from Household's shows). A Household episode joins Luke's queue only when he adds it by hand.

## 3. As built

| Thing | Where it lives now |
|---|---|
| Saved shows, saved articles, books, tiers, the window and sort settings | The view's `media` row (unchanged) |
| `podcastProgress`, `mediaProgress`, `readingProgress`, `mediaQueueAdded`, `mediaQueueRemoved`, `podcastAutoSkipped`, `mediaAllPinnedOrder`, `mediaHistory` | **The person's own `listen` row, `u-<uid>:listen`**, always in `state`, never swapped by a view switch |

- **`listen-queue.js`** (pure): the key list, the one-time merge, the PostgREST select for only those keys.
- **`app.js`**: a `listen` entry in `STATE_SECTIONS`; `SECTION_SCOPE.listen = "personal"`. Its delete list (removed queue entries) is the person's own (`tombstoneOwner`).
- **The queue's library** (`listenLibrary()`, views.js `listenHomeScope`): the person's primary view's `media` data. That's `state` when that view is on screen, otherwise its off-screen copy (the shadow, which the app already keeps and refreshes). A device that hasn't loaded that copy yet shows an empty queue rather than the other view's shows. `getAutoPlaylist`, `getAllListenList`, `queueAddedItems` and the bundle-series hold read from it; positions and queue edits come from `state`.
- **Episode lookup** (`findPodcastEpisode`) also searches the other view's off-screen copy, so a hand-added Household episode plays and stays listed in Personal.
- **One-time move** (`seedListenRowOnce`, at boot after the view's rows are aligned): once per person per device, it reads only the moved keys from both `media` rows (`state->key` selects, a few KB) and folds them in with what the device has. The more recent position wins, a finished mark sticks, and queue adds are joined Personal-first; removed entries stay removed. Repeating it changes nothing. The old rows are left as they are.
- **Data export**: `media_history_recent` now belongs to the `listen` section.

## 4. Egress

One small new row per person. The one-time move is one request per device, selecting only the moved keys. Nothing new runs on a view switch; the off-screen copy the queue reads was already kept.

## 5. Known gaps (ISSUES.md)

- An article read aloud while Household is on screen stays unread in Personal, because `readArticleIds` stays in the `media` row (the server reads it there).
- Personal's shows don't get new episodes while Household is on screen; they arrive on the next visit to Personal or the next boot/resume refresh.
- Until every device runs this build, an old build's positions and the new build's don't see each other.

## 6. Checks

- `test/media-listen-queue.test.js` (15): the section's keys match `listen-queue.js`, media no longer holds them, the section is fixed-personal, the home library per person, the merge rules, idempotence, the select.
- `test/media-queue-added.test.js` (+2): with Household on screen the queue is Personal's shows with the person's played marks; a hand-added Household episode stays in the queue in Personal.
- `npm run qa:listen-queue` (8, headless Chrome, local dev): the 2026-11-13 scenario end to end, including after a reload in both views.
- Full suite, `npm run check:boot`, `npm run qa:views` (118/118).
- **Not verified:** the iPhone app (native player end-of-episode with the screen locked while in another view); the one-time move against the real database (it needs a signed-in session).
