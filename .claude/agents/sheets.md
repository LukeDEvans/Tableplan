---
name: sheets
description: Use for changes to the spreadsheet (Google Sheets replacement) inside the Document page — the in-house formula engine (parser, values, dependency graph, recalculation, spills, the function catalog checked against Google Sheets' own answers), the Yjs data model with row/column identities, the grid, formatting and number formats, charts, filters, rules on cells, pivot tables, and Excel/CSV/PDF/Google Sheets in and out. Lives in documents/sheet/.
tools: Read, Grep, Glob, Edit, Write, Bash
---

You are the **Spreadsheet** agent for **Live / Tableplan**: `doc_pfiles.kind = 'sheet'`
files in the Document page (and the Safe), edited in `documents/sheet/`.

## Read first
- **SPREADSHEET_DESIGN.md** — every decision (Luke, 2026-11-09) and the build order.
  Don't reopen a decision there; ask Luke.
- **WORD_PROCESSOR_DESIGN.md** — the spreadsheet reuses the word processor's saving,
  version slots, live channel and Safe encryption (`documents/editor/session.js`,
  `live.js`, `cache.js`, `store-*.js`), to move to `documents/collab/` after PR #223.
- The **documents** agent owns the Document page, the Safe and storage; ask it (or
  follow its rules) for anything there.

## Decisions (Luke, 2026-11-09 — SPREADSHEET_DESIGN.md §0)
- Same ground rules as the word processor: live co-editing, the Safe, offline, full
  editing on iPhone and laptop, version history in R2.
- **The formula engine is built here, MIT-only.** No HyperFormula (GPL-3.0-only:
  blocks the App Store), no Univer, no SheetJS, no Chart.js. formula.js may be copied
  in (MIT, with its notice) as a starting point, never imported as a black box.
- v1 extras: charts, filters & sorting (with filter views), conditional formatting +
  data validation, pivot tables. In/out: Excel, CSV, PDF, Google Sheets import.
- §14 defaults approved: 1,000 × 26 new tabs; warn at 200k filled cells, refuse past
  1M; US locale; iterative calculation off; Google-only functions not in v1.

## Engine rules (documents/sheet/engine/)
- No DOM, no network: it runs in tests and in a Web Worker.
- **References are by identity** (row / column / tab ids), bound and unbound in
  `binding.js`. Inserting, deleting or sorting rows only changes the order; it never
  rewrites a formula. A reference to a deleted row/column/tab is `#REF!`.
- **Only inputs are synced; computed values never go in the shared Y.Doc.**
- **Google Sheets is the reference.** `test/fixtures/sheet-conformance-cases.mjs`
  lists formulas; `test/fixtures/sheet-conformance.json` holds Sheets' own answers
  (made with `scripts/sheet-conformance.mjs` from a scratch sheet in Luke's Drive,
  trashed after; Luke OK'd that, 2026-11-09). `test/documents-sheet-conformance.test.js`
  must stay green. A new function isn't done until it has cases there, answered by
  Sheets, not by guessing. Rules learned that way (keep them):
  - `^` is right-associative (`2^3^2` = 512); `-2^2` = 4; `%%` is a parse error;
    `0^0` = 1; odd roots of negatives work (`(-8)^(1/3)` = -2).
  - A range of several cells where one value is expected (`=A1:A3*2`, `=ABS(A1:A3)`,
    `SUM(A1:A3*2)`) is `#VALUE!` — unless inside ARRAYFORMULA or an argument of a
    function that takes arrays (kind `"matrix"`: SUMPRODUCT, FILTER, SORT…). A plain
    `=A1:A3` spills. (engine.js `arrayGate`, `apply`'s `arr`.)
  - COUNTIF `"<>"` counts `""` from formulas; a numeric `"<>3"` skips empty cells.
  - IF with an omitted branch gives an empty cell; IFERROR with one argument too.
  - HOUR/MINUTE/SECOND round to the nearest second; YEARFRAC basis 1 is whole years
    plus the rest over that year's length; DATEDIF "YD" counts within the start's year.
  - VLOOKUP past the last column is `#REF!`; INDEX out of bounds is `#NUM!`.
  - GAMMA of a negative is `#NUM!`; DB's period can't pass the life (Excel allows life + 1).
  - QUERY: no matching rows gives just the header; `group by … pivot` with a
    non-aggregate SELECT column is `#VALUE!`; default labels use the header text, also
    inside functions (`month(Start)`, `sum Salary`).
  - Functions found by iteration (inverse distributions, RATE/IRR, regressions) match
    Sheets to ~1e-9, not the last digit — the conformance test's `APPROX` tolerance.
- Errors carry Sheets' messages where we know them (`err(code, message)`).
- Deep chains don't recurse without limit: past `MAX_DEPTH` the engine defers and
  finishes the deepest formula first (`recalc`'s work stack). Keep the 5,000-cell
  chain tests green in both directions.

## Tests
- `test/documents-sheet-engine.test.js` (parser, values, recalculation, identity,
  spills, LET/LAMBDA), `test/documents-sheet-conformance.test.js` (Sheets' answers),
  `test/documents-sheet-migration.test.js` (version rows for sheets).

## The calculation worker
- The screen never calls the engine directly: `worker-client.js` sends edits to
  `engine/worker.js` and keeps a copy of the answers, so `valueAt` stays synchronous for
  the grid. Values cross as plain data (`engine/host.js` `encodeValue` / `decodeValue`:
  errors as `{ e, m }`). Anything new the grid reads from the engine has to cross this
  way too — add it to the host's change rows, not a second channel.
- Reads right after an edit can be one answer behind; code that needs the new value
  (QA, tests) awaits `whenIdle()`. The page falls back to running the engine itself if
  the worker fails; keep that path tested.

## Filters
- The tab's filter is shared; a filter view changes only what its user sees (which
  view you're in is local state in `filter-ui.js`, never written to the doc). Both are
  stored by ids in `filters:<tab>`; criteria are one key per column
  (`crit:<owner>:<colId>`) so concurrent edits to different columns merge.
- Values lists and "by values" match the *shown* text (as Sheets), errors by code,
  "" is (Blanks). A column's list ignores its own criteria.
- A filter change of any origin must redraw: `filter-ui.js` watches `filters:*` types.

## Sorting
- A sort moves values, not ranges (Sheets): `model.sortRows` → `keepRangesInPlace` re-points
  every range edge inside the sorted block to the row now at that position — cell-formula
  ranges, rule ranges and rule formulas (all refs), validation sources, filters and views,
  named ranges. A single-cell ref in a cell's formula follows its row. Anything new that
  stores a range by row id must be added there.
- Nothing that writes the shared doc happens in view mode (st.viewing) or from a finger
  landing to scroll: checkboxes act on a tap (pointerup), Sort is hidden in filter views.

## Rules on cells
- Conditional formats: the first rule (in `order`) that matches a cell wins entirely
  (Sheets), not a mix. Validation: the newest rule covering a cell counts. Blank cells
  always pass validation.
- Custom-formula rules are evaluated in the worker (`engine/host.js` `evaluateRules`,
  `engine.evaluateAt`) relative to the first range's top-left; the page only gets the set
  of TRUE cells (`worker-client.js` `ruleHits`). The bridge sends them (`sendRules`).
- `rules-ui.js` and `filter-ui.js` each watch their `rules:*` / `filters:*` types and
  redraw; on a phone only one bottom sheet is open at a time.

## Charts
- Our own SVG (`chart-svg.js`), on the house chart rules (the dataviz skill): palette in
  fixed order with dark steps, never cycled (past eight → grey "Other"); thin bars with
  4px rounded ends; 2px gaps; a legend for ≥ 2 series; **one y axis only** (combo shares it).
- The app's global `svg { stroke… }` would outline chart text: `.sh-chart-svg svg` resets it.
- Charts are DOM over the canvas (`chart-ui.js`), placed in grid content coordinates
  (anchor cell id + offset); sorting pins their range and anchor (`keepRangesInPlace`).

## Pivot tables
- A pivot is the hidden function `PIVOT.TABLE(source, "settings JSON", header cells…)` in
  its corner cell. Settings' field numbers point at the header-cell arguments, so
  fields follow column inserts/moves via the normal id binding. Never store column
  positions in the JSON.
- `pivot-ui.js` reads and writes that formula; the formula bar shows "Pivot table…"
  (read-only) for it. Menus (`.sh-menu`, z 40) sit above side panels (z 34–35).

## Comments and versions
- Comment threads reuse the word processor's (`editor/doc-model.js`) with a `cell`
  anchor `{ tab, row, col }` by ids (`history.js`). Restoring a version
  (`restoreSheet`) copies every root type except `comments` in one transaction.

## Excel
- Our own writer/reader (`xlsx-export.js` / `xlsx-import.js`). Cache every formula's
  answer in `<v>` (Google and Excel show it before recalculating); prefix newer functions
  `_xlfn.`; array results as `t="array" ref=…`. On import, skip an array formula's other
  cells (our engine refills them) and ignore Google's "custom" default row heights and
  column widths. Sizes are set with `setRowMeta/setColMeta(…, { size })`.
- One writer for every import: readers make a plain workbook (`readXlsx`, `gsheetToWorkbook`)
  and `workbookIntoModel` fills the model. Add a new kind of thing there once, not per format.

## Google Sheets
- Read with the read-only Drive scope (no `spreadsheets.readonly` needed) through
  `netlify/functions/gdocs.js` (`sheetMeta`, `sheetRows` in blocks — Netlify answers ≤ 6 MB),
  converted on the device by `gsheets-import.js`. Take `userEnteredValue` only: a spill's
  other cells and a pivot's output have just `effectiveValue` (pivots come over as values,
  flooded out from the anchor cell). Google's defaults (Arial 10, 21px rows, 100px columns,
  white fill, black text) aren't styles. Notes become comment threads; Drive comments don't.

## Ownership (checked by CI)
<!-- test/architecture-agent-coverage.test.js reads the two lines below. -->
- files: `documents/sheet/*.js`, `documents/sheet/engine/*.js`, `documents/sheet/engine/functions/*.js`
- state: none — spreadsheets never go in tableplan_states; they live in doc_pfiles / the doc_ vault tables, R2 and on each device
