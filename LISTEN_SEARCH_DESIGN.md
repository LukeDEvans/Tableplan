# Listen: one search bar, best result first, full artist pages — design & as built

Status: **Built on branch `claude/listen-one-search` (2026-11-20). Asked for by Luke, 2026-11-20.** Ships with a TestFlight build; the laptop web app follows in the next batched Netlify deploy. No database change, no Swift change, no `STATE_SCHEMA_VERSION` bump.

## 1. The problem (confirmed in code)

- **Two search bars.** Listen's top bar ("Search Listen") only filtered saved podcast episodes and books; music needed an extra tap on "Find podcasts, music and radio". The Apple Music search ("Artists, songs, albums, playlists") was a second bar inside Music → Discover.
- **Fixed order.** Apple Music `search()` returned songs, then albums, artists, playlists, so "Olivia Rodrigo" put her artist page after 25 songs and 25 albums.
- **Short artist pages.** An artist page fetched only `view/top-songs` (20), so Mumford & Sons showed only their most popular songs.

## 2. Decisions (Luke, 2026-11-20)

1. One search bar at the top of Listen; it searches everything as you type.
2. Music results come before your own podcasts and books, on every tab.
3. A **Best result** sits above everything: what you most likely meant, not a fixed type order.
4. Artist pages give access to **all** of the artist's music, loading more as you scroll.

## 3. As built

### 3.1 One bar
- `#mediaSearchInput` → `runListenSearch(q)` (debounced 380 ms like Discover; Enter searches at once). While it holds text, `listenSearchActive` is true and the **Music panel** shows the search whatever tab is open (`.is-listen-search` hides Music's tab strip and its own bar). Its body renders through `listenSearchBodyHtml` → the existing `discoverResultsHtml`, so every result, open, play, favourite and add-to-playlist works as in Music.
- Under the results, `#listenSearchExtra` (drawn only when the query changes, so playback re-renders don't wipe it): **Your podcasts & books** (`listenLibraryMatches`), then **Find podcasts and radio** (`LISTEN_FIND_TYPES`; music is no longer in that row because it's above).
- Clearing the bar (or picking a sidebar tab) → `endListenSearch()` → back to the tab you were on.
- Music › Discover has **no** search bar; Saved, Library and playlists keep theirs as a filter of the list on screen. "Search all music for …" and a favourite work (`searchAllMusic`) fill the top bar.
- While searching, the results and the library section scroll as one page.

### 3.2 Best result
- The catalog search sends `with: "topResults"`; the provider marks Apple's first top hit `bestMatch: true` (adding it if it isn't among the typed results). The list order is unchanged.
- `music-search-best.js` `pickBestMusicResult`: the marked item, else an artist named like the query (case, accents, "&"/"and", a leading "The" ignored), else an album with that name, else the first song.
- `musicBestResultHtml`: one large card (round art for an artist) with **Play** (a song plays; an artist plays its top songs; an album plays). Tapping the card opens an artist or album, or plays a song. The best item isn't repeated below. Order below: Songs, Works (classical), Artists, Albums, Playlists.

### 3.3 Artist pages
- `getItem` for an artist also loads `view/full-albums` and `view/singles` (25 each, each call isolated) and returns `artistPage`.
- `musicArtistPageHtml`: **Top songs** (5, "See all" for the 20, ▶ Play), **Albums** and **Singles & EPs** as card rows ending in **More** while Apple has a `next` page, then **All songs**.
- **All songs** (`getArtistMore("songs")`): the next 10 of the artist's albums (`/artists/{id}/albums`), their tracks in one request (`/albums?ids=…&include=tracks`), newest album first within the page, only tracks credited to the artist, merged without repeats (`mergeArtistSongs`: ISRC, else title + artist). It loads when its button nears the screen (one `IntersectionObserver`, re-pointed after each redraw); the button also works by tap. After a failed page it stops loading by itself and shows **Try again**.
- Playing a song from All songs queues the rest of the loaded list; from Top songs, the rest of the top songs.
- Back walks `musicOpenStack`: an album opened from an artist page returns to the artist page, then to the results. A page still loading never goes on the stack.
- All Apple calls go from the device through MusicKit: no Supabase or Netlify traffic. Loaded pages stay in `musicItemCache` for the session.

## 4. Checks

- `test/music-search-best.test.js` (17): best pick and fallbacks, name matching, merge without repeats, `next` link parsing, the provider's `topResults` marking, artist page loading, isolated failures, album paging, All songs (order, the artist's own songs only, music videos left out), bad links.
- `test/music-playback-races.test.js` (+1): Back never returns to a half-loaded page.
- `npm run qa:listen-search` (headless Chrome at 390, 360 and 1280 px, Apple Music faked in the page): Best result first and not repeated; the order below; Music's bars hidden while searching; your podcasts & books and the Find row; artist page Top songs / See all / albums More / singles; All songs to the last song with a repeat shown once; a failed page stops and Try again resumes; Back from album → artist → results; clearing returns to Podcasts; Discover has no bar, Saved keeps its filter; "Search all music" fills the top bar; no sideways scroll; no page errors.
- Full suite, `npm run check:boot`, `qa:listen-grid`, `qa:listen-queue`, `qa:music-shows`.
- **Not verified:** the real Apple Music API (`results.top`, the artist views) and the iPhone build — see ISSUES.md.
