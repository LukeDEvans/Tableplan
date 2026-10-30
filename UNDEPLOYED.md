# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Messaging step 1: encryption core** — Signal's protocol (X3DH + Double Ratchet) on libsodium in `messaging/crypto/`, plus the message envelope; not wired into the app yet, so nothing visible changes and the app's bundle is unchanged (MESSAGING_DESIGN.md §15–16) · #200 · none.

- **Watch: episode lengths, no TV/M badge** — each episode in a show's panel shows its length when TMDB has it (`tmdb-season` now returns `runtime`; older saved lists reload once per session); posters drop the TV / M badge · #199 · **needs the Netlify deploy** for lengths (server function; the phone calls it too); badge removal is on the iPhone via TestFlight now. After the deploy: open a TV show — its episodes show lengths.

- **Watch: YouTube page, menu text, full poster ring, no service bubble** — "YouTube" in the Watch sidebar (YouTube-only search, saved videos, tap to play in the app; the Watch list's search leaves YouTube out); Watch menu text matches Listen's; the open poster's ring isn't cut off at the row ends; no streaming-service bubble on posters · #198 · iPhone via TestFlight now; on the web after the deploy: Watch › menu › YouTube, search, bookmark a video, clear the search (it's listed), tap it (it plays).

- **Watch: season menu, ⋯ menu, no scroll bars** — the open panel shows one season at a time from a menu (opens on the next episode's season); Watched · Tabs · Remove moved into a ⋯ menu at the panel's top-right; no scroll bar on the Watch list or its tab strip · #197 · iPhone via TestFlight now; on the web after the deploy: open a show, pick another season, use ⋯ → Tabs.

- **Watch: screen stays put, compact season tracker** — opening a season or ticking an episode no longer jumps the list to the top; Watched is a check in a circle; episode rows sit close together; season boxes are ~2/3 the old height · #196 · iPhone via TestFlight now; on the web after the deploy: scroll down to a show, open a season and tick an episode (the screen stays put).

- **Watch: short list at the top, no "+", Other services button** — a short Watch list starts at the top of the screen (was mid-screen; also closes the Movies/TV gap); the "+" beside the tabs is gone (the search bar adds shows); the open panel drops the services headings and folds services outside yours into an "Other services" button that opens a window naming them · #195 · iPhone via TestFlight now; on the web after the deploy: open Watch with a few shows (they start at the top), open a show with services outside yours, tap Other services.

- **Watch: show panel, phone actions, Next episode, Undo, link a plain title** — tapping a poster opens its panel under the whole row (row stays put; a pointer marks the poster and slides within the row); Watched · Tabs · Remove in the panel (they work on the iPhone now); "Next: S3 E6 [✓ Watched]" for TV and a fixed season tracker; Remove waits ~6 s with Undo; "Find the right title" links a plain title; the + window tags "In your list" (WATCH_AUDIT.md decisions 1–4) · #194 · iPhone via TestFlight now; on the web after the deploy: open Watch on the laptop, tap a poster in a full row (the row stays put), tap its neighbour (the pointer slides), Remove → Undo.

- **NYT articles blocked on the phone** — the hidden article reader now identifies as Safari like the sign-in sheet (NYT's bot check blocks a page whose identity differs from the one the session was made with); the reader names the real cause (bot check / sign-in wall / phone error) instead of the server's "HTTP 403", and adds "Open article in the app" (the article in the in-app browser, same cookies, then reload) · PR (this one) · **TestFlight build** (native change). Then open an NYT article: it should load; if NYT shows its check, use "Open article in the app".

- **Newspaper sign-in: hint + honest status** — Sync Settings, the reader and the in-app sign-in sheet say to use email and password (Google sign-in doesn't work in the app); the phone's sign-in check now loads each paper's subscriber page even when a session cookie is there, so a leftover cookie no longer shows "Signed in"; a cut-off article while "Signed in" re-checks and says the sign-in may have expired · PR (this one) · **TestFlight build** (the sheet's hint is native; the rest is in the bundled web code). After it: News › Sync Settings on the phone should show The Economist's real state.

- **Dutch card picture** — the Leisure page's Dutch hobby card shows the windmill picture (`activity-dutch.png`) instead of the translate icon · PR (this one) · none; web only, and the iPhone picks it up with the next TestFlight build.

- **Household Listen and Watch reset** — one-time row reset marker (`views.js` `applyRowReset`) so the emptied Household Listen and Watch rows can't be merged back from a device's old copy · PR (this one) · **post-deploy, in this order:** (1) TestFlight build too (the phone bundles the code); (2) reload every open web tab (laptop Chrome, laptop app, Marijane's browser); (3) write the reset rows (Luke OK'd "start empty", 2026-10-28) with `execute_sql` — see the SQL in the PR description; (4) next day, check both rows are still empty and still carry the marker.

- **News titles** — stories show real headlines instead of the bit of newsletter text that was linked ("your most pressing questions" → the El Niño FAQ's headline); NYT live-blog "Here’s the latest." items read "Live: <blog>"; feed titles with inline markup keep all their words; the hourly job fixes weak titles in the last 3 days (NEWS_TITLES_DESIGN.md) · PR #191 · **Netlify deploy only** (server). After it: once the next hourly run has gone, read `newsfeeds_status` → `titles` (`pagesFound` says whether Netlify can read the papers' pages; `fixed` / `from` say what changed), and check the News Front page and the dock ticker for fragment titles.

- **The Amplifier → Listen bell (music shows)** — NYT's playlist newsletter becomes a show under the Listen bell instead of a queue article: on the iPhone, Play reads the intro and each song's write-up and plays each song from Apple Music in between, with the phone locked too (AMPLIFIER_DESIGN.md). Mail → Automation toggle "“The Amplifier” → Listen bell" · PR #192 · **Netlify deploy** (inbox sweep + `gmail.js` `importMusicShows`) **and a TestFlight build** (native player + bundled web code). After both: open Listen once on the phone (the last ~3 weeks of issues are fetched once per device); check the bell; play a show through two songs with the screen locked; pause and resume from the lock screen during a song and during speech; after the next issue arrives, check the sweep log line `[music-show] … M Apple Music ids` (how many NYT links resolved). Old plain copies of earlier issues may still be in the queue — remove by hand.
