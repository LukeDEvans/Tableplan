// Calendar projection — pure transforms that turn stored events into the
// per-range instance lists the Day/Week/Month/Agenda renderers draw, plus a
// conflict detector. Extracted from app.js's getPlanEventsForRange so the
// event-shaping logic is testable independently of app state and the DOM.
//
// These functions never read app state: callers pass in the events and range,
// and the renderers keep ownership of all DOM building.
import { expandRecurringOccurrences } from "./recurrence.js";

// Private copy of app.js's dateKeyFromDate (see recurrence.js for the rationale).
function dateKeyFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Expand ONE stored event into the concrete date-instances that fall inside
// [startKey, endKey]. Mirrors the "personal event" branch of getPlanEventsForRange
// exactly: recurrence wins over a multi-day span, which wins over a single date.
//
// Returns an array of shallow instance descriptors:
//   recurring → { date, occurrenceOf: event.id }
//   multi-day → { date, occurrenceOf: event.id, spanPos: "start"|"mid"|"end" }
//   single    → { date }
// The caller spreads these onto the event ({ ...event, ...instance }).
export function eventInstancesInRange(event, startKey, endKey) {
  const out = [];
  if (event.recurrence) {
    expandRecurringOccurrences(event, startKey, endKey).forEach((occDate) => {
      out.push({ date: occDate, occurrenceOf: event.id });
    });
  } else if (event.endDate && event.endDate > event.date) {
    // Multi-day: one instance per spanned day within the visible range.
    let d = new Date((event.date > startKey ? event.date : startKey) + "T00:00:00");
    const last = event.endDate < endKey ? event.endDate : endKey;
    let g = 0;
    while (g++ < 400) {
      const k = dateKeyFromDate(d);
      if (k > last) break;
      if (k >= event.date) {
        const spanPos = k === event.date ? "start" : (k === event.endDate ? "end" : "mid");
        out.push({ date: k, occurrenceOf: event.id, spanPos });
      }
      d.setDate(d.getDate() + 1);
    }
  } else if (event.date >= startKey && event.date <= endKey) {
    out.push({ date: event.date });
  }
  return out;
}

// Display order: all-day events first, then by start time. Sorts in place and
// returns the same array (faithful to getPlanEventsForRange's final sort).
export function sortEventsForDisplay(events) {
  events.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return (a.startTime || "00:00").localeCompare(b.startTime || "00:00");
  });
  return events;
}

// Parse "HH:MM" → minutes since midnight; null when absent/malformed.
function minutes(t) {
  if (typeof t !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(mins) ? mins : null;
}

// Two timed events on the same date conflict when their [start,end) intervals
// overlap. An event with no end time is treated as a zero-length point at its
// start (so it conflicts only with an interval that strictly contains that
// instant). All-day and untimed events never conflict — they don't occupy a slot.
// §22: conflicts are surfaced, never auto-resolved.
export function eventsOverlap(a, b) {
  if (a.date !== b.date) return false;
  if (a.allDay || b.allDay) return false;
  const aStart = minutes(a.startTime);
  const bStart = minutes(b.startTime);
  if (aStart === null || bStart === null) return false;
  const aEnd = minutes(a.endTime);
  const bEnd = minutes(b.endTime);
  const aE = aEnd === null ? aStart : aEnd;
  const bE = bEnd === null ? bStart : bEnd;
  return aStart < bE && bStart < aE;
}

// Given the instance list for a range, return the Set of instance ids that
// overlap at least one other event. Pure; used by the Day/Week conflict marker.
export function conflictsFor(events) {
  const conflicted = new Set();
  const timed = events.filter((e) => !e.allDay && minutes(e.startTime) !== null);
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      if (eventsOverlap(timed[i], timed[j])) {
        conflicted.add(timed[i].id);
        conflicted.add(timed[j].id);
      }
    }
  }
  return conflicted;
}
