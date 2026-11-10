// Themes and layouts (SLIDES_DESIGN.md §4). Pure data plus the helpers that resolve a
// colour or font through the presentation's theme.
//
// Colours on items are either a hex value ("#1a73e8") or a theme role ("@a1"), so
// changing the theme recolours everything that used a role, as Google Slides does.
// Roles: dk1 (main text), lt1 (main background), dk2, lt2, a1–a6 (accents), link.
// Fonts on items are a font name or "@heading" / "@body".

import { safeColor } from "../editor/extensions.js";

export const ROLES = Object.freeze(["dk1", "lt1", "dk2", "lt2", "a1", "a2", "a3", "a4", "a5", "a6", "link"]);
export const ROLE_LABELS = Object.freeze({ dk1: "Text", lt1: "Background", dk2: "Dark 2", lt2: "Light 2", a1: "Accent 1", a2: "Accent 2", a3: "Accent 3", a4: "Accent 4", a5: "Accent 5", a6: "Accent 6", link: "Link" });
export const DECOS = Object.freeze(["none", "bar-left", "band-top", "band-bottom", "corner", "frame", "circle"]);

const t = (id, name, colors, fonts, extra = {}) => Object.freeze({ id, name, colors: Object.freeze(colors), fonts: Object.freeze(fonts), bg: Object.freeze(extra.bg || { kind: "solid", role: "lt1" }), deco: extra.deco || "none", app: !!extra.app });

// [dk1, lt1, dk2, lt2, a1..a6, link]
const C = (dk1, lt1, dk2, lt2, a1, a2, a3, a4, a5, a6, link) => ({ dk1, lt1, dk2, lt2, a1, a2, a3, a4, a5, a6, link });

export const THEMES = Object.freeze([
  t("plain", "Plain", C("#202124", "#ffffff", "#3c4043", "#f1f3f4", "#1a73e8", "#ea4335", "#fbbc04", "#34a853", "#ff6d01", "#46bdc6", "#1a73e8"), { heading: "Arial", body: "Arial" }),
  t("midnight", "Midnight", C("#ffffff", "#14181f", "#c9d1e0", "#232a36", "#5ea2ff", "#ff7a90", "#ffd166", "#5fd3a5", "#c792ea", "#4fd1e8", "#8ab4ff"), { heading: "Montserrat", body: "Open Sans" }, { deco: "bar-left" }),
  t("paper", "Paper", C("#2b2621", "#fbf8f1", "#5a5248", "#efe8da", "#b5532c", "#4f7a5a", "#c99a2e", "#3e6a8a", "#8a4f7d", "#6b6b6b", "#3e6a8a"), { heading: "Playfair Display", body: "Lora" }, { deco: "frame" }),
  t("bold", "Bold", C("#111111", "#ffffff", "#111111", "#ffe14d", "#111111", "#ff3d2e", "#2f6bff", "#00a86b", "#ff9f1c", "#8338ec", "#2f6bff"), { heading: "Oswald", body: "Work Sans" }, { deco: "band-top" }),
  t("coastal", "Coastal", C("#16324f", "#f4f8fb", "#2d5b7c", "#dcebf5", "#1f7a8c", "#f2a65a", "#bfdbf7", "#e07a5f", "#3d5a80", "#81b29a", "#1f7a8c"), { heading: "Raleway", body: "Nunito" }, { bg: { kind: "gradient", from: "lt1", to: "lt2", angle: 160 } }),
  t("forest", "Forest", C("#f3f1e7", "#1f3a2c", "#d9e4cf", "#2c4d3b", "#a7c957", "#f2e8cf", "#bc4749", "#6a994e", "#ddb892", "#90be6d", "#d9e4cf"), { heading: "Merriweather", body: "Source Sans 3" }, { deco: "corner" }),
  t("sunset", "Sunset", C("#2d1e2f", "#fff4ec", "#5c3d5e", "#ffe1cf", "#e8505b", "#f9a826", "#7b3f61", "#14b1ab", "#f37a5a", "#355070", "#7b3f61"), { heading: "Poppins", body: "Poppins" }, { bg: { kind: "gradient", from: "lt1", to: "lt2", angle: 135 }, deco: "circle" }),
  t("studio", "Studio", C("#1d1d1f", "#f5f5f7", "#424245", "#e8e8ed", "#0071e3", "#bf4800", "#5e5ce6", "#30d158", "#ff375f", "#64d2ff", "#0071e3"), { heading: "Inter", body: "Inter" }),
  t("gallery", "Gallery", C("#ffffff", "#000000", "#bdbdbd", "#1b1b1b", "#ffffff", "#c8a96a", "#9e9e9e", "#e0e0e0", "#7a7a7a", "#c8a96a", "#c8a96a"), { heading: "EB Garamond", body: "Source Sans 3" }),
  t("chalk", "Chalk", C("#f2f2ec", "#2e3b36", "#cfd8d3", "#3b4a44", "#ffe66d", "#ff6b6b", "#4ecdc4", "#f7fff7", "#ffa69e", "#a8dadc", "#ffe66d"), { heading: "Caveat", body: "Nunito" }, { deco: "frame" }),
  t("citrus", "Citrus", C("#23303a", "#fffdf5", "#3d4f5c", "#fff3c4", "#f77f00", "#fcbf49", "#2a9d8f", "#d62828", "#90be6d", "#457b9d", "#2a9d8f"), { heading: "Montserrat", body: "Lato" }, { deco: "band-bottom" }),
  t("graphite", "Graphite", C("#e8eaed", "#202124", "#bdc1c6", "#2d2f33", "#8ab4f8", "#f28b82", "#fdd663", "#81c995", "#ff8bcb", "#78d9ec", "#8ab4f8"), { heading: "Roboto", body: "Roboto" }, { deco: "bar-left" }),
  // From the app's own palettes (theme.js / styles.css), so a deck can match Live.
  t("classic", "Classic", C("#1f2b2a", "#fffdf8", "#003865", "#f7f5ef", "#2c9993", "#003865", "#f9e49b", "#32b496", "#e07a5f", "#6c8ead", "#2c9993"), { heading: "Montserrat", body: "Open Sans" }, { deco: "band-top", app: true }),
  t("household", "Household", C("#1b2538", "#f9f4f2", "#24395e", "#e2ebdf", "#24395e", "#8aa6c1", "#e8b4b8", "#a9c4a6", "#b0243a", "#535d72", "#24395e"), { heading: "Playfair Display", body: "Lato" }, { deco: "bar-left", app: true }),
  t("urbangreens", "Urban Greens", C("#141414", "#ffffff", "#111111", "#f6f7f4", "#78bb34", "#3d7517", "#7e7e7e", "#111111", "#e4f2d6", "#575757", "#3d7517"), { heading: "Montserrat", body: "Open Sans" }, { deco: "band-bottom", app: true }),
]);

const byId = new Map(THEMES.map((x) => [x.id, x]));
export const DEFAULT_THEME = "plain";
export const themeById = (id) => byId.get(id) || byId.get(DEFAULT_THEME);

// A theme as stored in a presentation: { id, colors, fonts, bg, deco } with every value
// checked (a presentation from someone else can't put CSS into the page).
export function cleanTheme(v) {
  const base = themeById(v?.id);
  const colors = {};
  for (const r of ROLES) colors[r] = safeColor(v?.colors?.[r]) || base.colors[r];
  const font = (f, d) => (typeof f === "string" && /^[A-Za-z0-9 ]{1,60}$/.test(f) ? f : d);
  const fonts = { heading: font(v?.fonts?.heading, base.fonts.heading), body: font(v?.fonts?.body, base.fonts.body) };
  const bgv = v?.bg || base.bg;
  const role = (x, d) => (ROLES.includes(x) ? x : d);
  const bg = bgv.kind === "gradient"
    ? { kind: "gradient", from: role(bgv.from, "lt1"), to: role(bgv.to, "lt2"), angle: Math.max(0, Math.min(360, Number(bgv.angle) || 0)) }
    : { kind: "solid", role: role(bgv.role, "lt1") };
  return { id: base.id, name: base.name, colors, fonts, bg, deco: DECOS.includes(v?.deco) ? v.deco : base.deco };
}

// "#1a73e8" | "@a1" | null → a hex colour, or null for none.
export function resolveColor(c, theme) {
  if (c == null || c === "" || c === "none") return null;
  if (typeof c === "string" && c[0] === "@") return theme.colors[c.slice(1)] || null;
  return safeColor(c);
}
export const resolveFont = (f, theme) => (f === "@heading" ? theme.fonts.heading : f === "@body" || !f ? theme.fonts.body : f);

// A slide background: { kind: "solid", color } | { kind: "gradient", from, to, angle }
// | { kind: "image", media, fit } | null (the theme's). → CSS background.
export function backgroundCss(bg, theme, imageUrl = null) {
  const b = bg || theme.bg;
  if (b.kind === "image" && imageUrl) return `${resolveColor(theme.bg.role ? `@${theme.bg.role}` : "@lt1", theme) || "#fff"} url("${imageUrl}") center / ${b.fit === "contain" ? "contain" : "cover"} no-repeat`;
  if (b.kind === "gradient") {
    const from = resolveColor(b.from?.[0] === "#" ? b.from : `@${b.from}`, theme) || "#fff";
    const to = resolveColor(b.to?.[0] === "#" ? b.to : `@${b.to}`, theme) || "#fff";
    return `linear-gradient(${Number(b.angle) || 0}deg, ${from}, ${to})`;
  }
  const c = b.color ? resolveColor(b.color, theme) : resolveColor(`@${b.role || "lt1"}`, theme);
  return c || "#ffffff";
}

// ---- layouts -------------------------------------------------------------------------------
// Boxes are fractions of the slide (so 16:9 and 4:3 both work). Each placeholder has a
// role (title / subtitle / body / body2 / caption / number) and its text style.

const P = (role, x, y, w, h, style) => Object.freeze({ role, box: Object.freeze([x, y, w, h]), style: Object.freeze(style) });
const TITLE = { font: "@heading", size: 36, color: "@dk1", valign: "bottom", bold: false };
const BODY = { font: "@body", size: 18, color: "@dk1", valign: "top" };

export const LAYOUTS = Object.freeze([
  Object.freeze({ id: "title", name: "Title slide", ph: [P("title", 0.08, 0.28, 0.84, 0.26, { ...TITLE, size: 52, align: "center" }), P("subtitle", 0.08, 0.56, 0.84, 0.14, { ...BODY, size: 24, color: "@dk2", align: "center" })] }),
  Object.freeze({ id: "section", name: "Section header", ph: [P("title", 0.08, 0.36, 0.84, 0.22, { ...TITLE, size: 44, valign: "middle" })] }),
  Object.freeze({ id: "title-body", name: "Title and body", ph: [P("title", 0.06, 0.05, 0.88, 0.15, TITLE), P("body", 0.06, 0.24, 0.88, 0.68, BODY)] }),
  Object.freeze({ id: "two-col", name: "Title and two columns", ph: [P("title", 0.06, 0.05, 0.88, 0.15, TITLE), P("body", 0.06, 0.24, 0.42, 0.68, BODY), P("body2", 0.52, 0.24, 0.42, 0.68, BODY)] }),
  Object.freeze({ id: "title-only", name: "Title only", ph: [P("title", 0.06, 0.05, 0.88, 0.15, TITLE)] }),
  Object.freeze({ id: "one-col", name: "One column text", ph: [P("title", 0.06, 0.08, 0.36, 0.2, { ...TITLE, size: 30 }), P("body", 0.06, 0.32, 0.36, 0.6, { ...BODY, size: 16 })] }),
  Object.freeze({ id: "main-point", name: "Main point", ph: [P("title", 0.08, 0.2, 0.84, 0.6, { ...TITLE, size: 48, valign: "middle" })] }),
  Object.freeze({ id: "section-desc", name: "Section title and description", ph: [P("title", 0.05, 0.3, 0.4, 0.22, { ...TITLE, size: 36 }), P("subtitle", 0.05, 0.54, 0.4, 0.14, { ...BODY, color: "@dk2" }), P("body", 0.52, 0.1, 0.43, 0.8, { ...BODY, valign: "middle" })] }),
  Object.freeze({ id: "caption", name: "Caption", ph: [P("caption", 0.06, 0.8, 0.88, 0.12, { ...BODY, size: 18, valign: "middle" })] }),
  Object.freeze({ id: "big-number", name: "Big number", ph: [P("number", 0.06, 0.18, 0.88, 0.42, { ...TITLE, size: 120, color: "@a1", align: "center" }), P("body", 0.06, 0.62, 0.88, 0.2, { ...BODY, align: "center" })] }),
  Object.freeze({ id: "blank", name: "Blank", ph: [] }),
]);
const layoutById = new Map(LAYOUTS.map((l) => [l.id, l]));
export const layoutFor = (id) => layoutById.get(id) || layoutById.get("title-body");

export const PLACEHOLDER_PROMPTS = Object.freeze({ title: "Click to add title", subtitle: "Click to add subtitle", body: "Click to add text", body2: "Click to add text", caption: "Click to add caption", number: "xx%" });

// Slide sizes (px in the slide's own space).
export const SIZES = Object.freeze({ "16:9": [1920, 1080], "4:3": [1440, 1080], "16:10": [1728, 1080], "1:1": [1080, 1080] });
export const sizeOf = (meta) => {
  if (meta?.w > 0 && meta?.h > 0) return [Math.min(4000, Math.max(200, meta.w)), Math.min(4000, Math.max(200, meta.h))];
  return SIZES[meta?.size] || SIZES["16:9"];
};

// The decoration a theme draws behind everything (not an item: it follows the theme).
export function decoSvg(theme, w, h) {
  const a = theme.colors.a1, b = theme.colors.a2;
  switch (theme.deco) {
    case "bar-left": return `<rect x="0" y="0" width="${w * 0.012}" height="${h}" fill="${a}"/>`;
    case "band-top": return `<rect x="0" y="0" width="${w}" height="${h * 0.018}" fill="${a}"/>`;
    case "band-bottom": return `<rect x="0" y="${h * 0.965}" width="${w}" height="${h * 0.035}" fill="${a}"/><rect x="0" y="${h * 0.955}" width="${w}" height="${h * 0.01}" fill="${b}"/>`;
    case "corner": return `<path d="M${w} 0 L${w} ${h * 0.28} L${w - h * 0.28} 0 Z" fill="${a}" opacity="0.9"/>`;
    case "frame": return `<rect x="${w * 0.02}" y="${h * 0.035}" width="${w * 0.96}" height="${h * 0.93}" fill="none" stroke="${theme.colors.dk2}" stroke-width="2" opacity="0.5"/>`;
    case "circle": return `<circle cx="${w * 0.95}" cy="${h * 0.08}" r="${h * 0.22}" fill="${a}" opacity="0.18"/><circle cx="${w * 0.04}" cy="${h * 0.95}" r="${h * 0.12}" fill="${b}" opacity="0.18"/>`;
    default: return "";
  }
}
