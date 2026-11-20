# Utilities menu: the corner button becomes Liv's toolbox

Status: **Plan approved, all decisions made (2026-11-19). All seven steps built 2026-11-19** (§11; branch `claude/utilities-menu`). **Changes after first use, 2026-11-20** in §12. Decisions are in §1. Repo facts come from `main` (2026-11-19).

Goal: turn the scan button in the top-right corner into one menu of utilities: talking and chatting with Liv, Scan, Camera, Shazam, Calculator, Clock and Wallet. Liv works as an operating system with the assistant at its centre, and none of this adds to the landing page.

---

## 1. Decisions (Luke, 2026-11-19)

1. **A dropdown from the corner button** (not a bottom panel).
2. **New icon: nine dots.** While it is held for talking, the dots morph into a sound wave.
3. **Scan** (renamed from the receipt scanner): one scanner, then a choice of where the scan goes, so Documents is as easy to reach as Receipts.
4. **Hold to talk:** pressing and holding the button starts a voice chat with Liv. There is also a "Talk to Liv" item in the menu, so the gesture isn't the only way in.
5. **Chat with Liv** by text from the menu. This **replaces the landing-page search box and "Ask Liv" row** in UNIVERSAL_SEARCH_DESIGN.md: search lives inside the chat (§4).
6. **Camera, Calculator, Clock** (alarms, timers, stopwatch), **Shazam** and **Wallet**, all as proposed.
7. **Shazam:** Apple's ShazamKit is acceptable, built behind a swappable recognizer layer so another service can replace it (Luke prefers not to depend on Apple).
8. **Wallet:** cards, barcodes, tickets and ID photos kept in Liv, **plus links out** to Apple Wallet, Google Wallet or any other wallet app.
9. **Minimum iOS raised to 26** (for AlarmKit). Luke is on iOS 27.2, and Marijane is expected to be too.
10. **Menu look:** a plain list in the current menu's style, with no groups or dividers and **no second line of description** under each item (the current menu's `<small>` lines go). Order: Talk to Liv, Chat with Liv, Scan, Camera, Shazam, Calculator, Clock, Wallet.
11. **Laptop:** items that don't work there are left off the menu: no Camera, no Shazam, and no alarms inside Clock. The laptop menu is Talk, Chat, Scan (upload), Calculator, Clock (timers and stopwatch) and Wallet.
12. **Chat history:** one running conversation per person, kept on the device (not synced), with a **New chat** button.
13. **Voice replies:** Liv answers aloud (app's Apple voice, plus the text) only when you talked to it; a typed chat gets a written answer only.
14. **Wallet storage:** IDs (driver's licence, passport photos) live in the Safe behind Face ID; loyalty/membership cards and tickets are everyday items so a barcode comes up instantly at checkout.
15. **Wallet sharing:** works like Documents: a shared Household wallet (Costco card, memberships, family tickets; Marijane sees it) and a private Personal wallet.
16. **Shazam history:** a per-person list of recognized songs, each with Save to Listen.
17. **Build order:** (1) menu, nine-dot icon and Scan with a destination choice → (2) Chat with Liv with instant search → (3) hold to talk and the sound-wave icon → (4) Calculator and Clock (iOS minimum raised to 26; the recipe timer moves onto the new timers) → (5) Camera → (6) Shazam → (7) Wallet. Steps 1–2 ship by TestFlight, then one Netlify deploy (ask first).

---

## 2. What exists today (findings)

- **The corner button:** `#receiptScannerBtn` (index.html:189) opens `#receiptScannerMenu`, which has two items: *Camera* (take a picture of a receipt) and *Photo* (upload). It already is a dropdown (`app-menu`), so the menu work extends it rather than replacing it.
- **Separate scanners already exist:** receipt (`receipt-scan.js`, `receipt-scan-queue.js`), document (`document-scan.js`), recipe (`recipe-scan.js`), article (`article-scan.js`, the News scan dialog) and booking (`booking-scan.js`). Scan images are stored through `scan-content.js` (content store, never in synced state).
- **Speech is already on the phone:** `language-speech.js` plus the `LiveLanguage` iOS plugin (recognition and recording for Dutch), and the Apple voice and TTS stack (`voice-service.js`, `tts-provider.js`).
- **The in-app assistant** (chat panel, `netlify/functions/chat.js`, `assistant-tools.js`) still exists, though Luke doesn't use it yet.
- **Link-outs to other apps** go through `link-out.js` / `LinkOutPlugin.swift` (APP_LINKS_DESIGN).
- **The recipe timer** lives in `recipes-ui.js`.
- **The iOS minimum is 15.0** (project.pbxproj and Podfile). Raising it to 26 also opens up the separate data stores the browser plan needed (iOS 17).

---

## 3. The menu

```
 [ ⠿ ]  ← nine dots; hold = talk (dots become a sound wave)
 ┌───────────────────────────┐
 │ Talk to Liv               │
 │ Chat with Liv             │
 │ Scan                      │
 │ Camera                    │
 │ Shazam                    │
 │ Calculator                │
 │ Clock                     │
 │ Wallet                    │
 └───────────────────────────┘
```

- **Tap** opens the dropdown. **Hold** (about 0.4 s, with a haptic) starts talking. Releasing sends; sliding off the button cancels.
- Each utility opens as a **full-screen sheet over the current page**. Closing it returns to where you were. None of them are pages in the landing list or the page menu.
- **Laptop:** phone-only items (Camera, Shazam, alarms) are left off (§1.11). ⌘K / Ctrl-K opens Chat.

---

## 4. Liv: talk and chat

- **Chat** opens a sheet with a message box. As you type, **instant results** from universal search appear under the box (UNIVERSAL_SEARCH_DESIGN.md phases 1–3). The top row reads **"Ask Liv: …"**, and pressing Return asks it. Tapping a result opens that item.
- **Talk:** speech becomes text on the phone (Apple's on-device recognition, the same as the Dutch practice), goes to the same conversation, and Liv answers **aloud in the app's Apple voice** as well as on screen. A typed chat gets a written answer.
- **What Liv knows:** the page you were on when you opened it, plus the universal `search` tool and the existing typed tools (ARCHITECTURE.md §9). Confirmation before outward or destructive changes, and Undo, as now.
- **Effect on UNIVERSAL_SEARCH_DESIGN.md:** phases 1–3 stand (search layer, liv-mcp search, open-item links, assistant `search` tool). Phase 4 changes from "landing field" to "instant results inside Chat". The browser's launch-screen search-field rule only matters if the browser is ever built.

---

## 5. Scan

1. **Scan → camera or library** (the two existing choices move inside Scan).
2. Liv reads the image and **suggests where it goes**: Receipt · Document (with a folder, Receipts by default for receipts) · Recipe · Article · Booking (trip). One tap confirms, or you pick another.
3. Each destination runs its existing pipeline (`receipt-scan`, `document-scan`, `recipe-scan`, `article-scan`, `booking-scan`).
4. A receipt can go to **both** Receipts (Finance/Shop) and a Documents folder, keeping the existing Receipts folder rule (DOCUMENTS_DESIGN).

---

## 6. Camera, Calculator, Clock

- **Camera:** opens the iPhone's own camera and saves to the photo library, which then reaches the Photos page through its normal sync. No camera of our own.
- **Calculator:** built in-house as a basic calculator with a history tape. It's pure web, so it works on the laptop too.
- **Clock:**
  - **Alarms** use AlarmKit (iOS 26+): full-screen and ringing through Focus and silent mode, set per person, ringing on that person's phone.
  - **Timers** also use AlarmKit (Lock Screen and Dynamic Island). The **recipe timer moves onto these**, so a cooking timer is a real timer.
  - **Stopwatch** runs in the app.

---

## 7. Shazam

- A **recognizer layer** with one job: listen for a few seconds and return title, artist and IDs (`song-recognizer.js` plus a native piece). The first adapter is **ShazamKit** (free; an Android version exists). Paid services such as AudD or ACRCloud can be added as adapters later, the same pattern as the Scores providers.
- Result card: song, artist, artwork, then **Save to Listen** (Apple Music ID → the music library), **Play**, and **Find in Watch** when it comes from a film or show (later).
- A history of recognized songs, kept per person, each with Save to Listen (§1.16).

---

## 8. Wallet

- **Items:** membership and loyalty cards (barcode or QR shown full-brightness for scanning), tickets, and ID photos (front and back).
- **Links out:** an **Open Apple Wallet** button on iPhone, and Google Wallet or any other wallet app elsewhere, through `link-out.js`. A ticket that comes as a `.pkpass` file gets **Add to Apple Wallet**. Payment cards stay in Apple or Google Wallet, since only those can pay at a terminal. *Check:* opening Apple Wallet directly uses an undocumented link. If it fails, the button falls back to Apple's Wallet web page.
- **Storage:** IDs in the Safe (DOCUMENTS_DESIGN §3, Face ID on open); cards and tickets as everyday records (§1.14).

---

## 9. Open questions

None. All were answered on 2026-11-19 (§1.10–§1.17).

---

## 10. Not planned

- A camera of our own, or Live Photo/RAW capture.
- Paying from Liv's Wallet.
- Putting the utilities on the landing page or in the page menu.

---

## 11. What's built (2026-11-19, branch `claude/utilities-menu`)

All seven steps are written and checked in a browser; the iPhone parts need a TestFlight build to try.

- **Menu:** `#utilitiesBtn` (nine dots → sound wave while held) and `utilities-ui.js` (`bindUtilitiesMenu`, `openUtilitySheet`). Tap opens the list; hold 0.42 s talks; sliding 60 px away cancels. ⌘K / Ctrl-K opens Chat.
- **Scan:** Scan → Camera / Photo library (straight to the library when there's no document camera). The phone reads the text and `scan-route.js` suggests **Receipt, Document, Recipe or Article**; one tap runs the existing pipeline. Document asks Household/Personal, folder and name, and files a PDF tagged `scan`. A receipt still lands in the Receipts folder as before.
- **Chat with Liv:** the old chat panel, renamed, with **New chat** (no confirm) and instant results under the box from every view (`liv-search.js`), "Ask Liv: …" first. The in-app assistant has the `search` tool, and the chat prompt tells it to search first (server change: needs the Netlify deploy).
- **Talk to Liv:** speech through the `LiveLanguage` recognizer in English (the Dutch plugin), the words shown as you speak, sent on release; the reply is spoken only when you talked.
- **Calculator:** `calculator.js` (no `eval`; phone-style %), keyboard on a laptop, tape on the device.
- **Clock:** Alarms (iPhone only) and Timers through AlarmKit (`LiveClockPlugin.swift`), Stopwatch in the app; timers on a laptop beep in the page. **The recipe timer also schedules an AlarmKit timer.** iOS minimum is now **26.0**.
- **Camera:** `LiveCameraPlugin.swift` opens the iPhone camera (photo or video) and saves to the photo library.
- **Shazam:** `song-recognizer.js` (swappable adapters) + `SongRecognizerPlugin.swift` (ShazamKit). History per person (`state.songMatches`, recreate section), Save to Listen (Apple Music ID → the music library) and Play.
- **Wallet:** Household (`state.walletCards`, config) and Personal (`state.walletCardsPersonal`, recreate); Code 128 and QR drawn in-house (`barcode.js`); scan a card's barcode with the camera; Open Apple Wallet / Google Wallet; a link to the Safe for IDs.

No database migration: every new key sits in an existing section.

**Not done / different from the plan**

- **Booking** isn't a Scan destination yet (it needs a trip to go into).
- **No haptic** on hold: the app has no haptics plugin yet.
- **Timers ring as AlarmKit alerts at the end time**; there's no countdown on the Lock Screen / Dynamic Island yet (that needs a Live Activity widget extension).
- **Wallet:** no `.pkpass` "Add to Apple Wallet" and no ID photos in Wallet itself (IDs stay in the Safe). A scanned PDF417 or Aztec code is redrawn as a QR code, which some scanners won't accept.
- **Shazam's "Find in Watch"** is left for later.
- **Chat history** stays on the device as decided, but the existing history log still records chat turns on the server (`logChatTurns`); see ISSUES.md.
- **Luke's step:** turn on the **ShazamKit** App Service for the app's identifier in the Apple Developer account, or Shazam returns an error.

---

## 12. Changes after first use (Luke, 2026-11-20; branch `claude/utilities-polish`)

- **"Talk to Liv" is gone from the menu.** It opened the same chat as "Chat with Liv". Chat
  stays because it covers both: type, or tap its mic. Pressing and holding the nine-dot
  button still talks straight away. Menu: Chat with Liv, Scan, Camera, Shazam, Calculator,
  Clock, Wallet.
- **Scan opens the scanner at once** (no Camera / Photo library step). With no document
  camera (laptop, web) it opens the photo picker. The destination choice after the scan
  is unchanged.
- **Photos → Receipts:** the Photos page's photo view has a **Receipt** button (iPhone,
  photos only) that sends the full-size photo to the receipt scanner, filed in Document ›
  Receipts as a scan is.
- **Calculator looks and works like the iPhone's:** black screen, round keys (grey numbers,
  lighter grey functions, orange operators); the whole expression in the big line while
  typing, moved to the small grey line after "="; the line shrinks to fit, then wraps;
  ⌫ in place of AC while typing; History behind the list icon (top left; tap a line to
  reuse its result, Clear); the calculator icon (bottom left) switches Basic / Scientific
  ((, ), x², x³, √x, 1/x, π, e).
- **Clock looks and works like the iPhone's:** tab bar along the bottom (World Clock ·
  Alarms · Stopwatch · Timers; no Alarms on a laptop), large titles, Edit and +, orange
  accents, always dark.
  - **World Clock** (new): cities with their time and "Today, +7HRS"; + picks a city.
  - **Alarms:** rows with switches; the editor has a wheel time picker, Repeat (Every
    Monday…) and Label, and Delete Alarm. Switching off cancels the AlarmKit alarm but
    keeps the row; a one-time alarm that has rung shows as off. Rows are device records
    (`live-clock-alarms-v1`) reconciled with AlarmKit's list each time Clock opens.
  - **Stopwatch:** big digits, grey Lap/Reset and green Start / red Stop round buttons,
    the running lap on top, fastest lap green and slowest red.
  - **Timers:** wheel picker (hours, min, sec), Cancel / Start, a Label; running timers
    as rows with a progress ring round pause/resume; **Recents** to start a past
    duration again; + adds another while one runs.
- **Shazam starts listening as soon as it opens.** The big button stops or listens again;
  **History** (top right) lists songs found before, each with Save to Listen and Play.
  Liv's own wave mark, not Shazam's logo.
- Icons are Liv's own drawings throughout; nothing of Apple's or Shazam's artwork is used.
- Client only: no database or server change. Reaches the iPhone by TestFlight.
