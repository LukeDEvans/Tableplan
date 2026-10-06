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
