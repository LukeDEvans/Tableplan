# Local-First Foundation — Design Audit (read-only)

> **Status:** design-first investigation, 2026-08-29. No code was changed. This
> document is the input to a *later* implementation prompt; it deliberately stops
> at "what to build and in what order," not "how to build it."
>
> **One-line answer:** the app is already ~80% local-first for *structured* data
> via the state-section + localStorage-mirror + `mergeStates` system, and Cadence
> already contains the *exact* content-store pattern the Media design needs. The
> smallest useful foundation is **not** a new framework — it is **extracting
> Cadence's `StoragePort` + `BlobAsset` + content-addressed cloud-blob into one
> shared content-store module**, and letting Media's article bodies be its first
> new consumer. Structured-data sync needs **no redesign**.

---

## 0. TL;DR for reviewers

- **Keep** the state-section / `writeSectionWithMerge` / `mergeStates` / localStorage-mirror system. It is section-granular, optimistic, tombstoned, retrying, and re-flushes on reconnect. It is the structured-data local-first substrate and it works.
- **The shared infrastructure genuinely worth having is a content store**, and it already exists as `music/storage.js` (`StoragePort`) + `music/blob.js` (`BlobAsset`) + `music/cloud-blob.js` (content-addressed Supabase Storage). Generalize *that*, don't invent one.
- **Build first:** lift Cadence's three blob modules into a domain-neutral `content-store/` and make **Media article bodies** the first new consumer (this is already the locked `MEDIA_STATE_SPLIT_DESIGN.md`). It kills the real, logged media-section Disk-IO pain and validates the shared store on a second domain.
- **Do not** build a universal repository/data-manager, CRDTs, event sourcing, realtime, or force provider data into local canonical ownership.
- **Structured data ≠ large content.** They already use different strategies (state JSONB vs IndexedDB+Storage). Make that boundary explicit and shared; don't collapse them.

---

## 1. Current persistence architecture (traced end-to-end)

Evidence: `app.js` (`persist`, `mirrorStateToLocalStorage`, `writeSectionWithMerge`, `loadState`, `hydrateStateFromSharedStorage`, `STATE_SECTIONS` registry ~272–292), `state-sync.js`, `music/storage.js`, `music/cloud-blob.js`, `netlify/functions/_state-sections.js`, `sw.js`, `eat_recipes`/`eat_folders` tables.

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ IN-MEMORY  `state` (one object; the working truth the UI renders)        │
 └───────────────┬───────────────────────────────┬─────────────────────────┘
        persist() │ (stamps stateUpdatedAt)       │ Cadence (bytes)
                  ▼                               ▼
   ┌───────────────────────────┐     ┌──────────────────────────────────────┐
   │ localStorage MIRROR        │     │ StoragePort (music/storage.js)        │
   │  STORAGE_KEY (whole state) │     │  IndexedDB "cadence": bytes + JSON     │
   │  • finance EXCLUDED (priv) │     │  record stores. put/get/getAll/has/    │
   │  • strips episode notes +  │     │  delete; memory fake for tests/offline │
   │    article text under ~5MB │     └───────────────┬──────────────────────┘
   │  • boots the app OFFLINE   │        bytes (sha-256, immutable)
   └───────────────┬───────────┘                     ▼
      saveStateToSharedStorage() (debounced,   ┌──────────────────────────────┐
      retrying, re-flush on reconnect)         │ Supabase STORAGE bucket       │
                  ▼                            │ "cadence-blobs" content-addr.  │
   ┌───────────────────────────────────────┐  │ uploadBlob/downloadBlob        │
   │ Supabase Postgres                      │  └──────────────────────────────┘
   │  tableplan_states.state JSONB          │
   │   • per SECTION row (personal/group)   │  Recipes are the ONE relational
   │   • compare-and-swap on updated_at     │  exception:
   │   • mergeStates on conflict, tombstones│   eat_recipes / eat_folders rows
   │   • schemaVersion + writer trigger     │  (hydrateRecipeRowsFromSupabase)
   └───────────────────────────────────────┘
```

Per-mechanism ownership:

| Mechanism | Owns | Canonical? | Cache? | Durable? | Local-first? | Offline? |
|---|---|---|---|---|---|---|
| In-memory `state` | working truth | yes (session) | no | no | yes | yes |
| localStorage mirror (`STORAGE_KEY`) | offline copy of `state` (minus finance, minus big content under quota) | no | yes (of `state`) | no (device-only, evictable) | **yes** (boots offline) | yes |
| `tableplan_states` JSONB (sectioned) | durable structured state | **yes** (durable) | no | yes | yes (written async) | writes queue+retry |
| `eat_recipes`/`eat_folders` | recipes (large, list-queried) | **yes** | no | yes | partial (hydrated to `state.recipes`) | reads need net first time |
| Cadence `StoragePort` (IndexedDB) | score/recording **bytes** + Cadence records | local substrate | partial | no | **yes** | yes |
| Supabase Storage `cadence-blobs` | durable score/recording **bytes** | **yes** (durable backstop) | no | yes | n/a (backstop) | fetch on demand |
| Service worker `sw.js` | app-shell + static assets | no | yes | no | app-shell only | serves shell offline |
| Provider caches (weather/ICS/etc.) | fetched provider data | no (provider is) | yes | no | no | stale-until-refetch |

**Reads:** UI reads in-memory `state` (instant). Boot hydrates from localStorage mirror first (offline-capable), then reconciles with Supabase. Cadence bytes read StoragePort → else download from bucket.

**Writes:** mutate `state` → `persist()` → localStorage mirror (sync) + debounced Supabase section write (async, retrying). Cadence bytes → StoragePort (sync-ish) + async bucket upload.

---

## 2. Current sync architecture (what we already have)

Evidence: `writeSectionWithMerge` (compare-and-swap on `updated_at` via `lastSeenSectionStamp`; `mergeStates` on conflict; egress-optimized `select=updated_at`); `state-sync.js` (`unionById`, `unionStrings`, `unionByKey`, `mergeTombstones`); `_state-sections.js` (server mirror of the same optimistic loop); `STATE_SCHEMA_VERSION = 2` + `tp_protect_finance_merge` trigger + `x-live-writer` header; `saveStateToSharedStorage` (debounce + backoff retry + `handleCameOnline` re-flush).

**Already good:**
- **Section-granular** writes — changing one section doesn't rewrite others (except the whole-section blob is rewritten; see granularity §11).
- **Optimistic concurrency** — conditional PATCH on `updated_at`; 0-rows-matched ⇒ fetch-merge-retry. No last-write-wins clobber.
- **Merge, not overwrite** — `mergeStates`: `unionById` for id-keyed arrays, tombstones for deletes, deep-merge for finance, newer-wins for scalars. This is the hard part and it's done + tested (`state-sync.test.js`).
- **Fail-closed guards** — finance-protect DB trigger + schemaVersion prevent a stale/older-code device from wiping budget/annotations.
- **Offline resilience** — write to memory+localStorage immediately; cloud write debounced, retried with backoff, and re-flushed on reconnect.

**Problems / limits for full local-first:**
- **Whole-section blob write.** A section is one JSONB row; a one-field change rewrites and re-transmits the whole section. Fine for small sections; the **media section is multi-MB and IO-hot** (article text + episode notes rewritten on every media interaction → the logged Disk-IO pressure). This is the single biggest structural problem, and it's a *content-in-structured-state* problem, not a sync-model problem.
- **localStorage mirror is bounded (~5 MB) and lossy under quota** — it strips article text/episode notes to fit. So large content is *not* reliably offline via the mirror.
- **No explicit offline mutation queue per entity.** The retry loop re-flushes the *current* `state`, which is correct for convergent state but means an offline write is only as durable as the localStorage mirror until reconnect. Acceptable today.
- **Assumption:** each section is small enough to load/merge/transmit whole. True everywhere except media.

**Verdict:** the sync model is **sufficient** for local-first *if large content leaves the state sections*. See §10.

---

## 3–4. Domain audit + local-first readiness matrix

Evidence-based. "Store" = where the durable copy lives today.

| Domain | Canonical / Store | Local today | Remote today | Mutations | Offline usability | Size | Provider dep. | Class | First-move difficulty |
|---|---|---|---|---|---|---|---|---|---|
| **Tasks (Do/Play)** | `state` section | mirror | `tableplan_states` | in-app | full | small | none | **Already local-first** | — |
| **Checklists / daily-dozen / food-health** | `state` | mirror | sectioned | in-app | full | small | none | Already local-first | — |
| **Shopping** | `state` (grocery) | mirror | sectioned | in-app | full | small | none | Already local-first | trivial |
| **Inventory** | `state` | mirror | sectioned | in-app | full | small | none | Already local-first | trivial |
| **Recipes** | **`eat_recipes` table** → `state.recipes` | mirror (of hydrated) | relational rows | in-app + extension | read needs net first hydrate | medium | import providers | Local-first ready (row store already durable) | low |
| **Meal planning** | `state` (plan/mealPlanConfig) | mirror | sectioned | in-app | full | small–med | none | Already local-first | — |
| **Calendar (local events)** | `state.planEvents` | mirror | sectioned | in-app | full (local); ICS cached | med | ICS/Google (external cals) | **Mixed** (local events app-owned; subscriptions provider-owned) | medium |
| **Media hub / Watch** | `state` (media section) | mirror (lossy) | sectioned (IO-hot) | in-app | metadata yes; content no | **large** | TMDB/Jellyfin | **Candidate** (split content out) | — |
| **Articles (reading)** | `savedArticles` in media section | mirror strips `text` | sectioned | in-app + extension | metadata yes; **body no** | large body | source sites | **Mixed + Content** (metadata app-owned; body → content store) | **best first content migration** |
| **Podcasts** | `state` (subs/progress/tiers) + episode notes in state | mirror strips notes | sectioned | in-app | subs/progress yes; notes no | large notes | RSS/index | **Mixed + Content** (list app-owned; episode meta provider; notes → content) | medium |
| **Music (streaming)** | `state` (library/favorites) | mirror | sectioned | in-app | metadata yes | small meta | IA/Jamendo/Jellyfin | **Provider-backed** (streams stay network) | n/a |
| **Cadence (piano)** | domain records in `state` + **bytes in StoragePort/Storage** | **IndexedDB + mirror** | sectioned meta + `cadence-blobs` | in-app | **full (metadata) + bytes on demand** | large bytes | none (import) | **Already local-first (reference impl)** | — |
| **Finance** | `state` (finance section) | **NOT mirrored (privacy)** | sectioned + protect trigger | in-app + SimpleFIN | **no offline (by design)** | medium | SimpleFIN (bank) | **Mixed** (annotations app-owned; bank facts provider-owned) | keep as-is |
| **Settings** | `state` (config keys) | mirror | sectioned | in-app | full | tiny | none | Already local-first | — |
| **Weather / TMDB / Jellyfin / ICS** | provider | cached | function proxy | read-only | stale cache | var | **yes** | **Provider-backed** | n/a |

**Reading the matrix:** the *structured* domains are already local-first or one row-store away from it. The real local-first frontier is **large content** (article bodies, episode notes, TTS/Kokoro audio, score bytes, images) — which is exactly where Cadence + the Media design already point.

---

## 5. Cadence study — the reference implementation

Evidence: `music/storage.js`, `music/blob.js`, `music/domain.js`, `music/cloud-blob.js`, `music/import.js`, `music/practice.js`, wiring in `app.js` (~34624–35174), tests `music-blob.test.js`, `music-cloud-blob.test.js`, `music-*`.

What Cadence does:
- **Canonical metadata** (`Work`, `Representation`, `BlobAsset`, `practiceSession`, `annotation`) are small JSON records. They ride the **existing state-section sync** (`cadenceUpsert(...) → persist()`), merged like any id-keyed list. `cadenceMergedLibrary(localWorks)` = local ∪ synced-from-other-devices.
- **Bytes** (score files, recordings) live behind a **`StoragePort`** — one tiny interface (`put/get/getAll/has/delete/close`) with a `bytes` store keyed by `blobId`, an **IndexedDB** impl and an **in-memory fake**. "Bytes and metadata are deliberately separate — the sync layer only ever carries the small records, never blobs."
- **`BlobAsset` catalog** decouples domain records from any device's IndexedDB key: records reference a stable `blobId`; the catalog carries **content identity** (`sha-256` hash, size, MIME, `ownership: "owned" | "cache"`, provenance). `blobAvailability(asset, hasLocalBytes)` projects availability.
- **Durable backstop**: `music/cloud-blob.js` uploads bytes to a private Supabase Storage bucket, **content-addressed by sha-256** (`userId/hash`), idempotent (409 = success), corruption-detectable, dedup-by-hash. The Storage client is **injected** → pure/testable → **home-server-swappable**.
- **Offline**: everything lands in the StoragePort so an offline reload works; a device with synced metadata but no local bytes downloads them on demand.

**Which Cadence patterns are genuinely reusable:**

- **Reusable now (this is the shared foundation):**
  1. `StoragePort` — the local put/get/getAll/has/delete substrate with a memory fake and an IndexedDB impl, backend-swappable.
  2. `BlobAsset` content-identity catalog — `blobId` + `sha-256` + size + MIME + `ownership: owned|cache` + `blobAvailability`.
  3. Content-addressed cloud blob — `uploadBlob/downloadBlob/blobPath(userId, hash)` over injected Storage.
  4. The **discipline** "metadata syncs via state sections; bytes never enter the JSONB."
- **Potentially reusable later:** the "backfill local → sync" one-time lift (`cadenceBackfillLocalToState`) as a migration recipe; `ownership: owned|cache` eviction policy.
- **Cadence-specific (do NOT generalize):** MusicXML parsing/export, ScoreModel, pitch/alignment/following-engine, measure identity, renderers. These are domain logic, not infrastructure.

**Caveat:** Cadence is the reference *architecture*, not a finished cross-device story — metadata syncs but on-demand byte hydration to a second device is the known soft spot ("score not on iPad"). The generalized content store should make **availability + hydrate-on-demand** a first-class, tested concern (it isn't fully today).

---

## 6. The locked Media content-store design — what it teaches

`MEDIA_STATE_SPLIT_DESIGN.md` (locked 2026-08-25) proposes: article body as a **separate content record keyed by article id**; `savedArticles` stays the **metadata carrier**; content store = **IndexedDB (fast/offline) → Supabase Storage (durable) → re-fetch**; explicitly intended to later carry **episode notes and TTS/Kokoro audio**.

This is **the same pattern as Cadence**, arrived at independently for a second domain. That convergence is the strongest possible signal that the content store is real shared infrastructure — not speculative.

**Is the content-store abstraction shared infrastructure? Yes.** Smallest useful shape (a superset-compatible generalization of Cadence's three modules):

```
ContentStore (domain-neutral)
  getBytes(contentId)            → Uint8Array | undefined   (local StoragePort first)
  putBytes(contentId, bytes, {mime, ownership})  → BlobAsset (hash, size)
  has(contentId)                 → boolean
  delete(contentId)
  ensureAvailable(contentId)     → Uint8Array   (local → bucket download → cache)
  // metadata (BlobAsset catalog) lives in a normal state section and syncs there
```

- **Shared:** the StoragePort (IndexedDB local), the BlobAsset catalog shape, the content-addressed bucket upload/download, `ensureAvailable` (local→remote→cache), ownership/eviction.
- **Media-specific (stays in Media):** what a "content record" *is* (article body HTML vs episode-notes vs a TTS audio clip), which entity id maps to which contentId, when to fetch/purge, and the article/podcast domain models. The content store stores bytes; it does not know they are articles.

The one difference to reconcile: Cadence content-addresses by **hash** (immutable score bytes, natural dedup); Media keys by **article id** (mutable-ish body). The shared store should support **both an addressing mode (content-hash) and a logical key (`domain:entityId`)** — hash for immutable dedup-worthy blobs (audio, scores), logical key for "the current body of article X." That's a small, concrete API decision, not a redesign.

---

## 7. Structured data vs large content — the load-bearing boundary

Make this boundary explicit and permanent:

```
STRUCTURED DATA (tasks, shopping, inventory, calendar, subscriptions,
progress, settings, metadata, annotations)
    → in-memory state → localStorage mirror → tableplan_states sectioned JSONB
    → sync via writeSectionWithMerge + mergeStates
    Properties: small, changes together, read together, merges well, cheap to transmit.

LARGE CONTENT (article bodies, episode notes, TTS/Kokoro audio, score/recording
bytes, images/thumbnails)
    → ContentStore: StoragePort (IndexedDB) local  +  Supabase Storage durable
    → referenced from a structured record by contentId; NEVER inside the JSONB
    Properties: large, independent, cacheable, immutable or replace-whole, dedup-worthy.
```

IndexedDB is **not** the answer for everything: structured state is small, merges field-wise, and benefits from the JSONB+mergeStates machinery; putting it in IndexedDB buys little and loses the tested merge. IndexedDB *is* the answer for large content (no ~5 MB cap, binary-native, off the IO-hot sync path). This is precisely how Cadence already splits, and how Media plans to.

---

## 8. What "local-first" should mean *here* (explicit)

Not the maximalist CRDT definition. For this app:

1. **Reads prefer local.** UI renders in-memory `state`; boot hydrates from the localStorage mirror before the network. (True today.)
2. **Writes succeed locally without the network.** Mutate `state` → `persist()` returns immediately; the cloud write is async. (True today for structured data.)
3. **UI is optimistic.** Already the norm.
4. **Remote failure never destroys local work.** Retry + re-flush on reconnect; finance-protect trigger. (True today.)
5. **State eventually converges** via `mergeStates` + tombstones + optimistic CAS. (True today.)
6. **External providers may stay network-dependent.** Weather/TMDB/Jellyfin/banking are *not* forced local; they cache. (Correct — keep.)
7. **Large personal content has a real local substrate** (IndexedDB) + durable backstop (Storage), independent of the ~5 MB mirror. (True for Cadence; *the gap for Media/podcasts/TTS* — the thing to build.)
8. **The app starts offline.** (True today via the mirror + SW app-shell.)

So the *only* structural gap between today and "local-first" is **#7 for non-Cadence large content.** Everything else is already there.

---

## 9. Ownership model (drives conflict + cache invalidation)

| Ownership | Domains | Local strategy | Sync | Conflict | Cache invalidation |
|---|---|---|---|---|---|
| **App-owned personal** | tasks, shopping, inventory, meal plan, local calendar events, playback progress, tiers, Cadence records, finance annotations | authoritative locally; full offline read/write | state-section merge | `mergeStates` (union/tombstone/newer-wins) | n/a (app is truth) |
| **Provider-owned** | weather, TMDB, Jellyfin catalog, banking facts, external-cal source events, RSS episode metadata | **cache only**, never canonical | not synced as truth; re-fetched | provider wins on refresh | TTL / re-fetch; never merge into canonical |
| **Mixed** | saved articles (app: saved?/tags/read-state/**body-as-content**; provider: original URL/site), podcast subs (app: subscribed/progress/tiers; provider: episode list), imported calendar events (app: local overrides/exclusions; provider: source event) | app fields local-first; provider fields cached | app fields via sections; provider fields re-fetched | **field-level:** app fields merge; provider fields overwrite-from-source | provider fields invalidate on re-fetch; app fields sticky |

**Rule that prevents most bugs:** never let a provider refresh overwrite an app-owned field, and never sync a provider-owned field as if it were canonical. The Media design's "local override survives the next sync" is exactly this; generalize the *principle*, not a framework.

---

## 10. Is the existing sync model sufficient? (mostly yes)

- **No change needed:** the CAS + `mergeStates` + tombstone + retry model is adequate for all structured/metadata data, including Cadence records, *provided sections stay small*.
- **Minor extension (later, optional):** (a) allow the localStorage mirror to spill to an IndexedDB record store to remove the ~5 MB cliff for structured state (low priority — structured state is small); (b) make **content availability/hydrate-on-demand** a shared, tested concern (Cadence's soft spot). Neither is a sync redesign.
- **Significant redesign (NOT needed, do not do):** entity-per-row sync, CRDTs, event sourcing, realtime. The moment large content leaves the sections, the section model is comfortable.

**Conclusion:** the current sync system *can* support the target architecture. The lever is **persistence granularity of content**, not sync mechanics.

---

## 11. Persistence granularity — the right units

Principle: *independently-changing data should not force rewriting unrelated data*, without over-normalizing.

- **Keep sections as the structured unit.** They already group "changes together / reads together." Don't shard tasks into per-task rows — the merge machinery + whole-section load are a feature at this size.
- **Split the media section's *content* out** (article bodies, episode notes) into the ContentStore keyed by entity id. The metadata (`savedArticles`, subscriptions, progress) stays a normal small section that merges cheaply. This single move fixes the IO-hot rewrite problem.
- **Content is its own unit, addressed two ways:** immutable/dedup-worthy blobs by **content hash** (audio, scores, images); "current version of X" by **logical key** `domain:entityId` (article body). Both live in the ContentStore.
- **Do not** promote every entity to a Supabase row. Recipes are relational because they're large, list-queried, and independently mutated at volume — that bar is high; most domains don't meet it.

---

## 12–14. The minimal foundation + conceptual API (resist the giant abstraction)

**The correct architecture is "a few shared primitives + domain-specific implementations," not one universal repository.** A universal data-manager would fight the two systems that already work (JSONB+mergeStates for structured; StoragePort+Storage for content) and add a layer nobody asked for.

Components, each judged against "does it already exist?":

| Candidate primitive | Need it? | Already exists? | Verdict |
|---|---|---|---|
| Local structured store | yes | **yes** — `state` + localStorage mirror + sections | reuse; do not rebuild |
| Change tracking / CAS | yes | **yes** — `lastSeenSectionStamp` + `updated_at` | reuse |
| Merge/conflict | yes | **yes** — `state-sync.js` (`mergeStates`, tombstones) | reuse |
| Sync adapter | yes | **yes** — `writeSectionWithMerge` + shared-storage provider | reuse |
| Entity identity | yes | **yes** — `createId` + id-keyed unions | reuse |
| **Content/blob store** | **yes** | **yes, but Cadence-scoped** — `StoragePort`+`BlobAsset`+`cloud-blob` | **extract → shared** |
| Offline mutation queue | not yet | partial (retry re-flush) | defer; only if a domain needs per-op ordering |
| Provider adapter layer | yes | **yes** — `media-provider*`, calendar `sources`, function proxies | reuse; keep separate |
| Serialization/versioning | yes | **yes** — `STATE_SCHEMA_VERSION` + finance trigger | reuse |

**Net:** exactly **one** primitive is worth extracting/generalizing — the **ContentStore** (from Cadence). Everything else already exists and should be reused, not re-abstracted.

Conceptual interfaces (illustrative; the real ones already live in `music/storage.js` / `music/blob.js` / `music/cloud-blob.js`):

```
StoragePort (local; = music/storage.js today)
  put(store, key, value) / get(store, key) / getAll(store) / has(store, key) / delete(store, key) / close()

ContentStore (thin domain-neutral layer over StoragePort + cloud-blob)
  putBytes(key, bytes, {mime, ownership, hash?}) → BlobAsset
  getBytes(key) → Uint8Array | undefined            # local only
  ensureAvailable(key) → Uint8Array                  # local → bucket → cache
  has(key) → boolean ;  delete(key)
  # key is either a content-hash (immutable) or "domain:entityId" (logical)

BlobAsset (catalog record, lives in a state section; = music/blob.js today)
  { blobId, key, hash, size, mimeType, ownership: "owned"|"cache", provenance, cloud?: {bucket,path} }

CloudBlob (durable; = music/cloud-blob.js today, client injected)
  upload({userId, hash|path, bytes, mime}) / download({bucket, path})
```

No `SyncAdapter`/`ChangeTracker`/`Repository` needs inventing — those roles are filled.

---

## 15. Offline mutation model (does it match today?)

```
User action → validate locally → write state → render (optimistic)
            → persist(): localStorage mirror (sync) + debounced cloud section write
            → online?  yes → CAS PATCH → 0-rows? fetch+mergeStates+retry
                       no  → status "offline"; re-flush on reconnect
Large content: write StoragePort (local) now; upload to bucket async/retry;
               BlobAsset.ownership tracks owned vs cache.
```

This **already matches** the app for structured data. The content half matches Cadence; Media/podcasts/TTS just need to adopt it. Conflicts converge via `mergeStates` (structured) and content-addressing/replace-whole (content — no field-merge needed for a blob). No new flow to design.

---

## 16. Multi-device (practical, not distributed-DB)

- **Metadata** converges through the existing section CAS+merge — already multi-device-correct.
- **Offline edits on two devices** → both re-flush on reconnect; `mergeStates` unions id-keyed lists and honors tombstones. Existing behavior; keep.
- **Large content** → content-addressed by hash means the same bytes uploaded by two devices are one object (idempotent). Logical-key content (article body) is replace-whole; last-writer's body wins — acceptable (bodies aren't concurrently hand-edited).
- **Stale device** → schemaVersion + finance-protect trigger already guard the dangerous case; extend the *principle* only if a new high-value field needs it.
- **Storage limits / eviction** → `ownership: owned|cache` lets the app evict `cache` bytes first and re-hydrate from the bucket; never evict `owned` without an upload confirmation. Make eviction a shared, tested policy.
- **Do not** build vector clocks / CRDTs / a sync server. Convergent union+tombstone is enough for personal data.

---

## 17. PWA / browser constraints (must-respect)

- **IndexedDB** is the right local substrate (binary, large, async); already used by Cadence. Good cross-browser support.
- **Persistence/eviction:** browser storage is **best-effort and evictable**. Request `navigator.storage.persist()` at an appropriate moment; treat local content as a **cache that can vanish**, backstopped by Supabase Storage. Never make IndexedDB the *only* copy of `owned` content.
- **Quotas:** localStorage ~5 MB (already the pain — mirror strips content); IndexedDB quota is much larger but still bounded and evictable. Track usage; evict `cache` first.
- **iOS PWA reality:** Safari can evict IndexedDB after ~7 days of non-use; **no reliable Background Sync**; storage is more fragile. ⇒ design must (a) always have the Supabase backstop, (b) re-hydrate on open, (c) not depend on background sync — foreground re-flush only (which is what the app already does).
- **Service worker:** current `sw.js` is network-first navigation + SWR statics, **no IndexedDB, no Background Sync**. Fine — keep the SW dumb; do content/sync in the app, not the SW.
- **Private browsing:** IndexedDB may be unavailable/ephemeral → `StoragePort` must fall back to the memory impl (Cadence already does). Keep that fallback.

**Takeaway:** treat local content as a *fast, evictable cache with a durable remote backstop* — exactly the Cadence/Media model. Do not assume native persistence guarantees.

---

## 18. Security / privacy (decisions to make deliberately)

- **Finance is deliberately never mirrored to localStorage** (lost/shared device shouldn't carry the ledger). Any local-content work **must preserve this** — do not put finance (or other sensitive) bytes in IndexedDB without a decision. Open question: should IndexedDB content be scoped/cleared on logout?
- **Logout:** today logout clears session; it does **not** wipe IndexedDB content. Decide whether logout should purge local content (privacy) vs keep it (offline convenience on a personal device). Recommend: purge `cache`, keep `owned` only if a single-user device flag is set; safest default is purge-on-logout.
- **Encryption at rest:** browser storage is not encrypted by the app. For sensitive content, either don't store locally (finance) or accept device-trust. Don't roll app-level crypto without a real threat model.
- **Signed Storage URLs / RLS:** the Supabase Storage bucket is private and user-scoped (`userId/hash`); downloads go through the authed client. Keep buckets private; never embed long-lived signed URLs in synced state.
- **Cross-user isolation:** content keys are user-scoped in the bucket path; keep StoragePort per-user (or clear on user switch) so device-shared browsers don't leak.
- **Provider credentials:** stay server-side (Netlify functions); never cache bank/provider secrets locally.

---

## 19. Migration strategy — safest first domain

Candidates weighed on value × (1/risk) × offline-usefulness × testability:

| Candidate | Value | Risk | Offline value | Notes |
|---|---|---|---|---|
| Shopping (structured) | low | low | already local-first | **not worth it** — it's already local-first; nothing to gain |
| Recipes → deeper local | med | med | med | already row-backed; not the frontier |
| **Media *article bodies* → ContentStore** | **high** | med | **high** | fixes logged Disk-IO; already the *locked* Media design; validates shared store |
| Podcast episode notes → ContentStore | high | med | high | second consumer; do right after articles |
| TTS/Kokoro audio → ContentStore | med | med | high | natural third; hash-addressed audio |
| Finance offline | low | **high** | intentionally none | **don't** — privacy stance is deliberate |

**Best first migration is NOT a structured domain — it's the content store, with Media article bodies as its first consumer.** Rationale: (1) reuses proven Cadence code (low novelty risk); (2) solves a *real, logged* problem (media-section Disk-IO); (3) is already designed and review-locked; (4) proves the shared store on a second domain before any generalization hardens. Shopping is explicitly *not* the answer — it's already local-first, so migrating it teaches nothing and gains nothing.

---

## 20. Testing foundation (write before/with the migration)

- **StoragePort/ContentStore:** local put/get/has/delete/getAll; memory-fake parity with IDB; `ensureAvailable` local-hit / bucket-hit / re-fetch / missing; oversized content; ownership owned-vs-cache; eviction preserves `owned`.
- **Content ↔ metadata:** metadata record references a `contentId`; deleting metadata tombstones + optionally purges content; re-hydrate on a "fresh device" (empty StoragePort, populated bucket).
- **Sync (regression, already partly covered by `state-sync.test.js`):** push/pull, retry, duplicate changes, concurrent edits, tombstones, conflict merge — *these must stay green* since we're not changing sync.
- **Migration:** existing user with article text in `savedArticles` → lift into ContentStore idempotently; partial migration; failure mid-lift leaves state readable; rollback (content store optional, metadata still renders); idempotent re-run.
- **PWA:** IndexedDB-unavailable falls back to memory; eviction simulation re-hydrates from bucket; logout purge policy.

Do **not** implement these now — this is the spec for the implementation prompt.

---

## 21–22. Context Engine + AI boundary (architectural requirements)

The point of all this is to make **canonical, local, deterministic facts** queryable without any storage/sync/provider knowledge leaking upward:

```
Local/Canonical Domain Data → Domain Queries → Context Engine → Derived Facts → Today/Home
                                                     ↓
                                          (later) Optional AI interpretation
```

Requirements the local-first foundation must satisfy for this to be clean:
- **Canonical read API per domain** that returns plain facts (`tasksDueToday()`, `savedArticlesUnread()`, `nextPractice()`), reading in-memory `state` + ContentStore — never Supabase/IndexedDB/provider APIs directly. Several already exist ad hoc; the discipline is to keep the Context Engine consuming *these*, not stores.
- **Provider vs app ownership must be explicit** (§9) so the Context Engine can trust app-owned facts and treat provider facts as possibly-stale.
- **Content is referenced, not embedded** — the Context Engine gets "article X, 1,200 words, unread," not the bytes; it asks the ContentStore only if it needs the body.
- **AI stays downstream:** AI must never *retrieve* state, *decide truth*, *sync*, or *resolve persistence*. It consumes derived facts. The local-first foundation *enables* this by making deterministic facts cheap and offline — which is the whole "maximize deterministic hard-fact processing before AI" goal.

No Context Engine or AI is designed or built here; these are the constraints so we don't paint ourselves into a corner.

---

## 23. Candidate architectures compared

**Option A — Minimal evolution.** Keep everything; just move media content out of the section into a Media-local IndexedDB store (no shared abstraction).
- Complexity: lowest. Migration: small. Risk: low. Offline: fixes media. Sync: unchanged. Fit: high. **Weakness:** Cadence and Media each own a parallel content store → duplication, and TTS/podcast-notes rebuild it a third time.

**Option B — Shared local-first *primitives* (recommended).** Extract Cadence's `StoragePort`+`BlobAsset`+`cloud-blob` into a domain-neutral `content-store/`; Media/podcasts/TTS become consumers; structured sync untouched.
- Complexity: low–moderate (mostly *extraction* of proven code). Migration: incremental. Risk: low (code already tested/injected/pure). Offline: fixes media + future content. Sync: unchanged. Fit: highest — it's literally the pattern the codebase already converged on twice.

**Option C — Universal repository / data-manager.** One abstraction over structured + content + sync + providers.
- Complexity: high. Migration: large, invasive. Risk: high (fights two working systems). Offline: no better than B. **Reject** — this is the giant abstraction §13 warns against.

**Recommendation: Option B.** It is the smallest change that removes the real duplication risk, reuses tested code, and fits the app's own emergent design.

---

## 24. Target architecture

```
                      External Providers (TMDB, Jellyfin, RSS, ICS, SimpleFIN, weather)
                                   ↓  (network, may stay online-only)
                            Provider Adapters (media-provider*, calendar/sources, fn proxies)
                                   ↓  (normalize; provider-owned = cache)
                            Canonical Domain Models  (media-model, calendar/*, music/domain, …)
                                   ↓
                              Domain / Application (app.js domains; canonical read APIs)
                    ┌───────────────────────────────┴───────────────────────────────┐
                    ↓ STRUCTURED (small, merges)                    ↓ LARGE CONTENT (bytes)
        in-memory state → localStorage mirror              ContentStore (SHARED, from Cadence)
                    ↓                                        StoragePort (IndexedDB) local
        writeSectionWithMerge + mergeStates                          ↓
                    ↓                                        Supabase STORAGE (content-addressed)
        tableplan_states JSONB (+ eat_recipes rows)          durable backstop; owned|cache
                                   ↑                                   ↑
                        BlobAsset catalog lives in a normal state section (metadata syncs; bytes don't)
```

Unchanged: providers stay separate; structured path is today's system; content path is Cadence's, generalized. Finance stays cloud-only by choice.

---

## 25. Roadmap (no big bang)

- **Phase 0 — Extract the shared ContentStore.** Lift `music/storage.js`+`music/blob.js`+`music/cloud-blob.js` into `content-store/` (or keep in place and re-export), define the domain-neutral API (§14, incl. hash *and* `domain:entityId` keying + `ensureAvailable` + ownership). *No behavior change; Cadence keeps working.* Tests: parity of Cadence on the generalized store. Rollback: revert extraction. Risk: low.
- **Phase 1 — Media article bodies (first consumer).** Per the locked Media design: article body → content record keyed by article id; `savedArticles` stays metadata; read path IndexedDB→bucket→re-fetch; one-time idempotent lift of existing `savedArticles[].text`. Benefit: kills media-section Disk-IO + real offline article reading. Tests §20. Rollback: metadata still renders without content; keep old text in place until the lift verifies.
- **Phase 2 — Podcast episode notes + TTS/Kokoro audio.** Same store, two more consumers; audio hash-addressed. Benefit: removes the other big media-section payloads; offline audio.
- **Phase 3 — Content availability/hydrate-on-demand hardening.** Make cross-device "metadata present, bytes absent → fetch" first-class + tested (Cadence's soft spot). Add `navigator.storage.persist()` + eviction policy (`cache` first) + logout purge decision.
- **Phase 4 (optional, low priority) — structured mirror spill to IndexedDB.** Only if the ~5 MB localStorage cliff bites structured state after content leaves it (it probably won't).

Each phase is independently shippable and reversible; sync is never redesigned.

---

## 26. What we should NOT build

- **A universal repository / data-manager / ORM.** Two working systems already cover structured + content.
- **CRDTs / event sourcing / operational transform.** Union+tombstone convergence is sufficient for personal data.
- **Realtime / websockets / polling sync.** Debounced write + reconnect re-flush is enough; realtime is a cost trap (ARCHITECTURE §8/§20).
- **A second content store per domain.** The whole point of Phase 0 is to *avoid* Media/TTS/podcasts each reinventing Cadence's blob layer.
- **Forcing provider data into local canonical ownership.** Weather/TMDB/Jellyfin/banking stay provider-owned caches.
- **Rewriting Cadence.** It's the reference; extract from it, don't replace it.
- **Making finance offline.** The no-local-mirror stance is a deliberate privacy decision.
- **Putting sync logic in the service worker.** Keep the SW an app-shell/static cache.
- **Per-entity Supabase rows for small domains.** Sections are the right unit at this size.

---

## 27. "If this were my codebase"

**Do now (decisions to settle):**
- Adopt the **structured-vs-content boundary** as policy: large content never lives in `tableplan_states` JSONB.
- Declare the **ContentStore (extracted from Cadence) the single shared local-first primitive**; everything structured reuses the existing state-section stack.
- Fix the **ownership rule**: provider refresh never overwrites app-owned fields; provider fields never sync as canonical.
- Decide the **logout / eviction / `persist()` policy** for local content (recommend: request persistence; evict `cache` first; purge on logout by default).

**Build first:**
- **Phase 0 + Phase 1** — extract the ContentStore and migrate **Media article bodies** onto it (the locked design). Highest value, proven code, real pain solved, second-domain validation.

**Build later:**
- Podcast notes + TTS audio on the ContentStore; cross-device hydrate-on-demand hardening; optional structured-mirror IndexedDB spill.

**Let existing work finish:**
- Calendar 2.0 / TTS / interaction (sortable) work should proceed; the ContentStore is *complementary* (TTS audio is a future consumer) and should not block or be blocked by them.

**Don't touch:**
- `state-sync.js` (`mergeStates`), `writeSectionWithMerge`, the section registry, the finance-protect trigger, Cadence's domain logic, provider adapters, `eat_recipes` — all healthy.

**Watch:**
- IndexedDB eviction on iOS PWA (re-hydration correctness); Storage bucket growth/cost; media-section size *before* Phase 1 lands (the metric that justifies it); logout-privacy of local content; that Phase 1 doesn't regress the tested sync/merge invariants.

---

### Answers to the success-criteria questions (index)

- **What "local-first" means here:** §8 (reads-local, writes-local, optimistic, converge, providers stay networked, large content gets a real local substrate, starts offline).
- **What to preserve:** §2, §27 Don't-touch — the state-section/`mergeStates`/`writeSectionWithMerge` stack.
- **Learn from Cadence:** §5 — StoragePort + BlobAsset + content-addressed cloud-blob = the reusable core; parsing/rendering = domain-specific.
- **Learn from Media design:** §6 — same pattern, second domain ⇒ it's real shared infra; keys by entity-id, needs both hash + logical keying.
- **Genuinely shared infra:** §12 — exactly one new thing: the ContentStore (extracted, not invented).
- **Domain-specific:** §5/§6 — parsers, renderers, what a "content record" is, fetch/purge policy.
- **Personal vs provider:** §9 — ownership table + the no-overwrite rule.
- **Structured vs large content:** §7 — different stores by design.
- **Sync sufficiency:** §10 — sufficient once content leaves the sections; no redesign.
- **Safest first domain:** §19 — the ContentStore via Media article bodies (not Shopping).
- **Context Engine feed / AI boundary:** §21–22 — canonical read APIs; content referenced not embedded; AI strictly downstream.
```
