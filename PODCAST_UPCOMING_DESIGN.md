# Listen: upcoming podcast episodes from Apple, kept easy to remove — design & as built

Status: **Built 2026-11-19 (Luke: "Start building now").** Server side live in Supabase (table, daily job, Apple adapter). App side merged, reaching the iPhone by TestFlight and the web app on the next deploy. **One piece is waiting on real data:** how Apple marks an early-access episode and its free date (§6). Until a series is in early access, Apple lists nothing upcoming, so the feature shows and holds nothing.

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
- **Not verified:** the iPhone app; a real early-access episode (§6).

## 6. Waiting on real data

The spike (2026-11-19) confirmed the page is readable server-side and carries `LegacyEpisodeLockup` items with `title`, `releaseDate`, `episodeType` (`full`/`bonus`/`trailer`), `entitlementState`, `hasFreeVersion`. It could not show an early-access episode: The Charge of the Light Brigade Part 4 went free that day and the next series wasn't listed yet.

**Current rule:** an episode is upcoming only if a date-like field on it is in the future. A first, looser rule (any full episode with no free version) produced 13 false rows from a show whose subscriber-only episodes are already out and never go free, so it was dropped. Those lockups, and any future-dated ones, are logged by the job as `[podcast-upcoming] candidates`. When the next Rest Is History series appears, read that log entry and tighten `upcomingFromPage` to the real shape (and its free-date field). A re-check is scheduled every few days.

## 7. Removing Apple later

Delete `apple.js` and its `SOURCES` entry (or unschedule the job). `podcast_upcoming` empties through staleness; the panel shows nothing and the hold stops. To remove the feature: `select cron.unschedule('podcast-upcoming')`, drop the two tables and the three functions.
