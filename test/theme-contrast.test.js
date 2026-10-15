// Visibility guard for themes (THEMES_DESIGN.md): every text/fill pair a theme
// defines must reach WCAG AA (4.5:1 for text). Reads the token blocks in
// styles.css marked /* theme:<name>:light */ and /* theme:<name>:dark */.
// Classic predates this check and has known failures (ISSUES.md), so only the
// themes in CHECKED are held to it; every NEW theme goes in CHECKED.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
const CHECKED = ["halloween"];

function block(name, mode) {
  const m = css.match(new RegExp(`/\\* theme:${name}:${mode} \\*/\\s*[^{]+\\{([^}]*)\\}`));
  if (!m) throw new Error(`no ${name}:${mode} block`);
  return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((x) => [x[1], x[2]]));
}
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function hue(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

// [text token, background token]
const TEXT_PAIRS = [
  ["ink", "bg"], ["ink", "surface"], ["ink", "surface-strong"], ["ink", "window-bg"], ["ink", "sun-soft"], ["ink", "sun-pale"], ["ink", "accent-soft"],
  ["muted", "surface"], ["muted", "surface-strong"], ["muted", "window-bg"],
  ["accent", "surface"], ["accent", "surface-strong"], ["accent", "window-bg"], ["accent", "sun-soft"], ["accent", "accent-soft"],
  ["accent-dark", "surface"], ["accent-dark", "surface-strong"], ["accent-dark", "window-bg"], ["accent-dark", "accent-soft"],
  ["on-accent", "accent"], ["on-accent", "window-border"], ["on-tomato", "tomato"],
  ["tomato", "surface-strong"], ["tomato", "window-bg"], ["tomato", "tomato-soft"],
  ["window-border", "window-bg"], ["window-border", "surface-strong"], ["blue", "surface-strong"], ["text-muted", "surface-strong"],
  ["ink", "paper"], ["muted", "paper"], ["ink", "card"], ["muted", "card"], ["purple", "window-bg"], ["purple", "surface-strong"],
];

describe.each(CHECKED)("theme %s", (name) => {
  const light = block(name, "light");
  const sets = { light, dark: { ...light, ...block(name, "dark") } };
  for (const [mode, tokens] of Object.entries(sets)) {
    it(`${mode}: text pairs reach 4.5:1`, () => {
      const failures = TEXT_PAIRS
        .map(([fg, bg]) => [fg, bg, ratio(tokens[fg], tokens[bg])])
        .filter(([, , r]) => !(r >= 4.5))
        .map(([fg, bg, r]) => `${fg} on ${bg}: ${r.toFixed(2)}`);
      expect(failures).toEqual([]);
    });
    it(`${mode}: danger can't be mistaken for the accent`, () => {
      const d = Math.abs(hue(tokens.tomato) - hue(tokens.accent));
      expect(Math.min(d, 360 - d)).toBeGreaterThanOrEqual(25);
    });
  }
  it("dark page backdrop keeps text readable", () => {
    const m = css.match(new RegExp(`body\\[data-palette="${name}"\\]\\[data-theme="dark"\\] \\{ background: (#[0-9a-f]{6}); \\}`));
    if (!m) return;
    expect(ratio(sets.dark.ink, m[1])).toBeGreaterThanOrEqual(4.5);
  });
});

// The mail reading surface stays white in dark mode and carries the LIGHT
// tokens (styles.css, .mail-thread-panel). Everything drawn on it must read on
// white — this is what washed out in Halloween dark (2026-10-14).
describe("mail reading surface in dark mode", () => {
  const panel = (sel) => {
    const m = css.match(new RegExp(sel.replace(/[[\]".]/g, "\\$&") + "\\s*\\{([^}]*)\\}"));
    if (!m) throw new Error(`no block for ${sel}`);
    return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((x) => [x[1], x[2]]));
  };
  const base = panel(".mail-thread-panel");
  const dark = { ...base, ...panel('body[data-theme="dark"] .mail-thread-panel') };
  const sets = { classic: dark, halloween: { ...dark, ...panel('body[data-palette="halloween"][data-theme="dark"] .mail-thread-panel') } };
  for (const [name, t] of Object.entries(sets)) {
    it(`${name}: text and accents read on the white surface`, () => {
      const pairs = [["ink", "window-bg"], ["muted", "window-bg"], ["accent", "window-bg"], ["accent-dark", "window-bg"], ["tomato", "window-bg"], ["window-border", "window-bg"], ["on-accent", "accent"], ["ink", "accent-soft"], ["ink", "paper"]];
      const failures = pairs.map(([fg, bg]) => [fg, bg, ratio(t[fg], t[bg])]).filter(([, , r]) => !(r >= 4.5)).map(([fg, bg, r]) => `${fg} on ${bg}: ${r.toFixed(2)}`);
      expect(failures).toEqual([]);
    });
  }
});
