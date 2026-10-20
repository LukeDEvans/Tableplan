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

// ── Which data row each view reads (build step 4) ─────────────────────────────
// The sections that can live in a household row or a personal row (app.js
// SECTION_SCOPE "toggle"); the Calendar can also live in the business row.
// Everything else has one fixed home (Meal Plan, Finance… household; Exercise,
// Leisure… personal) and no view changes that.
export const VIEW_TOGGLE_SECTIONS = Object.freeze(["grocery", "do", "watch", "media", "plan", "travel", "finance"]);

// The row a view reads for a toggleable section:
//   Household → the household row, for everything.
//   Personal  → the person's own rows, except Shop: the shopping list is the
//               household's (the meal plan fills it), as it has always opened.
//   Business  → the business row for the Calendar; the rest as in Personal
//               (Business has no other pages yet).
// `hasBusiness` is false until the business space has loaded (or for someone
// with none); the Calendar then stays personal rather than pointing nowhere.
export function scopeForView(view, section, { hasBusiness = false, hasPersonalFinance = false } = {}) {
  // Finance (FINANCE_SPLIT_DESIGN.md): Personal shows the person's own accounts —
  // but only once they have any (accounts marked Personal). Until then Personal
  // keeps showing the household's Finance, exactly as before.
  if (section === "finance") return view !== "household" && hasPersonalFinance ? "personal" : "household";
  // Explore isn't a Household page, so its trips stay on the person's own row.
  // (Swapping it would also wake the trip safety net in applyStoredState, which
  // restores a device's trip backup into an empty incoming row — copying
  // personal trips into the household's.)
  if (section === "travel") return "personal";
  if (view === "household") return "household";
  if (section === "grocery") return "household";
  if (view === "business" && section === "plan" && hasBusiness) return "business";
  return "personal";
}

// The scopes a section can be in, for this person.
export function scopesForSection(section, { toggle = true, hasBusiness = false } = {}) {
  if (!toggle) return [];
  return section === "plan" && hasBusiness ? ["personal", "household", "business"] : ["personal", "household"];
}

// A section's row id in a scope. null when it can't be addressed (no user id
// for a personal row, no space for a business row).
export function rowIdForScope({ stateId, userId, businessId } = {}, section, scope) {
  if (scope === "personal") return userId ? `u-${userId}:${section}` : null;
  if (scope === "business") return businessId ? `${businessId}:${section}` : null;
  return stateId ? `${stateId}:${section}` : null;
}

// Shadow store (the scopes of a section not on screen), keyed by scope:
//   { [section]: { [scope]: { key: value } } }
// Older devices kept one unkeyed copy per section — always "the other one" of
// personal / household — so it converts by the section's current scope.
export function upgradeShadowStore(v1, currentScope) {
  const out = {};
  for (const [section, data] of Object.entries(v1 && typeof v1 === "object" ? v1 : {})) {
    if (!data || typeof data !== "object") continue;
    const other = currentScope(section) === "personal" ? "household" : "personal";
    out[section] = { [other]: data };
  }
  return out;
}

// Which other views' calendars the Personal calendar shows as layers (decision
// 2–3: the person opts in; Household and Business never show Personal items).
export function layerViewsFor(view, layers, { hasBusiness = false } = {}) {
  if (view !== "personal") return [];
  const on = layers && typeof layers === "object" ? layers : {};
  const out = [];
  if (on.household) out.push("household");
  if (on.business && hasBusiness) out.push("business");
  return out;
}
