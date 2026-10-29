# Music shows in Listen (NYT's The Amplifier) — design & as built

Status: **Built on branch `claude/amplifier-listen` (2026-10-28). Asked for by Luke, 2026-10-28**
("have the TTS read the write-up, then the first song's write-up, then play the song, then move on
through the rest … send it to the notifications section of the Listen page"; a native player piece
is fine). Not merged or deployed. Needs a Netlify deploy (the sweep and Gmail function) **and** a
TestFlight build (the native player and the app code).

## What it does

NYT's **The Amplifier** arrives → the inbox sweep turns it into a **show** under the **Listen bell**
(it no longer lands in the queue). Tapping **Play** on the iPhone plays:

intro (title, author, the "Dear listeners" letter) → **"Number 1: Blister in the Sun, by Violent
Femmes."** + its write-up → **the song from Apple Music** → song 2's write-up → song 2 → … → done.

It keeps going with the phone locked. Finishing it, or tapping ×, takes it off the bell (marked read,
kept in history). **Read** opens it as an article; outside the iPhone app, Play does the same.

## How

| Piece | Where |
|---|---|
| Parse the newsletter (no AI: headings `N. Artist: "Title"`, write-ups, the per-song "Listen on Apple Music" link) | `netlify/functions/_music-show.js` `parseMusicShow` |
| Song id: follow the NYT tracking link (manual redirects, hosts allowlisted, ≤5 hops, 5 s each) to `music.apple.com/…?i=<id>` | `resolveAppleMusicLink` |
| Save: a saved article `show-<gmail id>` in the person's own `media` row, with `text` (the whole thing as an article, for any client) and `musicShow` (what the bell plays) | `musicShowArticle`, sweep branch in `_gmail-shared.js` |
| Issues from before this existed: fetched once per device (last 21 days, at most 2) | `gmail.js` action `importMusicShows`, `importRecentOnce` in the app |
| Bell, badge, Play / Read / ×, following playback | `media-music-show-ui.js` (`createMusicShowsModule`) |
| Bell list, segments, catalog matching (pure, tested) | `media-music-show.js` |
| Native player: a new queue item kind **`appleMusic`** beside speech/audio/live, played through MusicKit's `ApplicationMusicPlayer`; end of song detected natively, so the queue moves on with the phone locked; upcoming songs looked up ahead of time | `ios/App/App/LiveTtsPlugin.swift` |
| The web music player hears nothing while a show's song plays | `AppleMusicPlugin.swift` (`LiveTtsPlugin.ownsAppleMusicPlayer`) |
| Toggle | Mail → Automation → "“The Amplifier” → Listen bell" (`amplifierToListen`, on by default). Off: converted like any NYT newsletter, as before. |

- A song whose link didn't resolve is searched in Apple Music (artist + title) when Play is tapped;
  the match must agree on title **and** artist, so a cover never plays. Found ids are saved back.
- Not signed in to Apple Music: the write-ups still play, with a note.
- A song that won't play is skipped with a note.
- During a song, MusicKit runs the lock screen (pause/play). During speech, the app's own controls.
- Mini-player: the part playing ("Playing Blister in the Sun · Violent Femmes") under the show's
  title; skip forward / back move a part at a time; no progress bar.
- Resume point is per device (`live-music-show-pos-v1`).

## Egress

One show is ~15–20 KB in the person's `media` row (the text twice: article + show), once a week.
The first-run import reads the `media` row once per device. No polling, no new tables.

## Not verified (no network to NYT or a Mac/iPhone in the build sandbox)

- Where NYT's tracking links actually land. Built for a redirect to `music.apple.com` (or a page that
  points there); if it's something else, songs fall back to the catalog search. The sweep logs
  `[music-show] … (N songs, M Apple Music ids)` — check it after the first issue.
- The Swift changes have not been compiled. Build in Xcode before TestFlight.
- On the phone: song-end detection with the screen locked, the lock screen during a song (MusicKit's
  "next" may do nothing on a one-song queue), and the hand-back to speech. See ISSUES.md.

## Checks

- `test/media-music-show.test.js` (23): parser against a copy of a real issue's markup with
  placeholder prose, link resolution with mocked fetch, the saved record, segments, bell list,
  matching.
- `test/media-music-show-ui.test.js` (11): playback with a fake native player — what it hands the
  plugin, following along, resume, songs found by search, finishing, giving way, no Apple Music,
  outside the app, the first-run import.
- `npm run qa:music-shows` (22 checks, 390 and 360 px): badge, window, ×, closing when emptied, the
  empty bell's toast, Play → read in a browser, the queue leaving shows out, no sideways scroll.
- Full suite (3069 + 43), architecture guards, `vite build`, boot check.
