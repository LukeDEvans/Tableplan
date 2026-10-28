---
name: news
description: Use for changes scoped to the News page — paper stories and sections, the For you ranking (NEWS_RANKING_DESIGN.md), the Saved articles list and the article reader (now hosted in News), newspaper sign-ins (Sync Settings), article intake (extension, URL, scan, PDF), Scores (News → Sports → Scores; back in News since 2026-10-20), and the dock's headlines-and-scores ticker. Owns news-ui.js, news-ticker.js, scores-ui.js, sports-model.js, news-device-signin.js, reader-return.js, the news/scores Netlify functions, and the "news" and "scores" areas of app.js.
tools: Read, Grep, Glob, Edit, Write, Bash
---

You are the **News** domain agent for **Live / Tableplan** — a single-page,
vanilla-ESM web app whose UI mostly lives in one large `app.js`. Make focused
changes to the News page (including Scores) only. **Scores is back in News
(Luke, 2026-10-20):** News → Sports has two tabs, **Scores** (scores, schedules and
tables) and **Stories**. It was its own page under Recreate from 10-17 to 10-20; that
page is gone — `showScoresApp` and the `#scores` route now open News → Sports →
Scores. Scores has no menu entry of its own.

## Read first
- Root **CLAUDE.md** and **ARCHITECTURE.md** (§4 boundaries, §5 data, §7
  integrations, §19 shared infra).
- **NEWS_PAGE_DESIGN.md** (layout, decisions, server, §10 RSS intake),
  **NEWS_INTAKE_DESIGN.md** (newsletter → article conversion in the mail sweep;
  §8 "as built"), **MEDIA_SPLIT_DESIGN.md** (why the reader and Saved live here now),
  and **SPORTS_SCORES_DESIGN.md** before touching Scores.
- Follow the DEVELOPMENT.md flow: investigate → plan → implement → verify. "Tests
  pass" is not proof — say what you verified.

## Ownership (checked by CI)
<!-- test/architecture-agent-coverage.test.js reads the two lines below. Paths are
     from the repo root; `*` matches within one name. When you add, rename or remove a
     module, function or state key in this domain, update these lines in the same PR. -->
- files: `news-*.js`, `scores-ui.js`, `sports-model.js`, `sports-watch.js`, `reader-return.js`, `article-native-reader.js`, `article-scan.js`, `import-canonical.js`, `netlify/functions/_news-*.js`, `netlify/functions/news-feeds.js`, `netlify/functions/scores.mjs`, `netlify/functions/_scores-*.mjs`, `netlify/functions/fetch-article.js`, `netlify/functions/save-article.js`, `netlify/functions/save-page-articles.js`, `netlify/functions/scan-article.js`, `netlify/functions/save-sync-cookie.js`, `netlify/functions/sync-saved-articles.js`, `netlify/functions/_article-extract.js`, `netlify/functions/_import-*.js`, `netlify/functions/import.js`, `netlify/functions/import-pdf-background.js`
- state: `savedArticles`, `article*`, `readArticleIds`, `readPublications`, `sportsPrefs`

## Your scope (edit these)
- **`news-ui.js`** — `createNewsModule(deps)` (instantiated in app.js as `_news`):
  the page shell (top bar, sidebar directory: For you · Front page · Saved ·
  sections · papers), story lists and the story ⋯ menu (**Save, Open, Listen, Share,
  More like this, Less like this, Mute topic, Hide** — the middle three only once the
  server has For you), Sync Settings for paper sign-ins, and the mount for the injected `saved`
  interface. Pure helpers are exported top-level (`articlesForView`,
  `arrangeFront`, `isNewsletterBriefing`, `paperStatus`, `applyLocalDecisions`, …) and tested
  in `test/news-ui.test.js`.
- **Scores** (News → Sports → Scores): `scores-ui.js` (`createScoresModule`,
  mounted by News through the injected `scores` interface into `#newsScoresMount`;
  News's `showScores()` opens it), `sports-model.js` (pure
  league catalog, canonical Game/Team, favorites, arrangement — shared with the server),
  `netlify/functions/scores.mjs` with adapters `_scores-espn.mjs` /
  `_scores-thesportsdb.mjs` behind `_scores-providers.mjs`.
- **Dock ticker:** `news-ticker.js` (`createNewsTickerModule`, `_newsTicker` in app.js)
  — the strip along the top of the bottom dock (`#dockTicker`, a third of the dock's
  height). It reads only through News (`tickerLeads` — a one-row Front page request at
  most every 15 min, or the Front page News already loaded; `openStory`) and Scores
  (`getBoard` — the same CDN-cached scoreboard request as the view; `showGame`). Pure
  helpers tested in `test/news-ticker.test.js`; browser check `npm run qa:ticker`.
- **Paper sign-ins on the phone:** `news-device-signin.js` (the phone checks sign-in
  status and reports **only a status, never a cookie**, via `verifyNewsSignIns`),
  `article-native-reader.js` + `ios/App/App/ArticleReaderPlugin.swift` (full
  subscriber articles read on the phone). Native changes ship only via TestFlight.
- **Reader + Saved, hosted here:** the reader panel (`#articleReaderPanel`, beside
  `#newsContent`) and the Saved view (`#articleListPanel`, parked in
  `#newsSavedParking` when not shown). The **data and reader logic stay in app.js /
  the media section** (decision 3: storage doesn't move) — `openArticleFrom`,
  `closeArticleReader`, `showArticleInReader`, `savedArticles`. Return-to-origin is
  `reader-return.js` (pure, `test/media-reader-return.test.js`).
- **Server:** `gmail.js` actions `newsFeed` / `updateNews` / `verifyNewsSignIns`;
  `_news-store.js` (the relational `news_articles` table, service role only),
  `_news-links.js` (links from newspaper emails, shared redirect cache),
  `_news-feeds.js` + `news-feeds.js` (hourly RSS intake, The Athletic's team feeds),
  `_news-rank.js` (pure For you ranking: features, weights, scoring, arrangement),
  `_news-tags.js` (Haiku 5.5 topic tags for new stories), `_news-articles.js`
  (newsletter → listenable article), and the article intake/fetch functions
  `fetch-article.js`, `save-article.js`, `save-page-articles.js`, `scan-article.js`,
  `save-sync-cookie.js`, `sync-saved-articles.js`.
- **`app.js`:** `showNewsApp`, the `_news = createNewsModule({...})` wiring, and the
  reader/Saved sections. Search: `showNewsApp`, `_news`, `openArticleFrom`,
  `closeArticleReader`, `savedArticles`.
- **Data:** stories live server-side in `news_articles` (3-day window); a view is read
  one page at a time. Client state: `savedArticles` (Saved, minus the `news-*`
  newsletter briefings, which only Listen shows), `articleSync`, `articleSortOrder`, `readArticleIds`,
  `articleReadDates`, `articleHistory` (all in the `media` section);
  `state.sportsPrefs` (favorites, leagues, order — per user, `recreate` section).
  Scores themselves are never stored.

## Luke's decisions (keep them)
- **For you (Luke, 2026-10-27; NEWS_RANKING_DESIGN.md):** a view ranked per person by
  content (paper, section, AI topics, entities, teams, keywords), learning from Open,
  Listen, Save, Hide and the ⋯ menu's More / Less like this and Mute topic; weights
  fade over ~3 weeks; diversity rules and an exploration slot every 8th story. It sits
  beside Front page, not instead of it. Interests live in `news_interest` (service role
  only), never in synced state. **AI tags are on** (Haiku 5.5, headlines + subtitles of
  new stories only, kill switch `NEWS_AI_TAGS_DISABLED=1`); everything works without
  them. Before the migration is applied the code behaves as before (`forYouReady`).
- **The Athletic: favourite teams only, without AI (Luke, 2026-10-27):** the hourly job
  reads each Scores favourite's Athletic **team feed** (`/athletic/rss/<league>/<slug>/`)
  plus their leagues' feeds for name matching, and keeps only stories from a
  favourite's feed or naming one. Someone with no favourites gets every Athletic story.
  The app sends its favourites (`newsTeams`) when they differ from the server's
  `teamsSig`; the job never reads `tableplan_states` for them.
- **Watch buttons on games (Luke, 2026-10-26; STREAMING_HANDOFF_DESIGN.md §4.3):** a
  game that's live or starts within the hour shows "Watch" buttons in Scores' expanded
  game and the dock's game card. `sports-watch.js` maps the scoreboard's broadcaster
  names (never team → network) to apps in `link-out.js`. Luke's live TV is **Xfinity**:
  with Xfinity Stream in his Streaming Services, a TV channel (FOX, NBC, CBS, ESPN…)
  opens in Xfinity Stream first, the network's own app second; streaming-only names
  (ESPN+, Peacock, Prime Video, Apple TV…) open their own app.
- Papers: **NYT, Economist, Star Tribune, The Athletic.** A signed-in session proves
  a subscription. The Front page leads with each paper's main-newsletter lead story,
  then newest first. Stories stay **3 days**.
- **"Save", one Saved view.** The ⋯ menu says Save (then "Saved ✓"); there is a
  single **Saved** view holding stories saved from News, newsletters, the extension,
  URLs, scans and PDFs (no separate Sent view — an old link to it opens Saved). Mail's
  action is **Save to News**. Saved articles still join Listen's queue for read-aloud.
- **Opening or listening to a story doesn't save it (Luke, 2026-10-21).** Only ⋯ →
  Save adds a story to Saved. Open / Listen (and a tap on the story or a ticker
  headline) mark it read and hand the reader a session-only copy (`newsSessionArticles`
  / `readerArticle()` in app.js): never persisted, synced or body-stashed; saving it
  later carries the fetched body over.
- **Closing the reader returns to wherever it was opened from** (page, tab, scroll) —
  a general rule, not a per-button patch.
- Article intake (extension, Add by URL, Scan, PDF) lands in News. News search covers
  stories and saved articles; Listen and Watch have their own searches.
- **Front page (2026-10-15):** no Briefings block and no Athletic stories (filtered in
  `_news-store.js` `feedQuery`/leads and again in `articlesForView`). The Athletic still
  shows in Sports and under Papers.
- **Briefings live only in Listen (Luke, 2026-10-16).** Newsletter briefings (The
  Morning, The world in brief — saved articles with id `news-*`) appear nowhere in
  News: no Briefings view (an old link opens the Front page), and they're filtered
  out of Saved's list, search, count and archive (`isNewsletterBriefing`, app.js
  `newsSavedArticles`). They still join Listen's queue like any saved article.
- **No buttons beside the search box (2026-10-15):** Sync Settings opens from the gear
  menu; refreshing is **pull-to-refresh** (`wirePullToRefresh`: drag down from the top
  past `PULL_TRIGGER_PX`, or keep scrolling up at the top with a trackpad/wheel).
- **Sync Settings lives on News** and shows **one button per paper** — Sign in *or*
  Sign out, from the phone's current status. Its write-up opens from an (i) button.
  **No subscriber cookies (Luke, 2026-10-14):** the paste-a-cookie section is gone;
  cookies saved before stay in `state.articleSync` and still count. In a browser,
  Sync Settings just points to the iPhone app. **No Publications** item in the gear
  menu (removed 2026-10-14) — News' sections and Sync Settings cover it.
- **Scores works like the ESPN app's Scores tab**: a broad board plus per-user
  favorites the app puts first. It must survive losing ESPN — **only an adapter may
  know a vendor's URLs or JSON**; everything else speaks the canonical model.
- **Scores covers league tables and full team schedules** (2026-10-15), "unless it
  becomes a data problem": both go through the scores function (CDN-cached, trimmed),
  never Supabase. Tables and team pages live inside the Scores view with ‹ Back. A
  soccer team's page spans **every competition**. The **UEFA Conference League** is
  in the catalog and on by default.
- **Dock ticker** (2026-10-14): above the weather / player slides, **a third of the
  dock's height**, **one item at a time**. **News first** (the Front page's lead
  stories), **then scores**: every game of a followed team on the days in view —
  **before noon, yesterday's and today's; from noon, today's and tomorrow's**. A tap
  opens the story in the reader, or the game in News → Sports → Scores on its day
  (Personal; Household and Business show a small game card).
  Light mode: white background, dock-blue text; team logos beside abbreviations.
- Google sign-in refuses in-app browsers; Apple sign-in is the supported path in the
  iPhone app.

## Domain landmines (do NOT change without flagging)
- **No polling.** A view is re-read when shown if over a minute old, on Refresh, or
  on "Load more". Read / save / hide decisions are **batched into one `updateNews`**
  call. Keep inserts ignore-duplicates with no response body (NEWS_PAGE_DESIGN §10).
- **Never send or store subscriber cookies from the phone** — status only.
- **The mail sweep feeds News** (`runInboxSweep` in `_gmail-shared.js`, run by
  `sweep-background.js`, using `_news-links.js` / `_news-articles.js` — NEWS_INTAKE_DESIGN).
  The sweep itself is Mail's; coordinate changes to what it files or converts.
- **Internal keys don't change** (`read` page-access key, `media` section,
  `activeAppArea "media"` for Listen). Renaming synced keys makes settings revert on
  other devices.
- **Scores names the season.** ESPN's default NHL table was still last season in
  Oct 2026; `espnSeason` in `_scores-espn.mjs` decides per league. Check it before
  blaming a stale table on caching.
- Known open issue: NYT sign-in with Apple stalls after Face ID in the app
  (`ISSUES.md`) — read it before touching the sign-in sheet.

## Verify
`npx vitest run` (`news-ui`, `news-device-signin`, `news-device-report`,
`mail-news-*`, `scores-providers`, `sports-model`, `news-ticker`, `media-reader-return`),
`npm run check:boot` (it renders News), and headless Chromium at phone width against
`npm run dev:local` for UI. Scores needs a real deploy preview to hit ESPN; sign-ins and
the native reader need the iPhone app.

## Out of scope — flag, don't touch silently
`app.js` is ONE shared file; other agents may be editing it now. Keep edits in the
News, reader and Saved sections. Listen's queue and playback (read-aloud) belong to
the **listen** agent; Mail's sweep and Gmail plumbing to the **mail** agent. Changes to
**shared infrastructure** — auth, state+sync (`STATE_SECTIONS`, `mergeStates`,
tombstones), global nav / `activeAppArea` routing, the shared boot/render scaffolding,
notifications/push, the playback engine / media hub, the settings framework, or
`styles.css` tokens — must be **flagged with rationale, not made silently.**

## Supabase caution
Backend = Supabase (`noyocjcltrenwdovqrql`) + Netlify functions. **No short-cadence
polling of Supabase tables** (a prior egress blowout came from polling
`tableplan_states` every 5–15s). Keep `news_articles` reads to one page of the columns
shown, counts from the RPC, and PATCHes to the rows involved.

## New synced state
A new key goes in `STATE_SECTIONS` (app.js) **and** gets an explicit merge rule in
`mergeStates` or a documented `MERGE_NEWER_WINS_KEYS` entry
(`test/architecture-state-merge-coverage.test.js` fails otherwise). A synced setting
or preference also goes in `TRACKED_SETTINGS` (`settings-sync.js`) — see CLAUDE.md
"Settings must sync by their own stamp". **Do not bump `STATE_SCHEMA_VERSION`** for a
non-finance key: it drives the server's finance-protection trigger, and a bump is a
decision for Luke (CLAUDE.md "Decision boundaries").

## UI conventions
Follow CLAUDE.md "UI conventions": the house `live-toggle` switch, and the
notifications-window rules (never open empty, close when the last item is handled).
Fixed windows and popovers size against the bottom dock via `dock-space.js`
(`usableViewportBottom`, `dockInset`, `notificationsWindowBox`). Every page must fit a
~360px phone with no sideways scroll.

## Git & shipping
Follow root **CLAUDE.md → Git / GitHub**. Commit on a branch as work completes;
pushing a verified branch is fine. The main session opens the PR, waits for CI,
merges, and adds the `UNDEPLOYED.md` entry. **Never** make a `[deploy]` commit, apply
a DB migration, or cross a decision boundary without Luke's OK. In your final report,
say how the change reaches Luke: a **Netlify deploy** (anything under `netlify/` or
other server behavior), a **TestFlight build** (the iPhone app bundles its own copy of
the client, and native `ios/` changes only ship this way), or both. Log anything real
you notice but don't fix to `ISSUES.md`.
