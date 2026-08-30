// Task → Calendar projection (spec §24–26). Tasks are a SEPARATE domain from
// Events; the Calendar consumes them through this pure projection and never
// converts a Task into an Event. A projected task is tagged `isTask: true` so
// renderers can keep Tasks visually distinct from Events (§25).
//
// Grounded in the app's current Task shape: a task belongs to a planner day and
// carries an optional time-of-day (`time`, "HH:MM" or "") plus a `done` flag.
// The three temporal states follow from that:
//   scheduled   — has a concrete time slot on its day
//   due         — assigned to a day/date but no time (shows on the date, no slot)
//   unscheduled — neither (stays in the Tasks list; e.g. backlog)
//
// The caller annotates each task with the calendar date it resolves to
// (`dateKey`, "YYYY-MM-DD") before handing it here, because the day→date mapping
// lives in app state; everything below is a pure function of its arguments.

// "HH:MM" (24h) → minutes since midnight, or null when absent/malformed.
export function taskTimeMinutes(task) {
  const t = task?.time;
  if (typeof t !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// Whether the task has a usable time-of-day slot.
export function taskIsScheduled(task) {
  return taskTimeMinutes(task) !== null;
}

// Classify a task into its calendar temporal state.
export function taskCalendarState(task) {
  if (taskIsScheduled(task)) return "scheduled";
  if (task?.dateKey || task?.dayId || task?.due || task?.weekKey) return "due";
  return "unscheduled";
}

// Project a dated task into a calendar-facing descriptor. Returns null for an
// unscheduled task (nothing to place on the grid). The descriptor is deliberately
// minimal and marked `isTask` so it never gets confused with an Event.
export function projectTask(task) {
  const state = taskCalendarState(task);
  if (state === "unscheduled") return null;
  return {
    isTask: true,
    kind: "task",
    id: task.id,
    taskId: task.id,
    title: String(task?.title || "").trim(),
    done: Boolean(task?.done),
    dateKey: task?.dateKey || null,
    time: state === "scheduled" ? task.time : null,
    startMinutes: state === "scheduled" ? taskTimeMinutes(task) : null,
    state // "scheduled" | "due"
  };
}

// Split the dated tasks that fall on a given date into scheduled vs due buckets,
// scheduled ordered by time. `datedTasks` must each carry a `dateKey`.
export function tasksForCalendarDate(datedTasks, dateKey) {
  const scheduled = [];
  const due = [];
  for (const task of datedTasks || []) {
    if ((task?.dateKey || null) !== dateKey) continue;
    const p = projectTask(task);
    if (!p) continue;
    if (p.state === "scheduled") scheduled.push(p);
    else due.push(p);
  }
  scheduled.sort((a, b) => (a.startMinutes ?? 0) - (b.startMinutes ?? 0));
  return { scheduled, due };
}

// Compact per-date task counts for the Month view (§25: indicators, not a flood).
// Returns a Map dateKey → { scheduled, due, total }.
export function taskCountsByDate(datedTasks) {
  const counts = new Map();
  for (const task of datedTasks || []) {
    const key = task?.dateKey;
    if (!key) continue;
    const p = projectTask(task);
    if (!p) continue;
    const c = counts.get(key) || { scheduled: 0, due: 0, total: 0 };
    if (p.state === "scheduled") c.scheduled++; else c.due++;
    c.total++;
    counts.set(key, c);
  }
  return counts;
}
