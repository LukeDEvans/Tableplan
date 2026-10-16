# Recipe photos — design & plan

Status: **APPROVED DIRECTION (Luke, 2026-10-16). Steps 1–4 built on branch `claude/recipe-photos` (§9); not merged or deployed.** Decisions are in §8. Read from code on `main` @ `246993b` and the live database (read-only queries, 2026-10-16).

Goal: every recipe can show a photo. **Luke's own photo wins.** A recipe imported from a website shows that site's photo until he replaces it. None of this may cause Supabase egress or storage trouble.

---

## 1. What exists today (findings)

**Recipe photos already work end to end.** The problem isn't missing features; it's how photos are served.

- **Storage:** bucket `recipe-photos` (`supabase-photo-storage.sql`).
  - **Public** (`public: true`; the "Anyone can view" policy is open to `anon`). Only Luke's email can upload, update or delete.
  - Live: **7 objects, 3.3 MB total, ~466 KB average.**
- **Upload:** `uploadRecipePhoto` (recipes-ui.js ~3149).
  - Resizes to 1200 px wide, JPEG 0.82.
  - Path is `<userId>/<recipeId>/<kind>-<timestamp>.jpg`, so every upload gets a new file name. Good: a URL never changes content.
  - Sends `cacheControl: 31536000`.
- **Data:** a single field, `recipe.photoUrl`, stored in the `eat_recipes.photo_url` column and mirrored into the `eat` section of state. It holds either:
  - a **storage path** (Luke's own photo), or
  - an **external `https://` URL**, which is hotlinked: never copied, never stored by us.
- **Live data:** 256 recipes; 35 with a photo. **29 are external website images** (from the Gmail recipe digest, whose og:image becomes `photoUrl`, mealplan-ui.js ~268). **6 are Luke's own uploads** (all cook-session photos; 5 stored as paths, 1 as an older full public URL). 224 have a `sourceUrl`.
- **Cook log photos** use the same bucket. "Use as recipe photo" copies a cook-log path into `photoUrl`, so **one file can be referenced twice**.

**The website-photo fallback already half exists.** External URLs pass straight through `recipePhotoProxyUrl`, and uploading your own photo overwrites `photoUrl`. Two gaps:

- **Pasting a URL into the importer ignores the photo.** `parseRecipeHtml` reads the page's JSON-LD Recipe node but never takes its `image`. Only the Gmail digest path sets a website photo.
- **A broken or hotlink-blocked website image** shows a broken image. There's no fallback.

---

## 2. The real egress risk: the photo proxy

Every recipe photo displays through `/.netlify/functions/recipe-photo?path=…&_token=<access token>`. Each uncached view does the following:

1. invokes a Netlify function;
2. calls Supabase `auth/v1/user` to verify the session;
3. calls Storage to **sign** a URL (1 hour);
4. 302s the browser to that **fresh signed URL**, which downloads the whole image from Storage.

Why this defeats caching:
- **The page URL contains the access token**, which changes about hourly. A new token means a new URL, which means a browser-cache miss.
- **Each signature is a different URL** too. The image's own one-year `Cache-Control` never gets a chance to work.
- The 302 is marked `private, max-age=3000`. That helps only within one token's lifetime on one device.
- The service worker doesn't cache any of this (functions and cross-origin requests go straight to the network).

Result: roughly, **each device re-downloads each photo about once per session-hour it views it**, plus three server round trips per view. That's tolerable at 6 photos and ~466 KB each. It gets expensive once most of 256 recipes have photos and the Recipe Box shows them in lists.

**The proxy also protects nothing.** The bucket is public, so `…/storage/v1/object/public/recipe-photos/<path>` already serves any photo to anyone who has the path. The proxy is pure cost.

---

## 3. Field stripping (checked)

Question: would older clients (e.g. a TestFlight build in the wild) drop a new photo field, the way `calendar/model.js` drops unknown event fields?

- **`normalizeRecipe` is safe.** It spreads `...recipe`, so unknown fields survive.
- **The row layer is the risk.** `recipeFromRow` and `recipeToRow` (recipes-ui.js ~545–590) are **explicit column lists**. A new field such as `sourcePhotoUrl` would be:
  - lost on every reload unless it has its own `eat_recipes` column;
  - dropped from the `eat` state mirror by older clients after they reload rows.
- **A new column would survive older clients' writes.** Saves are PostgREST upserts with `resolution=merge-duplicates`, which update only the columns sent. Older clients never send it, so they never clear it.
- **Trap:** `upsertRecipeRows` retries failed saves by stripping *named* columns. A new column that's missing in the database (migration not applied) would make **every recipe save fail**. If a column is ever added, apply the migration before deploying, or add the column to the retry strip lists.

**Conclusion:** the design below needs **no new field and no migration**. It keeps the single `photoUrl` and derives the photo's origin from its value, so there's nothing for older clients to strip.

---

## 4. Design

### 4.1 One field, two kinds (decided)

`photoUrl` stays the only photo field:

| Value | Meaning | Shown as |
|---|---|---|
| storage path (`<user>/<recipe>/…jpg`) | Luke's own photo | public Storage URL (§4.2) |
| `https://…` (not supabase.co) | website photo | the URL directly (hotlinked) |
| `""` | none | placeholder |

- Precedence happens naturally: uploading your own photo replaces the website URL.
- A small helper, `recipePhotoKind(photoUrl) → "own" | "web" | "none"`, drives the UI. For example, a subtle "From website" note under web photos, with "Add your photo" as the obvious action.
- **Reverting to the website photo (decided):** the website photo isn't stored once replaced. Instead, **removing your own photo re-reads the website photo from `sourceUrl`**, using the same lookup as the backfill (§4.5).
  - It needs a connection at that moment.
  - If the site no longer has a usable photo, the recipe shows the placeholder.
  - Recipes with no `sourceUrl` (scanned or typed) simply go back to no photo.
  - A second `source_photo_url` column (instant, offline revert) was considered and rejected. If it's ever wanted, follow the §3 rules.

### 4.2 Serve own photos straight from public Storage

- Replace `recipePhotoProxyUrl` for storage paths with the stable public URL: `${SUPABASE_URL}/storage/v1/object/public/recipe-photos/<path>`.
  - The URL never changes for a given photo, and the file already has a one-year `Cache-Control`. So **each device downloads each photo once.**
  - No function invocation, no auth call, no signing.
- Keep accepting the legacy forms the proxy handled (full public URLs, signed URLs) by extracting the path, as today.
- Retire `netlify/functions/recipe-photo.js` once no client calls it. **Older TestFlight builds still use it**, so leave it deployed until the next TestFlight build has been out for a while.
- **Privacy (decided):** photos stay public-by-unguessable-path, same as today. These are food photos. If anything private ever goes in this bucket, it needs its own private bucket instead.

### 4.3 Device cache

- **Service worker:** add a cache-first rule for `GET https://noyocjcltrenwdovqrql.supabase.co/storage/v1/object/public/recipe-photos/*`, in its own cache (`live-recipe-photos-v1`) so app-version bumps don't wipe it.
  - Responses are CORS-enabled, so they're cached as real responses, not opaque ones.
  - Cap it at about 400 entries, removing the oldest first.
- **iPhone app:** WKWebView honours the HTTP cache and the service worker. No native file cache is needed at this scale.
- **Website photos:** leave to the normal HTTP cache. Don't put them in the service worker: cross-origin images without CORS are opaque, and browsers count each opaque entry as several MB against quota.

### 4.4 Thumbnails

- On upload, also write a **480 px thumbnail** next to the full image: `…/<kind>-<ts>.jpg` plus `…/<kind>-<ts>-thumb.jpg`. The thumbnail path is derived from the main path, so nothing extra is stored on the recipe.
- Lists, the review queue and any future Recipe Box grid use the thumbnail. The recipe view uses the full image.
- **Older photos have no thumbnail.** If the thumbnail fails to load, fall back to the full image once and remember that per path (in memory).
- Keep the full image at 1200 px, JPEG 0.82. WebP would save about 25%, but Safari's canvas WebP *encoding* is unreliable. Stay on JPEG.
- Note: the live average of ~466 KB is above what the current resize should produce (~150–250 KB). Those files probably predate the resize, or came from the cook-session path. A one-time re-encode of the 7 files isn't worth it; new uploads will be smaller.

### 4.5 Website photos on URL import, plus backfill (decided)

- **One shared lookup,** `websitePhotoFor(sourceUrl)`:
  - read the page's JSON-LD Recipe `image`. It can be a string, an array, or an `ImageObject` (`{ url }`); take the first `https` URL;
  - fall back to `og:image` / `twitter:image` from the page `<head>`, the same pattern `_recipe-digest.js` uses.
  - Used by URL import, the backfill, and "remove my photo" (§4.1).
- **URL import:** in `parseRecipeHtml`, set `photoUrl` from the lookup **only when the recipe has no photo yet**. Never overwrite an own photo when re-importing. Check `importViaGateway`'s recipe result for the same rule. mealplan-ui.js already prefers the digest thumbnail, then `fetched.photoUrl`.
- **Backfill (approved, one time):** for every recipe with a `sourceUrl` and no photo (about 190), run the lookup and save the URL.
  - Only URLs are written: a few KB of row updates in total. No images are copied.
  - Run it in small batches, so pages are read server-side. (As built, the app drives the batches; see §9.)
  - Skip recipes whose lookup finds nothing, and report a count (found / not found).
  - Idempotent: a recipe that already has a photo is never touched, so re-running is safe.

### 4.6 Broken website photos

- `<img onerror>` hides the photo and marks that URL bad for the session, so it isn't retried on every render. (Lists then show their placeholder.)
- Optionally, in the recipe view only, offer "Refresh website photo", which re-runs the §4.5 lookup. *(Not built.)*

### 4.7 Cleanup (low priority)

Today **no storage object is ever deleted**: not on replace, not on remove, not when Recently deleted purges a recipe after 30 days.

- Because cook-log photos can share a path with the recipe photo, deleting on replace is risky.
- Instead, run a **monthly orphan sweep** in `daily-maintenance` (the briefing's successor; IOS_NOTIFICATIONS_DESIGN §3):
  1. list the bucket;
  2. collect every path referenced by `eat_recipes.photo_url`, every `cook_log[].photoUrl`, and trashed recipes in state (a `-thumb` file belongs to its photo's path);
  3. delete objects that are unreferenced **and** older than 45 days, which covers the 30-day trash window plus slack.
- At current volume this is housekeeping, not a cost issue.

---

## 5. Egress budget

| Path | Before | After |
|---|---|---|
| View own photo | function + auth call + sign + full download, repeated roughly every token hour per device | one full download per device, ever; then served from cache |
| List / review thumbnails | full image via proxy | ~40 KB thumbnail, once per device |
| Website photos | hotlinked (0 Supabase bytes) | unchanged |
| Backfill | — | ~190 short URL updates, once |
| Recipe rows | `photo_url` string | unchanged |

**Worst case:** all 256 recipes with own photos at ~200 KB full plus ~40 KB thumbnail ≈ 60 MB. Downloaded once by each of about 4 devices ≈ 250 MB, **one time**, spread over months. Steady state is close to zero. Storage: ~60 MB.

**Rules:**
- No image bytes ever go into `tableplan_states` or the `eat` state section. Only a path or URL.
- No photo request carries a token in its URL.
- After deploy, check Supabase API logs (`service: storage`) for repeated hits on the same object from the same client. That would mean caching isn't working.

---

## 6. Build order

1. **Serve directly (§4.2) and the service worker cache (§4.3).** This is the egress fix; ship it first. Web deploy, plus the next TestFlight build for the phone.
2. **Website-photo lookup (§4.5): URL import, broken-image fallback (§4.6), and "remove my photo" falls back to the website photo (§4.1).**
3. **Backfill (§4.5).** Runs once after step 2 is deployed.
4. **Thumbnails (§4.4).**
5. **Later:** orphan sweep (§4.7); retire the `recipe-photo` function (§4.2) once old TestFlight builds are gone.

Nothing here needs a migration. The profile photo (USER_PROFILE redesign) can reuse the upload, public-URL and cache code from steps 1 and 4, in its own bucket.

## 7. Tests

- Unit:
  - `recipePhotoKind`;
  - public-URL building from every legacy form (path, public URL, signed URL with query);
  - `websitePhotoFor`: JSON-LD image (string, array, `ImageObject`, `@graph`), og:image fallback, nothing found;
  - "never overwrite an own photo" on re-import and in the backfill;
  - removing an own photo falls back to the website photo, or to none;
  - thumbnail path derivation.
- Service worker: a cache-first hit for a recipe-photo URL; no caching of other Supabase URLs.
- QA:
  - an own photo loads with no request to `recipe-photo` and no repeat download after a reload or an hour;
  - URL import shows the site photo; uploading your own replaces it; removing yours brings the site photo back;
  - a blocked website image shows the placeholder;
  - backfill report counts look right, and a re-run changes nothing.

## 8. Decisions (Luke, 2026-10-16)

1. **Privacy:** photos stay **public-by-path** (unguessable paths in a public bucket), as today.
2. **One photo field:** no second column. Removing your own photo re-reads the website photo from the recipe's source link (§4.1).
3. **Backfill:** yes. Fill in website photos for recipes that have a source link and no photo (§4.5).

---

## 9. As built (branch `claude/recipe-photos`, 2026-10-16)

Steps 1–4 of §6 are built. Step 5 (orphan sweep, retiring `recipe-photo`) is not.

- **`recipe-photos.js`** (pure, client): `recipePhotoKind`, `recipePhotoStoragePath` (path, public URL or signed URL → path), `recipePhotoThumbPath`, `recipePhotoDisplayUrl`, `pickImageUrl`, and the backfill helpers `recipesNeedingWebsitePhoto` / `applyWebsitePhotos` (never overwrites a photo; only applies a real https URL).
- **`netlify/functions/_recipe-photo.js`** (pure, server): `websitePhotoFromHtml` — the Recipe node's JSON-LD `image` (incl. `@graph`, arrays, `ImageObject`), else `og:image` / `twitter:image`; relative URLs resolved, http upgraded to https, `data:` refused. `_recipe-extract.js` now returns `photoUrl` with every extracted recipe, so URL import and the Gmail path carry the site's photo.
- **`netlify/functions/recipe-website-photo.js`**: `POST { urls }` (max 6, fetched in parallel through `safeFetch`, 6 s each) → `{ photos: { url: photoUrl | "" } }`. Session-verified; touches Supabase only for that check; stores nothing.
- **`recipes-ui.js`**:
  - every photo renders through `recipePhotoImg`, which loads own photos from the public URL (thumbnail where small) and websites' as stored;
  - one capture-phase `error` listener: a missing thumbnail retries the full photo; any other failed photo is hidden and not retried that session;
  - uploads write the photo plus a `-thumb` file (480 px); a failed thumbnail never fails the upload;
  - the editor labels website photos, and says so when removing your own photo from a recipe with a website; on save, `restoreWebsitePhotoFor` looks the website's photo up again;
  - the client-side `parseRecipeHtml` (used only when there's no import gateway) also picks up the page photo.
- **Backfill — deviation from §4.5:** it runs **in the app, not as a server batch job**. About 15 s after recipe rows load, each device (once, marked in `localStorage`) sends recipe source URLs to `recipe-website-photo` in batches of 6 and saves found photos through the normal row-save path (`saveRecipeRows`, `return=minimal`). Why: it reuses the existing write path and permissions instead of adding service-role writes to `eat_recipes`. It's idempotent, so a second device only looks up what the first couldn't fill. It stops at the first failed call and tries again next app open.
- **`sw.js`**: recipe-photo public URLs are served cache-first from `live-recipe-photos-v1` (capped at 400, oldest out), which survives app-version bumps. The worker re-asks in CORS mode so it can store a real response; if CORS fails it falls back to the page's own request, uncached.
- **Not built:** "Refresh website photo" button (§4.6, optional); orphan sweep (§4.7); retiring `recipe-photo.js` (older TestFlight builds still call it).
- **Tests:** `test/recipe-photos.test.js` (36: helpers, client/server twin parity, extractor, function, service-worker cache in a sandbox). **QA:** `npm run qa:recipe-photos` (14 checks through the real recipe view and editor, with Storage and website images mocked).
- **Post-deploy checks:**
  - an own photo's request goes to `…/storage/v1/object/public/recipe-photos/…` and a reload serves it from the service worker (DevTools → Network: "(ServiceWorker)");
  - Storage public responses carry `Access-Control-Allow-Origin` (if not, photos still load but aren't cached by the worker);
  - the backfill's console line (`Website photo backfill: N of M…`) on the first device, and recipes showing website photos;
  - Supabase API logs (`service: storage`): no repeated hits on one object from one client.
