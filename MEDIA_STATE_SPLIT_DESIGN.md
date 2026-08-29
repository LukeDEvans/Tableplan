# Media State Split — Design (P0)

*Read-only design pass. No source, schema, migration, config, dependency, test, or infra was modified; nothing was committed. Evidence is cited as `file:function` / `file:line`. Sizes marked "estimate" are code-derived, not measured against production.*

---

## 0. Review Decisions (locked 2026-08-25)

*Added after design review. These decisions refine the analysis below; where they differ from the original text, these win. The analysis (§2–§20) remains valid as the evidence base.*

1. **Urgency downgraded: P0-emergency → "important, do it right."** After this design was written, a separate one-line fix landed (commit `f545ca9`, local, deploys next push): the state writer sent `Prefer: return=representation` with no `select`, so **every** section write **echoed the whole row back** — the multi-MB media row was downloaded again on every write (up to every 30s during playback). Adding `&select=updated_at` removed that dominant egress source. **What remains** is the *read-on-load* of the full media row (`loadStateFromSupabase` downloads bodies on every cold start / hydrate / online-restore) — real but smaller and less frequent. So we are no longer rushing; we do this properly.

2. **Phase 1 = IndexedDB + `reading-content` bucket, together (zero regression).** Not "strip-now, bucket-later." Rationale: with the emergency defused (#1), there's no reason to accept the interim regression that strip-before-bucket would cause (today article bodies *are* synced, so they read on any device; stripping them from the synced row before a durable cloud copy exists would break cross-device / post-cache-clear reading of paywalled bodies). Local **and** durable from the start.

3. **Article content is a layered content store — local is the substrate, the bucket is the backstop.** Both, not either/or:
   - **Write (on save):** body → IndexedDB (instant local) **and** upload → `reading-content` bucket (durable, cross-device).
   - **Read (on open):** **IndexedDB → (miss) bucket → (miss) re-fetch from source** (`ensureArticleText`/`fetch-article`), caching down each layer.
   - **Why local is the long-term-correct substrate (not a convenience):** memory-speed opens; **offline reading** (the local-first goal); **resilience** — reading survives Supabase/provider outages (as the quota incident proved a bucket-only design would *not*); and **lower egress** — each body is fetched once then read free, whereas bucket-only would cost egress on every open. **Why keep the bucket:** IndexedDB is best-effort and browser-evictable and doesn't cross devices; the bucket is the durability/cross-device backstop and lets us later LRU-cap the local cache safely.

4. **Section-split (old Phases 2–3) demoted below content-out.** Isolating `podcastProgress` etc. was mostly about cheap hot *writes* — which the write-echo fix (#1) already made cheap. The section-split remains a worthwhile *architecture/ingress* cleanup, but it is **not** the egress lever and is no longer near-term priority. Content-out (bodies out of the synced row) is the remaining egress win and comes first.

5. **Article-body model shape: a separate content record keyed by article id — not a parallel type split in state.** Keep `savedArticles[i]` as the metadata carrier (`id,url,title,author,date,publication,savedAt,pinned` + derived read state); the body lives as `{id,text,fetchedAt,source}` in the content store (IndexedDB `bodies` object store, mirrored to the bucket), addressed by the same `id`. Less churn than introducing distinct `ArticleMeta`/`ArticleContent` state types; same separation of concerns.

6. **Reusable foundation.** This local-cache + durable-bucket content store is deliberately general: it also becomes the home for podcast **episode notes** (already lazy today) and future **TTS/Kokoro audio** (large generated binaries wanting exactly this local-fast / durable-copy pattern). Build it once, reuse across media.

**Net effect on the plan:** the §21 phases re-order to *content-out first (IndexedDB + bucket)*, section-split later; the "If This Were My Codebase" "Do First" becomes Phase 1 as defined here. Bucket setup (create private `reading-content` bucket + owner-scoped RLS) is a Luke-owned infra step I will provide exact instructions for, not perform.

---

## 1. Executive Summary

The `media` state section is **one Supabase row (`{stateId}:media`) that conflates five independent sub-domains** — Reading (articles), Podcasts, Music, Radio, and the cross-media Hub (history/saved) — across ~38 keys (`app.js:274` `STATE_SECTIONS.media`). Two things make it the app's top reliability/cost risk:

1. **It is heavy.** Saved articles carry their **full body text** in `savedArticles[].text` (`app.js:12767`), and this text **is synced to Supabase** (only podcast *episode descriptions* are stripped before write — `extractSectionData` / `stripEpisodeDescriptions`, `app.js`). A prolific reader's media row is easily multiple megabytes (estimate).
2. **It is hot.** `podcastProgress` ticks every ~5s during playback (`schedulePodcastPositionSave`, `app.js:43796`) and `mediaHistory` writes on every play. Because writes are **per-section** and **change-detected on the whole section** (`writeStateToSupabase` → `lastWrittenSections[section] !== currentJson`), *any* small change to *any* media key rewrites the **entire multi-MB row**.

The team already fought this with **frequency** controls — a 5s debounce + a hard **30s minimum write interval** (`app.js:257-263`), episode-description stripping, and progressive localStorage slimming (`mirrorStateToLocalStorage`, `app.js:3128`). Those cap *how often* and protect *localStorage*, but they do **not** shrink the **per-write cloud payload**: a one-hour podcast listen still rewrites the whole multi-MB media row ~120 times.

**The fix is two orthogonal, individually-shippable moves, both reusing patterns the codebase already has:**

- **Move A — Content out of state (the Cadence pattern).** Article bodies are large, cold (written once at save, read only when opened), and **already re-fetchable on demand** (`ensureArticleText`, `app.js:46245`, mirroring `ensureEpisodeDescription`). Move them to **IndexedDB** (offline cache) + a private **Storage bucket** (durable, cross-device) — exactly how Cadence stores score bytes (`music/cloud-blob.js` `cadence-blobs`, `music/storage.js` `createIdbStorage`). This alone removes the multi-MB payload from *every* media write, with almost no change to the sync structure.
- **Move B — Section granularity (reuse the existing section machinery).** Split the single `media` section into independent sections aligned to the sub-domains, and **isolate the hot keys** (`podcastProgress`, `mediaHistory`) into their own tiny sections. New sections cost nothing architecturally: the existing `writeSectionWithMerge` / `mergeStates` / tombstone system already handles per-section rows. After this, a progress tick rewrites a **~KB** row, not the library.

**Do not** introduce per-entity DB rows, a new sync engine, or a new storage technology — the section-row model + `mergeStates` + the Cadence IndexedDB/bucket primitives already cover every need. The result: same app, dramatically smaller and less frequent hot writes, genuine offline reading, and a content-store that the upcoming **TTS** work slots straight into.

---

## 2. Current Media Architecture

```
External providers (TMDB / YouTube / IA / Jamendo / MPR / RadioBrowser / podcast feeds / article fetch)
      │
      ▼
Netlify functions (fetch-article, fetch-podcast, tmdb-*, youtube-search, save-article, sync-saved-articles …)   ← adapters, hold secrets
      │
      ▼
Client provider modules (media-provider-*.js, media-search.js, media-sources.js) → canonical MediaItem (media-model.js)
      │
      ▼
Domain logic in app.js  ── writes to ──►  ONE in-memory `state` (media keys)
      │                                          │
      ▼                                          ├─ mirrorStateToLocalStorage()  (strips text/descriptions on quota)
UI render fns (renderMedia*, podcast/article/music/radio panels)                 │
                                                 └─ persist() → saveStateToSharedStorage() → writeStateToSupabase()
                                                                                          → writeSectionWithMerge("{stateId}:media", ALL media keys)
```

**What is already good and must be preserved** (see §9): the canonical `MediaItem`/progress/providerRef models (`media-model.js`), the capability-based provider registry (`media-provider.js` `MEDIA_CAP`/`PROVIDER_CATALOG`), the Playback Coordinator (`playback-coordinator.js`), the canonical history/saved store (`media-state.js`: `recordPlayback`, `SAVED_LIST`, `savedList`), and the Cadence blob/metadata split. **This redesign changes only where media *persistence* lands — not the model/adapter/coordinator layers.**

---

## 3. Complete Media State Inventory

All keys live in `STATE_SECTIONS.media` (`app.js:274`). Grouped by the sub-domain they actually belong to. Frequency/size are code-derived estimates.

### Reading / Articles
| Key | Shape | Purpose | Write freq | Size | Canonical? | Sync? | Reconstructable? |
|---|---|---|---|---|---|---|---|
| `savedArticles` | `[{id,url,title,author,date,publication,savedAt,pinned, text}]` | saved reader items | on save/delete/pin | **LARGE (`text` body)** | metadata canonical; **text derivable** | metadata yes; **text should not** | text via `ensureArticleText`/`fetch-article` |
| `readArticleIds` | `string[]`/Set | which articles are read | **HOT (per read)** | small | canonical | yes | no |
| `articleReadDates` | `{id:iso}` | when read | **HOT (per read)** | small | canonical | yes | no |
| `readingSettings`,`readingItems`,`articleSync`,`readPublications`,`articleSortOrder`,`publicationTiers` | objects/arrays | reader prefs, sync cookies meta, publication tiers/sort | occasional | small | canonical (prefs) | yes | no |

### Podcasts
| Key | Shape | Purpose | Write freq | Size | Notes |
|---|---|---|---|---|---|
| `podcasts` | `[{id,title,feedUrl,artwork, episodes:[{id,title,url,date,guid,description}]}]` | subscriptions + episode lists | on refresh/subscribe | **MEDIUM-LARGE** (episode arrays; `description` already stripped for persistence) | metadata; feed-derived |
| `podcastProgress` | `{episodeId:{position,duration,lastPlayedAt,played}}` | resume positions | **HOTTEST (~5s ticks → ≤30s cloud)** | small-ish (grows with #episodes) | canonical personal |
| `podcastQueue` | `[episodeId]` | play queue | on queue/reorder | small | **ephemeral interaction** |
| `podcastPlaylists`,`podcastPlaylistItems`,`podcastSaved`,`podcastSavedCategories`,`podcastSavedEpisodeCategories`,`podcastShowTiers`,`podcastEpisodeTiers`,`podcastTierCount`,`podcastPrioritySort`,`podcastPlaylistWindow`,`podcastRecentWindow`,`podcastPlaylistIncludeArticles`,`podcastAutoSkipped`,`podcastSkipAds`,`podcastBundleSeries`,`podcastReleasedSeries` | maps/arrays/scalars | playlist org, tiers, windows, prefs | occasional | small each | canonical prefs/org |

### Music
| Key | Shape | Purpose | Write freq | Size | Notes |
|---|---|---|---|---|---|
| `musicLibrary` | `{favorites:[track], playlists:[…]}` (`app.js:44395`) | personal music org | on save (`saveMusicLibrary`) | **MEDIUM** (grows with favorites) | canonical personal; *blobs already in IndexedDB `live-music`* |

### Radio
| Key | Shape | Purpose | Write freq | Size | Notes |
|---|---|---|---|---|---|
| `radioFavorites`,`radioFollowedPrograms`,`radioUserStations` | arrays | radio personalization | occasional | small | canonical personal |

### Media Hub (cross-cutting)
| Key | Shape | Purpose | Write freq | Size | Notes |
|---|---|---|---|---|---|
| `mediaHistory` | `[HistoryEntry]` (bounded, `media-history.js` `slice(0,cap)`) | unified play history | **HOT (per play)** | small (capped) | canonical; from `media-state.js` |
| `mediaSaved` | `[SavedItem]` (`SAVED_LIST` watch/listen-later/favorites) | unified saved | on save | small-medium | canonical |
| `mediaAllPinnedOrder`,`libraryKey` | array/scalar | pin order, cache-buster | occasional | small | canonical |

**Ephemeral UI state** not in the section (kept for completeness): live playback position (on the `<audio>` element), current selections, open-panel state — correctly not persisted.

---

## 4. State Size / Hotness Analysis

Two axes; the danger is the top-left cell (heavy **and** co-resident with hot keys):

| | **Cold (write-once/rare)** | **Hot (frequent)** |
|---|---|---|
| **Heavy** | `savedArticles[].text` (bodies), `podcasts[].episodes[]`, `musicLibrary` | *(none intrinsically — but today they RIDE ALONG with the hot keys because they share the row)* |
| **Light** | reading/podcast settings, tiers, playlists, radio, pins | `podcastProgress`, `mediaHistory`, `readArticleIds`, `articleReadDates`, `podcastQueue` |

**The whole problem in one sentence:** the heavy-cold cell and the light-hot cell **share one Supabase row**, so every light-hot change pays the heavy-cold payload. Estimated payload of a single media write today: **1–5 MB** for an active user (dozens of saved articles × ~10–50 KB text + episode arrays + music favorites). Estimated write count during a 1-hour podcast: **~120** (every 30s). Estimated egress from that single session: **~120–600 MB** (estimate) — matching the documented Disk-IO incident.

---

## 5. Mutation Analysis

| Mutation | Data changed | Current persistence unit | Approx. unrelated data rewritten | Impact |
|---|---|---|---|---|
| **Podcast progress tick** (`schedulePodcastPositionSave`, `43796`) | one episode `{position,…}` | **entire `media` row** | all article bodies + all episodes + music + radio | **Severe** — ~120×/hr, multi-MB each |
| **Play anything** (`recordPlayback`, `40341/40638`) | one history entry | **entire `media` row** | everything else in media | High (per play) |
| **Mark article read** (`readArticleIds`/`articleReadDates`) | one id + date | **entire `media` row** | all bodies + podcasts + music | High (per read; bursty when scanning) |
| **Save article** (`12767`, `save-article`) | one article incl. **text body** | **entire `media` row** | everything else | Medium (adds bulk *and* rewrites all) |
| **Subscribe / refresh podcast** | episode arrays | **entire `media` row** | bodies + music + radio | Medium |
| **Reorder podcast queue** | `podcastQueue` array | **entire `media` row** | everything | Medium — **and directly in the path of the planned Queue reorder work** |
| **Save/favorite music** (`saveMusicLibrary`, `44400`) | `musicLibrary` | **entire `media` row** | bodies + podcasts | Medium |
| **Toggle skip-ads / change a tier / sort** | one scalar/map | **entire `media` row** | everything | Low-freq but full-payload |

**Most problematic:** progress ticks and history writes (hot + full heavy payload). The queue reorder is called out because the **planned Media-Queue interaction work will make it high-frequency**, so it must not rewrite anything heavy.

---

## 6. Read Analysis

Reads are cheaper than writes here (one bulk fetch of all section rows on load, `loadStateFromSupabase`), but the coupling still shows:

- **Cold start downloads all article bodies + all episode metadata** even though the first screen shows only a *list* of titles. (`mirrorStateToLocalStorage` already tries to avoid keeping bodies locally; the *cloud load* still ships them.)
- **A component that needs only `podcastProgress`** (e.g. the "Continue" strip, `40701`) reads it out of the same giant in-memory `media` blob. In memory that's fine; the cost is the *load/serialize* size, not the property access.
- **No component needs an article body until the reader is opened** — yet bodies are loaded eagerly at boot. This is the read-side mirror of the write problem and the direct justification for lazy content (Move A).

No component is *incorrectly* coupled at the API level (they read `state.podcastProgress`, `state.savedArticles`, etc. individually); the coupling is purely at the **persistence unit** level.

---

## 7. Current Persistence Flow

`persist()` (`app.js:3159`) → `mirrorStateToLocalStorage()` (immediate, with slimming) + `saveTripBackup()` + `saveStateToSharedStorage()` (debounced) + `scheduleLocalBackup()`.

`saveStateToSharedStorage` → debounce 5s (`SHARED_STORAGE_DEBOUNCE_MS`) + min-interval 30s (`SHARED_STORAGE_MIN_INTERVAL_MS`) → `writeStateToSupabase` → for each section whose serialized JSON changed (`lastWrittenSections[section] !== JSON.stringify(extractSectionData(keys))`), `writeSectionWithMerge("{stateId}:media", keys)`:
- `extractSectionData(keys)` picks the keys and **strips podcast episode descriptions** (`stripEpisodeDescriptions`) — but **keeps `savedArticles[].text`**.
- Write is a conditional `PATCH … updated_at=eq.<lastSeen>` (optimistic concurrency); 0-rows ⇒ conflict → re-load + merge + retry. First write per load probes existence then inserts.
- `schemaVersion` + the `tp_protect_finance_merge` DB trigger guard finance only (not media).

**Persistence granularity today: one row for the whole `media` section.** localStorage holds a full mirror (bodies stripped only under quota). IndexedDB is used only by Music (`live-music`) for audio/artwork blobs — **not** for articles.

---

## 8. Current Synchronization Flow

Media rides the **standard section-sync**: pull all section rows on load (`loadStateFromSupabase`), `mergeStates(local, remote)` (`state-sync.js`: `unionById` on id-keyed collections + `unionStrings` + tombstones via `mergeTombstones`), debounced section-granular push. **No realtime, no polling.** Media collections that are id-keyed (`savedArticles`, `mediaHistory`, `mediaSaved`, `podcasts`) union by id with tombstones; scalar/map settings last-writer-win.

**Compatibility conclusion:** splitting `media` into more sections is **natively compatible** — the sync engine is section-agnostic. New sections just register in `STATE_SECTIONS` (`app.js:274`), `defaultState()` (`~3296`), `normalizeState()` (`~3465`), and the `mergeStates` union key lists (`~5569`/`~5627`). Splitting **reduces** conflict frequency (smaller, domain-scoped rows) and **shrinks** payloads. It requires **no new sync primitives**.

---

## 9. Canonical Model Analysis (what stays central)

| Abstraction | Role | Verdict |
|---|---|---|
| `media-model.js` (`makeMediaItem`, `makeProgress`, `mediaKey`, `contentKey`, `providerRefs`) | canonical entity identity | **Keep central.** Persistence should serialize *these*, not provider shapes. |
| `media-provider.js` (`MEDIA_CAP`, `PROVIDER_CATALOG`, `hasCapability`) | capability registry | **Keep.** Unaffected by persistence split. |
| `playback-coordinator.js` | chooses playback target by capability | **Keep.** TTS plugs in here (§16). |
| `media-state.js` (`recordPlayback`, `SAVED_LIST`, `savedList`, `historyItems`, `continueList`) | canonical history/saved store | **Keep and lean on it** — it already owns `mediaHistory`/`mediaSaved` logic; the split just gives those keys their own row. |
| `media-history.js` | bounded history | **Keep.** |
| Cadence `music/cloud-blob.js` + `music/storage.js` + `music-library.js` IndexedDB store | metadata-in-rows / bytes-in-bucket+IDB | **Reuse as the content-store template** (§10–14). |

**This design adds no competing media architecture.** It aligns *persistence* with the models that already exist.

---

## 10. Proposed Domain Entities (independently-changing units)

Derived from actual mutation independence (§5), not invented:

| Entity | Stable ID | Canonical/mutable fields | Large fields | Local-only | Synced | Deletion | Conflict |
|---|---|---|---|---|---|---|---|
| **ArticleMeta** | `id` | url,title,author,date,publication,savedAt,pinned,read,readAt,tags | — | — | **yes** | tombstone | union-by-id, last-writer field |
| **ArticleContent** | `id` (= ArticleMeta id) | `text` (body) | **`text`** | IndexedDB cache | via **bucket** (durable) | delete with meta | content-addressed, immutable-ish |
| **PodcastSubscription** | `id`/feedUrl | title,feedUrl,artwork,settings | — | — | yes | tombstone | union-by-id |
| **PodcastEpisode (meta)** | `id`/guid | title,url,date,duration | `description` (already lazy) | — | yes (no description) | with subscription | union-by-id |
| **PodcastProgress** | `episodeId` | position,duration,lastPlayedAt,played | — | — | **yes, isolated hot row** | prune with subscription | last-writer (newest `lastPlayedAt`) |
| **MusicLibraryItem** | track `uid` | favorites,playlists | — | *(audio blobs already in `live-music` IDB)* | yes (refs only) | tombstone | union-by-id |
| **RadioFavorite / FollowedProgram / UserStation** | `id` | station/program fields | — | — | yes | tombstone | union-by-id |
| **MediaHistoryEntry** | `kind:id` + ts | HistoryEntry | — | — | **yes, isolated hot row** | bounded (auto-evict) | append + cap |
| **MediaSavedItem** | `mediaKey` | list, item ref | — | — | yes | tombstone | union-by-id |
| **PlaybackQueue / live position** | — | queue order, current position | — | **ephemeral** | **no** (or tiny) | — | n/a |

---

## 11. Metadata vs Content Strategy

**Adopt the Cadence split for articles.** Today `savedArticles[i]` = *(hot metadata)* + *(cold heavy `text`)* in one object in one synced row. Separate them:

- **ArticleMeta** — everything except `text` — stays in a small synced section (`reading`). Read/unread, pin, tags, sort all mutate *this only*.
- **ArticleContent** — just `{id, text, fetchedAt, source}` — lives **outside the synced row**: IndexedDB locally + a private **`reading-content` bucket** for durability/cross-device (mirroring `cadence-blobs`). Loaded lazily by the *already-existing* `ensureArticleText` (`46245`), which already re-fetches via `fetch-article` and already has a "Fetch Article" fallback UI (`46186`).

**Podcast episode descriptions are already handled this way** (`stripEpisodeDescriptions` + `ensureEpisodeDescription`, `43012`). Formalize both under one content-store abstraction so articles, episode notes, and (later) TTS audio share it.

**Do not** split article metadata further (title/author/date/read all change together at human speed and are always read together in the list) — that would be over-normalization (§11 constraint).

---

## 12. Persistence Strategy (target)

Replace the single `media` section with **sub-domain sections + isolated hot rows + an out-of-band content store**. All reuse existing machinery.

| New section (Supabase row `{stateId}:X`) | Keys | Why separate |
|---|---|---|
| `reading` | `savedArticles` *(text stripped)*, `readArticleIds`, `articleReadDates`, `readingSettings`, `readingItems`, `articleSync`, `readPublications`, `articleSortOrder`, `publicationTiers` | article metadata + read state; small, changes independently of podcasts/music |
| `podcasts` | `podcasts` (episode meta), `podcastPlaylists`, `podcastPlaylistItems`, `podcastSaved*`, `podcast*Tiers`, `podcast*Window`, `podcastPrioritySort`, `podcastSkipAds`, `podcastBundleSeries`, `podcastReleasedSeries`, `podcastPlaylistIncludeArticles` | subscriptions + org/prefs; medium; changes on refresh |
| **`podcastProgress`** *(hot, isolated)* | `podcastProgress`, `podcastAutoSkipped` | **the hottest key** — its own ~KB row so ticks are cheap |
| `music` | `musicLibrary` | independent; blobs already in IDB |
| `radio` | `radioFavorites`, `radioFollowedPrograms`, `radioUserStations` | small, independent |
| **`mediaHub`** | `mediaHistory` *(hot but bounded)*, `mediaSaved`, `mediaAllPinnedOrder`, `libraryKey` | cross-media; consider splitting `mediaHistory` into its own row if telemetry shows it hot enough |
| *(content store, not a section)* | article bodies, episode descriptions, future TTS audio | IndexedDB + `reading-content`/existing buckets |
| *(ephemeral, not synced)* | `podcastQueue`, live position | interaction state |

**Keep grouped (do NOT over-split):** all the podcast tier/window/sort prefs (they're small and cohesive); the three radio keys; article metadata fields. The goal is *independent change + appropriate persistence*, not maximal rows.

---

## 13. Local-First Strategy

| Data | Class | Where |
|---|---|---|
| Article metadata, read state, saved/pins | **Local-first** | in-memory + localStorage mirror + `reading` row |
| **Article body text** | **Local-first cache + durable copy** | **IndexedDB** (offline read) + `reading-content` bucket (durable/cross-device); re-fetch as last resort |
| Podcast subscriptions + progress | **Local-first** | in-memory + `podcasts`/`podcastProgress` rows |
| Episode descriptions | **Local cache (derived)** | IndexedDB + lazy re-fetch (already) |
| Music library (refs) | **Local-first** | `music` row; audio blobs already IDB |
| Radio favorites | **Local-first** | `radio` row |
| History / saved | **Local-first** | `mediaHub` row |
| Provider search/catalog/artwork | **Remote/provider-backed** | not persisted (cache only) |
| Queue / live position | **Ephemeral** | memory only |

Net effect: **offline reading and podcast resume work fully**, and the synced rows are small.

---

## 14. IndexedDB Strategy

**Reuse, don't reinvent.** `music-library.js` `createIdbMusicStore` and `music/storage.js` `createIdbStorage` already provide a tested `put/get/getAll/has/delete` object-store wrapper. Introduce a small **shared content store** (or a `reading`-scoped IDB db) with the same shape for:

- **Article bodies** — `store.put("bodies", articleId, { text, fetchedAt, source })`; `ensureArticleText` becomes: check IndexedDB → else bucket → else `fetch-article`.
- **Episode descriptions** — optionally migrate `ensureEpisodeDescription`'s in-memory cache to the same store for offline notes.
- **Future TTS audio** (§16) — same store, `audio` object store.

**Do not** add a new storage library; IndexedDB via the existing wrapper is sufficient. Content in IndexedDB is a *cache*; the **bucket** is the durable cross-device copy (articles from paywalled sources can't always be re-fetched later, so a bucket copy — like `cadence-blobs` — is the safe durability tier).

---

## 15. Database / Sync Strategy

**No new table, no new sync engine.** Still `tableplan_states` rows, just more section ids; still `writeSectionWithMerge` + `mergeStates` + tombstones. Additions:

- **Storage bucket `reading-content`** (private, RLS/owner-scoped like `cadence-blobs`), path e.g. `{userOrHousehold}/{articleId}`. Bodies uploaded on save, downloaded on demand.
- **Section rows** as in §12. Each is small; each syncs independently; conflicts are domain-scoped.
- **Indexes:** none new needed — `tableplan_states` is keyed by `id`; the bucket is keyed by path. (If ArticleContent ever became a real table instead of a bucket — *not recommended now* — it would want a PK on `id` and an FK-ish `owner` for RLS.)
- **Payload/size:** `podcastProgress` row ≈ (#episodes-with-progress × ~80 bytes) → **KB, not MB**; `reading` row = article *metadata* only → **10s of KB**; article bodies **never** touch a synced row.

**Safe to sync:** all metadata sections (id-keyed + tombstones). **Local-first with durable copy:** article bodies (bucket). **Do not sync:** queue/live position.

---

## 16. Compatibility With Calendar / TTS / Interaction Work

**TTS / AI Voice (Kokoro).** Generated speech is **large binary content** → it belongs in the **same content-store tier** (IndexedDB + bucket), *never* in a synced state row. TTS should: produce audio → store in the content store keyed by a stable id → expose a `PlaybackTarget` (`media-model.js`) → play through the **Playback Coordinator** (`playback-coordinator.js`) and the existing audio engine. **The split directly enables TTS** by giving cached speech an obvious home and keeping it out of sync. No separate playback system.

**Interaction / Reordering (Media Queue, Shop, Shopping List).** The split **explicitly separates persistent media state from ephemeral queue/interaction state** (§10/§12): `podcastQueue` and live position become ephemeral (or a tiny isolated row), so the planned drag/reorder/auto-scroll work mutates only trivial state — never the article/music/podcast library. This is a prerequisite for smooth reorder; do it as part of, not after, that work. (The reorder *primitive* itself is separate — see the architecture audit §12.)

**Calendar / Amion.** Reuse the **same patterns**, not the same code: external-source normalization (`calendar/normalize.js`, `calendar/reconcile.js`, `calendar/sources.js`) is the sibling of the media provider→adapter→canonical flow; the content/metadata split mirrors calendar's "store refs + cache, re-fetch feed." No Calendar changes here.

---

## 17. Performance / Reliability Impact (current → proposed, estimates)

| Dimension | Current | Proposed |
|---|---|---|
| **DB write payload (progress tick)** | whole media row, **1–5 MB** | `podcastProgress` row, **~KB** |
| **DB writes / 1-hr listen** | ~120 × multi-MB (**~120–600 MB egress**) | ~120 × KB (**~0.1–1 MB egress**) — **~100–1000× less** |
| **Mark-read burst (scan 20 articles)** | 20 potential full-row rewrites | 20 tiny `reading`-row rewrites |
| **Cold-load download** | all bodies + episodes eagerly | metadata only; bodies lazy |
| **localStorage pressure** | mirror slims under quota (bodies dropped) | bodies never in mirror; quota risk largely gone |
| **Browser memory** | all bodies in memory always | bodies loaded on open, evictable |
| **Startup time** | parse multi-MB media blob | parse small sections |
| **Offline reading** | only if body happened to be in memory | **works** (IndexedDB) |
| **Conflict frequency** | any media edit contends on one row | domain-scoped rows contend rarely |

Reliability: removes the exact condition behind the prior Disk-IO incident (large hot row × frequent writes). Risk of recurrence is structurally prevented, not just rate-limited.

---

## 18. Testing Strategy (write these *before/with* the change; do not implement now)

**Unit / pure:**
- ArticleMeta ↔ ArticleContent split & join round-trips; `text` never present in the `reading` section serialization (**contract test**: `extractSectionData("reading")` output contains no `text`).
- Content-store `put/get/has/delete` (reuse `createMemoryMusicStore`-style in-memory store for tests, like Music already does).
- Section registration completeness (**contract test**: every media-derived key appears in exactly one new section; the union of new sections == old media keys — fails loudly on drift).
- `mergeStates` for each new section (union-by-id + tombstones) — esp. `savedArticles` metadata merge without text.

**Persistence:**
- Save → reload → article metadata present, body lazily resolvable; body survives offline (IndexedDB) and cross-device (bucket).
- `podcastProgress` write does **not** change the `reading`/`music` rows (**isolation test** — the whole point).

**Sync:**
- Concurrent edits: device A marks read, device B saves an article → both survive (union). Progress last-writer by `lastPlayedAt`.
- Tombstone: delete article on A → deleted on B → body GC'd from bucket/IDB (no orphan).
- Duplicate prevention on re-save (existing `savedArticles` dedupe by url/id, `41317`).

**Regression (the behaviors that must not break):**
- Article save / read-unread / pin / delete; podcast subscribe / progress resume / played; music favorite; radio favorite; playback + queue; the "Fetch Article" fallback path; cold start with a large existing media row (migration).

---

## 19. Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Migration data loss** (splitting the live media row) | High | Additive & idempotent one-time in-memory migration on hydrate; **hourly cloud snapshots already exist** (`maybeWriteCloudSnapshot`, keep-30+72); migrate behind a `schemaVersion` bump; validate with the contract test (union of new sections == old keys). |
| **Article body durability** (IndexedDB is device-local; re-fetch is paywalled) | High | Durable **bucket** copy (`reading-content`) as source of truth for bodies; IndexedDB is cache; re-fetch is last resort. |
| **Old client divergence** (two devices, mixed versions) | Med | Personal app, few devices → coordinate the update; during transition keep article **metadata** in a section old clients still read; gate content-strip so an old client seeing `text:null` calls `ensureArticleText`. Prefer a short migration window over long dual-write. |
| **Orphaned content** (body without meta) | Med | Delete body on article delete (tombstone hook); periodic GC pass comparing bucket/IDB keys to live `savedArticles` ids. |
| **Over-normalization** | Med | Sections, not per-entity rows; keep prefs grouped; three radio keys stay together. |
| **More rows → more requests on load** | Low | Load already batches all section rows in **one** `id=in.(…)` fetch (`loadStateFromSupabase`); a few more ids is negligible. |
| **Stale provider metadata** (episodes) | Low | Unchanged from today; descriptions already lazy. |
| **Storage growth in bucket** | Low | Bodies are text (KBs); GC on delete; far cheaper than DB egress. |

---

## 20. Proposed Target Architecture

```text
External providers ──► Netlify function adapters ──► client provider modules ──► canonical MediaItem (media-model.js)
                                                                                        │
                                                                            domain logic (app.js)
                                                                                        │
        ┌───────────────────────────────┬───────────────────────────────┬─────────────┴───────────────┐
        ▼                               ▼                               ▼                             ▼
  In-memory state              Content store (NEW)                Sync layer (existing)         Ephemeral (memory)
  (small metadata)             IndexedDB + bucket                 writeSectionWithMerge          queue, live position
        │                      ├─ article bodies                  + mergeStates + tombstones          (not synced)
        │                      ├─ episode notes (lazy)                    │
   localStorage mirror         └─ future TTS audio                Supabase rows:
   (no bodies)                                                    reading · podcasts · podcastProgress(hot)
                                                                  · music · radio · mediaHub
                                                                  + Storage bucket: reading-content
```

Playback path is unchanged and shared: `playback source (incl. future TTS) → Playback Coordinator → audio engine`.

---

## 21. Implementation Plan (small, independently-verifiable phases)

Each phase is shippable and reversible on its own.

- **Phase 0 — Scaffolding & tests (no behavior change).** Add a shared content-store module (thin wrapper over the existing IDB primitive) + a memory store for tests. Write the §18 contract tests against a helper that computes the *proposed* section split from `STATE_SECTIONS.media` (pure, no wiring yet). *Verify: tests green, build clean, app unchanged.*

*(Re-ordered per §0: content-out first with IndexedDB **and** bucket together; section-split demoted. The write-echo emergency is already handled by `f545ca9`.)*

- **Phase 0 (infra, Luke) — create the `reading-content` bucket.** A private Supabase Storage bucket with owner/household-scoped RLS (mirror `cadence-blobs`). I provide exact SQL/dashboard steps; Luke creates it. *Gate for Phase 1's durable copy.*

- **Phase 1a — Content store module + tests (no behavior change).** Add a shared content-store abstraction over the existing IndexedDB primitive (reuse `music-library.js` `createIdbMusicStore` shape) + a memory store for tests + a bucket adapter (reuse `music/cloud-blob.js`). Pure/unit tested. *Verify: tests green, build clean, app unchanged.*

- **Phase 1b — Dual-write bodies (still no read change, no regression).** On article save, write the body to IndexedDB **and** upload to the bucket, keeping `savedArticles[].text` in state for now. Backfill: one-time pass moves existing bodies from state → content store. *Verify: bodies land in IDB + bucket; nothing user-visible changes yet.*

- **Phase 1c — Flip reads to the content store, then strip from sync.** `ensureArticleText` resolves **IndexedDB → bucket → `fetch-article`**; once bodies are confirmed durable in the bucket, **strip `savedArticles[].text` in `extractSectionData`** (like episode descriptions today). *Verify: cold-load download shrinks to metadata; **offline reading works**; cross-device open pulls from bucket; save/read/fetch-fallback regress-tested. This is the remaining read-on-load egress win.*

- **Phase 2 — Ephemeral queue.** Move `podcastQueue`/live position out of synced state (memory or a tiny row), aligning with the Media-Queue interaction work. *Verify: reorder mutates no heavy row.*

- **Phase 3 (demoted — architecture/ingress, not egress) — section-split.** Introduce `reading` / `podcasts` / `podcastProgress` / `music` / `radio` / `mediaHub` sections; register in `STATE_SECTIONS`/defaults/normalize/merge; one-time in-memory migration on hydrate; retire the monolithic `media` id (read-migration shim). *Verify: each sub-domain persists independently; contract test (coverage == old keys) green.* **Lower priority now** — the write-echo fix already made the hot writes cheap.

- **Phase 4 — Validate & clean up.** Lightweight write-size/frequency telemetry to confirm egress; formalize episode notes / TTS audio onto the same content store; remove legacy shims once all devices are migrated.

---

## "If This Were My Codebase"

**Do First (smallest, highest value):** **content-out, done durably** (Phase 0→1c): create the `reading-content` bucket, build the local-cache + durable-bucket content store, dual-write + backfill bodies, flip `ensureArticleText` to IndexedDB→bucket→`fetch-article`, then strip `savedArticles[].text` from the synced row. Low-risk because the re-fetch fallback and the Cadence blob/IDB pattern already exist. This removes the **read-on-load** egress (bodies no longer download on every cold start) and delivers **offline reading** with **zero cross-device regression** (bucket lands before the strip). *Note: the write-side egress emergency was already resolved separately by `f545ca9`.*

**Do Next:** **Phase 2** make the podcast queue ephemeral (do it *with* the Media-Queue interaction work). Then, only when convenient, **Phase 3** the section-split — it's an architecture/ingress cleanup now, not an egress lever, since the write-echo fix already made hot writes cheap.

**Avoid:** per-entity DB rows or a normalized relational media schema (the section-row + `mergeStates` model is enough and far simpler); a new storage library (reuse the Music/Cadence IndexedDB wrapper); a long dual-write window (prefer a short coordinated migration + the existing snapshots as the safety net); over-splitting small cohesive prefs/radio keys.

**Preserve:** `media-model.js` / `media-provider.js` / `playback-coordinator.js` / `media-state.js` (models, registry, coordinator, canonical stores) — this changes *persistence*, not them; the section-sync engine (`writeSectionWithMerge`, `mergeStates`, tombstones, `schemaVersion`); the Cadence blob/metadata pattern (it's the template); the 30s-min-interval/debounce (still useful as a second line of defense).

**Expected Outcome (measurable):** per-write cloud payload for media drops from **MB → KB**; egress during a 1-hour listen drops **~100–1000×**; cold-load parse size shrinks; **offline reading and podcast resume work**; the queue-reorder path touches only trivial state; and TTS audio has a ready home — with **no regression** to saving, reading, subscriptions, progress, music, radio, or playback, and **no possibility of the hot-row problem recurring** because heavy content and hot keys no longer share a persistence unit.

---

*Prepared read-only. No code, schema, migration, config, dependency, test, or infrastructure was modified; nothing was committed. All sizes are code-derived estimates, not production measurements; the RLS scoping of any new `reading-content` bucket must be verified during implementation (I did not run SQL).*
