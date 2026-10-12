# Media split — News reads, Watch stands alone, Listen is audio

Status: **APPROVED DIRECTION** (Luke, 2026-10-12). Built in phases (below).

## Why

Opening a News story sent you to Media → Publications, and Back left you there.
News now covers what Publications was for. Luke's direction:

- Saved articles **and the reader** live in the **News** page, not Media.
- **Watch** becomes its own page again.
- What's left in Media is audio, so Media is renamed **Listen**.

## Decisions (Luke, 2026-10-12)

1. **Books stays in Listen** for now (used mostly for audiobooks). How to organize
   non-audio books is future work; don't move Kindle/Libby out yet.
2. **"Return to where I came from" is a general rule**, not a per-button patch.
   Closing the reader goes back to the page (and tab, and scroll position) that
   opened it — News, Listen's queue, the now-playing bar on any page, search.
3. **Storage doesn't move.** Articles, books, podcasts and music stay in the
   `media` state section; Watch keeps its `watch` section. Only pages move.
4. **Watch gets its own page**, on the **landing page** and in the **page menu**.
5. **Search is split per page**: Listen searches audio, News searches articles,
   Watch searches films and shows.
6. **Visible names change, internal keys don't.** The page-access key stays
   `read`, `#media` / `#read` / `#listen` all still open Listen,
   `activeAppArea` stays `"media"`. Renaming synced keys risks settings
   reverting on other devices.
7. **Article intake lands in News**, next to **Briefings** and **Sent to Media**:
   the Chrome extension, Add-by-URL, Scan and PDF import.

## Phases

1. **Return to origin.** `openArticleFrom(id, origin)` records where the reader
   was opened from (`area`, `mediaTab`, scroll positions); `closeArticleReader()`
   navigates back and restores them. Pure helpers in `reader-return.js`.
2. **Watch page.** `showWatchApp` shows `#watchMainPage` (the Watch panel moved
   out of Media), `activeAppArea = "watch"`. Home + page-menu buttons unhidden.
   Media's Watch sidebar tab removed. `#watch` link and every existing
   `showWatchApp` caller keep working.
3. **Articles + reader in News.** The reader panel and the saved-article list
   move into the News page. Media's Publications tab and its per-paper sub-tabs
   go. Every article open (Listen queue, now-playing bar, search, scan,
   Send/Open/Listen in News) opens the reader in News, with Phase 1's return.
4. **Listen.** Page title, page menu and labels say Listen. Media's top-bar
   search covers audio only; News search also finds saved articles.

## Out of scope

- Moving any stored data between state sections.
- Non-audio books (Kindle/Libby) — Luke will decide later.
- The Playlist tiers' Publications tile stays: it orders articles in the listen
  queue, which still holds articles read aloud.
