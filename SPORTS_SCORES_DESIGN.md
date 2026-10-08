# Sports scores — Design

**Status:** built 2026-10-07 (Luke: "largely operate like the Scores tab on the ESPN
app", favorites per user, and "robust, so if ESPN stops being an option it doesn't
require a total rebuild"). This is the scores build NEWS_PAGE_DESIGN.md §1 deferred.

## 1. Intent

News → Sports opens on **Scores**: a day's games across the leagues Luke follows
(NFL, NBA, NHL, MLS, Eredivisie, college football / basketball / hockey,
international soccer), with each person's favorite teams pinned first. **Stories**
(the section's articles) is the second tab.

## 2. What it does

- **Day strip:** three days either side of the chosen day; "Back to today".
- **My Teams:** every game that day with a favorite in it. Today only, a favorite
  with no game shows its next and last game.
- **League sections** in the user's order, collapsible (remembered per device).
  Within a league: live, then upcoming, then finished.
- **College:** Top 25 and favorites by default, "Show all N games" per league for
  now, or "Every game" as the standing choice in Leagues.
- **A game** expands to league, round/group, venue, TV, Follow buttons for both
  teams, and a link to the provider's game page.
- **Teams & leagues dialog:** favorites (add from a league's team list or from any
  game; remove), which leagues show and in what order, the college choice.
- **Following** a soccer team follows it in every competition shown; following a
  college follows it in football, basketball and hockey (§3, `scope`).

## 3. The app's own model (`sports-model.js`)

The seam that keeps the feature independent of a vendor. Shared by the browser and
the function; pure; tested (`test/sports-model.test.js`).

- **League catalog** `LEAGUES` — our keys (`nfl`, `eredivisie`, `nations-league`, …),
  with `sport`, `scope`, `group`, and a default on/off.
- **Team** `{ key, scope, name, short, abbr, logo, logoDark, color, refs }`.
  Identity is `scope` + name. `refs` holds each provider's id (`{ espn: "16" }`).
  `sameTeam` uses the id when both sides carry one from the same provider, and the
  name otherwise — so a saved favorite still matches after the provider changes.
- **Game** `{ id, league, sport, start, state, detail, note, venue, broadcasts,
  situation, possession, neutral, link, home, away }`; `state` is one of
  `pre | live | final | postponed | canceled | delayed`. `cleanGame` validates and
  trims (https-only links and images); the function and the client both run it.
- **View logic:** `arrangeScores`, `nextRefreshMs`, `scoreboardCacheSeconds`,
  date and status formatting.

## 4. Server (`netlify/functions/scores.mjs`)

Like `weather.js`: no user data, no database, origin-restricted, CDN-cacheable.

| Action | Returns | Cache |
|---|---|---|
| `scoreboard&date&leagues` | `{ games, leagues: { key: { ok, provider, live, count } } }` | 20 s live · 60 s near a start · 5 min · 6 h for settled days |
| `teams&league` | a league's teams | 24 h |
| `schedule&teams=league:provider:id,…` | last + next game per team (≤ 12) | 15 min |

One upstream GET per league, in parallel, 6 s timeout, no retries. A league that
fails is reported in `leagues` and the rest still return; if every league fails the
answer is a 502 that is not cached.

### Providers (`_scores-providers.mjs`)

A provider implements `id`, `label`, `live`, `enabled(env)`, `supports(league)`,
`scoreboard(league, dateKey, ctx)` and optionally `teams` and `teamGames`. For each
league the chain asks the first enabled provider that supports it and falls to the
next on any error. Order: `SCORES_PROVIDERS` (default `espn,thesportsdb`).

- **`_scores-espn.mjs`** — ESPN's public site API. Unofficial and undocumented;
  the only file that knows its URLs and JSON. Covers the whole catalog.
- **`_scores-thesportsdb.mjs`** — standby. Off until `THESPORTSDB_KEY` is set (a
  paid key, $9/month at the time of writing; the free key returns three events a
  day). Schedules and final scores only: no live clock, team lists or team
  schedules. The view shows a note when a league is served without live clocks.

### If ESPN stops working

1. Set `THESPORTSDB_KEY` in Netlify. Leagues ESPN refuses fail over on their own;
   to skip ESPN entirely set `SCORES_PROVIDERS=thesportsdb`. No code change.
2. For live clocks from another vendor, write one adapter file to the contract
   above, add it to `PROVIDERS`, and add its real response as a fixture row in
   `CONTRACT_CASES` (`test/scores-providers.test.js`). Nothing in the client, the
   model, or saved favorites changes.

## 5. Client

- **`scores-ui.js`** — `createScoresModule(deps)`. Talks only to the scores
  function. `news-ui.js` mounts it in the Sports section through an injected
  `scores` interface (`mount`, `unmount`, `refresh`).
- **Favorites are per user:** `state.sportsPrefs = { teams, leagues, leagueOrder,
  collegeScope }` in the **`recreate`** section, which is always personal
  (`u-<user>:recreate`). Tracked in `settings-sync.js` as `"fields"`, so each of the
  four merges by its own stamp. No migration, no `STATE_SCHEMA_VERSION` bump.
  `leagues` records only the leagues a user switched, so a league added to the
  catalog later appears by its default.
- **Refreshing:** on open if stale, on Refresh, and on a timer only for today, only
  while the view is on screen: every 30 s while a game is live, or at the next start
  when one is within 30 min. It reads the cached function, never Supabase, backs
  off on failures, and stops when the page is hidden or left.

## 6. Known limits

- ESPN's feed has no contract; see §4.
- Two devices editing the favorites list at the same moment: the later edit wins
  the whole list.
- A soccer favorite's next/last game comes from the league it was followed in.
- A "day" is the provider's day (U.S. Eastern for ESPN), shown in local time.
- The TheSportsDB league ids other than NFL are unverified (noted in the adapter).
- Not built: standings, box scores, score notifications.

## 7. Verification (2026-10-07)

- `npm test` (model, both adapters against captured responses, provider contract,
  chain failover, the function), `npm run check:boot`.
- A headless-browser walkthrough of the real view against the real function with
  only the outbound provider fetch replaced by ESPN-shaped data (the build sandbox
  cannot reach ESPN): follow from a game and from team lists, reorder and switch
  leagues, college show-all, another day and back, Stories and back, at 360 px
  (light) and 1280 px (dark), with no sideways scroll and no console errors.
- **Not verified here:** a live call from Netlify to ESPN, and the iPhone app.
  ESPN's endpoints and field shapes were read from live responses while building.
