# Watch & Scores: open the right app on the right title — design & plan

Status: **APPROVED (Luke, 2026-10-26). Steps 1–3 built on branch `watch-handoff`**; step 2 stays off until the API key is in Netlify and a deploy goes out. Decisions are in §9.

Goal: tapping a show, a movie or a game in the app opens the official app **on that title or game**, ready to play. In-app playback stays limited to what's allowed to play there (YouTube, Jellyfin).

---

## 1. Why not play inside the app (WKWebView)

- Netflix, Disney+, Max, Hulu, Prime, Paramount+ and Peacock protect video with DRM and send iPhone web visitors to their own apps. Playback inside another app's web view is blocked or unreliable.
- Embedding their sites or sign-in pages breaks their terms, and App Review rejects it.
- What already plays in the app stays as it is: **YouTube** (embedded) and **Jellyfin** (native) through `openVideoSurface`.

So the work is a better hand-off, not a player.

---

## 2. What exists today (findings)

**Watch already hands off, but only to each service's search page.**
- `media-deeplink.js` builds a **search URL** per service (e.g. `netflix.com/search?q=<title>`), because TMDB only says *which* services carry a title, not the title's id on each one.
- `media-availability.js` turns TMDB `watch/providers` (JustWatch data) into provider refs, using that search URL, else JustWatch's page.
- The Watch card shows "Your services" / "Other services" buttons (`watchHubProvidersHtml`), and `discoverSvcActivate` opens the URL with `window.open`.
- "Your services" comes from `state.mediaServices` (Watch › Streaming Services settings, `renderWatchServicesSettings`).

**On the iPhone this probably lands in Safari, not the app.** iOS opens an app from a web link only when that app claims the path (a *universal link*). Services claim their title and watch paths; search paths often aren't claimed. *Verify on the phone (step 1 test page).*

**Scores already knows who's broadcasting.**
- `_scores-espn.mjs` `broadcastsOf()` fills `game.broadcasts` (e.g. "ESPN", "FOX", "Peacock", "Prime Video"). It's shown as text in the expanded game, the team "Next" line, and the dock's game card (`gameCardHtml`).
- `game.link` is ESPN's own game page.
- Nothing is tappable.

**Constraint: watch items are whitelisted.** `normalizeWatchItems` (app.js ~6155) lists every field. Older builds would drop a new field like `streamLinks` when they re-save. So links are **not stored on watch items** (same lesson as RECIPE_PHOTOS_DESIGN §3).

**The iOS shell has no link-out code.** `window.open` falls to Capacitor's default handling. Nothing checks whether the app is installed or picks a fallback.

---

## 3. Data sources (researched 2026-10-26)

| Source | Gives | Cost | Fit |
|---|---|---|---|
| TMDB `watch/providers` (today) | which services carry a title | free | Keep for "where" |
| **Streaming Availability API** (Movie of the Night) | per service: **direct link to the title page**, plus a **video link** that opens the player, down to season and episode; lookup by TMDB id (`movie/<id>`, `tv/<id>`) | **Free: 1,000 requests/month**, commercial use allowed, caching allowed indefinitely, attribution only if data is made public | **Use for titles** |
| Watchmode | per-title iOS deep links, sports event sources | deep links need the **$349/month** plan; free tier has no app links | Rejected |
| ESPN scoreboard (today) | broadcaster names per game | free | **Use for games** |
| ESPN Watch graph / league apps | game-level stream ids (e.g. ESPN `sportscenter://…showWatchStream?playID=…`) | free but unofficial, fragile | Later (§6.3) |

*Check with a test key before building:* the exact field names (`link`, `videoLink`) and that the free tier returns them.

---

## 4. Design

### 4.1 One way out: `openOutLink()`

Every hand-off (Watch, Discover, Scores, the game card) goes through one function:

```js
openOutLink({ appUrl, webUrl, label })   // label: "Max", for the toast
```

- **iPhone app:** a small native plugin, `LinkOutPlugin.swift`.
  1. `UIApplication.shared.open(appUrl, options: [.universalLinksOnly: true])`. This opens the app **only if** it's installed and claims the link.
  2. If that fails, open `webUrl` in Safari. (A later option: offer the App Store page instead.)
  3. Custom schemes (`sportscenter://`) are used only for game-level links later (§6.3), and need `LSApplicationQueriesSchemes` in Info.plist.
- **Older app builds** without the plugin, and the **web app**: `window.open(webUrl)`. On the laptop that plays in the browser, which Netflix, Max and the rest support on desktop.
- `native-bridge.js` gains `nativeLinkOut()` (null on web and older builds), like the other plugins.

### 4.2 Title links (Watch)

- **New function `stream-links`** (Netlify): `GET ?type=tv&id=1396`.
  - **Origin-restricted and cacheable, not session-checked** (like `scores.mjs`): a session check would stop the CDN sharing answers. It holds no user data; the worst a stranger can do is use up the month's requests, and then the app falls back.
  - Calls Streaming Availability for **US**, then trims the answer to what the app uses, per service: title link, video link, and for TV a compact episode map `{ "2": { "5": videoLink } }`.
  - Responses are cached **on Netlify's CDN for 7 days** (`Netlify-CDN-Cache-Control: durable`, keyed by type+id). Every device and both users share one lookup per title per week. **Nothing touches Supabase** beyond the session check.
  - On quota (429) or error: returns `{ links: null }` and the app falls back to today's search links.
- **Device cache** (localStorage, `live-stream-links-v1`): last good answer per title, refreshed when older than 7 days and the card is shown. Not per account: it's public catalog data, no one's history. A failed lookup (function not deployed yet, offline) waits 30 minutes before asking again.
- **Fetched lazily:** when a Watch card with providers renders, or when an Open button is tapped. Never for every search result.
- **What the buttons do:**
  - **Movie:** "Play on Max" opens the video link; falls back to the title link, then the search URL.
  - **TV:** uses `seasonProgress` to find the **next unwatched episode** and opens that episode's video link ("Play S2 E5 on Max"). Falls back to the show page.
  - Services the API doesn't know keep today's search link.
- `media-availability.js` takes the links as an optional input, so the Coordinator, "Your services"/"Other services" and Discover keep one code path.

### 4.3 Game links (Scores)

- **Pure module `sports-watch.js`:** broadcaster name → network → app target. For example:

| Broadcast names (from ESPN) | Opens |
|---|---|
| ESPN, ESPN2, ESPNU, ESPN+, ABC, SEC/ACC Network | ESPN app |
| FOX, FS1, FS2, Big Ten Network | Fox One app |
| NBC, Peacock, USA Network | Peacock app |
| CBS, CBS Sports Network, Paramount+ | Paramount+ app |
| TNT, TBS, truTV | HBO Max app |
| Prime Video | Prime Video app |
| Apple TV (MLS) | Apple TV app |
| Netflix | Netflix app |
| NBA TV / NHL Network / MLB Network, league passes | the league's app |
| FanDuel Sports Network (regional) | FanDuel Sports Network app |

  - Each target holds an app link and a web link. **All of them are verified by tapping on the phone before shipping** (step 1 test page); the table is the starting list, not a promise.
  - Unknown names show as plain text, as today.
- **Where the button shows:** for games that are live or start within the next hour.
  - the expanded game in Scores (News › Sports › Scores);
  - the dock's game card (Household and Business views);
  - (Not on the team schedule's "Next" line: a game days away has nothing to open yet.)
- **Order:** networks on your services first (same "Your services" idea as Watch), then the rest.
- **Live TV: Xfinity (Luke, 2026-10-26).** No separate picker: with **Xfinity Stream** marked in Streaming Services, a TV channel (FOX, NBC, CBS, ESPN, TNT, FanDuel North…) opens in Xfinity Stream first, with the network's own app as the second button; a toast says which channel to pick under Live TV. Streaming-only names (ESPN+, Peacock, Prime Video, Apple TV, Netflix) always open their own app.
- **No new data source.** Broadcast names already come with every scoreboard.

### 4.4 Settings

- Watch › Streaming Services gains a **Sports & live TV** group: ESPN, Fox One, Peacock, Paramount+, HBO Max, Prime Video, Apple TV, FanDuel Sports Network, league apps, and live TV services. Same Add/Remove rows, same `state.mediaServices` list.

---

## 5. Budget and egress

- **Supabase:** no new tables, no new rows, no reads beyond the existing session check. Links never go into `tableplan_states`.
- **Streaming Availability quota (1,000/month):** one lookup per title per week, shared through the CDN. A 100-title watchlist that's all looked at weekly is ~430/month. Searches don't call it. The function logs each upstream call; a monthly count is visible in Netlify logs.
- **Kill switch:** env `STREAM_LINKS_DISABLED=1` returns `{ links: null }`, so everything falls back to today's behaviour.

---

## 6. Phases

**Step 1 — One way out + phone test page** (TestFlight build; web part needs a deploy)
- `LinkOutPlugin.swift`, `nativeLinkOut()`, `openOutLink()`; every existing `window.open` hand-off in Watch/Discover goes through it.
- A hidden admin test page (Settings › Admin › Beta) listing every service and network link, each with its app and web URL, so Luke taps through once on the phone and marks which open the app. Results are written into §4.3's table.
- Done when: a Watch card's "Open in Netflix" opens the Netflix app if installed, Safari otherwise.

**Step 2 — Exact title links** (Netlify deploy: new function + env key)
- `stream-links` function, device cache, Watch buttons using the title and next-episode links, fallbacks.
- Done when: "Play" on a movie lands on its page in the service's app, and a show opens on the next unwatched episode.

**Step 3 — Scores** (web + TestFlight; no new function)
- `sports-watch.js`, Watch buttons in Scores and the game card, the Sports & live TV settings group, the live TV picker.
- Done when: a live Vikings game on FOX opens the chosen app with one tap, from Scores and from the dock's game card.

**Step 4 — Later, only if wanted**
- Game-level links where they exist (ESPN `playID`, the NBA app's `nba.com/game/<id>`). They need id mapping from unofficial sources, so they'd be opportunistic with network-level fallback.
- Trailers in the app, through the existing YouTube embed.

---

## 7. Tests

- Unit (vitest):
  - `sports-watch.js`: every broadcast name in the table, aliases, unknown names, "your services" ordering, live TV override;
  - next-episode picking from `seasonProgress` (none watched, mid-season, season finished, show finished);
  - link fallback order (video → title → search);
  - `stream-links` trimming of a recorded API answer, 429 and error paths, kill switch;
  - `openOutLink` on web, native-without-plugin, native-with-plugin (mocked).
- QA script (`qa:watch-links`): Watch card and Scores buttons render, at 390 and 360 px, with mocked function answers.
- Phone (Luke, from the step 1 test page): each service and network opens its app; uninstalled apps fall back to Safari.

---

## 8. Risks

- **Link formats change.** They live server-side (title links) or in one table (`sports-watch.js`), and every link has a web fallback.
- **Free-tier quota.** The CDN cache keeps it well under; if it's hit, buttons quietly fall back to today's search links until the month resets.
- **Rights shift every season** (networks, regional deals). That's why games use the broadcaster names ESPN publishes for each game, not a hard-coded team → network list.

---

## 9. Decisions (Luke, 2026-10-26)

1. **Live TV is Xfinity** — games on TV channels open in Xfinity Stream first (§4.3).
2. **API key:** Luke signs up for the free Streaming Availability plan; the key goes in Netlify env `STREAMING_AVAILABILITY_KEY`. Until then step 2 is off and Watch keeps today's links (now opening the app's home on the iPhone).
3. **Uninstalled apps fall back to the service's website** in Safari, not the App Store.

## 10. What's built (branch `watch-handoff`)

- `ios/App/App/LinkOutPlugin.swift` (registered in `MainViewController.swift` and the Xcode project), `native-bridge.js` `nativeLinkOut()`.
- `link-out.js` — the target catalog, `openOutLink()`, `titleHandoff()`, button attributes. One capture-phase click listener in app.js opens any `[data-link-out]` button.
- Watch: every Open goes through `handOff()` → `watchTitleSpec()` (exact link → app home → search page).
- `media-stream-links.js` + `netlify/functions/stream-links.mjs` (step 2; off without the key).
- `sports-watch.js`; Watch buttons in Scores' expanded game and the dock's game card.
- Watch › Streaming Services: a **Sports apps** group. Settings › Admin › Beta › **Link Test**.
- Tests: `test/media-watch-handoff.test.js` (54). Browser check: `npm run qa:watch-links`.

**Unverified until the phone:** every custom scheme in `link-out.js` (`OUT_TARGETS`) — tap each in Link Test after the TestFlight build and use "Copy results".
