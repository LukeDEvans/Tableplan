# News ranking ("For you") — design & plan

Status: **PROPOSED (2026-10-27); partly decided (Luke, 2026-10-27, §7).** Follows NEWS_PAGE_DESIGN.md §10, which named a personalized feed as the next step. Read from code on `main` @ `a0c5547` and the live database (read-only counts, 2026-10-27). Nothing is built.

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

- If volume doubles (another paper, more feeds): ~$0.55 a month.
- Tagging full article text instead of headlines: not planned; it would need the article fetch and multiply input ~20×, to roughly $1.50 a month.
- The same job on Sonnet 5.5 ($2 / $10) would be ~$5.40 a month, with no clear gain for tagging.
- Netlify: no new function runs (it rides the hourly job). Supabase: tags are a few dozen bytes per row.

---

### 3.6 The Athletic: favorite teams only (Luke, 2026-10-27)

The Athletic is half of all stories, and most are about teams Luke doesn't follow. Its stories that aren't about a favorite team are **left out of every News view** (For you, Sports, the Athletic paper filter, search), not only down-ranked.

- **Favorites** are the person's Scores favorites (`state.sportsPrefs`). The client sends the team list (name, short name, scope) to `news_interest.teams` when favorites change, so the feed job never reads `tableplan_states`.
- **"About a team"** means the story's `topics` carry `team:<key>`, from the AI tags (§4, which also catch stories that name only a player or coach) or, if tagging failed, from matching team names and nicknames in the headline and subtitle.
- **Rows are still stored**; the filter is applied when a view is read (`feedQuery`: Athletic rows must have a favorite `team:` topic). So changing favorites takes effect at once for the last 3 days, and nothing is lost by a tagging miss. Storage cost is unchanged (rows are small and pruned after 5 days).
- **Per person:** the filter uses that person's own favorites. Someone with no favorites sees all Athletic stories, as today.
- **Other papers' sports stories** (NYT, Star Tribune) are not filtered; they're ranked like any other story.
- *Open:* league-wide Athletic stories that name no team (power rankings, trade-deadline roundups, the draft), §7.

---

## 5. Build order

1. **Features, AI tags, the Athletic filter and For you.** Migration (gated): `news_articles.topics`, `news_articles.rank_score`, the index, `news_interest`. Keyword and team features plus Haiku 5.5 tagging in the hourly job and mail sweep (decided with step 1, Luke 2026-10-27); the Athletic filter (§3.6); `updateNews` decisions; the For you view; ⋯ menu items; seeding from Scores favorites. Netlify deploy (asks first) + TestFlight for the ⋯ menu.
2. **What News has learned** screen, Reset, the "Why" line.

## 6. Tests

- Unit (vitest): keyword extraction (stop words, proper-noun runs), team matching, scoring with caps and decay, diversity and exploration (seeded random), mute, feedback → weight changes, a muted story never ranked.
- Server: `feedQuery` for `foryou`; `updateNews` with the new decisions touching only that user's rows; hourly job reads `news_interest` once per user; AI tagging fallback and kill switch with a mocked API.
- Egress guard: no ranking code reads `tableplan_states`.
- QA (390 / 360 px): For you renders; More/Less/Mute reorder at once; the learned-interests screen.

## 7. Open questions for Luke

1. Should For you become the **default** view when News opens, or stay one tap away beside Front page?
2. Should For you include **The Athletic** (filtered to his teams), given the Front page leaves it out?
3. The day-one **"What do you like?"** sheet: yes, or learn quietly from use and favorites only?
4. ~~AI tagging: now or later?~~ **Decided (Luke, 2026-10-27): build it with step 1.**
5. ~~The Athletic: rank or filter?~~ **Decided (Luke, 2026-10-27): filter to favorite teams, everywhere (§3.6).**
6. League-wide Athletic stories with no team: keep them, or filter them out too?

## 8. Noted in passing

- The newsletter → briefing conversion (`_news-articles.js`) still uses `claude-haiku-4-5`. Haiku 5.5 is a tenth of the price, but its API has breaking changes, so moving it is a separate, tested change.
