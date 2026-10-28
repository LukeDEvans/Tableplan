# News ranking ("For you") — design & plan

Status: **APPROVED (Luke, 2026-10-27). Step 1 built on branch `claude/news-for-you` (§9); not merged or deployed; its migration is not applied.** Follows NEWS_PAGE_DESIGN.md §10, which named a personalized feed as the next step. Read from code on `main` @ `a0c5547` and the live database (read-only counts, 2026-10-27).

Goal: News learns which stories Luke reads and shows those first, in a **For you** view, without hiding the papers' own front pages and without new Supabase egress trouble.

---

## 1. What exists today (findings)

**Intake** (observed in code):
- The hourly `news-feeds` job (`_news-feeds.js`) pulls every section feed of NYT, The Economist, the Star Tribune and The Athletic, plus the email intake (`_news-links.js`).
- Each story is a row in `news_articles`, **one row per user** (PK `user_id, id`), with `title`, `subtitle`, `paper`, `section`, `published_at`, `lead_at`, `read_at`, `sent_at`, `hidden_at`. Service-role only; `gmail.js` reads it for the client.
- Views are ordered by `published_at desc` (`feedQuery`). The Front page leaves out The Athletic. There is no ranking of any kind.

**Signals already recorded** (observed in code):
- `read_at`: set when a story is opened or listened to (`news-ui.js` `markRead` → `updateNews { decision: "read" }`).
- `sent_at`: Save. `hidden_at`: Hide.
- These go through one batched `updateNews` call, so new feedback can ride the same path.

**Live numbers** (read-only queries, 2026-10-27):

| | |
|---|---|
| Users with News rows | 1 (Luke) |
| New stories a day | ~330 (384 in the last 24 h) |
| By paper, last 3 days | Athletic 483 · NYT 349 · Star Tribune 112 · Economist 39 |
| Average title / subtitle | 70 / 119 characters |
| Opened in the last 3 days | 2 · Saved 0 · Hidden 0 |

**What that means:**
- **Implicit signal is thin.** Two opens in three days can't train anything. Explicit feedback (§3.1) and seeding from what the app already knows (§3.2) have to carry the first weeks.
- **The Athletic is half the volume**, and most of it is about teams Luke doesn't follow. Matching his Scores favorites alone would remove much of the noise, with no AI.
- Stories have only a headline and a one-sentence subtitle, so keyword matching works on ~190 characters per story. That's the case for the optional AI tagging (§4).

---

## 2. Approach

**Content-based, per person.** Each story is described by a few features; each person has a weight per feature; a story's score is the sum of its features' weights, plus freshness. With two users, "people who read this also read…" isn't possible, and it isn't needed.

Rules carried over from the rest of the app:
- No notification-style polling; nothing new on a timer except what the hourly job already does.
- No `tableplan_states` reads in the feed job; no `STATE_SCHEMA_VERSION` bump.
- Interests are **per person**. Marijane's reading never shapes Luke's (she doesn't use News today).
- The papers' own order stays available: **For you** is a new view, not a replacement for Front page or the sections.

---

## 3. Design

### 3.1 Feedback

| Action | Weight change for the story's features |
|---|---|
| Open (reader) | +1 |
| Listen | +2 |
| Save | +3 |
| **More like this** (new, ⋯ menu) | +3 |
| **Less like this** (new, ⋯ menu) | −3 |
| Hide | −1 (it may just be "already seen") |
| **Mute topic / Mute source** (new) | the feature is blocked: stories carrying it never appear in For you |
| Shown on For you, scrolled past, never opened, 3+ times | −0.25 (capped, so skipped stories can't sink a topic alone) |

- New decisions (`more`, `less`, `mute`, `skip`) go through the existing batched `updateNews`. The server applies them to the weights (§3.4). No new client → Supabase path.
- Every weight decays toward 0 with a **~3-week half-life**, so interests can change.
- "More / Less like this" shows a one-line toast naming what it learned ("More Minnesota politics").

### 3.2 Features of a story (no AI)

Computed when a row is inserted, by the hourly job and the mail sweep:
- `paper`, `section` (already on the row);
- **keywords**: lower-cased title + subtitle words and two-word phrases, minus a stop-word list, keeping proper-noun runs ("Federal Reserve", "Minnesota Vikings");
- **teams**: matched against `sports-model.js`'s team catalog (names, nicknames, cities), so Athletic and sports stories get a `team:<id>` feature.

Stored on the row as `topics text[]` (≤ 24 entries), the only new column.

**Seeding (day one, before any reading):**
- Scores favorites (`state.sportsPrefs`) → `team:<id>` +4 each, other teams in the same leagues 0, everything else in The Athletic −1. The client sends the team list to the server when favorites change (it isn't read from `tableplan_states`).
- An optional one-time **"What do you like?"** sheet the first time For you opens: sections and a handful of topics to tap. Each tap is +3.

### 3.3 Scoring

```
score = Σ weight(feature)                       // capped per feature group, so 6 keywords can't drown the section
      + paper/section prior                     // small, from the seed
      + freshness                               // 0 to +2, falling over 36 h
      + lead bonus                              // +1 if it led a paper's main newsletter
```

Then, building the For you list (top 40):
- **Diversity:** no more than 2 in a row from one section, 3 in the top 10 from one team or topic.
- **Exploration:** 1 slot in 8 goes to a fresh, well-placed story outside the person's top features, chosen at random. Its result (opened or not) teaches the weights like any other.
- **Why:** each card can show one line ("Because you read Minnesota politics", "Vikings").

### 3.4 Where it runs (egress)

- **Weights:** new table `news_interest (user_id pk, weights jsonb, muted jsonb, teams jsonb, updated_at)`, service-role only like `news_articles`. A few KB per person.
- **Hourly job:** for each user it already inserts for, one small read of `news_interest`, then it scores the new rows and stores `rank_score` on them. That's one extra tiny read per user per hour, and no extra writes (the score goes in the same insert).
- **`updateNews`:** applies feedback to `weights` with one small PATCH (`return=minimal`), and re-scores only the affected rows if a mute removes them.
- **For you view:** `newsFeed { view: "foryou" }` reads one page ordered by `rank_score desc` (same columns, same `limit`), plus an index on `(user_id, rank_score desc) where hidden_at is null and read_at is null`. Diversity and exploration are applied to that page in `gmail.js`. Same size as opening any section today.
- **Stale scores:** a story scored before today's feedback keeps its old score until the next hourly run re-scores the live window (~1,000 rows, server-side, no egress to a client). The open page is re-ordered locally with the weights returned alongside it, so a "Less like this" takes effect at once.

Estimated new egress: **under 5 MB a month.**

### 3.5 Controls

- News sidebar: **For you** above Front page.
- ⋯ menu: More like this · Less like this · Mute "<topic>" · Mute <paper> section.
- Sync Settings (News): **What News has learned** (top interests, muted items, each removable) and **Reset**.

---

## 4. Optional: AI topic tagging

Replaces §3.2's keyword `topics` with cleaner ones: 2–5 subject tags from a fixed list (~60, e.g. `us-politics`, `minnesota`, `ai`, `nfl`, `markets`), plus up to 3 named entities.

- **Where:** the hourly job, after it has the new stories and before it inserts them. Each story is tagged once by its id; with more users, the same tags would be copied to every user's row (no per-user cost).
- **Model:** Claude Haiku 5.5, one request per hourly run with every new story (~15), title + subtitle only.
- **Fallback:** if the call fails or is switched off, the keyword features are used. Kill switch: env `NEWS_AI_TAGS_DISABLED=1`.
- Pairs with §3.2, not instead of it: teams still come from the sports catalog.

### 4.1 Cost (from the live numbers above)

Haiku 5.5: $0.10 per million input tokens and $0.50 per million output tokens (prompts under 100k tokens).

| | Per day |
|---|---|
| Stories | ~350 |
| Input: ~55 tokens per story + ~400 tokens of instructions × 24 runs | ~29k tokens → $0.003 |
| Output: ~35 tokens per story (tag ids + entities, compact JSON) | ~12k tokens → $0.006 |
| **Total** | **~$0.009 a day ≈ $0.28 a month** |

- With The Athletic cut to favorite teams (§3.6), volume falls to ~190 stories a day: **~$0.15 a month**.
- **Revised for Haiku 5.5 (2026-10-28, from its migration guide):** its tokenizer counts the same text as ~30% more tokens, and adaptive thinking is on by default (the request asks for `effort: "low"`, which keeps it short; thinking tokens bill as output). At ~190 stories a day that's ~26k input + up to ~17k output tokens: **about $0.35 a month, $0.50 at most.** The status row (`newsfeeds_status.tagging`) records each run's real input and output tokens, so the true figure is readable after a week.
- If volume doubles (another paper, more feeds): ~$0.55 a month.
- Tagging full article text instead of headlines: not planned; it would need the article fetch and multiply input ~20×, to roughly $1.50 a month.
- The same job on Sonnet 5.5 ($2 / $10) would be ~$5.40 a month, with no clear gain for tagging.
- Netlify: no new function runs (it rides the hourly job). Supabase: tags are a few dozen bytes per row.

---

### 3.6 The Athletic: favorite teams only, from team feeds (Luke, 2026-10-27)

The Athletic is half of all stories, and most are about teams Luke doesn't follow. Only stories about a favorite team appear, and **no AI is involved**: instead of the league feeds, the job reads The Athletic's **per-team feeds**.

- The Athletic publishes one RSS feed per team at `nytimes.com/athletic/rss/<league>/<team-slug>/` (seen in public feed directories, e.g. `…/rss/mlb/braves/`, `…/rss/football/atlunited/`). Its editors tag each story with its teams, so a feed catches stories that name only a player. Example from the live data: "Anthony Edwards to undergo arthroscopic procedure on right knee" never says "Timberwolves", and headline matching would miss it.
- **Which feeds:** the union of every News user's Scores favorites. The client sends its favorites (team key, name, scope) to `news_interest.teams` when they change, so the job never reads `tableplan_states`.
- **Slugs** aren't predictable (`atlunited`, not `atlanta-united`), so `_news-feeds.js` keeps a small table from a sports-model team to its Athletic league + slug. Luke's favorites (Vikings, Timberwolves, Lynx, Wild, Twins, Gophers, Ajax, Minnesota United) are filled in first; the existing `newsfeeds_status` row shows each feed's HTTP status after the first deploy, and a dead slug is fixed there. **Unverified:** the build sandbox can't reach nytimes.com, so none of the slugs has been fetched yet.
- **A favorite with no known slug:** its league feed is read and stories are kept only if the headline or subtitle names the team (name, short name or nickname). A fallback, less complete than a team feed.
- **Per person:** a row is inserted for a user only if the story came from one of *their* favorites' feeds or names one of their favorites. Someone with no favorites gets every Athletic story, as before (and while anyone signed in to The Athletic has no favorites, the job keeps reading all league feeds).
- **League-wide stories** (power rankings, the draft) don't come in unless The Athletic tags them with a favorite team.
- **Side effects:** about 160 fewer stories a day stored and fewer, smaller feeds fetched. Athletic stories stored before For you (no `topics`) are hidden in every view right away (`feedQuery`), rather than waiting the 3 days to age out.
- Other papers' sports stories (NYT, Star Tribune) are not filtered; they're ranked like any other story.

---

## 5. Build order

1. **Features, AI tags, The Athletic team feeds and For you.** Migration (gated): `news_articles.topics`, `news_articles.rank_score`, the index, `news_interest`. Keyword and team features plus Haiku 5.5 tagging in the hourly job and mail sweep (decided with step 1, Luke 2026-10-27); The Athletic team feeds (§3.6); `updateNews` decisions; the For you view; ⋯ menu items; seeding from Scores favorites. Netlify deploy (asks first) + TestFlight for the ⋯ menu.
2. **What News has learned** screen, Reset, the "Why" line.

## 6. Tests

- Unit (vitest): keyword extraction (stop words, proper-noun runs), team matching, scoring with caps and decay, diversity and exploration (seeded random), mute, feedback → weight changes, a muted story never ranked.
- Server: `feedQuery` for `foryou`; `updateNews` with the new decisions touching only that user's rows; hourly job reads `news_interest` once per user; AI tagging fallback and kill switch with a mocked API.
- Egress guard: no ranking code reads `tableplan_states`.
- QA (390 / 360 px): For you renders; More/Less/Mute reorder at once; the learned-interests screen.

## 7. Open questions for Luke

1. Should For you become the **default** view when News opens, or stay one tap away beside Front page? *(Built: beside it; Front page stays the default.)*
2. Should For you include **The Athletic** (filtered to his teams), given the Front page leaves it out? *(Built: included.)*
3. The day-one **"What do you like?"** sheet: yes, or learn quietly from use and favorites only? *(Built: no sheet.)*
4. ~~AI tagging: now or later?~~ **Decided (Luke, 2026-10-27): build it with step 1.**
5. ~~The Athletic: rank or filter?~~ **Decided (Luke, 2026-10-27): only favorite teams, without AI, from per-team feeds (§3.6).**

## 8. Noted in passing

- The newsletter → briefing conversion (`_news-articles.js`) still uses `claude-haiku-4-5`. Haiku 5.5 is a tenth of the price, but its API has breaking changes, so moving it is a separate, tested change.

## 9. As built: step 1 (branch `claude/news-for-you`, 2026-10-28)

Defaults taken for the open questions (Luke said to build with what's here; each is easy to change): **For you sits above Front page, which stays the view News opens on**; For you **includes The Athletic** (now favourite teams only); **no "What do you like?" sheet** (favourites seed sports, everything else is learned).

- **Migration** `migrations/2026-10-28-news-for-you.sql` (**not applied**): `news_articles.topics text[]`, `rank_score real`, an index for the For you pool; `news_interest` (`teams`, `teams_sig`, `weights`, `muted`), service role only, RLS on with no policies. Additive, no DROP, safe to re-run. Checked in PGlite: `scripts/check-news-for-you-migration.mjs` (13 checks).
- **Safe in either order.** `_news-store.js` `forYouReady` probes for `news_interest` once per warm function (re-tried every 10 minutes while missing). Until the migration is in, intake, views and decisions behave exactly as before, the app shows no For you tab and no feedback items, and Listen is reported as a read.
- **`_news-rank.js`** (pure): features (`p:` paper, `s:` section, `t:` AI topic, `e:` entity, `team:`, `k:` keyword), team matching (names, capitalised nicknames, never a bare place name: "a wild night" isn't the Wild), weights with a 21-day half-life and per-kind learning rates and caps, scoring, `arrangeForYou` (no three in a row from a section, at most three of the top ten on one topic or team, every 8th slot an "exploration" story with no interest match), the card's reason (`why`), mutes, and `athleticForUser`.
- **`_news-tags.js`**: Haiku 5.5 (`claude-haiku-5-5`), 40 stories a request, at most 6 a run, `effort: "low"`, no sampling parameters or prefill, text blocks read by type, `refusal` handled, each request bounded by the run's deadline. Kill switch `NEWS_AI_TAGS_DISABLED=1`; uses the existing `ANTHROPIC_API_KEY`.
- **Hourly job** (`_news-feeds.js` `runFeedIntake`): reads everyone's interests in one request; fetches favourites' Athletic team feeds (up to three slug candidates each) and their leagues' feeds; filters The Athletic per person; inserts with `return=representation&select=id` so only **new** stories come back; tags those once for everyone; stores each person's topics + rank in one upsert. The status row gains `forYou`, `tagging` (requested, tagged, errors, tokens) and each team feed's status.
- **Email intake** (`_news-links.js` `saveNewsBatch`): The Athletic filtered to favourites; stories stored with keyword / team topics and a rank from favourites + freshness (no AI on this path).
- **Reading** (`gmail.js` `newsFeed`): `view: { kind: "foryou" }` reads a pool of the 120 best-ranked unread, unhidden, unsaved stories from the last 48 hours plus recent newsletter leads, re-scores them with the person's current interests (so feedback counts at once, with no hourly re-scoring), and returns 40 with a `why`. Every reply says `forYou: true` and the server's `teamsSig`. Other views add the Athletic filter.
- **Learning** (`updateNews`): new decisions `listen`, `more`, `less`, `mute` (older builds send only the first four kinds). One read of the decided stories' topics + the interest row, one write. The reply's `learned` names what changed, for the toast ("You'll see less about Crime.").
- **Favourites** (`newsTeams`): the app sends its Scores favourites when their signature differs from the server's; it never sends an empty list (ISSUES.md).
- **App** (`news-ui.js`): For you tab, server order kept, the reason first in each card's meta line, ⋯ → More like this / Less like this / Mute topic (Less and Mute take the story out of For you at once), Listen reported as `listen`; the ⋯ menu now opens upward near the bottom of the list.
- **Not built (later steps):** the "What News has learned" screen and Reset (step 2); the scrolled-past "skip" signal (§3.1) — it needs per-story state to avoid counting the same story every visit.
- **Checks:** `test/news-for-you.test.js` (28: features, weights, scoring, arrangement, tags incl. Haiku 5.5 request shape and failures, team feeds, the hourly job before and after the migration, store queries, learning, the schema probe, the email path, app helpers); `npm run qa:news-for-you` (45 checks at 390, 360 and 1280 px, and with a server without For you); `qa:ticker`; boot check; full suite.
- **Not verified:** a real Haiku 5.5 reply (no API key in the build sandbox) and the Athletic team-feed slugs (ISSUES.md); against the real database.
- **Deploy steps (Luke):** apply the migration (`execute_sql`, then a `schema_migrations` row); `[deploy]` (Netlify: functions + web app); open News once on each device so the favourites reach the server; after the next hourly run, read `newsfeeds_status` for team feeds that 404 and the tagging token counts. No new env vars. A TestFlight build only matters for the iPhone app's copy of the web code if it isn't served live.

