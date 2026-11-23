# Passwords: a password manager in Liv's Safe — design & plan

Status: **Phase 1 built (2026-11-22, §17), waiting on Luke's OK for its migration and the merge. Phases 2–6 not started.** All open questions were decided 2026-11-21.

Goal: keep usernames, passwords, 2FA codes and passkeys in the Safe, encrypted on the device, and fill them **everywhere**: Safari and every app on the iPhone, Chrome on the laptop, and Liv's own browser when it exists.

---

## 1. Decisions (Luke, 2026-11-18 → 21)

1. **Lives in the Safe**, under the same end-to-end encryption and Face ID lock as Documents.
2. **Works outside Liv**, not only in an in-app browser.
3. **Built before the in-app browser.** Nothing here depends on the browser; the browser later uses it (§10).
4. **Fill rule:** logins are offered only for the site they belong to (§6), and nothing fills without a tap.
5. **Place:** a **Passwords** entry in the Documents page's sidebar, in both Household and Personal.
6. **Import first from iCloud Passwords and Google / Chrome** (where Luke's passwords are today), merging the two (§7).
7. **Leak check on** (Have I Been Pwned, §5).
8. **Keyboard (QuickType) suggestions on** (§8).
9. **Passkeys stored in Liv** (phase 3); existing iCloud passkeys stay where they are.
10. **Marijane** gets Household logins with AutoFill on her phone **after the independent review**.
11. **Laptop unlock:** a passkey where Chrome allows it inside the extension, otherwise approve on the phone (§9).

---

## 2. What exists to build on

- **Vault keys, grants and device removal** (DOCUMENTS_DESIGN §3): a key per scope (Household, Personal), sealed to each trusted device's box key; removing a device rotates the keys. Passwords reuse this machinery.
- **Device linking by QR** and per-device keys (MESSAGING_DESIGN).
- **Face ID lock** on the iPhone: `DocumentsLockPlugin.swift`, a `.userPresence` Keychain key, asked on every open (DOCUMENTS_DESIGN §21).
- **Passkey lock on the web**, real encryption via WebAuthn PRF (DOCUMENTS_DESIGN §24).
- **Recovery code** for Personal (DOCUMENTS_DESIGN §3).
- **App Group** registered (2026-11-12), with the manual-signing workaround for TestFlight builds. The AutoFill extension needs it.
- **Crypto stack:** `libsodium-wrappers-sumo` 0.7.15 in the web app.
- ⚠️ **The vault keys live in the web view's IndexedDB.** An iOS extension is a separate native process and can't read that, so §8 adds a native copy.

---

## 3. What a login holds

Encrypted JSON, one row per login (`documents/crypto/logins.js` `parseLogin`):

`{ v, rev, kind, title, sites[], exactSite, username, password, totp, notes, tags[], favorite, history[], created, updated }`

- `kind`: `login` or `note` (a **secure note**: no site, username or password).
- `sites`: one or more web addresses, **http(s) only** (no `javascript:` or other schemes, no `user:pw@`).
- `totp`: the 2FA secret (`otpauth://` or a bare base32 key), so Liv shows the code.
- `history`: the last 10 passwords with the date each was replaced.
- `passkey` (phase 3, decision 9) is added then, with `v` raised.
- A **password generator**: random, 12–64 characters, symbols and numbers optional, look-alike characters left out. *(Word-based passwords aren't built: they need a word list shipped with the app; add later if wanted.)*

---

## 4. Keys and storage

- **A Logins key per scope and key version, derived from the vault key**: `BLAKE2b-256(key = vault key, message = context(vault, scope, version))`. *(Changed while building, 2026-11-22: the draft said "a separate key, granted the same way". Deriving gives the same separation — the derivation is one-way, so the coming AutoFill and Chrome extensions, which will hold only Logins keys, can't get the vault key or open documents — and grants, rotation and the recovery code carry it with no new machinery.)*
- Each login is sealed (XChaCha20-Poly1305) under the Logins key with its vault, scope, login id and key version as associated data, so a row can't be moved onto another login, scope or version; padded to 64-byte blocks; at most 16 KB.
- Rotated with the Documents keys whenever a device is removed (`vaults.rotate` re-seals every login under the new version; the contents and `rev` don't change). Restored by the same recovery code.
- **Supabase:** one table, `safe_logins` (id, scope, key_version, enc, created_by, created_at, updated_at, deleted_at); migration `2026-11-22-safe-logins.sql`. Row security as the Safe's documents (`doc_can_access`) plus `require_mfa_when_enrolled`; explicit grants, no `anon`; id, scope and author fixed; no hard delete (`safe_purge_login` after 30 days in Recently deleted). **No R2.**
- The server sees only: how many logins each scope has and when they change. Never a site, a username or a password.
- **Egress:** reads only rows changed since the last read, when Passwords opens and after this device's own edits; rows kept (still encrypted) in the Safe's locked store; no polling; never touches `tableplan_states`.

---

## 5. In the app

- **Passwords** is the first entry in the Documents sidebar, in both Household and Personal (decision 5). It shows a row of filters (All, Favourites, 2FA codes, Secure notes, Needs attention, Recently deleted), search, and the list. *(A Passkeys filter comes with phase 3.)*
- It sits behind the same unlock as Documents: Face ID (iPhone) or the passkey (laptop), re-locking on leaving. One unlock covers both files and passwords; the decrypted list leaves memory on lock.
- A login shows the username and password (hidden until Show), copy buttons, the live 2FA code with its countdown, its sites, notes, earlier passwords, and who added it (Household). A copied password is **cleared from the clipboard after 60 seconds**. *(Local-only on the iPhone, so it doesn't reach the Mac's clipboard, needs a small native piece: phase 2.)*
- **Needs attention** (decision 7): passwords used on other sites, weak ones, **leaked ones**, and logins the import found two passwords for. The leak check uses Have I Been Pwned's Pwned Passwords range API: only the first 5 characters of each password's SHA-1 hash leave the device, with padding on; the match is made on the device. Free, no key, called straight from the device (CORS), so the prefix doesn't pass through our servers. Run when Passwords opens and when a login is saved, at most weekly per password (the result is kept, with the hash, in the Safe's encrypted store), never in the background.
- **Household logins** (streaming, utilities, insurance) are shared with Marijane; Personal ones are private. "Move to Personal / Household" makes a new row there and puts the old one in Recently deleted.
- **Never for AI:** Duet, the coming assistant and universal search never see the Safe (same rule as UNIVERSAL_SEARCH_DESIGN).

---

## 6. Matching a login to a site

- A login matches its site's **registrable domain**: a login for `google.com` also fills on `accounts.google.com`, never on `google.com.evil.io`. Worked out with the Public Suffix List (`tldts`, private suffixes included, so `luke.github.io` and `other.github.io` are different sites). IP addresses and names with no public suffix match only themselves.
- A login saved for https doesn't match an http page.
- Per login, a **"this address only"** switch for sites that need the exact host.
- Look-alike (punycode) domains are shown in raw form and never match.
- Nothing fills on its own, and nothing fills into a frame from another site.
- Passkeys match by the site's own rules (WebAuthn relying-party id), enforced by iOS and Chrome.

(`documents/passwords/site.js` `loginMatches` is built and tested; it's used for filling from phase 2.)

---

## 7. Moving in and out

- **Import, first:** iCloud Passwords (`Title,URL,Username,Password,Notes,OTPAuth`) and Google Password Manager / Chrome (`name,url,username,password,note`), told apart by the header (decision 6). Several files at once, or dropped on the page on a laptop. 1Password and Bitwarden formats later if ever needed.
- **Merging:** the same site (registrable domain) and username is one login. Neither export carries dates, so when they disagree iCloud's password wins; the other goes into the login's history and the login is listed under Needs attention ("Two passwords found on import") until Luke compares them and taps **mark it checked**. A login already in Liv keeps its password the same way. Importing the same file twice changes nothing.
- 2FA secrets come across where the export includes them (iCloud's does); passkeys can't be exported from iCloud and stay there.
- Read and encrypted on the device; the app reminds you to delete the CSV afterwards. A dropped export is never stored as a document.
- **Export:** an **encrypted backup** (`.livpw`: Argon2id 64 MiB → XChaCha20-Poly1305, opened again by Import with its passphrase) or a **CSV** in the iCloud layout (with a plain warning), so leaving Apple, or Liv, stays easy.
- Once imported and AutoFill works, turning iCloud Passwords and Chrome's saving off is up to Luke; the app says how, and doesn't do it.

---

## 8. iPhone: AutoFill everywhere (the main piece)

Liv becomes a password source in iOS Settings › General › AutoFill & Passwords, next to iCloud Passwords. It then fills in **Safari and every app**.

- **A new app extension**, `LivAutoFill` (`ASCredentialProviderViewController`), in the App Group.
- **How it gets the key without the web view:** when the Safe is unlocked in the app, the app writes into the App Group:
  - the Logins keys (§4), wrapped by a Keychain key in a **shared access group** with `.userPresence` (Face ID); and
  - an encrypted copy of the logins.
  The extension reads that file, asks for Face ID, decrypts, fills, and forgets. It works offline and never calls Supabase.
- **Suggestions above the keyboard** (decision 8): the app tells iOS which site/username pairs exist (`ASCredentialIdentityStore`), so the right login appears in the QuickType bar. iOS holds those site names and usernames on the phone, never the passwords. Updated after each sync; cleared when the Safe is reset or the device is removed.
- **2FA codes** fill the same way (iOS 18 and later).
- **Passkeys** (decision 9, iOS 17 and later): Liv is offered as the place to save a new passkey, and signs in with it. Existing iCloud passkeys stay in iCloud.
- **Crypto in Swift:** swift-sodium (libsodium), so the format matches the web app byte for byte. CryptoKit lacks XChaCha.
- Saving a new password typed into another app isn't something iOS lets an extension catch; new logins are added in Liv (or by the generator inside the extension, iOS 18).
- **Marijane** (decision 10): the same extension on her phone with Household logins, turned on after the independent review (§11).

---

## 9. Laptop: a Chrome extension

- A Manifest V3 extension for Chrome (Luke's laptop browser); Firefox and Safari later if wanted.
- **Linked like any device:** scan a QR with the phone, which grants it the Logins keys.
- **Unlock** (decision 11): a passkey with Touch ID / the laptop's sign-in, as the web Documents lock, if WebAuthn PRF works inside an extension. Otherwise **approve on the phone**: the extension asks, the phone shows "Unlock passwords on Luke's laptop?", Face ID, and the phone sends a short-lived key sealed to the extension.
- Fills on a tap from its toolbar button or a small key icon in the field; offers to save a new login after a sign-in form is sent.
- **Passkeys** in Chrome: the extension answers a site's passkey request with the passkey from the Safe (asking first). Phase 4, after the iPhone passkeys work.
- Locks after 15 minutes idle and when Chrome closes.
- The Liv web app on the laptop shows Passwords in the Documents sidebar behind its passkey lock (built, phase 1).

---

## 10. The in-app browser, later

- Test first whether iOS offers `LivAutoFill`'s logins inside Liv's own `WKWebView` browser (most likely with the default-browser entitlement, BROWSER_DESIGN §3). If yes, the browser needs no fill code of its own.
- If not: a "Fill from Safe" button in the browser's native toolbar, using the same matching (§6). Small; built with the browser.
- BROWSER_DESIGN §7 points here instead of iCloud Keychain.

---

## 11. Threats, briefly

| Threat | Covered by |
|---|---|
| Supabase or R2 breached | Only ciphertext (§4) |
| Server replays an old row, or moves a row onto another login | Highest `rev` kept per login; the row's context names its id (§4) |
| Phishing look-alike site | Domain matching, raw punycode, tap to fill (§6) |
| Lost or stolen phone | Face ID on every open and every fill; remove the device (rotates keys) |
| A malicious page or app reading what's filled | Fills only the matching site; never into another site's frame |
| Markup in a login's name or notes | Always escaped, shown as text |
| Clipboard snooping | 60-second clear (local-only clipboard in phase 2) |
| Laptop left unlocked | Extension locks when idle; Safe re-locks |
| An AI reading passwords | Never given access (§5) |
| Leak check revealing passwords | Only 5 hash characters leave, padded; match on the device (§5) |
| Losing every device and the code | Personal logins gone, as with Personal Documents. Said plainly at setup |

Because this is the most valuable thing in the app, the crypto, the extension and the matching get an **independent review** before Marijane's logins go in (decision 10; as the word processor's Safe path).

---

## 12. Build order

1. **Passwords in the Safe** — **built 2026-11-22 (§17).**
2. **iPhone AutoFill:** extension, App Group copy, Face ID, QuickType suggestions, local-only clipboard. TestFlight.
3. **2FA codes and passkeys in AutoFill.** TestFlight.
4. **Chrome extension:** linking, unlock (passkey or phone approval), filling, saving, passkeys.
5. **Independent review**, then Marijane's phone.
6. **Browser hook** when the browser is built (§10).

Phases 2–3 are native: TestFlight builds only. The migration and the web pages go out in one batched Netlify deploy, with Luke's OK.

---

## 13. Tests

- **Unit (`test/documents-passwords.test.js`):** the crypto (context binding, derivation, unsafe sites refused, size cap, backup files), matching (subdomains, look-alikes, `co.uk`, private suffixes, IPs, exact host, https-only), TOTP against the RFC 6238 vectors, the generator and strength check, iCloud and Chrome CSV import and the merge rule, Needs attention, the leak check sending only 5 hash characters with padding; end to end against Postgres with row security: Household shared and Personal private, history, a replayed old row refused, a row moved onto another id refused, Recently deleted, move, batched import, and a device removal re-sealing every login (the removed device locked out).
- **Access rules (`test/documents-logins-migration.test.js`):** who can add, read and change; fixed id, scope and author; no hard delete; purge after 30 days only; bad ciphertext refused; the MFA policy; nothing for `anon`.
- **Planted bugs, all caught:** no public-suffix list, Chrome winning the merge, rotation skipping logins, no `rev` check, any URL scheme allowed.
- **Browser QA (`npm run qa:documents-ui`, "Passwords in the Safe"):** at phone width, against PGlite with the real migrations: add with the generator and a 2FA secret, live code, Show / Copy, markup in a name stays text, Needs attention with a stand-in Have I Been Pwned (only 5-character prefixes requested, padded), import of an iCloud and a Chrome export with the merge, mark it checked, Marijane opening Luke's Household login, re-lock on leaving (Face ID asked again), Recently deleted, ciphertext only on the server, no sideways scroll.
- **Still to do:** the format matching between JS and Swift (shared test vectors, phase 2); the Chrome extension's QA (phase 4); a passkey sign-in on a WebAuthn test site (phase 3).

---

## 14. Cost

No new service and no monthly cost. The table is tiny (a few hundred rows); Have I Been Pwned's password range API is free. One new npm dependency, `tldts` 7.5.5 (the Public Suffix List), loaded only with the Safe. The Chrome Web Store has a one-time $5 developer fee, or the extension can be loaded unpacked for personal use.

---

## 15. To verify

- Whether a shared-access-group Keychain item with `.userPresence` can be read from the extension with Face ID (expected yes).
- The extension's memory limit with libsodium loaded.
- WebAuthn PRF inside a Chrome extension (decides passkey vs phone unlock, §9).
- Whether iOS offers a credential provider's logins inside a `WKWebView` (§10).
- ~~How the Personal recovery code covers a new kind of key~~ — answered by §4: the Logins key is derived from the vault key, which the code already restores.
- The current column layout of Luke's real iCloud Passwords and Chrome exports (import them on the device; never uploaded).

---

## 16. Open questions

None left. All seven were answered on 2026-11-21 (§1, decisions 5–11).

---

## 17. Phase 1 — built (2026-11-22)

**Code**
- `documents/crypto/logins.js` — Logins key derivation, `parseLogin`, `encryptLogin` / `decryptLogin`, the `.livpw` backup format. Exported through `documents/crypto/index.js`.
- `documents/passwords/` — `site.js` (matching), `totp.js`, `generator.js` (generator + strength), `transfer.js` (CSV import, merge, export), `checks.js` (Needs attention, the leak check), `library.js` (the data layer: list with changes-since and a cache in the locked store, save with history, batched import, Recently deleted, move, purge), `ui.js` (the pane).
- `documents/server.js` — `logins`, `addLogin(s)`, `updateLogin` (only `enc`, `key_version`, `deleted_at`), `purgeLogin`, `loginKeys` / `rewrapLogin`.
- `documents/vaults.js` — rotation re-seals logins; `highestSeen` counts their versions.
- `documents/ui.js` — the Passwords entry first in the Safe's sidebar; the pane drawn in the library view; its clicks, typing, files and drops; dropped on lock.
- `migrations/2026-11-22-safe-logins.sql` — **not applied yet** (needs Luke's OK).
- `styles.css` — `.pw-*`, theme tokens only.

**Verified:** unit suite 4277 (343 files), node tests, `vite build`, the browser boot check, `qa:documents-ui` 145/145 (twice), the planted bugs in §13.

**Not verified:** anything on an iPhone (Face ID with Passwords open, the clipboard in WKWebView, a site link opening in Safari from the app, Have I Been Pwned from the app's origin) — that needs a TestFlight build once the migration is applied. Luke's real exports.

**Left for later (ISSUES.md):** local-only clipboard (phase 2); passphrase prompts for the backup use the browser's plain prompt; the word-based generator; an older app version editing a login drops fields a newer one added (only matters once `v` changes).
