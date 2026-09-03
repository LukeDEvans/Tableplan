// today-projection.js — deterministic, side-effect-free "what matters today"
// projections (ARCHITECTURE.md audit §13). Each projector is a pure function of
// (state, now): no clock reads inside, no writes, no DOM. Domains own their own
// projection logic (calendar via the pure calendar modules, media via
// media-history); `projectToday` is a THIN composition, never a god-object.
//
// This is the read substrate for Home and for future AI (the app determines the
// facts deterministically; AI interprets them). The `extra` seam lets the shell
// inject projections for domains whose logic is still inline (tasks, meals) without
// this module importing the shell — so adoption is incremental and this module
// stays pure and testable.

import { normalizePlanEvents } from "./calendar/model.js";
import { eventInstancesInRange, sortEventsForDisplay } from "./calendar/projection.js";
import { recentHistory } from "./media-history.js";
import { resumableEntries } from "./media-progress.js";
import { pendingNotifications, notificationBadgeCount, badgeLabel, retainedArticles } from "./publications-notify.js";

// Local YYYY-MM-DD for a Date (matches how planEvents store dates). Explicit local
// time so "today" means the user's calendar day, deterministically.
export function dayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Calendar events occurring on `now`'s local day, sorted for display. Pure: uses
// only state.planEvents + the pure calendar modules (recurrence expansion included).
export function projectCalendar(state, now) {
  const key = dayKey(now);
  const events = normalizePlanEvents(state?.planEvents || []);
  const todays = events.filter((e) => eventInstancesInRange(e, key, key).length > 0);
  return { date: key, events: sortEventsForDisplay(todays) };
}

// Recently-played media to "continue" (the read surface for a future unified audio/
// audiobook Continue — position persistence, when added, flows through mediaHistory).
// `currentlyPlaying` (the runtime now-playing item, or null) and `activeKey` (its
// mediaKey/id) are INJECTED by the shell — currently-playing is runtime engine
// truth, not derivable from state. Passing activeKey excludes the playing item from
// `resumable`, keeping the two concepts separate (Phase 0).
export function projectMediaContinue(state, now, { limit = 5, activeKey = null, currentlyPlaying = null } = {}) {
  const list = Array.isArray(state?.mediaHistory) ? state.mediaHistory : [];
  const excludeId = activeKey ? String(activeKey).split(":").slice(1).join(":") || activeKey : null;
  return {
    currentlyPlaying: currentlyPlaying || null, // runtime truth; null when nothing plays
    recent: recentHistory(list, { limit }),
    // Resume points (music/audiobooks partway through) from the mediaProgress map,
    // excluding whatever is currently playing.
    resumable: resumableEntries(state?.mediaProgress, { limit, excludeId }),
  };
}

// The active weather location (readings are external/cached, not in canonical state,
// so the projection reports the location and leaves fetching to the caller).
export function projectWeather(state) {
  const locs = Array.isArray(state?.weatherLocations) ? state.weatherLocations : [];
  const activeId = state?.weatherActiveLocationId || null;
  const active = locs.find((l) => l && l.id === activeId) || locs[0] || null;
  return { location: active, hasLocation: !!active };
}

// Publications: the deterministic notification badge + counts for Today/nav.
// Derived purely from state.pubArticles + state.articleNotifications — the badge is
// never derived from library size, history, or playlist (§18).
export function projectPublications(state, now = new Date()) {
  const articles = Array.isArray(state?.pubArticles) ? state.pubArticles : [];
  const notif = state?.articleNotifications;
  const iso = now.toISOString();
  const count = notificationBadgeCount(articles, notif, iso);
  return {
    badge: count,
    badgeLabel: badgeLabel(count),
    pendingCount: count,
    retainedCount: retainedArticles(articles, notif).length,
    pending: pendingNotifications(articles, notif, iso, { retentionDays: 7 }).slice(0, 20),
  };
}

// Compose per-domain projections into a deterministic Today context. `now` is
// ALWAYS supplied by the caller (never read internally) so the output is a pure
// function of its inputs. `extra` merges shell-injected projections (e.g. tasks,
// meals) whose source logic is still inline — added without coupling this module.
export function projectToday(state, now = new Date(), extra = {}) {
  const s = state && typeof state === "object" ? state : {};
  return {
    date: dayKey(now),
    generatedAt: now.toISOString(),
    calendar: projectCalendar(s, now),
    mediaContinue: projectMediaContinue(s, now),
    weather: projectWeather(s),
    publications: projectPublications(s, now),
    ...extra,
  };
}
