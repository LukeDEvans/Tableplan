# Word processor — design & plan

Status: **BUILT, not deployed** (decisions from Luke, 2026-11-08; built overnight 2026-11-08/09 on branch `claude/word-processor`, PR #223). On TestFlight for Luke's review. What's built, what differs from this plan and what's left: §17–§19. Builds on DOCUMENTS_DESIGN §25: everyday files already have a `kind` (`doc` reserved) and a `content` part in R2.

Goal: a Google Docs replacement inside the **Document** page. New → Document opens a full editor with most of Docs' formatting, live co-editing with Marijane, comments and suggestions, version history, pages or pageless, Word/PDF in and out, a one-time move of existing Google Docs, and the same editor working inside the **Safe** (end-to-end encrypted).

---

## 0. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Page layout | **Pages by default, Pageless toggle per document** (as Docs). |
| 2 | Editing together | **Live co-editing** with cursors, built in from the start. |
| 3 | Extras in v1 | **Comments & suggestions, version history, Word/PDF import & export, Google Docs import.** |
| 4 | Version history cost | Must not strain Supabase or Netlify (Luke's concern): snapshots in **R2**, thinned over time (§6). |
| 5 | iPhone | **Full editing on phone and laptop.** |
| 6 | Fonts | **Curated ~30** (Docs' default list plus a few). |
| 7 | Safe | **Editor works in the Safe from the start**, encrypted. |
| 8 | Offline | **Yes**, merges when back online. |
| 9 | Outside sharing | **Export only** (PDF/Word through the share sheet). No links in v1. |
| 10 | Google import | **Connect Google Drive**, pick docs or folders in the app. |
| 11 | Smart chips | **Yes, tied into Live**: people, dates, documents, recipes, events, trips. |
| 12 | Templates, AI help, voice typing | **Not in v1.** |

---

## 1. Engine

- **ProseMirror** (MIT) through **Tiptap's open-source core** (MIT) for the schema, commands and keyboard handling. Works in vanilla ESM; no React.
- **Yjs** (MIT) + `y-prosemirror` for co-editing, offline merging, cursors and history. One Y.Doc per document holds the body, headers/footers, footnotes and comments.
- **Tiptap's paid platform is not used.** Its comments, document history, pagination, DOCX conversion and tracked changes all need Tiptap Cloud or a paid add-on; each is built here instead (§5–§9). This is the bulk of the work and why phases are split.
- Loaded **lazily** the first time a document opens (estimate ~300 KB gzipped). On the iPhone it's bundled in the app, so no Netlify bandwidth.

---

## 2. Formatting (Docs parity list)

**Text:** font family (§10), size (incl. typed sizes, +/−), bold, italic, underline, strikethrough, text colour, highlight colour, superscript, subscript, change case (UPPER / lower / Title), clear formatting, paint format.

**Paragraph:** styles (Normal, Title, Subtitle, Heading 1–6) with "Update to match" and "Save as my default styles"; align left/centre/right/justify; line & paragraph spacing (single, 1.15, 1.5, double, custom; space before/after; keep with next; keep lines together); indents (increase/decrease, first-line, hanging) with a ruler on the laptop; page break before.

**Lists:** bulleted, numbered (multilevel, Docs' list styles, restart/continue numbering), checklists (strike when checked, as Docs).

**Insert:** image (upload, camera on the phone, from Document; inline / wrap / break text; resize, crop, rotate, alt text), table (insert grid, add/remove rows and columns, merge/split cells, cell colour, borders, column widths, header row repeats on each page), link (with preview card), horizontal line, page break, special characters, emoji, equation (KaTeX), footnote, bookmark, table of contents (links or page numbers), smart chips (§11), date.

**Tools:** find & replace (match case, regex), word count (with "show while typing"), spell check (the system's own, on phone and laptop), document outline sidebar, undo/redo per person (Yjs undo manager, so you never undo Marijane's typing).

**Page setup** (Pages mode): Letter (default) / A4 / Legal / custom, portrait/landscape, margins, page colour; headers and footers (different first page, different odd/even), page numbers (position, start at).

**Later (not v1):** columns, watermark, drawings, citations, right-to-left text, tab stops. Columns and tab stops are the hardest to combine with pages; noted, not promised.

---

## 3. Data & storage

Everyday documents use the existing tables (DOCUMENTS §25) with `kind = 'doc'`:

- **`content` part in R2** = the Yjs state (compressed). The only copy of the document.
- **`doc_pfiles` row** = name, dates, `body_text` (plain text for search), size. `body_text` is written **at most once every few minutes while editing and on close**, never per keystroke.
- **Images** = their own parts in R2 (`img/<id>`), referenced by id from the document.
- **New table `doc_pversions`** (tiny rows: file id, R2 part name, created_at, author, optional name) for version history (§6). Same access rules as `doc_pfiles` (`doc_can_access`), explicit grants, no DELETE (purged with the file).

**Saving:** each device keeps the document in IndexedDB (`y-indexeddb`) so it opens instantly and works offline. It writes the merged state to R2 a few seconds after you stop typing and on close, using a **conditional PUT** (only if R2 still holds the version it last read). On a clash it downloads, merges (Yjs merges never conflict) and writes again. Bytes go straight to R2 with presigned URLs from `doc-storage`, as files do today.

**Cost:** a text document's state is typically tens of KB; R2 has no download charges. Supabase sees one small row update every few minutes per open document.

---

## 4. Live co-editing

- **Transport: Supabase Realtime broadcast** on a channel per document, **only while two or more people have it open** (Presence tells each device). Edits are batched (~4 per second while typing). Nothing touches Postgres; no polling.
- Cursors and selections in each person's colour with their name; avatars in the top bar.
- **Alone or offline:** no channel traffic; edits merge on the next save or the next time the other person joins.
- **Egress:** small binary updates, only while you're both in the same document. An hour of co-typing is a few thousand messages, a small fraction of the plan's monthly Realtime allowance. A guard closes the channel when the tab or app goes to the background.

---

## 5. Pages mode

- A layout pass on the device measures each block and lays the document onto pages of the chosen size, with gaps, headers, footers and page numbers drawn between them. A paragraph that crosses the bottom of a page continues on the next (split at a line), tables split between rows (header row repeated), images move whole.
- Only the pages near what you're looking at are re-measured while typing, so long documents stay fast.
- **Pageless** turns the pass off: continuous width-limited text, wide tables scroll sideways, no headers/footers (kept, just hidden, like Docs).
- **Footnotes** sit at the bottom of their page in Pages mode and at the end in Pageless.
- On the phone, Pages mode shows the page scaled to fit the width (as Docs' "Print layout"); pinch to zoom.

---

## 6. Version history (cheap by design)

- **Snapshots, not a log.** While a document is being edited, a compressed snapshot is saved **at most every 15 minutes of editing and on close** (only if something changed), into R2 as `ver/<timestamp>`, with a tiny `doc_pversions` row.
- **Thinning (as built):** snapshots go into fixed **slots** that are overwritten when they come round again: one per hour for the last day (h00–h23), one per day for the last month (d01–d31), one per week for the last year (w00–w52). **Named versions** ("Signed copy") are kept forever. Nothing is ever deleted to thin the history, so there's no thinning job at all, and a document can never hold more than ~108 automatic snapshots.
- **Size:** a snapshot of a typical document is tens of KB; a heavily edited one might reach a few MB of history over years, inside R2's free tier. Nothing in Supabase but the rows.
- **Viewing:** a side panel lists versions grouped by day with who edited; pick one to see it with changes highlighted against the current one; **Restore** makes it the current document (itself a new version, so restoring is undoable).

---

## 7. Comments

- Stored **inside the Y.Doc** (a map of threads), anchored with Yjs relative positions so they stay attached as text moves. They therefore sync live, work offline and are encrypted in the Safe with no extra plumbing.
- Margin cards on the laptop; a comments sheet on the phone. Reply, edit your own, resolve/reopen, delete; @ mention the other person (→ a phone notification through the existing notifications, sender and document name only).
- Resolved threads are kept and viewable (as Docs).

---

## 8. Suggestions (track changes)

- An **Editing / Suggesting / Viewing** switch, as Docs. In Suggesting, typing becomes marked insertions and deletions (formatting changes too) with author and time, shown in the person's colour with a margin card.
- Accept / reject one, or all; a suggestion can carry a comment thread.
- This is the hardest piece of the editor (every kind of edit has to be turned into a suggestion correctly). Built and tested on its own, with a separate review agent, before it ships.

---

## 9. Import & export (all on the device; no new server code)

- **Word (.docx) import:** unzip and read the Word XML directly (JSZip), mapping styles, fonts, colours, lists, tables, images, headers/footers, footnotes, page setup and comments; Word tracked changes come in as suggestions. Anything unsupported is kept as plain text and listed in a note after import.
- **Word export:** the `docx` library (MIT), including comments and suggestions as Word revisions.
- **PDF export:** the Pages layout printed as is: on the iPhone through a native PDF render of the page (small plugin change, TestFlight); on the laptop through the browser's print-to-PDF of the same layout. Pageless documents are paginated for export.
- **Google Docs import:** adds Drive (read-only) and Docs (read-only) access to your existing Google connection. In the Document page: Import → Google Drive → pick documents or folders (folders keep their names as Document folders). Each doc is read through the **Docs API** (exact styles, lists, tables, images, headers/footers, footnotes), which is more faithful than converting to .docx first; comments come from the Drive API and are re-attached to their quoted text where it still matches. Runs from your device straight to Google, a few at a time, with a progress list and a retry for any that fail. It's a one-time move, so nothing keeps syncing afterwards.
- The Google consent screen will show the new access. Your app is in Google's testing mode, which allows it for you and Marijane; if you ever take it out of testing, Drive read access needs Google's review. Check against GOOGLE_CALENDAR_SYNC_DESIGN at build time for where the Google token lives.

---

## 10. Fonts

Curated list: Arial, Times New Roman, Georgia, Verdana, Courier New, Comic Sans MS, Trebuchet MS, plus Google Fonts: Roboto, Open Sans, Lato, Montserrat, Merriweather, Lora, Playfair Display, Source Serif, Source Sans, Inter, Nunito, Raleway, Poppins, EB Garamond, Libre Baskerville, Crimson Pro, Caveat, Pacifico, Oswald, Roboto Mono, Fira Code, Noto Sans, Work Sans, Dancing Script. Final list to tweak once you see them.

- System fonts cost nothing. Google Fonts load from Google's CDN **only when a document uses one**, and are cached for offline. On the iPhone the curated set ships in the app.
- Imported documents using a font outside the list keep its name (shown in the menu as "in this document") and fall back to the closest font.

---

## 11. Smart chips

- Type **@** for a menu: people (you, Marijane, Contacts), dates, other documents, recipes, calendar events, trips, more later.
- A chip shows the item's current title and opens it in its page (a recipe opens in Meal Plan, an event in Calendar). If the item is deleted, the chip shows its last known title, struck through.
- A chip stores only type + id + last title, so documents stay small. In the Safe, a chip's title is encrypted with the document; Safe documents can't be @-mentioned from everyday documents (the list never shows Safe contents outside the Safe).

---

## 12. The Safe

Same editor, same features. What changes:

- The Y.Doc state, snapshots, images and Realtime updates are **encrypted with the document's file key** (DOCUMENTS §3–4) before they leave the device. R2 and Supabase only ever see ciphertext; Realtime relays ciphertext between your devices (and Marijane's in the Household Safe).
- Merging happens on the devices, as it already does for everyday documents, so encryption doesn't change how co-editing works.
- Search uses the encrypted `text` part, written on close (as scans are).
- Face ID still guards every open; a document open in the Safe closes when the Safe locks, after its last save finishes.
- Not in the Safe: Google import and outside smart-chip lookups beyond Safe items. Import into the Safe = import as everyday, then Move.

---

## 13. UI

**Opening:** Document page → **+ → Document** (or Import). A document opens full screen over the page; the back arrow returns to the folder it came from.

**Laptop:** Docs-style: title (rename in place) and folder breadcrumb; menu bar (File, Edit, View, Insert, Format, Tools); one-line toolbar; outline sidebar on the left; comments and version panels on the right; ruler in Pages mode; mode switch (Editing / Suggesting / Viewing) and the people in the document at top right.

**iPhone:**
- Opens in reading view; tap the pencil (bottom right, for your right hand) to edit.
- Above the keyboard, a toolbar bar with the most-used actions on the **right**: **A** (text & paragraph sheet), insert (+), comment, undo/redo, hide keyboard.
- The **A** sheet has Text and Paragraph tabs, like Docs' mobile app.
- Everything else lives in the ⋯ menu: page setup, Pages/Pageless, version history, suggest mode, find & replace, word count, export/share.
- Selections get a small floating bar: bold, italic, link, comment, suggest.

**General:** every text field (find, font size, link, comment) has the standard clear "x". Themes and dark mode apply to the chrome. The page itself stays white in Pages mode (as Docs), and follows the theme in Pageless.

---

## 14. Build order

Test without Netlify deploys: TestFlight on the phone, `npm run dev:local` on the laptop; one batched deploy at the end (your OK).

1. **Editor core (Pageless):** schema, all of §2 except page setup, laptop toolbar and menus, phone toolbar and sheets, fonts, images, tables, find & replace, word count, smart chips, IndexedDB + R2 saving with offline. New → Document in the page.
2. **Co-editing & the Safe:** Realtime transport, presence and cursors, conditional saves, then the encryption layer and Safe documents. Independent review of the Safe path.
3. **Pages mode:** layout pass, page setup, headers/footers, page numbers, page breaks, footnotes, table of contents.
4. **Version history:** snapshots, thinning, panel, compare, restore, named versions.
5. **Comments, then suggestions** (suggestions with their own review agent).
6. **Import/export:** .docx in and out, PDF (native plugin → TestFlight), Google Drive import.
7. **QA & deploy:** the full checks below, a TestFlight build for you and Marijane, then the batched Netlify deploy.

A `wordproc` agent in `.claude/agents/` owns `documents/editor/` (CI agent-coverage check).

---

## 15. Tests

- **Unit:** every command and mark; Yjs merges of concurrent edits (incl. offline both sides); conditional-save clash; thinning rules; comment anchors surviving edits; every suggestion case (insert, delete, format, across paragraphs, in tables, accept/reject); .docx round trips (Word fixtures and Google exports); Docs API mapping with recorded responses; encryption of every part and message in the Safe.
- **Browser QA** (Chromium at 390 / 360 px and laptop width, two profiles): co-editing with cursors, offline edits merging, Pages layout with a 50-page fixture, comments between two people, suggestions accepted by the other, restore a version, import and export, Safe doc with Face ID stand-in.
- **Planted bugs** for the merge, save, encryption and suggestion rules, as in the Documents work.
- **Manual (TestFlight):** phone toolbar with the keyboard, typing speed in a long doc, PDF export, co-editing between your phone and Marijane's.

---

## 16. Open points (defaults in bold)

1. **Default page size: Letter, 1" margins.**
2. **Snapshot timing: every 15 minutes of editing + on close; thinning as §6.**
3. **Who can delete/restore versions in Household: either of you.**
4. **Imported Google Docs go into a folder of the same name in Personal**; move to Household after.
5. **Docs left after import:** nothing is deleted in Google; you clear Drive yourself when happy.


---

## 17. What's built (2026-11-09)

Branch `claude/word-processor` (PR #223, draft). Everything under `documents/editor/` unless named.

| Piece | Files |
|---|---|
| Schema: every format in §2 except those in §19 | `extensions.js` (attributes checked before they reach style/href), `fonts.js` |
| The document's data: stored form, merge-then-save, settings, version slots, comment threads, restore | `doc-model.js` |
| One open document: load (device copy, then R2), save, device copy, live channel, snapshots | `session.js`, `cache.js` |
| Everyday storage / Safe storage | `store-everyday.js`, `store-safe.js`, `../crypto/editor-parts.js` |
| Live co-editing over Realtime private broadcast | `live.js`; app.js `openLiveDocChannel` |
| Pages mode (layout pass, gaps, page layer with headers/footers/page numbers) | `pages.js`, `editor.js` (`drawPages`) |
| Suggesting mode, accept/reject | `suggest.js` |
| Comments, version history, outline, dialogs | `panels.js` |
| Images, table of contents, chips, footnotes list, find & replace, @ menu | `nodeviews.js` |
| The editor UI (laptop menus + toolbar, phone reading view, keyboard bar, sheets, bubbles) | `editor.js`, `editor.css`, `icons.js` |
| Word in / out, PDF, Google Docs | `docx-import.js`, `docx-export.js`, `pdf-export.js` (+ `ios/App/App/PdfExportPlugin.swift`), `gdocs-import.js`, `netlify/functions/gdocs.js` |
| Document page entry points (+ menu: New document, Upload, Open a Word file, Bring over Google Docs; "Edit as a document" on .docx files; a document opens in the editor) | `host.js`, `../page.js`; Safe: `../ui.js` (New document button), `../library.js` `docKey` |

**Server side (done tonight):**
- `migrations/2026-11-09-documents-editor.sql` **applied** (Luke's OK, 2026-11-08 23:20): `doc_pversions`, `doc_sversions`, `doc_versions_guard`, two policies on `realtime.messages` for `livedoc:` channels. Checked: row security on, no anon, no DELETE for signed-in users, recorded as `20261109053000 documents_editor`.
- `doc-storage` **redeployed (v7)**: accepts version-slot parts (`vh07`, `vd09`, `vw31`, `vn<hex>`) and images (`i<hex>`) in both tiers. Nothing else changed in it.

**Choices made while building (tell Luke):**
- **Phone opens reflowed**, as the Docs app does with Print layout off; ⋯ › Print layout shows the pages (remembered on that phone). The laptop opens in pages.
- **Version history uses fixed slots** (above) instead of thinning.
- **Footnotes are listed at the end of the document** (in both modes), not at the bottom of each page.
- **Tables longer than a page split between rows** (the row that crosses moves to the next page); a single row taller than a page runs over.
- **Laptop PDF** goes through the browser's print dialog (Save as PDF). The iPhone makes a real PDF file (new plugin, needs this TestFlight build).
- **Safe documents** get people and dates in the @ menu but no other Live items (so nothing outside the Safe is looked up from inside it), and no Google import (import as everyday, then move).

**Verified:**
- Unit: `test/documents-editor-model.test.js` (stored form, merges incl. offline both sides, a lost write repaired, delete-only changes, settings clamped, slots, comments, suggestions incl. accept/reject), `-live` (two people converge, late joiner, cursors, ciphertext only with the Safe's hooks, big updates in pieces), `-docx` (Word round trip of formatting, lists, tables, footnotes, footer page number, page setup, comments, suggestions; junk refused; script links dropped), `-gdocs` (Docs API mapping, comments re-attached), `-safe` (every Safe piece is ciphertext bound to file and place), `-migration` (version rows and channels: Luke, Marijane, coworker, stranger, anon), edge function parts, `documents-everyday` (a purged document takes its versions and images with it).
- Browser: `npm run qa:docs-editor` — 51 checks in Chromium (formatting, styles, fonts, sizes, colour, lists, tables, saving, pages with no text in a gap or margin, Pageless, page numbers, find & replace, comments, suggestions, two people editing live and accepting each other's suggestions, named version + preview + restore, @ chips, footnotes, word count, Word and text export, closing keeps a version, phone at 390 and 360 px). `npm run qa:documents-ui` — 120 checks, now including New document, reopening, a Word file opened as a document, and a Safe document stored only as ciphertext.
- Full unit suite and the boot check pass.

**Not verified (needs the phone or a deploy):** the iPhone keyboard bar against the real keyboard, the native PDF, Realtime itself (the private-channel policies are checked in PGlite; the live path in the browser QA uses a stand-in), Google Docs import against Google (needs the Netlify deploy and the Google setup in §18).

## 18. Google Docs import — Luke's setup steps

1. Google Cloud console → the project that holds the Calendar OAuth client → **APIs & Services › Library** → enable **Google Drive API** and **Google Docs API**.
2. **OAuth consent screen › Data access (Scopes)** → add `…/auth/drive.readonly` and `…/auth/documents.readonly`. The app stays in Testing mode (you and Marijane are test users), so no Google review is needed.
3. The `gdocs` Netlify function and the `gcal-auth ?docs=1` change need **a Netlify deploy** (your OK).
4. Then in Document: **+ › Bring over Google Docs › Connect Google Docs** (Google asks once more, now including Drive and Docs read-only), pick documents or folders, **Bring over**.

## 19. Not built yet / later

- Version **compare highlighting** (the preview shows the version; changes aren't marked yet).
- **Ruler** and tab stops; **columns**; watermark; drawings (as planned for later).
- Paragraph **"Update to match" / "Save as my default styles"**; keep-with-next / keep-lines-together are stored and exported to Word but not yet used by the page layout.
- **@mention notifications** in comments (the mention is recognised; no push is sent yet).
- **Image resize by dragging** (buttons for smaller / larger / full width instead) and an interactive crop (sliders instead).
- Safe: a purged Safe document leaves its version and image blobs in R2 (sealed; harmless, small) — ISSUES.md.
