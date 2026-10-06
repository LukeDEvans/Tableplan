// Guard: every name a module factory (`export function create*Module(deps)`)
// uses must be one of its own locals, a destructured dep, a module top-level
// declaration/import, or a real browser/JS global.
//
// Why: an extracted domain module that calls a function app.js never injected
// only fails when that line RUNS — the build, the boot check and the rest of the
// suite can't see it. That is how Recipe Box "+" silently did nothing
// (recipes-ui.js called grocerySuggestionItems() without it in the deps;
// ISSUES.md, 2026-09-29). A failure here names the file:line of the missing name:
// inject it from app.js (add it to the factory's deps + the destructure), or
// declare it in the module.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { factoryFreeIdentifiers, lineOf } from "./_free-identifiers.js";

const MODULES = [
  "contacts.js", "finance-ui.js", "groceries-ui.js", "inventory-ui.js",
  "mealplan-ui.js", "news-ui.js", "recipes-ui.js", "weather-ui.js",
];

// ECMAScript built-ins (a fresh VM context has these and no Node extras like
// `process`/`require`/`Buffer`, which would be real bugs in the browser) …
const JS_GLOBALS = runInNewContext("Object.getOwnPropertyNames(globalThis)");
// … plus the browser APIs the modules legitimately use. Add to this list only
// for a genuine browser global, never to silence a missing injection.
const BROWSER_GLOBALS = [
  "window", "document", "navigator", "location", "history", "screen", "console",
  "localStorage", "sessionStorage", "indexedDB", "fetch", "alert", "confirm", "prompt",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask",
  "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "matchMedia",
  "CSS", "FileReader", "Image", "Audio", "DOMParser", "Blob", "File", "FormData",
  "URL", "URLSearchParams", "Headers", "Request", "Response", "AbortController",
  "Event", "CustomEvent", "HTMLElement", "Node", "performance", "crypto", "atob", "btoa",
  "structuredClone", "IntersectionObserver", "ResizeObserver", "MutationObserver",
  "TextEncoder", "TextDecoder", "Notification",
];
const ALLOWED = new Set([...JS_GLOBALS, ...BROWSER_GLOBALS]);

describe("module factories only use injected or declared names", () => {
  for (const file of MODULES) {
    it(`${file}: no un-injected free identifiers`, () => {
      const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const factories = factoryFreeIdentifiers(src);
      expect(factories.length, `${file} should export a create*Module factory`).toBeGreaterThan(0);
      const missing = [];
      for (const { factory, refs } of factories) {
        for (const r of refs) if (!ALLOWED.has(r.name)) missing.push(`${file}:${lineOf(src, r.start)} ${factory} uses \`${r.name}\``);
      }
      expect([...new Set(missing)], "not injected via deps, not declared in the module, not a browser global").toEqual([]);
    });
  }
});

describe("free-identifier finder", () => {
  it("catches a call to a name the factory was never given (the Recipe Box '+' bug)", () => {
    const src = `
      import { helper } from "./x.js";
      const TOP = 1;
      export function createDemoModule(deps) {
        const { injected } = deps;
        function local(a, { b = TOP } = {}) { const c = a + b; return helper(c) + injected(); }
        function broken() { return grocerySuggestionItems(); }
        return { local, broken, obj: { key: 1 }.key, arrow: (x) => x };
      }`;
    const [{ refs }] = factoryFreeIdentifiers(src);
    expect(refs.map((r) => r.name)).toEqual(["grocerySuggestionItems"]);
  });

  it("ignores property keys, member names, labels and catch params", () => {
    const src = `export function createDemoModule(deps) {
      const o = { alpha: 1 }; o.beta = 2;
      outer: for (const k in o) { try { continue outer; } catch (err) { return err; } }
      class Z { method() { return this; } }
      return new Z();
    }`;
    const [{ refs }] = factoryFreeIdentifiers(src);
    expect(refs).toEqual([]);
  });
});
