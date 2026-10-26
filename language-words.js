// Your own words (LANGUAGE_PRACTICE.md §11). Pure: no DOM, no storage, no clock
// of its own. Luke copies his Rosetta Stone lessons in by pasting lines; this
// module parses the paste, keeps the two synced maps, merges them, and builds
// the course every exercise reads (your lessons first, then the starter set).
//
//   state.languageUserLessons { <lessonId>: { unit, lesson, unitTitle, title, at, del? } }
//   state.languageUserWords   { <id>: { kind: "word"|"sentence", text, en, alsoEn?,
//                                        lesson, note?, at, del? } }
//
// `at` is an ISO time. Per id the later `at` wins when two copies merge, and a
// deletion is a tombstone (`del: true` with a newer `at`), so a copy that still
// has the word can't bring it back. A missing id is never a deletion: an older
// app build that drops these keys can't erase anything.

export const USER_LEVEL_ID = "nl-user";
export const USER_SOURCE_ID = "rosetta-user";
export const USER_SOURCE = Object.freeze({
  kind: "rosetta-stone",
  title: "Your Rosetta Stone Dutch course, copied in by you",
  retrieved: "",
  confidence: "Copied from the course by the learner",
  curriculumVersion: "copied",
});

const str = (v) => (typeof v === "string" ? v : "");
const clean = (v) => str(v).replace(/\s+/g, " ").trim();
const posInt = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 && n < 1000 ? n : 0;
};

// ── Lesson ids ─────────────────────────────────────────────────────────────
// Deterministic from the unit and lesson numbers, so pasting into "Unit 2,
// Lesson 3" on two devices lands in the same lesson and merges cleanly.
export const userUnitId = (unit) => `nl-u${unit}`;
export const userLessonId = (unit, lesson) => `nl-u${unit}-${lesson}`;

// ── Paste parsing ──────────────────────────────────────────────────────────
// Separators, tried in order. A bare hyphen inside a word ("e-mail") never
// splits; " - " (with spaces) does.
const SEPARATORS = [/\t+/, /\s+=\s+|\s*=\s*/, /\s+[—–]\s+|\s*[—–]\s*/, /\s+:\s+/, /\s+-\s+/];

// Strips list bullets and numbering a copy from a web page often brings along.
function stripBullet(line) {
  return line.replace(/^\s*(?:[-*•·]|\d{1,3}[.)])\s+/, "");
}

export function splitLine(line) {
  const raw = stripBullet(str(line)).trim();
  if (!raw) return null;
  for (const sep of SEPARATORS) {
    const m = raw.match(sep);
    if (!m) continue;
    const i = m.index;
    const left = raw.slice(0, i).trim();
    const right = raw.slice(i + m[0].length).trim();
    if (left && right) return { left, right };
  }
  return { left: raw, right: "" };
}

// English alternatives: "to walk; to go" or "big / large".
export function splitEnglish(right) {
  const parts = str(right).split(/\s*;\s*|\s+\/\s+/).map(clean).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  }
  return out;
}

const ARTICLE_RE = /^(de|het)\s+(\S.*)$/i;

// A line reads like a sentence when it ends in . ? ! or has 4+ words. Short
// phrases ("dank je wel") stay words: they make good flashcards.
export function looksLikeSentence(text) {
  const t = clean(text);
  if (/[.?!]$/.test(t) && !/\.\.\.$|…$/.test(t)) return true;
  return t.split(" ").length >= 4;
}

export function genderOf(text) {
  const m = clean(text).match(ARTICLE_RE);
  if (!m || looksLikeSentence(text)) return "";
  return m[1].toLowerCase();
}

// Returns one item per non-empty line:
//   { line, text, en, alsoEn, kind, gender, error? }
// `error` is "no-english" when the line had no separator or nothing after it.
export function parsePaste(input) {
  const out = [];
  const lines = str(input).replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((line, i) => {
    const parts = splitLine(line);
    if (!parts) return;
    const text = clean(parts.left);
    const en = splitEnglish(parts.right);
    const item = {
      line: i + 1,
      text,
      en: en[0] || "",
      alsoEn: en.slice(1),
      kind: looksLikeSentence(text) ? "sentence" : "word",
      gender: genderOf(text),
    };
    if (!item.en) item.error = "no-english";
    else if (text.toLowerCase() === item.en.toLowerCase()) item.error = "same";
    out.push(item);
  });
  return out;
}

// ── Normalizing and merging the two maps ───────────────────────────────────
function cleanLesson(l) {
  if (!l || typeof l !== "object") return null;
  const unit = posInt(l.unit);
  const lesson = posInt(l.lesson);
  if (!unit || !lesson) return null;
  const out = { unit, lesson, unitTitle: clean(l.unitTitle).slice(0, 80), title: clean(l.title).slice(0, 80), at: str(l.at) };
  if (l.del) out.del = true;
  return out;
}

export function normalizeUserLessons(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, l] of Object.entries(raw)) {
    const c = cleanLesson(l);
    if (c && id === userLessonId(c.unit, c.lesson)) out[id] = c;
  }
  return out;
}

function cleanWord(w) {
  if (!w || typeof w !== "object") return null;
  const text = clean(w.text).slice(0, 300);
  const en = clean(w.en).slice(0, 300);
  const lesson = str(w.lesson);
  if (!lesson) return null;
  const out = { kind: w.kind === "sentence" ? "sentence" : "word", text, en, lesson, at: str(w.at) };
  const alsoEn = Array.isArray(w.alsoEn) ? w.alsoEn.map(clean).filter(Boolean).slice(0, 6) : [];
  if (alsoEn.length) out.alsoEn = alsoEn;
  const note = clean(w.note).slice(0, 200);
  if (note) out.note = note;
  if (w.del) out.del = true;
  // A live word needs both sides; a tombstone may have neither.
  if (!out.del && (!text || !en)) return null;
  return out;
}

export function normalizeUserWords(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, w] of Object.entries(raw)) {
    const c = cleanWord(w);
    if (id && c) out[id] = c;
  }
  return out;
}

// Later `at` wins per id; on a tie the first argument (the newer copy) wins.
function mergeByAt(a, b) {
  const out = { ...a };
  for (const [id, vb] of Object.entries(b)) {
    const va = out[id];
    if (!va || (vb.at || "") > (va.at || "")) out[id] = vb;
  }
  return out;
}

export function mergeUserLessons(newer, older) {
  return mergeByAt(normalizeUserLessons(newer), normalizeUserLessons(older));
}

export function mergeUserWords(newer, older) {
  return mergeByAt(normalizeUserWords(newer), normalizeUserWords(older));
}

// ── Editing ────────────────────────────────────────────────────────────────
export function newWordId(rng = Math.random, now = Date.now()) {
  const r = Math.floor(rng() * 36 ** 6).toString(36).padStart(6, "0");
  return `nlw-${now.toString(36)}${r}`;
}

// Adds (or revives, or retitles) a lesson. Titles left blank keep what's there.
export function upsertUserLesson(lessons, { unit, lesson, unitTitle = "", title = "" }, at) {
  const u = posInt(unit);
  const l = posInt(lesson);
  if (!u || !l) return { lessons: normalizeUserLessons(lessons), id: "" };
  const all = normalizeUserLessons(lessons);
  const id = userLessonId(u, l);
  const prev = all[id] && !all[id].del ? all[id] : null;
  // A unit title is shared by the unit's lessons: setting it on one sets it on all.
  const ut = clean(unitTitle) || prev?.unitTitle || unitTitleOf(all, u);
  all[id] = { unit: u, lesson: l, unitTitle: ut, title: clean(title) || prev?.title || "", at };
  if (clean(unitTitle)) {
    for (const [k, v] of Object.entries(all)) {
      if (k !== id && v.unit === u && !v.del && v.unitTitle !== ut) all[k] = { ...v, unitTitle: ut, at };
    }
  }
  return { lessons: all, id };
}

function unitTitleOf(lessons, unit) {
  for (const v of Object.values(lessons)) if (v.unit === unit && !v.del && v.unitTitle) return v.unitTitle;
  return "";
}

const key = (s) => clean(s).toLowerCase();

// Adds parsed paste items to a lesson. Skips lines with errors, and anything
// whose Dutch already exists in that lesson. Returns what happened.
export function addPastedWords(words, lessonId, items, { at, rng = Math.random, now = Date.now() } = {}) {
  const all = normalizeUserWords(words);
  const existing = new Set(Object.values(all).filter((w) => !w.del && w.lesson === lessonId).map((w) => key(w.text)));
  const added = [];
  const skipped = [];
  let n = 0;
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || it.error || !clean(it.text) || !clean(it.en)) { skipped.push({ ...it, reason: it?.error || "empty" }); continue; }
    if (existing.has(key(it.text))) { skipped.push({ ...it, reason: "duplicate" }); continue; }
    let id = newWordId(rng, now + n);
    while (all[id]) id = newWordId(rng, now + (n += 1));
    n += 1;
    const w = cleanWord({ kind: it.kind, text: it.text, en: it.en, alsoEn: it.alsoEn, lesson: lessonId, note: it.note, at });
    if (!w) { skipped.push({ ...it, reason: "empty" }); continue; }
    all[id] = w;
    existing.add(key(it.text));
    added.push(id);
  }
  return { words: all, added, skipped };
}

export function editUserWord(words, id, patch, at) {
  const all = normalizeUserWords(words);
  if (!all[id] || all[id].del) return all;
  const next = cleanWord({ ...all[id], ...patch, at });
  if (next) all[id] = next;
  return all;
}

export function deleteUserWord(words, id, at) {
  const all = normalizeUserWords(words);
  if (!all[id]) return all;
  all[id] = { kind: all[id].kind, text: "", en: "", lesson: all[id].lesson, at, del: true };
  return all;
}

// Deleting a lesson deletes its words too (each gets its own tombstone).
export function deleteUserLesson(lessons, words, lessonId, at) {
  const ls = normalizeUserLessons(lessons);
  let ws = normalizeUserWords(words);
  if (ls[lessonId]) ls[lessonId] = { ...ls[lessonId], at, del: true };
  for (const [id, w] of Object.entries(ws)) if (w.lesson === lessonId && !w.del) ws = deleteUserWord(ws, id, at);
  return { lessons: ls, words: ws };
}

// ── The course every exercise reads ────────────────────────────────────────
// Your lessons (if any) form the first level, "Your course"; the starter set
// follows unless hidden. Sentences go in `course.sentences`, not `entries`:
// long lines don't belong on the matching board or a word flashcard.
export function buildCourse(base, userLessons, userWords, { showStarter = true, starterSentences = [] } = {}) {
  const lessons = Object.entries(normalizeUserLessons(userLessons)).filter(([, l]) => !l.del);
  const words = Object.entries(normalizeUserWords(userWords)).filter(([, w]) => !w.del);
  const liveLessonIds = new Set(lessons.map(([id]) => id));

  const byUnit = new Map();
  for (const [id, l] of lessons.sort((a, b) => a[1].unit - b[1].unit || a[1].lesson - b[1].lesson)) {
    if (!byUnit.has(l.unit)) byUnit.set(l.unit, { id: userUnitId(l.unit), title: l.unitTitle ? `Unit ${l.unit}: ${l.unitTitle}` : `Unit ${l.unit}`, lessons: [] });
    byUnit.get(l.unit).lessons.push({ id, title: l.title ? `Lesson ${l.lesson}: ${l.title}` : `Lesson ${l.lesson}`, user: true });
  }
  const userUnits = [...byUnit.values()];
  const unitOf = new Map(lessons.map(([id, l]) => [id, userUnitId(l.unit)]));

  const userEntries = [];
  const userSentences = [];
  // Insertion order within a lesson is the paste order (ids carry the time).
  for (const [id, w] of words.sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!liveLessonIds.has(w.lesson)) continue;
    const e = {
      id, lang: base.lang, text: w.text, en: w.en,
      level: USER_LEVEL_ID, unit: unitOf.get(w.lesson), lesson: w.lesson,
      source: USER_SOURCE_ID, verification: "verified", user: true,
      ...(w.alsoEn ? { alsoEn: w.alsoEn } : {}),
      ...(w.note ? { note: w.note } : {}),
    };
    (w.kind === "sentence" ? userSentences : userEntries).push(e);
  }

  const levels = [];
  if (userUnits.length) levels.push({ id: USER_LEVEL_ID, title: "Your course", user: true, units: userUnits });
  if (showStarter || !userUnits.length) levels.push(...(base.levels || []));
  const starterOn = showStarter || !userUnits.length;
  return {
    ...base,
    sources: { ...(base.sources || {}), [USER_SOURCE_ID]: USER_SOURCE },
    levels,
    entries: [...userEntries, ...(starterOn ? base.entries || [] : [])],
    sentences: [...userSentences, ...(starterOn ? starterSentences : [])],
    hasUserCourse: userUnits.length > 0,
  };
}

// Every word (not sentence) in the course, in course order: user lessons by
// unit/lesson, then the starter set. Flashcards introduce new words in this order.
export function entriesInCourseOrder(course) {
  const order = new Map();
  let i = 0;
  for (const level of course.levels || []) for (const unit of level.units || []) for (const l of unit.lessons || []) order.set(l.id, i++);
  return (course.entries || [])
    .map((e, k) => ({ e, k }))
    .filter(({ e }) => order.has(e.lesson))
    .sort((a, b) => order.get(a.e.lesson) - order.get(b.e.lesson) || a.k - b.k)
    .map(({ e }) => e);
}
