# Post-deploy checks

Checks to do after a deploy — everything here is already **live**. (Work that has NOT
shipped yet is listed in [UNDEPLOYED.md](UNDEPLOYED.md).) When deploying, move each
UNDEPLOYED.md entry's "After deploying" steps here under a heading for that deploy.
Tick items off as they're done; delete a deploy's section once it's all ticked.

## 2026-10-01 deploy (PRs #21, #22, #25, #26, #27, #31)
Web deploy plus a TestFlight build from `main`.

**Native Apple Music in the iOS app (PR #25):**
- [ ] Web: Settings → Apple Music shows "Using: web (MusicKit JS)", and sign-in still works.
- [ ] Next TestFlight build from `main` (not the branch): Apple Music still signs in natively.

**Podcasts: large feeds no longer fail (PR #26):**
- [ ] Open White Coat Investor; recent episodes (late Sept) appear after the next refresh.
- [ ] Re-subscribe to NPR Politics; it should succeed (or show the actual error).

**Sync, auth and service-worker fixes (PR #27):**
- [ ] Sign in on web and phone; edit something on each and confirm it appears on the other.
- [ ] Make an edit and immediately another; reload; both are there.
- [ ] Hard-refresh once so the new service worker (v36) takes over; the app still loads offline.

**Full-app audit fixes (PR #22):**
- [ ] Mail: open an HTML newsletter; it renders (images and links) with nothing broken.
- [ ] Settings → Mail: reconnect Gmail once to confirm sign-in still completes.
- [ ] Calendar: a subscribed ICS calendar shows events at the right local times.
- [ ] Next morning: the presynth cron log shows "triggered worker → 202" (not 403).

**Refresh changed data when the app returns (PR #21):**
- [ ] Leave the iPhone app in the background, edit something on the web, reopen the app after
   2+ minutes: the edit is there without a restart.

**Pre-deploy fixes: deleted trip/chore items no longer come back, Explore on phones (PR #31):**
- [ ] Change a trip's dates on the web, then open Calendar on the phone: one trip bar, not two.
- [ ] Explore on the phone: open and close the trip list; nothing peeks out beside it.

## 2026-09-30 deploy (commit 51efeca, PRs #8–#24)
Luke confirmed these 2026-09-30 (native Apple Music working on TestFlight build 20260930.0247).
Still open: the Instacart key + first send, and the drop-publications migration (Luke's call).

**Needs a new TestFlight build** (the builds sent 2026-09-30 01:45–02:25 UTC were built from
`main` — the workflow ignored the branch — so they carry this deploy's web code but not PR #25):
- [x] Phone app on schema 7: any TestFlight build from 2026-09-30 01:45 UTC on is built from
      main, so it already matches the website.
- [x] Native Apple Music (PR #25 — only in a TestFlight build made from its branch, not merged yet): sign in, play a Discover song, let it roll into the next song while
      locked, lock-screen buttons (CAPACITOR.md "Native Apple Music").
- [x] Articles keep reading with the phone locked (the speech plugin is now actually built in).
- [x] Export a file from Music / Contacts / Finance / Settings → Export → share sheet opens.
- [x] Recipe Box and a couple of dialogs sit below the status bar; mini-player flush at bottom.

**Web / accounts:**
- [x] Reload open browser tabs (and the Chrome extension — recipe imports now go to the review
      queue; import one and check it appears under the bell).
- [x] Siri shortcut: "add bread and remind me to call the plumber" — both land.
- [x] Remove a grocery item on one device; it stays gone on the other.
- [x] Assistant: ask something cross-area ("what's my week look like?").
- [x] Settings → Mail AI: the newly-on features are what you want (vegetarian filter; SimpleFIN
      alert auto-delete; NYT / Economist / Star Tribune articles).
- [x] Media bell: Star Tribune cards appear after the next newsletter; Netlify logs show
      `[news-links] <paper>: N new of M unseen`.
- [x] Safari: Apple Music sign-in opens Apple's popup; Discover → Pop shows genre-specific charts.
- [ ] Instacart: set `INSTACART_API_KEY` (+ `INSTACART_ENV=production`) in Netlify, do one send.
- [x] History log is recording (checked 2026-09-30: 87 media_play, 14 article_read rows;
      ai_chat / practice_event appear once used).
- [ ] Supabase SQL editor: run `migrations/2026-09-29-drop-publications.sql` (drops the unused
      publications/feeds/articles tables — irreversible, your call).
