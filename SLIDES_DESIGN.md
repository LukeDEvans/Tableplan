# Slides — design & plan

Status: **APPROVED (Luke, 2026-11-10: "Approved" — the plan and the §15 defaults).** Nothing built yet. The migration, the `doc-storage` change and the Netlify deploy each still get their own OK. **Building waits** until the spreadsheet is far enough along (see §1), so nothing is built twice. Branch `claude/slides`, cut from `claude/spreadsheet`.

Goal: a Google Slides replacement inside the **Document** page, completing the suite with the word processor and the spreadsheet. New → Presentation opens a full slide editor with themes and layouts, text, images, shapes, tables, charts linked live to your spreadsheets, video and audio, transitions and animations, speaker notes, live co-editing with Marijane, comments, version history, presenting from the laptop or the iPhone (AirPlay) with the phone as a remote, PowerPoint in and out, PDF and per-slide images, a one-time move of existing Google Slides, and the same presentation working in the **Safe**. Built in house: no paid or GPL code.

---

## 0. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Ground rules | **Same as Docs and Sheets:** live co-editing, works in the Safe (encrypted), offline, full editing on iPhone and laptop, version history in R2, built in house (MIT-only libraries). |
| 2 | What it's for | **Not sure yet → a solid general-purpose editor** (family, work, talks all fit). Nothing is tuned to one use. |
| 3 | Presenting | **All of them:** laptop full screen with a presenter view; iPhone over AirPlay with notes on the phone; the phone as a remote for the laptop; and simply sending it (PDF). |
| 4 | Extras in v1 | **Transitions & animations, charts and tables linked live to spreadsheets, templates, video & audio.** Plus, always: themes, layouts, text, images, shapes, lines, speaker notes, comments, version history. |
| 5 | In and out | **Google Slides import, PowerPoint (.pptx) in and out, PDF export, slides as images (PNG).** |
| 6 | Video | **Both:** linked videos (YouTube, Vimeo) by default, which use no storage; **uploads allowed under a cap** (§8), compressed on the device. |
| 7 | Outside sharing | **Export only**, as the word processor (no public links in v1). |

---

## Build status (2026-11-10)

Steps 1–11 of §13 are built (1–9 first; 10–11 once the spreadsheet's charts and Excel landed). Steps 1–9 were built on `claude/slides` (Luke: "Start on 1-9 now"); building started before PR #223 merged, importing the word processor's session / live channel / stores from `documents/editor/` where they are now (a one-line change for each import when they move to `documents/collab/`).

| Step | State |
|---|---|
| 1 Editor core | Built: slides as DOM in a 1920 × 1080 space; text boxes with the word processor's extensions; ~40 shapes, lines and connectors with arrowheads, images (crop, mask, recolour, alt text), groups, snapping guides, align/distribute, stacking, lock, flip/rotate; filmstrip with drag to reorder, sections, skip; per-person undo (each move is a step); copy/paste of items and whole slides; find & replace. |
| 2 Themes & layouts | Built: 12 themes plus Classic, Household and Urban Greens from the app's palettes; colours stored as theme roles; the 11 layouts with placeholders that move and restyle on a layout change. |
| 3 Saving, co-editing, the Safe | Built through the shared session; Safe file type `application/vnd.live.slides`. **Needs the migration** `migrations/2026-11-10-documents-slides-versions.sql` (your OK) before everyday presentations can keep versions. |
| 4 Presenting on the laptop | Built: full screen, keys and clickers, number + Enter, B / W, presenter view window (now, next step, notes, timer, clock), auto-advance and looping. |
| 5 Transitions & animations | Built: 7 transitions, 11 effects, on click / with / after, by paragraph, delays; preview in the editor. |
| 6 iPhone | Built: view first then pencil, filmstrip along the bottom, + to insert, swipe through, Present on the phone; **AirPlay** (`PresentScreen` plugin + `slides-tv.html`) and the **phone as a remote** (presence only). The two native plugins need a TestFlight build to try. |
| 7 Tables, notes, comments, versions | Built: tables with row/column identities, speaker notes, comment threads on slides (with @mentions), version history with a filmstrip preview and restore. |
| 8 Video & audio | Built: YouTube / Vimeo / file links; uploads up to 60 MB (audio 20 MB), compressed to 720p on the iPhone (`VideoCompress` plugin, from Photos). **No `doc-storage` change was needed**: media are stored as the same `i<hash>` parts images use (that function's 70 MB limit). |
| 9 Templates | Built: Blank, Trip recap, Photo album, Family year in review, Business pitch, Project update, Talk or lesson, Party or event; and "Start from one of yours" (a copy). |
| 10 Linked charts & tables | Built (2026-11-10, after the spreadsheet's charts landed): Insert › Chart / Table from a spreadsheet; the chart is the spreadsheet's own (same renderer), worked out by its formula engine on the device; a cached copy shows offline; refreshed when the deck opens, Update and Unlink on the toolbar. A Safe deck lists only Safe spreadsheets, an everyday deck only everyday ones. |
| 11 In & out | Built: **PDF** (slides; slides with notes; handouts 2, 3 with lines, 6 a page) by the print dialog on the laptop, the native PDF plugin on the iPhone. **PNG** of one slide or all (zipped), 1920 or 3840 px on the laptop; a native snapshot on the iPhone (`PresentScreen.snapshot`). **PowerPoint out** (our own writer; checked by opening in python-pptx and LibreOffice). **PowerPoint in** (our own reader with layout/master placeholder inheritance and charts from their saved data; checked on a python-pptx deck and our own files), from + › Open a PowerPoint file and "Edit as a presentation" on kept .pptx files. **Google Slides**: Drive exports each deck as PowerPoint (the read-only Drive scope the Docs connection already has — no new Google setup), brought over through the `gdocs` function in pieces, then the PowerPoint reader. Needs one deploy (your OK); Drive won't export decks over 10 MB (they're told to download the .pptx from Google instead). Not yet: animations and comments in PowerPoint files (both ways); linked charts go out to PowerPoint as pictures. |

Known gaps in what's built (in ISSUES.md): the 2 GB media nudge counts one presentation, not all of them; media no longer used aren't cleaned up yet (nothing is ever deleted, which is safe but uses space); clips can't be trimmed in the app before upload (trim in Photos); on the TV, build animations play as they do on the laptop but have only been checked in a desktop browser.

---

## 1. How it fits, and why the wait

Slides is mostly pieces the other two editors already make:

| Piece | Comes from | Ready? |
|---|---|---|
| Saving, device copy, live channel, version slots, Safe store | word processor (`session.js`, `live.js`, `cache.js`, `store-*.js`, `doc-model.js`) | Built; **moving to `documents/collab/`** after PR #223 merges (SPREADSHEET_DESIGN §1). Slides imports from there. |
| Text editing (fonts, lists, links, colours) inside a text box | word processor's Tiptap setup and formatting extensions | Built |
| Comments (threads in the Y.Doc) | word processor §7 | Built |
| Charts (our own SVG renderer) | spreadsheet §6 | **Not yet** (sheet build step 6) |
| Formula engine to compute a linked chart or table | spreadsheet engine + worker | Built |
| Native PDF render on iPhone | `PdfExportPlugin.swift` | Built |
| OOXML zip read/write | fflate (Excel reader/writer) | Excel part not yet (sheet step 9) |

**So:** this design is ready now; building starts once the shared code has moved to `documents/collab/` (PR #223 merged). The two pieces that depend on unfinished sheet work (linked charts, and the shared OOXML helpers) are scheduled last (§13), so slides doesn't build its own versions of them.

- New code in **`documents/slides/`**, loaded lazily the first time a presentation opens.
- `doc_pfiles.kind = 'slides'` (already allowed by the table since the Documents build). Listed with a slides icon; Safe file type `application/vnd.live.slides`.
- **One migration** (§12): the version-row guard accepts `'slides'` too.
- A new **`slides` agent** in `.claude/agents/` owns `documents/slides/` (CI coverage check).

---

## 2. The presentation's data (Y.Doc layout)

```
"meta"            Map    format version, size (16:9 default; 4:3 and custom), theme id
"theme"           Map    colours (12 roles: text/background dark+light, accent 1–6, link), heading + body fonts
"layouts"         Map    layoutId → { name, placeholders: [{role, box, style}], background }
"slides"          Array  slide ids, in order
"slide:<id>"      Map    layoutId, background, hidden, skip, transition { kind, dir, ms }
"items:<id>"      Map    itemId → { t: type, x, y, w, h, rot, z, flip, lock, …type fields }
"text:<itemId>"   XmlFragment   the rich text in a text box, shape or table cell (Tiptap/y-prosemirror)
"notes:<id>"      XmlFragment   speaker notes, the same editor
"anim:<id>"       Array  build order: { item, effect, start: click|with|after, ms, delay, byParagraph }
"comments"        Map    threads (as the word processor), anchored to a slide and optionally an item
"links"           Map    linked spreadsheet ranges and charts (§6), with a cached copy of their values
"media"           Map    mediaId → { kind: image|video|audio, part, size, poster, duration } or { link: url }
```

**Positions** are in a fixed 1920 × 1080 space (16:9) and scaled to whatever screen shows them, so a slide looks the same on the phone, the laptop and the TV.

**Stacking order** uses fractional keys (`z: "a0V"`), so two people bringing different things to the front merge cleanly. Slide order is a Yjs array of ids: reordering slides while Marijane types on one never loses her typing.

**Placeholders:** a layout's title and body boxes become real items on a new slide that remember their layout role, so changing a slide's layout or the theme moves and restyles them (as Google Slides).

---

## 3. The editor

- **Slides are DOM, not canvas.** Unlike the spreadsheet's 100,000 cells, a slide has a few dozen items, so each is an absolutely placed element in the scaled 1920 × 1080 frame. Text boxes are small Tiptap editors (the word processor's extensions), so typing uses the system keyboard, spell check and dictation, and co-editors' carets show.
- **Item types:** text box; shape (rectangle, rounded, ellipse, triangle, arrows, callouts, stars, ~40 in v1, drawn in SVG, all able to hold text); line and connector (straight, elbow, curved; arrowheads; connectors stick to shapes); image (crop, mask to a shape, recolour, transparency, alt text); table; chart; video; audio; group.
- **Arranging:** drag, resize with handles, rotate, snap guides (to the slide's centre and edges and to other items), smart spacing, align and distribute, bring forward/back, group/ungroup, lock, nudge with arrows. Rulers and gridlines optional.
- **Formatting:** fill (solid, gradient, picture), border (colour, weight, dash), shadow, transparency; text: the curated ~30 fonts, size, bold/italic/underline/strike, colours, highlight, alignment, line spacing, bullets and numbering, autofit (shrink text on overflow) on or off. Paint format.
- **Slides:** new slide from a layout, duplicate, delete, hide, skip, reorder by dragging the filmstrip, change layout, background per slide or for all, section headings in the filmstrip.
- **Undo/redo per person** (Yjs undo manager), so you never undo Marijane's work.
- **Copy and paste** within and between presentations keeps everything; from Google Slides, PowerPoint or the web takes text and images.
- **Find & replace** across slides and notes.

---

## 4. Themes, layouts, templates

- **Themes:** about 12 built in (clean, bold, dark, photo-forward…), plus **themes made from the app's palettes** (Classic, Household, Urban Greens), so a work deck can match the Urban Greens colours with one tap. Edit a theme's colours and fonts per presentation; "Import theme" from another presentation.
- **Layouts:** as Google Slides: Title, Section header, Title and body, Title and two columns, Title only, One column text, Main point, Section title and description, Caption, Big number, Blank. Editable per presentation (a simple layout editor; full master editing later).
- **Templates (decided in v1):** a small built-in set, each a real presentation you can copy: **Blank, Trip recap, Photo album, Family year in review, Business pitch, Project update, Talk / lesson, Party or event.** Kept in the app bundle (no server). Your own presentations can be marked "Use as template" and show up in the same picker.

---

## 5. Transitions & animations

- **Transitions** per slide or applied to all: None, Dissolve, Fade, Slide from right/left/top/bottom, Flip, Cube, Gallery, Zoom; speed slider.
- **Animations** per item: Appear, Disappear, Fade in/out, Fly in/out (four directions), Zoom in/out, Spin, Grow/shrink, plus *by paragraph* for bullets. Start **on click / with previous / after previous**, duration, delay. An animation panel lists the slide's build order; drag to reorder; play to preview.
- Drawn with CSS transforms and the Web Animations API (smooth on the iPhone, no library).
- Videos can be set to play automatically when their slide (or build step) appears.

---

## 6. Charts and tables linked to spreadsheets

- **Insert → Chart → From a spreadsheet:** pick one of your spreadsheets, then one of its charts (or a range, to make a new chart here). **Insert → Table → From a spreadsheet** does the same for a range.
- The slide stores the link (spreadsheet file id, chart or range by **row/column identity**, so it follows the data when rows move) **and a cached copy of the values** in `links`. The cached copy shows instantly, offline, and for anyone who can't open the spreadsheet.
- **Staying current:** when the presentation opens, each link refreshes in the background (the spreadsheet's state is loaded read-only and computed in the sheet's worker), and changed charts update. **Open point 3** (live versus Google's manual "Update" button).
- Charts use the spreadsheet's own SVG renderer and styling, so a chart looks identical in both places. "Unlink" turns it into a plain chart with its last values.
- **The Safe:** a Safe presentation can link to Safe or everyday spreadsheets; an **everyday presentation can't link to a Safe spreadsheet** (it would copy Safe numbers out as plain text). Same for comments' previews.
- Plain tables (not linked) are their own item: rows and columns, merged cells, cell fills and borders, rich text in cells.

---

## 7. Speaker notes, comments, versions

- **Notes** under each slide on the laptop; a notes sheet on the phone. Rich text (the word processor's editor). Searchable.
- **Comments:** as the word processor (threads in the Y.Doc, reply, resolve, @mention → phone notification with sender and file name only), pinned to a slide or an item; a badge on the filmstrip.
- **Versions:** the same slots (hourly a day, daily a month, weekly a year, named forever) in R2. The panel previews a version as a read-only filmstrip with changed slides marked; Restore is undoable. Uploaded media are kept as long as any version uses them (§8).

---

## 8. Images, video and audio (the storage budget)

You want Documents storage free until the home server, and R2's free tier is 10 GB, so heavy media is handled carefully:

- **Images** are resized on the device to at most 2560 px on the long side and saved as their own parts (`i<id>`, as the word processor), each once however many times it's used. Duplicates are found by hash.
- **Linked video** (YouTube, Vimeo, or any https video URL): no storage. Plays in an embedded player while editing and presenting; needs the internet. Start and end times, mute, autoplay. A poster frame is saved so the slide still looks right offline or in a PDF.
- **Uploaded video:** compressed on the device to 720p H.264/AAC (on iPhone with AVFoundation through a small native plugin, TestFlight; on the laptop with WebCodecs, or accepted as is if already small enough). **Cap: 60 MB per clip after compression** (roughly 3 minutes), which fits the storage function's existing 70 MB-per-part limit, so no larger uploads are needed. A longer clip is offered as a link instead. Trimming (start/end) before upload saves space. Stored as a media part (`m<id>`).
- **Audio:** uploaded clips (compressed to AAC, cap 20 MB) or linked. Play on click, automatically, or across slides (background music, stops at a chosen slide).
- **Budget guard:** the Document page shows how much media your presentations use; a gentle warning at **2 GB of slide media** across everything (open point 4), so 10 GB is never a surprise. Media no version or slide uses any more is cleaned up when the presentation is next saved.
- **The Safe:** uploaded media is encrypted like everything else (secretstream, so a long clip can play while it decrypts in chunks). Linked videos in a Safe presentation work but reveal to that site that you're watching it; a small note says so when you add one.

---

## 9. Presenting

**Laptop**
- **Present** fills the screen (Esc to leave); click, arrows, space, Page Up/Down and the usual clickers all work; number + Enter jumps to a slide; B / W for a black / white screen.
- **Presenter view** opens in its own window to drag onto the laptop screen while the slides show on the projector or TV: the current slide, the next build step, notes (resizable text), a timer and clock, slide thumbnails to jump. The two windows stay in step on the same device without any server.
- Present from the current slide or the beginning; "Rehearse" timing; looped auto-play with a seconds-per-slide setting (for a party or a kiosk TV).

**iPhone over AirPlay**
- A small native plugin (TestFlight) notices when the phone is connected to a TV or Apple TV and shows the slides **full screen on the TV** while the **phone shows presenter view** (notes, timer, next slide; swipe or tap the big right-side button to advance, for your right hand). Without AirPlay, Present plays full screen on the phone itself (swipe to advance).
- Videos play on the TV, not the phone.

**The phone as a remote**
- While the presentation is playing on your laptop, opening it on your phone shows **"Control the presentation"**. The phone then shows notes, the timer and next/back buttons; the laptop follows.
- It rides the live channel the two editors already use (`livedoc:<scope>:<file>`, a Realtime broadcast that exists only while someone is present). Each tap is one tiny message; nothing is polled or stored. Works for Marijane's phone too in Household. In the Safe the messages are encrypted like any other live message.

**Sending instead:** PDF export (§10) through the share sheet.

---

## 10. Import & export (on the device unless named)

- **PowerPoint (.pptx) in:** our own reader (fflate unzips; we read the slide XML): slides, layouts and masters (mapped to ours), theme colours and fonts, text with formatting, bullets, shapes (preset geometry mapped to ours, others kept as pictures), images (and their cropping), tables, groups, speaker notes, comments, transitions and the common animations, embedded video and audio. Charts come in as live charts with their own data when the type maps, else as pictures. Anything unsupported is kept as a picture or plain text and listed in a note after import.
- **PowerPoint out:** our own writer, the same list. Linked charts go out as real PowerPoint charts carrying their current values when the type maps (else as pictures); linked videos as their links with the poster; uploaded videos embedded.
- **PDF:** slides only, or slides with notes (one per page), or handouts (2, 3, 6 per page). iPhone: the native PDF plugin (as the word processor); laptop: the browser's print-to-PDF of the same layout. Animations show their final state.
- **Slides as images (PNG):** current slide or all (zipped), at 1920 × 1080 or 3840 × 2160. iPhone: rendered natively from the web view; laptop: drawn to a canvas from the slide's own markup with fonts and images inlined.
- **Google Slides:** the same flow as Docs and Sheets (+ › Bring over Google Slides, pick presentations or folders), read through the **Slides API**, which describes every page element exactly (more faithful than .pptx): layouts, theme, text, shapes, images, tables, lines, videos (YouTube links stay links), speaker notes; linked Sheets charts come in as charts with their last values (and re-link if that spreadsheet was brought over too). Comments from the Drive API. One-time; nothing deleted in Google. Needs the **Slides API enabled and `presentations.readonly` added** to your Google connection, and the `gdocs` Netlify function extended (deploy, your OK).
- **Edit as a presentation** on kept .pptx files, like "Edit as a document".

---

## 11. UI

**Opening:** Document page → **+ → Presentation** (template picker first: Blank is the default and one tap), or Import a PowerPoint file, or Bring over Google Slides.

**Laptop:** Google Slides-style. Title (rename in place) and folder; menu bar (File, Edit, View, Insert, Format, Slide, Arrange, Tools); one-line toolbar that changes with the selection; **filmstrip on the left**; the slide in the middle; **notes below**; side panels on the right for theme, transitions, animations, comments, versions, and the format options of the selected item; **Present** and people in the presentation at top right.

**iPhone:**
- Opens to view (swipe through slides); the pencil (bottom right) to edit.
- Editing: the slide on top, the filmstrip as a scroll row along the bottom; tap an item to select (handles to move, resize, rotate); tap again to type. The **format sheet** has tabs that fit the item (Text / Shape / Arrange, or Image / Arrange…). **+** (right side) inserts: text, image (photos, camera, files), shape, line, table, chart, video, audio. Long-press a slide in the filmstrip for duplicate, delete, hide, layout, transition.
- Animations and the theme are edited in sheets from ⋯; presenter view is the AirPlay screen above.
- Pinch to zoom on the slide while editing.

**General:** the standard clear "x" on every text field; themes and dark mode apply to the app's chrome only (the slides keep their own theme).

---

## 12. Server changes (all gated)

1. **Migration** (your OK): `doc_versions_guard` accepts `kind in ('doc', 'sheet', 'slides')`. A `create or replace function`, no DROP.
2. **`doc-storage` edge function** (your OK; a Supabase function deploy, not a Netlify deploy): accept media parts `m<id>` alongside images `i<id>`, same 70 MB limit. Keep `documents/storage.js` `EDITOR_PART_RE` in step.
3. **Google:** enable the Slides API in the Calendar project; add `…/auth/presentations.readonly` (Testing mode, so no Google review). Connect again in Document.
4. **Netlify:** the `gdocs` function learns presentations (same function, new action). A deploy, your OK; batched with the others.
5. **iPhone plugins** (TestFlight only, no deploy): `PresentPlugin.swift` (the AirPlay screen) and `VideoCompressPlugin.swift` (AVFoundation compression and poster frames).

Nothing new in Supabase beyond version rows; no polling; the remote uses the existing live channel only while presenting.

---

## 13. Build order

Starts after PR #223 merges and the shared code moves to `documents/collab/`. Test without Netlify deploys (TestFlight on the phone, `npm run dev:local` on the laptop); one batched deploy at the end (your OK).

1. **Model & editor core:** the Y.Doc layout, the scaled slide frame, text boxes (Tiptap), shapes, lines, images, groups, arranging and snapping, formatting, filmstrip, undo, copy/paste. New → Presentation in the page.
2. **Themes & layouts:** built-in themes, app-palette themes, layouts with placeholders, layout and theme switching.
3. **Saving, co-editing, the Safe** through `documents/collab/`; the version-guard migration (your OK); Safe file type. Independent review of the Safe path.
4. **Presenting on the laptop:** full screen, presenter view, timing, loop.
5. **Transitions & animations.**
6. **iPhone:** phone editing layout, Present on the phone, the AirPlay plugin, the phone as a remote (TestFlight).
7. **Plain tables, notes, comments, version history.**
8. **Images, video, audio:** linked video, uploads with on-device compression, the media part (edge function, your OK), the budget guard.
9. **Templates.**
10. **Linked charts and tables** — after the spreadsheet's charts exist (sheet step 6).
11. **Import/export:** PDF, PNG, PowerPoint in and out (sharing the OOXML helpers with the spreadsheet's Excel reader/writer, sheet step 9), Google Slides (deploy and Google setup).
12. **Review & QA:** an independent review agent on co-editing merges, the Safe path and import fidelity; the checks below; TestFlight for you and Marijane; the batched deploy.

---

## 14. Tests

- **Unit:** the Y.Doc model (layout changes, theme changes, two people reordering slides / stacking / editing the same text box, offline on both sides); fractional z-order keys; placeholder restyling; animation order logic; link refresh by row/column identity (rows inserted in the source sheet); media de-duplication and cleanup (never removes media a version still uses); .pptx round trips (fixtures made in PowerPoint and exported from Google Slides); Slides API mapping from recorded responses; Safe: every part, media chunk and live message is ciphertext.
- **Browser QA** (Chromium at 390 / 360 px and laptop width, two profiles): build a deck from a template, arrange and format, two people editing the same slide, presenter view in step with the show window, the remote driving another profile's show, transitions and animations, a linked chart updating after its sheet changes, video (linked and uploaded) playing, PDF and PNG export, a Safe presentation stored only as ciphertext.
- **Planted bugs** in the merge, stacking and link rules, as before.
- **Manual (TestFlight):** AirPlay to the Apple TV with notes on the phone, the phone as a remote for the laptop, video compression time and quality on a real clip, phone editing one-handed.

---

## 15. Open points (defaults in bold)

1. **Default slide size 16:9**; 4:3 and custom in File › Page setup.
2. **Uploaded video cap 60 MB per clip after compression (~3 min at 720p)**; audio 20 MB.
3. **Linked charts and tables refresh automatically when the presentation opens** (with a small "updated" note on changed slides). The alternative is Google's way: an "Update" button, so a deck you've finalised never changes on its own.
4. **Warn at 2 GB of slide media** across all presentations.
5. **Imported Google Slides go into a folder of the same name in Personal** (as Docs and Sheets); move to Household after.
6. **Either of you can delete or restore versions in Household.**
7. **Layout editor in v1 edits layouts per presentation; full master editing later.**
8. **Laser pointer and drawing on slides while presenting: later**, not v1.
9. **Live audience Q&A, captions, recording a talk: not in v1.**
