# Documents — design & plan

Status: **DESIGN DRAFT** (decisions from Luke, 2026-11-03). Read from code on `main` @ `caec00b`. Nothing built, nothing applied, nothing deployed. §15 lists the few open points, each with a default.

Goal: a **Documents** page in **Household** (shared with Marijane) and another in **Personal** (Luke only) for important and sensitive papers. Scan or upload on any device, open and share from any device, encrypted so that the storage provider and our own server never see a readable file. Storage starts in the cloud and moves to a home server later without a rebuild.

---

## 0. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Who sees what | **Two pages.** Household Documents (shared) and Personal Documents (Luke only). Same design for both. |
| 2 | Recovery | **Printed recovery code** for Personal. Household is also backed up by Marijane's devices (§3.5). |
| 3 | Receipts | **Keep every receipt image**, encrypted, in a Receipts folder in Household. |
| 4 | Outside sharing | **iPhone share sheet** (Mail, Messages, AirDrop, Save to Files). No share links in v1. |
| 5 | Storage | **Cloudflare R2** for the encrypted files, behind a storage adapter. Folder and file records in Supabase. |
| 6 | Lock | **Face ID on every open** of either Documents page (no grace period). |
| 7 | Starting folders | Household: **Receipts, IDs & Records, Home, Vehicles, Insurance, Medical.** Personal: **Work, Personal.** All renamable or removable except Receipts. |
| 8 | Layout | **Watch's shell** (sidebar tabs, search head, card style); files shown as a list with thumbnail, date and page count. |
| 9 | Adding on web/laptop | **Upload + drag-and-drop**, photos auto-cropped and straightened. Scanning is the phone's job. |

---

## 1. Checks against the code

1. ✅ **The scanner already exists.** `ios/App/App/DocumentScannerPlugin.swift` is Apple's VisionKit document camera (edge finding, straightening, multi-page) with **on-device text recognition** (`ocr: true`). Bridge: `nativeDocumentScanner()` in `native-bridge.js`. Documents reuses it; only `maxPages` needs raising (receipts use 4–8; documents want ~30).
2. ✅ **Viewing and sharing on the iPhone already exist.** `AttachmentPreviewPlugin.swift` → `openData({ data, filename, mimeType })` shows Quick Look (PDF, images, Office files) with its own Share button. Its temp copy is deleted when the viewer closes. `save-file.js` covers the share sheet / browser download.
3. ✅ **Device keys and linking exist** (MESSAGING_DESIGN §3, §17): per-device Ed25519 keys, device certificates signed by the person's identity key, QR linking from the phone, `msg_devices`, the IndexedDB key store (`messaging/keystore.js`) and the Keychain wrapping key (`MessagingKeysPlugin.swift`). Documents **builds on these devices** rather than inventing a second device system.
4. ⚠️ **No biometric lock exists.** The messaging Keychain key uses `AfterFirstUnlockThisDeviceOnly` with no access control. Face ID needs a **new Keychain item** protected by `.userPresence` (§8).
5. ✅ **Scopes:** Household = the `live_groups` id; Personal = `u-<uid>` (views migration 2026-10-20; same pattern as the receipts ledger, F10).
6. ⚠️ **The receipts ledger is a spec, not code** (RECEIPTS_LEDGER_DESIGN.md: "Nothing is implemented"). Receipt images today live in three stores. Documents does **not** wait for the ledger (§7).
7. ✅ **Watch layout:** `#watchMainPage` = left sidebar of tabs (`data-watch-side`), a `discover-head` with search + filter, and a content grid. Documents copies this structure.
8. ✅ **Home server is already the plan** (ARCHITECTURE.md "Phases": a Storage adapter in phase 2). Kokoro shows the tunnel pattern (Tailscale / Cloudflare Tunnel).
9. ✅ **Supabase grants rule** (ARCHITECTURE.md, 2026-10-30): every new table needs explicit grants in the same file.

---

## 2. Architecture overview

- **All encryption happens on the device.** R2 stores only ciphertext; Supabase stores only encrypted names, encrypted metadata and wrapped keys. Neither can read a document, a file name or a folder name.
- **Reuses messaging's crypto stack:** `libsodium-wrappers-sumo` 0.7.15 (pinned), loaded lazily, shared helpers from `messaging/crypto/` (bytes, HKDF). New code lives in `documents/crypto/` and `documents/`.
- **Different key rule from messaging, on purpose.** Messaging gives a new device *no history*. Documents must be readable on every device, including ones linked later, so it uses a **vault key** that is handed to each trusted device (§3).
- **Files are opaque blobs behind a storage adapter** (`documents/storage.js`). R2 today; a home server tomorrow is a different endpoint, and moving is a ciphertext copy with no re-encryption (§5).
- **No AI on documents.** Search uses text read on the device (VisionKit), stored encrypted. The one exception is receipts, which already go to the AI reader when scanned (§7).

---

## 3. Keys

### 3.1 Key layers

```
Vault key (one per scope: Household, Personal)        32 bytes, random
  └─ wraps → File key (one per document, random)       stored in doc_files.wrapped_key
                └─ encrypts → file pages, thumbnail, metadata (name, OCR text, tags)
  └─ encrypts → folder names
```

- **Why two layers:** rotating a vault key (§3.4) re-wraps small file keys in the database; no file is re-uploaded.
- **Vault keys have versions** (`key_version`). Old versions are kept (wrapped under the new one) so older files still open.

### 3.2 Getting the vault key onto a device

- Each device gets a **box key** (X25519) separate from its messaging keys, so one key never serves two protocols. Its public half is **signed by the device's existing Ed25519 key** and stored in `doc_device_boxes`.
- A **grant** = the vault key sealed to that box key (`crypto_box_seal`), plus a signature by the granting device over `{vault_id, key_version, recipient_device_id, sealed}`.
- A device accepts a grant only if the granting device has a valid certificate from a **pinned identity** of a member of that scope (the same checks messaging uses). A server that invents a grant is rejected.

### 3.3 When grants happen

| Event | Who grants |
|---|---|
| First setup (Luke's phone) | The phone creates the Personal and Household vault keys and grants itself. |
| Linking a browser or the laptop app (existing QR flow) | The approving phone also grants every vault the new device should hold. |
| Marijane's phone set up | Any of Luke's devices that sees her new certified device grants it the **Household** vault (needs her identity pinned, as messaging already requires). |
| Marijane's browser linked | Her phone grants Household during the link. |

Marijane already has the TestFlight app on her phone (Luke, 2026-11-03), so she can hold Household Documents and link her browser from it.

### 3.4 Removing a device

- Revoking a device (existing Devices list) deletes its grants and **rotates the affected vault keys**: new key version, every file key re-wrapped, new grants for the remaining devices.
- Honest limit: a removed device may already hold copies of files it opened. Rotation protects everything added afterwards.

### 3.5 Recovery (decision 2)

- At setup, Luke's phone creates a **recovery code**: 128 random bits, shown as 8 groups of 4 characters (no 0/O, 1/I), plus a printable sheet with a QR.
- The code is stretched with **Argon2id** (`crypto_pwhash`, moderate limits) into a recovery key. The **Personal and Household vault keys** are wrapped under it and stored in `doc_recovery`.
- **Restore:** new phone → set up as usual → "Restore Documents" → type or scan the code → vaults unwrap → the phone grants itself. A restore also rotates the code (old sheet stops working) and prompts a new printout.
- Household survives without the code as long as either person has a working device. Personal does not: **lose all of Luke's devices and the code, and Personal Documents are gone.** The setup screen says this plainly and won't finish until the code is confirmed (re-typing two groups).
- Marijane can print her own code for Household (optional, offered at her setup).

---

## 4. File format

- **Content:** libsodium **secretstream** (XChaCha20-Poly1305) in 64 KB chunks under the file key. Detects tampering, truncation and reordering, and large PDFs never sit fully in memory twice.
- **Pages:** a scan is stored as **one PDF** built on the device (pages as JPEG, ~1600 px, q0.82). An upload keeps its original format (PDF, image, Office file).
- **Thumbnail:** first page, 240 px JPEG, encrypted separately (~15 KB), so lists don't download whole files.
- **Metadata** (encrypted JSON under the file key): `{ name, originalName, mime, pages, size, ocrText (≤ 64 KB), tags, documentDate }`.
- **Header** (unencrypted, tiny): format version, chunk size, key version. Bound in as associated data so it can't be altered.
- **Size limit:** 50 MB per file (open point §15).

---

## 5. Storage

### 5.1 Adapter

`documents/storage.js` exposes only:
- `presignUploads(items)` / `presignDownloads(items)` — batches of short-lived URLs (10 min).
- `remove(paths)`.

The app uploads and downloads **straight to the store** with those URLs; bytes never pass through a function.

### 5.2 R2 today

- One private bucket `liv-documents`, paths `<scope>/<file_id>/{content,thumb}`. CORS limited to the app's origins and the Capacitor scheme.
- Presigning runs in a **Supabase Edge Function** `doc-storage` (deployed through the Supabase connection, so **no Netlify deploy** is needed to test on TestFlight). It verifies the session, checks the caller is a member of the scope, and signs with the R2 key held as an Edge Function secret.
- Costs: R2's free tier is 10 GB-month, 1M writes and 10M reads a month, with no download charges. Estimate in §12.

### 5.3 Home server later

- Run an **S3-compatible store** at home (Garage or MinIO), reached through Cloudflare Tunnel or Tailscale like Kokoro. The adapter keeps the same presign code; only endpoint and credentials change.
- **Moving:** a one-time job copies the ciphertext objects across (no decryption, no re-encryption), checks sizes and hashes, then flips the backend setting.
- **Recommendation for then:** keep R2 as an **off-site encrypted backup** of the home server (it's free at this size). A house fire or a dead drive shouldn't take the passports with it.

---

## 6. Supabase data model

New tables, `doc_` prefix. **Nothing touches `tableplan_states`; no `STATE_SCHEMA_VERSION` bump.** RLS on all, no `anon`, explicit grants. Access: `scope = 'u-' || auth.uid()` or `scope in (select live_get_my_group_ids())`. (Migration gated on Luke's OK.)

```sql
create table public.doc_vaults (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null unique,            -- group id or 'u-<uid>'
  key_version int  not null default 1,
  created_at  timestamptz not null default now()
);

create table public.doc_device_boxes (          -- per device, for grants (§3.2)
  device_id uuid primary key references public.msg_devices on delete cascade,
  box_pub   bytea not null,
  box_sig   bytea not null                       -- by the device's Ed25519 key
);

create table public.doc_vault_grants (
  vault_id    uuid not null references public.doc_vaults on delete cascade,
  key_version int  not null,
  device_id   uuid not null references public.msg_devices on delete cascade,
  sealed      bytea not null,
  granter_device_id uuid not null,
  granter_sig bytea not null,
  primary key (vault_id, key_version, device_id)
);

create table public.doc_vault_keys_old (        -- older versions, wrapped under the newest
  vault_id uuid not null references public.doc_vaults on delete cascade,
  key_version int not null,
  wrapped     bytea not null,
  primary key (vault_id, key_version)
);

create table public.doc_recovery (
  user_id   uuid not null references auth.users on delete cascade,
  vault_id  uuid not null references public.doc_vaults on delete cascade,
  salt      bytea not null,
  wrapped   bytea not null,
  primary key (user_id, vault_id)
);

create table public.doc_folders (
  id          uuid primary key,
  scope       text not null,
  enc_name    bytea not null,                    -- under the vault key
  key_version int not null,
  kind        text not null default 'user' check (kind in ('user','receipts')),
  sort        int  not null default 0,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table public.doc_files (
  id          uuid primary key,                  -- client id (offline capture)
  scope       text not null,
  folder_id   uuid references public.doc_folders on delete set null,
  wrapped_key bytea not null,                    -- file key under the vault key
  key_version int not null,
  enc_meta    bytea not null,                    -- §4 metadata
  size        bigint not null,                   -- ciphertext bytes (quota, egress)
  has_thumb   boolean not null default false,
  backend     text not null default 'r2',        -- 'r2' | 'home' (§5.3)
  added_by    uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz                        -- Recently deleted (30 days)
);
create index doc_files_scope_updated on public.doc_files (scope, updated_at);
```

- Only one `receipts` folder per scope (partial unique index); it can't be deleted.
- Clients fetch **changes since** their last `updated_at`, so a refresh is a few hundred bytes.
- Daily maintenance purges files deleted more than 30 days ago (rows + R2 objects through the function).

---

## 7. Receipts (decision 3)

- The existing header scanner gets one more step: after a receipt is captured, its pages are **also saved as an encrypted document** in Household › Receipts, named `<merchant> · <date>` once the reader returns them (until then "Receipt · <date>").
- **The AI reader still sees the receipt at scan time**, as it does today (images go to the extraction function over the network, then are discarded). What changes is that the **kept** copy is encrypted. Every other folder never goes to the AI.
- **When the receipts ledger is built**, it stores the document's id instead of `image_paths`, and "Mark reviewed" no longer deletes the image (decision 3 overrides the ledger's §5). Re-scan decrypts the document on the device and sends it to the reader again. Add this to RECEIPTS_LEDGER_DESIGN when that work starts.
- Past receipt images in the three legacy stores are not imported (the ledger's purge plan is unchanged).

---

## 8. Lock (decision 6)

- **iPhone:** a new Keychain item, the **documents wrapping key**, with access control `.userPresence` (Face ID, falling back to the phone passcode) and `ThisDeviceOnly`. It wraps the device's vault keys at rest. Opening either Documents page reads it, which **is** the Face ID prompt; the unwrapped vault keys live in memory only while the page is open and are wiped when you leave it or the app goes to the background. So the lock is real encryption, not just a screen in front of the page.
- **Web and laptop app:** see §15 (passkey with Touch ID where the browser supports it, account password otherwise). On the web, a password-only lock is a screen in front of the page, since the browser's own key store isn't biometric; the doc says this rather than overstating it.
- Leaving the page, locking the phone or switching apps re-locks immediately (decision 6: no grace period).

---

## 9. Adding, viewing, sharing

**Adding**
- **iPhone:** "Scan" (VisionKit, up to 30 pages, on-device text) or "Choose file" / "Photo". Rename and pick a folder on the review sheet; defaults to the open folder.
- **Web/laptop:** "Upload" and drag-and-drop onto the page or a folder. Photos go through the existing crop/straighten preview; PDFs and other files are stored as they are. Text for search is read on the device for images (the existing `local-text-detect.js` path) and pulled from PDFs that already contain text.
- **Offline:** encrypted items wait in an IndexedDB outbox (same pattern as the receipts outbox) and upload when online.

**Viewing**
- iPhone: decrypt → Quick Look via `AttachmentPreviewPlugin.openData`. Its temp copy is deleted when the viewer closes.
- Web: decrypt → a blob URL in the browser's own PDF/image viewer inside the page; revoked on close.
- Recently opened files are cached **encrypted** on the device (cap ~200 MB, oldest out), so reopening doesn't re-download.

**Sharing (decision 4)**
- **With Marijane:** move or copy into Household. Nothing leaves the encryption.
- **Outside:** Share → decrypted file to the iPhone share sheet (`save-file.js`; Quick Look's own Share button works too). A one-line notice the first time: "This sends an unprotected copy."
- Also from Messages: a document can be sent as a card (MESSAGING §5); it opens only for people who can see the scope.

---

## 10. UI

**Placement:** Documents is added to `VIEW_PAGES` for **Household and Personal** (`views.js`), sits after Finance and Shop in `PAGE_GROUPS` order (Resource), and goes in both menus' markup and `pageNavButtons()` (checked by `test/architecture-page-groups.test.js`). Marijane sees Household's. A new `documents` agent in `.claude/agents/` owns `documents/` (CI agent-coverage check).

**Page (Watch's shell, decision 8)**
- **Sidebar tabs:** All · one tab per folder (Receipts first) · divider · **+ New folder** · Recently deleted.
- **Head:** search box (with the standard clear "x") + **Add** on the right (Scan / Upload / Photo), easy to reach one-handed.
- **List:** thumbnail, name, folder (in All), document date or added date, page count. Sort: newest, name, document date.
- **Row actions:** open; long-press or ⋯ → Rename · Move · Share · Delete (undo toast, then Recently deleted).
- **Folders:** add, rename, reorder, delete (files inside move to Recently deleted with the folder).
- **Search:** names, tags and on-device text, across folders, done on the device over the decrypted index.

**Setup / locked states**
- Not set up on this device → "Set up Documents" (phone) or "Link this device from your phone" (browser), using the existing messaging setup and QR link.
- Locked → a Face ID prompt over a blurred list placeholder (no names shown).

**Settings** (in the page's ⋯, like Messages' Devices & security): recovery code (view status, print new code), devices with access, storage used.

---

## 11. Threats, briefly

| Threat | Covered by |
|---|---|
| R2 or Supabase breached | Only ciphertext, encrypted names, wrapped keys. |
| Our server lies (fake grant, fake device) | Grants and devices verified against pinned identities (§3.2). |
| Lost or stolen phone | Face ID-gated Keychain key; remove the device → vault rotation. |
| Lost everything | Recovery code (Personal); Marijane's devices (Household). |
| Malicious web deploy | Same limit as messaging: the web app's code could be changed. The messaging integrity check (§2 there) covers the shared crypto chunk. The iPhone app runs bundled code. |
| Shared copies | Leave the app unprotected by design (decision 4). |

---

## 12. Cost & egress

| Item | Size | Volume | Notes |
|---|---|---|---|
| Receipt (1–2 pages) | ~250 KB + 15 KB thumb | ~5/week → ~70 MB/year | R2 |
| Document (avg) | ~1 MB | a few hundred → < 1 GB | R2 |
| Rows (Supabase) | ~1–2 KB each | thousands | negligible storage and egress |
| Downloads | — | any | **free on R2**; cached on device |
| Presign calls | — | a few per session | Edge Function free tier is ample |

The home server is expected within about two years (Luke, 2026-11-03), and the goal is **no new cost until then**. Two years is roughly 150 MB of receipts plus about 1 GB of documents, around a tenth of R2's free 10 GB, even counting a big first round of scanning. The one new account is Cloudflare (free). Guard: Settings shows storage used, and a warning appears at 7 GB so nothing is ever billed by surprise.

---

## 13. Build order

Test without Netlify deploys: phone on TestFlight, laptop on `npm run dev:local`.

1. **Crypto core** (`documents/crypto/`): vault/file keys, secretstream file format, grants, recovery wrap, rotation. Tests + an independent review agent (as messaging §16). No UI.
2. **Cloud plumbing:** Luke creates the Cloudflare account, bucket and API token (step-by-step guide provided); migration (gated, Luke's OK); `doc-storage` Edge Function.
3. **Devices & lock:** box keys, grants on setup/link, recovery code + printable sheet, Face ID Keychain item (native plugin change). TestFlight build.
4. **Pages:** Household + Personal Documents, folders, upload, list, view, share, Recently deleted, search. TestFlight.
5. **Scanning:** VisionKit at 30 pages, on-device text, review sheet. TestFlight.
6. **Receipts hook:** receipt scans also saved to Household › Receipts.
7. **One batched Netlify deploy** (Luke's OK) so the web and Marijane get it; Marijane sets up on her TestFlight phone and is granted Household.

Later: home-server adapter and move (§5.3); share links; ledger linkage (§7).

---

## 14. Tests

- **Crypto:** round trips across sizes (0 B, 1 chunk, many chunks); tampering, truncation, chunk reordering and header edits all rejected; wrong key version; grant from an uncertified or non-member device rejected; recovery wrap/unwrap; rotation keeps old files readable and cuts off the removed device. Planted-bug checks for each rule.
- **Server:** RLS (no cross-scope reads, Marijane can't see Personal, no anon); Edge Function refuses scopes the caller isn't in; presigned URLs expire; grants.
- **UI QA** (Chromium at 390 / 360 px, two profiles): set up, link, add, search, move, delete/undo, Recently deleted, share, locked state, Marijane sees Household only.
- **Manual (TestFlight):** Face ID on every open, re-lock on background, scan 10 pages, Quick Look + Share, restore from recovery code on a wiped install.

---

## 15. Open points (defaults in bold)

1. **Web lock:** **passkey with Touch ID where the browser supports it (also unlocks the keys), account password otherwise.**
2. **File size limit: 50 MB.**
3. **Recently deleted: 30 days**, matching recipes.
4. **Who can delete in Household:** **either of you**, with Recently deleted as the safety net.
5. **Document dates & reminders** (e.g. passport expiry): **not in v1**; the metadata has room for it.
6. **Where presigning runs.** The house rule is that secrets live in Netlify Functions (ARCHITECTURE §7). A **Supabase Edge Function** keeps the R2 key just as server-side and lets the whole feature be tested on TestFlight **without spending a Netlify deploy**; the trade-off is a second place where server code lives. **Default: Edge Function**, noted in ARCHITECTURE §7 as an exception (messaging §12 step 6 weighed the same choice).
