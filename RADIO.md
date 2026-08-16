# Radio architecture (Media → Radio tab)

Radio is a **live-audio** domain, kept **separate from Music** (a Station is not a
recording) but sharing the one playback engine. It follows the app's provider
pattern:

```
RadioProvider (MPR catalog · Radio Browser · future: BBC, user URLs, …)
   → normalized Radio domain (radio.js)
   → shared mediaEngine  (providerId "radio")   ← reused, no second player
   → Radio tab UI  (provider-agnostic)
```

`app.js` owns the DOM/playback wiring; every module below is pure and unit-tested.

## Domain (`radio.js`)
- **Station** — a service a listener picks ("YourClassical MPR"). Has **one or
  more Stream candidates** (never assume one URL), a category, an optional
  `programGroup`, `providerRefs`, a `userAdded` flag (user stations coexist with
  provider ones), and `location` (for future geo discovery).
- **Stream** — an actual playable endpoint (`url`, `format` aac/mp3/ogg/hls,
  `mimeType`, `bitrateKbps`, `isHttps`).
- **Program** / **ScheduleEntry** / **Episode** — first-class types for shows,
  schedule slots, and on-demand instances. **Mostly deferred** (see Data sources).
- **`streamCandidates(station)` / `pickStream`** — ordered playable list: **HTTPS
  first** (an HTTPS PWA can't play `http://` — mixed content), then preferred
  format, then bitrate. The player walks this list on failure.
- **`createRadioRegistry(providers)`** — isolated aggregation: `listStations`
  (LIST-capable providers), `search` (with per-provider status), `nowPlaying`
  (only if a provider supports it; null otherwise). One provider failing never
  breaks the tab.

Capabilities (`RADIO_CAP`): `LIST, SEARCH, BY_TAG, BY_COUNTRY, NOW_PLAYING, SCHEDULE, PROGRAMS`.

## Providers
| Provider | id | What | Notes |
|---|---|---|---|
| **MPR** | `mpr` | Curated **bundled catalog** of MPR services + YourClassical specialty streams | `radio-provider-mpr.js`. Offline-capable (data, not an API). Streams on official `*.stream.publicradio.org` CDN, **AAC primary + MP3 fallback** where published. No scraping. |
| **Radio Browser** | `radiobrowser` | General internet-radio discovery (search/tag/country) | `radio-provider-radiobrowser.js`. Injectable fetch. Used for on-demand search only — **not** a giant directory dump in the home. |

MPR stations (v1): **MPR News, The Current, YourClassical MPR, Radio Heartland,
Carbon Sound**, plus YourClassical **Relax, Peaceful Piano, Choral, Chamber
Music, Concert Band, Children, Sleep, Essentials, Guitar, Holiday**. Adding/
removing a station or stream is a one-line edit to the tables in the MPR provider.

### Adding a provider
Write `radio-provider-<name>.js` returning `{ id, label, capabilities, isAvailable, listStations?/search?/byTag? }` mapping its API to normalized Stations; register it in `getRadio()` (`app.js`). The UI, playback, favourites, and history work unchanged.

## Playback (shared engine)
A station plays as a **live single-segment source** with `providerId:"radio"` through the same `mediaEngine`/mini-player/MediaSession as podcasts, TTS and music. `radioAudio` is the mode flag. Behaviour:
- Starting radio stops any podcast/TTS/music; starting those stops radio (no overlap).
- **Stream fallback**: on `error`, advance to the next candidate; on `ended` (a dropped live connection) reconnect up to 2× then try the next stream, else stop.
- The now-playing bar/modal gain a **`radio` kind** — LIVE (no seek/skip; `nowPlayingTotal` returns 0 for the infinite-duration stream). Lock-screen/MediaSession shows the station; play/pause/stop only.
- Continues across in-app navigation; background playback follows the platform/PWA behaviour of the shared element.

## Programs & on-demand (the podcast bridge)
Programs are first-class (`makeProgram`: name, host, `stationIds[]`, `feedUrl`, refs). The MPR provider ships a curated set with **verified official RSS feeds** (`feeds.publicradio.org/public_feeds/<slug>/rss/rss`): **Minnesota Now**, **Minnesota Today** (MPR News Update), **YourClassical Daily Download**. Adding one is a one-line edit once its slug is verified.

**Following or opening a program bridges into the EXISTING podcast system** — `ensurePodcastSubscribed(feedUrl)` reuses the app's `fetch-podcast` function and pushes a normal show into `state.podcasts`, so **episodes are stored and played by the podcast subsystem, never duplicated**. Opening a program jumps to the Podcasts show view; "listen live" tunes the program's associated station. Following records the program in `state.radioFollowedPrograms` (distinct from favourite stations) and subscribes its feed; unfollowing leaves any podcast subscription intact. This is the reliable-data-source half of the live↔on-demand relationship (now-playing/schedule remain deferred — no scrape-free source).

## Radio tab UI
`switchMediaTab("radio")` → `initRadioPanel()`. Home shows, in order: a **Currently
Playing / Last Played** card (Resume), **Your Stations** (favourites), the MPR
**catalog grouped by category** (News / Music / Classical), and **Recently
Played**. A search box queries the registry (MPR catalog + Radio Browser). It is
**not** a giant directory.

## Local vs provider data (local-first)
- **App owns** (in `state`, `persist()`): `radioFavorites` (favourite *stations*),
  `radioHistory` (recently played / last played station snapshots),
  `radioFollowedPrograms` (followed programs, bridged to podcast subscriptions),
  and user-added stations later.
- **Provider owns** (replaceable): station metadata, stream URLs, program/schedule
  data, provider ids. Stored snapshots carry enough (`providerRefs`, `streams`) to
  keep working and be refreshed.

**Favourite Station** ("easy access to this station") and **Followed Program**
("I care about this show wherever it airs") are deliberately distinct concepts —
both implemented. Following a program also subscribes its podcast feed (above).

## Offline behaviour
The MPR catalog is bundled, so **the Radio tab, station list and favourites work
with no network**; only live playback needs it. `sw.js` skips caching
`publicradio.org` / `radio-browser.info` and any `audio/*` response, so streams
are never buffered into the cache or mishandled as range requests. A provider
being unreachable is isolated (search degrades, home still renders).

## Data-source limitations (MPR/APMG, verified)
- **Streams**: reliable — official `*.stream.publicradio.org` CDN. This is v1's
  real data. (Carbon Sound's stream host is best-effort; it degrades if wrong.)
- **Now-playing metadata**: **not available** to an in-browser player without an
  ICY-reading proxy (avoided) or HTML scraping (forbidden). `nowPlaying()` returns
  null; a station stays playable. Revisit if APMG exposes a public JSON now-playing
  endpoint.
- **Schedules / programs**: no reliable public API without scraping → the domain
  types + provider capabilities exist, implementation deferred. RSS program feeds
  (`feeds.mpr.org`) can later bridge to the existing podcast system via
  `Program.feedUrl` (no duplicate episode storage).

## Architected for later (not built)
Radio Browser discovery UI, user-added-station UI, richer program pages
(schedule/next-airing), multi-station programs, Calendar (`ScheduleEntry` is
Calendar-ready), AI queries
(query the registry/domain, not providers), location-aware discovery
(`Station.location`), followed-program notifications, external-device playback.
None are blocked by the current design.

## Tests
`test/radio.test.js` — domain normalization, stream preference/fallback ordering,
MPR catalog (major + YourClassical, offline, graceful null metadata), MPR
programs with verified feed URLs, Radio Browser mapping (mocked fetch), registry
aggregation (stations + programs) + failure isolation.
