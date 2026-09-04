# Publications / RSS + Media Architecture & UX Audit

> **AUDIT ONLY — no implementation.** This is the **one** new untracked file created by this
> audit. No tracked files were modified, no commits, no schema/infra/network changes. Baseline:
> `ceb6bbf` (post architecture-completion + audio-position). 1211 tests green, tree clean.
> Stage: INTENT → SPEC → PLAN. **Do not move to IMPLEMENT from this document.**

Evidence is cited as `file:symbol` / `file:line`. RSS feeds were checked live 2026-09-02.

---

## Executive Summary

Publications is **~60–70% supported by existing architecture** and is the concrete consumer
that justifies several previously-gated items. The single most important finding is that the
codebase **already has the substrate** — `MEDIA_KIND.ARTICLE`, a now-playing kind registry, a
capability/provider media model, a content store, provenance, search, projections, diagnostics,
the async-operation contract, and (as of `bdf38ed`) `media-progress.js` — and Publications should
**extend** these, not add parallels.

Five load-bearing conclusions:

1. **Articles are already a media kind** (`media-model.js` `MEDIA_KIND.ARTICLE`) and already play
   through the shared audio element + engine + can sit in the podcast Playlist
   (`podcastPlaylistIncludeArticles`, `playArticleFromPlaylist`). But a **parallel `listen`/TTS
   code path** (`listenToArticle` / `startListenTTS` / `listenAudio`) exists with its own state.
   The article-as-audio work is *unification of an existing path*, not new playback.
2. **The Playlist conflates "currently playing" with "has progress."** There is a real
   now-playing registry (`nowPlayingKind()`), but the Playlist's top/continue affordance is
   derived from `podcastProgress` (position>0), not from actual engine-active playback. This must
   be separated — and `media-progress.js` + the now-playing registry are the substrate to do it.
3. **The "Bella not playing" bug is a voice-routing/wiring issue, not Kokoro being slow.** Article
   TTS honors the per-domain voice pref → Bella → **Kokoro provider, which `throw`s "not
   configured yet"** unless the `kokoro-tts` proxy is wired (`tts-provider.js:60`). It does not
   degrade to Google. Slowness is on-demand full-article synthesis + Cloud-Run cold start.
4. **Publications flips four gates from "gated (no consumer)" to "gated no longer."** Audio-position
   (already lifted), domain-model convergence (Article/Publication canonicalization), async-operation
   status (RSS/TTS/acquisition), and the search/projection/provenance/capability substrates all now
   have genuine Publications consumers. Storage-adapter/migration-runner and DB-advisor gates
   **remain**.
5. **Article-library storage is the one genuine new persistence decision.** A permanent, daily-growing
   article library does **not** belong in the hot `media` state section (it would recreate the egress
   problem the architecture just fixed). The right move is the existing "**promote to a relational
   table when large/list-queried**" convention (ARCH §6, the `eat_recipes` precedent) — a normal
   relational promotion, **not** the storage adapter and **not** a new abstraction.

Recommended first work after this audit: **Phase 0 (playback-state separation)** and **Phase 1
(canonical Article/Publication model + relational storage decision)** — everything else depends on them.

---

## Architectural Baseline

The maximalist completion program (through `ceb6bbf`) established the North Star, scorecard,
guardrails, fitness tests, multi-tab isolation, provenance, capability catalog, Today projections,
AI-readiness, search index, async-operation contract, content store, and **audio-position
persistence** (`media-progress.js`). These are treated as authoritative and are **reused**, not
reopened. The one settled decision this audit deliberately re-tests (per the prompt) is the set of
**gated items** — because Publications is a new consumer.

---

## Existing Architecture (relevant surfaces)

- **State/sync:** one in-memory `state`, section-granular Supabase rows, `mergeStates`
  (unionById/unionByKey/tombstones), localStorage mirror, content store for large/binary data.
  The `media` section (`app.js:299`) already holds `savedArticles`, `readingItems`,
  `readArticleIds`, `articleReadDates`, `readPublications`, `publicationTiers`,
  `podcastPlaylistIncludeArticles`, `podcastQueue`, `podcastProgress`, `mediaProgress`, etc.
- **Substrate modules:** `provenance.js`, `platform-capabilities.js`, `search-index.js`,
  `today-projection.js`, `diagnostics.js`, `async-operation.js`, `content-store/`.
- **Server boundary:** ~60 Netlify functions; the SSRF-guarded `safeFetch` + `/import` gateway +
  `ics-proxy.mjs` are the reference pattern for fetching third-party content safely.

## Existing Media Architecture

`media-model.js`: `MEDIA_KIND = { VIDEO, MUSIC, PODCAST, RADIO, ARTICLE }`, `makeMediaItem`,
`mediaKey(item)=kind:id`, per-kind `Progress` (position/percent/episodic/live/completed),
`providerRefs`. `media-provider.js` is the capability/provider registry. `playback-coordinator.js`
(`resolvePlaybackTargets`, `chooseTarget`, `playAction`) selects targets by capability.
`playback-engine.js` is one segment-based audio engine with `startPosition` resume, `position`,
`duration`. **Article is a first-class kind already.**

## Existing Playlist / Continue-Playing Architecture

Playlist is **podcast-centric but article-aware**: `podcastPlaylists`, `podcastPlaylistItems`,
`podcastQueue` (string-set), `podcastPlaylistIncludeArticles`, `playArticleFromPlaylist()`
(`app.js:47405`). The now-playing layer is a **kind registry**: `nowPlayingKind()` iterates
`NOW_PLAYING_ORDER` and returns the first `MEDIA_KINDS[k].active()` (`app.js:46005`), where the
"listen"/TTS kind's `active()` is `!!(listenAudio||listenLoading||listenArticle)` (`app.js:44436`).
**Finding (issue #8 confirmed at the model level):** the *continue/top* affordance in the Playlist
episode list is computed from `podcastProgress[e.id].position>0` (`renderPodcastPlaylistEpisodes`,
`app.js:41992+`), i.e. **progress ≠ currently-playing**. The engine-active truth (`nowPlayingKind`)
exists but is not the source of the "continue" slot. This is a genuine model conflation, not a UI
nit.

## Existing Playback Architecture

Music now resumes via `engine.load({ startPosition: resumePositionFor(...) })` and saves position to
`mediaProgress` (`playMusicDescriptor`, `saveMusicPosition`, `bdf38ed`). Podcast has its own
`podcastProgress` + `schedulePodcastPositionSave`. Article/TTS uses `listenAudio` +
`startListenTTS`. **All three share the one media element** (`ensureMediaAudioEl`) and every
non-music start calls `stopMusicPlayback()` first (verified). So the engine is shared; the
**descriptor/resume/save wiring is per-kind and not yet unified** — this is the article-as-audio gap.

## Existing TTS / Kokoro Architecture

`generateTtsUrls(article)` (`app.js:47843`) → `getVoiceService().synthesize({ domain:"article",
refId })`. `voice-service.js` resolves per-domain prefs (`voice-prefs.js` domains:
`assistant|article|email|notification`) → app voiceId → provider+providerVoiceId
(`voice-registry.js`). `voice-registry.js`: `bella → provider "kokoro"`, `DEFAULT_VOICE_ID
"google-neural"`. `tts-provider.js` Kokoro provider **throws** "not configured yet (Phase 1:
session-gated kokoro-tts proxy)" unless `synthViaProxy` is wired; `kokoro-tts.mjs` proxies to a
**server-side** Kokoro (home/Cloud-Run) — **not an in-browser model.** A `ttsPrefetchCache` /
`ttsResolvedUrls` prefetches the *next* queue item's audio for gapless hand-off; the **first** item
has no prefetch. **This fully explains issue #10** (below).

## Existing Publications / Article Capabilities

There is already a **manual** article system: `savedArticles[]` ({id,url,canonicalUrl,title,
publication,author,date,text,savedAt,provenance}), `readArticleIds` (binary read-set),
`articleReadDates` (map), `readPublications` (followed publications, keyed by "key"),
`publicationTiers` (per-publication tier for the media board). **There is no RSS discovery, no feed
model, no reading-position persistence, and no canonical Article/Publication entity.** The new
Publications system is: **RSS discovery → the same canonical article → the same media/reading paths.**

## Existing Podcast / Radio / Watch Architecture

- **Podcast:** tabs render **Recent, Shows, Saved** (`renderPodcastPlaylistBar`, `app.js:41766-68`)
  + a three-bar `podcastTabsMenuBtn` toggling `mediaSidebar` (`app.js:41762`) + search/history
  action buttons. Episode rows use the shared `.article-row` component with swipe patterns.
- **Radio:** `renderRadio*`/`updateRadioBody`, `doRadioSearch` with debounce (`app.js:45815+`),
  user stations in `radioUserStations`, favorites in `radioFavorites`. (Scroll/`+`/search-clear
  findings below.)
- **Watch:** `showWatchApp` (`app.js:7303`), `renderWatchPlanner` (`app.js:33378`), TMDB providers,
  `watch-category-tabs`. Uses the shared `watch-category-tabs` primitive that Podcast/Shop/Grocery
  also use — so the tab/card primitives are already shared.

## Existing Local-First / Provenance / Search / Capability / Projection / Diagnostics

Reusable as-is: provenance (`provenance.js`, `origin: imported|provider|generated|…`), search
(`search-index.js` SEARCHABLE projection — `savedArticles` is a natural addition), Today projections
(`today-projection.js` — `projectMediaContinue` already reads `mediaProgress`), diagnostics
(`window.__liveDiag`), async-operation status (`async-operation.js` — a natural consumer for RSS/TTS),
capability catalog (`platform-capabilities.js`). **None of these should be duplicated.**

---

## Current UX Issues — Findings

| # | Issue | Confirmed? | Root cause | Recommended fix | Before/During Publications |
|---|---|---|---|---|---|
| 8 | Playlist "continue" shows a started-but-not-playing episode | **Yes (model-level)** | Continue slot derived from `podcastProgress.position>0`, not `nowPlayingKind()` engine-active state | Separate **currently-playing** (engine/now-playing registry) from **resumable** (`mediaProgress`/`podcastProgress`) from **queue membership** (`podcastQueue`). Add a pure projection `projectNowPlaying(state)` + `projectResumable(state)`; render an explicit CURRENTLY PLAYING slot (empty when nothing is engine-active) | **Before** (Phase 0 — Publications depends on these distinctions) |
| 9–43 | Articles need their own player | **Partly true** | `listen`/`startListenTTS`/`listenAudio` is a parallel path; MEDIA_KIND.ARTICLE + shared engine already exist | Unify the article-listen path onto a common descriptor + `mediaProgress` for resume (extend the music wiring to articles). No article-specific player | During (Phase 6) |
| 10 | Kokoro "Bella" selected but article doesn't play; slow | **Yes** | Article domain → Bella → **Kokoro provider throws "not configured"** (no proxy wired) and does **not** fall back to Google; slowness = on-demand full synth + Cloud-Run cold start | (a) **Degrade gracefully**: if the selected provider is unavailable, fall back to `google-neural` with a visible notice (today it throws → silent no-audio); (b) verify/ wire the `kokoro-tts` proxy; (c) **cache generated audio in the content store** so re-listen never re-synthesizes; (d) synthesize+stream in chunks so playback starts on the first sentence | **Before/During** (blocks article listening) |
| 11 | Pre-download Kokoro voice/model | **N/A as posed** | Kokoro is **server-side**, not an in-browser model — nothing to pre-download client-side | Recommend **audio caching (content store)** + first-item prefetch + Cloud-Run warm-ping; treat **in-browser Kokoro (kokoro-js WASM, ~80–300 MB)** as a *separate major decision*, not v1 | During (Phase 6/10) |
| 12 | Podcast tabs order | **Yes** | Order is Recent, Shows, Saved (`41766-68`); Shows not default, not alphabetical | Reorder to **Shows, Recent, Saved**; default `activePodcastTab="shows"`; sort Shows alphabetically | During (Phase 7 — cheap) |
| 13 | Redundant three-bar podcast sidebar button | **Yes** (`podcastTabsMenuBtn`, `41762`) | Duplicates the permanent sidebar toggle left of search | Remove the podcast-specific button; keep the permanent one | During (Phase 7) |
| 14 | Add podcast episode → Playlist from Show tab | Investigate | `toggleEpisodeInQueue` exists (prior work) | Ensure the Show-tab episode row exposes the existing add-to-Playlist affordance; no podcast-specific queue | During (Phase 7) |
| 15 | Playlist item click → details (not play) | Likely inconsistent | Row click may start playback | Standardize: **row click → details; explicit Play → playback** across podcast/music/article | During (Phase 7 + Phase 0 sets the model) |
| 16 | Podcast Recent swipe actions always visible | Investigate | Actions rendered inline vs behind swipe | Reuse the existing swipe-reveal pattern (Notifications will use the same) | During (Phase 7) |
| 17 | Radio `+` add-station in main UI | **Yes** (`radioUserStations`) | Station management in the browse surface | Move station CRUD to **Settings → Radio**; main Radio = listen/browse | During (Phase 8) |
| 18 | Radio can't scroll | Investigate | Likely a container height/overflow/flex constraint in the media body | Fix the underlying scroll container (shared media body), not a per-view hack; check it's not a broader media-layout issue | During (Phase 8) |
| 19 | Radio search needs an X clear | **Yes** | `doRadioSearch` has no clear affordance | Reuse the standard search-field component with a clear button | During (Phase 8) |
| 20 | Mini-player ~1.5× height | Yes (styling) | Fixed height | Rescale proportionally (image/text/controls/progress) across desktop/tablet/mobile; verify 360px | During (Phase 10) |
| 21 | Remove button shadow (mini-player + general) | Yes (`box-shadow` widespread) | Shadow convention on buttons | Establish a no-shadow button convention (token); apply to the mini-player play/pause; **not** a broad redesign in v1 | During (Phase 10) |
| 22 | Watch folder redesign (esp. mobile) | Yes | Watch is coupled to an older layout; uses shared tab primitive but not the media card/list system fully | New Watch IA on shared media primitives (see below) | Phase 9 (later) |

**Shared root causes:** (8, 15) share the *playback-state-separation* root; (10, 11, 9/42/43) share
the *article-as-audio + TTS* root; (17, 18, 19) are the *Radio surface/settings* cluster; (20, 21)
are the *mini-player/button styling* cluster. Fix the roots (Phase 0, Phase 6), not the symptoms.

---

## Previously-Gated Architecture Items — Reassessment (REQUIRED)

| Gate | Prior disposition | Current evidence w/ Publications | New disposition | Rationale |
|---|---|---|---|---|
| **Audio-position persistence** | GATE LIFTED → implemented (`media-progress.js`, `bdf38ed`) | Publications' listening/resume/relisten is exactly the consumer that justified it | **Confirmed lifted; EXTEND** | Extend the current *music-only* save/resume wiring to **articles/podcast** via the same `mediaProgress` map. Do **not** design from scratch (per the checkpoint update). |
| **Domain-model convergence** | DESIGNED (converge on contact) | Publications creates real Publication→Feed→Article→(reading/listening/consumption/playlist) relationships; and there are already **two** article representations (manual `savedArticles` + the coming RSS articles) | **GATE PARTIALLY OPENS — converge Article now** | This is the "on contact" trigger. Unify manual + RSS articles into **one canonical Article**; promote `readPublications`/`publicationTiers` into a **Publication** entity. Still avoid a universal model — only Article/Publication/Feed converge. |
| **Async-operation status** | INCORPORATED (contract exists) | RSS fetch, TTS synthesis, article-content acquisition are long-running user-facing ops | **Adopt (real consumer now)** | Register these ops with `createOperationTracker` so diagnostics shows feed/TTS/acquisition state. No new framework. |
| **Search index** | IMPLEMENTED | Articles/publications are prime search targets | **Extend SEARCHABLE** | Add `article`/`publication` to the `search-index.js` projection (title/author/publication/description; body only when acquired). No new search engine. |
| **Today projections** | IMPLEMENTED | "Awaiting disposition," "resume listening," "currently playing," "reading continuation" | **Add projections** | Compose new pure projectors (`projectNowPlaying`, `projectAwaitingDisposition`, extend `projectMediaContinue`) — no business logic in UI. |
| **Provenance** | IMPLEMENTED | RSS-discovered articles, generated TTS audio | **Adopt** | `origin: "provider"/"imported"`, `source: "rss"`, `sourceUrl`, feed id; TTS audio `origin:"generated"`. Minimal, at ingress only. |
| **Capability registry** | IMPLEMENTED | RSS discovery / feed provider is a genuine extension boundary (many publications) | **Add a capability** | A `feed`/`publication` provider capability so new publications need **no publication-specific code** (product requirement §6). This is a real boundary, not word-matching. |
| **Storage adapter / migration runner** | GATED | Publications adds **no second backend**; uses existing state + content store (+ possibly one relational table) | **GATE HOLDS** | No home-server/PGlite backend appears. A relational *table* is a normal §6 promotion, not the storage-interface swap. |
| **DB advisor fixes** | GATED | Only relevant *if* a new `articles` table is added — then it must follow ARCH §6 (RLS, FK indexes, `(select auth.*)`) from the start | **GATE HOLDS; note** | New-table hygiene is a build requirement, not a re-open of the deferred tiny-table wraps. Applying any migration remains confirmation-gated + out of scope here. |

**Gates that changed status:** domain-model convergence (Article/Publication now converges),
async-operation/search/projection/provenance/capability all gain genuine Publications consumers.
**Gates unchanged:** storage adapter, migration runner, DB-advisor deferrals.

---

## Publications / RSS Gap Analysis

**Have:** article media kind, shared engine, content store, provenance, search, projections,
diagnostics, async-op contract, manual article model, publications-follow + tiers, playlist
article support, media-progress. **Missing:** RSS discovery + feed model; a canonical Article/
Publication entity (vs the ad-hoc `savedArticles`); reading-position persistence; a
Notifications triage deck; retention; bounded/paginated article storage; graceful TTS fallback +
audio caching; unified article-listen path; the playback-state separation.

---

## Proposed Publications Architecture (conceptual → repository mapping)

```
Publication (persisted, small)            ← new entity (from readPublications/publicationTiers)
   ↓ 1..n
Feed (persisted, small; url, etag, nextFetchAt, backoff, enabled)   ← new, config-like
   ↓ discovery (server proxy)
Canonical Article (persisted metadata; body acquired on demand)     ← unify savedArticles + RSS
   ├── NotificationState      → DERIVED projection (discoveredAt + disposition + retention)
   ├── ReadingProgress        → new small state (position/percent), NOT in the hot list row
   ├── ListeningProgress      → EXISTING media-progress.js (mediaProgress), keyed by media id
   ├── ConsumptionHistory     → EXISTING readArticleIds/articleReadDates + mediaHistory
   ├── PlaylistMembership     → EXISTING podcastQueue/playlist (rename concept → "media queue")
   └── Media/PlayableSource   → EXISTING MEDIA_KIND.ARTICLE + engine (+ TTS audio in content store)
```

**Canonical vs derived vs local vs content:**
- **Canonical persisted entities:** Publication, Feed, Article (metadata). Article **body** and
  **TTS audio** are **content records** (content store), not state.
- **Derived projections (not stored):** NotificationState (from discoveredAt + disposition +
  retention window), NowPlaying, Resumable, AwaitingDisposition, search index.
- **Local/UI state:** deck cursor (not persisted, per §26), active tab.
- **Historical records:** consumption (existing), media history.

## Proposed Article Model (metadata)

`{ id (canonical), publicationId, feedIds[], guid, canonicalUrl, url, title, author, publishedAt,
updatedAt, description(excerpt), imageUrl, category, discoveredAt, disposition
(none|listen-later|dismissed|consumed…), provenance }`. **No body/audio in this record** (content
store + on-demand). **Dedup hierarchy** (§29): `guid` → `canonicalUrl` → normalized URL →
conservative title+date. Idempotent polling: unchanged feed items produce **no writes** (compare
guid+updatedAt; skip if unchanged).

**Storage decision (major):** a permanent daily-growing library must **not** live in the hot `media`
state section (that recreates the egress incident the architecture fixed). Two options:
- **(A) Relational `articles` table** (RLS, FK-indexed, paginated) — the `eat_recipes`/§6 precedent.
  Best for scale (1k+/day), pagination, incremental sync. **Recommended.**
- **(B) A new *dedicated small* state section** for article metadata — simpler, but unbounded growth
  in a synced JSONB row; only viable with hard caps + aggressive retention. **Not recommended** for a
  permanent library.
This is the **one genuine schema decision** requiring human sign-off (it's a migration).

## Proposed Notification Model

Notifications = **derived** view of Articles that are `discoveredAt` within retention AND
`disposition==="none"` (§24–27). No separate notification table. Badge = exact count through 99,
`99+` above (underlying exact). Order: newest **publishedAt** first, cross-publication; new arrivals
**append**, no reshuffle mid-session (§26); deck cursor not persisted. Resolution: swipe L/R, mark
read, or first complete read/listen. **Swipe right → add to media queue (Playlist), no playback, no
consume; swipe left → keep in Publications, no queue, no consume**; lightweight Undo. Retention
(default 7d; 3/7/14/30/Everything) is a **cleanup projection over discoveredAt**, never deletes
Publications articles (§27).

## Proposed Playlist Integration & Playback-State Separation (Phase 0)

Rename the concept **podcast queue → media queue** (data key can stay `podcastQueue` to avoid
migration; the *concept* generalizes to articles/podcasts). Introduce pure projectors that make the
six states explicit and impossible to conflate (fitness-testable):
- `projectNowPlaying(state)` — from `nowPlayingKind()` engine-active truth only.
- `projectResumable(state)` — from `mediaProgress` + `podcastProgress` (has progress ≠ playing).
- queue membership — `podcastQueue`; consumption — `readArticleIds`/`mediaHistory`.
Render an explicit **CURRENTLY PLAYING** slot (empty when nothing is engine-active). This is the
root fix for issues #8 and #15 and a prerequisite for Publications listening.

## Proposed Article-as-Audio Architecture (Phase 6)

Unify the article path onto the common descriptor: an article becomes a `PlayableSource` whose audio
is a content-store URL (TTS output). Playback, resume (`mediaProgress`), now-playing, mini-player,
history are then identical to music/podcast. Remove `listenAudio`/`startListenTTS` special-casing
where it duplicates the descriptor path (keep only what's genuinely article-specific: text
highlighting/timings). **TTS output cached in the content store**, keyed by (articleId, voiceId,
speed) so re-listen and cross-device reuse never re-synthesize.

## Proposed Reading Model (Phase 5)

Native reader inside Tableplan. **New** persisted `readingProgress` (small map id→{percent|position})
— reading progress is **separate** from listening progress (§41, §47). Opening ≠ consumed; partial
read saves position, doesn't consume, doesn't touch queue. Reread starts fresh, preserves history.

## Proposed RSS Fetching Model (Phase 2)

**CORS + paywalls force server-side fetching** (verified: feeds don't send CORS headers; NYT/Economist
are excerpt-only). Reuse the **existing SSRF-guarded `safeFetch` + import-gateway/`ics-proxy`
pattern** — a `fetch-feed` Netlify function (session-gated, conditional GET with ETag/Last-Modified,
size/redirect caps). **Do not** make Netlify a continuous poller. Scheduling: **client-triggered on
app launch/resume** (through the proxy) + an optional **bounded** scheduled function following ARCH §8
(capped, idempotent, backoff, killable). Per-feed `nextFetchAt`/backoff stored on the Feed. A
transport seam (`FeedFetcher`) is justified **only** because a future home-server fetcher is a real
phase — but keep it a thin interface, not a framework. Conservative 30–60 min + on-launch.

## Proposed TTS / Kokoro Model

Fix the routing/degradation first: **graceful fallback** (unavailable provider → Google + notice,
never a silent throw), verify the `kokoro-tts` proxy wiring, and **cache audio in the content store**.
Chunked synthesis (first sentence starts playback) removes the perceived cold-start. **In-browser
Kokoro (kokoro-js WASM)** is a *separate* future decision — it would enable offline TTS and true
"instant after first download," at the cost of an 80–300 MB model download and mobile-memory risk;
**not v1**.

## Proposed Podcast / Radio Improvements

Podcast: Shows-first + default + alphabetical (#12); remove redundant menu button (#13); ensure
Show-tab add-to-queue (#14); row-click→details (#15); swipe-reveal Recent actions (#16). Radio:
station CRUD → Settings → Radio (#17); fix the shared media scroll container (#18); standard search
+ clear (#19). All reuse existing primitives.

## Proposed Watch Redesign (Phase 9, later)

**IA:** tabs `Watchlist | Discover | Planner` on the shared `watch-category-tabs` + media-card/list
primitives (same system as Podcast/Publications). **Mobile:** single-column card list, bottom-sheet
detail, swipe actions for watchlist add/remove; no dense desktop grid on phones. **Desktop:**
responsive card grid + detail pane. **Cards:** poster/title/meta/one action; **detail:** TMDB
metadata + providers + add-to-watchlist + planner. **Playback/handoff:** deep-link to the provider
(capability-honest, no embedding). Reuses search/discovery + provider capability. This is the one
"nothing off limits" redesign; keep functionality parity, rebuild the layout on shared primitives.

## Shared Media UX Recommendations

Standardize (reuse, don't reinvent): `watch-category-tabs`, `.article-row` + swipe-reveal, a single
search-field-with-clear component, the mini-player, the sidebar toggle, empty states, no-shadow
button token. Goal: Podcast/Radio/Publications/Watch/Music feel like one system. **No new
design-system framework** — just consolidate onto the primitives that already exist.

## Provenance / Search / Capability / Today / Diagnostics / Fitness Integration

- **Provenance:** articles `origin:imported/provider, source:"rss", sourceUrl, feedId`; TTS audio
  `origin:"generated"`. Minimal, at ingress.
- **Search:** add `article`/`publication` to `search-index.js` SEARCHABLE (title/author/publication/
  description; body when acquired). Derived, non-authoritative.
- **Capability:** add a `feed`/publication provider capability (real extension boundary).
- **Today:** `projectNowPlaying`, `projectAwaitingDisposition`, extend `projectMediaContinue`
  (resumable already wired) — pure, composed by Home.
- **Diagnostics:** feed fetch state / lastFetch / nextFetch / backoff / ingest counts / dedup
  suppressions / TTS status / acquisition failures via the existing snapshot + async-op tracker.
- **Fitness tests (new architectural rules):** one canonical Article; no parallel article queue;
  Publications opens without a cloud fetch; RSS does not own article-body storage; article playback
  uses the common engine/PlayableSource; notification-state cannot imply consumption; playlist
  membership cannot imply consumption; currently-playing derives from engine, not progress;
  account-scoped caches never cross accounts (existing contract extends to article/TTS/image caches);
  search stays derived; feed polling does not synchronously mutate hot state.

## Supabase / Netlify / Storage Cost Analysis

- **Supabase:** keep article metadata **out of the hot `media` JSONB row**. Option A (relational
  `articles`) gives paginated, incremental, indexed reads/writes and idempotent polling (no write when
  unchanged) — the safe path. Egress risk = full-text bodies: **never sync bodies**; bodies live in the
  content store, acquired on demand, bounded/rebuildable (the media-row de-bloat lesson).
- **Netlify:** `fetch-feed` invocations ≈ (feeds × poll frequency). 10 publications × ~2 feeds ×
  hourly = ~480/day; on-launch adds a burst. Conditional GET keeps payloads tiny. A bounded scheduled
  function is optional; **client-on-launch** keeps Netlify off the critical path and is home-server-
  portable. TTS synthesis is the heavier per-call cost → **cache audio** so it's once-per (article,
  voice).
- **Storage growth (order-of-magnitude):** metadata ~1–2 KB/article → 100/day ≈ 3.6–7 MB/yr;
  1000/day ≈ 36–70 MB/yr (relational, fine). Bodies/audio/images are the real cost → **retain
  on-demand + bounded caches + retention**, don't store every discovered body.

## Performance & Failure Modes

Demand-driven everything: don't block Media render on RSS, Notifications on body extraction, Playlist
insertion on TTS, or startup on any model. **Fail non-destructively** (§56): RSS/paywall/extraction/
TTS/Supabase/Netlify/offline failures retain the Article and the user's intent (queue membership,
disposition); allow retry; never delete. Offline: already-discovered Publications work from local/
content store; discovery needs network; opening Publications must not require a cloud fetch (§50).

## Security / Account Isolation

The account-boundary invariant is already enforced by `auth-account-reset.js` + the storage-key
completeness contract. **Any** new local cache Publications adds (TTS audio, images, article bodies,
a search index, reading/notification state) must be **account-scoped and cleared on account
transition** — i.e. registered in the existing clear-on-sign-out set (content store DBs already are;
new IndexedDB/Cache-Storage stores must be added and covered by the fitness contract). **Do not**
build a Publications-specific isolation system.

## Testing Strategy

Unit: RSS parse, dedup hierarchy, URL normalization, idempotent-unchanged-no-write, notification
derivation, retention projection, feed backoff, reading vs listening separation, now-playing vs
progress, article→PlayableSource, TTS cache key. Integration: RSS→Article→Publications; duplicate
RSS→same Article; swipe-right→queue (no play/consume); swipe-left→dismissed-but-retained; read→
consumed; listen→consumed; queue-removal→Article retained; updated item→same Article (no dup
notification); disable/re-enable publication idempotent; offline Publications usable; failed
acquisition retains intent. Media/UI/cost tests per the prompt's list. **Encode the fitness rules
above as contract tests.**

## Implementation Phases (dependency-ordered)

- **Phase 0 — Playback-state separation** (prereq): `projectNowPlaying`/`projectResumable`, explicit
  CURRENTLY-PLAYING slot, row-click→details. Fixes #8/#15; unblocks Publications listening.
- **Phase 1 — Canonical Article/Publication/Feed model + storage decision** (A vs B); unify manual
  `savedArticles`.
- **Phase 2 — RSS ingestion** (`fetch-feed` proxy, parse, dedup, idempotency, conditional GET,
  polling, backoff, failure handling).
- **Phase 3 — Publications library** (tabs All/Recent/publication, pagination, search integration).
- **Phase 4 — Notifications** (derived triage deck, swipe, retention, badge, undo).
- **Phase 5 — Native reader** (content acquisition on demand, reading-position persistence).
- **Phase 6 — Article→Media/TTS unification** (PlayableSource, audio caching, graceful fallback,
  `mediaProgress` for articles).
- **Phase 7 — Podcast UX** (#12–16).
- **Phase 8 — Radio UX/settings** (#17–19).
- **Phase 9 — Watch redesign** (#22).
- **Phase 10 — Cost/perf hardening** (caching, polling, batching, storage bounds, diagnostics, load
  tests, mini-player #20/#21).

Each phase carries: objective, files, dependencies, data-model impact, migration needs, tests,
verification, rollback, and its relationship to existing architecture (detailed at implementation
time).

## Risks

Article-body/paywall acquisition (NYT/Economist excerpt-only → listening may be limited to
excerpts or fail gracefully); TTS cost/latency without caching; unbounded article growth if stored
in the hot section (mitigated by the relational decision + retention); Watch redesign scope; Netlify
polling cost if scheduled-function polling is chosen over client-on-launch.

## Open Questions Requiring Human Decision

1. **Article metadata storage:** relational `articles` table (recommended) vs a bounded new state
   section. This is a schema migration → needs sign-off.
2. **RSS scheduling:** client-on-launch (recommended, home-server-portable) vs a bounded Netlify
   scheduled poller — a cost/topology decision.
3. **Article body/paywall policy:** for excerpt-only publishers (NYT/Economist), listen/read from
   excerpt only, or attempt full extraction (and accept frequent paywall failures)? Product call.
4. **Kokoro direction:** keep server-side Kokoro + audio caching (recommended v1) vs invest in
   in-browser Kokoro (offline, big download) later.
5. **Watch IA:** confirm the proposed `Watchlist | Discover | Planner` model before Phase 9.

---

## Final Architectural Reconciliation (§70)

1. **Reuse directly:** engine, media model (ARTICLE kind), content store, provenance, search,
   projections, diagnostics, async-op contract, capability registry, account-boundary,
   media-progress, sortable/swipe primitives, `watch-category-tabs`, mini-player.
2. **Extend:** media-progress → articles/podcast; SEARCHABLE → articles/publications; Today →
   now-playing/awaiting-disposition; capability → feed provider; provenance → RSS/TTS.
3. **Genuinely new domain concepts:** Publication, Feed, canonical Article, ReadingProgress, and a
   *derived* NotificationState. That's it.
4. **Apparent-but-unnecessary:** a Publications-specific queue, player, search, provenance,
   isolation, persistence, or design-system — all already covered.
5. **Change the canonical Media model?** No — ARTICLE already exists; unify the article *path* onto it.
6. **Persistent audio position?** Already implemented; **extend to articles** (don't rebuild).
7. **Previously-gated items now with a consumer?** Domain-model convergence (Article/Publication),
   async-op, search, projections, provenance, capability. Storage-adapter/migration/DB-advisor gates
   hold.
8. **Real domain-model convergence issue?** Yes — two article representations (manual + RSS); converge
   to one canonical Article + a Publication entity. Bounded, not universal.
9. **New capability entry?** Yes — a feed/publication provider (real boundary; new publications add no
   code).
10. **New search projection?** Yes — article/publication in SEARCHABLE.
11. **New provenance state?** Minimal — RSS/generated origins at ingress.
12. **New async-operation status?** Yes — feed fetch, TTS, acquisition.
13. **New Today projection?** Yes — now-playing, awaiting-disposition, (resumable already wired).
14. **Local-first preserved?** Yes — Publications opens from local/content store; discovery needs net.
15. **Home-server-compatible?** Yes — server fetch behind a thin `FeedFetcher` seam; content store
    already portable.
16. **AI-ready?** Yes — canonical Article + provenance + projections + search feed the existing
    `buildAgentContext`.
17. **Account isolation preserved?** Yes — provided every new local cache joins the clear-on-transition
    set + fitness contract.
18. **Duplicate source of truth introduced?** No — one canonical Article; bodies/audio in content store.
19. **Unnecessary framework?** No — extend existing mechanisms; the only new seams (FeedFetcher, feed
    capability, articles table) each have a real, named consumer.
20. **Implement FIRST:** **Phase 0 (playback-state separation)**, then **Phase 1 (canonical
    Article/Publication + storage decision)**. Everything else depends on them.

---

## Final Recommendation

Publications is a natural, mostly-additive extension of the completed architecture. Build **Phase 0**
(separate currently-playing / progress / queue / consumption — the fix for the Playlist conflation and
the prerequisite for article listening), then **Phase 1** (one canonical Article + Publication + Feed,
with the relational-storage decision), then ingestion → library → notifications → reader → article-
audio unification, and defer Watch to its own redesign phase. Reuse the substrate everywhere; the only
genuinely new persisted concepts are **Publication, Feed, canonical Article, ReadingProgress**, plus a
**derived** NotificationState. Two gates open (domain-model convergence for Article/Publication;
async-op/search/projection/provenance/capability adoption); storage-adapter/migration/DB-advisor gates
remain. Resolve the five open questions (storage, scheduling, paywall policy, Kokoro direction, Watch
IA) before the corresponding phases.

*End of audit. No tracked files were modified; this document is the only new file. Stage remains
INTENT → SPEC → PLAN.*
