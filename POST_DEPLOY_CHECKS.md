# Post-deploy checks

Checks to do after a deploy — everything here is already **live**. (Work that has NOT
shipped yet is listed in [UNDEPLOYED.md](UNDEPLOYED.md).) When deploying, move each
UNDEPLOYED.md entry's "After deploying" steps here under a heading for that deploy.
Tick items off as they're done; delete a deploy's section once it's all ticked.

## 2026-09-30 deploy (commit 51efeca, PRs #8–#24)
Things only Luke can check (real accounts, the phone, the Supabase dashboard). Tick off or
delete as they're done.

**Needs a new TestFlight build** (the builds sent 2026-09-30 01:45–02:25 UTC were built from
`main` — the workflow ignored the branch — so they carry this deploy's web code but not PR #25):
- [x] Phone app on schema 7: any TestFlight build from 2026-09-30 01:45 UTC on is built from
      main, so it already matches the website.
- [ ] Native Apple Music (PR #25 — only in a TestFlight build made from its branch, not merged yet): sign in, play a Discover song, let it roll into the next song while
      locked, lock-screen buttons (CAPACITOR.md "Native Apple Music").
- [ ] Articles keep reading with the phone locked (the speech plugin is now actually built in).
- [ ] Export a file from Music / Contacts / Finance / Settings → Export → share sheet opens.
- [ ] Recipe Box and a couple of dialogs sit below the status bar; mini-player flush at bottom.

**Web / accounts:**
- [ ] Reload open browser tabs (and the Chrome extension — recipe imports now go to the review
      queue; import one and check it appears under the bell).
- [ ] Siri shortcut: "add bread and remind me to call the plumber" — both land.
- [ ] Remove a grocery item on one device; it stays gone on the other.
- [ ] Assistant: ask something cross-area ("what's my week look like?").
- [ ] Settings → Mail AI: the newly-on features are what you want (vegetarian filter; SimpleFIN
      alert auto-delete; NYT / Economist / Star Tribune articles).
- [ ] Media bell: Star Tribune cards appear after the next newsletter; Netlify logs show
      `[news-links] <paper>: N new of M unseen`.
- [ ] Safari: Apple Music sign-in opens Apple's popup; Discover → Pop shows genre-specific charts.
- [ ] Instacart: set `INSTACART_API_KEY` (+ `INSTACART_ENV=production`) in Netlify, do one send.
- [x] History log is recording (checked 2026-09-30: 87 media_play, 14 article_read rows;
      ai_chat / practice_event appear once used).
- [ ] Supabase SQL editor: run `migrations/2026-09-29-drop-publications.sql` (drops the unused
      publications/feeds/articles tables — irreversible, your call).
