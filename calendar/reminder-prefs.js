// Event reminders — the signed-in user's reminder choices (IOS_NOTIFICATIONS_DESIGN.md §2, §4).
//
// Stored server-side in the user's own live_notification_prefs row and cached on
// the device, so reminders work offline and the server is touched rarely:
//   • read: at most every 10 minutes, and the request asks only for a row NEWER
//     than the cached one (`updated_at=gt.<cached>`), so an unchanged row comes
//     back as [] — a few hundred bytes of egress;
//   • write: merge_my_reminders(), which merges just the changed keys and returns
//     only a timestamp. Changes made offline wait in a local outbox (last value per
//     key wins) and are sent on the next flush.
// Never reads or writes tableplan_states.
//
// The store is created per signed-in user; `config()` supplies { baseUrl, headers,
// userId } (or null when signed out). A config with no baseUrl keeps choices on this
// device only (local-dev). This module never touches app state or globals beyond
// the injected storage and fetch.
//
// Values: { min } | { off: true } (a tombstone — "no reminder", which also stops a
// legacy shared reminder being folded back in) | null = remove the key (for a Google
// event, "use Google's own reminder"). null lives only in the outbox until sent.

import { normalizeReminderPrefs, normalizeReminderValue } from "./reminders.js";

export const REMINDER_PREFS_CACHE_PREFIX = "live-reminder-prefs-v1:";
export const PREFS_CHECK_INTERVAL_MS = 10 * 60 * 1000;

function normalizeOutbox(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, v] of Object.entries(raw)) {
    if (!key || key.length > 300) continue;
    if (v === null) out[key] = null;
    else { const val = normalizeReminderValue(v); if (val) out[key] = val; }
  }
  return out;
}

function emptyCache() {
  return { reminders: {}, updatedAt: "", checkedAt: 0, outbox: {} };
}

export function createReminderPrefsStore({ config, storage = globalThis.localStorage, fetchImpl = (...a) => globalThis.fetch(...a), now = () => Date.now() } = {}) {
  let userId = null;
  let cache = emptyCache();
  let flushing = null;
  let refreshing = null;
  let serverMissing = false; // table/RPC not deployed yet → stay local-only this session
  const listeners = new Set();

  function storageKey(uid) { return `${REMINDER_PREFS_CACHE_PREFIX}${uid}`; }

  function load(uid) {
    try {
      const raw = JSON.parse(storage?.getItem(storageKey(uid)) || "null");
      if (raw && typeof raw === "object") {
        return {
          reminders: normalizeReminderPrefs(raw.reminders),
          updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
          checkedAt: Number(raw.checkedAt) || 0,
          outbox: normalizeOutbox(raw.outbox)
        };
      }
    } catch { /* corrupt cache → start fresh */ }
    return emptyCache();
  }

  function save() {
    if (!userId) return;
    try { storage?.setItem(storageKey(userId), JSON.stringify(cache)); } catch { /* quota */ }
  }

  function notify() { listeners.forEach((fn) => { try { fn(); } catch { /* listener bug */ } }); }

  // Switch to the current user's cache (sign-in / sign-out / account change).
  function sync() {
    const uid = config()?.userId || null;
    if (uid === userId) return uid;
    userId = uid;
    cache = uid ? load(uid) : emptyCache();
    serverMissing = false;
    return uid;
  }

  function prefs() {
    sync();
    const out = { ...cache.reminders };
    for (const [key, val] of Object.entries(cache.outbox)) {
      if (val === null) delete out[key];
      else out[key] = val;
    }
    return out;
  }

  function get(key) {
    return prefs()[key];
  }

  // Record choices locally right away, then send them. entries: { key: value }
  // where value is { min } | { off: true } | null (remove); anything unusable is
  // stored as the {off:true} tombstone.
  function setMany(entries) {
    if (!sync()) return false;
    let changed = false;
    for (const [key, raw] of Object.entries(entries || {})) {
      if (!key || key.length > 300) continue;
      const val = raw === null ? null : (normalizeReminderValue(raw) || { off: true });
      const current = prefs()[key];
      if (val === null ? current === undefined : JSON.stringify(current) === JSON.stringify(val)) continue;
      cache.outbox[key] = val;
      changed = true;
    }
    if (!changed) return false;
    save();
    notify();
    flush();
    return true;
  }

  function set(key, value) { return setMany({ [key]: value }); }

  function headersFor(c, extra = {}) {
    return { ...c.headers, ...extra };
  }

  // Send the outbox (at most 200 keys per call, the RPC's limit). Resolves true
  // when everything pending was accepted.
  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      const c = config();
      if (!sync() || !c?.baseUrl || serverMissing) return false;
      while (Object.keys(cache.outbox).length) {
        const batch = Object.fromEntries(Object.entries(cache.outbox).slice(0, 200));
        let res;
        try {
          res = await fetchImpl(`${c.baseUrl}/rest/v1/rpc/merge_my_reminders`, {
            method: "POST",
            headers: headersFor(c, { "content-type": "application/json", Prefer: "return=representation" }),
            body: JSON.stringify({ p_entries: batch })
          });
        } catch { return false; } // offline: keep the outbox
        if (res.status === 404) { serverMissing = true; return false; }
        if (!res.ok) return false;
        const at = await res.json().catch(() => null);
        if (c.userId !== userId) return false; // account switched mid-flight
        for (const [key, val] of Object.entries(batch)) {
          if (val === null) delete cache.reminders[key];
          else cache.reminders[key] = val;
          // Only clear the outbox entry if it wasn't changed again meanwhile.
          if (JSON.stringify(cache.outbox[key]) === JSON.stringify(val)) delete cache.outbox[key];
        }
        // Another device may have written between our last read and this write, and
        // the row's updated_at is now OUR write's — so don't advance updatedAt (that
        // would hide their change). Instead let the next refresh re-read the row once
        // (one small read per burst of edits).
        if (typeof at === "string" && at) cache.checkedAt = 0;
        save();
      }
      return true;
    })().finally(() => { flushing = null; });
    return flushing;
  }

  // Pull the row if it changed elsewhere. Throttled to PREFS_CHECK_INTERVAL_MS
  // unless forced. Resolves true when the reminders changed.
  function refresh({ force = false } = {}) {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const c = config();
      if (!sync() || !c?.baseUrl || serverMissing) return false;
      if (!force && now() - cache.checkedAt < PREFS_CHECK_INTERVAL_MS) return false;
      await flush();
      const newer = cache.updatedAt ? `&updated_at=gt.${encodeURIComponent(cache.updatedAt)}` : "";
      let res;
      try {
        res = await fetchImpl(`${c.baseUrl}/rest/v1/live_notification_prefs?user_id=eq.${encodeURIComponent(c.userId)}${newer}&select=reminders,updated_at`, {
          headers: headersFor(c, { Accept: "application/json" }),
          cache: "no-store"
        });
      } catch { return false; }
      if (res.status === 404) { serverMissing = true; return false; }
      if (!res.ok) return false;
      const rows = await res.json().catch(() => null);
      if (c.userId !== userId || !Array.isArray(rows)) return false;
      cache.checkedAt = now();
      const row = rows[0];
      let changed = false;
      if (row) {
        const next = normalizeReminderPrefs(row.reminders);
        changed = JSON.stringify(next) !== JSON.stringify(cache.reminders);
        cache.reminders = next;
        cache.updatedAt = typeof row.updated_at === "string" ? row.updated_at : cache.updatedAt;
      }
      save();
      if (changed) notify();
      return changed;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  // True once this device has seen the server's copy (or there is no server). A
  // caller that writes defaults — the one-time legacy fold — must wait for this, or
  // a new device that starts offline could overwrite choices made elsewhere.
  function hasServerCopy() {
    const c = config();
    if (!sync() || !c) return false;
    return !c.baseUrl || serverMissing || cache.checkedAt > 0 || Boolean(cache.updatedAt);
  }

  return { prefs, get, set, setMany, flush, refresh, onChange, hasServerCopy, pendingCount: () => (sync(), Object.keys(cache.outbox).length) };
}
