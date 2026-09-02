// Account-transition safety. On an authenticated sign-out, every localStorage
// entry that holds the CURRENT account's data or account-scoped config must be
// cleared, so a subsequent sign-in — especially a DIFFERENT account signing in
// via email OTP in the same tab, with no page reload — can never read, merge, or
// re-persist the previous account's residue. (The in-memory state, sync flags,
// and module caches are reinitialized by reloading the page after this runs; this
// module owns only the persistent localStorage boundary.)
//
// Membership rule: a key belongs here iff it holds account-specific DATA or
// config that would be wrong for a different account. Device-neutral preferences
// (local-dev flag, push-subscription flag, playback speed, cadence view mode)
// are deliberately EXCLUDED — they are per-device, not per-account, and should
// survive a sign-out. Keep this list in sync with the corresponding key
// constants in app.js (the literals are stable persisted keys and must not drift).

export const ACCOUNT_SCOPED_STORAGE_KEYS = [
  "tableplan-state-v1",      // STORAGE_KEY — the full state mirror (all sections)
  "tableplan-trips-v1",      // TRIP_BACKUP_KEY — travel backup (restored by applyStoredState)
  "live-shadow-sections-v1", // SHADOW_KEY — scope-inactive section rows
  "live-section-scopes-v1",  // SCOPE_PREFS_KEY — per-section personal/household scope
  "eat-calendars-v1",        // CALENDAR_CACHE_KEY — linked-calendar events cache
  "live_plan_ics_cache",     // subscribed ICS/Amion events cache
  "live-chat-history",       // CHAT_STORAGE_KEY — AI chat history
  "live_watch_search_scope", // WATCH_SCOPE_KEY — watch search scope
];

// Remove every account-scoped key. Best-effort and defensive: a missing key is a
// no-op, and a throwing store (private mode, quota, a stubbed environment) never
// aborts the rest — clearing as much as possible is always safer than bailing.
export function clearLocalAccountState(storage) {
  if (!storage || typeof storage.removeItem !== "function") return;
  for (const key of ACCOUNT_SCOPED_STORAGE_KEYS) {
    try { storage.removeItem(key); } catch { /* private mode / quota — best effort */ }
  }
}
