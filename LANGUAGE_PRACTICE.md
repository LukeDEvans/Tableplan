# Dutch practice — design & as built

Status: **Built on `claude/dutch-matching` (2026-10-20). Not deployed.** Requested by Luke, 2026-10-20.

Goal: a fast, low-pressure Dutch vocabulary game. Match Dutch words or phrases to their English in a timed board, with lessons organized around Luke's Rosetta Stone Dutch course.

## 1. Where it lives

- **Leisure page** (Recreate group, Personal view), as a **Dutch** row beside Sailing and Piano: the first card opens the lessons; then one card per lesson (first 12); then **Review**. No new page, nav group or view.
- Code: `language-*.js` (owned by `.claude/agents/language.md`). app.js only adds the hobby, its row, the detail mount and the two merge lines.

| Module | What | Pure? |
|---|---|---|
| `language-curriculum.js` | course shape, `validateCourse`, scopes, lesson status | yes |
| `language-nl-starter.js` | the Dutch course data | data |
| `language-match.js` | the game state machine | yes (no DOM, timers or storage) |
| `language-progress.js` | per-word counters, session summaries, their merge | yes |
| `language-ui.js` | `createLanguageModule(deps)`: lessons, start, board, summary; the only timers | DOM |

## 2. Game rules

- Two columns, **5 cards a side** (fewer only when the set has fewer words; never invented words).
- Defaults: **120 s**, goal **30 matches**. The game ends at time up or on reaching the goal, and the board freezes.
- Tap a Dutch card and an English card, either order. A second tap on the same side moves the selection; tapping the selected card clears it.
- **Right pair:** +1, both cards show a check and go inert at once, and a new pair arrives after a random **500–1500 ms**. When several land together their English cards are cross-assigned, so a new Dutch card's answer isn't always the card beside it.
- **Wrong pair:** both cards flash with an ✕ mark (not color alone), stay in play, nothing else changes. No penalty; the clock keeps running.
- The board never shows the same pair, Dutch form or English form twice, so each Dutch card has exactly one answer showing. The pair just matched doesn't come back immediately when spares exist; least-shown words are picked first, so every word gets its turn.
- **Accuracy** = right ÷ completed attempts. A lone selection isn't an attempt. With no attempts, accuracy is "—" and nothing is saved.
- Hiding the app pauses the clock (a Resume button shows on return). Leaving the Dutch view mid-game, or closing the app or tab (`pagehide`), ends it as "left"; it's saved once if any pair was tried, and coming back opens the lessons, never a stale clock.

Correctness lives entirely in `language-match.js`: every call takes `now` and the rng is injected, so tests run on a fake clock with seeded randomness. The UI only calls `select()` on taps and `tick()` when `nextDueAt()` says something is due; every timer checks it still belongs to the current game.

## 3. Practice scopes

- **Lesson:** that lesson's words only.
- **Unit (Whole unit):** all lessons in the unit.
- **Review:** only lessons the person has already practiced (any word seen). Off until one lesson is practiced. "Play again" on a review re-reads the practiced list.

## 4. Curriculum source (important)

**The intended list wasn't available.** Luke's course is the Rosetta Stone Dutch "November 2026" list, which can't exist yet on 2026-10-20. Checked: the repo, Google Drive and Gmail (no Rosetta Stone or Dutch material), and Rosetta Stone's public **Course Contents** page. That page links per-level PDFs for Dutch (Units 1–4, 5–8, 9–12), but they are the **2011 Classic edition** (document CCB-NED-L1-2.0) and list unit and lesson titles only, with the course content itself proprietary.

So the app ships a **provisional starter set**:
- **Level "Starter (provisional)"**, 6 units, 17 lessons, 174 original entries of common beginner Dutch, grouped by everyday topic (first words, greetings, work and school, shopping, getting around, time).
- Source `nl-starter-2026-10` (kind `original`, retrieved 2026-10-20). **Every entry is `provisional`.** No unit or lesson claims to match a Rosetta Stone lesson. The app labels each lesson "Provisional" and says so on the lessons screen.
- `validateCourse` (run in CI) refuses an entry marked `verified` unless its source has `kind: "rosetta-stone"` **and** a `curriculumVersion`, and refuses a Rosetta Stone source left provisional. A guessed mapping can't reach the app as verified.

### Adding the real Rosetta Stone lessons
1. Add a source in `language-nl-starter.js` (or a new data file): `{ kind: "rosetta-stone", title, retrieved: "<date>", confidence, curriculumVersion: "<e.g. 2026-11>", url? }`.
2. Add a **new level** (e.g. `nl-rs-l1`) with the course's units and lessons. Keep the starter level: its ids hold existing progress.
3. Add entries with new ids (`nl-rs1-<unit>-<lesson>-NN`), `source` pointing at the Rosetta Stone source, `verification: "verified"` only after checking each word against the list. Short word/phrase pairs only; don't copy lesson text.
4. Run `npx vitest run test/language-*.test.js`: validation catches duplicates, mismatched lessons, and look-alike answers inside a lesson.
5. Entry ids are permanent: never renumber or reuse; retire by removing an entry (its stored progress just stops showing).

### Missing inputs
- The Rosetta Stone Dutch list Luke means by "November 2026": which edition (app's current course, or Classic), and the lesson-by-lesson word list, as a file or export he has access to.
- Whether lessons should follow Rosetta Stone's structure exactly (unit → 4 core lessons + milestone) or be grouped differently.

## 5. Progress and sync

Two keys in this person's **`recreate`** section (always personal, row `u-<uid>:recreate`; the spouse's app never loads it):

- `languageWords` `{ <entryId>: { n: { <deviceId>: [seen, c, w] }, last, scope } }`: per device, times shown, right matches and wrong attempts (counted against the Dutch card being matched); plus last practiced and where. A word's total is the sum across devices.
- `languageSessions`: the newest **50** session summaries (scope, label, times, correct, attempts, goal, reached, end reason). Per-word detail isn't kept per session.

Written **once per finished session** with the normal `persist()`; nothing per tap or tick. No new tables, functions, buckets or polling. One device key, `live-device-id-v1` (a random id naming this device's counter slot; device-level, so it survives sign-out like other device settings). Upper bound ≈ 10 KB per device for words + ~10 KB for sessions.

**Merging** (`mergeStates`): each device only adds to its own counters, so copies merge by keeping each device's **larger** numbers, and totals sum the devices. A stale copy can't lower progress, practice done on a device holding an out-of-date copy still counts in full, and merging is order-independent and idempotent. Sessions union by id, newest 50 kept.

**Accounts:** a game saves only if the signed-in account is the one it started under; sign-out reloads the page anyway.

## 6. Verification

- Unit: `test/language-match.test.js`, `test/language-curriculum.test.js`, `test/language-progress.test.js` (seeded rng, explicit clock).
- Browser: `npm run qa:language` (`scripts/qa-language.mjs`, 50 checks through the real app at 390 and 360 px, including dark mode, reduced motion, keyboard, pause, leave mid-game, review, saved progress). Delete `data/tableplan-state.json` first.
- Not verified: the iPhone app (WKWebView touch), VoiceOver.

## 7. Not built (on purpose)

Streaks, achievements, spaced repetition, audio, multi-language UI, a setting for the goal or time (fixed at 30 / 2:00; the engine takes both as options).
