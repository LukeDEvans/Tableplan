# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Recipe photos** (RECIPE_PHOTOS_DESIGN.md steps 1–4) · #130 · **Netlify deploy + TestFlight build.** Own photos load from public Storage and are cached on each device; uploads add a thumbnail; broken photos are hidden; imported recipes carry the website's photo; removing your own photo brings the website's back; a one-time backfill adds website photos to recipes with a source link and no photo. No migration, no new env vars.
  Post-deploy:
  1. Open a recipe with your own photo: the request goes to `…/storage/v1/object/public/recipe-photos/…` (not `/.netlify/functions/recipe-photo`); after a reload it's served by the service worker.
  2. Check the Storage response has `Access-Control-Allow-Origin`. If it doesn't, photos still load but the service worker won't cache them.
  3. The first device to open the app logs `Website photo backfill: N of M recipe pages had a photo.` (about 15 s after load), and recipes from websites show photos.
  4. Import a recipe by URL: the review card and saved recipe show the site's photo. Add your own photo, then remove it: the site's photo comes back.
  5. For 48 hours, watch Supabase API logs (`service: storage`) for repeated hits on one object from one client.
  6. On the iPhone (after the TestFlight build): photos show, and a recipe with a blocked website photo shows no broken image.

_Last deploy: 2026-10-16 (mail attachments in-app, text-box clear, Scores tables, cold-start theme, Watch/Mail/News/Shop tweaks, Shop (i))._
