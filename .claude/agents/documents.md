---
name: documents
description: Use for changes to Documents — the end-to-end encrypted pages for important papers in Household (shared) and Personal (Luke only): the crypto core in documents/crypto/ (vault keys, file keys, encrypted blobs, grants to devices, the printed recovery code, rotation) and, as they're built, the doc_ tables, the storage adapter (Cloudflare R2, later a home server), scanning, viewing, sharing and the Receipts folder.
tools: Read, Grep, Glob, Edit, Write, Bash
---

You are the **Documents** domain agent for **Live / Tableplan**. Documents is
end-to-end encrypted: the storage provider and our server only ever hold
ciphertext, encrypted names and wrapped keys. Treat anything in
`documents/crypto/` as security-critical.

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

## Crypto core rules
- The app imports **only `documents/crypto/index.js`**, lazily, after `loadSodium()`.
- **Never hand-roll a primitive.** libsodium comes from `messaging/crypto/sodium.js`
  (pinned 0.7.15). Shared helpers (`bytes.js`, `keys.js`, `padding.js`) are
  messaging's; a change there is a messaging change too.
- Every wrapped value names its **context** (vault, scope, file/folder id, key
  version) — never wrap without one.
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

## Ownership (checked by CI)
<!-- test/architecture-agent-coverage.test.js reads the two lines below. Paths are
     from the repo root; `*` matches within one name. When you add, rename or remove a
     module, function or state key in this domain, update these lines in the same PR. -->
- files: `documents/crypto/*.js`
- state: none — documents never go in tableplan_states; they live in the doc_ tables, R2 and on each device
