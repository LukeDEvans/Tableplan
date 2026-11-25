# Sports scores — Design

**Status:** built 2026-10-07 (Luke: "largely operate like the Scores tab on the ESPN
app", favorites per user, and "robust, so if ESPN stops being an option it doesn't
require a total rebuild"). This is the scores build NEWS_PAGE_DESIGN.md §1 deferred.

**Back in News 2026-10-20 (Luke):** News → Sports opens on Scores again (Scores /
Stories tabs); `showScoresApp` and `#scores` open it there. From 2026-10-17 to 10-20
it was its own page, **Scores**, in the
Recreate menu group (`showScoresApp`, route `#scores`). News → Sports keeps only the
stories; a ticker game opens on the Scores page. Everything below about the view
itself still holds; read "News → Sports opens on Scores" as "the Scores page".

**Its own News section 2026-11-20 (Luke):** Scores is a section of News one swipe
right of the Front page (`{ kind: "scores" }` in `headerViews`); **Sports** holds
only the stories, in its place among the sections (after Culture). The view:

- **Tabs** under the header, in the Meal Plan's day-tab look: **★** (my teams' games
  on the chosen day — no idle rows), then each league shown, in the user's order. A
  tab shows only its games; a sideways swipe on the games moves one tab. The tab is
  remembered per device (`live-scores-tab-v1`). League sections no longer collapse.
- **Days:** a strip three days wide (yesterday · today · tomorrow by default) that
  scrolls three weeks either way (`dayRange`, stretched to a day picked further
  out); no ‹ › buttons. Beside it two squares in the ☰ button's style: the
  **league table** (the tab's league) and **★ My teams** — a window with every
  followed team: today's game (start time, or the score while it's on and once it's
  over), or the next and last game for a team that doesn't play today. A game
  there opens on today's board; a team opens its schedule; **Edit teams** opens the
  teams dialog.
- **Teams & leagues** moved to News's gear menu › **Scores** (the same dialog); the
  sliders button is gone.
- **An open game** shows league, round, venue, **Watch buttons for any game not yet
  over** (not only within the hour; channels the app can't open stay as text) and
  "Game page" (no arrow). No Follow buttons, no "<team> schedule" or "<league>
  table" links.
- **A team's name** on a scorecard opens its schedule. The **team page's card is
  pinned** at the top while the season scrolls, with a **star** at its top right
  (filled = following; tap to follow / unfollow). Its "Follow" and "<league>
  table" buttons are gone.
- **Back** is News's top-left button: ☰ (Saved) becomes a square **‹** while a
  table or team page (or a game opened from one) can go back, and ☰ returns when
  there's nowhere left (`canGoBack` / `goBack` / `onNavChange`). Scores has no
  ‹ Back of its own.
- **Xfinity:** if Xfinity Stream's own link doesn't open, the iPhone goes to its App
  Store page (`phoneWeb` in `link-out.js`) — `www.xfinity.com` links open the
  Xfinity account app instead, which is how a Wild game "opened the wrong Xfinity
  app". The web app still opens the website.

**Revised 2026-11-21 (Luke):**

- **Filter** (a ☰-style square left of the table button; off on ★): per league, per
  device (`live-scores-filter-v1`). Default **All games** — every league, college
  too, shows every game (the old "Top 25 and my teams" college default and its
  Leagues-dialog switch are gone; `collegeScope` stays in state, unused). Options
  come from the league's table (already fetched for the table view, CDN-cached):
  conferences (a division's `parent`, new in the standings parse) and divisions /
  conferences (leaf groups); college adds **Top 25**. A chip above the games shows
  an active filter, ✕ clears it.
- **Date:** ‹ the chosen day › (today by default), replacing the scrolling strip. A
  tap on the day opens the device's own calendar (an invisible `<input type="date">`
  over it; `showPicker()` on a laptop).
- **The tab row** scrolls sideways only (`overflow-y: hidden; touch-action: pan-x`).
- **Where to watch** in an open game: text links in a row ("Xfinity Stream · Fox
  One"), no "Watch" label. (The dock's game card keeps its buttons.)
- **Live details, from the scoreboard already fetched — no new requests, nothing
  in Supabase** (Luke: fewer features over strain on the free tiers). The adapter
  keeps each side's per-period `lines` and a small `live` object (`cleanLive`):
  football down/distance/spot/red zone/last play; baseball count, outs, runners,
  batter, pitcher; soccer goals and red cards (also on finished matches). The open
  game shows a **box score** (regulation columns always, OT/SO when played), a
  **football field** (away end zone left, ball on its spot, line of scrimmage and
  line to gain, arrow for direction), a **diamond** with the count, and a **goals**
  list. Only the scoreboard response grows (a few hundred bytes per live game); the
  refresh cadence is unchanged. Play-by-play, player box scores and win
  probability would need ESPN's per-game summary call — deliberately not built.

Where §2 below disagrees (My Teams section, collapsible leagues, Follow buttons,
schedule/table links, ‹ Back, the college default), these blocks win. QA: `npm run qa:news-scores`.

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
- **League tables** (2026-10-15): the table button in the bar, a league heading's
  **Table** link, or a game's "<league> table". Divisions for NFL, NHL and MLB,
  conferences for NBA and college, groups for the Nations League, one table for
  soccer leagues with the qualification/relegation colours and a key. A switch at
  the top changes league. Groups holding a favorite come first; favorites are
  highlighted. Wider screens get extra columns (PF/PA, GF/GA, home/away).
- **Team pages** (2026-10-15): every game of a team's season, by month, results
  (W/D/L and score) then fixtures with time and TV, scrolled to the next game.
  Soccer teams show **every competition** (league, cups, European, internationals).
  From a game's "<team> schedule", a favorite's row in My Teams, or any table row.
  Tapping a game opens its day in Scores; ‹ Back returns.
- **Teams & leagues dialog:** favorites (add from a league's team list or from any
  game; remove), which leagues show and in what order, the college choice.
- **Following** a soccer team follows it in every competition shown. **Each college
  sport is its own team** (Luke, 2026-11-20): the Gophers' football, basketball and
  hockey teams are followed separately, each shows its own games in My Teams, and
  each idle one gets its own next/last row (§3a).

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

### 3a. College teams per sport (2026-11-20)

Luke: "the app only shows me the next game either of these three teams play, not
all three." Until then a school was one favorite in a shared `college` scope, homed
in the league it was followed from, so My Teams asked only that league for its
next game, and a football game hid the hockey team's.

- Each college league is its own scope (`ncaaf`, `ncaam`, `ncaah`, `ncaaw`), so team
  keys are `ncaah:minnesota-golden-gophers` and `sameTeam` never crosses sports.
- **Migration, on read** (`expandLegacyFavorite` in `normalizeSportsPrefs`): a saved
  `college` favorite becomes football, basketball and hockey (`college-w` → women's
  basketball), in its place in the ranking. The sport it was followed from keeps its
  provider id; the others carry the name only, because a provider's id for a school
  isn't promised to match across sports. No schema bump; stable once saved.
- **Filling ids:** a name-only favorite takes the id of a matching team from a loaded
  day's games, or (when idle) from its league's team list, once per session
  (`fillFavoriteRefs`, `scores-ui.js lookUpMissingRefs`), then is saved. Until then it
  matches games by name.
- **Game-day colors:** a stored `college:…` key in `gamedayTeams` reads as all three
  sports (`theme.js cleanGamedayTeams`).
- **News ranking** still thinks in schools: `teamsForServer` (news-ui.js) sends a
  school followed in several sports once, as `college:…`, so `_news-rank.js` and the
  server's stored favorites are unchanged.
- Labels: `teamLabel` adds the sport where a school's name is ambiguous ("Minnesota
  Hockey") — favorites chips, toasts, Display's team list; idle rows put the sport on
  a second line; My Teams rows show the league (`NCAAH · BTN`).

## 4. Server (`netlify/functions/scores.mjs`)

Like `weather.js`: no user data, no database, origin-restricted, CDN-cacheable.

| Action | Returns | Cache |
|---|---|---|
| `scoreboard&date&leagues` | `{ games, leagues: { key: { ok, provider, live, count } } }` | 20 s live · 60 s near a start · 5 min · 6 h for settled days |
| `teams&league` | a league's teams | 24 h |
| `schedule&teams=league:provider:id,…` | last + next game per team (≤ 12) | 15 min |
| `standings&league` | `{ season, groups: [{ name, rows: [{ team, rank, note, stats }] }] }` | 10 min |
| `team&league&team=provider:id` | every game of the team's season | 5 min (30 s while live) |
| `health` | one small request to each provider: `{ id, ok, error, ms }` | never |

One upstream GET per league, in parallel, 6 s timeout, no retries. A league that
fails is reported in `leagues` and the rest still return; if every league fails the
answer is a 502 that is not cached.

### Providers (`_scores-providers.mjs`)

A provider implements `id`, `label`, `live`, `enabled(env)`, `supports(league)`,
`scoreboard(league, dateKey, ctx)` and optionally `teams`, `teamGames` and
`standings`. Table stats use the app's own keys (`gp w l t otl pts pct gb gf ga gd
streak seed ovr conf home away l10`); the columns each league shows are defined in
`sports-model.js` (`standingsColumns`), not by the provider. For each
league the chain asks the first enabled provider that supports it and falls to the
next on any error. Order: `SCORES_PROVIDERS` (default `espn,thesportsdb`).

- **`_scores-espn.mjs`** — ESPN's public site API. Unofficial and undocumented;
  the only file that knows its URLs and JSON. Covers the whole catalog.
- **`_scores-thesportsdb.mjs`** — standby. Off until `THESPORTSDB_KEY` is set (a
  paid key, $9/month at the time of writing; the free key returns three events a
  day). Schedules and final scores only: no live clock, team lists or team
  schedules. The view shows a note when a league is served without live clocks.

### If ESPN stops working

Open `/.netlify/functions/scores?action=health` first. It says whether each
provider answers from Netlify and, if not, why (`HTTP 403`, a timeout, …). Add
`&ua=browser`, `&ua=app` or `&ua=none` to try another User-Agent without a redeploy.
None is sent by default (ESPN refused a custom one); `SCORES_USER_AGENT` sets one.

1. Set `THESPORTSDB_KEY` in Netlify. Leagues ESPN refuses fail over on their own;
   to skip ESPN entirely set `SCORES_PROVIDERS=thesportsdb`. No code change.
2. For live clocks from another vendor, write one adapter file to the contract
   above, add it to `PROVIDERS`, and add its real response as a fixture row in
   `CONTRACT_CASES` (`test/scores-providers.test.js`). Nothing in the client, the
   model, or saved favorites changes.

## 5. Client

- **`scores-ui.js`** — `createScoresModule(deps)`. Talks only to the scores
  function. `news-ui.js` mounts it as its Scores section through an injected
  `scores` interface (`mount`, `unmount`, `refresh`, and `canGoBack` / `goBack` /
  `onNavChange` for News's top-left ‹ button). app.js wires `openSettings` to the
  gear menu's Scores item.
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
- ESPN's own idea of the current season lagged for the NHL table in October
  2026, so tables and team schedules name the season (`espnSeason` in the adapter).
  If a table ever shows last season, that rule is the place to look.
- Team schedules cover the regular season and playoffs, not preseason.
- A soccer game in a competition missing from the league catalog (club
  friendlies, say) is left out of a team's page.
- A "day" is the provider's day (U.S. Eastern for ESPN), shown in local time.
- The TheSportsDB league ids other than NFL are unverified (noted in the adapter).
- Not built: box scores, player stats, score notifications.

## 7. Verification (2026-10-07)

- `npm test` (model, both adapters against captured responses, provider contract,
  chain failover, the function), `npm run check:boot`.
- A headless-browser walkthrough of the real view against the real function with
  only the outbound provider fetch replaced by ESPN-shaped data (the build sandbox
  cannot reach ESPN): follow from a game and from team lists, reorder and switch
  leagues, college show-all, another day and back, Stories and back, at 360 px
  (light) and 1280 px (dark), with no sideways scroll and no console errors.
- **Live from Netlify (PR #78's deploy preview, 2026-10-07):** `action=health`
  showed ESPN returning 403 to the app's own User-Agent string and answering with
  a browser's or with none. The function now sends none by default.
  With that fix, on the preview: the default 17-league scoreboard returned every
  league ok (NHL and NBA finals with scores, records and TV; a college Saturday
  with 54 football and 15 hockey games, ranks included), `schedule` returned last
  and next games for the Vikings, Wild, Ajax and the Netherlands, and `teams`
  returned the college list. One 502 on the very first combined request was not
  reproduced (ISSUES.md).
- **Not verified:** the iPhone app. ESPN's endpoints and field shapes were read
  from live responses while building.

## 8. The dock ticker (2026-10-14)

Luke: a ticker above the weather and media dock, a third of the dock's height,
scrolling through major news stories and games for followed teams.

- **Where:** `#dockTicker`, the top row of `#bottomDock`; `--dock-ticker-h` is
  `--mini-player-h / 3` while it shows (`body.has-dock-ticker`), and `--dock-h`
  includes it, so every window that stops above the dock stops above the ticker.
  Hidden when there is nothing to show (or News is off for the user).
- **What, in order:** News's lead stories (`recentLeads` — the Front page's leads
  from the last ~36 h, at most 8), then each **followed team's** games: before noon
  (local) yesterday's and today's, from noon today's and tomorrow's. Today runs
  live, upcoming, finished.
- **How (Luke's answers):** one item at a time — the next rises from below; a line
  too long for the strip scrolls through once first. Swipe sideways to skip; hover
  or touch holds it. A tap opens the story in the reader (as on the Front page), or
  the game in News → Sports → Scores on its day, expanded.
- **Look (Luke, 2026-10-14):** light mode is white with text in the dock's own blue; dark mode keeps the dock's blue with white text. Each
  team's logo sits beside its abbreviation (the feed's dark-background logo in dark
  mode); a logo that fails to load is simply left out.
- **Data and cost:** `news-ticker.js` reads only through News (`tickerLeads`) and
  Scores (`getBoard`). Scores: the Scores view's own scoreboard request (same URL,
  so the CDN serves both), refreshed every 30 s while a followed game is on or
  about to start, otherwise every 10 min. News: the Front page News already has
  if under 15 min old, else a one-row Front page request (the server still adds the
  recent leads) — at most every 15 min. One timer, foreground only, re-checked at
  noon and midnight; nothing runs while the app is in the background.
- **Verify:** `test/news-ticker.test.js` (days around noon, which games, order,
  wording) and `npm run qa:ticker` (the real app at 360 px and 1280 px dark with
  seeded news and scores: placement and height, order, taps, no sideways scroll).

