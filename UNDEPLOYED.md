# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-10-06 (PRs #51–#56)._

- **Media: the reader's Play button plays the open article; an add while the queue plays is reached** · PR #59 · **Fix:** with another article loaded (or, in the iPhone app, a podcast playing), pressing Play in an open article resumed that other audio. It now starts the article that is open, and the button shows Pause only while that article is the one being read. **Fix:** "Add to queue" while the queue was already playing put the item in the list but playback never reached it, because the queue plays from the order captured when it started. The add now joins that running order (and the iPhone app's up-next list). No state changes. **After deploy:** (1) fully close and reopen the app (or install the new TestFlight build) first; (2) play any article, open a different one, press Play: the second one should start; (3) on the iPhone, with a podcast playing, open an article and press Play (the native path was read from code, not run on a device); (4) with the queue playing, add an older episode and let the queue run to it.
