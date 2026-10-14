# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-10-14 (Display + Halloween theme, profile redesign, settings cleanup, reminders switch, Amazon PDF receipts)._

- **Restore Apple Music, always on, no Settings panel** · PR #105 · Reverts the Apple Music removal from #101 (Luke: that was a misunderstanding). Apple Music is always on with no switch; Settings has no Apple Music panel; sign-in is the banner in Listen › Music › Discover. **Brings back the `apple-music-token` function, so it needs a deploy.** The `APPLE_MUSIC_*` Netlify env vars must still be set (couldn't confirm from the cloud session). **After deploy:** play a saved Apple Music song (it no longer says "isn't streamable"); if Discover shows "Apple Music isn't reachable", check the env vars; if it shows the Sign in banner, sign in there; check gear → Settings has no Apple Music row.
