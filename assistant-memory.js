// assistant-memory.js — pure operations on the assistant's saved notes
// (state.aiNotes, config section): categorised, id-addressable so the model can
// revise or forget a note, deduplicated on write, and bounded in size.
//
// Shape: { [category]: [{ id, text, timestamp, updatedAt? }] }. Unknown keys are
// preserved untouched (forward-compatible with older/newer clients).

import { AI_NOTE_CATEGORIES } from "./assistant-tools.js";

export const MAX_NOTES_PER_CATEGORY = 40;
const MAX_NOTE_CHARS = 500;

export const AI_NOTE_LABELS = Object.freeze({
  userPreferences: { label: "User Preferences", context: "USER PREFERENCES", hint: "How Luke likes to work and communicate" },
  patterns: { label: "Usage Patterns", context: "USAGE PATTERNS", hint: "Recurring behaviours and common requests" },
  openThreads: { label: "Open Threads", context: "OPEN THREADS (follow up; forget_note when done)", hint: "Things in progress the assistant should follow up on" },
  appGaps: { label: "App Gaps", context: "APP GAPS", hint: "Things you asked for that the assistant can't do yet" },
  suggestions: { label: "Improvement Ideas", context: "IMPROVEMENT SUGGESTIONS", hint: "Features or changes to consider building" },
});

function normText(t) {
  return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeAiNotes(notes) {
  const src = notes && typeof notes === "object" && !Array.isArray(notes) ? notes : {};
  const out = { ...src };
  for (const cat of AI_NOTE_CATEGORIES) {
    out[cat] = Array.isArray(src[cat]) ? src[cat].filter((n) => n && n.id && String(n.text || "").trim()) : [];
  }
  return out;
}

function findNote(notes, id) {
  for (const cat of AI_NOTE_CATEGORIES) {
    const idx = (notes[cat] || []).findIndex((n) => n.id === id);
    if (idx >= 0) return { cat, idx };
  }
  return null;
}

// Each op returns { notes, message } — `notes` is a NEW object (input untouched)
// or the same object when nothing changed.
export function addNote(notes, category, text, { makeId, now }) {
  const n = normalizeAiNotes(notes);
  const clean = String(text || "").trim().slice(0, MAX_NOTE_CHARS);
  if (!AI_NOTE_CATEGORIES.includes(category)) {
    return { notes, message: `Invalid category "${category}". Use one of: ${AI_NOTE_CATEGORIES.join(", ")}` };
  }
  if (!clean) return { notes, message: "No note text provided." };
  const key = normText(clean);
  for (const cat of AI_NOTE_CATEGORIES) {
    const dup = n[cat].find((x) => normText(x.text) === key);
    if (dup) return { notes, message: `Already noted (${dup.id}) — nothing added.` };
  }
  const list = [...n[category], { id: makeId(), text: clean, timestamp: now }];
  // Bounded: the oldest note in the category drops off first.
  n[category] = list.slice(-MAX_NOTES_PER_CATEGORY);
  return { notes: n, message: `Note saved to ${category}.` };
}

export function updateNote(notes, id, text, { now }) {
  const n = normalizeAiNotes(notes);
  const clean = String(text || "").trim().slice(0, MAX_NOTE_CHARS);
  if (!clean) return { notes, message: "No note text provided." };
  const at = findNote(n, String(id || ""));
  if (!at) return { notes, message: `No note with id "${id}".` };
  n[at.cat] = n[at.cat].map((x, i) => (i === at.idx ? { ...x, text: clean, updatedAt: now } : x));
  return { notes: n, message: `Note ${id} updated.` };
}

export function forgetNote(notes, id) {
  const n = normalizeAiNotes(notes);
  const at = findNote(n, String(id || ""));
  if (!at) return { notes, message: `No note with id "${id}".` };
  const removed = n[at.cat][at.idx];
  n[at.cat] = n[at.cat].filter((_, i) => i !== at.idx);
  return { notes: n, message: `Forgot note: "${removed.text}"` };
}

// The ASSISTANT MEMORY block sent with the chat context. Ids are included so the
// model can address notes with update_note / forget_note.
export function formatNotesContext(notes) {
  const n = normalizeAiNotes(notes);
  const lines = [];
  for (const cat of AI_NOTE_CATEGORIES) {
    if (!n[cat].length) continue;
    lines.push(`${AI_NOTE_LABELS[cat].context}:`);
    n[cat].forEach((x) => lines.push(`  - [${x.id}] ${x.text}`));
  }
  return lines.length ? `ASSISTANT MEMORY (from previous conversations):\n${lines.join("\n")}` : "";
}
