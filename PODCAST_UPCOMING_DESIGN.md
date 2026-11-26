# Listen: upcoming podcast episodes from Apple, kept easy to remove — design & as built

Status: **Built 2026-11-19 (Luke: "Start building now").** Server side live in Supabase (table, daily job, Apple adapter). App side merged, reaching the iPhone by TestFlight and the web app on the next deploy. The early-access shape was confirmed on 2026-11-25 (§6).

## 1. What Luke wants

1. Apple Podcasts shows when some upcoming episodes will be released. For example, The Rest Is History's Club gets a series early, and Apple shows free listeners a "coming" date for each part. Luke wants those dates in Liv.
2. **Bring back the series hold.** Luke doesn't want to listen to a multi-part series until every part is out.

Decisions (Luke, 2026-11-19):
- Not a Club member and doesn't want to be; membership isn't needed (Apple shows the dates to free listeners).
- Turned down estimating dates from the release pattern.
- **Use Apple, but in the lightest way possible**, so switching away from Apple stays easy (his standing direction, 2026-11-16).
- **Upcoming episodes appear only in the show's episode panel** (and its full list), with their coming date. Not in the queue or on the landing page.
- **If the Apple lookup goes stale (>3 days), held series are released into the queue.**
- **No notifications.**
- **Every saved show is looked up**; no per-show switch.
- **The series hold applies to every show**; no per-show switch. Hand-added episodes are never held. "Release now" stays.

## 2. Why it has to be Apple

The free release date is set in Apple Podcasts Connect, not in the RSS feed. The public feed only gets an episode on the day it's released, and no open podcast standard carries an "expected on" date.

## 3. What keeps Apple's part small

1. **No Apple account or device involved.** The server reads Apple's public show page, so it keeps working on Android or another podcast app. It only depends on Apple listing the show.
2. **Keyed by the show's feed URL**, never an Apple ID. The Apple ID is cached server-side only (`podcast_upcoming_sources.source_ref`).
3. **One adapter:** `supabase/functions/podcast-upcoming/apple.js` is the only code that knows Apple's URLs or page format. `index.ts` lists sources in `SOURCES`.
4. **Neutral storage:** `podcast_upcoming` rows are `feed_url, title, expected_at, source, fetched_at, first_seen_at`.
5. **If it breaks, nothing else breaks.** Rows stop refreshing, go stale after 3 days, and the app stops holding.

## 4. As built

**Database** (`migrations/2026-11-19-podcast-upcoming.sql`, applied 2026-11-19 as `20261119160000 podcast_upcoming`):
- `podcast_upcoming` — signed-in users (MFA met) may read; nobody but the server writes.
- `podcast_upcoming_sources` — server only: each feed's Apple id, last check, last error.
- `podcast_upcoming_feeds()` — distinct saved shows (feed URL + title) across all `*:media` rows; service role only.
- Vault key `podcast_upcoming_key`, `podcast_upcoming_key_ok()`, `podcast_upcoming_fire()`, and pg_cron job `podcast-upcoming` at 09:23 UTC daily.

**Edge Function `podcast-upcoming`** (key-gated, JWT check off like finance-nightly): for each feed, find/confirm its Apple id (iTunes search, exact feed match; unlisted feeds re-checked weekly, listed ones re-confirmed monthly), read the show page's `serialized-server-data`, replace the feed's rows (keeping `first_seen_at`), 1.5 s between feeds. Status row `podcastupcoming_status` (times and counts). First runs, 2026-11-19: 17 feeds, all 17 found on Apple, 0 failed.

**App** (`podcast-upcoming.js` pure rules; app.js "Upcoming episodes + the multi-part series hold"):
- Rows are read for the saved feeds at most every 6 hours (Listen opening or the Shows tab), cached in `live-podcast-upcoming-v1` (account-scoped). One small request; no polling.
- **Series key** = the title before the first colon once the part clause is removed, so `The Charge of the Light Brigade: Outbreak… (Part 1)` and `…: The Tsar's Terrible Siege (Part 2)` are one series. (The old hold used the whole title, so each part was its own "series" and nothing was ever grouped. That, plus the per-show switch and the 7-day guess, is why it never worked.)
- **Hold:** a released part stays out of the automatic queue while a fresh upcoming row names a later part of the same series. Hand-added episodes bypass it; "Release now" (`podcastReleasedSeries`) lets a series in.
- **Panel:** a held card ("2 of 4 parts out · held from your queue", Release now) and "Coming …" rows labelled "Part 3 · Crushing the Russians" with "Coming Sat, Nov 21" (or "Coming soon" when undated). The full title shows on hover.
- Rows drop when the episode arrives in the feed (title match ignoring quotes/case), 3 days after their date, or (if undated) 21 days after first seen.
- The old per-show "Bundle multi-part series" switch is gone; `podcastBundleSeries` stays in the media section so old rows load.

## 5. Checks

- `test/media-podcast-upcoming.test.js` (23): series key on the real Light Brigade titles, freshness, matching, the hold, Release now, the Apple adapter on page-shaped data (future date counts; bonus, trailer, other shows and already-out subscriber-only episodes don't), exact feed matching.
- `node scripts/qa-podcast-upcoming.mjs` (14, headless Chrome at 390 px against `npm run dev:local`, delete `data/tableplan-state.json` first): queue holds parts 1–2, panel rows and card, Release now, All episodes, stale rows hold nothing, no sideways scroll, no page errors.
- Full suite, `vite build`, `npm run boot:check`.
- **Not verified:** the iPhone app.
- `test/media-podcast-upcoming.test.js` also replays the real 2026-11-25 Captain Cook data (numbered feed titles, one-part-ahead listing, the hold across the gap).

## 6. The early-access shape (confirmed 2026-11-25)

The 2026-11-25 run found the first real early-access episode, a day before it went free:

| Field | Value |
|---|---|
| title | `The Death of Captain Cook: Massacre on the Beach (Part 2)` |
| episodeType | `full` |
| entitlementState | `unentitled` |
| hasFreeVersion | `false` |
| **releaseDate** | `2026-11-26T00:00:00Z`, which **is the free date** (the feed had it at 00:05Z) |
| caption | `Nov 26` |

So the rule "a future date on a show's own episode = upcoming, dated by it" is right, and `releaseDate` is the free date. Already-out subscriber-only episodes (NYT shows: past `releaseDate`, `hasFreeVersion: false`) are still correctly ignored.

What the sighting changed (2026-11-25):
- **Feed titles carry an episode number Apple's don't** (`725. The Death of Captain Cook: …`). Titles are compared, and series named, with a leading `725. ` / `#725` / `Ep 725:` removed (`stripEpisodeNumber`); a year with a colon (`1066: …`) stays.
- **Apple lists only the next part**, not the whole series. When that part lands in the feed, the list has nothing left for the series until the next daily check. A row whose episode arrived after the row was fetched therefore still holds its series. The next check either lists the following part (still held) or lists nothing (the series is released). The card then reads "2 parts out · checking for more before it joins your queue".
- Consequence: a finished series joins the queue up to a day after its last part, at the morning check (09:23 UTC).
- **Seen 2026-11-26:** after Part 2 went free, the 09:23 UTC check listed nothing upcoming for The Rest Is History (no Part 3 yet), so Captain Cook Parts 1–2 were released to the queue as designed. Apple announces only about one part a day ahead, so for this show the hold keeps a series together only while the next part is already listed; it can't hold a whole series to the end.

## 7. Removing Apple later

Delete `apple.js` and its `SOURCES` entry (or unschedule the job). `podcast_upcoming` empties through staleness; the panel shows nothing and the hold stops. To remove the feature: `select cron.unschedule('podcast-upcoming')`, drop the two tables and the three functions.
