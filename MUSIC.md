# Music architecture (Media → Music tab)

The Music tab is **tabs over shared systems, one playback engine**. Tab order: **Discover** (the default when Music opens) · **Saved** · **Library** · one tab per **playlist** · **+** (new playlist, inline — same pattern as Podcasts). One **search bar sits under the tabs on every tab**: on Discover it searches the catalog; on Saved / Library / a playlist it filters what you already have, with a "Search all music for …" row that jumps to a Discover search.

| Tab | What it is | Modules | Data |
|---|---|---|---|
| **Discover** | Apple Music / Spotify-style home: greeting → hero shelf (top playlists) → *Jump back in* → for-you / recently played / ranked top songs / top albums → **Browse categories** (genre + mood tiles → a category page of shelves). Search results: **Apple Music first**, then free/open providers, **consolidated under canonical Works** | `music-discover.js`, `music-streaming.js`, `music-provider-*.js`, `music-canonical.js` | nothing stored — metadata only, streamed from source; shelves cached in memory 30 min |
| **Saved** | Your personal library — favourites (songs/albums/Works) + playlists + recently played, all **canonical & provider-independent**; plus **CSV export/import** | `music-canonical.js`, `music-library-model.js`, `music-portable.js` | `state.musicLibrary` (`media` section — synced like the rest of state) |
| **Playlist tabs** | One tab per playlist: play / shuffle / reorder / rename / delete; the search bar filters the entries | `music-library-model.js` | `state.musicLibrary.playlists` |
| **Library** | Music you *own* — local uploads + a Jellyfin server | `music-library.js`, `music-tags.js`, `music-jellyfin.js` | audio **bytes** in IndexedDB / Jellyfin |

Playback of a saved Recording goes through `music-source-resolver.js` (provider fallback). See §11–13 below.

Both reduce every playable to the same shape and hand it to the **one shared engine** (`playback-engine.js` via `mediaEngine` in `app.js`), so a local file, a Jellyfin track, and an Internet Archive recording all play through the same element, mini-player, lock-screen controls, and queue — and keep playing as you navigate the app.

`app.js` is the only file that touches the DOM; every module below is pure/DOM-free and unit-tested.

---

## 1. Domain model (`music-streaming.js`)

Provider-independent, normalized types. **The UI never sees a provider's raw JSON.**

- **`CanonicalTrack`** — `{ title, artists[], composer, work{title,catalog}, movement, album, trackNo, durationMs, artworkUrl, provider, providerRefs[], license, playable }`
- **`CanonicalAlbum`** — a collection/release/work; search usually returns these, and expanding one (`getItem`) yields its tracks.
- **`ProviderRef`** — `{ provider, externalId, url, collection }`. **Provider ids are never the canonical id**; an item may gather several refs so "these are the same recording" can be learned later (no entity resolution yet — the seam is `dedupeMusicItems` in `app.js`).
- **`License`** — `{ type, url, isPublicDomain, attribution, restrictions[] }`. First-class: accessible metadata never implies a right to redistribute.
- **`PlayableSource`** — `{ provider, url, mimeType, container, streamable }`. We **stream from the authorized source; audio is never re-hosted or auto-downloaded.**
- **`Contributor`** — `{ name, role }` (composer / performer / ensemble / artist).

### Classical vs. modern
The model preserves **Composer → Work → Movement → Recording** (`composer`, `work`, `movement` on a track) *and* works for plain **Artist → Album → Track**. This aligns with the Cadence score domain (`music/domain.js`: `makeWork`/`makeMovement`/`makeRecording`) so a future score-following/practice system can reference the same Work — reconcile via `providerRefs`, don't build a competing store.

---

## 2. Provider interface (`MusicProvider`)

A provider is a plain object:

```
{
  id, label,
  capabilities: Set<CAP>,          // advertise the subset you support
  isAvailable(): Promise<bool>,    // cheap gate; failures also caught per-call
  search(query, {limit,page,signal}): Promise<CanonicalTrack|Album[]>,
  getItem(albumOrRef, {signal}): Promise<{ album, tracks[] }>,  // if GET_ITEM
  getPlayable(track): Promise<PlayableSource>,                  // if PLAYABLE
}
```

`CAP` = `SEARCH, BROWSE, GET_ITEM, PLAYABLE, ARTWORK, LICENSE, PAGINATION, RECOMMEND, OWNS_PLAYBACK, AUTH`.

### 2a. Playback-owning providers (`CAP.OWNS_PLAYBACK` + `CAP.AUTH`)
Most providers resolve a track to a **URL** (`getPlayable`) that the shared engine
plays. A DRM streamer whose SDK never hands out a URL (Apple Music/MusicKit,
later Spotify) instead **owns its own transport**. Such a provider advertises
`CAP.OWNS_PLAYBACK` (+ `CAP.AUTH`) and implements the lowest-common-denominator
**Transport contract** documented in `music-streaming.js` *instead of* `PLAYABLE`:
`play/pause/resume/seek(ms)/skipNext/skipPrevious`, `get/setQueue`,
`getNowPlaying()`→`makeNowPlaying` (normalized `PLAYBACK_STATE`, never the SDK's
own constants), `onChange(cb)`, and `authorize()/getAuthStatus()/
getSubscriptionStatus()`. The app drives it through that surface; `app.js`
`startOwnedMusicTrack()` mirrors its `onChange` into the same mini-player /
MediaSession / history the URL path uses, guarded so engine-based playback is
untouched whenever no owns-playback track is active. The active owner is chosen
by config (`registry.activePlaybackProvider(id)`), so a second streamer is a new
adapter + a config flip.

**Apple Music** (`music-provider-applemusic.js`): all MusicKit specifics
(SDK load, `/v1/catalog`+`/v1/me` paths, event names, `playbackState` ints,
artwork templates) are confined to that file; the instance is injected
(`deps.getInstance`) for tests. Registered in `getMusicProviders()` when
`state.appleMusic.enabled`. The developer token (ES256 JWT) is minted server-side
by `netlify/functions/apple-music-token.js` from `APPLE_MUSIC_PRIVATE_KEY` /
`APPLE_MUSIC_KEY_ID` / `APPLE_MUSIC_TEAM_ID` — until those env vars are set it
returns `{configured:false}` and the provider stays inert (`isAvailable()=false`).
Prereqs outside the code: an Apple Developer membership + MusicKit key, and an
Apple Music subscription on the listening device.

**Apple Music is the primary catalog when enabled (2026-09-24).** Discover renders
Apple results first in sections — Songs · Works (classical songs Apple tags with
`composerName`/`workName`/`movementName`, consolidated under the Work) · Albums ·
Artists · Playlists — with the free sources in a collapsible "Free & open sources"
section below. The Discover home shows Apple shelves from `provider.getHome()`:
charts always; recommendations + recently played once signed in (loaded once per
session, 30-min in-memory TTL — never polled). Search covers songs, albums, artists
and playlists; `getItem` expands albums, playlists (catalog `pl.…` and library
`p.…`) and artists (top songs). The storefront is the signed-in user's
(`music.storefrontId`) unless `state.appleMusic.storefront` is set. Saved Apple
recordings play via `resolveRef()` → an **owned** (URL-less) source that the
resolver accepts and `startRecordingResolved` routes to the transport. Settings →
Apple Music runs `checkCatalog()` to tell "key missing" / "key rejected" / "ok"
apart. `sw.js` skips `apple.com` + `mzstatic.com` so MusicKit API/DRM/HLS traffic
is never cached.

`createMusicProviderRegistry(providers)` exposes `search(query)` = **aggregated, isolated** search: every SEARCH-capable available provider runs under `Promise.allSettled`, results merge, and per-provider failures are reported in `providerStatuses` **without breaking the others**. HTTP clients are **injected** (`deps.fetchJson`) so providers are testable and a Netlify proxy can slot in later without touching callers.

---

## 3. Implemented providers

| Provider | id | Source | Capabilities | Notes |
|---|---|---|---|---|
| **Internet Archive** | `internetarchive` | `advancedsearch.php` + `metadata/{id}`, streams `/download/{id}/{file}` | SEARCH, GET_ITEM, PLAYABLE, ARTWORK, LICENSE, PAGINATION | Auth-free, CORS-enabled. Search → albums; `getItem` reads metadata files, keeps one streamable file per track (prefers MP3, de-dups formats, **skips ZIP/non-audio**). The workhorse. |
| **Musopen** | `musopen` | Internet Archive `collection:(musopen)` | same as IA | Musopen has no reliable standalone public streaming API; its catalogue lives on IA. `createMusopenProvider` = the IA provider scoped to that collection. **Some Musopen uploads are ZIP-only bundles → no individual tracks** (surfaced gracefully as "no streamable tracks"). |
| **Apple Music** | `applemusic` | MusicKit JS v3 (`/v1/catalog`, `/v1/me`) | SEARCH, GET_ITEM, ARTWORK, OWNS_PLAYBACK, AUTH, RECOMMEND | See §2a. Primary catalog when enabled. |

*Jamendo (CC-licensed indie music) was **retired 2026-09-24**: it needed a `client_id`
that had no settings UI and `state.jamendo` was never in `STATE_SECTIONS`, so it was
never actually reachable; with Apple Music as the primary catalog it added little.
The adapter was deleted; re-adding it is the normal "Adding a provider" recipe below.*

### Adding a provider
1. Write `music-provider-<name>.js` exporting `create<Name>Provider(config, {fetchJson})` returning the interface above; map its API to the normalized types; keep the raw schema inside the file.
2. Implement **`resolveRef(ref)`** — reconstruct a `PlayableSource` from a stored `{provider, externalId}` alone (no search). This is what makes saved recordings survive and provider fallback work.
3. Register it in `getMusicProviders()` (`app.js`) — push into the `providers` array (gate on config if it needs a key).
4. Add a label to `MUSIC_PROVIDER_LABELS`. Add tests with a mocked `fetchJson`.
That's it — search, consolidation, favourites, playlists, playback, and fallback all work with no other changes (provider id stays an implementation detail; canonical entities carry the identity).

---

## 3b. Canonical entities & resolution (`music-canonical.js`)

The provider layer (§1: `CanonicalTrack`/`Album`) is **a provider's record** of something. Above it sit the app's own entities, which provider records **resolve to** via ProviderReferences — provider ids are never canonical ids:

- **Work** — the composition (own `work_…` id; composer, title, catalog/opus/number, key, workType, instrument, movements).
- **Movement** — a section of a Work.
- **Recording** — a particular performance (own `rec_…` id; workId, performers, ensemble, conductor, album, duration, `providerRefs[]`).
- **PlayableSource** (§1) — the actual stream.

Each canonical entity keeps **provenance** (`{provider, providerId, matchType: auto|manual|possible, confidence, matchedOn[], metadata}`) so associations are **reversible and auditable**, and `canonicalFields` (user edits) that win over provider data. `enrichWork()` merges new provider metadata into empty fields only — never clobbering user edits.

**Matching is deterministic and conservative** (`matchWork`, `matchRecording`). Strong signals only:
- composer identity (surname + compatible given names / initials),
- catalog id (`Op. 27 No. 2`→`op27no2`, `BWV 1007`, `K. 545`),
- structured work identity (composer + workType + number + instrument),
- normalized title, and a small **nickname** table (`Moonlight`→Sonata No. 14).

**Conflict guards reject** different catalog ids or different numbers, so *different works never merge* and *different performances never merge* (a performer mismatch blocks a recording match). **False positives are worse than duplicates.** `consolidateSearchResults(items)` buckets provider hits by a deterministic grouping key into `{ groups:[{work, items}], loose:[] }` for the Discover UI (§17) — no fuzzy transitive merging; ambiguous items stay loose.

## 3c. Personal library & playlists (`music-library-model.js`)

Pure ops over `state.musicLibrary = { favorites, playlists }` (stored in the `media` state section, synced like the rest of state):
- **Favorites reference canonical entities** (`{ key, type: work|recording|album|artist|composer, entity }`). `favoriteKey` is content-derived and stable: Works key on composer+catalog (provider-independent); recordings/albums on their provider-ref (identity of that found performance). So a favourite survives provider id/metadata changes.
- **Playlists** hold canonical Recordings (each with `providerRefs`), so one playlist mixes providers. `add/remove/reorder/rename/delete`, de-duped by recording key.

Migration: the old provider-record `state.musicFavorites` is migrated once into canonical recording favourites on first Saved/Discover use.

## 3e. Discover & browse (`music-discover.js` + the Browse contract)

Providers that can browse advertise `CAP.BROWSE` and implement (documented in `music-streaming.js`):
`getHome({perShelf})`, `getGenres()`, `getBrowseCategory({label, query, genreId}, {perShelf})`, each returning **shelves** `{ id, title, items, style? }`. `style` is a layout hint only — `"hero"` (large cards), `"ranked"` (numbered song columns, tap = play with the rest of the shelf queued), default (cards). **The UI never asks which provider made a shelf**, so another streamer drops in by implementing these three methods; `app.js` picks the first available BROWSE provider.

`music-discover.js` (pure) owns the **category list** — genres (Pop, Hip-Hop, Rock, R&B, …) and moods/activities (Chill, Focus, Workout, Sleep, …), each with a search query, genre-name hints and a tile hue. A provider resolves a category's genre by **name** from its own genre list (`resolveGenreId`; a stable fallback id is used only when the list can't be fetched). Genre categories read that genre's charts + a playlists search; mood categories are search-only. Without a browse-capable catalog (no Apple Music) Discover shows the categories that make sense on the free sources, and a tile runs a search. It also owns the **local search filters** (`filterSavedLibrary`, `filterTracks`, `textMatches`: every word must match, order-free, accent-insensitive).

Loads are on demand and **never polled**: home shelves once per 30 min, a category page on tap (cached 30 min; a failed load isn't cached so "Try again" works).

## 3f. Portability — switching players without losing your music (`music-portable.js`)

The source of truth stays `state.musicLibrary` (synced JSONB): entries are canonical entities that keep **every provider ref** they were found under **plus an ISRC** (the industry recording code, identical across Apple Music / Spotify / Deezer / Tidal — captured from Apple's `isrc` attribute into `CanonicalTrack.isrc` → `Recording.isrc`). That is what makes a player switch safe:

1. A saved song whose own refs can't play (old provider removed/disabled) goes through the resolver's **same-song search** (§3d): match by **ISRC**, else title (release decorations like "(Remastered 2009)" stripped) + artist + duration ±5 s. Never fuzzy beyond that — a wrong song is worse than "unavailable".
2. A match is returned as `learnedRef`; `app.js` **appends** it to the saved entry, so the next play is direct. (Appended, so `favoriteKey` — first ref — never changes.)

**CSV** is the portability layer on top, not the store (a file can't sync or merge between devices; the JSONB section already does): Saved → *Back up & move your music* → **Export CSV** writes one file, one row per favourite and per playlist entry (`type, list, list_id, position, item_type, title, artist, album, composer, work, catalog, catalog_id, isrc, duration_ms, provider_refs, artwork_url, kind, added_at`). **Import CSV** merges (never deletes, de-dupes, playlists matched by id then name) and also accepts foreign playlist CSVs — e.g. Exportify's Spotify export (`Track Name`, `Artist Name(s)`, `ISRC`, `Track URI`…) becomes a playlist named after the file, with Spotify refs + ISRCs ready for a future Spotify provider. Migration tools (TuneMyMusic, Soundiiz) read the same title/artist/album/ISRC columns. Cells are guarded against spreadsheet formula injection.

**Adding another player later** = write `music-provider-<x>.js` (search + `resolveRef`, plus the Transport if it owns playback and Browse if it has a catalog home), register it in `getMusicProviders()`. Saved favourites/playlists need no migration: existing entries resolve via their refs or the same-song search and learn the new ref on first play.

## 3d. Source resolution & provider fallback (`music-source-resolver.js`)

A saved Recording is canonical; the **currently-playable source is separate and dynamic**. `resolvePlayableSource(recording, { registry, preferredProvider, allowAlternate })` tries refs in order (preferred → origin → rest) and returns a **typed** result:

- **`exact`** — the same recording (its own ref, the *same song* found on another provider by ISRC / title+artist+duration — §3f — or the *same performance* of a Work found via search). Play it. A search hit carries `learnedRef`.
- **`alternate`** — the exact recording is unreachable, but a *different performance of the same Work* exists. **Offered to the user, never silently substituted** (§13) — the app shows a "Recording unavailable — play another performance?" prompt.
- **`unavailable`** — nothing resolves right now.

Providers implement `resolveRef(ref)` to reconstruct a stream URL from a stored reference **without a search** (IA: `identifier/filename`→download URL; Apple Music: catalog id → an `owned` source, played through the transport). A provider failing is **skipped, never deleted** — availability is dynamic (§18). In a playlist queue, unresolvable/alternate items are skipped (not removed); an explicit single play prompts for the alternate.

## 4. Playback flow

```
Discover result (CanonicalTrack/Album)
   album → openMusicItem() → provider.getItem() → tracks
   track → playStreamingTrack(track, rest)
                     │
   Library track → playMusicTrackById(id) / playAllMusic()
                     │
                     ▼
   playMusicQueueItem({kind,…}, restQueue)   ← unified tagged queue
     kind:"stream"  → provider.getPlayable() → url
     kind:"library" → musicLib.resolvePlayable() → blob: url
                     ▼
   playMusicDescriptor({id,title,artist,album,artworkUrl}, url)
     → mediaEngine.load({providerId:"music", segments:[{url}]})
     → mini-player + MediaSession (lock screen) + pushMusicHistory()
```

The queue interleaves library and streaming items; `onMusicEnded` advances it; a failed item auto-skips. Controls (play/pause/seek/next, background persistence, artwork, title/artist, provider) run through the existing now-playing bar — music is just a third `providerId` ("music") alongside "podcast"/"tts".

---

## 5. Favorites, history, playlists

Stored in **local sectioned `state`** (persisted via `persist()`), normalized and provider-independent:
- **Recently played** lives in the **unified `state.mediaHistory`** (see `media-history.js`) shared with podcasts/radio, not a music-only list; music reads it via `getRecentMedia({kind:"music"})`. Each entry's `ref` carries what replay needs (`{mkind, canonical, recording}`).
- Favourites + playlists: `state.musicLibrary` (§3c); the legacy `state.musicFavorites` list is migrated into it once.

No Supabase tables were added; this matches how the rest of the app stores user data and keeps favorites/history provider-agnostic. Portability across providers: §3f.

---

## 6. Caching & networking

- **Metadata**: expanded items cached in-memory (`musicItemCache`). Search is debounced (380 ms) with an out-of-order guard (`musicSearchToken`).
- **Images**: normal browser HTTP cache (IA `services/img`).
- **Audio**: streamed, **never cached/downloaded**. `sw.js` `SKIP_HOSTS` excludes `archive.org` and `apple.com`/`mzstatic.com` (MusicKit) so the service worker never caches streams, personal API responses, or mangles range requests.
- Providers fetch **directly** from the client (IA CORS verified; media plays cross-origin without CORS). If rate limits ever bite, inject a `fetchJson` that routes through a Netlify function — no caller changes.
- No CSP is set on the site, so cross-origin fetch/img/audio to these hosts work on the deployed HTTPS PWA.

---

## 7. Graceful degradation
One provider failing (down, rate-limited, unavailable, no key) contributes nothing and is noted in the results header; the rest keep working. Missing artwork → placeholder. ZIP-only / non-streamable items → clear "no streamable tracks" message. Blank query → Discover home, not an error.

---

## 8. Radio (future) — boundary note
Live **Radio** will share the engine, session, favorites, history, and controls, but a station is **not** a music recording. Keep it a distinct content concept/domain; do not model a stream as a `CanonicalTrack`.

---

## 9. Known limitations / next steps
- **Musopen** coverage is partial (IA ZIP bundles yield no tracks); a curated allow-list of good Musopen items would improve it.
- **Internet Archive** search is relevance-ranked and excludes non-music audio collections (audiobooks, podcasts, old-time radio, …) — `NON_MUSIC_COLLECTIONS` in the adapter.
- **iOS app**: MusicKit JS sign-in (popup) and DRM playback inside the Capacitor WKWebView are unverified; the robust path there is native MusicKit via a Capacitor plugin (see ISSUES.md).
- No cross-provider **entity resolution** beyond exact-identifier dedup (by design).
- Browse-by-facet (composer/period/instrument) is not built; Discover categories are genre/mood only (§3e). Home shelves beyond Apple's recommendations/recent/charts (e.g. new releases) would need an editorial endpoint.
- No **preferred-player setting** yet: with one playback-owning provider it's moot. When a second one lands, pass `preferredProvider` to `resolvePlayableSource` from a setting (the resolver and `registry.activePlaybackProvider(id)` already support it).
- CSV export uses a blob download link (same as the Cadence MusicXML export); inside the iOS Capacitor wrapper that may need the Share sheet instead — unverified.
- Ambient/meditation **classification** is search-driven (category tiles), not tagged — the domain leaves room for local/AI tagging later without requiring it now.
- Offline audio is intentionally out of scope (licence-respecting future capability).

---

## 10. Tests
Provider/streaming: `test/music-streaming.test.js`, `test/music-provider-ia.test.js`. Canonical layer: `test/music-canonical.test.js` (composer identity, catalog/number conflicts, nickname resolution, consolidation, enrichment), `test/music-library-model.test.js` (canonical favourites survive provider changes; multi-provider playlists), `test/music-source-resolver.test.js` (exact via own ref / secondary provider / search; provider-down skip; exact-vs-alternate; different-work rejection; unavailable). Discover & portability: `test/music-discover.test.js` (categories, genre resolution, local search), `test/music-portable.test.js` (CSV round-trip preserves favourite keys / order / ISRC / refs, idempotent re-import, Exportify import, formula guard), resolver same-song tests (ISRC, decorated titles, no wrong-song substitution, `learnedRef`), Apple browse tests (genres cached, genre charts vs mood search, hero ordering, ISRC capture). Plus the Library-layer suites (`music-library`, `music-tags`, `music-jellyfin`). Run `npm test`.

## 11. Connection to the piano/score system
Canonical `Work`/`Movement`/`Recording` align by shape with the Cadence score domain (`music/domain.js`). A future score-following/practice/annotation system references the same canonical Work; reconcile a score's Work with a listening Work via `matchWork` + `providerRefs` (no entity store is forced today — the seam is `consolidateSearchResults`/`enrichWork`).
