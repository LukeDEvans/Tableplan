# Music architecture (Media → Music tab)

The Music tab has **three modes over shared systems, one playback engine**:

| Mode | What it is | Modules | Data |
|---|---|---|---|
| **Saved** | Your personal library — favourites (Works/Recordings) + playlists + recently played, all **canonical & provider-independent** | `music-canonical.js`, `music-library-model.js` | `state.musicLibrary` (local) |
| **Discover** | Stream on demand from free/open providers; results **consolidated under canonical Works** | `music-streaming.js`, `music-provider-*.js`, `music-canonical.js` | nothing stored — metadata only, streamed from source |
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

Pure ops over `state.musicLibrary = { favorites, playlists }` (local-first; no cloud):
- **Favorites reference canonical entities** (`{ key, type: work|recording|album|artist|composer, entity }`). `favoriteKey` is content-derived and stable: Works key on composer+catalog (provider-independent); recordings/albums on their provider-ref (identity of that found performance). So a favourite survives provider id/metadata changes.
- **Playlists** hold canonical Recordings (each with `providerRefs`), so one playlist mixes providers. `add/remove/reorder/rename/delete`, de-duped by recording key.

Migration: the old provider-record `state.musicFavorites` is migrated once into canonical recording favourites on first Saved/Discover use.

## 3d. Source resolution & provider fallback (`music-source-resolver.js`)

A saved Recording is canonical; the **currently-playable source is separate and dynamic**. `resolvePlayableSource(recording, { registry, preferredProvider, allowAlternate })` tries refs in order (preferred → origin → rest) and returns a **typed** result:

- **`exact`** — the same recording (its own ref, or the *same performance* found on another provider via search). Play it.
- **`alternate`** — the exact recording is unreachable, but a *different performance of the same Work* exists. **Offered to the user, never silently substituted** (§13) — the app shows a "Recording unavailable — play another performance?" prompt.
- **`unavailable`** — nothing resolves right now.

Providers implement `resolveRef(ref)` to reconstruct a stream URL from a stored reference **without a search** (IA: `identifier/filename`→download URL; Jamendo: track-id→mp3 endpoint). A provider failing is **skipped, never deleted** — availability is dynamic (§18). In a playlist queue, unresolvable/alternate items are skipped (not removed); an explicit single play prompts for the alternate.

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
Provider/streaming: `test/music-streaming.test.js`, `test/music-provider-ia.test.js`. Canonical layer: `test/music-canonical.test.js` (composer identity, catalog/number conflicts, nickname resolution, consolidation, enrichment), `test/music-library-model.test.js` (canonical favourites survive provider changes; multi-provider playlists), `test/music-source-resolver.test.js` (exact via own ref / secondary provider / search; provider-down skip; exact-vs-alternate; different-work rejection; unavailable). Plus the Library-layer suites (`music-library`, `music-tags`, `music-jellyfin`). Run `npm test`.

## 11. Connection to the piano/score system
Canonical `Work`/`Movement`/`Recording` align by shape with the Cadence score domain (`music/domain.js`). A future score-following/practice/annotation system references the same canonical Work; reconcile a score's Work with a listening Work via `matchWork` + `providerRefs` (no entity store is forced today — the seam is `consolidateSearchResults`/`enrichWork`).
