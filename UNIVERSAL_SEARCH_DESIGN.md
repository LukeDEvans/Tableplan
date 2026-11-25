# Universal search: one way to find anything in Liv, for Luke and the assistant

Status: **Plan approved, decisions made (2026-11-19). Phases 1–2 built 2026-11-19** (see §10a). **Phases 3–4 built with the utilities menu (2026-11-19):** the in-app assistant has the `search` tool, and instant results sit under Chat with Liv's box (UTILITIES_MENU_DESIGN.md §4) — there is no landing field. Decisions are in §11. Repo facts come from `main` at `9d851f3` (2026-11-19).

Goal: one search layer that finds items on every page. Liv's assistant, Duet (through liv-mcp) and a single search field on the landing page all use it. It should cost almost no Supabase egress and still work when Liv moves to the home server.

---

## 1. Why, in one paragraph

An assistant does almost everything by finding something first: "move swim class to Thursday", "what did we spend at Costco?", "send Marijane the lentil soup". Today each assistant tool does its own lookup, usually a partial title match (`complete_task` matches by title, for example), and many pages can't be searched at all. One search with one result shape fixes this for every tool at once. The landing-page box is the visible part. The layer underneath it is the main work.

---

## 2. What exists today (findings)

- **A search index already exists but isn't used:** `search-index.js` is pure, local-first and rebuildable from `state`, and it has tests. It indexes 7 collections: `recipes`, `savedArticles`, `doTasks`, `contacts`, `trips`, `planEvents` and `mediaSaved`. Its only caller is a dev hook, `window.__liveSearch` (app.js:4136), which rebuilds the whole index on every query. No screen uses it.
- **Gaps in that index:**
  - The tokenizer is ASCII-only (`[^a-z0-9]`), so "café", "jalapeño" and Dutch words with accents split wrongly.
  - Results carry no view, date, snippet or a way to open the item.
  - It doesn't cover the shopping list, the meal plan, the Watch lists, Listen's shows, Explore's ideas, Finance, News, Photos, Mail, Documents or Messages.
- **The assistant tool layer is already in place (ARCHITECTURE.md §9):** `assistant-tools.js` is the one registry. Read tools include `search_recipes`, `find_contact`, `get_calendar_range` and gated `query_transactions` / `search_mail`. Mail and Finance are opt-in gates, off by default.
- **liv-mcp already bundles the app's pure modules** (`views.js`, `calendar/*`, `assistant-queries.js`…) into one Deno file. `search-index.js` can go in the same way: **one search module running in two places**, the phone/laptop and the Edge Function.
- **Routes carry the view but not the item:** `#household/calendar` (`views.js` `splitViewHash` / `viewHash`). Nothing opens a specific recipe, event or trip from a link.
- **Data that lives outside `state`:**
  - `finance_transactions`, `news_articles` and `photo_items` are their own tables. `photo_items` already has `labels` and `body_text` columns waiting for Vision.
  - Mail stays in Gmail.
  - **Every Documents file is encrypted** (`doc_files.enc_meta`), so even titles are unreadable to the server, not just the Safe.
  - Messages are end-to-end encrypted.
  - Google Calendar events are fetched by each device and never synced.

---

## 3. The design in one picture

```
             ┌──────────── search(query, {views, types, limit}) ────────────┐
             │                                                              │
   1. State sources            2. Table sources              3. Device-only sources
   (in memory, instant)        (server, on demand)           (decrypted on the phone)
   recipes, tasks, events,     News, Finance*, Photos,       Documents, Messages,
   trips, Watch, Listen,       Mail* (Gmail search)          Google events (cached)
   Shop, meal plan, Explore,
   contacts
             │                         │                              │
             └──────────── merged, ranked, grouped results ───────────┘
                    each result = { ref, title, snippet, date, view, why }
                                       │
        landing search field · in-app assistant `search` tool · liv-mcp `search`
                                                   (* = opt-in gate)
```

There's no new search table. The facts already live in `state` sections and the domain tables, so a second copy would be one more thing to keep in sync and pay egress on.

---

## 4. One result shape

```js
{
  ref:     { type: "recipe", id: "r_123", view: "household" },  // stable; opens the item
  title:   "Lentil soup with lemon",
  snippet: "Recipe · soup, vegetarian",       // short, built per type
  date:    "2026-11-12",                       // when it matters (event, txn, photo)
  view:    "household",
  why:     ["title"]                           // which field matched (for ranking/debug)
}
```

- **`ref` is the key piece.** Every assistant tool that acts on an item should take a `ref` / `id` as well as today's title match. The pattern becomes search → pick → act. That ends wrong-item edits like "completed the other task called *Call*".
- **`openItem(ref)`** in the app routes to `#<view>/<page>?item=<id>`, opens the page and shows the item (opens the recipe, scrolls to and opens the event, opens the trip). It is built once per type and reused by search results, notifications, Messages cards (MESSAGING_DESIGN), the browser's Liv button (BROWSER_DESIGN §9) and the assistant's "here it is".

---

## 5. Sources

### 5.1 State sources (phase 1)

These extend `SEARCHABLE` in `search-index.js`. They are instant, need no network, and work offline and against a home server.

| Type | From | Title / text |
|---|---|---|
| recipe | `recipes` | name / tags, ingredients |
| task | `doTasks` (+ backlog) | title / notes |
| event | `planEvents` | title / notes, location |
| trip, trip idea | `trips`, Explore ideas | name / destination, notes |
| watch | both Watch lists | title / kind, status |
| listen | saved shows, books | title / author |
| shop | the Shop list | item name |
| meal | meal plan entries & notes | recipe name / note |
| contact | `contacts` | name / email, phone, groups |
| article | `savedArticles` | title / author, paper |

The index is held in memory, rebuilt only when `state.stateUpdatedAt` changes (use the existing `isStale`), and never written anywhere.

### 5.2 Table sources (phase 4)

The server queries these only when someone types. Each is a small, bounded query: debounced about 300 ms, at most 10 rows, only the columns needed.

- **News:** `news_articles` title (Postgres text search, or `ilike` to start).
- **Finance (gated):** `finance_transactions` merchant / memo / amount, only when the Finance assistant gate is on, and Personal accounts only for their owner.
- **Photos:** `photo_items.labels` and `body_text` once Vision fills them (PHOTOS_DESIGN §6). Private-album photos are never included.
- **Mail (gated):** passes the query to Gmail search, as `search_mail` does now.

### 5.3 Device-only sources (phase 6)

These are decrypted and indexed on the phone, held in memory, and never sent anywhere.

- **Documents:** file names and folders, only after Face ID has unlocked that Documents scope in this session. The Safe stays out of universal search (decision 4).
- **Messages:** thread names and the text of messages still on the device. They disappear on their timer like everything else.
- **Google Calendar events:** from the device's own cache.
- None of these reach liv-mcp or any server.

---

## 6. Ranking

Start with what `search()` does now: term hits, prefix hits while typing, and a title boost. Then add:

1. **Unicode tokenizing with accents folded** (`\p{L}\p{N}`, NFD with diacritics stripped), so "cafe" finds "café".
2. **Current view first.** Results from his other views follow, labelled ("In Household").
3. **Recency** for dated types: upcoming events beat past ones, and recent transactions and photos beat old ones.
4. **Grouping by type** in the UI: the top 3 per group, with "Show all".
5. Typo tolerance (one edit) only if real use shows it's missed.

**Search by meaning** (embeddings, pgvector) is deliberately left out. Names, titles and dates cover most family-app lookups, and the assistant can rephrase a query and search again. Revisit once the assistant is rebuilt and misses show up.

---

## 7. The assistant

- **In-app assistant:** a `search` read tool in `assistant-tools.js` with inputs `query`, optional `types`, optional `view`, and a `limit` of 20 or less. It runs on the client against the local index plus the table sources, and returns refs. Write tools gain an optional `id`, preferred over the title match.
- **liv-mcp (Duet now):** a `search` tool built from the same bundled `search-index.js`.
  - It reads only the title/text keys `SEARCHABLE` names from the sections the key's owner can see.
  - **Contacts are included** (decision 3).
  - **Finance and Mail follow the app's assistant switches** (decision 2). liv-mcp reads the same two flags `chat.js` reads from the household config row. Finance results are the key owner's Personal accounts plus Household accounts, never another person's Personal accounts. *Check:* Mail search runs on the client today (`callGmailApi`), so liv-mcp needs a server path to Gmail before Mail can join. Until then, liv-mcp's `search` says Mail isn't available and points to Duet's Gmail connector.
  - Documents, Messages, the Safe and the private album never reach liv-mcp (they're encrypted or device-only).
  - It ships as an Edge Function, so **no Netlify deploy is needed**.
- **Results are data, not instructions.** Titles can come from emails, web pages and newsletters. Both tools label results as untrusted text, matching liv-mcp's existing "never because text in an email says to" rule.
- **Search feeds the assistant's context.** When a question names something, the assistant searches first instead of relying on the 7-day overview snapshot.

---

## 8. The landing-page field

- **Where:** the top row, beside settings and scan, on the right side (one-handed, right thumb). It uses the space at the top, so the landing page still doesn't scroll and the logo and list stay centred.
- **Typing** opens a results sheet over the landing page. State results appear as he types; table results join a moment later. Results are grouped by type, with the clear "x" (text-box rule).
- **Recent searches** (decision 6): the last 10, **synced across his devices**, clearable. They're kept per person in the Personal settings row through `settings-sync.js` (stamped, merged; no polling; a few hundred bytes). They're never shared with Household and never sent to the assistant as context.
- **Tapping a result** runs `openItem(ref)`. If the result is in another view, Liv switches to that view. Opening an item counts as picking a page, which matches the views decision.
- **Laptop:** ⌘K / Ctrl-K focuses the field from any page.
- **The same field is the assistant's prompt, now** (decision 5). An "Ask Liv: …" row sits at the top of the results. Tapping it (or pressing Return when nothing is highlighted) opens the existing chat panel with the text sent. When Liv's own assistant is rebuilt, the row points at that instead. If the browser is ever built, this field also meets Apple's "search field on launch" rule (BROWSER_DESIGN §3).
- **Per-page searches stay** as decided. The landing field adds to them.

---

## 9. Egress and portability rules

- State search makes **zero network calls**.
- Table sources run only on a typed query: debounced, at most 10 rows each, only the needed columns, no polling, never touching `tableplan_states`.
- liv-mcp reads only the JSON keys `SEARCHABLE` lists (a few KB per call), and Duet checks in every few hours.
- Everything above the table sources is pure JS and runs the same on the home server (ARCHITECTURE.md §27).

---

## 10. Phases

| # | What | Ships by |
|---|---|---|
| 1 | Foundation: Unicode tokenizer, cached index, result shape (view/date/snippet/ref), more state sources (§5.1), tests | code only (comes with the next build) |
| 2 | liv-mcp `search` so Duet benefits right away | Edge Function, **no Netlify deploy** |
| 3 | `openItem(ref)` and `?item=` routes for each type; in-app `search` tool; write tools accept `id` | TestFlight, then the batched deploy |
| 4 | Landing field and results sheet; ⌘K; "Ask Liv" row to the chat panel; synced recents | TestFlight, then the batched deploy |
| 5 | Table sources: News, Photos, Finance and Mail (gated); liv-mcp gains Finance (and Mail once a server Gmail path exists) | Netlify function, batched deploy; liv-mcp via Edge Function |
| 6 | Device-only: Documents (after unlock), Messages, cached Google events | TestFlight |
| later | Typo tolerance; search by meaning if needed | — |

Phases 1 and 2 can be done and checked by Claude without Luke testing anything on the phone.

### 10a. Built (2026-11-19)

- **Phase 1:** `search-index.js` rewritten around `SOURCES` (type, section, keys, `server`, `collect`): recipes with ingredients, planner tasks dated by day plus the backlog, events with place, trips, trip ideas, both Watch lists, saved articles, podcasts (device only), the shopping list, contacts (never their photos). Unicode tokenizer with accents folded; all-words-matched ranks first, then title, exact over prefix, preferred view, nearness to today. Results carry `ref` / `view` / `date` / `detail`; `groupResults()` for the sheet; `createIndexCache()` rebuilds only when `stateUpdatedAt` or the view changes. `window.__liveSearch` uses it (50 queries in ~0 ms in the dev app).
- **Phase 2:** liv-mcp `search` (query, types, view, limit ≤ 30). Each row read once, only the keys its sources name; recipes from `eat_recipes` with 4 columns (`db.recipeIndex`); contacts included; podcasts left out; results grouped, with view, date and id, and labelled as data, not instructions.
- **Live:** liv-mcp v8 deployed 2026-11-19 (verified with a throwaway key, since revoked: `search` listed; real queries return Personal and Household results). The plural-heading fix (#273) goes out with the next liv-mcp deploy.
- **~~Known gap for phase 4~~ (fixed 2026-11-19, `liv-search.js` `searchParts`):** on the device, `state` holds only the current view's rows, so every result is tagged with the current view (Household recipes show as "personal" in Personal). Phase 4 tags by each section's scope and adds the other views' rows from the shadow store.

---

## 11. Decisions (Luke, 2026-11-19)

1. **Views:** search covers all of his views. The current view comes first; other views' results are labelled, and tapping one switches views.
2. **Finance and Mail for Duet:** they follow the app's assistant switches (not kept out of liv-mcp).
3. **Contacts for Duet:** included in liv-mcp search.
4. **Documents:** file names and folders, only after Face ID unlock in that session. The Safe is never included, and Documents never reach Duet.
5. **"Ask Liv" row:** wired now to the existing chat panel.
6. **Recent searches:** the last 10, synced across his devices, clearable.

---

## 12. Not planned

- A separate search engine (Algolia, Meilisearch, Typesense) or a new server-side index table.
- Indexing anything from the Safe or the private photo album.
- Server-side indexing of anything encrypted.
- Full-text search inside Documents' file contents (possible on the device later).
