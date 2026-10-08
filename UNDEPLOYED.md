# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-10-08 (PRs #72–#76)._

- **Mail: emails open with their images, without the wait** · PR #79 · **Change:** an image-heavy email used to sit unsized until every image had downloaded, which is why images were blocked in July. The email is now fitted as soon as its text is in, and images fill in afterwards, nearest the screen first. Remote images load by default with tracking pixels removed; images embedded in an email (logos, inline photos) now show; Settings → Mail Reading has a "Load images in emails" switch to go back to blocking. New synced setting `mailReadingPrefs` (config section, no schema bump). No Supabase load from images. **After deploy:** (1) fully close and reopen the app; (2) on the iPhone open a picture-heavy newsletter: the text should be readable at once and the pictures should fill in, including ones further down as you scroll to them (the scroll-triggered loading was only tested in Chromium); (3) open an email with a logo or photo embedded in it and check it shows; (4) Settings → Mail Reading: switch "Load images in emails" off, reopen an email, confirm no pictures and that … → Display images brings them back; switch it on again.
