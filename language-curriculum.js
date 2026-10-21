// Language practice curriculum (LANGUAGE_PRACTICE.md). Pure: no DOM, no network,
// no storage. A course is plain data (see language-nl-starter.js):
//
//   course = {
//     lang: "nl", label: "Dutch",
//     sources: { <sourceId>: { kind, title, retrieved, confidence, curriculumVersion, url? } },
//     levels: [{ id, title, units: [{ id, title, lessons: [{ id, title }] }] }],
//     entries: [{ id, lang, text, en, alsoEn?, level, unit, lesson, source,
//                 verification: "provisional" | "verified", audio?, note?, tags? }],
//   }
//
// `text` is the word or phrase in the course's language; `en` its English. An
// entry id is stable forever: progress is keyed by it, so never renumber or reuse
// one (retire it instead).
//
// "verified" means the entry was checked against a named Rosetta Stone course
// version. Only a source with kind "rosetta-stone" AND a curriculumVersion may
// back a verified entry; validateCourse() refuses anything else, so a provisional
// word can never be shown as verified.

export const VERIFICATION = Object.freeze({ PROVISIONAL: "provisional", VERIFIED: "verified" });
const VERIFICATION_VALUES = new Set(Object.values(VERIFICATION));

// Forms compared when deciding whether two cards could be confused: lower case,
// accents kept (een ≠ één), punctuation and extra spaces dropped. A leading
// English "to " is dropped so "to walk" and "walk" count as the same answer.
export function normalizeForm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[.,!?;:¿¡"“”'’()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^to /, "");
}

// Every English form an entry answers to (its `en` plus any `alsoEn`).
export function englishForms(entry) {
  return [entry.en, ...(Array.isArray(entry.alsoEn) ? entry.alsoEn : [])].map(normalizeForm).filter(Boolean);
}

export function lessonsInOrder(course) {
  const out = [];
  for (const level of course.levels || []) {
    for (const unit of level.units || []) {
      for (const lesson of unit.lessons || []) out.push({ ...lesson, unitId: unit.id, levelId: level.id });
    }
  }
  return out;
}

export function findLesson(course, lessonId) {
  return lessonsInOrder(course).find((l) => l.id === lessonId) || null;
}

export function findUnit(course, unitId) {
  for (const level of course.levels || []) {
    const unit = (level.units || []).find((u) => u.id === unitId);
    if (unit) return { ...unit, levelId: level.id };
  }
  return null;
}

export function entriesForLesson(course, lessonId) {
  return (course.entries || []).filter((e) => e.lesson === lessonId);
}

// Returns a list of problems (empty when the course is sound). The tests run it
// on every shipped course, so bad data fails CI rather than reaching the game.
export function validateCourse(course) {
  const errors = [];
  if (!course || typeof course !== "object") return ["course missing"];
  if (!course.lang) errors.push("course.lang missing");
  const sources = course.sources || {};
  const lessons = new Map();
  const seenStructure = new Set();
  for (const level of course.levels || []) {
    if (!level.id || seenStructure.has(level.id)) errors.push(`level id missing or duplicate: ${level.id}`);
    seenStructure.add(level.id);
    for (const unit of level.units || []) {
      if (!unit.id || seenStructure.has(unit.id)) errors.push(`unit id missing or duplicate: ${unit.id}`);
      seenStructure.add(unit.id);
      for (const lesson of unit.lessons || []) {
        if (!lesson.id || seenStructure.has(lesson.id)) errors.push(`lesson id missing or duplicate: ${lesson.id}`);
        seenStructure.add(lesson.id);
        lessons.set(lesson.id, { level: level.id, unit: unit.id });
      }
    }
  }
  const ids = new Set();
  const formsByLesson = new Map(); // lessonId -> { text: Set, en: Set }
  for (const e of course.entries || []) {
    const where = `entry ${e?.id || "(no id)"}`;
    if (!e?.id) { errors.push(`${where}: id missing`); continue; }
    if (ids.has(e.id)) errors.push(`${where}: duplicate id`);
    ids.add(e.id);
    if (e.lang !== course.lang) errors.push(`${where}: lang "${e.lang}" ≠ course "${course.lang}"`);
    if (!String(e.text || "").trim()) errors.push(`${where}: text missing`);
    if (!String(e.en || "").trim()) errors.push(`${where}: en missing`);
    if (normalizeForm(e.text) === normalizeForm(e.en)) errors.push(`${where}: text and English are the same, nothing to match`);
    const place = lessons.get(e.lesson);
    if (!place) errors.push(`${where}: lesson "${e.lesson}" not in the course`);
    else if (place.unit !== e.unit || place.level !== e.level) errors.push(`${where}: level/unit don't match lesson "${e.lesson}"`);
    if (!VERIFICATION_VALUES.has(e.verification)) errors.push(`${where}: verification must be provisional or verified`);
    const src = sources[e.source];
    if (!src) errors.push(`${where}: source "${e.source}" not declared`);
    if (e.verification === VERIFICATION.VERIFIED && !(src?.kind === "rosetta-stone" && src?.curriculumVersion)) {
      errors.push(`${where}: verified needs a rosetta-stone source with a curriculumVersion`);
    }
    if (src?.kind === "rosetta-stone" && e.verification !== VERIFICATION.VERIFIED) {
      errors.push(`${where}: a rosetta-stone source must be marked verified (or use a provisional source)`);
    }
    // Within one lesson two cards must never answer each other.
    if (place) {
      const f = formsByLesson.get(e.lesson) || { text: new Set(), en: new Set() };
      const t = normalizeForm(e.text);
      if (f.text.has(t)) errors.push(`${where}: "${e.text}" appears twice in ${e.lesson}`);
      f.text.add(t);
      for (const en of englishForms(e)) {
        if (f.en.has(en)) errors.push(`${where}: English "${en}" appears twice in ${e.lesson}`);
        f.en.add(en);
      }
      formsByLesson.set(e.lesson, f);
    }
  }
  return errors;
}

// ── Practice scopes ────────────────────────────────────────────────────────
// { kind: "lesson", id } · { kind: "unit", id } · { kind: "review", lessonIds }
// A review only ever draws from the lessons it lists; the UI builds that list
// from lessons the person has already practiced (reviewLessonIds).

export function resolveScope(course, scope) {
  if (!scope || !course) return [];
  const entries = course.entries || [];
  if (scope.kind === "lesson") return entries.filter((e) => e.lesson === scope.id);
  if (scope.kind === "unit") return entries.filter((e) => e.unit === scope.id);
  if (scope.kind === "review") {
    const allowed = new Set(Array.isArray(scope.lessonIds) ? scope.lessonIds : []);
    return entries.filter((e) => allowed.has(e.lesson));
  }
  return [];
}

export function scopeKey(scope) {
  if (!scope) return "";
  if (scope.kind === "review") return "review";
  return `${scope.kind}:${scope.id}`;
}

export function scopeLabel(course, scope) {
  if (!scope) return "";
  if (scope.kind === "lesson") {
    const l = findLesson(course, scope.id);
    return l ? l.title : "Lesson";
  }
  if (scope.kind === "unit") {
    const u = findUnit(course, scope.id);
    return u ? u.title : "Unit";
  }
  if (scope.kind === "review") return "Review";
  return "";
}

// Lessons the person has met at least one word of, in course order.
export function reviewLessonIds(course, wordStats) {
  const stats = wordStats && typeof wordStats === "object" ? wordStats : {};
  const practiced = new Set();
  for (const e of course.entries || []) if ((stats[e.id]?.seen || 0) > 0) practiced.add(e.lesson);
  return lessonsInOrder(course).map((l) => l.id).filter((id) => practiced.has(id));
}

// Practice status for a lesson: how many of its words have been seen, and how
// many matched correctly at least once. Not "mastery": one right match proves
// little, so the label stays plain.
export function lessonStatus(course, lessonId, wordStats) {
  const stats = wordStats && typeof wordStats === "object" ? wordStats : {};
  const entries = entriesForLesson(course, lessonId);
  let seen = 0;
  let matched = 0;
  let last = "";
  for (const e of entries) {
    const s = stats[e.id];
    if (!s) continue;
    if ((s.seen || 0) > 0) seen += 1;
    if ((s.c || 0) > 0) matched += 1;
    if (s.last && s.last > last) last = s.last;
  }
  const verified = entries.length > 0 && entries.every((e) => e.verification === VERIFICATION.VERIFIED);
  return { total: entries.length, seen, matched, last, verified };
}
