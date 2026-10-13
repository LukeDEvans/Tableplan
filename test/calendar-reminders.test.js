// Event reminders (IOS_NOTIFICATIONS_DESIGN.md §4–5): per-user prefs, the pure
// scheduling core, the prefs store's egress rules, the iPhone scheduler, and the
// Google reminder metadata in the device cache.
import { describe, it, expect, vi } from "vitest";
import {
  reminderInstances, notificationId, diffSchedule, dueReminders, legacyReminderFolds,
  normalizeReminderPrefs, reminderValueFromSelect, reminderSelectValue, googleReminderKey,
  reminderLeadText, MAX_SCHEDULED_REMINDERS
} from "../calendar/reminders.js";
import { googleReminderMinutes } from "../calendar/google.js";
import { createReminderPrefsStore } from "../calendar/reminder-prefs.js";
import { createNativeReminderScheduler } from "../calendar/reminders-native.js";
import { applyEventsResponse, buildEventsRequest } from "../calendar/google-client.js";

// Local wall-clock helper (tests run in the machine's own time zone, like the app).
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 10, 13, 9, 0); // Tue 13 Oct 2026, 09:00 local

describe("reminder prefs values", () => {
  it("normalizes stored values and drops junk", () => {
    expect(normalizeReminderPrefs({ a: { min: 30 }, b: { off: true }, c: { min: -5 }, d: { min: 2.5 }, e: "x", f: { off: false } }))
      .toEqual({ a: { min: 30 }, b: { off: true } });
    expect(normalizeReminderPrefs(null)).toEqual({});
    expect(normalizeReminderPrefs([1])).toEqual({});
  });
  it("converts between the editor's select and stored values", () => {
    expect(reminderValueFromSelect("")).toEqual({ off: true });
    expect(reminderValueFromSelect("30")).toEqual({ min: 30 });
    expect(reminderValueFromSelect("nope")).toEqual({ off: true });
    expect(reminderSelectValue({ min: 0 })).toBe("0");
    expect(reminderSelectValue({ off: true })).toBe("");
    expect(reminderSelectValue(undefined)).toBe("");
  });
  it("describes lead times in words", () => {
    expect(reminderLeadText(0)).toBe("starting now");
    expect(reminderLeadText(10)).toBe("in 10 min");
    expect(reminderLeadText(60)).toBe("in 1 hour");
    expect(reminderLeadText(1440)).toBe("tomorrow");
    expect(reminderLeadText(90)).toBe("in 1 hr 30 min");
  });
});

describe("legacy shared reminders fold once into the admin's prefs", () => {
  it("folds only events without an entry; a turned-off reminder (tombstone) stays off", () => {
    const events = [
      { id: "a", reminder: 30 },
      { id: "b", reminder: 10 },
      { id: "c", reminder: null },
      { id: "d" },
      { id: "e", reminder: 0 },
      { id: "a", reminder: 5 } // same id in the other scope — first wins
    ];
    expect(legacyReminderFolds(events, { b: { off: true } })).toEqual({ a: { min: 30 }, e: { min: 0 } });
    expect(legacyReminderFolds(events, { a: { min: 30 }, b: { off: true }, e: { min: 0 } })).toEqual({});
  });
});

describe("reminderInstances — local plan events", () => {
  const base = { title: "Dentist", date: "2026-10-14", startTime: "14:30", allDay: false };

  it("fires only for the user's own entry, at start minus lead", () => {
    const ev = { id: "e1", ...base, reminder: 99 }; // legacy field is ignored here
    expect(reminderInstances({ planEvents: [ev], prefs: {}, now: NOW })).toEqual([]);
    const out = reminderInstances({ planEvents: [ev], prefs: { e1: { min: 30 } }, now: NOW, formatTime: (t) => `T${t}` });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "e1:2026-10-14", fireAt: at(2026, 10, 14, 14, 0), title: "Dentist", kind: "local", eventId: "e1", date: "2026-10-14", minutes: 30 });
    expect(out[0].body).toBe("T14:30 · in 30 min");
  });

  it("skips turned-off, all-day and untimed events, and past fire times", () => {
    const events = [
      { id: "off", ...base },
      { id: "allday", ...base, allDay: true },
      { id: "notime", ...base, startTime: null },
      { id: "past", ...base, date: "2026-10-13", startTime: "08:00" }
    ];
    const prefs = { off: { off: true }, allday: { min: 10 }, notime: { min: 10 }, past: { min: 0 } };
    expect(reminderInstances({ planEvents: events, prefs, now: NOW })).toEqual([]);
  });

  it("expands a recurring series inside the 14-day horizon, honoring exceptions", () => {
    const ev = { id: "gym", title: "Gym", date: "2026-10-01", startTime: "18:00", allDay: false, recurrence: { freq: "weekly", interval: 1, byWeekdays: [1, 3] }, exceptions: ["2026-10-19"] };
    const out = reminderInstances({ planEvents: [ev], prefs: { gym: { min: 15 } }, now: NOW });
    // Mon/Wed from 13 Oct (Tue) to 27 Oct: 14, 19(x), 21, 26 → 3
    expect(out.map((r) => r.date)).toEqual(["2026-10-14", "2026-10-21", "2026-10-26"]);
  });

  it("reminds a multi-day timed event once, on its first day", () => {
    const ev = { id: "trip", title: "Trip", date: "2026-10-15", endDate: "2026-10-18", startTime: "07:00", allDay: false };
    const out = reminderInstances({ planEvents: [ev], prefs: { trip: { min: 60 } }, now: NOW });
    expect(out.map((r) => r.date)).toEqual(["2026-10-15"]);
  });

  it("includes an event just beyond the horizon whose long lead falls inside it", () => {
    const ev = { id: "far", title: "Far", date: "2026-10-28", startTime: "08:00", allDay: false }; // horizon ends 27 Oct 09:00
    expect(reminderInstances({ planEvents: [ev], prefs: { far: { min: 1440 } }, now: NOW })).toHaveLength(1);
    expect(reminderInstances({ planEvents: [ev], prefs: { far: { min: 10 } }, now: NOW })).toHaveLength(0);
  });

  it("de-duplicates the same event seen in both scopes", () => {
    const ev = { id: "e1", ...base };
    expect(reminderInstances({ planEvents: [ev, { ...ev }], prefs: { e1: { min: 5 } }, now: NOW })).toHaveLength(1);
  });

  it("keeps the nearest MAX_SCHEDULED_REMINDERS", () => {
    const ev = { id: "daily", title: "Pills", date: "2026-10-13", startTime: "10:00", allDay: false, recurrence: { freq: "daily", interval: 1 } };
    const many = Array.from({ length: 10 }, (_, i) => ({ ...ev, id: `d${i}`, startTime: `1${i}:00` }));
    const prefs = Object.fromEntries(many.map((e) => [e.id, { min: 0 }]));
    const out = reminderInstances({ planEvents: many, prefs, now: NOW });
    expect(out).toHaveLength(MAX_SCHEDULED_REMINDERS);
    expect(out.every((r, i) => i === 0 || out[i - 1].fireAt <= r.fireAt)).toBe(true);
    expect(out[0].fireAt).toBe(at(2026, 10, 13, 10, 0));
  });

  it("schedules by local wall-clock time across a DST change", () => {
    // US DST ends Sun 1 Nov 2026; a 09:00 event that day still fires at 08:30 local.
    const ev = { id: "dst", title: "Church", date: "2026-11-01", startTime: "09:00", allDay: false };
    const out = reminderInstances({ planEvents: [ev], prefs: { dst: { min: 30 } }, now: at(2026, 10, 25, 12) });
    const d = new Date(out[0].fireAt);
    expect([d.getHours(), d.getMinutes()]).toEqual([8, 30]);
  });
});

describe("reminderInstances — Google events", () => {
  const raw = (over = {}) => ({ id: "g1", summary: "Shift", start: { dateTime: new Date(at(2026, 10, 14, 8)).toISOString() }, end: { dateTime: new Date(at(2026, 10, 14, 16)).toISOString() }, reminders: { useDefault: true }, ...over });
  const store = (over = {}) => ({ appCalendarId: "cal-w", calendarName: "Work", own: true, defaultReminders: [{ method: "popup", minutes: 30 }], events: { g1: raw() }, ...over });

  it("uses Google's own reminder for the token owner", () => {
    const out = reminderInstances({ googleStores: [store()], now: NOW, formatTime: () => "8:00 AM" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "google", fireAt: at(2026, 10, 14, 7, 30), calendarId: "cal-w", eventId: "g1", title: "Shift", body: "8:00 AM · in 30 min · Work" });
  });

  it("never fires another household member's Google reminders", () => {
    expect(reminderInstances({ googleStores: [store({ own: false })], now: NOW })).toEqual([]);
  });

  it("an app-side choice overrides Google's, per series, for any viewer", () => {
    const series = { g1: raw({ id: "g1_20261014", recurringEventId: "g1" }) };
    const key = googleReminderKey("cal-w", "g1");
    const out = reminderInstances({ googleStores: [store({ own: false, events: series })], prefs: { [key]: { min: 5 } }, now: NOW });
    expect(out.map((r) => r.minutes)).toEqual([5]);
    expect(reminderInstances({ googleStores: [store({ events: series })], prefs: { [key]: { off: true } }, now: NOW })).toEqual([]);
  });

  it("schedules every popup override; ignores email reminders, cancelled and reminder-less events", () => {
    const events = {
      a: raw({ id: "a", reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }, { method: "email", minutes: 60 }, { method: "popup", minutes: 120 }] } }),
      b: raw({ id: "b", status: "cancelled" }),
      c: raw({ id: "c", reminders: undefined })
    };
    const out = reminderInstances({ googleStores: [store({ events })], now: NOW });
    expect(out.map((r) => `${r.eventId}:${r.minutes}`)).toEqual(["a:120", "a:10"]);
  });

  it("all-day events: explicit overrides only, counted from local midnight", () => {
    const events = {
      d: raw({ id: "d", start: { date: "2026-10-15" }, end: { date: "2026-10-16" }, reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 900 }] } }),
      e: raw({ id: "e", start: { date: "2026-10-15" }, end: { date: "2026-10-16" }, reminders: { useDefault: true } })
    };
    const out = reminderInstances({ googleStores: [store({ events })], now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0].fireAt).toBe(at(2026, 10, 14, 9, 0)); // 15 hours before midnight
    expect(out[0].body.startsWith("All day")).toBe(true);
  });

  it("googleReminderMinutes de-duplicates and bounds", () => {
    expect(googleReminderMinutes({ reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }, { method: "popup", minutes: 10 }, { method: "popup", minutes: 99999 }] } })).toEqual([10]);
    expect(googleReminderMinutes({ reminders: { useDefault: true } }, [{ method: "popup", minutes: 5 }], { allDay: true })).toEqual([]);
  });
});

describe("notification ids and diffing", () => {
  it("ids are stable, positive 31-bit, and change with content", () => {
    const a = notificationId("e1:2026-10-14|123|Dentist");
    expect(a).toBe(notificationId("e1:2026-10-14|123|Dentist"));
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(0x7fffffff);
    expect(notificationId("e1:2026-10-14|124|Dentist")).not.toBe(a);
  });
  it("diffSchedule adds missing and cancels stale", () => {
    const wanted = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(diffSchedule(wanted, [2, 3, 9])).toEqual({ add: [{ id: 1 }], cancel: [9] });
    expect(diffSchedule([], [4])).toEqual({ add: [], cancel: [4] });
  });
  it("dueReminders picks the current minute", () => {
    const list = [{ fireAt: 100 }, { fireAt: 160 }, { fireAt: 200 }];
    expect(dueReminders(list, 100, 200)).toEqual([{ fireAt: 100 }, { fireAt: 160 }]);
  });
});

// ── Prefs store: egress rules ─────────────────────────────────────────────────

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("reminder prefs store", () => {
  function setup({ userId = "luke", fetchImpl } = {}) {
    let uid = userId;
    let clock = 1_000_000;
    const storage = memoryStorage();
    const fetchMock = vi.fn(fetchImpl || (async () => resp(200, [])));
    const store = createReminderPrefsStore({
      config: () => (uid ? { baseUrl: "https://sb", headers: { apikey: "k", Authorization: "Bearer t" }, userId: uid } : null),
      storage, fetchImpl: fetchMock, now: () => clock
    });
    return { store, storage, fetchMock, setUser: (u) => { uid = u; }, tick: (ms) => { clock += ms; } };
  }

  it("writes through the merge RPC with only the changed keys and keeps them locally", async () => {
    const { store, fetchMock } = setup({ fetchImpl: async () => resp(200, "2026-10-13T15:00:00Z") });
    store.set("e1", { min: 30 });
    expect(store.get("e1")).toEqual({ min: 30 }); // visible immediately
    await store.flush();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sb/rest/v1/rpc/merge_my_reminders");
    expect(JSON.parse(opts.body)).toEqual({ p_entries: { e1: { min: 30 } } });
    expect(store.pendingCount()).toBe(0);
    expect(store.get("e1")).toEqual({ min: 30 });
    expect(store.set("e1", { min: 30 })).toBe(false); // no-op change → no write
  });

  it("keeps the outbox when offline and sends it later", async () => {
    let online = false;
    const { store, fetchMock } = setup({ fetchImpl: async () => { if (!online) throw new Error("offline"); return resp(200, "2026-10-13T15:00:00Z"); } });
    store.set("e1", { off: true });
    await store.flush();
    expect(store.pendingCount()).toBe(1);
    expect(store.get("e1")).toEqual({ off: true });
    online = true;
    await store.flush();
    expect(store.pendingCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refresh is throttled to 10 minutes and only asks for a newer row", async () => {
    const rows = [[{ reminders: { a: { min: 5 } }, updated_at: "2026-10-13T10:00:00Z" }], []];
    const { store, fetchMock, tick } = setup({ fetchImpl: async () => resp(200, rows.shift() || []) });
    expect(await store.refresh()).toBe(true);
    expect(store.get("a")).toEqual({ min: 5 });
    expect(fetchMock.mock.calls[0][0]).toContain("live_notification_prefs?user_id=eq.luke&select=reminders,updated_at");
    expect(await store.refresh()).toBe(false); // throttled: no request
    expect(fetchMock).toHaveBeenCalledTimes(1);
    tick(10 * 60 * 1000);
    expect(await store.refresh()).toBe(false); // unchanged → []
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("updated_at=gt.2026-10-13T10%3A00%3A00Z");
    expect(fetchMock.mock.calls.every(([u]) => !u.includes("tableplan_states"))).toBe(true);
  });

  it("after its own write, re-reads the row once on the next refresh (another device may have written too)", async () => {
    const replies = [resp(200, [{ reminders: {}, updated_at: "2026-10-13T10:00:00Z" }]), resp(200, "2026-10-13T11:00:00Z"), resp(200, [{ reminders: { mine: { min: 1 }, theirs: { min: 2 } }, updated_at: "2026-10-13T11:00:00Z" }])];
    const { store, fetchMock } = setup({ fetchImpl: async () => replies.shift() });
    await store.refresh();
    store.set("mine", { min: 1 });
    await store.flush();
    expect(await store.refresh()).toBe(true); // not throttled after a write
    expect(store.get("theirs")).toEqual({ min: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports whether it has seen the server's copy (the legacy fold waits for it)", async () => {
    let online = false;
    const { store } = setup({ fetchImpl: async () => { if (!online) throw new Error("offline"); return resp(200, []); } });
    await store.refresh({ force: true });
    expect(store.hasServerCopy()).toBe(false); // new device, offline
    online = true;
    await store.refresh({ force: true });
    expect(store.hasServerCopy()).toBe(true); // read it (no row yet is still a read)
  });

  it("stays local-only when the table isn't deployed yet (404)", async () => {
    const { store, fetchMock } = setup({ fetchImpl: async () => resp(404, {}) });
    store.set("e1", { min: 10 });
    await store.flush();
    await store.refresh({ force: true });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retries this session
    expect(store.get("e1")).toEqual({ min: 10 });
  });

  it("null removes a key (a Google event goes back to Google's own reminder)", async () => {
    const { store, fetchMock } = setup({ fetchImpl: async () => resp(200, "2026-10-13T15:00:00Z") });
    store.set("gcal:c:s", { min: 5 });
    await store.flush();
    store.set("gcal:c:s", null);
    expect(store.get("gcal:c:s")).toBeUndefined();
    await store.flush();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ p_entries: { "gcal:c:s": null } });
    expect(store.get("gcal:c:s")).toBeUndefined();
    expect(store.set("gcal:c:s", null)).toBe(false); // already absent → no write
  });

  it("with no server configured (local dev) keeps choices on the device", async () => {
    const storage = memoryStorage();
    const fetchImpl = vi.fn();
    const store = createReminderPrefsStore({ config: () => ({ userId: "local" }), storage, fetchImpl });
    store.set("e1", { min: 10 });
    await store.flush();
    await store.refresh({ force: true });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.get("e1")).toEqual({ min: 10 });
  });

  it("keeps each account's choices separate", async () => {
    const { store, setUser } = setup({ fetchImpl: async () => { throw new Error("offline"); } });
    store.set("e1", { min: 10 });
    setUser("wife");
    expect(store.get("e1")).toBeUndefined();
    setUser(null);
    expect(store.set("e1", { min: 5 })).toBe(false); // signed out → nothing stored
    setUser("luke");
    expect(store.get("e1")).toEqual({ min: 10 });
  });
});

// ── iPhone scheduler ──────────────────────────────────────────────────────────

function mockPlugin({ permission = "granted", pending = [] } = {}) {
  const state = { pending: [...pending], permission };
  return {
    state,
    checkPermissions: vi.fn(async () => ({ display: state.permission })),
    requestPermissions: vi.fn(async () => { state.permission = "granted"; return { display: "granted" }; }),
    getPending: vi.fn(async () => ({ notifications: state.pending.map((id) => ({ id })) })),
    cancel: vi.fn(async ({ notifications }) => { const drop = new Set(notifications.map((n) => n.id)); state.pending = state.pending.filter((id) => !drop.has(id)); }),
    schedule: vi.fn(async ({ notifications }) => { state.pending.push(...notifications.map((n) => n.id)); }),
    addListener: vi.fn()
  };
}
const inst = (id) => ({ id, fireAt: NOW + id * 60000, title: `t${id}`, body: "b", kind: "local", eventId: `e${id}`, date: "2026-10-14", calendarId: null });

describe("native reminder scheduler", () => {
  it("does nothing without permission", async () => {
    const plugin = mockPlugin({ permission: "prompt" });
    const s = createNativeReminderScheduler({ plugin });
    await s.sync([inst(1)]);
    expect(plugin.schedule).not.toHaveBeenCalled();
  });

  it("adds missing, cancels stale, and skips the plugin when nothing changed", async () => {
    const plugin = mockPlugin({ pending: [2, 99] });
    const s = createNativeReminderScheduler({ plugin });
    const r = await s.sync([inst(1), inst(2)]);
    expect(r).toEqual({ added: 1, cancelled: 1 });
    expect(plugin.state.pending.sort()).toEqual([1, 2]);
    const sent = plugin.schedule.mock.calls[0][0].notifications[0];
    expect(sent).toMatchObject({ id: 1, title: "t1", extra: { kind: "local", eventId: "e1", date: "2026-10-14" } });
    expect(sent.schedule.at).toBeInstanceOf(Date);
    plugin.getPending.mockClear();
    await s.sync([inst(1), inst(2)]);
    expect(plugin.getPending).not.toHaveBeenCalled();
  });

  it("schedules in batches", async () => {
    const plugin = mockPlugin();
    const s = createNativeReminderScheduler({ plugin });
    await s.sync(Array.from({ length: 45 }, (_, i) => inst(i + 1)));
    expect(plugin.schedule).toHaveBeenCalledTimes(3);
    expect(plugin.state.pending).toHaveLength(45);
  });

  it("asking for permission lets the next sync schedule", async () => {
    const plugin = mockPlugin({ permission: "prompt" });
    const s = createNativeReminderScheduler({ plugin });
    await s.sync([inst(1)]);
    expect(await s.requestPermission()).toBe("granted");
    await s.sync([inst(1)]);
    expect(plugin.state.pending).toEqual([1]);
  });

  it("routes a tap to the event", () => {
    const plugin = mockPlugin();
    const onTap = vi.fn();
    const s = createNativeReminderScheduler({ plugin, onTap });
    s.listenForTaps();
    const handler = plugin.addListener.mock.calls[0][1];
    handler({ actionId: "tap", notification: { extra: { eventId: "e1", date: "2026-10-14" } } });
    handler({ actionId: "dismiss", notification: { extra: {} } });
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledWith({ eventId: "e1", date: "2026-10-14" });
  });

  it("is inert without a plugin (web)", async () => {
    const s = createNativeReminderScheduler({ plugin: null });
    expect(s.available()).toBe(false);
    expect(await s.sync([inst(1)])).toEqual({ skipped: true });
  });
});

// ── Google cache keeps reminder metadata ──────────────────────────────────────

describe("Google cache reminder metadata", () => {
  const ok = (over) => ({ results: { c1: { status: "ok", full: true, items: [{ id: "g1", reminders: { useDefault: true } }], fetchedAt: "2026-10-13T10:00:00Z", own: true, defaultReminders: [{ method: "popup", minutes: 30 }], ...over } } });

  it("stores own + defaultReminders and marks the store as carrying reminders", () => {
    const { cache } = applyEventsResponse({}, ok(), ["c1"]);
    expect(cache.c1).toMatchObject({ own: true, defaultReminders: [{ method: "popup", minutes: 30 }], rv: 1 });
    // A later delta without the metadata (older server) keeps it.
    const { cache: next } = applyEventsResponse(cache, { results: { c1: { status: "ok", full: false, items: [], fetchedAt: "2026-10-13T10:05:00Z" } } }, ["c1"]);
    expect(next.c1).toMatchObject({ own: true, rv: 1 });
  });

  it("a store pulled before reminders existed gets one full re-pull, and an old server isn't hammered", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    const legacy = { c1: { events: {}, fullAt: "2026-10-13T11:00:00Z", fetchedAt: "2026-10-13T11:50:00Z" } };
    expect(buildEventsRequest([{ id: "c1" }], legacy, { now }).calendars[0]).toEqual({ appCalendarId: "c1" }); // full
    // Full pull from a server that doesn't send reminders: remembered, deltas resume.
    const { cache } = applyEventsResponse(legacy, { results: { c1: { status: "ok", full: true, items: [], fetchedAt: "2026-10-13T12:00:00Z" } } }, ["c1"]);
    expect(cache.c1.rv).toBeUndefined();
    expect(buildEventsRequest([{ id: "c1" }], cache, { now: now + 5 * 60000 }).calendars[0].updatedMin).toBeTruthy();
  });
});
