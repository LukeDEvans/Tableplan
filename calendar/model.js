// Canonical calendar-event model — pure, extracted byte-faithfully from app.js.
// normalizePlanEvents is the single boundary every stored local event passes
// through, so its shape IS the canonical Event. Kept dependency-free (only the
// recurrence normalizer) so it can be unit-tested and, in later phases, shared
// with the external-source pipeline.
import { normalizeRecurrence } from "./recurrence.js";

// Private copy of app.js's createId (used only to mint an id for an event that
// arrives without one). Duplicated rather than imported to keep this module free
// of app.js; behavior is identical.
function createId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizePlanEvents(events) {
  return Array.isArray(events) ? events.map((e) => ({
    id: e?.id || createId("plan-evt"),
    title: String(e?.title || "").trim(),
    date: String(e?.date || "").trim(),
    startTime: e?.startTime ? String(e.startTime).trim() : null,
    endTime: e?.endTime ? String(e.endTime).trim() : null,
    allDay: e?.allDay !== false,
    color: e?.color ? String(e.color) : null,
    calendarId: e?.calendarId ? String(e.calendarId) : null,
    notes: String(e?.notes || "").trim(),
    location: (e?.location && typeof e.location === "object") ? e.location : null,
    attachment: (e?.attachment && typeof e.attachment === "object") ? e.attachment : null,
    recurrence: normalizeRecurrence(e?.recurrence),
    exceptions: Array.isArray(e?.exceptions) ? e.exceptions.filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) : [],
    addToDo: Boolean(e?.addToDo),
    chores: Array.isArray(e?.chores) ? e.chores.map((c) => String(c || "").trim()).filter(Boolean) : [],
    // When on, the event shows on the meal plan in whichever meal column(s) its
    // time of day falls into (all-day / untimed events show on every meal).
    showInMealPlan: Boolean(e?.showInMealPlan),
    reminder: Number.isFinite(e?.reminder) ? e.reminder : null,
    endDate: (typeof e?.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.endDate)) ? e.endDate : null,
    createdAt: e?.createdAt || new Date().toISOString()
  })).filter((e) => e.date && e.title) : [];
}
