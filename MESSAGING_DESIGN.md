# Encrypted messaging — design & plan

Status: **DESIGN AGREED** (Luke, 2026-10-29/30). **Step 1 (crypto core) built and independently reviewed** on branch `claude/messaging-crypto` (2026-10-30) — §15, §16. No migration, no UI, nothing deployed.

Goal: end-to-end encrypted messages between app users, Signal-level protection, living in the current Mail page, which is renamed **Message**. Phone numbers (SMS) may come later as an invite link into the app (§13).

---

## 0. Decisions (all resolved)

| # | Question | Decision |
|---|---|---|
| 1 | Which devices | Web and iPhone. **Phones are the trusted devices**; browsers and the laptop app are linked from a phone by QR scan. Marijane moves to the TestFlight app. |
| 2 | History on new devices | **None.** One key per device; a newly linked device sees only messages sent after it was linked. |
| 3 | Encryption | **Signal's protocol (X3DH + Double Ratchet), implemented by us on libsodium** — not Signal's own library (no browser support, "use outside Signal unsupported", AGPL). |
| 4 | Content in v1 | **Text + app cards** (recipe, event, trip, Shop item…). Built text-first, cards second, shipped together. No photos yet. |
| 5 | Conversations | **Groups from the start** (1:1 is a two-member group). |
| 6 | Page layout | **Messages \| Mail tabs** at the top of the renamed Message page; Messages is the default; last tab remembered. |
| 7 | Group changes | **Any member** can rename, add, remove, or leave. Every change shows in the thread. |
| 8 | Phone notifications | **Sender only** ("Marijane sent a message", "Marijane in Household"). Browsers: unread badge while the app is open, no pop-ups. |
| 9 | Verification | **Prompted, not required.** "Not verified" notice + Verify (QR); check mark once verified; "security code changed" flagged in the thread. |
| 10 | Message lifetime | **Disappearing by default.** Any member can change or turn off a thread's timer. "Delete for everyone" included. |
| 11 | Default timer | **1 week.** |
| 12 | Extras | **Read receipts on**, per-person switch. **No typing indicators** (would need a live connection). **No editing.** |

---

## 1. Checks against the code

1. ✅ **The iPhone app runs bundled JS** (2026-10-30): `capacitor.config.json` has no `server.url`; it loads `dist` from the signed TestFlight build. So the phone's crypto code really comes from the build, and phones can be the trusted devices.
2. ⏳ Mail page structure and the **Message** menu entry (PAGE_GROUPS_DESIGN), and Contacts' call/text/FaceTime row (APP_LINKS_DESIGN) — at step 7.
3. ⏳ `_push.js` / `live_push_subscriptions` state from IOS_NOTIFICATIONS_DESIGN Phase 2 — at step 6; messaging needs to push to one device.
4. ⏳ The laptop app: Capacitor desktop build or the PWA? — at step 2 (decides how it's linked).

---

## 2. Architecture overview

- **One crypto implementation, in JS**, on `libsodium-wrappers-sumo` (**pinned to 0.7.15 exactly** — 0.7.16's ESM build is broken; "sumo" has the streaming HMAC the HKDF needs). It runs in Chrome and inside the iPhone app's web view, so phone and browser can't drift apart.
- It lives in `messaging/crypto/`, small and rarely changed. The rest of the app imports only `messaging/crypto/index.js`.
- **Loaded lazily** when Messages opens: libsodium is ~350 KB gzipped, so it must not be in the boot bundle.
- **Integrity check (web):** the build records a hash of the crypto chunk; each browser remembers the hash it last ran and shows a one-line warning if it changes without an app version bump. This doesn't stop a malicious deploy, but it makes a silent one visible. (Step 7.)
- **No Swift crypto.** The notification extension never decrypts (§9).
- Server (Supabase) stores only: public keys, device certificates, one-time prekeys, and an **inbox of ciphertext** deleted once delivered. It never holds a private key or plaintext.

---

## 3. Keys and devices

**Primary identity (one per person, on their phone)**
- An **Ed25519 signing key**, created on first setup, kept in the iOS Keychain (via a small native plugin) — never leaves the phone. (The design first listed an X25519 key here too; it has no job, so it was dropped.)
- It signs each device's certificate, and it's what the safety number / QR verification checks.

**Device keys (every device, phone included)**
- Ed25519 (signs the device's prekeys) + X25519 (its X3DH identity key).
- **Signed prekey** (X25519, signed by the device's Ed25519 key together with its creation time, rotated ~monthly; initiators refuse one older than 60 days).
- **One-time prekeys**: batch of 20, refilled to 20 when fewer than 5 remain.
- **Device certificate**: `{user_id, identity key, device_id, kind, device keys, created_at}`, length-prefixed, with **two signatures**: the person's **primary identity key** vouches for the device, and the **device's own key** proves it holds the keys being certified (so nobody can certify someone else's device as theirs). A recipient trusts a device only if both verify against the identity key it has stored for that person. Verifying someone's phone once covers all their linked devices.
- **Server rule (step 2):** a device's keys can appear in only one certificate (unique `sign_pub` and `dh_pub` in `msg_devices`).

**Storage on device**
- iPhone: a wrapping key in the Keychain encrypts the key store and session state at rest.
- Browser: a non-extractable WebCrypto AES-GCM key in IndexedDB wraps the libsodium keys. (Raw keys are in memory while the app is open — an accepted limit of web crypto.)
- Clearing browser data = that browser is gone; re-link it (decision 2).

**Linking a browser or the laptop app**
1. The new device generates its keys and shows a QR: `{device_id, device public keys, one-time code}`.
2. The phone scans, shows "Link Chrome on Mac?", and on approval signs the device certificate and uploads it.
3. The new device can now receive messages sent from then on.
- Devices list in Settings → Messaging: name, type, last seen, **Remove** (revokes the certificate; contacts stop sending to it on their next send).
- Linked devices unused for 60 days are flagged for removal (open, §13).

**New phone / reset:** creates a new primary identity. Everyone's thread shows "Luke's security code changed"; linked devices must be re-linked from the new phone.

**Safety numbers** follow Signal's construction: per person, SHA-512 iterated 5,200 times over the identity key and user id; 30 digits each, sorted, 60 total. The QR carries both fingerprints, so a scan catches a swapped key on either side.

---

## 4. Protocol

Following Signal's published specs (X3DH, Double Ratchet, a light form of Sesame for multi-device). Post-quantum (Signal's newer PQXDH) is out of scope — libsodium has no ML-KEM; noted for later.

- **Sessions are per device pair.** Sending to Marijane = encrypt separately for each of her devices **and each of my other devices**.
- **Session start (X3DH):** fetch the recipient device's certificate, signed prekey, and claim one one-time prekey (`claim_prekey` RPC, which deletes it atomically). Verify the certificate chain and prekey signature before use. `SK = HKDF(0³², 0xFF³² ‖ DH1 ‖ DH2 ‖ DH3 [‖ DH4], "LiveMsg/X3DH/v1")`; AD binds **both ends' full identity**: user id, identity key, device id, and both device keys.
- **Every message (Double Ratchet):** fresh message key per message; DH ratchet step on each reply. Out-of-order messages handled with stored skipped keys (at most 1,000 skipped per gap, 2,000 stored, dropped after 7 days).
- **Primitives:** X25519 (low-order keys rejected), Ed25519, HKDF-SHA256 and HMAC-SHA256 (chain keys), XChaCha20-Poly1305 (message encryption; key derived from the message key, a **random 24-byte nonce** sent with each message; AD ‖ header as associated data). Plaintext padded to 64-byte blocks.
- **Wire (version 2):** a version byte, then either a normal message (`header ‖ nonce ‖ ciphertext`) or a prekey message (`IK ‖ EK ‖ spkId ‖ opkId ‖ header ‖ nonce ‖ ciphertext`). The initiator keeps sending prekey messages until it first hears back. The prekey message's identity key is **compared to** the sender's certificate, never trusted on its own.
- **Several sessions per device pair** (up to 5, most recently used first): if both devices start at once, or one side resets, older sessions still decrypt stragglers while the newest is used to send. A straggler on an older session doesn't make it the sending session. Sessions that already know a message's ratchet key are tried first, which keeps the cost of a forged message low.
- **Replay guard for first messages:** each device keeps the ephemeral keys of prekey messages that set up a session, for the life of that signed prekey, and refuses repeats.
- **App-layer rules (steps 2–3), which the core can't enforce:** store a record before sending or acting on a message, under a per-device-pair lock or version check (two tabs must not both advance one record); record `newPrekeyMessage` and delete `usedOneTimePrekeyId` after storing; if a decrypted envelope is invalid, still store the returned record; rate-limit failed decrypts per sending device; accept `sync` only from your own certified devices, `control` only from current members, and `delete_for_everyone` only for the sender's own messages; dedupe envelope ids.
- **Session repair:** if a message can't be decrypted (lost state, e.g. cleared browser data), the device replies with an automatic `reset_session` and the sender starts a new session; the thread shows a quiet "a message couldn't be decrypted" line.

**Testing honesty:** Signal's specs don't ship official test vectors for the full protocol. Assurance comes from libsodium's own primitives (never hand-rolled), the RFC 4231 / RFC 5869 vectors for HMAC/HKDF, a property-test suite (random message order, loss, simultaneous starts, resets), and the same self-test run in Node, in Chromium through Vite, in the production bundle, and (step 2) on the phone.

---

## 5. Message format (inside the encryption)

One versioned envelope for everything, validated by `messaging/envelope.js` on both sending and receiving; unknown fields are dropped:

```jsonc
{
  "v": 1,
  "type": "text" | "card" | "control" | "receipt" | "sync",
  "conv": "<conversation id>",
  "id": "<message id>",
  "sentAt": "<iso>",
  "expireSecs": 604800,          // the thread's timer when sent (null = off)
  "body": { ... }                 // per type, below
}
```

- `text`: `{ "text": "..." }` (max 4,000 chars, not blank).
- `card`: `{ "kind": "recipe"|"event"|"trip"|"shop", "ref": "<item id>", "snapshot": { "title", "subtitle", "date", "thumb" } }` — the snapshot always renders; tapping opens the real item **only if the recipient can see it** (Personal items stay private). The thumb (https only) is a URL the sender chose, so it's loaded through the app's image proxy or on tap, never automatically — otherwise it would tell the sender when and from where the card was read.
- `control`: `group_create`, `group_rename`, `member_add`, `member_remove`, `member_leave`, `timer_set` (1 h / 1 day / 1 week / 4 weeks / off), `delete_for_everyone`, `reset_session`.
- `receipt`: `{ "read": ["<message ids>"] }`.
- `sync`: to my other devices — `sent` (a copy of a message I sent), `verified` (verification status), `read` (read up to a message).

---

## 6. Groups

- Every conversation is a group with a member list; 1:1 is two members.
- **Clients are the authority on membership.** A member list only changes through `control` messages from a current member (decision 7). The server's member table exists for routing and access rules only — if it ever disagreed, clients ignore it, so the server can't add anyone.
- A group message is encrypted once per device of every member over the pairwise sessions (§4). Fine at household size.
- Group name is inside the encryption; the server never sees it.
- Changes show in the thread: "Marijane renamed the group Household", "Luke added …", "… left".

---

## 7. Disappearing messages, deletion, receipts

**Timer (decisions 10–11)**
- New conversations default to **1 week**. Any member can change it (1 hour, 1 day, 1 week, 4 weeks, off) via `timer_set`, shown in the thread.
- Sender's devices: countdown starts at send. Recipient's devices: starts when the message is **read on that device** — unread messages wait.
- Expired messages are erased from local storage on a sweep (app open, visibility change, every minute while open).
- Cards disappear like text; the underlying recipe/event is untouched.

**Delete for everyone**
- Sender only, within **24 hours** of sending (Signal's window; open, §13). Recipients' devices erase it and show "Message deleted".

**Read receipts (decision 12)**
- On by default, per-person switch in Settings → Messaging. Following Signal: if you turn yours off, you also stop seeing others'.
- Receipts are themselves encrypted messages, batched (one per thread per open).

**Not included:** typing indicators, editing.

---

## 8. Supabase data model

New tables, `msg_` prefix. **Nothing touches `tableplan_states`; no `STATE_SCHEMA_VERSION` bump.** RLS on all, no `anon` grants. (Migration is step 2 and gated on Luke's OK.)

```sql
create table public.msg_identities (            -- one per person (primary identity)
  user_id      uuid primary key references auth.users on delete cascade,
  sign_pub     bytea not null,
  updated_at   timestamptz not null default now()
);

create table public.msg_devices (
  device_id    uuid primary key,
  user_id      uuid not null references auth.users on delete cascade,
  kind         text not null check (kind in ('phone','linked')),
  label        text,                              -- "Chrome on Mac"
  sign_pub     bytea not null,
  dh_pub       bytea not null,
  created_at_ms bigint not null,                  -- certified value
  cert_sig     bytea not null,                    -- signed by the user's primary identity
  spk_id       int not null, spk_pub bytea not null, spk_sig bytea not null,
  last_seen_at timestamptz,
  revoked_at   timestamptz
);

create table public.msg_prekeys (
  device_id uuid not null references public.msg_devices on delete cascade,
  prekey_id int  not null,
  pub       bytea not null,
  primary key (device_id, prekey_id)
);
-- claim_prekey(device_id) security definer: delete-and-return one row (null if empty).

create table public.msg_conversation_members (   -- routing/access only (§6)
  conversation_id uuid not null,
  user_id         uuid not null references auth.users on delete cascade,
  primary key (conversation_id, user_id)
);

create table public.msg_inbox (
  id                  bigint generated always as identity primary key,
  recipient_device_id uuid not null references public.msg_devices on delete cascade,
  sender_device_id    uuid not null,
  conversation_id     uuid not null,              -- opaque id, for notification labels (§9)
  ciphertext          bytea not null check (octet_length(ciphertext) <= 65536),
  created_at          timestamptz not null default now()
);
create index msg_inbox_recipient on public.msg_inbox (recipient_device_id, id);
```

**RPCs** (explicit columns, `return=minimal` on writes):
- `msg_send(batch jsonb)` — inserts one row per recipient device in one call; checks the sender is a member and each recipient device belongs to a member and isn't revoked.
- `msg_fetch(after_id bigint, max int default 100)` — this device's rows after the cursor.
- `msg_ack(ids bigint[])` — **deletes** delivered rows.
- Daily (the maintenance function): delete inbox rows older than 30 days (a device offline that long misses them), and prekeys of revoked devices.

---

## 9. Delivery & notifications

**iPhone**
- On send, the server pushes each recipient phone via `_push.js` with only `{ conv: "<uuid>", from: "<user uuid>" }` — opaque ids.
- A **Notification Service Extension** looks those ids up in a small name table the app keeps in shared App Group storage (contact and group names, refreshed when they change) and shows "Marijane sent a message" / "Marijane in Household". Unknown conversation → "New message". **Apple sees only ids; the extension does no decryption.**
- Opening the app (or tapping the notification) runs `msg_fetch`, decrypts, acks.
- Collapsed per conversation so ten messages don't make ten alerts.

**Browsers (no pop-ups, decision 8)**
- `msg_fetch` on open and on focus; while the app is visible, a light check every **30 s on the Message page, 2 min elsewhere**; none while hidden. Empty result ≈ 0.3 KB. (A bounded, justified read per CLAUDE.md's Supabase cautions: one indexed RPC on a near-empty table, visible-only.)
- Unread badge on Message in the menu and the landing page.

---

## 10. Egress & cost

| Source | Frequency | Bytes out | Monthly (2 users, ~6 devices) |
|---|---|---|---|
| Message fetch (per device) | per message | ~0.5–1 KB text, ~1.5 KB card | < 1 MB |
| Browser checks while open | 30 s / 2 min, visible only | ~0.3 KB empty | ~2–5 MB |
| Key/prekey/device reads | new session or device | ~2 KB | ~0 |
| Pushes | per message | 0 from the database | 0 |

- Inbox rows are deleted on delivery, so storage stays near zero.
- Kill switch: env `MESSAGING_DISABLED=1` stops the notify function; the client hides sending.
- **No money:** libsodium, APNs and the Notification Service Extension are free. App Store Connect export-compliance answer needed for the TestFlight build (standard algorithms; likely the annual self-classification report — confirm at that step).

---

## 11. UI

**Message page** (renamed from Mail; title, menu entry, landing card)
- Tabs **Messages | Mail** at the top; Messages default; last tab remembered. Mail tab = today's Mail page, unchanged (incl. its AI recipe toggles and Contacts).
- **Messages list:** conversations by recency, unread dot, timer icon, verified check.
- **Thread:** bubbles, cards, system lines (group changes, timer changes, security code changed, couldn't decrypt), read state on your last message, "Not verified · Verify" banner until verified.
- **Composer:** text field (with the standard clear "x"), **+** for cards → picker of recipe / event / trip / Shop item.
- **New conversation:** pick one or more people → optional group name.
- **Thread info:** members (add/remove/leave), name, timer, verify per person.
- **Contacts:** a **Message** button beside call / text / FaceTime for app users.

**Settings → Messaging**
- Set up messaging (phone) / Link this device (browser: shows QR).
- Devices (list, remove), Link a device (phone: scanner).
- Read receipts switch, default timer.
- Run crypto check (the self-test, §15) — useful on the phone.
- Reset messaging (new identity; ends all sessions).

**Views:** messaging is per person and appears in every view; not shared through Household data.

---

## 12. Build order

Test without Netlify deploys: phone on TestFlight, laptop on a local dev server (`npm run dev:local`) against the live Supabase project.

1. ✅ **Crypto core** (`messaging/crypto/`, `messaging/envelope.js`) + tests. No UI, no deploy.
2. **Migration** (gated — applied via the Supabase MCP after Luke's OK) + key store (Keychain plugin, IndexedDB wrap) + phone setup + device linking + verification + the self-test in Settings. TestFlight build.
3. **1:1 text**: send/fetch/ack, sync to own devices, receipts, disappearing timer, delete for everyone, session repair.
4. **Groups**: create, rename, add/remove/leave, fan-out.
5. **Cards**: picker, snapshot, access-aware open.
6. **Push**: notify function, Notification Service Extension + App Group name table, export-compliance answer. TestFlight build. (The notify function needs a Netlify deploy → batch with step 7, or run it as a Supabase Edge Function to avoid one — decide at build.)
7. **Mail → Message rename + tabs + Contacts button + integrity check**, then **one batched Netlify deploy** (with Luke's OK) so both browsers get it. Marijane installs TestFlight and sets up on her phone first, then links her browser.

Watch the Supabase API logs for 48 h after steps 2 and 7.

---

## 13. Later & open

- Photos (compress on device, encrypted, size-capped, deleted after delivery).
- Phone numbers: SMS can't be E2E; send an invite link into the app.
- Group admins (any-member is the v1 rule).
- History transfer when linking (much less useful with disappearing messages; likely dropped).
- Post-quantum key agreement (PQXDH) if a suitable audited library appears.

**Open, minor (sensible defaults above, confirm anytime):** delete-for-everyone window (24 h); read-receipt reciprocity (Signal's rule); auto-removal of linked devices unused for 60 days.

---

## 14. Tests

- **Crypto (built, §15).**
- **Protocol (steps 3–4):** fan-out covers every member device + own devices; revoked device excluded; server-forged membership ignored; group control messages from non-members rejected; timer start rules (send vs read); delete-for-everyone window.
- **Server (step 2):** RLS — a user can't read another device's inbox, claim prekeys for nothing, or insert to non-members; `msg_ack` deletes; no `anon` access; egress guard (no messaging code references `tableplan_states`).
- **Manual (TestFlight + dev laptop):** setup, link, remove; verify by QR; security-code-changed after reset; text, group, card (Household recipe opens, Personal one shows snapshot only); disappearing after read; delete for everyone; locked-phone notification shows sender only; cleared browser data → re-link works.

---

## 15. Step 1 — what's built (2026-10-30)

**Files** (owned by `.claude/agents/messaging.md`; CI's agent-coverage guard now scans `messaging/`):

| File | What it does |
|---|---|
| `messaging/crypto/sodium.js` | Loads libsodium once (`loadSodium()`). |
| `messaging/crypto/bytes.js` | Bytes, base64url, u32, length-prefixed fields, constant-time compare. |
| `messaging/crypto/kdf.js` | HMAC-SHA256 and HKDF-SHA256 on libsodium's streaming HMAC. |
| `messaging/crypto/keys.js` | Identity/device keys, device certificates, signed/one-time prekeys, X25519 with low-order rejection, safety numbers + QR. |
| `messaging/crypto/x3dh.js` | X3DH initiator/responder. |
| `messaging/crypto/ratchet.js` | Double Ratchet; pure, JSON state; skipped-key limits. |
| `messaging/crypto/session.js` | Session records (≤5 per device pair), wire format, prekey/normal messages. |
| `messaging/crypto/padding.js` | 64-byte block padding. |
| `messaging/crypto/index.js` | The public API (`sealEnvelope` / `openEnvelope` + key functions). |
| `messaging/crypto/selftest.js` | Self-test for any environment (Settings → Messaging later). |
| `messaging/envelope.js` | Envelope validation (§5). |

**Verified:**
- `test/messaging-crypto-kdf.test.js` — RFC 4231 HMAC and RFC 5869 HKDF vectors (all three), bytes, padding.
- `test/messaging-crypto-keys.test.js` — certificates (every field, re-splitting, malformed input), prekey signatures, low-order keys, safety numbers and QR (swapped key on either side caught).
- `test/messaging-crypto-session.test.js` — review regressions (§16), conversations, no one-time prekey, repeated prekey messages, one-time-prekey reuse refused, replays (in order and out of order), tampering at several offsets with the stored record unchanged, imposter identity key, another device can't read, skip limit, skipped-key expiry, simultaneous starts, reset after lost state, session cap, no mutation; **8 seeded property runs** of 300 random steps each (both directions, reordering, 5% loss, sometimes simultaneous starts).
- `test/messaging-envelope.test.js` — every type accepted, unknown fields dropped, 19 hostile shapes rejected, seal/open round trip.
- **Planted bugs:** dropping the header from the associated data (20 tests fail) and not deleting a used skipped key (caught once the out-of-order replay test was added — that test exists because the first run missed it). Removing the explicit duplicate check is caught by authentication anyway (defence in depth).
- `npm run qa:messaging-crypto` — the self-test in headless Chromium through Vite: 9/9. The **Vite production bundle** of the self-test also passes 9/9 in Chromium (~350 KB gzipped, hence lazy loading).
- **Not yet verified:** the iPhone's WebKit (step 2, via Settings → Run crypto check).

---

## 16. Independent review (2026-10-30)

A separate agent, which hadn't seen the code written, attacked the crypto core against the Signal X3DH and Double Ratchet specs and confirmed each finding with a script.

**Found correct:** the chain and root key derivations, X3DH (DH order, the 0xFF prefix, zero salt, prekey signature checked first, low-order keys refused), the ratchet step order, skipped-key handling and limits, nothing committed on failure, header and wire bounds, constant-time comparison, length-prefixed certificates, safety numbers and QR, and envelope rebuilding (stray fields and `__proto__` don't carry through).

**Fixed (each now has a test that fails if the fix is reverted):**
1. *(P1)* A server could certify one person's device keys as another person's device, mislabelling who sent a message (nothing readable). → Device certificates carry the device's own signature, and the session AD binds both ends' user id, identity key and device id.
2. *(P1)* Reusing a stale record (two tabs, a retried save) reused a key **and** nonce. → Random nonces; the store-before-send lock is now a written app-layer rule.
3. *(P1)* A captured first message could be replayed after its session aged out, and the replayed session took over sending. → Seen-store of first-message ephemeral keys; the core reports each new one for the app to record.
4. *(P2)* A forged message could cost ~87 ms of work against all five sessions. → Likely session tried first; per-sender rate limit at the app layer (step 3).
5. *(P2)* A message whose envelope was invalid left its key derivable. → The advanced record is returned for storing, with the message dropped.
6. *(P2)* Sender authorization (`sync`, `control`), the card-thumb tracking risk, and loose dates. → Written as app-layer rules (§4, §5); dates must be ISO UTC.
7. *(P3)* Ids are limited to `A–Z a–z 0–9 _ -` (one byte form), and signed prekeys carry a signed creation time and expire after 60 days.

**Test gaps closed:** the vacuous "identity separation" test is gone; the session-limit test now checks which session is evicted and which sends; the one-time-prekey test now says plainly that deleting the prekey is the app's job.
