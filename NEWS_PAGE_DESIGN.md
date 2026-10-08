# News page — Design (Intent / Spec / Plan)

**Status:** decided 2026-10-06 (Luke, Q1–Q8 below). Builds on
[NEWS_INTAKE_DESIGN.md](NEWS_INTAKE_DESIGN.md), the email → article-card pipeline
shipped 2026-09-27. Proposal page with an interactive mockup:
https://claude.ai/artifact/LPkBhoL4mGeNmq9CW1WT4a (private to Luke).

## 1. Intent

A top-level **News** page, alongside Mail, Calendar and Finance, that compiles every
article linked in the newspapers Luke subscribes to into one paper, filtered by
section like a newspaper.

- Articles come from **email only** (the existing intake), not RSS.
- They land on **News** instead of the Media bell. The Media bell goes back to a
  placeholder that does nothing.
- Each article has a **⋯ menu**. **Send to Media** saves it to Media → Publications,
  as Mail's ⋯ → Send to Media does for an email.
- In Media's Playlist settings, the per-paper tiles become **one Publications tile**.
- **Sports** gets an ESPN-style scores build later (spec TBD). For now it is a
  section like the others, with room left for a scores strip.

## 2. Decisions (2026-10-06)

| # | Question | Decision |
|---|---|---|
| Q1 | What proves a subscription? | **A signed-in session** (subscriber cookie). §4. |
| Q1b | Star Tribune has no sign-in support | **Add a Star Tribune sign-in field.** |
| Q2 | Which papers? | **NYT, Economist, Star Tribune, The Athletic.** |
| Q3 | What leads the Front page? | **Newsletter leads**: the first article linked in each paper's main newsletter, then newest first. |
| Q4 | Newsletter briefings on News? | **Yes, on News and Media.** They keep going to Media as today. |
| Q5 | ⋯ menu | **Send to Media, Open, Listen, Share, Hide.** |
| Q6 | How long articles stay | **3 days.** |
| Q7 | Playlist Publications tile | **One tier for all papers.** Per-paper tiers collapse to the highest. |
| Q8 | Home position | **All Home buttons alphabetical**, so News lands between Media and Recreate. |

## 3. Layout

Same shell as Mail and Media: top bar (sidebar toggle, "Search news"), a **sidebar
directory**, content on the right. Coloring takes after Weather's hero moods.

- **Sidebar:** Front page · Briefings · Sent to Media · *Sections* (each with a color
  dot and unread count) · *Papers* (one filter per paper; a paper whose sign-in
  lapsed shows "Sign in again").
- **Section colors:** each section owns a two-stop gradient with light and dark
  values, like `--wx-sky1/2`. Shown on the lead card, as a band on each story card,
  and as the sidebar dot.
- **Content:** a large gradient lead card for the selected view, then story cards
  in a responsive grid (one column at 360 px). The Front page also shows a
  Briefings strip.
- **Phone:** the sidebar is hidden and opens as an overlay from the menu button,
  as in Mail and Media.

Sections (one shared list; empty sections are hidden, anything unmapped → **More**):
Front page, World, U.S., Politics, Minnesota, Business, Science & Health, Opinion,
Culture, Sports, More. Mapping:

| Section | NYT (URL path after date) | Economist (URL section) | Star Tribune (`article:section`) | Athletic |
|---|---|---|---|---|
| World | `world` | europe, asia, china, middle-east-and-africa, the-americas, international, britain | World | |
| U.S. | `us` (not politics) | united-states | Nation | |
| Politics | `us/politics`, `upshot` | | Politics | |
| Minnesota | | | Local, Minneapolis, St. Paul, Minnesota | |
| Business | `business`, `technology`, `realestate`, `your-money` | business, finance-and-economics | Business | |
| Science & Health | `science`, `health`, `climate`, `well` | science-and-technology | Health, Science | |
| Opinion | `opinion` | leaders, letters, by-invitation | Opinion | |
| Culture | `arts`, `books`, `movies`, `style`, `t-magazine`, `theater`, `travel`, `dining` | culture | Variety, Arts, Food | |
| Sports | `sports` | | Sports | everything |

The Star Tribune labels are **inferred** and must be checked against live mail
(the meta tag is newly captured; unknown labels fall to More, never dropped).

## 4. Subscription gate (Q1)

**Observed in code (2026-10-06):** subscriber cookies live in the personal media
section (`u-<user>` → `media.articleSync`: `nytCookie`, `economistCookie`). Today
they are used **only** by `sync-saved-articles.js` to pull each paper's saved list.
`fetch-article.js` does **not** send them, so the Media reader does not load
paywalled text through the sign-in. (The proposal page said it did; that was wrong.)

So "signed in" is checked with the saved-list pages the sync already uses:

- **NYT** (`/saved`, existing logged-out markers) and **Economist**
  (`/for-you/bookmarks`; logged out = redirected to a login page or a login marker
  in the page). The Athletic follows the **NYT** sign-in (an NYT product; *to
  verify* against a real Athletic email).
- **Star Tribune:** a new `stribCookie` field. No known check page yet, so a saved
  Star Tribune sign-in counts as signed in but is shown as **unverified**.
- **Status row** `mailnewssubs_<user>` (service-role only, like the other news
  rows): `{ papers: { nyt: { status, checkedAt }, … } }` with status
  `signed-in | unverified | expired | none`.
- **When checked:** when a sign-in is saved or cleared in Settings, and when News
  opens if the last check is over 24 h old. Never on a timer. A network error keeps
  the previous status; only an explicit logged-out answer marks it **expired**.
- **iPhone app (2026-10-07):** the reader signs in to each paper inside the app
  (Sync Settings → Sign in; `ArticleReaderPlugin` login sheet), and the phone works
  out the status itself (`news-device-signin.js`): the paper's session cookie is
  present (`NYT-S`, `blaize_session`; the plugin returns cookie **names** only), or,
  without it, the same subscriber page loads without landing on a login page. Star
  Tribune is **unverified** once its sheet has been used. The app sends
  `verifyNewsSignIns { deviceStatus: { nyt, economist, startribune } }`: a status,
  never a cookie. The server (`verifySignIns`) counts a paper as signed in when
  either the pasted cookie or the phone says so; a phone-reported entry carries
  `via: "device"` and `deviceAt`, and a call that says nothing about a paper (a
  browser saving another paper's cookie) leaves it alone. A phone that was signed in
  and now isn't reads **expired**. Checked when a sheet closes, on Sign out, and when
  News opens with a phone report over 24 h old (at most once per 6 h per app run).
  The server takes the phone's word (ISSUES.md).
- **Banner:** the Front page prompt shows whenever no paper is signed in, including
  when nothing has ever been checked (it used to hide for "unknown", which is the
  permanent state of a device with no sign-in saved).
- **Gate:** the mail sweep collects a paper's links only if its Mail AI toggle is on
  **and** its status is `signed-in` or `unverified`. It reads the tiny status row once
  per sweep. A paper that lapses stops adding articles; what's on News stays until it
  ages out.

## 5. Server

- `_news-links.js`
  - `FRESH_DAYS` 7 → **3** (Q6). Pending cards prune at the same age. Seen record stays 30 days.
  - `parseArticleMeta` also captures `article:section`.
  - `sectionFor(url, meta, paper)` (pure) per §3; each card carries `section`.
  - **The Athletic** source: sender `theathletic.com` or display name "The Athletic";
    links `nytimes.com/athletic/…` and `theathletic.com/…`. NYT emails that link
    Athletic articles produce cards with `paper: "athletic"`. New Mail AI toggle
    `athleticNewsLinks`, on by default like the other papers (Luke, 2026-09-29;
    the sign-in gate still applies). Athletic newsletters are also converted into
    listenable briefings by the existing generic path (Haiku, ~1–3/day). Athletic
    links inside ordinary NYT emails are not collected (one source per email).
  - **Lead flag (Q3):** in a *main newsletter* email (one the briefing conversion
    accepts, or a long non-alert Athletic newsletter), the first article in document
    order gets `lead: <ISO>`. If that article is already on News, the merge marks the
    existing card instead.
  - Cards gain `readAt` and `sentAt`; Hide removes the card.
- `gmail.js` actions (session-authenticated, like the existing ones):
  - `newsFeed` → `{ articles, signIns }`.
  - `updateNews { decisions: [{ id, decision: send|hide|read|unread }] }`, batched by
    the client. `send` saves to Media → Publications (the existing accepted-article
    record) and sets `sentAt`; the card stays on News showing "In Media".
  - `verifyNewsSignIns` → runs §4 checks, writes the status row, returns `signIns`.
  - `pendingNews` / `resolveNews` stay for older cached clients.
- No polling, no new scheduled job, no AI calls, no DB migration, no
  `STATE_SCHEMA_VERSION` bump.

## 6. Client

- New module **`news-ui.js`** — `createNewsModule(deps)`. `app.js` keeps only
  `showNewsApp`, the Home/menu buttons, the `"news"` area and the module wiring
  (factory instantiated with deferred-thunk deps, per the boot-safety guard).
- **Feed** read on page open (at most once a minute) and on the refresh button.
  Read/Send/Hide are queued and flushed as one `updateNews` call (1.5 s idle, on
  leaving the page, on `visibilitychange`).
- **Briefings** come from client state: `state.savedArticles` with id `news-*`
  saved in the last 3 days. No server change.
- **⋯ menu:** Send to Media (optimistic local add, same id as the server's copy),
  Open (adds to Media if needed and opens the Media reader), Listen (adds and
  starts the article's text-to-speech), Share (native share sheet, else copy link),
  Hide.
- **Home:** every Home button in alphabetical order.

## 7. Media changes

- The Media bell (`mediaNotificationsBtn`) returns to a do-nothing placeholder.
  `news-notif-ui.js` and its test are removed; `swipe-deck.js` stays (recipe deck).
- The Playlist tier board shows one **Publications** tile. Stored as
  `publicationTiers = { all: n }`; per-paper keys are collapsed to the highest tier
  on first open and ignored by the playlist once `all` is set.
- Settings → sync: a **Star Tribune** sign-in field next to NYT and Economist.

## 8. Plan

1. **Server:** sections, Athletic, lead flag, 3-day retention, feed actions, sign-in
   status + gate. Fixture tests per paper.
2. **News page:** `news-ui.js`, nav area, Home alphabetical, 360 px.
3. **Media:** bell placeholder, remove `news-notif-ui.js`, Publications tile,
   Star Tribune sign-in.
4. **Sports scores:** spec first.

Each phase: `npm test`, `npm run check:boot`, browser check. Deploy gated on Luke.

## 9. Acceptance

1. A NYT email with 12 article links → ≤12 cards on News, each with a section; no
   card older than 3 days ever appears.
2. With the NYT sign-in expired, NYT emails add nothing; the sidebar shows "Sign in again".
3. The Morning's first linked story is the Front page lead.
4. Send to Media → the article is in Media → Publications under its paper and the
   card shows "In Media" on every device. Hide → gone and never back.
5. The Media bell does nothing. The Playlist board has one Publications tile.
6. Home buttons are alphabetical; News opens; layout fits at 360 px; boot is clean.

## 10. Expanded intake: every section via RSS (Luke, 2026-10-06)

News is now a major part of the app, so it takes **every section of all four papers**,
not only articles linked in emails. Email intake keeps running alongside (it supplies
newsletter leads and briefings). A personalized feed (ranking by your interests) is
the next step; this section only widens the intake.

**Storage moved to a table** — `news_articles` (`migrations/2026-10-06-news-articles.sql`,
service-role only, PK `user_id, id`). Kept in the old `mailnews_<user>` JSONB row,
~1,000 live stories would have meant downloading the whole list on every open and
rewriting it on every tap (~1 GB/month of Supabase egress). As rows:

| Path | Cost |
|---|---|
| Hourly feed job | ignore-duplicate insert, `return=minimal` (no response body) |
| Open a view | one page (≤150) of the shown columns + one `news_counts` RPC |
| Read / send / hide | PATCH of just those rows, batched |
| Prune | one DELETE per hour of rows past 4 days (hidden tombstones included) |

Estimated well under 100 MB/month. `mailnews_` rows are no longer written; the
migration imports their cards once. `mailnewsseen_` (email dedup) and `mailnewssubs_`
(sign-in status) are unchanged.

**Feed job** — `netlify/functions/news-feeds.js`, hourly at :07 (netlify.toml).
`_news-feeds.js` lists every section feed (NYT `rss.nytimes.com/…/<Section>.xml`, The
Economist `/<section>/rss.xml`, the Star Tribune's Arc XP and legacy feeds, The
Athletic `/athletic/rss/<league>/`), fetches only the papers some user is signed in
to (16 at a time, 6 s timeout), de-duplicates across feeds (a section copy beats
HomePage), keeps only fresh article URLs, and inserts per user for that user's
signed-in papers. RSS is gated by sign-in only, not by the Mail AI email toggles.

**Unverified:** the feed URLs couldn't be fetched from the build environment
(egress-blocked). Each run writes `newsfeeds_status` (`tableplan_states`) with every
feed's HTTP status, item count and accepted-card count. After the first deploy, read
that row and remove dead URLs. The Star Tribune is the least certain.

**Client** — each view loads its own page from the server (`newsFeed { view, before,
q }`), counts come from the server, "Load more" pages on, search is server-side.
