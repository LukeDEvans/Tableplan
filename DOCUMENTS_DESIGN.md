# Documents — design & plan

Status: **DESIGN AGREED** (decisions from Luke, 2026-11-03). **Pages built (§20)**, not deployed. **Step 1 (crypto core) built and independently reviewed** (§16, §17). **Step 2 built and checked live** (§18, §19): the `doc_` tables are **LIVE** (applied 2026-11-03 with Luke's OK), vault keys across devices, storage adapter, and the `doc-storage` function deployed with R2 working end to end. Branch `claude/documents-crypto`. No UI, nothing on Netlify.

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
| 10 | Household trust | **Verification required** (2026-11-03): Household keys go only to people verified with the QR scan whose identity hasn't changed since. |

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

Removal happens **on a phone** (the person's identity key lives there; messaging already has "only the phone removes devices"):

1. **Rotate** each vault the device could open: new key version, every file key and folder name re-wrapped, the old key wrapped under the new one, new grants for the remaining devices (never the removed one).
2. **Sign a "vault settled" statement** with the identity key: vault, scope, new version, and the **cumulative list of removed devices** (`statements.js`). Every device verifies it against the pinned identity, remembers the highest settled version per vault and the removed list, and from then on:
   - refuses file and folder rows below the settled version (a removed device still holds the old key and could otherwise add documents under it — `rowVersionAllowed`);
   - refuses grants to or from a removed device (`createGrant` / `openGrant` require the list).
   Removal is **never** taken from the server's `revoked_at`, which the server controls.
3. **Print a new recovery code** (required — removal doesn't finish until it's printed, §3.5). The removed device knew the old anchor's key.

Honest limits: a removed device may already hold copies of files it opened, and file keys don't change on rotation, so it could read later *renames* of files that existed before (contents of new files are safe). Re-keying a file's metadata on rotation is in §17 as later work.

### 3.5 Recovery (decision 2)

- At setup, Luke's phone creates a **recovery code**: 32 characters (140 random bits + a 20-bit check, so a typo is reported as a typo), shown as 8 groups of 4 (no 0/O, 1/I), plus a printable sheet with a QR.
- **Argon2id** (64 MiB, 3 passes — the most a restoring phone will accept from the server) stretches it into an **anchor key** and a **recovery key pair**.
- Stored per person and vault: the **anchor** (the vault key at that moment, sealed with the anchor key — only the code can make it) and, after each rotation, the new vault key **sealed to the recovery public key** (any of the person's devices can add one without the code).
- The recovery public key is **signed by the person's identity with a generation number**. Devices remember the highest generation and only seal to it, so after a re-print the old sheet's key stops receiving new vault keys.
- **Restore:** new phone → "Restore Documents" → type or scan the code → the newest sealed key is accepted only if its old-key chain leads back to the anchor's key; two different chains that both do are refused. The result says if it came back **short** (rows missing): the app compares it with the vault's version, warns, and does **not** re-print on top of a short restore. After a full restore the phone signs a new code (old sheet stops working).
- **Removing a device requires a new code** (§3.4), because the removed device knew the old anchor's key and, with the server's help, could build a believable chain.
- Household survives without the code as long as either person has a working device. Personal does not: **lose all of Luke's devices and the code, and Personal Documents are gone.** The setup screen says this plainly and won't finish until the code is confirmed (re-typing two groups).
- Marijane can print her own code for Household (optional, offered at her setup).

---

## 4. File format

- **Content:** libsodium **secretstream** (XChaCha20-Poly1305) in 64 KB chunks under the file key. Detects tampering, truncation and reordering, and large PDFs never sit fully in memory twice.
- **Pages:** a scan is stored as **one PDF** built on the device (pages as JPEG, ~1600 px, q0.82). An upload keeps its original format (PDF, image, Office file).
- **Thumbnail:** first page, 240 px JPEG, encrypted separately (~15 KB), so lists don't download whole files.
- **Metadata** (encrypted JSON under the file key, in the database row, ≤ 16 KB): `{ rev, folderId, name, originalName, mime, pages, size, tags, documentDate }`. `mime` is from a fixed list (PDF, images, plain text/CSV, Office) — never HTML/SVG/XML. Names lose direction overrides and invisible characters. `rev` and `folderId` let the app refuse an older copy of the metadata (keep the highest `rev` seen) and a row whose `folder_id` disagrees.
- **Search text** (what was read from the pages): its own encrypted part in R2, padded to 1 KB steps, ≤ 256 KB.
- **Header** (unencrypted, tiny): format version, chunk size, key version. Bound in as associated data so it can't be altered.
- **Size limit:** 50 MB per file (open point §15); the decryptor refuses anything over 64 MB before allocating.

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
  granter_user_id   uuid not null,
  granter_device_id uuid not null,
  granter_sig bytea not null,
  primary key (vault_id, key_version, device_id)
);

create table public.doc_vault_keys_old (        -- version v, wrapped under v+1 (a chain)
  vault_id uuid not null references public.doc_vaults on delete cascade,
  key_version int not null,
  wrapped     bytea not null,
  primary key (vault_id, key_version)
);

create table public.doc_vault_settled (         -- identity-signed (§3.4)
  vault_id    uuid not null references public.doc_vaults on delete cascade,
  key_version int  not null,
  signer_user_id uuid not null,
  removed_device_ids uuid[] not null default '{}',
  sig         bytea not null,
  primary key (vault_id, key_version)
);

create table public.doc_recovery_keys (         -- per person: identity-signed recovery key (§3.5)
  user_id      uuid primary key references auth.users on delete cascade,
  generation   int  not null,
  recovery_pub bytea not null,
  params       bytea not null,                   -- Argon2id settings + salt
  sig          bytea not null
);

create table public.doc_recovery_wraps (        -- per person and vault
  user_id     uuid not null references auth.users on delete cascade,
  vault_id    uuid not null references public.doc_vaults on delete cascade,
  key_version int  not null,
  kind        text not null check (kind in ('anchor','sealed')),
  wrapped     bytea not null,
  primary key (user_id, vault_id, key_version, kind)
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

---

## 16. Step 1 — what's built (2026-11-03)

Branch `claude/documents-crypto`. Owned by `.claude/agents/documents.md`; CI's agent-coverage guard now scans `documents/`.

| File | What it does |
|---|---|
| `documents/crypto/wrap.js` | AEAD wraps (XChaCha20-Poly1305, random nonce) bound to a typed, length-prefixed context. |
| `documents/crypto/file.js` | Encrypted blobs: secretstream in fixed chunks, per-part subkeys, header + file id as associated data, one valid encoding per file, 64 MB ceiling. |
| `documents/crypto/meta.js` | Metadata shape (allowed types, `rev`, `folderId`, clean names) and the padded search-text part. |
| `documents/crypto/vault.js` | Vault and file keys, folder names, rotation, the old-key chain (`unlockKeyring`), `rowVersionAllowed`. |
| `documents/crypto/grants.js` | Box keys and vault grants to devices; refuses removed devices. |
| `documents/crypto/statements.js` | Identity-signed "vault settled" (with removed devices) and recovery-key (with generation) statements. |
| `documents/crypto/recovery.js`, `recovery-params.js` | The code, Argon2id, anchor and sealed wraps, restore with chain proof and short-restore reporting. |
| `documents/crypto/index.js`, `selftest.js` | The public API (import lazily); the self-test for any environment. |

Shares libsodium (`messaging/crypto/sodium.js`, pinned 0.7.15), byte helpers, device keys and padding with messaging.

**Verified:**
- `test/documents-crypto-*.test.js` — 104 tests: blob round trips (0 B to 1 MB, exact multiples), every byte of a blob flipped, truncation (including dropping the empty final chunk), reordered/repeated/extra/foreign chunks, PUSH/REKEY tags, a full-size final chunk, size ceilings; wraps refusing every other context; typed contexts; folder names; the keyring with planted, duplicated and missing rows; grants (every field, removed devices, low-order keys, a sealed box made for elsewhere); the recovery code (every single typo and neighbour swap caught), params bounds, restore (full, short, forged seals, a fake chain reaching the anchor's version, two conflicting chains, the known limit); statements (identity vs device key, every field, generation); metadata (allowed types, invisible characters, prototype keys, padding).
- **22 planted bugs**, one per rule, each re-introduced and caught by at least one test.
- `npm run qa:documents-crypto` — the self-test in headless Chromium through Vite (also run by vitest).
- **Not verified:** the iPhone's WebKit (step 3, from the page's ⋯ menu).

---

## 17. Independent review (2026-11-03)

A separate agent that hadn't seen the code being written attacked it against this design, confirming each finding with a script.

**Found correct:** the blob framing (header, file id and part bound in; reorder/drop/repeat/extend refused; chunk-size bounds before decrypting), the wrap format, the keyring walk (no cycles, a removed device can't learn a newer key from old-key rows), grant signatures and the sealed-context check, low-order key checks, the code's entropy and check value, anchor and sealed bindings, metadata rebuilding.

**Fixed (each has a test that fails when the fix is reverted):**
1. *(P0)* Removal relied on the server's `revoked_at`; a removed device's certificate still verifies, so it could sign its own recovery key or grants and receive future vault keys. → Identity-signed **vault settled** statements carry the removed devices; grants refuse them; the recovery key is identity-signed (§3.4).
2. *(P1)* A removed device that kept the anchor's key, with the server, could make restore return its key. → A new recovery code is required on removal; restore refuses two different chains that both reach the anchor. The remaining case (legitimate rows withheld) is tested as a known limit.
3. *(P1)* A server could silently shorten a restore (drop, duplicate or withhold rows). → Restore reports `newestOffered`, `complete` and `rejected`; duplicates no longer break the chain; no re-print after a short restore.
4. *(P1)* After rotation, a removed device could add documents under the old key. → Rows below the settled version are refused (`rowVersionAllowed`).
5. *(P1)* Any type string was accepted, so an HTML/SVG document could run script in a viewer. → Fixed list of types; the viewer must also set the type itself (step 4).
6. *(P1)* An old recovery key kept working after a re-print. → A signed generation; devices refuse lower ones.
7. *(P2)* One duplicate old-key row blocked the whole keyring. → Every row per version is tried.
8. *(P2)* Context fields weren't typed (`"1"` vs `1`). → Field types fixed by name, with a type byte.
9. *(P2)* Old metadata could be replayed. → `rev` and `folderId` inside the metadata; the app keeps the highest `rev` (step 4).
10. *(P2)* The server chose the Argon2 cost at restore. → Capped at the defaults; the error no longer blames the code.
11. *(P2)* Decryption could allocate up to 256 MB and spread thousands of chunks as arguments. → 64 MB ceiling checked first, one buffer, a 16 KB cap for metadata.
12. *(P3)* A full-size final chunk was accepted (two encodings). → Refused.
13. *(P3)* Names allowed direction overrides and invisible characters; the code parser didn't take pasted en dashes; small helper edges; search text unpadded. → All fixed.

**Accepted for now (later work):**
- File keys don't change on rotation or a move between scopes, so a removed device (or, after a move to Personal, Marijane's devices) could read later renames of files that existed before. Planned: a move to Personal makes a new copy under a new key; rotation re-keys metadata and text (needs a separate metadata key per file).
- `folder_id` and `deleted_at` on a row aren't authenticated; the app checks `folder_id` against the metadata's `folderId`, and a server can always hide a file (availability is the server's).
- The same "removal comes from the server" weakness exists in **messaging** (sending to a device the server didn't mark revoked) — logged in ISSUES.md.

---

## 18. Step 2 — what's built (2026-11-03)

**Live in Supabase:** `migrations/2026-11-03-documents.sql` — `doc_vaults`, `doc_device_boxes`, `doc_vault_grants`, `doc_vault_keys_old`, `doc_vault_settled`, `doc_recovery_keys`, `doc_recovery_wraps`, `doc_folders`, `doc_files`, with row security, guards and column grants. Applied by Luke's OK (additive part, then revokes, then grants); recorded in `schema_migrations` (20261103120000). Checked afterwards: row security on all nine tables, no anon access, no TRUNCATE for signed-in users, updates limited to named columns, the trigger functions not callable, `doc_scope_allows` not callable by signed-in users. The security advisor lists the four `doc_` helper functions as callable by signed-in users; that's intended (row security uses them; each answers only for the caller's own scopes).

What the tables enforce (the devices still prove everything that matters):
- A scope's rows are visible only to who may hold it: Personal to its owner, Household to the group's members. Coworkers and strangers see nothing.
- Vault versions only move up by one; a row's id and scope never change; a file's folder must be in its scope; one Receipts folder per scope, which can't be deleted.
- Grants only from a member's own live device, to a live device whose owner may hold the scope. Recovery keys only replaced by a higher generation.

**Code** (`documents/`):
- `server.js` — the only door to Supabase.
- `vaults.js` — create (phone), open, grant new devices, rotate, remove a device (phone; requires a new code), recovery code, restore (re-keys under the new phone's identity and prints a new code; a short restore makes no new code).
- `storage.js`, `s3-presign.js` — the storage adapter and SigV4 presigning (matches AWS's worked example).
- `supabase/functions/doc-storage/index.ts` — signs URLs after checking the caller may use the scope; sizes pinned on uploads; app-only CORS; kill switch. **Not deployed** until the R2 keys exist.
- `messaging/account.js` gained `signers()`: this device's signing key and, on the phone, the identity key, for Documents' signatures.

**Verified:**
- `test/documents-migration.test.js` — 20 access-rule checks against PGlite with the real migration (as Luke, Marijane, a coworker, a stranger and anon).
- `test/documents-vaults.test.js` — 14 scenarios with real messaging accounts: Personal and Household created, a linked browser and Marijane's phone granted, a forged grant, hidden settled statements, a device-signed settled statement, removal (re-keyed, rows re-wrapped, browser cut off, Marijane follows), a removed device's grant after the server un-revokes it, a swapped box key, an interrupted rotation, restore on a new phone (new identity, Marijane follows), the old code dead, a wrong code, a swapped recovery key. **7 planted bugs** each caught.
- `test/documents-storage.test.js`, `test/documents-edge-function.test.js` — presigning (AWS vector), the adapter, and the function in Node with Deno stand-ins (scope refusals, junk requests, CORS, kill switch).
- Full suite 3400 passing; build passes.
- **Not verified:** the function on Supabase's runtime, R2 itself (both wait for tonight), anything on the iPhone.

**Still to do in step 2:** R2 bucket + keys (Luke, DOCUMENTS_R2_SETUP.md) → deploy `doc-storage` → a real encrypted upload/download round trip.

---

## 19. Second independent review (2026-11-03) — step 2

A separate agent attacked the tables, the vault layer and the storage function, confirming each finding with a script against the real migration.

**Found correct:** row security (strangers, coworkers and anon get nothing; Marijane can't see Personal), grants only at a proven version and bound to vault/version/device, removed devices' grants refused even if the server un-revokes them, swapped box keys caught, device-signed statements ignored, hidden statements don't roll a device back, presigned keys strictly `scope/uuid/part`, sizes pinned, privileges.

**Fixed (each has a test that fails when the fix is reverted, 12 of 13 checked by planting the bug back):**
1. *(P0)* The server decided who counts as a Household member and which identity is theirs: a faked reset or an added "member" could receive the Household key or push a key it chose. → **Only verified people are trusted** (the safety-number scan, once between your phones); a changed identity loses trust until verified again. Unverified members get nothing.
2. *(P0)* A junk row inserted first (settled, old key, grant) could take a version's slot and silently stop a rotation. → Surrogate keys (nothing can be "taken"), and every rotation step checks for a row that **verifies**.
3. *(P0)* One unreadable file row stopped a device removal for good. → Unreadable rows are skipped (and stay hidden); removal is resumable even if the device is already removed.
4. *(P1)* A crash after the settled step made rotation loop and pile up versions. → Rotation resumes or finishes; the server's version is only a hint, moved one step at a time.
5. *(P1)* A second removal during an unfinished rotation was dropped. → It joins the rotation.
6. *(P1)* One member's statement could remove the other's devices or lock them out for good. → Removals are per signer; a higher version without a grant only makes a device wait (it keeps its keys).
7. *(P1)* Restore could be talked out of re-keying (the server's version number), and never actually removed the old devices. → "Short" comes only from the recovery chain; every old device of yours (removed ones included) is listed in the new settled statement.
8. *(P1)* The recovery generation could be pushed to the top, blocking new codes; deleted wraps crashed restore. → Generation moves up exactly one; restore reports "not covered".
9. *(P2)* Members could hard-delete files and blobs and each other's grants. → No hard deletes (Recently deleted, purge after 30 days via `doc_purge_file`); blobs only deletable after that (`doc_blob_deletable` in the function); grants withdrawn only by their granter or recipient.
11–14. *(P3)* Author and time are set by the database; the Receipts folder is checked on insert; the function no longer answers `null` origins or any localhost port, and junk items get 400; box keys are visible only to household members.

**Logged, not fixed here:**
- *(P1, finding 10)* A removed device's Supabase session keeps working until it expires — the enabler behind several findings above, now survivable but still a nuisance. ISSUES.md, with options (gated: auth).
- The "changed identity" check is redundant while verification is required (messaging already unverifies a changed key); kept as defence in depth.

**Database (applied 2026-11-03, Luke's OK):** this session can't run a `DROP`, so the first (empty) tables were **moved aside with renames** (`2026-11-03c-documents-v1-aside.sql`: tables, indexes and functions get a `v1_` prefix; all access to them revoked), then `2026-11-03b-documents-v2.sql` was applied **without its DROP lines**. Checked afterwards: row security on all nine tables, the right triggers on each, no hard deletes for signed-in users, nothing for anon, helper functions callable only as intended. Recorded in `schema_migrations` (20261103190000). The `v1_doc_*` leftovers are empty and can be dropped in the SQL editor any time (the statement is at the top of the 03c file).

**Storage (2026-11-03):** the R2 bucket `liv-documents` exists (made with the Cloudflare connector; Standard, private). The `doc-storage` function is **deployed** to Supabase (JWT check off at the gateway because the function checks the caller itself through `doc_can_access`; that also lets the browser's CORS preflight through). It answers "not configured" until the four `DOC_S3_*` secrets are set.

**Decided (Luke, 2026-11-03): verification is required.** Household sharing needs you and Marijane to **verify each other once** (scan the QR between your phones, the same check messaging offers). Messaging only *prompts* for it; Documents *requires* it, because otherwise the server could slip in a key. The pages must lead an unverified member to that scan (Household shows "Verify with Marijane to share" instead of her files). Decision 10 in §0.

**Storage checked live (2026-11-03):** with the secrets set, from the production site as Luke: 401 without sign-in; a 200 KB PUT to R2, GET back byte for byte, DELETE, then 404; another person's scope 403; an upload whose size differs from the signed one doesn't go through. The R2 CORS policy and bucket key are therefore right. Step 2 is done.


---

## 20. Steps 3–4 — the pages (2026-11-03)

Built everything in steps 3 and 4 that runs in the web view; the **Face ID Keychain item** (native) is still to do and is the one thing that needs a TestFlight build before the pages can ship.

**Built:**
- `documents/ui.js` (`mountDocuments(root, deps)`), loaded lazily the first time the page opens. Watch's shell: the folder sidebar (a ☰ drawer on a phone, a rail on a laptop), a search head with + and ⚙, files as a list (thumbnail or a type label, date, page count, size, folder, who added it).
- **States:** no messaging keys → "Open Messages" (setup, linking and verification stay in Messages); vault missing → set up (phone) or "set it up on your phone first" (browser); waiting for the key → "Check again", plus a verify note in Household and the recovery-code restore on a phone; removed; error.
- **Setup:** creates the vault and the starting folders (decision 7). Personal shows the **recovery code** right away (8 groups of 4; Print on a laptop, the share sheet's Print on the iPhone, since its web view ignores `window.print()`).
- **Adding:** + (file picker) and drag-and-drop; type checked against the allowed list (SVG/HTML refused with the reason); 60 MB cap; image thumbnails made on the device; PDF page count.
- **Viewing:** images and PDFs from a local decrypted copy (`blob:`, type from the metadata's fixed list); text shown as text; anything else → Share. **Share** uses the share sheet (iPhone) or a download (laptop).
- **Editing:** name, folder, document date, tags; delete → Recently deleted (30 days) → Put back; folders add / rename / remove (not Receipts).
- **Banners:** an unverified household member (decision 10), "make a new recovery code" after a removal, a device removed in Messages that still holds a key ("Lock it out" re-keys), storage at 7 GB.
- **Settings (⚙):** storage used, new recovery code (phone), your devices with Remove (phone; re-keys and makes a new code).
- **Sharing the key:** every open on a device that holds a vault grants it to trusted devices still waiting (Marijane's phone once verified, a newly linked browser). Nothing polls.
- app.js: `showDocumentsApp`, the menus (Resource group: Finance, Shop, Documents), `#documents` routes, Household and Personal in `VIEW_PAGES`, switching view swaps the vault, sign-out deletes the `live-documents` store with messaging's.

**Fixed while building:** a member who opened Household *before* the two of you verified never published her box key, so your phone had nothing to grant to afterwards. `vaults.open` now publishes this device's box key on every first visit (test: "a member who opens before verifying…", fails without the fix).

**Verified:**
- `npm run qa:documents-ui` — **46 checks** in Chromium with three profiles (Luke's phone, Marijane's phone, Luke's laptop) against PGlite with the real messaging + Documents migrations and row security, and a stand-in for doc-storage with the same access checks: the flow above end to end, plus the object store holding only ciphertext, no readable names in the database, markup in a text file shown as text, Marijane refused links to Luke's Personal, fits 390 px and 360 px, no page errors.
- Unit suite 3425 passing; build passes; boot check passes; the real app's landing menu opens Documents (local dev mode says "Sign in", as expected).
- R2 itself was checked live in §19.
- **Not verified:** anything on an iPhone (the share sheet, the PDF frame in WKWebView, confirm/prompt dialogs), the real Supabase over the network for the pages (the stand-in runs the same SQL).

**Still to do:** Face ID Keychain item (native) → TestFlight → scanning (step 5) → receipts hook (step 6) → the batched Netlify deploy (step 7, Luke's OK).
