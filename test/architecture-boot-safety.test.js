import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ARCHITECTURE FITNESS — BOOT SAFETY (module-load ordering).
//
// app.js is a single ~42k-line shell whose domains have been extracted into
// `createXModule(deps)` factory modules. The factories are instantiated near the top of
// app.js and their interfaces destructured into `const {...} = _factory;` bindings. Neither
// the build (esbuild treats undeclared names as runtime globals) nor the rest of the suite
// (nothing imports/executes app.js's module body — it needs a DOM) exercises module-load
// order, so two whole classes of load-time crash have shipped silently and only surfaced in
// the browser:
//
//   • recomputeMealPlanLayout / the 9 meal-plan config fns — extracted as top-level EXPORTS
//     but they read/mutate arrays (`meals`, `prepDays`, …) that stayed injected into the
//     factory; a top-level export can't see injected deps → `meals is not defined` while
//     normalizeState() ran during `const state = loadState()` → app hung on "Checking sign-in".
//   • migrateLegacyRecipeOrganization() / migrateGroceryDescriptorNames() — bare top-level
//     statements that called a factory-provided const declared ~200 lines later →
//     "Cannot access 'X' before initialization" (TDZ) at boot.
//   • PLAN_COLORS — a plain app.js top-level const (a color palette) declared at line ~23k but
//     passed as SHORTHAND into `createMealplanModule({ …, PLAN_COLORS, … })` at line ~1.7k. A
//     factory-instantiation deps object is evaluated immediately at module-load, so injecting a
//     not-yet-declared module const throws "Cannot access 'PLAN_COLORS' before initialization"
//     at boot. Guard (b) missed it: it only tracked factory-DESTRUCTURED consts and explicitly
//     EXCLUDED the instantiation blocks from scanning. Guard (d) covers this class.
//
// These guards fail loudly (with the exact line) if any pattern is reintroduced.
// DO NOT weaken or delete them without understanding that history — they are the only thing
// that catches these before a browser does. A headless native-ESM boot eval (importing the
// UNBUNDLED source, which preserves module-const TDZ — an esbuild bundle hoists top-level
// const→var and is BLIND to it) confirmed PLAN_COLORS is the only such violation on the path
// through render()/bindEvents()/initializeApp().

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");

// The extracted domain factory modules (each exposes `createXModule(deps)`).
const FACTORY_MODULES = [
  "contacts.js", "weather-ui.js", "inventory-ui.js", "finance-ui.js",
  "groceries-ui.js", "recipes-ui.js", "mealplan-ui.js",
];

const JS_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "await",
  "async", "do", "else", "try", "finally", "throw", "delete", "void", "instanceof", "in",
  "of", "yield", "super", "this", "case", "break", "continue", "const", "let", "var",
]);

// ── (a) Export-scope guard ──────────────────────────────────────────────────────────────
// A top-level `export function` runs OUTSIDE the factory closure, so it can only see
// module-scope names (imports + top-level declarations) — never anything destructured from
// `deps`. Flag any export whose body references an injected-only name via ANY access form:
// call `x(`, property `x.y`, or mutation `x.length =` / `x.push` — the identifier itself is
// what's missing, so we scan identifier references, not just call sites (the gap that let
// `recomputeMealPlanLayout`'s `meals.length = 0` through the old call-only checker).
function scanExportScope(src) {
  const depsMatch = src.match(/const\s*\{\s*([\s\S]*?)\s*\}\s*=\s*deps;/);
  const injected = new Set();
  if (depsMatch) {
    for (let name of depsMatch[1].split(",")) {
      name = name.trim().split(":")[0].trim(); // `getX: () => ...` → getX
      if (/^\w+$/.test(name)) injected.add(name);
    }
  }
  const modscope = new Set();
  for (const m of src.matchAll(/^import\s+\*\s+as\s+(\w+)/gm)) modscope.add(m[1]);
  for (const m of src.matchAll(/^import\s+\{([^}]*)\}/gm)) {
    for (const y of m[1].split(",")) {
      const n = y.trim().split(/\s+as\s+/).pop().trim();
      if (n) modscope.add(n);
    }
  }
  for (const m of src.matchAll(/^(?:export )?function (\w+)/gm)) modscope.add(m[1]);
  for (const m of src.matchAll(/^(?:let|const|var)\s+(\w+)/gm)) modscope.add(m[1]);
  const injectedOnly = new Set([...injected].filter((n) => !modscope.has(n)));

  const findings = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^export function (\w+)\(([^)]*)\)\s*\{/.exec(lines[i]);
    if (!m) continue;
    const name = m[1];
    if (/create\w+Module/.test(name)) continue; // the factory itself legitimately sees deps
    // capture the body by brace depth from this line
    let depth = 0, started = false, j = i, body = "";
    for (; j < lines.length; j++) {
      body += lines[j] + "\n";
      for (const ch of lines[j]) { if (ch === "{") { depth++; started = true; } else if (ch === "}") depth--; }
      if (started && depth <= 0) break;
    }
    const params = new Set(m[2].split(",").map((p) => p.trim().replace(/[=.].*$/, "").replace(/[{}[\]]/g, "").trim()).filter(Boolean));
    const locals = new Set(params);
    for (const lm of body.matchAll(/\b(?:let|const|var)\s+(\w+)/g)) locals.add(lm[1]);
    const refs = new Set([...body.matchAll(/\b([A-Za-z_]\w*)\b/g)].map((r) => r[1]));
    const bad = [...refs].filter((r) => injectedOnly.has(r) && !locals.has(r)).sort();
    if (bad.length) findings.push({ line: i + 1, name, refs: bad });
  }
  return findings;
}

// ── (b) Boot-reachability scan (app.js) ─────────────────────────────────────────────────
// Any code that EXECUTES during module evaluation before a factory has run must not touch
// that factory's destructured const (TDZ). "Executes at module-eval" = a top-level statement
// or a top-level `const X = <call>()` initializer (e.g. `const state = loadState()`), plus
// every top-level (hoisted) function transitively reachable from those via calls. For each
// such executing call at line L, flag any factory-destructured const it (transitively) calls
// that only becomes available at a line > L.
function scanBootReachability(src) {
  const lines = src.split("\n");

  // top-level function spans (one-liner-aware: closes on its own line if brace-balanced)
  const spans = new Map();
  const fnLines = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:async )?function (\w+)/.exec(lines[i]);
    if (!m) continue;
    const opens = (lines[i].match(/\{/g) || []).length, closes = (lines[i].match(/\}/g) || []).length;
    let end = i;
    if (opens > 0 && opens === closes) end = i;
    else { for (let j = i + 1; j < lines.length; j++) if (lines[j] === "}") { end = j; break; } }
    if (!spans.has(m[1])) spans.set(m[1], [i, end]);
  }
  for (const [, [a, b]] of spans) for (let k = a; k <= b; k++) fnLines.add(k);
  const bodyOf = (n) => { const [a, b] = spans.get(n); return lines.slice(a, b + 1).join("\n"); };
  const calleesOf = (n) => spans.has(n)
    ? new Set([...bodyOf(n).matchAll(/(?<![\w.])([A-Za-z_]\w*)\s*\(/g)].map((r) => r[1]))
    : new Set();

  // factory-instantiation + destructure block lines (exclude: their deferred-arrow thunks
  // are not executed at instantiation), and the "available at" line for each destructured const
  const blockLines = new Set();
  const destrAt = new Map();
  for (let i = 0; i < lines.length;) {
    if (/^const _\w+ = create\w+Module\(\{/.test(lines[i])) {
      let j = i; while (j < lines.length && !/^\}\);/.test(lines[j])) j++;
      for (let k = i; k <= j; k++) blockLines.add(k);
      i = j + 1; continue;
    }
    if (/^const \{/.test(lines[i]) && !/= create/.test(lines[i])) {
      let j = i; while (j < lines.length && !/\} = _\w+;/.test(lines[j])) j++;
      if (j < lines.length && /\} = _\w+;/.test(lines[j])) {
        for (const nm of new Set([...lines.slice(i, j + 1).join("\n").matchAll(/\b([A-Za-z_]\w*)\b/g)].map((r) => r[1]))) {
          if (nm !== "const" && !destrAt.has(nm)) destrAt.set(nm, j);
        }
        for (let k = i; k <= j; k++) blockLines.add(k);
      }
      i = j + 1; continue;
    }
    i++;
  }

  // top-level executed calls: (line, funcname)
  const topcalls = [];
  for (let i = 0; i < lines.length; i++) {
    if (fnLines.has(i) || blockLines.has(i)) continue;
    const s = lines[i].trim();
    if (!s || s.startsWith("//") || s.startsWith("/*") || s.startsWith("*")) continue;
    if (/^(function|async function|const|let|var|import|export|})/.test(lines[i])) {
      // still capture the RHS of a top-level `const X = <call>()` initializer (it executes)
      const init = /^(?:const|let|var)\s+\w+\s*=\s*(.+)$/.exec(lines[i]);
      if (init) for (const c of init[1].matchAll(/(?<![\w.])([A-Za-z_]\w*)\s*\(/g)) topcalls.push([i, c[1]]);
      continue;
    }
    for (const c of lines[i].matchAll(/(?<![\w.])([A-Za-z_]\w*)\s*\(/g)) topcalls.push([i, c[1]]);
  }

  const closure = (start) => {
    const seen = new Set(), fr = [start];
    while (fr.length) {
      const n = fr.pop();
      for (const c of calleesOf(n)) if (spans.has(c) && !seen.has(c)) { seen.add(c); fr.push(c); }
    }
    return seen;
  };

  const violations = [], dedupe = new Set();
  const flag = (L, site, cnst, dl, how) => {
    const key = L + "|" + cnst;
    if (dedupe.has(key)) return;
    dedupe.add(key);
    violations.push({ line: L + 1, site, const: cnst, available: dl + 1, how });
  };
  for (const [L, c] of topcalls) {
    if (destrAt.has(c) && destrAt.get(c) > L) flag(L, "<top-level>", c, destrAt.get(c), "direct");
    if (spans.has(c)) {
      const reach = closure(c); reach.add(c);
      for (const f of reach) for (const cc of calleesOf(f))
        if (destrAt.has(cc) && destrAt.get(cc) > L) flag(L, c, cc, destrAt.get(cc), "via " + f);
    }
  }
  return violations.sort((a, b) => a.line - b.line);
}

describe("fitness: no module export references an injected-only dep (export-scope guard)", () => {
  for (const mod of FACTORY_MODULES) {
    it(`${mod} — every top-level export is closable over module scope`, () => {
      const findings = scanExportScope(read("/" + mod));
      const report = findings.map((f) => `  ${mod}:${f.line} export ${f.name}() references injected-only [${f.refs.join(", ")}]`).join("\n");
      expect(findings.length, `\nBROKEN exports (an export runs outside the factory and cannot see injected deps —\nmove it back into app.js or the factory, or stop it referencing the injected name):\n${report}\n`).toBe(0);
    });
  }
});

// ── (c) Factory-init scope guard ────────────────────────────────────────────────────────
// A variable declared at the direct body of `createXModule(deps)` is initialized when the
// factory is INSTANTIATED (at app.js module-eval). Its initializer can only see the deps it
// destructured, module scope, and earlier factory-body declarations — never a name that
// stayed in app.js behind an injected getter. `let activeAutoRuleDayId = activePlannerDayId;`
// (moved verbatim into the meal-plan factory, but activePlannerDayId stayed in app.js) threw
// "activePlannerDayId is not defined" at instantiation — a crash the export-scope and
// boot-reachability guards can't see (it's a factory-internal let initializer, not an export
// or a call). Found by a headless module-eval; encoded here so it can't recur.
function scanFactoryInit(src) {
  // scope available inside the factory
  const depsMatch = src.match(/const\s*\{\s*([\s\S]*?)\s*\}\s*=\s*deps;/);
  const scope = new Set(["createId", "normalize", "_appState", "deps"]);
  if (depsMatch) for (let n of depsMatch[1].split(",")) { n = n.trim().split(":")[0].trim(); if (/^\w+$/.test(n)) scope.add(n); }
  for (const m of src.matchAll(/^import\s+\*\s+as\s+(\w+)/gm)) scope.add(m[1]);
  for (const m of src.matchAll(/^import\s+\{([^}]*)\}/gm)) for (const y of m[1].split(",")) { const n = y.trim().split(/\s+as\s+/).pop().trim(); if (n) scope.add(n); }
  for (const m of src.matchAll(/\bfunction (\w+)/g)) scope.add(m[1]);
  for (const m of src.matchAll(/^(?:export )?(?:let|const|var)\s+(\w+)/gm)) scope.add(m[1]);

  const BUILTINS = new Set(("null undefined true false NaN Infinity this arguments Math JSON Object Array String " +
    "Number Boolean Date Promise Set Map WeakMap WeakSet RegExp Symbol Proxy Reflect Error parseInt parseFloat " +
    "isNaN isFinite encodeURIComponent decodeURIComponent Function window document localStorage sessionStorage " +
    "navigator location history fetch setTimeout clearTimeout setInterval clearInterval requestAnimationFrame " +
    "cancelAnimationFrame queueMicrotask console URL URLSearchParams Blob File FileReader FormData Headers Request " +
    "Response AbortController TextEncoder TextDecoder IntersectionObserver ResizeObserver MutationObserver " +
    "CustomEvent Event Image Audio Node HTMLElement crypto performance structuredClone atob btoa globalThis Intl " +
    "Uint8Array Int32Array Float64Array ArrayBuffer DataView WeakRef alert confirm prompt getComputedStyle DOMParser " +
    "Notification Worker new typeof void delete in of instanceof await return if else for while do switch case " +
    "break continue try catch finally throw yield let const var function").split(" "));

  // strip comments / strings / templates / regex literals so their contents aren't read as refs;
  // then blank object-literal keys (`{ key: … }` / `, key: …`) which are keys, not references.
  const clean = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    .replace(/`(?:\\.|[^`\\])*`/g, "``").replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/(^|[=(,:[?&|!{]\s*)\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuy]*/g, "$1 0 ")
    .replace(/([{,]\s*)([A-Za-z_]\w*)(\s*:)/g, "$1$3");

  const lines = src.split("\n");
  const fi = lines.findIndex((l) => /^export function create\w+Module\(deps\)/.test(l));
  if (fi < 0) return [];
  const declared = new Set(scope);
  const findings = [];
  let depth = 0;
  for (let i = fi; i < lines.length; i++) {
    const line = clean(lines[i]);
    if (depth === 1) {
      const m = /^\s*(?:let|const|var)\s+(\w+)\s*=\s*(.+?);\s*$/.exec(line);
      if (m) {
        const ids = [...m[2].matchAll(/(?<![\w.])([A-Za-z_]\w*)/g)].map((r) => r[1]);
        const bad = [...new Set(ids.filter((x) => !BUILTINS.has(x) && !declared.has(x)))].sort();
        if (bad.length) findings.push({ line: i + 1, name: m[1], refs: bad });
        declared.add(m[1]);
      }
    }
    for (const ch of line) { if (ch === "{") depth++; else if (ch === "}") depth--; }
    if (depth <= 0 && i > fi) break;
  }
  return findings;
}

describe("fitness: no factory-body initializer references a name outside the factory's scope", () => {
  for (const mod of FACTORY_MODULES) {
    it(`${mod} — every factory-body let/const initializes from in-scope names`, () => {
      const findings = scanFactoryInit(read("/" + mod));
      const report = findings.map((f) => `  ${mod}:${f.line} let ${f.name} = … references out-of-scope [${f.refs.join(", ")}]`).join("\n");
      expect(findings.length, `\nFactory-init scope violations (a var declared at the factory body is initialized at\ninstantiation and can't see a name that stayed in app.js — init it from an injected getter/dep\nor a literal):\n${report}\n`).toBe(0);
    });
  }
});

describe("fitness: no boot-time code touches a factory const before its factory runs", () => {
  it("app.js — module-eval + loadState/normalizeState reach no later-destructured const", () => {
    const findings = scanBootReachability(read("/app.js"));
    const report = findings.map((f) => `  app.js:${f.line} [${f.site}] -> ${f.const}() available at line ${f.available} [${f.how}]`).join("\n");
    expect(findings.length, `\nBOOT-TIME TDZ violations (executed at module-load before the factory that provides the\nconst — move the call after the factory instantiations, or move the function into app.js):\n${report}\n`).toBe(0);
  });
});

// ── (d) Factory-deps ordering guard (app.js) ────────────────────────────────────────────
// A `createXModule({ … })` deps object is evaluated at module-load (when the factory is
// instantiated near the top of app.js). Any dep passed IMMEDIATELY — as shorthand
// (`PLAN_COLORS,`) or a non-deferred value (`key: EXPR` where EXPR is not an arrow/function
// thunk) — is read right then. If it names a top-level app.js const/let declared LATER in the
// file, that's a TDZ crash at boot ("Cannot access 'PLAN_COLORS' before initialization").
// Deferred thunks/getters (`name: (...a) => name(...a)`, `getX: () => x`) are evaluated at CALL
// time, not now, so their bodies are skipped — that's the whole point of the thunk pattern.
function scanFactoryDepsOrder(src) {
  const lines = src.split("\n");

  // top-level const/let/var declarations (column-0 in this file) → first declaration line
  const declAt = new Map();
  for (let i = 0; i < lines.length; i++) {
    let m = /^(?:const|let|var)\s+(\w+)\b/.exec(lines[i]);
    if (m) { if (!declAt.has(m[1])) declAt.set(m[1], i); continue; }
    m = /^(?:const|let|var)\s+\{([^}]+)\}/.exec(lines[i]); // top-level destructuring decl
    if (m) for (const raw of m[1].split(",")) {
      const n = raw.trim().split(":").pop().trim().replace(/\s*=.*$/, "");
      if (/^\w+$/.test(n) && !declAt.has(n)) declAt.set(n, i);
    }
  }

  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  // split an object-body's text into top-level entries (respect (), [], {} nesting)
  const splitEntries = (txt) => {
    const out = []; let d = 0, cur = "";
    for (const ch of txt) {
      if ("([{".includes(ch)) d++;
      else if (")]}".includes(ch)) d--;
      if (ch === "," && d === 0) { out.push(cur); cur = ""; } else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
  };

  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^const _\w+ = create\w+Module\(\{/.test(lines[i])) continue;
    let j = i; while (j < lines.length && !/^\}\);/.test(lines[j])) j++;
    const body = stripComments(lines.slice(i, j + 1).join("\n"))
      .replace(/^const _\w+ = create\w+Module\(\{/, "").replace(/\}\);\s*$/, "");
    for (const entry0 of splitEntries(body)) {
      const entry = entry0.trim();
      if (!entry) continue;
      // deferred thunk / getter — value is a function, evaluated at CALL time, not now
      if (/:\s*(async\s*)?(function\b|\([^)]*\)\s*=>|\w+\s*=>)/.test(entry)) continue;
      let refs = [];
      const sh = /^(\w+)$/.exec(entry);            // shorthand `PLAN_COLORS`
      const kv = /^(\w+)\s*:\s*(.+)$/s.exec(entry); // `key: valueExpr`
      if (sh) refs = [sh[1]];
      else if (kv) refs = [...kv[2].matchAll(/(?<![\w.])([A-Za-z_]\w*)/g)].map((r) => r[1]);
      for (const r of refs) {
        if (declAt.has(r) && declAt.get(r) > i) findings.push({ line: i + 1, dep: r, available: declAt.get(r) + 1 });
      }
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}

describe("fitness: no factory-instantiation dep references a later-declared module const", () => {
  it("app.js — every immediately-evaluated dep is declared before the factory runs", () => {
    const findings = scanFactoryDepsOrder(read("/app.js"));
    const report = findings.map((f) => `  app.js:${f.line} createXModule({ … ${f.dep} … }) — ${f.dep} is a top-level const/let declared later at line ${f.available}`).join("\n");
    expect(findings.length, `\nFACTORY-DEPS ordering TDZ (a dep passed immediately into a factory instantiation is a module\nconst/let declared further down the file → "Cannot access 'X' before initialization" at boot.\nMove the declaration above the factory instantiations, or pass it via a deferred getter thunk):\n${report}\n`).toBe(0);
  });
});

// ── (e) Factory free-variable guard ─────────────────────────────────────────────────────
// A factory function body can reference a bare name that is NOT its dep, NOT module scope,
// NOT a local, and NOT a builtin — a free variable. It resolves ONLY because esbuild bundles
// every module into one shared top-level scope, so the reference silently finds app.js's
// binding in the PRODUCTION build. On the UNBUNDLED dev server (native ESM, separate module
// scopes) it throws "X is not defined" the moment that code runs. `renderFinancePage`'s bare
// `elements` (finance-ui.js) was exactly this: it worked in prod but crashed Finance on
// localhost — Finance had simply never been opened on the dev server (the boot-check only
// smoke-tests Weather + Contacts). Guards (a)/(c) miss it: it's neither an export nor an
// initializer, just a runtime reference deep inside the factory. This guard is a no-undef
// lint scoped to each factory body; the character scanner blanks comments/strings/template
// TEXT/regex (keeping ${…} interpolation code) so HTML in template literals isn't misread.
const FACTORY_KEYWORDS = new Set(("null undefined true false NaN Infinity this arguments new typeof void delete in of instanceof await async " +
  "return if else for while do switch case default break continue try catch finally throw yield let const var function class extends super static get set as from import export").split(/\s+/));
const FACTORY_GLOBALS = new Set(("Math JSON Object Array String Number Boolean Date Promise Set Map WeakMap WeakSet RegExp Symbol Proxy Reflect " +
  "Error TypeError RangeError SyntaxError parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI " +
  "Function window document localStorage sessionStorage navigator location history fetch setTimeout clearTimeout setInterval clearInterval " +
  "requestAnimationFrame cancelAnimationFrame requestIdleCallback cancelIdleCallback queueMicrotask console URL URLSearchParams Blob File " +
  "FileReader FormData Headers Request Response AbortController AbortSignal TextEncoder TextDecoder IntersectionObserver ResizeObserver " +
  "MutationObserver CustomEvent Event KeyboardEvent MouseEvent PointerEvent DragEvent DataTransfer ClipboardEvent Element Node NodeList " +
  "HTMLElement HTMLInputElement Image Audio crypto performance structuredClone atob btoa globalThis Intl matchMedia getSelection " +
  "speechSynthesis SpeechSynthesisUtterance caches indexedDB Uint8Array Uint8ClampedArray Int32Array Float64Array ArrayBuffer DataView WeakRef " +
  "alert confirm prompt getComputedStyle DOMParser XMLSerializer Notification Worker CSS scrollTo scrollBy print postMessage").split(/\s+/));

// Pre-existing bundle-masked free-var refs (a module reads an app.js-scoped name it never
// injected — real bugs, dev-server-only crashes; `readableDuration` lives only in server.js
// so is undefined client-side entirely). Baselined so this guard blocks NEW ones while these
// are scheduled for a fix; each fix (inject the dep / a getter) shrinks this list.
const KNOWN_FREE_VARS = {
  "inventory-ui.js": ["inventoryCollapsedBoxes", "inventoryBoxPendingId", "inventoryBoxPendingParentId", "inventoryItemPendingId"],
};

function blankNonCode(src) { // blank comments/strings/template-text/regex, preserve newlines
  const a = src.split(""), n = a.length, bl = (k) => { if (a[k] !== "\n") a[k] = " "; };
  const stack = [], REGEX_KW = new Set(["return", "typeof", "instanceof", "in", "of", "case", "do", "else", "yield", "await", "delete", "void", "new"]);
  let i = 0, lastSig = "", word = "";
  while (i < n) {
    const c = src[i], c2 = src[i + 1], top = stack[stack.length - 1];
    if (top && top.t === "tmpl") {
      if (c === "\\") { bl(i); bl(i + 1); i += 2; continue; }
      if (c === "`") { stack.pop(); i++; continue; }
      if (c === "$" && c2 === "{") { stack.push({ t: "expr", depth: 0 }); i += 2; lastSig = "{"; word = ""; continue; }
      bl(i); i++; continue;
    }
    if (c === "/" && c2 === "/") { while (i < n && src[i] !== "\n") bl(i++); continue; }
    if (c === "/" && c2 === "*") { bl(i); bl(i + 1); i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) bl(i++); if (i < n) { bl(i); bl(i + 1); i += 2; } continue; }
    if (c === "/" && (lastSig === "" || "(,;[{:=!&|?+-*%<>^~".includes(lastSig) || REGEX_KW.has(word))) {
      bl(i); i++; let inClass = false;
      while (i < n && src[i] !== "\n") { const d = src[i]; if (d === "\\") { bl(i); bl(i + 1); i += 2; continue; } if (d === "[") inClass = true; else if (d === "]") inClass = false; else if (d === "/" && !inClass) break; bl(i); i++; }
      if (i < n && src[i] === "/") bl(i++);
      while (i < n && /[a-z]/i.test(src[i])) bl(i++);
      lastSig = "/"; word = ""; continue;
    }
    if (c === "'" || c === '"') { const q = c; i++; while (i < n && src[i] !== q) { if (src[i] === "\\") bl(i++); bl(i++); } if (i < n) i++; lastSig = q; word = ""; continue; }
    if (c === "`") { stack.push({ t: "tmpl" }); i++; lastSig = "`"; word = ""; continue; }
    if (top && top.t === "expr") {
      if (c === "{") { top.depth++; i++; lastSig = "{"; word = ""; continue; }
      if (c === "}") { if (top.depth === 0) { stack.pop(); i++; continue; } top.depth--; i++; lastSig = "}"; word = ""; continue; }
    }
    if (!/\s/.test(c)) { lastSig = c; word = /[\w$]/.test(c) ? word + c : ""; }
    i++;
  }
  return a.join("").replace(/([{,]\s*)([A-Za-z_]\w*)(\s*:)/g, "$1 $3"); // blank object-literal keys
}
function factoryKnownNames(src, clean) {
  const known = new Set([...FACTORY_KEYWORDS, ...FACTORY_GLOBALS, "createId", "normalize", "_appState", "deps"]);
  const addBindings = (str) => { for (const m of (str || "").matchAll(/(?:^|[\s,{[])\.{0,3}\s*([A-Za-z_]\w*)\s*(?::\s*([A-Za-z_]\w*))?/g)) known.add(m[2] || m[1]); };
  // deps destructure (brace-balanced — the lists are long and may contain arrow-default braces)
  const dep = /\}\s*=\s*deps\b/.exec(clean);
  if (dep) { const cb = clean.lastIndexOf("}", dep.index); let d = 0, o = -1; for (let k = cb; k >= 0; k--) { if (clean[k] === "}") d++; else if (clean[k] === "{") { d--; if (d === 0) { o = k; break; } } } if (o >= 0) for (const nm of clean.slice(o + 1, cb).split(",")) { const b = nm.trim().split(":")[0].split("=")[0].trim(); if (/^\w+$/.test(b)) known.add(b); } }
  for (const m of src.matchAll(/^import\s+\*\s+as\s+(\w+)/gm)) known.add(m[1]);
  for (const m of src.matchAll(/^import\s+(\w+)\s*(?:,|from)/gm)) known.add(m[1]);
  for (const m of src.matchAll(/import\s+\{([^}]*)\}/g)) for (const y of m[1].split(",")) { const nm = y.trim().split(/\s+as\s+/).pop().trim(); if (nm) known.add(nm); }
  for (const m of clean.matchAll(/\bfunction\s*\*?\s*(\w+)/g)) known.add(m[1]);
  for (const m of clean.matchAll(/\bclass\s+(\w+)/g)) known.add(m[1]);
  for (const m of clean.matchAll(/\b(?:const|let|var)\s+([^;\n]+)/g)) for (const part of m[1].split(",")) { const mm = /^\s*[{[]?\s*\.{0,3}\s*([A-Za-z_]\w*)/.exec(part); if (mm) known.add(mm[1]); }
  for (const m of clean.matchAll(/\b(?:const|let|var)\s*([{[])([\s\S]*?)[}\]]\s*=/g)) addBindings(m[2]);
  for (const m of clean.matchAll(/\bfunction\s*\*?\s*\w*\s*\(([^)]*)\)/g)) addBindings(m[1]);
  for (const m of clean.matchAll(/\(([^()]*)\)\s*=>/g)) addBindings(m[1]);
  for (const m of clean.matchAll(/(?<![\w$.])(\w+)\s*=>/g)) known.add(m[1]);
  for (const m of clean.matchAll(/\bcatch\s*\(([^)]*)\)/g)) addBindings(m[1]);
  return known;
}
function scanFactoryFreeVars(src) {
  const clean = blankNonCode(src);
  const known = factoryKnownNames(src, clean);
  const cl = clean.split("\n");
  const fi = cl.findIndex((l) => /^export function create\w+Module\(deps\)/.test(l));
  if (fi < 0) return [];
  let depth = 0, end = cl.length - 1;
  for (let i = fi; i < cl.length; i++) { for (const ch of cl[i]) { if (ch === "{") depth++; else if (ch === "}") depth--; } if (depth <= 0 && i > fi) { end = i; break; } }
  const seen = new Map();
  for (let i = fi; i <= end; i++) for (const m of cl[i].matchAll(/(?<![\w$.])([A-Za-z_]\w*)\b/g)) {
    const id = m[1];
    if (known.has(id)) continue;
    const after = cl[i].slice(m.index + id.length).replace(/^\s+/, "");
    if (after[0] === ":" && after[1] !== ":") continue;
    if (!seen.has(id)) seen.set(id, i + 1);
  }
  return [...seen].map(([id, line]) => ({ id, line })).sort((a, b) => a.line - b.line);
}

describe("fitness: no factory body references an app-scoped free variable (bundle-masked crash)", () => {
  for (const mod of FACTORY_MODULES) {
    it(`${mod} — every name used inside the factory is a dep, a local, or a builtin`, () => {
      const baseline = new Set(KNOWN_FREE_VARS[mod] || []);
      const findings = scanFactoryFreeVars(read("/" + mod)).filter((f) => !baseline.has(f.id));
      const report = findings.map((f) => `  ${mod}:${f.line} references '${f.id}' — not injected/declared/builtin`).join("\n");
      expect(findings.length, `\nFACTORY FREE-VARIABLE (a name used in the factory body isn't a dep, a module/local declaration,\nor a builtin — it only resolves via esbuild's shared bundle scope and throws "X is not defined"\non the unbundled dev server the moment that code runs). Inject it as a dep (a getter for values\nthat change), or declare it in the module:\n${report}\n`).toBe(0);
    });
  }
});
