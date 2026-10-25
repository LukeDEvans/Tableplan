// Display mode + theme (THEMES_DESIGN.md).
//
// Two independent per-person choices, kept in state.displayPrefs (personal
// `recreate` section, stamped field by field in settings-sync.js):
//   mode  — "light" | "dark" | "auto"   (auto follows the device setting)
//   theme — any key of THEMES, or "seasonal" (THEME_CHOICES; grouped for the
//           Display screen in THEME_GROUPS)
//           seasonal = the theme of the current season (Halloween in October),
//           Classic the rest of the year. Opt-in: the default is classic.
//   icon  — true: on the iPhone, the home-screen icon follows the active theme.
//
// Auto is resolved HERE, so CSS only ever sees data-theme="light" | "dark" and
// there is one dark rule set (the old CSS copy of it for Auto had drifted).
// The pure part (normalize / resolve) is DOM-free and unit-tested in
// test/theme.test.js; applyResolvedTheme() is the only DOM writer.

export const THEME_MODES = Object.freeze(["light", "dark", "auto"]);

export const THEMES = Object.freeze({
  classic: Object.freeze({
    label: "Classic",
    icon: "",
    themeColor: Object.freeze({ light: "#2C9993", dark: "#171816" }),
    swatch: Object.freeze(["#f9e49b", "#32b496", "#003865"]),
  }),
  halloween: Object.freeze({
    label: "Halloween",
    icon: "AppIconHalloween",
    favicon: "./icon-halloween-32.png",
    themeColor: Object.freeze({ light: "#1a1714", dark: "#0e0c0b" }),
    swatch: Object.freeze(["#0e0c0b", "#ff8a1f", "#a77bff"]),
  }),
  // Luke, 2026-10-20: navy, dusty blue, blush pink, sage green.
  household: Object.freeze({
    label: "Household",
    icon: "",
    themeColor: Object.freeze({ light: "#24395e", dark: "#121826" }),
    swatch: Object.freeze(["#24395e", "#8aa6c1", "#e8b4b8", "#a9c4a6"]),
  }),
  // Luke, 2026-10-20: from the Urban Greens logo (green #78bb34, gray #7e7e7e)
  // plus black and white.
  urbangreens: Object.freeze({
    label: "Urban Greens",
    icon: "",
    themeColor: Object.freeze({ light: "#111111", dark: "#0a0a0a" }),
    swatch: Object.freeze(["#111111", "#78bb34", "#7e7e7e", "#ffffff"]),
  }),
  // Sports (Luke, 2026-10-25): his favorite teams, in their official colors.
  vikings: Object.freeze({
    label: "Vikings",
    icon: "",
    themeColor: Object.freeze({ light: "#4f2683", dark: "#150f22" }),
    swatch: Object.freeze(["#4f2683", "#ffc62f", "#ffffff"]),
  }),
  wolves: Object.freeze({
    label: "Timberwolves & Lynx",
    icon: "",
    themeColor: Object.freeze({ light: "#0c2340", dark: "#0a1626" }),
    swatch: Object.freeze(["#0c2340", "#236192", "#78be20", "#9ea2a2"]),
  }),
  wild: Object.freeze({
    label: "Wild",
    icon: "",
    themeColor: Object.freeze({ light: "#154734", dark: "#0d1a13" }),
    swatch: Object.freeze(["#154734", "#a6192e", "#eaaa00", "#ddcba4"]),
  }),
  twins: Object.freeze({
    label: "Twins",
    icon: "",
    themeColor: Object.freeze({ light: "#002b5c", dark: "#08131f" }),
    swatch: Object.freeze(["#002b5c", "#d31145", "#b9975b"]),
  }),
  gophers: Object.freeze({
    label: "Golden Gophers",
    icon: "",
    themeColor: Object.freeze({ light: "#7a0019", dark: "#170a0b" }),
    swatch: Object.freeze(["#7a0019", "#ffcc33"]),
  }),
  ajax: Object.freeze({
    label: "Ajax",
    icon: "",
    themeColor: Object.freeze({ light: "#d2122e", dark: "#0f0f0f" }),
    swatch: Object.freeze(["#d2122e", "#ffffff", "#111111"]),
  }),
  mnufc: Object.freeze({
    label: "Minnesota United",
    icon: "",
    themeColor: Object.freeze({ light: "#231f20", dark: "#121011" }),
    swatch: Object.freeze(["#231f20", "#8cd2f4", "#e4e5e6"]),
  }),
});

// The Display screen's rows (Luke, 2026-10-25), each a heading over a sideways
// row of theme cards, like Leisure. Every theme belongs to exactly one group;
// "seasonal" sits with the holiday themes it switches between.
export const THEME_GROUPS = Object.freeze([
  Object.freeze({ key: "general", label: "General", themes: Object.freeze(["classic", "household"]) }),
  Object.freeze({ key: "holiday", label: "Holiday", themes: Object.freeze(["halloween", "seasonal"]) }),
  Object.freeze({ key: "business", label: "Business", themes: Object.freeze(["urbangreens"]) }),
  Object.freeze({ key: "sports", label: "Sports", themes: Object.freeze(["vikings", "wolves", "wild", "twins", "gophers", "ajax", "mnufc"]) }),
]);

// Selectable choices, in display order. "seasonal" is not a palette itself.
export const THEME_CHOICES = Object.freeze(THEME_GROUPS.flatMap((g) => g.themes));

// month is 1–12, inclusive ranges. First match wins.
export const SEASONS = Object.freeze([
  Object.freeze({ theme: "halloween", from: Object.freeze([10, 1]), to: Object.freeze([10, 31]) }),
]);

export function seasonalTheme(date = new Date()) {
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  for (const s of SEASONS) {
    const from = s.from[0] * 100 + s.from[1];
    const to = s.to[0] * 100 + s.to[1];
    if (from <= to ? md >= from && md <= to : md >= from || md <= to) return s.theme;
  }
  return "classic";
}

// Ends the season's current run, for the Display screen's "until Nov 1" line.
export function seasonEnds(date = new Date()) {
  const theme = seasonalTheme(date);
  const s = SEASONS.find((x) => x.theme === theme);
  if (!s) return null;
  let year = date.getFullYear();
  if (s.from[0] > s.to[0] && date.getMonth() + 1 >= s.from[0]) year += 1;
  return new Date(year, s.to[0] - 1, s.to[1] + 1);
}

// What's stored: only explicit, valid choices (so an unset mode keeps falling
// back to the legacy household value until this person picks one).
export function cleanDisplayPrefs(prefs) {
  const p = prefs && typeof prefs === "object" ? prefs : {};
  const out = {};
  if (THEME_MODES.includes(p.mode)) out.mode = p.mode;
  if (THEME_CHOICES.includes(p.theme)) out.theme = p.theme;
  if (typeof p.icon === "boolean") out.icon = p.icon;
  return out;
}

// legacyMode: the old household-wide config `themeMode`, used only until this
// person makes their own choice.
export function normalizeDisplayPrefs(prefs, legacyMode) {
  const p = prefs && typeof prefs === "object" ? prefs : {};
  const out = {};
  out.mode = THEME_MODES.includes(p.mode) ? p.mode
    : THEME_MODES.includes(legacyMode) ? legacyMode : "light";
  out.theme = THEME_CHOICES.includes(p.theme) ? p.theme : "classic";
  out.icon = p.icon !== false;
  return out;
}

export function resolveTheme(prefs, { systemDark = false, now = new Date() } = {}) {
  const p = normalizeDisplayPrefs(prefs);
  const scheme = p.mode === "auto" ? (systemDark ? "dark" : "light") : p.mode;
  const palette = p.theme === "seasonal" ? seasonalTheme(now) : p.theme;
  const def = THEMES[palette] || THEMES.classic;
  return {
    scheme,
    palette: THEMES[palette] ? palette : "classic",
    themeColor: def.themeColor[scheme],
    icon: p.icon ? def.icon : "",
    favicon: def.favicon || "",
  };
}

// Writes the resolved theme onto the page. Idempotent; safe to call often.
export function applyResolvedTheme(resolved, doc = globalThis.document) {
  if (!doc) return;
  const { scheme, palette, themeColor } = resolved;
  for (const el of [doc.documentElement, doc.body]) {
    if (!el) continue;
    el.dataset.theme = scheme;
    if (palette === "classic") delete el.dataset.palette;
    else el.dataset.palette = palette;
  }
  doc.documentElement.style.colorScheme = scheme;
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta && themeColor) meta.setAttribute("content", themeColor);
  // Browser tab icon (a home-screen web app's icon can't change; the iPhone
  // app's can — see syncAppIcon in app.js).
  doc.querySelectorAll('link[rel="icon"]').forEach((link) => {
    if (link.dataset.defaultHref === undefined) {
      link.dataset.defaultHref = link.getAttribute("href") || "";
      link.dataset.defaultType = link.getAttribute("type") || "";
    }
    const href = resolved.favicon || link.dataset.defaultHref;
    const type = resolved.favicon ? "image/png" : link.dataset.defaultType;
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
    if (type && link.getAttribute("type") !== type) link.setAttribute("type", type);
  });
}
