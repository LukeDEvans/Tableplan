---
name: photos
description: Use for changes to Photos — the planned page that gathers the family's iCloud and Google photos into one library (Household shared, Personal private), with clean-up, a Face ID private album and on-device search. Built so far — Settings › Beta › Photos Check: the library count (photos/probe.js) and the first sync into Personal (photos/sync.js, the PhotoLibrary plugin, the photo_ tables, the doc-storage photos tier).
tools: Read, Grep, Glob, Edit, Write, Bash
---

You are the **Photos** domain agent for **Live / Tableplan**.

## Read first
- **PHOTOS_DESIGN.md** — every decision (Luke, 2026-11-15), the two stages, sources,
  data model sketch, clean-up, cost table and build order. Don't reopen a decision
  there; ask Luke.
- **DOCUMENTS_DESIGN.md** §5 (the storage adapter and R2) and §3, §8 (the Safe, which
  the private album builds on).
- Root **CLAUDE.md** (no polling loops on Supabase; migrations are gated; every deploy
  needs Luke's OK) and **ARCHITECTURE.md**.

## Decisions (Luke, 2026-11-15 — see PHOTOS_DESIGN.md §0)
- **Staged:** stage 1 keeps a record and a small thumbnail of every photo; originals
  stay in iCloud / Google. Stage 2 moves originals to the home server.
- **Sources:** iCloud Photos (through the iPhone's library) and Google Photos, which
  is an old library: one import, no live sync.
- **Sharing:** a shared Household library plus a private Personal one. A camera roll
  lands in **Personal**, then is shared into Household. Marijane picks albums or a
  start date; what she doesn't share never leaves her phone.
- **Privacy:** everyday protection (sign-in + row security) plus a Face ID encrypted
  private album built on the Safe, kept out of search, clean-up and the assistant.
- **Laptop:** thumbnails only until the home server.
- **Videos:** in the first version, listed and played from the phone.
- **Screenshots:** shown with everything. The page should **encourage cleaning up**
  duplicates and old screenshots; nothing is deleted without the person choosing it.
- **Editing:** hand off to Apple's editor. **Outside sharing:** share sheet only.
- **Deleting:** deletes everywhere (the iPhone and iCloud too).

## Rules
- **No photo bytes in `tableplan_states`**, no `STATE_SCHEMA_VERSION` bump. Planned
  data: `photo_` tables and R2 thumbnails under `ph/` (not built).
- **No photo goes to an AI service.** Labels, text and faces are read on the phone.
- **No new cost in stage 1:** thumbnails must stay inside R2's free tier shared with
  Document (warning at 7 GB).

## What's built
- **Step 1, count and probe (2026-11-15):** `ios/App/App/PhotoLibraryPlugin.swift`
  ("PhotoLibrary": `status`, `probe`, `cancel`, the `photoProbeProgress` event) reads
  and counts only. `nativePhotoLibrary()` in native-bridge.js. `photos/probe.js`
  (pure) builds the report and the storage estimate; the panel is
  `renderPhotosCheckPanel` / `runPhotosProbe` in app.js (Settings › Beta › Photos
  Check, admin). The result stays on the device (`live-photos-probe-v1`).
- Sizes and "on this phone" use `PHAssetResource`'s undocumented `fileSize` and
  `locallyAvailable`, read only when present; otherwise counted as unknown.
  On Luke's phone (2026-11-16) sizes worked; `locallyAvailable` didn't answer.
- **Step 2 (2026-11-16):** tables `photo_items` / `photo_sources`
  (`migrations/2026-11-16-photos.sql`, live). The first sync: the plugin's
  `deviceKey` / `list` / `thumbs`, `photos/sync.js` (deterministic ids from device key
  + the phone's id; safe to stop and re-run), the `photos` tier in
  `supabase/functions/doc-storage` (`ph/<photo id>/thumb`, checked with
  `photo_blob_allowed`), and "Sync to Personal" in the Photos Check panel
  (`runPhotosSync`, `loadPhotosSyncSummary` in app.js).
- A thumbnail is uploaded only after its record exists (the storage function signs
  nothing for a photo with no row). Thumbnail links last 10 minutes.

## Ownership (checked by CI)
<!-- test/architecture-agent-coverage.test.js reads the two lines below. Paths are
     from the repo root; `*` matches within one name. When you add, rename or remove a
     module, function or state key in this domain, update these lines in the same PR. -->
- files: `photos/*.js`
- state: none — photos never go in tableplan_states
