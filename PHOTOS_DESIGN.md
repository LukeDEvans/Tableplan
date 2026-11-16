# Photos — outline

Status: **OUTLINE, ALL OPEN QUESTIONS ANSWERED** (decisions from Luke, 2026-11-15). **Step 1 (count) built and run on Luke's phone (§14); step 2 (tables, thumbnails, first sync into Personal) built (§15, §16).** Next: step 3, the page. Items marked *check* need confirming before their step is designed in detail.

Goal: a **Photos** page that gathers the family's photos from iCloud Photos and Google Photos into one library inside Liv, shared in Household and private in Personal, searchable by an assistant later. It should also **encourage cleaning up**: finding and removing duplicates, old screenshots and other clutter. It starts as a layer over Apple and Google and takes over the originals when the home server arrives.

---

## 0. Decisions (Luke, 2026-11-15)

| # | Question | Decision |
|---|---|---|
| 1 | Where originals live | **Staged.** Stage 1: Liv holds thumbnails, details and search; originals stay in iCloud / Google. Stage 2: originals move to the home server. |
| 2 | Where photos are today | **iCloud Photos and Google Photos.** Google Photos is an **old library**: nothing new is backed up there, so one import covers it. |
| 3 | Sharing | **A shared Household library plus a private Personal library**, like Document. |
| 4 | Privacy | **Everyday protection** (sign-in and row security) for the library, plus a **Face ID encrypted private album**. |
| 5 | Where a camera roll lands | **Personal, then share.** Luke's roll goes to Personal and he moves or auto-shares into Household. Marijane picks albums or a start date to share, so her whole roll isn't shared. |
| 6 | Full size on the laptop (stage 1) | **Thumbnails only.** The laptop is for browsing and organizing; full size is on the phone until the home server. |
| 7 | Videos | **In the first version**: listed with a thumbnail and length, played from the phone that has them. Nothing extra stored. |
| 8 | Screenshots and clutter | **Shown with everything**, not hidden. The page should help clean them up (§8). |
| 9 | Editing | **Hand off to Apple's editor**; the edited photo syncs back. |
| 10 | Sharing outside the household | **Share sheet only** for now. |
| 11 | Deleting | **Delete everywhere.** Deleting in Liv also deletes from the iPhone and iCloud (iOS confirms; Apple keeps it 30 days in Recently Deleted). |

---

## 1. The two stages

**Stage 1 (now, no new cost)**
- Liv keeps a **record of every photo and video** (date, place, size, labels, people, which source has the original) and a **small thumbnail**.
- The timeline, albums, people, places, search and clean-up all work from those.
- Opening a photo full size, playing a video and editing happen on the **phone**, from its own library. The **laptop** shows thumbnails only (decision 6).
- iCloud keeps doing the storing and backing up.

**Stage 2 (home server)**
- Phones upload **originals** to the home server through the same storage adapter Document uses (DOCUMENTS_DESIGN §5.3).
- Once everything is verified there (count, sizes, hashes) and backed up off-site, iCloud Photos and Google Photos can be turned off.
- The laptop gains full size and video. Nothing else in the page changes; a photo's record just gains a second place its original can be read from.

---

## 2. Sources

| Source | How | Notes |
|---|---|---|
| **iPhone library** (Luke's and Marijane's phones) | A new native plugin on Apple's PhotoKit: lists the library, reads details, makes thumbnails, watches for new photos, deletes (with iOS's confirmation), opens Apple's editor. | With iCloud Photos on, this *is* the iCloud library. Full-size originals may need a download from iCloud when "Optimize iPhone Storage" is on. Needs full library permission. |
| **Google Photos** | **One-time import**, on the laptop, from a Google Takeout export. | An old library (decision 2), so no live sync is needed. Google's API no longer lets an app read a whole library (*check* the current rules before building). Photos that also exist in iCloud are matched and not doubled (§3). In stage 1 the import stores records and thumbnails only; the originals stay in Google until stage 2. |
| **Upload** | Web / laptop drag-and-drop; the phone's share sheet. | For camera cards, old drives, photos people send. *Check:* where an uploaded original is kept in stage 1 (it has no iCloud copy); simplest is to save it into the phone's library. |
| **Photos already in Liv** | Recipe photos, cook-log photos, Explore trip pictures, profile photos. | Shown as albums that read from where those already live; not copied. Document scans and receipts stay out. |

---

## 3. Data model

`migrations/2026-11-16-photos.sql`, applied 2026-11-16 (§15). **Nothing in `tableplan_states`, no `STATE_SCHEMA_VERSION` bump** (same rule as Document). Row security by scope, through Document's existing `doc_can_access()`: Household group id or `u-<uid>`.

- `photo_items`: id (made on the phone), scope, kind (photo / video), screenshot / Live / burst flags, taken_at, width, height, duration, bytes of the original, lat, lng, place_name, content_hash (later), favourite, labels and body_text (later, §6), has_thumb, thumb_bytes, added_by, created / updated / deleted.
- `photo_sources`: where an original is: `iphone` (a per-install device key + Apple's local id), `google`, `upload`, `home` (stage 2). Unique per (kind, device key, local id), so a re-sync can't double a photo. `missing_at` when the source no longer has it.
- Albums and people come with their steps (6 and 11), as their own tables.

Rules:
- **Every photo belongs to one scope** (VIEWS_DESIGN §2.2), and **can move** (decision 5): the update policy needs access to the old scope and the new one, so a person can only move a photo between scopes they use. Sources follow their photo.
- **Duplicates** are matched by content hash first, then by date + size + camera for copies Google re-compressed. Exact matches across sources become one photo with two sources; near matches are offered in Clean up (§8), never merged silently.
- **Thumbnails** go in R2 at `ph/<photo id>/thumb` (about 400 px, ~30 KB). No scope in the path, so moving a photo copies nothing. The storage function signs a link only when `photo_blob_allowed()` says the caller can see the photo; with no row, nobody can upload.
- Nothing is hard-deleted by a client: Recently deleted for 30 days, then `photo_purge()` (sources go with it, and the thumbnail may then be deleted).
- `photo_usage(scope)` gives the thumbnail bytes, added to Document's figure for the 7 GB warning.
- Clients fetch **changes since** their last sync, never the whole table.

---

## 4. Views and sharing (decisions 3, 5)

- **Household Photos:** the shared library.
- **Personal Photos:** Luke's alone, with Household available as a layer.
- Photos is added to `VIEW_PAGES` for Household and Personal, in the Media group beside Watch and Listen.
- **Luke's camera roll lands in Personal.** He moves photos into Household by hand, or by an **auto-share rule** (for example: photos with chosen people, or taken on a trip in Explore). Rules to be designed with step 4.
- **Marijane** has only the Household view. At setup her phone asks what to share: chosen albums, or everything from a start date. Photos she doesn't share never leave her phone: no record, no thumbnail.
- If she gets a Personal view later, her unshared roll can sync there without changing anything in Household.

---

## 5. Private album (decision 4)

- Built on the **Safe** (DOCUMENTS_DESIGN §3, §8): vault key, Face ID on every open, encrypted on the device, thumbnails included.
- Private photos are **left out** of the timeline, search, people, places, clean-up and anything an assistant can reach.
- One in each view, like the Safe. Moving a photo in removes its everyday record and thumbnail.
- In stage 1 the original still sits in iCloud unencrypted; the page says so plainly. Real protection for the original comes with stage 2.

---

## 6. Search and intelligence, on the phone

- Apple's Vision framework reads each photo on the device: **labels** (beach, dog, birthday cake), **text** in the picture, and **faces**.
- Results are stored on the photo's record, so every device can search without re-reading the picture and **no photo is sent to an AI service**.
- **People:** Apple doesn't share its own People albums with apps (*check*), so grouping faces into named people is Liv's own work: the largest unknown in this outline. It can come after the first version.
- **Places:** from the photo's location, grouped the way Explore groups trips.

---

## 7. The page

Watch's shell, as with Document.

- **Sidebar:** Timeline · Albums · People · Places · Favourites · **Clean up** · Private · Recently deleted.
- **Head:** search (with the standard clear "x") and **Add** on the right.
- **Timeline:** a dense grid by day / month / year, pinch or a control to change density, a date scrubber on the right edge. Screenshots, screen recordings and videos appear with everything else (decision 8); videos show their length.
- **Photo view (phone):** swipe between photos; details (date, place, people, albums, which source); Share (share sheet, decision 10), Favourite, Add to album, Move to Household / Personal, Move to Private, **Edit** (Apple's editor, decision 9), Delete.
- **Laptop:** the same page with thumbnails; organizing, albums, search and clean-up choices all work. Opening full size, video and editing say "on your phone" until stage 2.

**Deleting (decision 11)**
- Delete removes the photo from Liv **and** from the iPhone and iCloud. iOS shows its own confirmation, and Apple keeps it in its Recently Deleted for 30 days; Liv's Recently deleted mirrors that so "Put back" works.
- A delete chosen on the **laptop** is queued and carried out the next time the owning phone opens Liv, with one iOS confirmation for the batch.
- A photo that came only from Google (no iCloud copy) is removed from Liv; its original is skipped when stage 2 copies Google's files across.
- *Check:* a photo on Marijane's phone that Luke deletes from Household. Suggested: it leaves Household, and her phone asks before deleting her original.

---

## 8. Clean up

A goal of the page, not an extra (decision 8): make it easy and satisfying to shrink the library.

- **Groups offered:** exact duplicates · near duplicates and bursts (keep the best) · screenshots, oldest first · screen recordings · blurry or dark shots · large videos · receipts and paperwork (offer "Send to Document" first).
- **Review flow:** one group at a time, swipe or tap Keep / Delete, with the suggested keeper marked. Nothing is ever deleted without the person choosing it.
- **Progress:** a running count of photos and space cleared, and what's left to review, so a session of a few minutes feels worthwhile.
- **Assistant later:** "you have 400 screenshots older than a year; review them?" is a natural prompt once the assistant exists.
- Finding the groups uses the content hash, the phone's own "screenshot" flag, and on-device reading (§6). Near-duplicate and blur detection are *check*: how good Apple's built-in measures are.

---

## 9. Ties to the rest of Liv

- **Explore:** a trip gets an automatic album from its dates and places.
- **Calendar:** an event can show the photos taken during it.
- **Recipes:** "Choose from Photos" for a recipe's photo; cook-log photos appear as an album.
- **Profile and view logos:** picked from the library.
- **Messages:** send a photo or an album as a card.
- **Document:** a photo of paperwork can be sent to the scanner flow instead of living in Photos.
- **Themes:** an optional landing-page picture from a chosen album (later).

---

## 10. Assistant hooks

Photos exposes the same small set of calls every page should offer the future assistant (see the note on the assistant layer below):

- `photos.search({ text, people, place, from, to, album, kind })`
- `photos.get(id)`, `photos.albums()`, `photos.addToAlbum(ids, album)`
- `photos.cleanupGroups()`: suggestions only
- `photos.share(ids, to)` and any delete: always confirmed by the person
- Never reaches the Private album.

---

## 11. Cost and egress

| Item | Size | Volume (guess) | Where |
|---|---|---|---|
| Thumbnail | ~30 KB | 17,768 now ≈ 521 MB (Luke's library, counted 2026-11-16) | R2 (free tier is 10 GB, shared with Document) |
| Record | ~1 KB | 17,768 ≈ 17 MB | Supabase rows |
| Originals, video, screen-size copies | — | — | **Not stored in stage 1** (decisions 1, 6, 7) |

- **Counted (2026-11-16, §14):** Luke's library is 17,768 items, 102 GB of originals; thumbnails ≈ 521 MB, 5% of the free tier.
- Thumbnails download free from R2 and are cached on each device; nothing passes through a Netlify function or `tableplan_states`.
- The first sync of a large library is the one heavy moment: do it in batches, on Wi-Fi and power, with a progress line.
- Storage shows in the same "storage used" figure as Document, with the 7 GB warning.
- Clean-up lowers all of these, and the size of the stage 2 move.

---

## 12. Build order

1. **Count and probe (phone only):** the native plugin reads the library and reports how many photos, videos and screenshots, total size, and how many originals are on the phone vs only in iCloud. Settles the cost table. TestFlight. **Built, §14.**
2. **Tables + thumbnails:** migration (Luke's OK), storage paths, the first sync from Luke's phone into Personal.
3. **The page:** Timeline (photos, videos, screenshots), photo view, Favourites, delete everywhere with Recently deleted, Apple's editor, share sheet. TestFlight, then a batched deploy for the laptop's thumbnail view.
4. **Household:** moving photos across, auto-share rules, the Household layer in Personal.
5. **Clean up, first pass:** exact duplicates, screenshots, screen recordings, large videos.
6. **Albums and ties:** manual albums, Explore trip albums, recipe photo picker.
7. **On-device reading:** labels, text, places, search; then near duplicates and blurry shots in Clean up.
8. **Google Takeout import** with duplicate matching.
9. **Private album** on the Safe.
10. **Marijane's phone** joins (chooses albums or a start date).
11. **People.**
12. **Stage 2:** originals to the home server; full size and video on the laptop; turn off iCloud / Google.

---

## 13. Still to check or decide (smaller)

- Google's current API rules, and the Takeout format (*check*, step 8).
- Whether apps can read Apple's People groupings (*check*, step 11).
- Where an uploaded photo's original is kept in stage 1 (§2).
- Deleting a Household photo whose original is on the other person's phone (§7).
- What the auto-share rules can be (§4).
- Quality of Apple's built-in near-duplicate and blur measures (§8).

---

## 14. As built: step 1, count and probe (branch `claude/photos-probe`, 2026-11-15)

No Photos page yet. The count lives in **Settings › Beta › Photos Check** (admin), so it can run before any table or page exists.

- **`ios/App/App/PhotoLibraryPlugin.swift`** ("PhotoLibrary", registered in `MainViewController`, in the Xcode project; `NSPhotoLibraryUsageDescription` added): `status()`, `probe()`, `cancel()`, and a `photoProbeProgress` event every 500 items.
  - It **only reads and counts**. No photo is opened, no thumbnail is made, nothing is written or deleted, nothing leaves the phone.
  - Per item it reads: kind, screenshot / Live / burst flags, favourite, whether it has a place, date, video length, and from its files the size and whether the original is on the phone.
  - Size and "on this phone" come from two fields Apple doesn't document (`fileSize`, `locallyAvailable` on `PHAssetResource`). They are read only when present; otherwise the item is counted as unknown and the report says how many.
  - Hidden photos aren't counted. Screen recordings have no public flag, so they count as videos (step 5 will need another way to find them).
- **`nativePhotoLibrary()`** in `native-bridge.js`.
- **`photos/probe.js`** (pure): the report's rows, the storage estimate (30 KB thumbnail and 1 KB record per item, against R2's free 10 GB and the 7 GB warning line), notes (limited access, missing sizes), and the text for "Copy results".
- **app.js:** `renderPhotosCheckPanel` / `runPhotosProbe`. The last result is kept on the device only (`live-photos-probe-v1`). In a browser the panel says it's a check for the iPhone app.
- **`.claude/agents/photos.md`**: the new domain agent.

**Verified:** `test/photos-probe.test.js` (report rows, estimates, broken input, notes); the full unit suite; the build; the boot check.

**Not verified:** the Swift (no compiler in the session; the iOS compile check runs on the pull request) and everything on an iPhone: the permission prompt, whether `fileSize` and `locallyAvailable` answer on the current iOS, how long a full library takes, memory use. That needs the TestFlight build.

**What the result decides:** if thumbnails fit the free tier (§11), step 2 goes ahead as written. If most originals are only in iCloud, the first sync (step 2) must ask iOS for thumbnails only, never originals.

---

**Result (Luke's phone, 2026-11-16):** 17,277 photos and 491 videos (3 h 1 min), May 2012 to Nov 2026; originals 88.0 GB of photos and 13.7 GB of video (102 GB); 254 screenshots (637 MB), 8,987 Live Photos, 5 bursts, 97 favourites, 87% with a place. 2022 (6,727) and 2023 (5,075) hold two-thirds of it. Counted in 144 seconds.
- **"On this phone" didn't work:** every item came back unknown (`locallyAvailable` doesn't answer on this iOS). Sizes did. Not needed for step 2 (iOS supplies thumbnails either way); stage 2 needs another way to tell.
- **Screenshots are a small part** (254), so near-duplicates are the bigger clean-up; consider moving them ahead of screenshots in Clean up.
- **Panel bug:** the Settings sheet's top row scrolls under the status bar on the phone. Fix with step 2's build.

---

## 15. Step 2: the tables (applied 2026-11-16)

`migrations/2026-11-16-photos.sql` (§3). Additive only: two tables, their row security, a guard trigger and four functions (`photo_can_access`, `photo_purge`, `photo_blob_allowed`, `photo_usage`). **Applied 2026-11-16 with Luke's OK** (schema_migrations 20261116120500). Checked live afterwards: row security on both tables, three policies each, the guard triggers, no anon access, no DELETE or TRUNCATE for signed-in users, the author column not updatable, the guard function not callable; the security advisor lists the four functions as callable by signed-in users, which is intended (each answers only for photos the caller can see).

**Verified:** `test/photos-migration.test.js` (11) against PGlite with the real Document and messaging migrations, as Luke, his wife, a coworker, a stranger and anon: Personal private, Household shared, moves only between scopes the person uses, sources follow their photo and can't be doubled or re-pointed, no hard deletes, purge only after 30 days, thumbnails only for photos the caller can see. **Planted bugs:** six, each caught; three of them only once a second safeguard was also removed (the read policy re-checks a move; column grants and the guard both stop author and source changes).

**Rest of step 2:** §16.

---

## 16. Step 2: the first sync (built 2026-11-16)

Settings › Beta › Photos Check gains **Sync to Personal** (admin; only into the person's own `u-<uid>` library, decision 5).

- **Phone** (`PhotoLibraryPlugin.swift`): `deviceKey()` (a hash of the vendor id: stable for this install, says nothing about the phone), `list({ offset, limit, since })` (details in pages, oldest first so new photos never shift a page; `since` keeps only photos added or changed after it), `thumbs({ ids })` (JPEG, longest side 400 px, quality 0.72, made on the phone; iCloud-only photos are fetched at that size, never the original), and `status()` now says whether the network is expensive.
- **`photos/sync.js`** (tested with a fake phone, database and store): a photo's record id is derived from (device key, the phone's id for it), so a re-run or a crash never doubles a photo; inserts ignore rows that exist; each batch of 50 first asks which already have a thumbnail and skips them; the "listed up to" time is saved only after a run with no failed thumbnails, so anything missed is retried. Newest photos go first.
- Per batch of 50: one read, one insert of records, one of sources, two signing calls, 50 uploads straight to R2, one update. No photo bytes touch Supabase.
- **Storage function** (`doc-storage`): a `photos` tier signs `ph/<photo id>/thumb` only when `photo_blob_allowed` says the caller can see the photo (and, to delete, that it's 30 days in Recently deleted); 2 MB cap per thumbnail; no scope in the request. Document's paths are unchanged.
- **Panel:** progress, Stop, a cellular warning before uploading, what's in Personal (count, thumbnail storage) and the 12 newest thumbnails (links last 10 minutes; the panel refreshes after 5). Going to the background stops the sync; Sync again carries on.
- **Settings sheet:** sized and centred within the safe area, so a long panel no longer scrolls under the status bar (§14's bug).

**Verified:** `test/photos-sync.test.js` (9: ids, rows, a full sync newest first, a re-run that uploads nothing, a stop part way that finishes cleanly, failed thumbnails retried, Personal only, the summary); photos tests in `test/documents-edge-function.test.js` (signing, refusals, deletes, mixed batches); planted bugs in both caught; full suite, build, boot check; the Settings sheet at 360 px (centred, a long panel scrolls inside it).

**Not verified:** the Swift (compiled by the PR's iOS check) and anything on the iPhone: thumbnail quality and speed, iCloud-only photos, memory over 17,768 photos, the safe-area fix under the real status bar.

**Not yet:** photos deleted or changed on the phone after syncing (step 3 with the page); Household; the page itself.

**First run on Luke's phone (2026-11-16):** 100 records and sources went in, their thumbnails were made on the phone and the storage function signed every link, but **no upload landed**, and the sync stopped after the second batch with "a connection problem". Cause: Capacitor's native HTTP (CapacitorHttp, on for the app) reads a byte body as text before sending it, so each JPEG arrived changed and at a different length from the signed one. Fix: byte uploads go through the web view's own fetch (`CapacitorWebFetch`; `bytesUploadFetch` in documents/storage.js), which Document's uploads now use too. The panel now names the step a sync stopped at and why an upload failed. The second run's stop (before saving the first batch again) wasn't explained by the logs; the new message will say which step.

---

## Related: gaps noted alongside this outline (2026-11-15)

Raised when asking what is left before "replacing Google and Apple"; none decided:

- **Assistant layer:** a common way for an assistant to read and act on every page's items. §10 is the pattern for Photos.
- **Universal search** across pages.
- **Notes / quick capture**, possibly a light surface over Document.
- **Passwords**, possibly in the Safe; matters for the browser.
- **Browser:** deferred (BROWSER_DESIGN.md).
- **Maps:** keep linking out.
