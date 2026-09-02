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
  "live-explore-last-trip",  // last-opened trip id (account-owned)
  "live-travel-mode-trip",   // active Travel-Mode trip id (account-owned)
];

// Some account-scoped keys are DYNAMIC (a stable prefix + a variable suffix), so
// they can't be listed literally. Any key starting with one of these prefixes is
// account data and gets swept too.
export const ACCOUNT_SCOPED_STORAGE_KEY_PREFIXES = [
  "briefing_ai_", // per-day home AI briefing, derived from the account's data
];

// Enumerate a Web Storage's keys via the standard length/key(i) API (used only
// for the prefix sweep). Defensive: returns [] if the store can't be enumerated.
function storageKeys(storage) {
  const out = [];
  try {
    if (typeof storage.length === "number" && typeof storage.key === "function") {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k != null) out.push(k);
      }
    }
  } catch { /* not enumerable — skip the prefix sweep */ }
  return out;
}

// Classify an auth-state change for one tab, given the account identity whose data
// is currently in memory (`prevId`) and the incoming Supabase `session`. This is the
// core of multi-tab account isolation: it separates a genuine account TRANSITION
// (which must reset the tab's account boundary) from routine token-refresh noise.
//
//   'none'    no session now, and none was established — nothing to do.
//   'first'   a session appeared and no account was established yet — hydrate it.
//   'refresh' same account, new token (or an unidentifiable session while an account
//             is established) — do NOT re-hydrate or reload (avoids spurious reloads
//             on the ~hourly TOKEN_REFRESHED event and on malformed refreshes).
//   'changed' a DIFFERENT account is now authenticated (e.g. another tab signed in as
//             account B while this tab holds account A) — reset the boundary + reload.
//   'signout' the account signed out (possibly in another tab) — reset + reload to gate.
//
// Identity is the Supabase user id (stable UUID), falling back to email. When a
// session is present but unidentifiable we return 'refresh', never 'changed', so a
// malformed event can never trigger a destructive reset.
export function accountTransitionKind(prevId, session) {
  const hasSession = !!session?.access_token;
  const newId = session?.user?.id || session?.user?.email || null;
  if (!hasSession) return prevId ? "signout" : "none";
  if (!prevId) return "first";
  if (!newId) return "refresh";
  return newId === prevId ? "refresh" : "changed";
}

// Remove every account-scoped key (exact + prefix-matched). Best-effort and
// defensive: a missing key is a no-op, and a throwing store (private mode, quota,
// a stubbed environment) never aborts the rest — clearing as much as possible is
// always safer than bailing.
export function clearLocalAccountState(storage) {
  if (!storage || typeof storage.removeItem !== "function") return;
  for (const key of ACCOUNT_SCOPED_STORAGE_KEYS) {
    try { storage.removeItem(key); } catch { /* private mode / quota — best effort */ }
  }
  if (ACCOUNT_SCOPED_STORAGE_KEY_PREFIXES.length) {
    // Snapshot keys first, then remove — never mutate mid-enumeration.
    for (const key of storageKeys(storage)) {
      if (ACCOUNT_SCOPED_STORAGE_KEY_PREFIXES.some((p) => key.startsWith(p))) {
        try { storage.removeItem(key); } catch { /* best effort */ }
      }
    }
  }
}
