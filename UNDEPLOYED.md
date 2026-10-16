# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Briefings out of News (Listen only)** · #132 · **Netlify deploy** (web; the phone picks it up with the deploy). News has no Briefings view, and Saved leaves out The Morning / The world in brief; they still join Listen's queue. No migration, no new env vars.
  Post-deploy:
  1. News sidebar: Front page · Saved · sections · papers (no Briefings).
  2. News → Saved (Recent and Email tabs, search, archive): no The Morning / The world in brief.
  3. Listen's queue still lists today's briefings, and one plays.

- **Receipt scan: long receipts no longer time out** · #131 · **Netlify deploy** (server + web; the phone gets the server half with the deploy). The AI now writes a compact reply per line, and if a read still runs long it stops at ~26 s with "This receipt took too long to read…" instead of a bare 504. No migration, no new env vars.
  Post-deploy:
  1. Rescan the long (30+ line) receipt that failed on 2026-10-16: the review opens with every line, prices, quantities for weighed items, and budget categories filled where expected.
  2. In Netlify's function logs, `scan-receipt` for that scan finishes well under 26 s.
  3. Scan a short receipt too and check nothing looks different in the review.

- **Recipe photos** (RECIPE_PHOTOS_DESIGN.md steps 1–4) · #130 · **Netlify deploy + TestFlight build.** Own photos load from public Storage and are cached on each device; uploads add a thumbnail; broken photos are hidden; imported recipes carry the website's photo; removing your own photo brings the website's back; a one-time backfill adds website photos to recipes with a source link and no photo. No migration, no new env vars.
  Post-deploy:
  1. Open a recipe with your own photo: the request goes to `…/storage/v1/object/public/recipe-photos/…` (not `/.netlify/functions/recipe-photo`); after a reload it's served by the service worker.
  2. Check the Storage response has `Access-Control-Allow-Origin`. If it doesn't, photos still load but the service worker won't cache them.
  3. The first device to open the app logs `Website photo backfill: N of M recipe pages had a photo.` (about 15 s after load), and recipes from websites show photos.
  4. Import a recipe by URL: the review card and saved recipe show the site's photo. Add your own photo, then remove it: the site's photo comes back.
  5. For 48 hours, watch Supabase API logs (`service: storage`) for repeated hits on one object from one client.
  6. On the iPhone (after the TestFlight build): photos show, and a recipe with a blocked website photo shows no broken image.

_Last deploy: 2026-10-16 (mail attachments in-app, text-box clear, Scores tables, cold-start theme, Watch/Mail/News/Shop tweaks, Shop (i))._
