# News story titles — design & as built

Status: **Built on branch `claude/news-titles` (2026-10-28). Asked for by Luke, 2026-10-28** ("the titles … are not coherent"). Server only: needs a Netlify deploy, no TestFlight build, no migration.

## 1. What was wrong (live data, 2026-10-21 → 28)

| Source | Example stored title | Cause |
|---|---|---|
| Email intake (newsletter links) | "your most pressing questions" (the El Niño FAQ), "and here", "could hit 60 degrees", "filling out our form" | The article page couldn't be read from Netlify (Star Tribune 0 of 28, Economist 0 of 5, NYT 2 of 12 had page data), so the card took the **link's own words**, often part of a sentence. About a third of emailed stories. |
| Email intake | "Israels Future", "Where They Stand Peggy Flanagan And Michele Tafoya On Immigration And Ice" | No usable link text, so the URL slug was title-cased (fine as a last resort). |
| Email intake | headline + summary + "By Jillian Vordick and Theodore Schleifer" in one title | One link wrapped the whole card. |
| NYT feed | "Here’s the latest." (~10 a week) | The feed's title for live-blog updates. |
| NYT feed | "Makes Rules for?" | The XML parser dropped text around inline `<em>` in a title. |

The dock ticker shows the newsletter **leads**, which all come from email, so it showed the worst of these.

## 2. What changed

`netlify/functions/_news-titles.js` (pure, except `repairTitles`, which takes its network injected):

- **`isWeakTitle(title, { url, origin })`**: generic ("Here’s the latest.") or starting lower-case is weak from any source. Email titles are also weak when shorter than 3 words, ending on a dangling "here"/"this"/"form"…, longer than 150 characters, carrying a glued byline, or just the URL slug. Feed titles otherwise stand (a short NYT headline like "Far, Far Away" is the paper's own).
- **Email intake** (`_news-links.js`):
  - `splitAnchor` reads a card-sized link as headline / summary / byline (block breaks), so the headline is the title and the summary the subtitle.
  - `chooseEmailTitle`: the page's headline when it could be read; else the link text if it reads as a headline (a short one loses to a much longer slug: "Newly retired" vs "Jessie Diggins encourages fans…"); else the slug, title-cased with small words lower-case ("Kamala Harris Is Sitting Out Minnesota for Now").
- **Feeds** (`_news-feeds.js`): titles and summaries are read raw (`stopNodes`), so inline markup no longer drops words. `fixFeedTitle` turns a generic live-blog update into "Live: <blog slug>".
- **Hourly repair** (end of `runFeedIntake`, per user): one read of the last 3 days' candidate rows (email rows, live-blog rows, titles starting "Here"; `id,url,title,subtitle,origin,discovered_at`, ≤200), then per weak title, in order:
  1. the same story's title from this run's feeds;
  2. for a live-blog update, the blog's own headline from its main row ("Live: At Least 30 Killed in Train Collision in Spain…");
  3. the article page's headline (`fetchArticleMeta`), for weak email rows from the last 36 h and generic feed rows — **at most 8 pages a run**;
  4. the feed's own fix, then the URL slug, rather than a fragment or "Here’s the latest."
  A row is PATCHed only when its title actually improves (`return=minimal`). The status row (`newsfeeds_status.titles`) records candidates, pages read/found, fixes and their source per user.
- Existing bad titles in the 3-day window are fixed by the first runs after deploy; there's no separate backfill.

## 3. Cost

- Supabase: one read of ~60 short rows per user per hour (~10 KB), a handful of small PATCHes. Under ~10 MB a month.
- Netlify: no new function; the hourly job does ≤8 extra page reads.
- No AI.

## 4. Not done / limits

- Topics and rank for a repaired story were computed from the old title; it isn't re-tagged (For you ranks it slightly worse than it would).
- Where no page can be read and the URL has no slug (Economist "world in brief" ids), a short title such as "Gadi Eisenkot" stays.
- **Unverified:** whether Netlify can read NYT / Star Tribune / Economist pages at all (the build sandbox can't reach them). If not, step 3 never succeeds and titles come from feeds, live blogs or slugs. `newsfeeds_status.titles.pagesFound` answers this after the first runs.

## 5. Checks

`test/news-titles.test.js` (25, fixtures from the real stored titles): weak/strong titles, slug titles, anchor splitting, email title choice, feed parsing with inline markup and CDATA, live-blog titles, the repair plan (each source, stability on re-run), page-read selection and the capped repair run. Full suite passes.
