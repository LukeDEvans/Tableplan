# News Front page: top stories — design & as built

Status: **Built on branch `claude/news-front-page` (2026-11-13). Asked for by Luke, 2026-11-13**, with a screenshot from 8:41 pm during the nationwide FAA ground stop: the Front page led with "Embracing the Darkness: 5 European Festivals of Light". Server only: needs a Netlify deploy (asks first), no TestFlight build, no migration, no new env var.

## 1. What was wrong (live data, 2026-11-13 evening)

The Front page had no notion of importance. Its order was (`news-ui.js` `arrangeFront`, `_news-store.js` `loadFeedPage`):

1. **Newsletter leads**: the first link of any newsletter email from the last 36 h, most recent on top.
2. Everything else, **newest first**, across ~55 section feeds.

At 8:41 pm the four cards at the top were all newsletter leads:

| Card | Why it was there |
|---|---|
| Embracing the Darkness: 5 European Festivals of Light | first link of a travel newsletter, 1:07 pm |
| After the Fall | first link of a morning newsletter, 5:59 am |
| Click here to submit questions | a newsletter's Q&A link, the evening before (the story was 4 days old) |
| Bruce Springsteen, U2 and More Honor Shane MacGowan… | first link of a music newsletter, the day before |

Meanwhile the database held **11 ground-stop stories from two papers**, published 3:44–5:53 pm, including the NYT live blog and the Star Tribune's MSP live blog. They sat below the leads and below every story published after them (the van Gogh sale, Biden's memoir…), because nothing but the clock ordered them.

So the stories were there. The page just didn't know they mattered.

## 2. What the papers tell us that we were throwing away

| Signal | Used now? |
|---|---|
| **How much is being written about one event, how fast, by how many papers** (11 stories in 4 h from 2 papers) | Yes, the main signal |
| **A live blog** exists for it | Yes |
| **Section** (U.S. / World / Politics / Minnesota vs. Culture / Opinion) | Yes |
| Freshness | Yes |
| A newsletter led with it | Yes, as a small bonus instead of a pin |
| Position on the paper's own home page (order of NYT `HomePage.xml`, the Star Tribune's top feed) | **No** — see §6 |

## 3. How the top stories are chosen (`netlify/functions/_news-front.js`, pure)

Input: the last 24 h of Front page stories (no Athletic, nothing hidden).

1. **Words.** Each story becomes the set of words in its headline and summary: lower-cased, crudely stemmed (grounded / grounding → ground), minus everyday words and the standing cast of the news (Trump, Congress, Minnesota…), so two stories aren't "the same event" for sharing "Trump".
2. **Events.** Stories are grouped oldest first. A story joins a young event (1–2 stories) only if it shares three words with one of them, and an established event if it shares two of its *core* words (in ≥30% of its stories). Then established events with three main words in common are merged, and leftover stories carrying two of an event's main words are moved in. On the fixture this gives one ground-stop event (9 stories, both papers), one Nvidia event (14), the Brooklyn collapse (5), and no mixed bags.
3. **Heat.** Each story in an event counts `e^(−age / 6 h)` (opinion pieces 0.4×; the same headline twice counts once). Event score = `3·log2(1 + heat)` + 1 if two papers + 1.5 if it has a live blog + up to 1.5 if its first story is under 6 h old (breaking).
4. **Story score** = event score + section (U.S./World/Politics/Minnesota +1 … Opinion/Culture −1.5) + freshness (0–2 over 12 h) + 1 if a newsletter led with it.
5. **Top block.** Events by their best story's score; each shows one story (the live blog itself if there is one, never a live-blog update), and an event with heat ≥ 3 shows a second from **another paper** (usually the local angle). At most 8; a story needs a score of 4.5, so on a quiet night the block is short or empty and the page is newest first.

Fragments for titles (`_news-titles.js` `isWeakTitle`) and stories older than a day can't be top stories.

**Replayed on the real pool** (`test/fixtures/news-front-2026-11-13.json`):

| Time (Central) | Lead | Then |
|---|---|---|
| 3:30 pm, before it broke | The Jensen Huang scandal reaches Donald Trump's cabinet (Economist) | another Nvidia story, Boebert's loss |
| 4:00 pm, 16 min after the first story | **Live: Ground Stop Nationwide Flights Faa** (NYT) | Nvidia |
| 8:41 pm, the screenshot | **NYT live blog + Star Tribune MSP live blog** | Nvidia scandal, Trump–Putin–Xi, Boebert |

## 4. How it reaches the app with no app change

Every installed build shows cards that carry `lead` first, most recent `lead` on top, labels the first "Lead story", and feeds the same cards to the dock ticker. So `loadFeedPage` now:

- reads the slim pool (`id,url,title,subtitle,paper,section,origin,published_at,lead_at`, last 24 h) on the first Front page, ranks it, reads the top stories' full rows by id;
- sends those first with a `lead` time one second apart (= their order);
- sends **no `lead` on any other Front page card** (later pages and search included), so a newsletter's first link no longer pins a story by itself.

The ticker (a one-row Front page request) therefore shows the top stories too. Sections, papers, Saved and For you are unchanged; `lead_at` in the database is untouched (For you still uses it).

**Changes an earlier decision:** NEWS_PAGE_DESIGN Q3 ("newsletter leads first"). Kill switch: env `NEWS_FRONT_RANK_DISABLED=1` restores it exactly.

## 5. Cost

- Supabase: the pool is ~450 bytes a story, ~180 stories → **~80 KB per ranking**, kept 5 minutes per warm function so the page and the ticker share one (the old leads read was ~7 KB). The top stories' rows are re-read each time (≤8 rows) so a hide shows at once. At 15 rankings a day: **~35 MB a month.** No new writes, no timer, no `tableplan_states` read.
- Netlify: no new function. No AI.

## 6. Not done — next steps, in the order I'd take them

1. **Home-page position.** The order of NYT's `HomePage.xml` (and the Star Tribune's top feed) is the editors' own ranking, the nearest thing to "what is on the front page". The hourly job reads those feeds and discards the order. Storing it needs one small column (`front_pos`, a migration) and is worth +2–3 points for the top five. **Unverified:** that the feed order really is home-page order (the build sandbox can't reach nytimes.com); the first run would show it.
2. **An outside check on "how big is this".** A wire or broadcaster top-stories feed (AP, NPR, BBC) read hourly as a *signal only*: its stories aren't shown, but an event that also leads there gets a boost. It catches a big story in the first minutes, before either paper has a second piece.
3. **Faster intake while something is breaking.** The job runs hourly, so a story can be up to an hour late. When an event's breaking score is high, the app could ask for one extra run on open (not a timer).
4. **A "Top stories" label and grouping in the app** (needs a TestFlight build): "Lead story · U.S." is the only label today; the block could say "9 stories · NYT, Star Tribune" and open the event's other coverage.
5. **A breaking-news notification** on the iPhone when an event crosses a high bar (IOS_NOTIFICATIONS_DESIGN.md), off by default.
6. The NYT live blog's stored title is its URL slug ("Live: Ground Stop Nationwide Flights Faa"); the title repair (NEWS_TITLES_DESIGN.md) replaces it only when the article page can be read.

## 7. Limits

- Grouping is by shared words, so a sidebar that names none of the event's words stays out of it ("Airports Fill Up With Stuck Families and Stranded Travelers"), and a briefing that names two events lands in one of them. Neither changes what leads.
- Importance is "how much the two or three papers are writing". A single unmatched story of real weight (a death, a court ruling, one paper only) gets only section + freshness until a second story appears. Step 1 or 2 above is what fixes that.
- Weights were set on one evening's data. `rankFront` returns each top story's score, heat, story and paper counts for tuning.

## 8. Checks

`test/news-front.test.js` (21): word stems and stop words; live blog vs. update; the fixture's events (ground stop grouped across papers, no chains, the Nvidia threads merged); the lead at three times of day; no opinion / feature / live-update on top; order independent of input order; quiet pool → no top stories; a newsletter lead doesn't outrank an event; old / future-dated / fragment titles skipped; second story from another paper; `loadFeedPage` (top first with ordered `lead`, ticker request, one pool read per 5 minutes and no `select=*`, a hidden top story gone at once, later pages and other views, failed pool read, kill switch). Full suite passes (303 files).

**Not verified:** against the live database through the deployed function, and on the phone.
