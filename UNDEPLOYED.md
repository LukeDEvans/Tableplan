# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Nothing undeployed. Last deploy: 2026-09-30 (commit 51efeca, PRs #8–#24)._

## Open post-deploy checks from the 2026-09-30 deploy
Things only Luke can check (real accounts, the phone, the Supabase dashboard). Tick off or
delete as they're done.

**Needs the new TestFlight build** (built 2026-09-30 from `claude/native-apple-music`,
PR #25, which also carries the schema-7 web code):
- [ ] Install it before making finance changes in the phone app (schema 7; an older build's
      finance edits are reverted by the server).
- [ ] Native Apple Music: sign in, play a Discover song, let it roll into the next song while
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
