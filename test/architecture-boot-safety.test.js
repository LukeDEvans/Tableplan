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
