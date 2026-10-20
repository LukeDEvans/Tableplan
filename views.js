// Views: Personal, Household, Business (VIEWS_DESIGN.md, Luke 2026-10-20).
//
// The app splits into three views. Each shows its own pages and its own look;
// you move between them by swiping on the view band (the cursive name under the
// logo on the landing page, and in the header while the page menu is open), by
// its ‹ › chevrons, or with the arrow keys on a laptop.
//
// This module is pure (no DOM, no app state): the view list and order, which
// pages each view holds, who may use which views, the cyclical step, the
// view prefix on routes, and per-view display prefs. app.js does the wiring.
//
// Step 2 of the build order (the view shell): all three views still show the
// same data. Splitting the data comes later (§8).

// On-screen order, left to right. The order is cyclical: stepping past either
// end wraps around.
export const VIEW_ORDER = Object.freeze(["household", "personal", "business"]);

export const VIEW_LABELS = Object.freeze({
  household: "Household",
  personal: "Personal",
  business: "Business",
});

// Which pages each view holds, by the page keys app.js uses in pageNavButtons()
// (plan = Calendar, eat = Meal Plan, read = Listen). null = every page.
// Household and Business list their pages flat, with no group headings.
export const VIEW_PAGES = Object.freeze({
  personal: null,
  household: Object.freeze(["plan", "eat", "finance", "shop", "watch", "read"]),
  business: Object.freeze(["plan"]),
});

export const DEFAULT_VIEW = "personal";

// Each view's look until the person picks one (decision 14: three clearly
// different schemes). Personal keeps the person's existing Display choice.
export const VIEW_DEFAULT_THEME = Object.freeze({
  household: "household",
  business: "urbangreens",
});

export function isView(view) {
  return VIEW_ORDER.includes(view);
}

// Who sees which views. For now only the admin has more than one (decision 7,
// 12): everyone else has Household only. `isAdmin` comes from the server's
// group role, so it can't be turned on from the device.
export function availableViews({ isAdmin = false } = {}) {
  return isAdmin ? [...VIEW_ORDER] : ["household"];
}

// The view to open in: the last one used on this device if it's still
// available, otherwise Personal, otherwise the first available.
export function startingView(lastUsed, available) {
  const list = available?.length ? available : ["household"];
  if (list.includes(lastUsed)) return lastUsed;
  if (list.includes(DEFAULT_VIEW)) return DEFAULT_VIEW;
  return list[0];
}

// One step left (-1) or right (+1) in VIEW_ORDER among the available views,
// wrapping around. A finger moving right brings in the view on the left, so
// a right swipe is step(-1) (decision 8).
export function stepView(current, direction, available) {
  const list = VIEW_ORDER.filter((v) => (available || VIEW_ORDER).includes(v));
  if (list.length < 2) return list[0] || current;
  const i = Math.max(0, list.indexOf(current));
  const n = list.length;
  return list[(((i + (direction < 0 ? -1 : 1)) % n) + n) % n];
}

// A horizontal swipe's direction, or 0 when it isn't one: long enough and
// clearly more sideways than up/down. Returns the step (-1 or +1) to take.
export function swipeStep(dx, dy, { minDistance = 36 } = {}) {
  if (Math.abs(dx) < minDistance) return 0;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx > 0 ? -1 : 1;
}

export function viewHasPage(view, page) {
  const pages = VIEW_PAGES[view];
  if (pages === undefined) return false;
  return pages === null || pages.includes(page);
}

// The first available view that holds a page, preferring the current one.
export function viewForPage(page, current, available) {
  if (viewHasPage(current, page)) return current;
  const list = available?.length ? available : [current];
  if (list.includes(DEFAULT_VIEW) && viewHasPage(DEFAULT_VIEW, page)) return DEFAULT_VIEW;
  return list.find((v) => viewHasPage(v, page)) || null;
}

export function isFlatView(view) {
  return view !== "personal";
}

// Routes carry their view: "household/calendar". Old routes without one
// ("calendar", notification URLs already scheduled on phones) still work and
// come back with view null.
export function splitViewHash(hash) {
  const raw = String(hash || "");
  const slash = raw.indexOf("/");
  if (slash > 0) {
    const head = raw.slice(0, slash).toLowerCase();
    if (isView(head)) return { view: head, rest: raw.slice(slash + 1) };
  }
  if (isView(raw.toLowerCase())) return { view: raw.toLowerCase(), rest: "" };
  return { view: null, rest: raw };
}

export function viewHash(view, rest) {
  if (!isView(view)) return rest || "";
  return rest ? `${view}/${rest}` : view;
}

// ── Per-view display prefs ───────────────────────────────────────────────────
// Personal uses the person's existing state.displayPrefs (so nothing they've
// chosen changes, and someone with Household only keeps theirs there too).
// The admin's Household and Business looks live in state.viewDisplayPrefs:
//   { household: { mode?, theme? }, business: { mode?, theme? } }
// each view's object stamped on its own (settings-sync.js "fields").

// The view whose look is kept in displayPrefs: Personal when the person has
// it, otherwise their only view.
export function primaryView(available) {
  const list = available?.length ? available : ["household"];
  return list.includes("personal") ? "personal" : list[0];
}

export function cleanViewDisplayPrefs(prefs, { modes = [], themes = [] } = {}) {
  const p = prefs && typeof prefs === "object" ? prefs : {};
  const out = {};
  for (const view of VIEW_ORDER) {
    if (view === "personal") continue;
    const v = p[view];
    if (!v || typeof v !== "object") continue;
    const entry = {};
    if (modes.includes(v.mode)) entry.mode = v.mode;
    if (themes.includes(v.theme)) entry.theme = v.theme;
    if (Object.keys(entry).length) out[view] = entry;
  }
  return out;
}

// The display prefs to show for a view. `base` is the person's displayPrefs
// (already normalized: mode, theme, icon). A secondary view takes its own
// mode/theme, falling back to the person's mode and the view's default theme.
// The iPhone icon only ever follows the primary view, so switching views
// doesn't make iOS announce an icon change each time.
export function displayPrefsForView(view, { base, viewPrefs, available } = {}) {
  const b = base || {};
  if (view === primaryView(available)) return { ...b };
  const own = (viewPrefs && viewPrefs[view]) || {};
  return {
    mode: own.mode || b.mode,
    theme: own.theme || VIEW_DEFAULT_THEME[view] || b.theme,
    icon: false,
  };
}
