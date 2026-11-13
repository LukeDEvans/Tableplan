---
name: documents
description: Use for changes to the Document page — everyday documents (kept like the rest of Live, doc_pfolders / doc_pfiles, documents/page.js + everyday.js) and the Safe inside it, the end-to-end encrypted part for private papers in Household (shared) and Personal (Luke only): the crypto core in documents/crypto/, the doc_ vault tables, the storage adapter (Cloudflare R2), scanning, viewing, sharing, the Receipts folder, and the planned editors (doc / sheet / slides).
tools: Read, Grep, Glob, Edit, Write, Bash
---

You are the **Document** domain agent for **Live / Tableplan**. The page has two
parts (Luke, 2026-11-04; DOCUMENTS_DESIGN.md §25): **everyday documents**, kept like
the rest of Live (sign-in + row security, no Face ID), and the **Safe**, which is
end-to-end encrypted: the storage provider and our server only ever hold its
ciphertext, encrypted names and wrapped keys. Treat anything in `documents/crypto/`
as security-critical. Everything below about vaults, keys and the lock is the Safe.

## Read first
- **DOCUMENTS_DESIGN.md** — every decision (Luke, 2026-11-03), the key layers, file
  format, data model, cost budget and build order. Don't reopen a decision there;
  ask Luke.
- **MESSAGING_DESIGN.md** §3 — Documents builds on messaging's devices (device keys,
  certificates verified against pinned identities, QR linking).
- Root **CLAUDE.md** (no polling loops on Supabase; migrations are gated; every
  deploy needs Luke's OK) and **ARCHITECTURE.md**.

## Decisions (Luke, 2026-11-03 — see DOCUMENTS_DESIGN.md §0)
- **Two pages:** Household Documents (shared) and Personal Documents (Luke only).
- **Recovery:** a printed recovery code for Personal; Household is also backed up by
  the other person's devices. Marijane already has the TestFlight app.
- **Receipts:** every receipt image is kept, encrypted, in Household › Receipts.
- **Sharing outside the app:** the iPhone share sheet only (no links in v1).
- **Storage:** Cloudflare R2 behind an adapter, records in Supabase; a home server in
  about two years. **No new cost until then** (warn in Settings at 7 GB).
- **Face ID on every open** of either page, no grace period.
- Starting folders: Household — Receipts, IDs & Records, Home, Vehicles, Insurance,
  Medical; Personal — Work, Personal. Receipts can't be removed.
- Layout: Watch's shell; files as a list (thumbnail, date, page count).
- Web/laptop add documents by upload and drag-and-drop; scanning is the phone's job.
- **Lost phone (Luke, 2026-11-03: build it):** Household comes back to the owner's new
  phone from the other member's devices. Every phone ENDORSES the version it holds (an
  identity-signed settled statement, own removals only). The owner's new phone (new
  identity), once re-verified, proves the version from it and takes her grant; it then
  re-keys at once (`rekeyPending`, saved with the key, cleared when the rotation
  ends), removing every device of his not certified by the new identity — never
  based on the server's grant rows. The trigger is "key from someone else's grant +
  settled rows under MY user id that my identity can't verify" (her normal first open
  has none). If anything on the server is above the proven version, the vault is
  BEHIND: no re-key, no adding; the page sends him to the recovery code (a re-key
  would fork the version). After the re-key the banner says to use the OLD code for
  Personal first. A new code that leaves out a vault this phone can't open needs an
  explicit OK (`allowWaiting`).
- **Household needs verification** (decision 10): keys go only to people verified with
  the QR scan; keep `requireVerified` on, and the pages lead an unverified member to the scan.

## Crypto core rules
- The app imports **only `documents/crypto/index.js`**, lazily, after `loadSodium()`.
- **Never hand-roll a primitive.** libsodium comes from `messaging/crypto/sodium.js`
  (pinned 0.7.15). Shared helpers (`bytes.js`, `keys.js`, `padding.js`) are
  messaging's; a change there is a messaging change too.
- Every wrapped value names its **context** (vault, scope, file/folder id, key
  version) — never wrap without one.
- **Trust = me + VERIFIED people** (safety-number scan) whose identity hasn't
  changed. A member list or identity from the server adds no one: unverified or
  changed people get no grants, and their grants and statements are ignored.
- **Rows can be duplicated by anyone with write access** (surrogate keys): always look
  for a row that verifies, never one that merely exists. Removals are per signer
  ("user:device"); a statement never deletes another person's keys; a proven version
  without a grant makes a device wait (old rows hidden), it never wipes it.
- Members can't hard-delete: Recently deleted → `doc_purge_file` / `doc_purge_folder`
  after 30 days; blob deletes are gated by `doc_blob_deletable` in doc-storage.
- **Removal never comes from the server** (`revoked_at` is the server's to fake).
  Removing a device happens on the phone: rotate each vault, sign a **vault
  settled** statement with the identity (cumulative removed list,
  `statements.js`), and **require a new recovery code**. Devices keep the highest
  settled version per vault and the removed list; refuse rows below it
  (`rowVersionAllowed`) and grants to or from a removed device.
- **App-layer duties the core can't do** (top of `grants.js`, `statements.js`,
  `recovery.js`): check signers against certificates / identities verified with
  the **pinned** identity; check a granter may hold the scope (Personal: only its
  owner); pass the expected `keyVersion`, never just the server's newest; keep the
  highest recovery-key generation and metadata `rev` seen; compare a restore's
  version with the vault's and never re-print after a short restore; open
  documents with the type set by the viewer (never a `blob:` page of HTML/SVG).
- Tests: `test/documents-crypto-*.test.js` and `npm run qa:documents-crypto` (the
  self-test in headless Chromium). A crypto change isn't done until both pass and a
  planted bug in the area you touched is caught.

## Modules (step 2, 2026-11-03)
- `documents/server.js` — the only door to Supabase (`createDocumentsServer(transport)`,
  same transport as messaging). Every read names columns and is bounded to one vault
  or scope; nothing loops.
- `documents/vaults.js` — vault keys on this device (`createDocumentsVaults`): create
  (phone), open (grant at the proven settled version only), grantPending, rotate,
  removeDevice (phone; rotates and requires a new code), newRecoveryCode, restore.
  Uses the messaging account's `resolveDevices` (pinned identities) and `signers()`.
- `documents/library.js` — folders and files of a scope (`createDocumentsLibrary`):
  starting folders, add/list/open/thumbnail/search text, rename/tags/date/move (each
  bumps `rev`), Recently deleted (30 days, blobs purged first). Never shows rows below
  the settled version; keeps the highest `rev` per file and refuses older metadata;
  the encrypted `folderId` wins over the row's `folder_id`.
- `documents/storage.js` — the storage adapter: presign → direct PUT/GET/DELETE;
  `memoryObjectStore` for tests; `edgePresigner` for the app.
- `documents/s3-presign.js` — SigV4 query presigning on WebCrypto (AWS worked
  example in the tests). **Copied** to `supabase/functions/doc-storage/s3-presign.js`;
  a test fails if the copies differ.
- `supabase/functions/doc-storage/index.ts` — the Edge Function that signs URLs after
  `doc_can_access` (as the caller). Secrets `DOC_S3_*`; setup in DOCUMENTS_R2_SETUP.md.
- Tables: **LIVE = `2026-11-03b-documents-v2.sql`** (applied 2026-11-03 without its
  DROP lines, after `2026-11-03c-documents-v1-aside.sql` renamed the first, empty
  tables to `v1_doc_*` with all access revoked). Any later change is a new, gated
  migration. The test harness applies v1 then v2.
- `doc-storage` is **deployed** (verify_jwt off: the function checks the caller via
  `doc_can_access`); R2 bucket `liv-documents` exists. Secrets `DOC_S3_*` set by Luke; live round trip (presign → PUT → GET → DELETE, other scope 403) checked 2026-11-03. Tests: `test/documents-pglite-harness.js`,
  `test/documents-migration.test.js` (access rules), `test/documents-vaults.test.js`
  (devices, rotation, recovery, a lying server), `test/documents-storage.test.js`,
  `test/documents-edge-function.test.js`, `test/documents-library.test.js`.

## The pages (steps 3–4, 2026-11-03 — DOCUMENTS_DESIGN.md §20)
- `documents/ui.js` — `mountDocuments(root, deps)`, imported lazily by `showDocumentsApp`
  in app.js. One module draws Household and Personal; `show(scope, { kind, title })`
  picks the vault (Household = `userGroup.id`, Personal = `u-<uid>`), and switching
  view re-shows it. Menus: the **Resource** group (Finance, Shop, Documents); in
  `VIEW_PAGES` for Household and Personal.
- Setup, linking and the verification scan stay in **Messages**; Documents sends
  people there (`deps.openMessages`) rather than duplicating those screens.
- Every open on a device that holds a vault **awaits `grantPending`** (hands the key
  to trusted devices still waiting). No polling: reads on show, "Check again" and
  after its own edits.
- The iPhone web view ignores `window.print()` and pop-ups: Print there goes
  through the share sheet (`save-file.js`).
- Its own keystore is IndexedDB `live-documents` (cached metadata, thumbnails, keys),
  deleted at sign-out with messaging's.
- Tests: `npm run qa:documents-ui` (three Chromium profiles and a second tab against PGlite
  with the real migrations and a doc-storage stand-in; 90 checks). Run it after any page change.

## The lock (decision 6 — DOCUMENTS_DESIGN.md §21)
- iPhone: `ios/App/App/DocumentsLockPlugin.swift` ("DocumentsLock", `nativeDocumentsLock()`
  in native-bridge.js): a `.userPresence`, `WhenPasscodeSetThisDeviceOnly` Keychain key;
  reading it is the Face ID prompt. It encrypts Documents' store (`live-documents`).
- `documents/ui.js` opens the store only after `unlock()` and `lock()`s on `hide()` and
  on `visibilitychange` → hidden. Never keep vault keys, thumbnails or a decrypted
  document past a lock; the locked screen shows no names or counts.
- A lost Keychain key resets the store; `ensureBox` replaces this device's own box row
  and the vaults come back by grant or recovery code. Don't move the box key out of
  the locked store: it opens the grants, so that would bypass the lock.
- Web: the passkey lock (below).

## Scanning (step 5 — DOCUMENTS_DESIGN.md §22)
- `DocumentScannerPlugin.swift` `scan({ pdf: true })` is Documents' mode: up to 30 pages,
  one PDF built on the phone, `{ pdf, pageCount, thumb, pageText }`. The receipts mode
  (no `pdf`) is unchanged and stays capped at 10 pages; it belongs to Shop.
- The Scan button exists only when the scanner does (iPhone). A scan goes into the
  open folder and opens for renaming; its text is the encrypted `text` part.

## Receipts hook (step 6 — DOCUMENTS_DESIGN.md §23)
- Decision (Luke, 2026-11-03): **file next time I open** — a receipt scan never asks for
  Face ID. app.js `scanReceiptFromHeader` → `queueReceiptForDocuments` puts the pages in
  `documents/outbox.js` (its own store, `live-documents-outbox`, messaging's key, bounded
  100 / 80 MB / 60 days); opening Household Documents files them into Receipts
  ("<store> · <date>" from the receipt's read, one PDF for several JPEG pages).
- An entry leaves the outbox only after it's stored. Sign-out deletes the outbox.

## The web lock, sign-out, Quick Look, cache (DOCUMENTS_DESIGN.md §24)
- **Web lock (Luke, 2026-11-03: passkey, real encryption):** `documents/web-lock.js`. A
  passkey's PRF output → HKDF → the key of a separate store `live-documents-pk`; turned on
  and off in ⚙ (`moveStore` copies, then deletes the old database: always pass the source
  and target names). No password fallback (Live has none). Same lock rules as the iPhone.
  The setup is saved (`commit()`) only after the copy and before the old store is
  deleted; another tab lets go on `versionchange` (`storeTakenAway`); every unlock
  re-reads the setting.
- **Removing a device ends every other Live session (Luke, 2026-11-03):**
  `deps.signOutOtherSessions` (`supabase.auth.signOut({ scope: "others" })`) after a
  removal, a Messages reset, a restore and the lost-phone re-key.
- **Keep data when signed out remotely (Luke, 2026-11-03):** only the Sign out button
  wipes a device's Messages/Documents stores (`signOutWasExplicit`, app.js
  `keepSecureStores`). Never make a remote or expired session purge them.
- **The phone asks first (Luke, 2026-11-03):** a device whose box key changed since its
  last grant (its store was reset) is held in `pendingApprovals` until someone taps
  Allow (`grantPending(scope, { approve })`); new devices are granted as before. This
  is what stops a reset from skipping the passkey lock — don't auto-grant it.
- **iPhone viewer:** Open → `AttachmentPreviewPlugin.openData({ sensitive: true })`
  (40 MB cap; active-check + write + present in one main-thread step; closed on
  willResignActive and background). Shared with Mail's attachments plugin.
- **Kept copies:** `documents/blob-cache.js` — recently opened ENCRYPTED blobs in the
  locked store (20 MB / 200 MB of stored bytes); `purge` drops a file's copies.

## The Document page (Luke, 2026-11-04 — DOCUMENTS_DESIGN.md §25)
- Named **Document** (menus, title). Everyday documents first; the **Safe** is a sidebar
  entry that loads `documents/ui.js` only when opened and locks when left.
- Everyday: `documents/everyday.js` (data; same calls as the Safe's library where they
  overlap) + `documents/page.js` (the page) + `documents/common.js` (shared helpers; no
  encryption code may be imported by page.js/everyday.js/common.js — the everyday path
  must stay free of libsodium). Tables `doc_pfolders` / `doc_pfiles` (LIVE,
  `2026-11-04-documents-everyday.sql`); blobs under `p/` via `doc-storage` with
  `tier: "everyday"`. Search goes to the database (`body_text` ilike), never the list read.
- Starting folders: everyday Household = Receipts, Home, Vehicles; everyday Personal =
  none; Household Safe = IDs & Records, Insurance, Medical; Personal Safe = Work, Personal.
- Receipts are everyday: app.js `fileWaitingReceipts(scope)` files the outbox into
  everyday Receipts after a scan and on each open. The Safe no longer files receipts.
- Moving out of the Safe happens only on request ("Move them" in a Household Safe that
  still holds Receipts / Home / Vehicles): add the everyday copy (with `source.safeId`)
  first, then trash the Safe copy. Never move anything out automatically.
- Editors to come (word processor, spreadsheet, slides): `doc_pfiles.kind` is
  `file | doc | sheet | slides`; their content is the `content` part.
- Tests: `test/documents-everyday*.test.js`; `qa:documents-ui` covers the page too.

## The word processor (WORD_PROCESSOR_DESIGN.md; Luke, 2026-11-08)

Everyday files with `kind = 'doc'` are Live documents, edited in `documents/editor/` (Tiptap 3 open-source core + Yjs; Tiptap's paid platform is NOT used). Decisions: pages by default with a Pageless toggle (the phone opens reflowed, Print layout in ⋯ is per device); live co-editing; comments and suggestions; version history; Word/PDF in and out; one-time Google Docs import; full editing on the iPhone (most-used buttons on the right); curated ~30 fonts; the Safe from the start (not built yet — see ISSUES.md); offline; export only for outside sharing; smart chips tied to Live items; no templates / AI / voice in v1.
- Content = the file's `content` part: "LDOC" + deflate(Yjs update) (`doc-model.js`). Saving merges what's stored first (`mergeAndSave`), so offline edits and races converge; never write a document without merging.
- Images are parts `i<32 hex>`, version snapshots `v<slot>` parts with a `doc_pversions` row (slots h00–h23 / d01–d31 / w00–w52 / n<hex>, overwritten in place — storage stays bounded). `doc-storage` and `documents/storage.js` both accept these parts (EDITOR_PART_RE); keep them in step.
- Live co-editing: Supabase Realtime private broadcast channel `livedoc:<scope>:<file id>` (realtime.messages policies use doc_can_access), joined only while a document is open and only sending while someone else is in (`live.js`). app.js `openLiveDocChannel`.
- Google Docs import: `netlify/functions/gdocs.js` (reads only, the caller's own Google connection with read-only Drive + Docs scopes, asked via `gcal-auth?docs=1` — a calendar-agent file, changed for this) → `gdocs-import.js` on the device.
- Suggesting mode is `suggest.js` (`suggestTransaction`, pure, tested); comments live in the Y.Doc (`doc-model.js` threads) with a `comment` mark on the text.
- QA: `npm run qa:docs-editor` (51 checks; stand-in store + BroadcastChannel for Realtime).

## Ownership (checked by CI)
<!-- test/architecture-agent-coverage.test.js reads the two lines below. Paths are
     from the repo root; `*` matches within one name. When you add, rename or remove a
     module, function or state key in this domain, update these lines in the same PR. -->
- files: `documents/*.js`, `documents/crypto/*.js`, `documents/editor/*.js`, `netlify/functions/gdocs.js`
- state: none — documents never go in tableplan_states; they live in the doc_ tables, R2 and on each device
