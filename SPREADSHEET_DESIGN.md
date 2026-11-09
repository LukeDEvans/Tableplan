# Spreadsheet — design & plan

Status: **APPROVED (Luke, 2026-11-09: "Everything here has my approval" — the plan, §14 defaults, the migration and the scratch Google Sheet), being built.** The Netlify deploy still gets its own OK. Branch `claude/spreadsheet`, built on top of the word processor (`claude/word-processor`, PR #223), whose saving, version history, live co-editing and Safe encryption it reuses.

Goal: a Google Sheets replacement inside the **Document** page. New → Spreadsheet opens a full spreadsheet with Sheets' formulas and formatting, live co-editing with Marijane, charts, filters, rules on cells, pivot tables, comments, version history, Excel/CSV/PDF in and out, a one-time move of existing Google Sheets, and the same spreadsheet working inside the **Safe**. Everything is built here: no paid or GPL code.

---

## 0. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Ground rules | **Same as the word processor:** live co-editing, works in the Safe (encrypted), works offline, full editing on iPhone and laptop, version history in R2. |
| 2 | Formula engine | **Built in house, MIT-only** (Luke: "the most complete spreadsheet editor possible… keep the whole thing in house, even if it is more work"). Not HyperFormula (GPL-3.0-only: blocks the App Store and closed source), not Univer (its co-editing needs a paid server). |
| 3 | Extras in v1 | **Charts, filters & sorting, rules on cells (conditional formatting + data validation), pivot tables.** Plus, always: multiple tabs, freezing, number formats, merged cells, comments. |
| 4 | In and out | **Excel (.xlsx) in and out, CSV in and out, bring over Google Sheets, PDF export.** |
| 5 | Libraries | Only MIT (or similar) code we can read and fix: Yjs (already in), fflate (already in, for .xlsx zips), formula.js function bodies **copied in** (MIT, with its notice) so we own and fix them. No HyperFormula, no SheetJS, no Chart.js: the grid, engine, charts and Excel reader/writer are ours. |

---

## 1. How it fits with the word processor

The word processor already does the hard plumbing for "one Y.Doc per file": `session.js` (load from the device copy then R2, merge-then-save, snapshots, closing), `live.js` (Realtime broadcast while two people are in), `cache.js` (device copy), `store-everyday.js` / `store-safe.js` (where the parts live, encrypted in the Safe), version slots in `doc-model.js`. None of it cares what's inside the Y.Doc, so the spreadsheet uses it as is.

- New code lives in **`documents/sheet/`**, loaded lazily the first time a spreadsheet opens (separate from the word processor's bundle).
- `doc_pfiles.kind = 'sheet'` (already allowed by the table). The Document page lists it with a grid icon and opens it in the spreadsheet.
- **One small migration is needed** (§13): the version-row guard from the word processor only accepts `kind = 'doc'`. It needs to accept `'sheet'` too. Gated: your OK first.
- The generic pieces (session, live, cache, stores, version slots) should move from `documents/editor/` to a shared `documents/collab/` so both editors (and slides later) import them from one place. **Done after PR #223 merges**, so its review isn't disturbed.
- A new **`sheets` agent** in `.claude/agents/` owns `documents/sheet/` (CI coverage check), as the word processor's does.

---

## 2. The spreadsheet's data (Y.Doc layout)

Only what people **type** is synced: inputs, formulas, formats and settings. **Computed values are never stored in the shared document**; each device calculates them. That way two devices can never fight over a result, and the shared file stays small.

```
"meta"            Map    format version, locale, calculation settings
"tabs"            Array  tab ids, in order
"tab:<id>"        Map    name, colour, hidden, frozen rows/cols, gridlines, default sizes
"rows:<id>"       Array  row ids, in order        ← stable identities, see below
"cols:<id>"       Array  column ids, in order
"cells:<id>"      Map    "<rowId>.<colId>" → { i: input, s: style id, n: note }
"rowmeta:<id>"    Map    rowId → { h: height, hidden, group }
"colmeta:<id>"    Map    colId → { w: width, hidden, group }
"merges:<id>"     Map    mergeId → corner row/col ids
"styles"          Map    style id → style (shared table, so a million bold cells cost one style)
"names"           Map    named ranges
"rules:<id>"      Map    conditional formats and data validation
"filters:<id>"    Map    the tab's filter + filter views
"charts:<id>"     Map    chart specs (type, ranges, options, position)
"pivots:<id>"     Map    pivot table specs
"comments"        Map    threads, as the word processor (anchored to a cell id)
```

**Why rows and columns have ids.** If rows were just numbers, Marijane inserting a row while you type in row 40 would put your typing in the wrong row after merging. With ids, a cell belongs to its row whatever moves around it, so concurrent inserts, deletes and sorts merge cleanly. Row 7 is simply "the 7th id in the list right now".

**Formulas are stored by identity too.** `=SUM(B2:B10)` is saved as a reference to row/column ids, and shown as A1 text from the current positions. So inserting or deleting rows never has to rewrite anyone's formulas (which would clash under co-editing). A reference to a deleted row shows `#REF!`, as Sheets does. A range grows when rows are inserted inside it.

**Sorting** writes a new order of row ids (one change), so a sort and someone's typing merge without losing either.

**Size:** new tabs start at **1,000 rows × 26 columns** (as Sheets) and only filled cells are stored. A guard warns at 200,000 filled cells and refuses past 1,000,000 (phones run out of memory well before Google's 10 million).

---

## 3. The formula engine (in house)

`documents/sheet/engine/` — no DOM, no network, fully unit-tested. It runs in a **Web Worker** so typing stays smooth while a big sheet recalculates.

**Pieces we write:**
1. **Parser**: Sheets' formula language — A1 and R1C1 references, `A:A` / `1:1` whole columns and rows, `'Tab name'!A1`, named ranges, array literals `{1,2;3,4}`, all operators (`+ - * / ^ & % = <> < > <= >=`, unary minus, range `:`), strings, booleans, errors. Turns text into a tree with ids (§2).
2. **Values**: numbers, text, true/false, errors (`#DIV/0!`, `#N/A`, `#REF!`, `#VALUE!`, `#NAME?`, `#NUM!`, `#NULL!`, `#ERROR!`), empty, and arrays — with Sheets' coercion rules (empty is 0 or "", "TRUE" vs TRUE, text numbers in arithmetic but not in SUM). Dates are serial numbers from 1899-12-30, as Sheets and Excel.
3. **Dependency graph**: which cells read which; ranges are their own nodes so `SUM(A:A)` doesn't make a million edges. An edit marks only what depends on it as dirty, then recalculates in order. Circular references show an error (iterative calculation is a setting, off by default, as Sheets).
4. **Arrays that spill**: `FILTER`, `SORT`, `UNIQUE`, `SEQUENCE`, `ARRAYFORMULA`, `SPLIT`… fill neighbouring cells; a blocked spill shows `#REF!` with the reason.
5. **Volatile functions** (`NOW`, `TODAY`, `RAND`, `RANDBETWEEN`) recalculate on open and on each edit, as Sheets.
6. **Functions**: a catalog, each function a small module with its argument rules.

**Function coverage — all of Sheets' functions except those that need Google's services**, in three passes:
- **A — everyday (~170):** math & rounding, `SUM/AVERAGE/COUNT/MIN/MAX` and their `IF(S)` forms, logic (`IF`, `IFS`, `SWITCH`, `IFERROR`, `AND/OR/NOT/XOR`), text (`LEFT…`, `TEXT`, `TEXTJOIN`, `SUBSTITUTE`, `TRIM`, `PROPER`…), dates (`DATE`, `EDATE`, `EOMONTH`, `NETWORKDAYS`, `WORKDAY`, `DATEDIF`, `WEEKDAY`, `WEEKNUM`…), lookup (`VLOOKUP`, `HLOOKUP`, `XLOOKUP`, `INDEX`, `MATCH`, `XMATCH`, `CHOOSE`, `OFFSET`, `INDIRECT`), info (`ISBLANK`, `ISNUMBER`…).
- **B — Sheets' power tools:** `FILTER`, `SORT`, `SORTN`, `UNIQUE`, `QUERY` (its own little query language: select / where / group by / pivot / order by / label / format), `ARRAYFORMULA`, `SPLIT`, `JOIN`, `FLATTEN`, `REGEXMATCH/EXTRACT/REPLACE`, `SEQUENCE`, `LET`, `LAMBDA`, `MAP`, `REDUCE`, `BYROW/BYCOL`, `SPARKLINE` (a small chart in the cell).
- **C — specialist:** financial (`PMT`, `NPV`, `IRR`, `XIRR`, …), statistics and distributions, engineering, database (`DSUM`…), the rest.

**Not in v1** (they call Google's servers): `GOOGLEFINANCE`, `IMPORTRANGE/XML/HTML/DATA/FEED`, `GOOGLETRANSLATE`, `DETECTLANGUAGE`, `IMAGE` from the web. An imported formula using one keeps its last value with a note. `GOOGLEFINANCE` could later go through a Netlify function (open point).

**Getting the answers right.** A function counts as done only when it passes a **conformance table**: formula → the value Google Sheets gives, including the edge cases (errors, blanks, dates, rounding, text numbers). formula.js's bodies are the starting point but each one has to pass this table; its known gaps get fixed in our copy. The most reliable way to fill the table is to ask Sheets itself: put a few thousand test formulas in a scratch Google Sheet in your Drive, read the computed values back, and save them as fixtures (then delete the sheet). Needs your OK (open point 8).

---

## 4. The grid

- Drawn on a **canvas**, as Sheets does (DOM per cell can't scroll 100,000 rows smoothly on a phone). Only the visible area is drawn; text, borders, fills, merges, overflow into empty neighbours, wrap and clip, checkboxes and dropdown chips are drawn too. Crisp at the device's pixel ratio; pinch to zoom.
- An **edit box** (a real text field) sits over the active cell while typing, so the system keyboard, spell check, autocorrect and dictation all work.
- **Frozen** rows and columns, hidden and grouped rows/columns (+/−), resize by dragging, double-click to fit.
- **Selection**: ranges, whole rows/columns, several ranges (Cmd/Ctrl), the fill handle (drag to copy or continue a series: 1, 2, 3…; Mon, Tue…; dates), keyboard navigation (arrows, Ctrl+arrows to the data edge, Tab/Enter, Shift to extend, Page Up/Down).
- **Copy and paste**: between our sheets keeps formulas and formats; from Sheets/Excel/web reads their HTML and text; paste special (values only, formats only, transposed). Cut moves formulas and updates references to the moved cells.
- **Undo/redo per person** (Yjs undo manager), so you never undo Marijane's typing.
- **Find & replace** (in values or in formulas, match case, whole cell, regex, this tab or all).
- The other person's selected cell is outlined in their colour with their name (live, §7).

---

## 5. Formatting

- **Text:** font (the word processor's curated list), size, bold, italic, underline, strikethrough, text colour, fill colour.
- **Cells:** borders (all styles and colours), horizontal and vertical alignment, wrap / overflow / clip, text rotation, merge (all, horizontally, vertically) and unmerge, alternating colours, clear formatting, paint format.
- **Numbers:** automatic, number, percent, scientific, accounting, financial, currency (and rounded), date, time, date-time, duration, plain text, and **custom formats** using Sheets/Excel format codes (`#,##0.00`, `$#,##0;[Red]-$#,##0`, `yyyy-mm-dd`, `[h]:mm`, …), parsed and drawn by our own formatter, which Excel import and export also use. Increase/decrease decimals.
- **Typing:** "1/2/2026" becomes a date, "12%" a percent, "$4" currency, as Sheets.

---

## 6. The extras (v1)

**Charts** — our own SVG renderer, following the app's chart look (the dataviz palette, light and dark): column, bar, stacked and 100%-stacked, line, smooth line, area, pie and donut, scatter, combo (columns + line), and `SPARKLINE` in cells. A chart editor panel (data range, series, x-axis, headers, titles, legend, colours, axis ranges), charts that float over the grid and can be moved and resized, or moved to their own tab. They follow their data live. Charts export to PDF and to Excel as pictures in v1 (as real Excel charts later).

**Filters & sorting** — sort a range or a tab by one or more columns (A→Z, Z→A, with or without a header row); a filter on a tab (by values with search, by condition, by colour) visible to both of you, as Sheets; **filter views**, named and saved, that only change what *you* see, so you can filter while Marijane works; "Create a filter" toggles on the toolbar.

**Rules on cells**
- *Conditional formatting:* single colour (empty/not empty, text contains/starts/ends/is, dates before/after/is, greater/less/between/equal, **custom formula**), colour scales (2 and 3 colours), rules in priority order, applied to ranges, drawn live.
- *Data validation:* dropdowns (from a list or a range, shown as chips with colours), checkboxes (with custom checked/unchecked values), number/date/text/email/URL rules, custom formula; on bad input either warn (red corner) or refuse. Help text shown on the active cell.

**Pivot tables** — a pivot editor panel (rows, columns, values with SUM/COUNT/COUNTA/COUNTUNIQUE/AVERAGE/MIN/MAX/MEDIAN/PRODUCT/STDEV/VAR, show as % of row/column/total, filters by value or condition, sort by value or name, totals on/off, group dates by year/quarter/month/day, number grouping). The pivot's output fills cells from its anchor and updates when its source changes; the engine treats a pivot as one more node in its graph. "Calculated fields" (a formula as a value) are in v1 too, since Sheets has them and the engine makes them cheap.

**Always in:** multiple tabs (add, rename, colour, reorder, duplicate, hide, copy to another spreadsheet), freezing, number formats, merged cells, named ranges, cell **notes** (the yellow-corner kind) and **comments** (threads, as the word processor: reply, resolve, @mention), links, version history.

---

## 7. Saving, co-editing, version history

All from the word processor, unchanged:
- **Saving:** the device copy (IndexedDB) first, so it opens instantly and works offline; merged state written to R2 a few seconds after typing stops and on close. The `doc_pfiles` row's `body_text` (for search: tab names and cell text, capped at 200 KB) at most once every few minutes and on close.
- **Live:** Realtime private broadcast on `livedoc:<scope>:<file>` only while two of you are in; cursors are the outlined cell and selection.
- **Versions:** the same slots (hourly for a day, daily for a month, weekly for a year, named forever), R2 snapshots plus a tiny row each. The panel previews a version read-only; **Restore** brings it back (itself undoable). Changed cells are highlighted in the preview (the word processor's compare highlighting is still to come; the spreadsheet does it from the start because cell-by-cell is easy).

**Cost:** a spreadsheet of a few thousand cells is tens of KB in R2. Nothing new in Supabase but version rows. No new server, no polling.

---

## 8. Import & export (on the device unless named)

- **Excel (.xlsx) in:** our own reader (fflate unzips; we read the sheet XML): values, formulas (Excel and Sheets names mostly match; `_xlfn.` prefixes and the few differing names mapped), shared formulas, number formats, fonts/fills/borders/alignment, merges, column widths and row heights, hidden rows/columns, frozen panes, tab colours, conditional formats and data validation (the kinds in §6), named ranges, comments and notes, hyperlinks. Pivot tables come in as their definition when it maps, else as values; charts come in when the type maps. Anything unsupported is kept as values and listed in a note after import.
- **Excel out:** our own writer, the same list, with the **computed values saved alongside formulas** so Excel shows them before recalculating.
- **CSV in/out:** comma, tab, semicolon (detected), UTF-8 with or without BOM; in: numbers and dates recognised (with a "keep as text" choice); out: the current tab, as displayed or as values.
- **PDF:** print setup (current tab / workbook / selection, fit to width/height/page, portrait/landscape, Letter/A4/Legal, margins, gridlines, notes, repeat frozen rows on each page, page order). iPhone: the word processor's native PDF plugin; laptop: the browser's print dialog.
- **Google Sheets:** the same flow as Docs (+ › Bring over Google Sheets, pick sheets or folders), read through the **Sheets API** with full grid data: values, formulas, formats, merges, frozen panes, conditional formats, data validation, filter views, named ranges, charts and pivot tables, which the API describes exactly (more faithful than going through .xlsx). Comments from the Drive API. A one-time move; nothing is deleted in Google. Needs the **Sheets API enabled and `spreadsheets.readonly` added** to your Google connection, and the `gdocs` Netlify function extended (deploy, your OK).

---

## 9. The Safe

Same spreadsheet, same features (as the word processor, §12 there): the Y.Doc, snapshots and live messages are encrypted with the file's key before they leave the device; recalculation happens on the device anyway, so encryption changes nothing about formulas. Search uses the encrypted `text` part. No Google import into the Safe (import as everyday, then Move).

---

## 10. UI

**Opening:** Document page → **+ → Spreadsheet** (or Import an Excel/CSV file, or Bring over Google Sheets). Opens full screen; back returns to the folder. ".xlsx" and ".csv" files already kept get **"Edit as a spreadsheet"**, like "Edit as a document".

**Laptop:** Sheets-style. Title (rename in place) and folder; menu bar (File, Edit, View, Insert, Format, Data, Tools); one-line toolbar; the **formula bar** with the name box (type `B12` or a named range to jump); the grid; **tabs along the bottom** (+, all-tabs menu); side panels on the right for charts, pivots, conditional formatting, validation, comments, versions; people in the spreadsheet at top right. Function help pops up while typing a formula (signature, the argument you're on, a short description), with autocomplete of function and range names.

**iPhone:**
- Opens to view; tap the pencil (bottom right, for your right hand) to edit. Tapping a cell selects it; tapping again (or typing) edits.
- While editing, the formula bar sits **above the keyboard** with a key row on the **right**: `=`, `(`, `)`, `:`, `,`, Σ (functions list), ✓. In a formula, **tap cells to insert references** (drag for a range), as the Sheets app.
- **A** opens the format sheet with **Text / Cell / Number** tabs, like Sheets' mobile app.
- Long-press a row or column header for its menu (insert, delete, hide, resize, sort, freeze); selection handles to extend; drag the fill handle.
- Tabs scroll along the bottom. Everything else in ⋯ (charts, pivot, filters, rules, versions, export).
- Pinch to zoom; frozen rows and columns stay put.

**General:** every text field gets the standard clear "x"; themes and dark mode apply to the chrome and the grid (cell fills you chose stay as chosen).

---

## 11. Build order

Test without Netlify deploys (TestFlight on the phone, `npm run dev:local` on the laptop); one batched deploy at the end (your OK), shipped with the word processor if it hasn't gone out yet.

1. **Engine core:** parser, values, dependency graph, recalculation in a worker, spills; pass A functions; the conformance harness and table.
2. **Grid & editing:** canvas grid, edit box, selection, keyboard, fill handle, copy/paste, undo, tabs, freeze, merges, resize, hide/group, formatting, number formats; phone editing. New → Spreadsheet in the page.
3. **Saving, co-editing, the Safe:** reuse the word processor's session/live/stores (after moving them to `documents/collab/`); the version-guard migration (your OK). Independent review of the Safe path.
4. **Functions B and C**, `QUERY` included, until the catalog is done.
5. **Filters & sorting**, then **rules on cells**.
6. **Charts.**
7. **Pivot tables.**
8. **Notes, comments, version history** (with changed-cell highlighting).
9. **Import/export:** CSV, Excel in and out, PDF, Google Sheets (needs the deploy and Google setup).
10. **Review & QA:** an independent review agent on the engine and on co-editing merges; the full checks below; TestFlight for you and Marijane; the batched deploy.

---

## 12. Tests

- **Unit:** the parser (round trip text ↔ tree for every grammar piece); every function against the conformance table; dependency graph (only dirty cells recalculate; ranges; cycles; spills and blocked spills); references surviving insert/delete/move/sort, including the same edits made concurrently on two devices; number-format codes (formatting and parsing typed input); conditional-format and validation evaluation; pivot output against hand-made results; filter views not changing the other person's view; .xlsx round trips (fixtures made in Excel and exported from Google Sheets); Sheets API mapping from recorded responses; Safe: every part and message is ciphertext.
- **Browser QA** (Chromium at 390 / 360 px and laptop width, two profiles): typing and formulas, fill handle, copy/paste from a Sheets-style HTML clipboard, two people editing the same tab (insert rows while the other types), sorting while the other types, filters vs filter views, charts updating, pivot editing, restore a version, import/export, a 100,000-row sheet scrolling and recalculating, a Safe spreadsheet stored only as ciphertext.
- **Planted bugs** in the reference rewriting, merge and recalculation rules, as in the Documents work.
- **Manual (TestFlight):** the phone keyboard row and tap-to-reference, scrolling a big sheet, PDF export, co-editing between your phone and Marijane's.

---

## 13. Server changes (all gated)

1. **Migration** (your OK): `doc_versions_guard` accepts `kind in ('doc', 'sheet')` for everyday version rows. A `create or replace function`, no DROP, nothing else changes. Realtime policies and `doc-storage` already work for any file kind.
2. **Google:** enable the Sheets API in the Calendar project; add `…/auth/spreadsheets.readonly` to the consent screen (Testing mode, so no Google review). Then connect again in Document.
3. **Netlify:** the `gdocs` function learns spreadsheets (same function, new action). A deploy, your OK.

---

## 14. Open points (defaults in bold)

1. **New tabs: 1,000 rows × 26 columns; warn at 200,000 filled cells, refuse past 1,000,000.**
2. **Locale: US** (M/D/YYYY dates, `$`, `,` thousands, `.` decimals, weeks start Sunday); a per-spreadsheet locale setting later.
3. **Iterative calculation off**; circular references show an error.
4. **Google-only functions** (`GOOGLEFINANCE`, `IMPORT*`) **not in v1**; imported formulas keep their last value with a note. Later, `GOOGLEFINANCE` could use a Netlify function.
5. **Shared code moves to `documents/collab/` after PR #223 merges.**
6. **Imported Google Sheets go into a folder of the same name in Personal** (as Docs); move to Household after.
7. **Charts in documents** (a live chart from a spreadsheet inside a word-processor document) **later**, not v1.
8. **Conformance answers come from Google Sheets itself:** a scratch sheet in your Drive, read back, then deleted. OK to do that when step 1 starts?
9. **Either of you can delete or restore versions in Household** (as documents).

---

## 15. Progress

- **Migration applied** (2026-11-09, Luke's OK): `migrations/2026-11-09b-documents-sheet-versions.sql`, recorded as `20261109120500 documents_sheet_versions`; checked live (guard accepts `sheet`, both triggers in place). Test: `test/documents-sheet-migration.test.js` (fails without the migration).
- **Engine core built** (`documents/sheet/engine/`): parser (A1, open ranges, cross-tab, arrays, stored placeholders), values and Sheets' coercion rules, binding between positions and row/column ids (`binding.js`), dependency graph with range nodes, recalculation of only what changed (deep chains finished deepest-first), spills with blocking, cycles, volatile functions, LET/LAMBDA, Sheets' array-mode rule (a range where one value is expected is `#VALUE!` outside ARRAYFORMULA). Number formats (`number-format.js`) for TEXT and display.
- **Functions:** ~300 so far (math, statistics, logic, information, text incl. regex, dates, lookup incl. XLOOKUP, array functions incl. FILTER/SORT/UNIQUE/SEQUENCE and the LAMBDA helpers).
- **Conformance with Google Sheets:** 445 formulas computed by Google Sheets itself (scratch sheet in Luke's Drive, read back, trashed — open point 8), saved as `test/fixtures/sheet-conformance.json`; the engine matches all 445. The first run found 19 differences, each a real Sheets rule now kept in `.claude/agents/sheets.md` (e.g. `^` is right-associative, `0^0` = 1, COUNTIF `"<>"` counts `""`).
- New `sheets` agent (`.claude/agents/sheets.md`) owns the engine; CI covers its folders.
