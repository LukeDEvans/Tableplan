// The font menu (WORD_PROCESSOR_DESIGN.md §10): a curated list. System fonts cost
// nothing; Google Fonts are loaded only when a document uses one (one stylesheet per
// family, cached by the browser / service worker for offline). A font a document
// names that isn't on the list keeps its name and falls back to the closest generic.

export const SYSTEM_FONTS = Object.freeze([
  { name: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { name: "Times New Roman", stack: '"Times New Roman", Times, serif' },
  { name: "Georgia", stack: "Georgia, serif" },
  { name: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { name: "Courier New", stack: '"Courier New", Courier, monospace' },
  { name: "Comic Sans MS", stack: '"Comic Sans MS", "Comic Sans", cursive' },
  { name: "Trebuchet MS", stack: '"Trebuchet MS", sans-serif' },
]);

// [name, generic fallback, weights]
const GOOGLE = [
  ["Roboto", "sans-serif"], ["Open Sans", "sans-serif"], ["Lato", "sans-serif"], ["Montserrat", "sans-serif"],
  ["Merriweather", "serif"], ["Lora", "serif"], ["Playfair Display", "serif"], ["Source Serif 4", "serif"],
  ["Source Sans 3", "sans-serif"], ["Inter", "sans-serif"], ["Nunito", "sans-serif"], ["Raleway", "sans-serif"],
  ["Poppins", "sans-serif"], ["EB Garamond", "serif"], ["Libre Baskerville", "serif"], ["Crimson Pro", "serif"],
  ["Caveat", "cursive"], ["Pacifico", "cursive"], ["Oswald", "sans-serif"], ["Roboto Mono", "monospace"],
  ["Fira Code", "monospace"], ["Noto Sans", "sans-serif"], ["Work Sans", "sans-serif"], ["Dancing Script", "cursive"],
];
export const GOOGLE_FONTS = Object.freeze(GOOGLE.map(([name, generic]) => ({ name, stack: `"${name}", ${generic}`, google: true })));
export const FONTS = Object.freeze([...SYSTEM_FONTS, ...GOOGLE_FONTS].sort((a, b) => a.name.localeCompare(b.name)));
export const DEFAULT_FONT = "Arial";
export const FONT_SIZES = Object.freeze([8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96]);
export const DEFAULT_SIZE = 11;

const byName = new Map(FONTS.map((f) => [f.name.toLowerCase(), f]));
// Older names Google Docs files use for two of the list.
byName.set("source serif pro", byName.get("source serif 4"));
byName.set("source sans pro", byName.get("source sans 3"));

export const findFont = (name) => byName.get(String(name || "").replace(/["']/g, "").trim().toLowerCase()) || null;

// A safe font name to store: letters, digits, spaces and a few marks only.
export const cleanFontName = (name) => String(name || "").replace(/["';{}<>\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);

// The CSS font-family for a stored name: the list's stack, or the name with a generic
// fallback picked from its sound (serif / mono / sans).
export function fontStack(name) {
  const f = findFont(name);
  if (f) return f.stack;
  const n = cleanFontName(name);
  if (!n) return SYSTEM_FONTS[0].stack;
  const generic = /mono|code|courier|consol/i.test(n) ? "monospace" : /serif|roman|times|garamond|georgia|book|baskerville|minion|cambria/i.test(n) && !/sans/i.test(n) ? "serif" : "sans-serif";
  return `"${n}", ${generic}`;
}

const loaded = new Set();
// Adds the Google Fonts stylesheet for a family the first time a document uses it.
export function ensureFont(name, doc = globalThis.document) {
  const f = findFont(name);
  if (!f?.google || !doc || loaded.has(f.name)) return;
  loaded.add(f.name);
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.name).replace(/%20/g, "+")}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
  link.dataset.liveFont = f.name;
  doc.head.appendChild(link);
}

// Every font named in a ProseMirror JSON tree (to load them all on open).
export function fontsInJson(node, out = new Set()) {
  if (!node || typeof node !== "object") return out;
  for (const m of node.marks || []) if (m.type === "textStyle" && m.attrs?.fontFamily) out.add(m.attrs.fontFamily);
  for (const c of node.content || []) fontsInJson(c, out);
  return out;
}
