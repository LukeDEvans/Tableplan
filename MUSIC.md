# Music architecture (Media → Music tab)

The Music tab has **two layers that share one playback engine**:

| Layer | What it is | Modules | Data |
|---|---|---|---|
| **Library** | Music you *own* — local file uploads + a Jellyfin server | `music-library.js`, `music-tags.js`, `music-jellyfin.js` | audio **bytes** in IndexedDB (local) / streamed from Jellyfin |
| **Discover** | Music you *stream on demand* from free/open providers | `music-streaming.js`, `music-provider-*.js` | **nothing stored** — normalized metadata only, streamed from the source |

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

`CAP` = `SEARCH, BROWSE, GET_ITEM, PLAYABLE, ARTWORK, LICENSE, PAGINATION, RECOMMEND`.

`createMusicProviderRegistry(providers)` exposes `search(query)` = **aggregated, isolated** search: every SEARCH-capable available provider runs under `Promise.allSettled`, results merge, and per-provider failures are reported in `providerStatuses` **without breaking the others**. HTTP clients are **injected** (`deps.fetchJson`) so providers are testable and a Netlify proxy can slot in later without touching callers.

---

## 3. Implemented providers

| Provider | id | Source | Capabilities | Notes |
|---|---|---|---|---|
| **Internet Archive** | `internetarchive` | `advancedsearch.php` + `metadata/{id}`, streams `/download/{id}/{file}` | SEARCH, GET_ITEM, PLAYABLE, ARTWORK, LICENSE, PAGINATION | Auth-free, CORS-enabled. Search → albums; `getItem` reads metadata files, keeps one streamable file per track (prefers MP3, de-dups formats, **skips ZIP/non-audio**). The workhorse. |
| **Musopen** | `musopen` | Internet Archive `collection:(musopen)` | same as IA | Musopen has no reliable standalone public streaming API; its catalogue lives on IA. `createMusopenProvider` = the IA provider scoped to that collection. **Some Musopen uploads are ZIP-only bundles → no individual tracks** (surfaced gracefully as "no streamable tracks"). |
| **Jamendo** | `jamendo` | `api.jamendo.com/v3.0` | SEARCH, PLAYABLE, ARTWORK, LICENSE, PAGINATION | CC-licensed independent music. **Requires a `client_id`** (register at developer.jamendo.com; put it in `state.jamendo.clientId`). Inert/`isAvailable()=false` without one — the architecture never depends on it. Track-oriented: results are directly playable, no `getItem`. |

### Adding a provider
1. Write `music-provider-<name>.js` exporting `create<Name>Provider(config, {fetchJson})` returning the interface above; map its API to the normalized types; keep the raw schema inside the file.
2. Register it in `getMusicProviders()` (`app.js`) — push into the `providers` array (gate on config if it needs a key).
3. Add a label to `MUSIC_PROVIDER_LABELS`. Add tests with a mocked `fetchJson`.
That's it — search/UI/playback/favorites work with no other changes.

---

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
- `state.musicHistory` — recently played descriptors (+ the canonical track for stream replay), capped at 40.
- `state.musicFavorites` — favorited canonical tracks/albums, capped at 200.

No Supabase tables were added; this matches how the rest of the app stores user data and keeps favorites/history provider-agnostic. Playlists are not built yet but the normalized items + `providerRefs` make a `state.musicPlaylists[]` of canonical items a straightforward later addition.

---

## 6. Caching & networking

- **Metadata**: expanded items cached in-memory (`musicItemCache`). Search is debounced (380 ms) with an out-of-order guard (`musicSearchToken`).
- **Images**: normal browser HTTP cache (IA `services/img`).
- **Audio**: streamed, **never cached/downloaded**. `sw.js` `SKIP_HOSTS` excludes `archive.org`/`jamendo.com` so the service worker never caches streams or mangles range requests.
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
- **Jamendo** needs a `client_id` (no in-app settings field yet — set `state.jamendo.clientId`).
- No cross-provider **entity resolution** beyond exact-identifier dedup (by design).
- Browse-by-facet (composer/period/instrument) and Discover "home" sections beyond categories/recents/favourites are not built.
- Ambient/meditation **classification** is search-driven (category chips), not tagged — the domain leaves room for local/AI tagging later without requiring it now.
- Offline audio is intentionally out of scope (licence-respecting future capability).

---

## 10. Tests
`test/music-streaming.test.js` (domain normalization, aggregated-search isolation), `test/music-provider-ia.test.js` (IA search/`getItem` mapping, format de-dup, ZIP-only handling), plus the Library-layer suites (`music-library`, `music-tags`, `music-jellyfin`). Run `npm test`.
