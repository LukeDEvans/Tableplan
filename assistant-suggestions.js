// assistant-suggestions.js — deterministic, proactive suggestions for the
// assistant panel ("your trip is Friday and nothing's packed — want a list?").
//
// Pure rules over a small snapshot the shell builds from its own domain readers
// (so this module never reaches into another domain's internals). No model call,
// no timer, no network: suggestions are recomputed when the chat panel opens.
// Accepting one either sends a prompt to the assistant (which then acts through
// the normal typed tools, with confirmation/undo) or runs a single typed tool.
//
// Dismissals live in state.aiSettings.dismissedSuggestions ({ id: dateKey }).
// Ids embed the period they apply to (trip id, birthday year, date), so a
// dismissal silences exactly that occurrence and nothing later.

import { daysUntilAnnual, addDaysKey, weekdayLabel } from "./assistant-queries.js";

const MAX_SUGGESTIONS = 4;
const DISMISS_RETENTION_DAYS = 60;

function daysUntil(todayKey, key) {
  return Math.round((new Date(`${key}T12:00:00`) - new Date(`${todayKey}T12:00:00`)) / 86400000);
}

function whenLabel(days) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

// snapshot: {
//   todayKey,                                     // "YYYY-MM-DD" (local)
//   trips: [{ id, name, startDate, status, packingCount }],
//   contacts: [{ id, name, birthday }],
//   tomorrowEvents: [{ title, startTime, allDay }],
//   dinnerPlannedToday: boolean | null,           // null = no meal-plan week
//   backlogOpenCount: number,
//   bills: [{ name, expectedDay, lastAmount }] | null,   // null unless finance access is on
// }
export function computeSuggestions(snapshot, dismissed = {}) {
  const s = snapshot || {};
  const today = s.todayKey;
  if (!today) return [];
  const out = [];
  const push = (sug) => { if (!dismissed?.[sug.id]) out.push(sug); };

  // Upcoming trips: nothing packed yet → offer a packing list.
  for (const t of s.trips || []) {
    if (!t?.startDate || t.status === "idea") continue;
    const d = daysUntil(today, t.startDate);
    if (d < 0 || d > 10) continue;
    if (!(t.packingCount > 0)) {
      push({
        id: `trip-pack:${t.id}`, priority: 10 - d,
        title: `${t.name} starts ${whenLabel(d)}`,
        detail: "Nothing on the packing list yet.",
        cta: "Draft packing list",
        action: { type: "prompt", text: `My trip "${t.name}" starts ${t.startDate}. Draft a packing list for it (use the trip's destination and dates) and add it to the trip.` },
      });
    } else if (d <= 2) {
      push({
        id: `trip-prep:${t.id}`, priority: 8,
        title: `${t.name} starts ${whenLabel(d)}`,
        detail: "Want a quick pre-trip rundown?",
        cta: "Trip rundown",
        action: { type: "prompt", text: `My trip "${t.name}" starts ${t.startDate}. Give me a short pre-trip rundown: weather at the destination if you know it, anything on my calendar that conflicts, and what's still unpacked.` },
      });
    }
  }

  // Birthdays within a week → a reminder task.
  for (const c of s.contacts || []) {
    const d = daysUntilAnnual(c?.birthday, today);
    if (d == null || d > 7) continue;
    const occYear = addDaysKey(today, d).slice(0, 4);
    push({
      id: `bday:${c.id}:${occYear}`, priority: d <= 1 ? 9 : 6,
      title: `${c.name}'s birthday is ${whenLabel(d)}`,
      detail: d === 0 ? "Send a note today?" : "Add a reminder so it isn't missed?",
      cta: d === 0 ? "Remind me today" : "Add reminder task",
      action: { type: "tool", name: "add_task", input: { title: `${c.name}'s birthday (${weekdayLabel(addDaysKey(today, d))}) — card / message`, day_id: "backlog" } },
    });
  }

  // An early start tomorrow.
  const early = (s.tomorrowEvents || [])
    .filter((e) => e && !e.allDay && /^\d{2}:\d{2}/.test(e.startTime || "") && e.startTime < "08:30")
    .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
  if (early) {
    push({
      id: `early:${addDaysKey(today, 1)}`, priority: 5,
      title: `Early start tomorrow: ${early.title} at ${early.startTime}`,
      detail: "Want to plan the evening around it?",
      cta: "Plan tonight",
      action: { type: "prompt", text: `I have "${early.title}" at ${early.startTime} tomorrow. What should I get done tonight so the morning goes smoothly? Check my tasks and meal plan.` },
    });
  }

  // No dinner planned today (only when there IS a plan week to fill).
  if (s.dinnerPlannedToday === false) {
    push({
      id: `dinner:${today}`, priority: 4,
      title: "No dinner planned tonight",
      detail: "Pick something from your recipes?",
      cta: "Suggest dinner",
      action: { type: "prompt", text: "Nothing is planned for dinner tonight. Suggest two or three of my recipes that fit, and add the one I pick to tonight's meal plan." },
    });
  }

  // Bills expected in the next 3 days (finance access only).
  if (Array.isArray(s.bills)) {
    const month = today.slice(0, 7);
    const dayNum = Number(today.slice(8, 10));
    const due = s.bills.filter((b) => {
      const gap = (Number(b?.expectedDay) || 0) - dayNum;
      return gap >= 0 && gap <= 3;
    });
    if (due.length) {
      const names = due.slice(0, 3).map((b) => `${b.name}${b.lastAmount ? ` (~$${Math.round(b.lastAmount)})` : ""}`).join(", ");
      push({
        id: `bills:${month}-${String(dayNum).padStart(2, "0")}`, priority: 3,
        title: `${due.length} recurring charge${due.length === 1 ? "" : "s"} due soon`,
        detail: names,
        cta: "Review charges",
        action: { type: "prompt", text: "Which recurring charges are due in the next few days, and how do they compare with what I paid last time?" },
      });
    }
  }

  // A long backlog → offer a triage pass (at most once a month).
  if ((s.backlogOpenCount || 0) >= 15) {
    push({
      id: `backlog:${today.slice(0, 7)}`, priority: 1,
      title: `${s.backlogOpenCount} tasks in the backlog`,
      detail: "Want help picking what to do this week?",
      cta: "Triage backlog",
      action: { type: "prompt", text: "Look at my backlog and suggest the 3–5 tasks most worth scheduling this week, and which ones look stale enough to drop. Don't change anything until I say." },
    });
  }

  return out.sort((a, b) => b.priority - a.priority).slice(0, MAX_SUGGESTIONS);
}

// Drop dismissals older than the retention window so the map can't grow forever.
export function pruneDismissed(dismissed, todayKey, keepDays = DISMISS_RETENTION_DAYS) {
  const out = {};
  for (const [id, when] of Object.entries(dismissed || {})) {
    if (typeof when === "string" && daysUntil(when, todayKey) <= keepDays) out[id] = when;
  }
  return out;
}
