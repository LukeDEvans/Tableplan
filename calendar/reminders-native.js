// Event reminders — iPhone local notifications (IOS_NOTIFICATIONS_DESIGN.md §5).
//
// Keeps iOS's pending local notifications equal to the reminder instances the
// pure core (reminders.js) computes: cancel what's no longer wanted, add what's
// missing. iOS then delivers them with the app closed, offline, and after a
// reboot — no server involved. In the foreground the plugin shows the banner too,
// so the in-app toast is skipped on the phone.
//
// `plugin` is @capacitor/local-notifications' LocalNotifications (injected so this
// is testable and inert on the web, where the caller passes null).

import { diffSchedule } from "./reminders.js";

const SCHEDULE_BATCH = 20;

export function createNativeReminderScheduler({ plugin, onTap = () => {}, log = () => {} } = {}) {
  let permission = null;      // "granted" | "denied" | "prompt" | "prompt-with-rationale" | null (unknown)
  let lastFingerprint = null; // ids last confirmed in sync with iOS
  let running = null;
  let queued = null;
  let tapListener = null;

  function available() { return Boolean(plugin); }

  async function checkPermission() {
    if (!plugin) return "denied";
    try { permission = (await plugin.checkPermissions())?.display || "denied"; }
    catch { permission = "denied"; }
    return permission;
  }

  // Ask iOS for permission (shows the system prompt only the first time).
  async function requestPermission() {
    if (!plugin) return "denied";
    try { permission = (await plugin.requestPermissions())?.display || "denied"; }
    catch { permission = "denied"; }
    if (permission === "granted") lastFingerprint = null; // schedule on the next sync
    return permission;
  }

  function listenForTaps() {
    if (!plugin || tapListener) return;
    try {
      tapListener = plugin.addListener("localNotificationActionPerformed", (action) => {
        if (action?.actionId && action.actionId !== "tap") return;
        try { onTap(action?.notification?.extra || {}); } catch (e) { log("reminder tap failed", e); }
      });
    } catch (e) { log("reminder tap listener failed", e); }
  }

  async function apply(instances) {
    const fingerprint = instances.map((i) => i.id).join(",");
    if (fingerprint === lastFingerprint) return { skipped: true };
    if ((permission || await checkPermission()) !== "granted") return { skipped: true, permission };
    const pending = (await plugin.getPending())?.notifications || [];
    const { add, cancel } = diffSchedule(instances, pending.map((n) => n.id));
    if (cancel.length) await plugin.cancel({ notifications: cancel.map((id) => ({ id })) });
    for (let i = 0; i < add.length; i += SCHEDULE_BATCH) {
      await plugin.schedule({
        notifications: add.slice(i, i + SCHEDULE_BATCH).map((r) => ({
          id: r.id,
          title: r.title,
          body: r.body,
          schedule: { at: new Date(r.fireAt), allowWhileIdle: true },
          extra: { kind: r.kind, eventId: r.eventId, date: r.date, calendarId: r.calendarId }
        }))
      });
    }
    lastFingerprint = fingerprint;
    return { added: add.length, cancelled: cancel.length };
  }

  // Bring iOS in line with `instances`. Calls are serialized; while one runs, only
  // the latest requested set is kept for the next pass. Cheap when nothing changed
  // (the fingerprint short-circuits before touching the plugin).
  function sync(instances) {
    if (!plugin) return Promise.resolve({ skipped: true });
    queued = instances;
    if (running) return running;
    running = (async () => {
      let result = { skipped: true };
      while (queued) {
        const next = queued;
        queued = null;
        try { result = await apply(next); }
        catch (e) { lastFingerprint = null; log("reminder sync failed", e); result = { error: true }; }
      }
      return result;
    })().finally(() => { running = null; });
    return running;
  }

  // Forget what was last synced (e.g. after permission changes in iPhone Settings).
  function invalidate() { lastFingerprint = null; permission = null; }

  return { available, checkPermission, requestPermission, listenForTaps, sync, invalidate, permission: () => permission };
}
