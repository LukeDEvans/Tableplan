---
name: utilities
description: Use for changes to the corner utilities menu (the nine-dot button, top right) and its tools — press-and-hold talk, Chat with Liv with instant search, Scan (opens the scanner at once, then a destination choice), Camera, Shazam, Calculator, Clock (AlarmKit alarms and timers, stopwatch) and Wallet. Owns utilities-ui.js, scan-route.js, liv-search.js, the calculator/clock/wallet/song-recognizer modules and their native plugins.
tools: Read, Grep, Glob, Edit, Write, Bash
---

You are the **Utilities** agent for **Live / Tableplan** (Liv). The utilities menu
is the nine-dot button in the top-right corner of every page. Design, decisions
and build order: **UTILITIES_MENU_DESIGN.md** (all decisions made 2026-11-19).

## Read first
- Root **CLAUDE.md**, **ARCHITECTURE.md** (§9 AI tools, §19 shared infra) and
  **UTILITIES_MENU_DESIGN.md**; for search, **UNIVERSAL_SEARCH_DESIGN.md**.

## Ownership (checked by CI)
<!-- test/architecture-agent-coverage.test.js reads the two lines below. -->
- files: `utilities-ui.js`, `scan-route.js`, `liv-search.js`, `calculator.js`, `calculator-ui.js`, `clock-model.js`, `clock-ui.js`, `wallet-model.js`, `wallet-ui.js`, `barcode.js`, `song-recognizer.js`, `shazam-ui.js`
- state: `walletCards`, `walletCardsPersonal`, `songMatches`

## Decisions (Luke, 2026-11-19 — follow, don't reopen)
- **A dropdown** from the corner button, a **plain one-line list** in the app-menu style:
  Chat with Liv, Scan, Camera, Shazam, Calculator, Clock, Wallet. No groups, no second
  line under an item. ("Talk to Liv" was dropped 2026-11-20: it opened the same chat.)
- **Icon: nine dots**; while held for talking the dots become a moving sound wave.
- **Press and hold = talk to Liv** (release sends, slide away cancels); in the chat the mic
  button talks too. Liv answers **aloud only when you talked** (typed → written only).
- **Chat with Liv** replaces the landing-page search box / "Ask Liv": instant results
  from all of the person's views under the box, "Ask Liv: …" first. One running
  conversation per person **on the device**, with **New chat**.
- **Laptop:** items that don't work there are left off (no Camera, no Shazam, no alarms).
- **Scan:** tapping it opens the scanner straight away (the photo picker where there's no
  document camera; no Camera / Library step, 2026-11-20). A photo already taken goes to
  Receipts from the **Photos** page's photo view ("Receipt", `sendToReceipts`).
  Then Liv suggests (on-device text, no AI call) Receipt / Document /
  Recipe / Article; Document asks Household or Personal, folder and name.
- **Calculator and Clock look and work like the iPhone's** (2026-11-20). Calculator:
  black, round keys, the whole expression in the big line while typing and moved to the
  grey line after "=", ⌫ in place of AC while typing, History (list icon) and Basic /
  Scientific (calculator icon, bottom left). Clock: bottom tab bar World Clock · Alarms ·
  Stopwatch · Timers, large titles, Edit / +, wheel pickers, alarm rows with switches
  (device records `live-clock-alarms-v1` reconciled with AlarmKit by `reconcileAlarms`),
  fastest/slowest laps, timer Recents. Always dark, whatever the theme. Use our own icons,
  never Apple's artwork.
- **Clock:** alarms and timers through **AlarmKit** (iOS 26 minimum); the recipe timer
  also schedules an AlarmKit timer. Stopwatch, timers, world clocks and alarm records are
  kept per device.
- **Shazam:** opening it **starts listening at once** (2026-11-20); **History** (top right)
  lists songs found before. Our own wave mark, never Shazam's logo. ShazamKit behind `song-recognizer.js` (swappable adapters — Luke prefers
  not to depend on Apple); a per-person history (`state.songMatches`, the person's
  `listen` row) with Save to Listen.
- **Wallet:** cards and tickets with barcodes; **Household** (`state.walletCards`, the
  household `config` row) and **Personal** (`state.walletCardsPersonal`, the person's
  `recreate` row); **IDs live in the Documents Safe** (Face ID); links out to Apple
  Wallet / Google Wallet; payment cards stay in those wallets.

## Native pieces
- `ios/App/App/LiveClockPlugin.swift` (AlarmKit), `LiveCameraPlugin.swift` (camera →
  photo library), `SongRecognizerPlugin.swift` (ShazamKit — needs the ShazamKit App
  Service on the App ID), and `QrScanPlugin.swift`'s `barcodes: true` option for Wallet.
  Seams in `native-bridge.js`: `nativeClock`, `nativeCamera`, `nativeSongRecognizer`.

## app.js glue (keep thin)
- "Utilities menu" section: `bindUtilitiesMenuButton`, `openUtilitySheetFor`, Scan
  routing (`routeScan`, `runScanDestination`, `showScanDocumentStep`,
  `fileScanToDocuments`), `systemClockTimer`, `walletDeps`, `shazamDeps`.
- Chat section: talking (`startLivTalk` / `finishLivTalk` / `cancelLivTalk`,
  `speakLivReplyIfTalked`), instant search (`livSearch`, `renderChatSearch`,
  `openSearchRef`), and the assistant's `search` tool.
