# News Intake — Design (Intent / Spec / Plan)

**Status:** SPEC — agreed in conversation 2026-09-27, awaiting go-ahead to implement.
One open question remains (§6, Q-A). Nothing here is implemented yet.

## 1. Intent

Reduce newsletter intake from **The New York Times, The Economist, and the
Minnesota Star Tribune** by turning their emails into a swipeable triage deck, the
way NYT Cooking / Bon Appétit emails already feed the Meal Plan page's recipe
notifications.

- Every article **linked in an email** from these publications becomes one card in
  **Media → 🔔 notifications**. This is not every article the paper publishes:
  email is the only source. RSS was considered and dropped.
- **An article is never shown twice**, even if many emails link it, and even after
  it has been accepted or dismissed.
- Swipe **right → saved to Media → Publications** (under that paper). Swipe
  **left → dismissed**.
- The existing "newsletter → listenable article" conversion **keeps running** on
  the same emails. Both happen for one email.
- The processed email is filed to **Apps/AI trash** in Gmail.

## 2. What exists (observed in code)

| Piece | Where | Reuse |
|---|---|---|
| Real-time mail processing (Gmail push → sweep) | `gmail-webhook` → `sweep-background.js` → `_gmail-shared.js:~480-620` | New step goes here |
| Recipe links from email: sender match, tracker-redirect resolution, og:image fetch, pending queue | `_recipe-digest.js` (`extractRecipes`, `followRedirects`, `fetchRecipeImage`, `appendPendingRecipes`) | Same pattern; share helpers |
| Pending list storage | `tableplan_states` row `mailai_<userId>` → `recipesPending` | Add `newsPending` + `newsSeen` |
| Bell reads/dismisses | `gmail.js` actions `pendingRecipes` / `dismissRecipe` | Add `pendingNews` / `resolveNews` |
| Swipe deck UI | `mealplan-ui.js:279-410` (`.eat-swipe-deck`) | Extract to shared `swipe-deck.js` |
| Newsletter → article (Claude/Haiku) | `_news-articles.js` (`NEWS_SOURCES`, `convertNewsEmailToArticle`) | Kept; must no longer `return` early |
| Save into Media → Publications | `saveArticleToMediaSection` (appends to `u-<user>` `media.savedArticles`) | Accept path |
| Media bell (placeholder) | `mediaNotificationsBtn`, `app.js:~26968` ("coming soon") | Wire it up |
| Paper keys | `defaultReadPublications()` → `nyt`, `economist`, `startribune` | `publication` field on saves |
| Standalone Publications page + RSS pipeline | `showPublicationsApp`, `homePublicationsBtn`, `publications*.js`, `feed-*.js`, `fetch-feed.js` | **Removed** (§5) |

**Known gap in the recipe flow (not changed here):** recipes have no "seen" record,
so a dismissed recipe can come back if a later email links it again. News adds
that record. Recipes could adopt it later (logged to ISSUES.md).

## 3. Spec

### 3.1 Server — per incoming email

Match on sender (`nytimes.com`, `economist.com`, `startribune.com`), gated by a
**per-paper Mail AI toggle** (§3.5). Order of operations for one email:

1. **Recipe routing stays first.** NYT Cooking emails come from `nytimes.com` too.
   If `recipeSourceForSender` matches and recipe links are found, today's
   recipe path still runs. Link extraction must **exclude `cooking.nytimes.com`**
   so a recipe is never also a news card.
2. **Extract article links** (`extractNewsLinks(html, source)`):
   - Resolve click trackers (`nl.nytimes.com`, Economist/Strib ESP wrappers) with
     the existing bounded `followRedirects` (max 3 hops, de-duplicated per email).
   - Keep only **article-shaped URLs** (per-source allow regex), e.g.
     `nytimes.com/YYYY/MM/DD/…`, `economist.com/<section>/YYYY/MM/DD/<slug>`,
     `startribune.com/<slug>/<numeric-id>`. Drop Cooking, Games, Wirecutter,
     account/subscribe/manage/unsubscribe, app stores, and social links.
   - **Cap: 40 articles per email.**
   - Canonicalize: strip query + hash (drops `smid`, `utm_*`, etc.), lowercase the
     host, and remove the trailing slash. The canonical URL is the identity.
3. **Dedupe against `newsSeen`** (in the `mailai_<user>` row). Only unseen URLs go
   on.
4. **Build each card** (best effort; a card needs only `url` + `title`):
   - `title`: `og:title`, else the email's link text, else a title from the slug.
   - `subtitle`: `og:description`, else none.
   - `image`: `og:image`, else the nearest `<img>` next to the link in the email,
     else none.
   - The page fetch is a head-only range fetch (as `fetchRecipeImage` does),
     6-second timeout, run in parallel with a concurrency limit of 6, and **fails
     soft**. Publishers may block server fetches, so a card built from email
     context alone is acceptable. Title-only cards are allowed.
5. **Persist in one row write:** append the new cards to `newsPending` and add their
   URLs to `newsSeen`. This must **throw on failure**, as `saveMailAiRow` does, so
   the email is not filed if the write failed.
6. **Newsletter → article conversion** (existing `newsSourceForMessage` /
   `convertNewsEmailToArticle`). It runs **after** step 5 on the same email; it no
   longer ends processing early. See §6 Q-A for which emails get converted.
7. **File the email to Apps/AI trash**, always for news (not the
   test-mode-or-real-Trash switch recipes use). If the label is missing, leave the
   email in place and log the error (existing behavior).

**Retry semantics.** Steps 2–5 are idempotent because of `newsSeen`. If step 6
fails and the email is retried, no duplicate cards appear, and the converted
article's id `news-<messageId>` already prevents duplicate saves. A retry never
multiplies cards. Emails with no article links and no conversion do nothing
beyond filing.

### 3.2 Storage (`tableplan_states` row `mailai_<userId>`)

```
newsPending: [{ url, title, subtitle?, image?, publication: "nyt"|"economist"|"startribune",
                source: "The New York Times"|…, emailDate, discoveredAt }]
newsSeen:    { "<canonicalUrl>": "<firstSeenISO>" }
```

- `newsPending` is capped at the newest **300** entries, as `recipesPending` is.
- `newsSeen` is pruned to **120 days** on every write. If a paper re-promotes a
  4-month-old article, it may reappear; that's acceptable. Expected size is about
  100 URLs a day × 120 days ≈ 12k entries, roughly 1 MB. **If that's too big for the
  row, drop the window to 60 days** (decide at implementation after measuring real
  volume).
- Accept and dismiss both remove the card from `newsPending`. Neither touches
  `newsSeen`: a card that has been seen stays seen.

### 3.3 API (`gmail.js`, session-authenticated like today)

- `pendingNews` → `{ articles: newsPending }`
- `resolveNews { url, action: "accept"|"dismiss" }`
  - `accept`: `saveArticleToMediaSection` with `{ id: stableId("nl-", url), url,
    title, author: source, publication: <paper key>, savedAt, image, subtitle,
    text: null }` (link-only), then remove the card from `newsPending`.
  - `dismiss`: remove the card from `newsPending`.
  - Returns the updated list. The save happens first, then the removal, so a
    failed save leaves the card in place for another try.

### 3.4 Client

- **Shared `swipe-deck.js`** (new module, pure DOM helper): card deck markup +
  gesture (horizontal swipe to accept/dismiss, vertical to browse, tap to flip) +
  a button fallback. It is extracted from `mealplan-ui.js`, and the recipe deck
  switches to it with **no behavior change**. This is a shared-UI change, flagged
  per CLAUDE.md, and the recipe deck is regression-checked in the browser.
- **Media bell** (`mediaNotificationsBtn`): opens a panel shaped like the meal-plan
  one (list or swipe view). Front of the card: photo (or a fallback), title,
  subtitle, paper name. Back: subtitle/excerpt plus "Open ↗". The badge shows
  the pending count.
- **Fetch cadence:** `pendingNews` is read once when the Media page opens (for the
  badge) and again when the bell opens. **No polling.**
- **Accepted articles** show in Media → Publications under their paper. Tapping one
  **opens the original URL**, in the browser or publisher app where Luke is logged
  in. There is no in-app body extraction (paywalls).

### 3.5 Settings → Mail AI

Three new `MAIL_AI_FEATURES` entries, **off by default** (per CLAUDE.md):
`nytNewsLinks`, `economistNewsLinks`, `startribuneNewsLinks` — "Articles from
<paper> emails → Media notifications". The server checks each flag (explicit
`true` required). The existing `nytMorningToArticle` / `economistBriefToArticle`
toggles are unchanged. Their "default ON unless explicitly false" behavior
predates the CLAUDE.md rule; logged to ISSUES.md, not changed here.

### 3.6 Egress / cost

- No polling. Processing is triggered by Gmail push, as it already is.
- Per email: one read and one write of the `mailai` row, plus up to 40 head-only
  page fetches from Netlify. Those fetches are Netlify bandwidth, not Supabase
  egress.
- Client: one small read per Media open or bell open.
- Claude: no new calls for link extraction. The conversion cost depends on Q-A.

## 4. Acceptance criteria

1. An NYT email linking 12 articles yields ≤12 new cards (fewer if some were seen),
   then files to Apps/AI trash.
2. A second email linking 5 of the same articles plus 3 new ones yields exactly 3
   new cards.
3. A dismissed article linked again next week does **not** reappear.
4. A "The Morning" email produces both its listenable article (as today) **and**
   cards for its linked articles.
5. An NYT Cooking email produces recipe cards only, never news cards.
6. Right swipe → the article appears in Media → Publications under the right paper
   and opens its URL. Left swipe → it's gone. Both persist across reload and
   devices.
7. With a paper's toggle off, that paper's emails produce no cards.
8. The recipe swipe deck behaves exactly as before (browser-verified).
9. The standalone Publications page and its Home button are gone, and boot is clean
   (`npm run check:boot`, `npm test`).
10. The Media page and bell panel lay out correctly at 360 px.

Evidence required: unit tests on fixture emails (one each for NYT, Economist,
Strib, and NYT Cooking) for link extraction, canonicalization, dedup, and the
route order; a browser check of the bell and deck; and a real-email check after
deploy (confirm fixture patterns match live mail).

## 5. Removal — standalone Publications page

Luke confirmed: only Media → Publications should exist, and assume nothing was
saved through the RSS page.

- Remove: `homePublicationsBtn` + `#publicationsMainPage` + the `publications` route,
  the pub reader panel, the Manage dialog, `refreshFeed`/`refreshAllFeeds`, and the
  client wiring for `pubDefs`/`pubFeeds`/`pubArticles`/`articleNotifications` and
  the relational `publications`/`feeds`/`articles` access.
- Remove the modules and tests that become dead: `feed-parse.js`, `feed-ingest.js`,
  `publications*.js`, `fetch-feed.js`. Before deleting each one, **grep for other
  importers** (e.g. `publications.js` may be imported by the media reader) and keep
  anything still used.
- **Keep** the Supabase tables `publications` / `feeds` / `articles`. Dropping them
  is a gated prod DB change; logged to ISSUES.md.
- Stale state keys (`pubDefs`, …) are left in existing rows. They're harmless, and
  there's no migration or `STATE_SCHEMA_VERSION` bump.

## 6. Open question

**Q-A — which emails get the newsletter → article conversion?** Luke: "do all mail
from these publications… some of this will require more color of the newsletter
emails being extracted to be sent to media to listen to, which is good."

Proposed reading, to confirm:
- **Link extraction runs on all mail** from the three papers (per toggle).
- **Conversion runs on any real newsletter** from the three papers, not only
  "The Morning" and "World in Brief". A newsletter counts as real when its
  simplified text is ≥1,500 characters and it isn't a breaking-news alert or a
  marketing/account email (sender/subject heuristics). Short alerts and promos
  get links only, no article.
- Cost: one Haiku call per qualifying newsletter, maybe 3–10 a day across the three
  papers.
- Today, a too-short newsletter **throws and is retried** (`_gmail-shared.js:552`).
  With more emails converted, that must become "skip conversion, still file"; a
  hard failure retries only on a real error.

## 7. Plan (implementation order)

1. Pure server helpers + fixtures + tests: `extractNewsLinks`, canonicalize,
   per-source URL rules, `newsSeen` merge/prune, card building from email context.
2. Wire into `_gmail-shared.js`: new route order, `newsPending`/`newsSeen` write,
   always file to AI trash, no early return before conversion.
3. `gmail.js` `pendingNews` / `resolveNews`.
4. Mail AI toggles.
5. Extract `swipe-deck.js`; move the recipe deck onto it; browser regression check.
6. Media bell panel + badge; accepted articles open their URL.
7. Remove the standalone Publications page and the dead RSS code (§5).
8. `npm test`, `npm run check:boot`, 360 px pass, adversarial review, then a real-email
   check after deploy (deploy gated on Luke).
