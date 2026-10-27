# Dutch practice — design & as built

Status: **Matching game built 2026-10-20 (§1–7). The full learning build (§8–17: your Rosetta Stone words, spaced-repetition flashcards, de/het, listening, sentence building, speaking) designed and built 2026-10-26 on `claude/dutch-learning`.** Requested by Luke, 2026-10-20 and 2026-10-26.

Goal: a calm, low-pressure way to refresh and slowly build Dutch vocabulary around Luke's Rosetta Stone course. Strong flashcards and matching first; sentence building, listening and speaking as additions.

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

Streaks, achievements, XP, hearts, multi-language UI, a setting for the goal or time (fixed at 30 / 2:00; the engine takes both as options). *(Spaced repetition and audio came with Part 2, below.)*

---

# Part 2 — the full learning build (2026-10-26)

## 8. What Luke asked for (2026-10-26)

- He liked Duolingo but **not hearts** (losing lives for wrong answers limits learning) and is **not interested in XP or gamification**. He likes Rosetta Stone.
- Mostly he refreshes and slowly builds vocabulary with **flashcards and the matching game**, so those must be strong. **Sentence building, speaking and listening** are welcome additions.
- Decisions (2026-10-26): build all parts, in the order Claude sees fit; **copy the word list from Rosetta Stone** into the app; **microphone access is fine** to implement.

## 9. Principles

- **No hearts, XP, streaks, leagues or badges.** A wrong answer never ends or limits practice. Progress is shown plainly: words due, words known per lesson.
- **One word bank feeds everything.** Flashcards, matching, de/het, listening, sentences and speaking all draw from the same course (the starter set plus Luke's own Rosetta Stone words), so a word added once shows up everywhere.
- **The schedule decides what to review.** Spaced repetition (FSRS) brings a word back just before it would be forgotten. Misses in the other exercises pull a word forward; they never cost anything.
- **Everything stays on the device or in Luke's own `recreate` row.** No new tables, functions, buckets or polling. Audio is synthesized on the device; speech is recognized on the device where iOS supports it; recordings are never saved or uploaded.

## 10. Where it lives

Leisure › **Dutch** (Personal view), as today. The Dutch view becomes a hub:

- **Today**: "N to review · M new" and a **Start** button (flashcards over everything due).
- **Practice**: Flashcards · Match · de / het · Listen · Sentences · Speak. Each runs over "everything" or, from a lesson, over that lesson or unit.
- **Your course** (Luke's Rosetta Stone lessons) then the **Starter set** (can be hidden in the hub's settings).
- **Add words** (paste from Rosetta Stone) and **Word list** (browse, edit, delete).

The Leisure row: the Dutch card (shows what's due), **Review due**, then lessons, then a **+ Add words** card.

## 11. Your Rosetta Stone words (word bank)

Rosetta Stone's content isn't available to the app (LANGUAGE_PRACTICE §4), so Luke copies it in.

- **Paste import:** choose Unit and Lesson numbers (titles optional), paste lines, review a preview, save. Accepted line shapes: `Dutch = English`, `Dutch — English`, `Dutch - English`, `Dutch<TAB>English`, `Dutch : English`. Extra English meanings after `;` or `/` become alternatives. A line starting with `de ` / `het ` records the noun's gender. A line that reads like a sentence (3+ words, or ending in `.`, `?`, `!`) is filed as a **sentence** (editable in the preview). Duplicates of a word already in that lesson are skipped and listed.
- **Storage:** `languageUserLessons` `{ <lessonId>: { unit, lesson, unitTitle, title, at, del? } }` and `languageUserWords` `{ <id>: { kind: "word"|"sentence", text, en, alsoEn?, lesson, note?, at, del? } }`. Ids are random and permanent (progress is keyed by them). Deleting marks `del` with a new `at` (a tombstone), so a copy that still has the word can't bring it back.
- **Merge:** per id, the copy with the later `at` wins; absence is never a deletion (an older app build that drops the keys can't erase them — the device that has them writes them back).
- **In the course:** user lessons form a level **"Your course"** (verified source `rosetta-stone`, curriculumVersion `copied`), listed first. Because Luke copies these from his course, they count as verified.

## 12. Flashcards (spaced repetition)

- **Scheduler:** FSRS-4.5 with its published default weights, target retention 90%. Pure module `language-srs.js` (no DOM, clock injected). Intervals are whole days (a card due "today" is due from the start of the local day).
- **Two cards per word:** *recognize* (Dutch → English) and *produce* (English → Dutch). A word's produce card unlocks the day after its recognize card was first answered right. Sentences get one card (built in Sentences, §15).
- **A session:** due cards first (most overdue first), then up to **N new words** a day (default 10; 0/5/10/15/20/30 in settings), new words in course order (your course first). "Again" puts the card back a few cards later in the same session; nothing ends early.
- **Card:** front shows the Dutch (with ▶ to hear it; auto-play optional) or the English. **Show** reveals the answer, gender, note and an example sentence from the same lesson if one contains the word. Grade **Again / Hard / Good / Easy**, each labeled with when it comes back ("1d", "4d", "3w").
- **Type it** (produce cards): type the Dutch and check. Exact → Good; one small slip or a missing accent → Hard and the difference is shown; otherwise → Again. The grade can be changed before moving on.
- **Storage:** `languageCards` `{ "<entryId>|r" | "<entryId>|p" | "<entryId>|s": [stability, difficulty, dueDay, lastMs, reps, lapses] }` (compact: ~40 bytes a card). `dueDay` is the local day number (days since 1970-01-01). Written once at the end of a session (and when leaving mid-session, if anything was graded).
- **Merge:** per card, the copy with the later `lastMs` wins (each review fully determines a card's state).
- **"Known"** (shown per lesson): the recognize card's stability is at least 21 days.

## 13. Matching (upgraded)

- Unchanged rules (§2), plus:
- **Review due** draws its board from due and recently-missed words first, topped up with recently-learned ones.
- **Listen mode**: the Dutch column shows ▶ cards; tapping plays the word and selects it.
- A **wrong match** pulls that word's recognize card forward to today (stability unchanged). Right matches don't change the schedule (matching is recognition with hints).

## 14. de / het

- Every noun whose Dutch starts with `de ` or `het ` (starter and your words). The noun is shown without its article (with its English); tap **de** or **het**. Immediate feedback, the full form is spoken, misses come back at the end of the round. A round is 15 nouns, weighted to ones missed before (`languageWords` counters). A miss pulls the recognize card forward.

## 15. Listening and sentences

- **Listen** (three kinds, mixed): *Which did you hear?* (four written choices from the same lesson), *Type what you hear* (lenient check as in §12), and *Sounds* (minimal pairs: man/maan, zon/zoon, vis/vies, mus/muis, boek/buik, deur/duur, tien/tuin…). A miss on a course word pulls its card forward.
- **Sentences:** English shown; build the Dutch by tapping word tiles (the sentence's words plus two from other sentences). **Check**: right → spoken and graded Good (Hard if a retry was needed); wrong → the wrong tiles are marked, retry or **Show**. Variant: *hear it, build it*. Sources: your pasted sentences, plus a small **starter sentence set** (provisional, original, built from starter words). Accepted alternatives (e.g. time-first inversion) can be listed per sentence.

## 16. Speaking (microphone)

- **Say it:** the Dutch (and its English) is shown; tap the mic, say it; the app shows what it heard and whether it matches (any of the recognizer's top guesses, compared leniently). **Not a pronunciation score** — just "it understood you". No grade feeds the schedule.
- **Shadow:** hear the word or sentence, record yourself, then play yours and the model back to back. Recordings live only in memory (web) or a temp file deleted on the next recording or when leaving (iPhone); never uploaded.
- **iPhone:** a new native plugin, **`LiveLanguage`** (`ios/App/App/LiveLanguagePlugin.swift`): speaks with the best installed Dutch voice (AVSpeechSynthesizer; download *Dutch (Premium/Enhanced)* in iOS Settings › Accessibility › Spoken Content for a better voice), recognizes Dutch with Apple's speech recognizer (`nl-NL`, on-device when the phone supports it) and records at the same time. Needs `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` (added), and a TestFlight build. Asks for permission the first time Speak is used.
- **Browser (laptop):** the Web Speech API for voice and recognition where the browser has them (Chrome: yes; it sends audio to Google for recognition), `MediaRecorder` for shadowing. Missing pieces hide their buttons with a one-line note.
- Media playing in the app is paused before the mic opens.

## 17. Egress and size

- No new Supabase tables, functions, buckets or polling; nothing new is read on a timer.
- All new keys are in the personal `recreate` row (`u-<uid>:recreate`), written with the normal `persist()` once per finished session or edit.
- Sizes: cards ~40 B each (2,000 words ≈ 160 KB worst case with both directions — Luke's course is far smaller), user words ~120 B each. Recreate row stays well under 250 KB even for a full course.
- Speech: TTS and recognition run on the device (Chrome's recognizer is Google's, not Supabase's).

## 18. Build order (as done)

1. Pure cores: `language-srs.js`, `language-words.js` (user bank, paste parser, course builder), `language-drills.js` (de/het, listening, minimal pairs, answer checking), `language-sentences.js` (tiles, checking) + `language-nl-sentences.js` (starter sentences).
2. State: four new keys in `STATE_SECTIONS.recreate` with merge rules; `languagePrefs` in `TRACKED_SETTINGS`.
3. UI: the hub, Add words / Word list, flashcards, match upgrade, de/het, listening, sentences, speaking (`language-ui*.js`).
4. Speech: `language-speech.js` (native plugin or Web Speech) and the `LiveLanguage` Swift plugin.
5. Tests + `qa:language` extended.

## 19. As built (branch `claude/dutch-learning`, 2026-10-26)

| Module | What | Pure? |
|---|---|---|
| `language-words.js` | paste parser, your lessons/words (normalize, merge, edit, tombstones), `buildCourse` (your course + starter), course order | yes |
| `language-srs.js` | FSRS-4.5 (`reviewCard`, `previewIntervals`, `pullForward`), compact card tuples + merge, `buildSession`, `deckCounts` | yes |
| `language-drills.js` | typed-answer check (exact / close: accent, article, one slip / wrong), speech match, de/het items, weighted picks, listening choices, minimal pairs | yes |
| `language-sentences.js` + `language-nl-sentences.js` | tiles, checking (with accepted alternatives); 38 provisional starter sentences | yes / data |
| `language-speech.js` | speak / listen / record: `LiveLanguage` plugin on the iPhone, Web Speech + MediaRecorder in a browser | platform |
| `language-ui.js` | hub, lesson screen, settings, router; still runs the matching board (now with Listen mode) | DOM |
| `language-ui-cards.js` · `language-ui-drills.js` · `language-ui-words.js` | flashcards + de/het · listen, sentences, speak · add words, word list | DOM |
| `ios/App/App/LiveLanguagePlugin.swift` | AVSpeechSynthesizer (best Dutch voice), SFSpeechRecognizer `nl-NL` (on-device when supported) + recording, playback | native |

- **State** (personal `recreate` row): `languageCards`, `languageUserLessons`, `languageUserWords`, `languagePrefs` (TRACKED_SETTINGS `"fields"`), plus the existing `languageWords` / `languageSessions` (sessions now carry `kind`). Merge rules in `mergeStates`. No migration, no new tables or functions.
- **Leisure row:** Dutch (hub) · Flashcards (what's due) · lessons (yours first) · **+ Add words**. A lesson card opens the lesson screen.
- **Hub Match** uses "Review due" (due or missed words, topped up with the least-settled learned ones; the first lessons when nothing is learned yet).
- **Persisting:** answers update state in memory; one `persist()` when a round ends, when leaving it, when the app is hidden mid-round, or on `pagehide`.
- **Media:** `pauseMedia` (app.js) pauses a native read-aloud/podcast session and any `<audio>`/`<video>` before the mic opens.
- **Tests:** `test/language-srs.test.js`, `-words`, `-drills` (incl. sentences), `-speech`, plus the existing three. **QA:** `npm run qa:language` — 112 checks through the real app with stubbed speech and a fake microphone (390 and 360 px; dark mode on the board).
- **Not verified:** the Swift plugin hasn't been compiled (no Xcode in the build sandbox) — the first TestFlight build is its compile check; real Dutch voices and Apple's recognizer on the phone; Chrome's real recognizer.

---

# Part 3 — verbs, word order, fill in, problem words, reading (2026-10-26)

Asked by Luke, 2026-10-26: "build the rest" of Claude's next-step list — conjugation, word order, fill in the blank, problem words — plus the **easy Dutch news** reader ("I really like the easy Dutch news idea"). **No daily reminder** (Luke declined it). Dutch podcasts: Luke will look into them himself (no code). Photo cards weren't requested; not built.

## 20. Verbs (`language-verbs.js`)
- Present, past and perfect for ik / jij / hij·zij / wij / jullie / zij. Type the form; the pronoun may be typed or not. Feedback shows the form, any accepted alternative (kunt / kan, heb / ben gelopen) and the rule behind it ('t kofschip, strong verb, hebben or zijn).
- **Never a guessed form:** a table of ~100 strong / irregular verbs written out in full, a list of known regular verbs, and the spelling rules. Past and perfect are drilled only for verbs in the table or the known-regular list (many verbs that look regular are strong). Other verbs get the present only. Separable verbs (opstaan), reflexive / multi-word verbs, diaeresis words, "er-" verbs and -eren verbs of unknown stress are left out.
- Verbs come from the lesson (Dutch infinitive with English "to …"), or on the hub from the whole course plus 40 common verbs. Misses are counted under `verb:<infinitive>` in `languageWords` and weight later rounds.

## 21. Word order (`language-nl-wordorder.js`)
- 32 original sentences in four rules: verb second (inversion), questions, verb at the end after omdat/dat/als/of/toen, and two verbs (helping verb second, the other at the end). The first word(s) are given; tap the rest into order; the rule is explained after the first try. Provisional, like the starter set. Misses counted under `wo:<id>`.

## 22. Fill in the blank (`language-cloze.js`)
- From your pasted sentences, the starter sentences, and the sentence saved with each word from your reading. Blanks a word you're learning when the sentence has one, otherwise a content word (never de / het / ik…). Shows the sentence's English (or, for a reading sentence, the word's meaning); "Hint" gives the first letter and length. A miss pulls that word's flashcard forward.

## 23. Reading the news (`language-ui-more.js` createReader, `netlify/functions/dutch-reader.js`)
- **Where:** a "Read the news" card on the Dutch hub and in the Leisure row (Personal view). Kept in the Dutch view, not the News page, because it feeds your flashcards.
- **Sources:** *Easy* = NOS Jeugdjournaal (news written for children: short sentences, everyday words), RSS `feeds.nos.nl/jeugdjournaal`; *Regular* = NOS Nieuws `feeds.nos.nl/nosnieuwsalgemeen`. NOS's own "Journaal in Makkelijke Taal" is a daily video, not text, so it isn't used. Feed text is used when the feed carries the full article (≥ 600 chars); otherwise the article page is fetched through the app's guarded fetcher (`safeFetch`, NOS hosts only) and run through the existing article extractor. If that fails: the summary and an "Open on NOS" link.
- **Tap a word:** its dictionary form (nouns with de/het), meaning *in this sentence*, which form it is ("plural", "past tense"), an occasional learner note — from Claude Haiku via the function, with the app's existing `ANTHROPIC_API_KEY`. "Translate sentence" on request. **Add to my words** saves the dictionary form + meaning, the sentence, the form it had and the article title into a fixed lesson, **"From your reading" › "Words from the news"** (`lesson: "nl-read"`; marked provisional since the meaning comes from AI). Words you know / are learning / have saved are underlined in the text.
- **Caching / egress:** nothing in Supabase. The function caches feeds 15 min and articles 6 h in memory; the device caches the list 20 min and up to 400 lookups (`live-dutch-news-v1`, `live-dutch-gloss-v1` in localStorage). A lookup already made on this device costs nothing. Lookups need a signed-in session.
- **Needs a Netlify deploy** to work anywhere (the function is new).

## 24. Problem words
- A word whose recognize or produce card has been answered "Again" 4+ times after it was learned (`LEECH_LAPSES`). The hub shows "N problem words — practice them" (all their cards now, due or not); on the card's back a "Problem word" flag and a note field ("a memory trick can help").
- **Notes** work for any word (starter or yours): `state.languageNotes` `{ <entryId>: { text, at } }`, personal `recreate` row, later edit wins, a cleared note stays cleared. Shown on the card back.

## 25. As built (branch `claude/dutch-learning-2`)
- New: `language-verbs.js`, `language-nl-wordorder.js`, `language-cloze.js`, `language-ui-more.js`, `netlify/functions/dutch-reader.js` (+ local route in `server.js`).
- Changed: `language-words.js` (reading words: `ex`, `w`, `src`, the reading lesson), `language-srs.js` (problem words), `language-progress.js` (notes, session kinds verbs / order / cloze / read), `language-ui.js` (hub tiles, Read card, problem words, lesson tiles), `language-ui-cards.js` (notes, problem flag, practice-all mode), `app.js` (`languageNotes`, `callReader`, the Leisure Read card), icons `verbs` / `cloze`.
- Automatic speech in the new screens follows "Play Dutch automatically".
- Tests: `test/language-verbs.test.js` (57 forms checked), `test/language-more.test.js`, `test/language-reader-fn.test.js`; `qa:language` 151/151 (reader stubbed).
- **Not verified:** the live NOS feeds and article extraction (the build sandbox can't reach nos.nl), and Claude's lookups (stubbed in QA). After the deploy: open Read the news on the phone, check both levels list articles, an article opens with full text, and a tap gives a sensible meaning.
